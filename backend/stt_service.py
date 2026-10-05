"""Speech-to-text for recorded answers.

Primary engine: faster-whisper (open source, MIT licence), a CTranslate2
re-implementation of OpenAI Whisper that runs locally on the CPU. Audio
never leaves the server. Gemini audio transcription is a fallback when
Whisper is unavailable and a Gemini key is configured.

The model is loaded lazily on the first request and reused afterwards.
Transcription is serialised with a lock: one CPU model serving several
requests at once would only make each of them slower.
"""
import logging
import threading

import config

logger = logging.getLogger(__name__)

# Whisper tends to "clean up" disfluencies. Priming it with a sentence that
# contains fillers makes it far more likely to keep them, which the filler
# and fluency metrics depend on.
_VERBATIM_PROMPT = "Umm, let me think, like, hmm... Okay, so, uh, here's what I, you know, think."


class TranscriptionError(Exception):
    """Raised when audio cannot be transcribed; the message is user-safe."""


# -------------------------------------------------------------
# BLOCK 1: Lazily loaded Whisper model
# -------------------------------------------------------------
_model = None
_model_lock = threading.Lock()
_transcribe_lock = threading.Lock()


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            # Imported here so the API (and tests) start without the package.
            from faster_whisper import WhisperModel
            logger.info("Loading faster-whisper model %s on %s (%s)",
                        config.STT_MODEL, config.STT_DEVICE, config.STT_COMPUTE_TYPE)
            _model = WhisperModel(config.STT_MODEL, device=config.STT_DEVICE,
                                  compute_type=config.STT_COMPUTE_TYPE)
        return _model


def warm_up() -> bool:
    """Load the model ahead of the first request; returns False on failure."""
    if config.STT_PROVIDER != "whisper":
        return False
    try:
        _get_model()
        return True
    except Exception:
        logger.exception("faster-whisper could not be loaded")
        return False


# -------------------------------------------------------------
# BLOCK 2: Engines
# -------------------------------------------------------------
def _core(word: str) -> str:
    return "".join(ch for ch in word.casefold() if ch.isalnum())


def _drop_echoes(words: list[dict]) -> list[dict]:
    """Remove Whisper "echo" words, e.g. "... slower. lower." at the end.

    A word is dropped only when it repeats the ending of the word right
    before it, starts immediately after it and is less confident, so real
    repetitions ("very, very") are kept.
    """
    cleaned = []
    for word in words:
        previous = cleaned[-1] if cleaned else None
        core, previous_core = _core(word["word"]), _core(previous["word"]) if previous else ""
        if (previous and len(core) >= 3 and core != previous_core
                and previous_core.endswith(core)
                and word["start"] - previous["end"] < 0.3
                and word["probability"] < previous["probability"]):
            continue
        cleaned.append(word)
    return cleaned

# Phrases Whisper is known to invent over silence or noise at the end of a
# recording (it was trained on subtitled video).
_HALLUCINATIONS = {
    "thank you", "thanks", "thank you very much", "thanks for watching",
    "thank you for watching", "please subscribe", "bye", "you",
}


def _normalised(text: str) -> str:
    return " ".join("".join(ch for ch in text.casefold() if ch.isalnum() or ch.isspace()).split())


def _keep_segment(segment, is_last: bool) -> bool:
    """Drop segments that are probably not speech or are typical inventions."""
    if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0:
        return False
    if is_last and _normalised(segment.text) in _HALLUCINATIONS and (
            segment.no_speech_prob > 0.2 or segment.avg_logprob < -0.7 or segment.end - segment.start < 1.5):
        return False
    return True


def _prompt_for(context: str | None) -> str:
    """Prime Whisper with the question (domain vocabulary) and filler style."""
    if not context:
        return _VERBATIM_PROMPT
    # Whisper reads only the last ~224 tokens of the prompt; keep it short.
    return f"{context.strip()[:300]} {_VERBATIM_PROMPT}"


def _transcribe_whisper(path: str, context: str | None = None) -> dict:
    model = _get_model()
    with _transcribe_lock:
        segments, info = model.transcribe(
            path,
            language=config.STT_LANGUAGE or None,
            beam_size=5,
            vad_filter=True,             # skip long silences before decoding
            word_timestamps=True,        # needed for pace and pause metrics
            condition_on_previous_text=False,
            initial_prompt=_prompt_for(context),
            # Drops words hallucinated over trailing silence (a known Whisper
            # artefact, e.g. a repeated last word). Requires word timestamps.
            hallucination_silence_threshold=1.0,
        )
        # `segments` is a generator; decoding happens while iterating.
        segments = list(segments)
    segments = [s for i, s in enumerate(segments) if _keep_segment(s, i == len(segments) - 1)]

    words = []
    for segment in segments:
        for word in segment.words or []:
            text = word.word.strip()
            if text:
                words.append({
                    "word": text,
                    "start": round(float(word.start), 2),
                    "end": round(float(word.end), 2),
                    "probability": round(float(word.probability), 3),
                })
    words = _drop_echoes(words)
    # Build the text from the cleaned words so text and timings agree.
    text = " ".join(w["word"] for w in words) if words else " ".join(
        segment.text.strip() for segment in segments if segment.text.strip())
    return {
        "text": text,
        "words": words,
        "language": info.language,
        "duration_seconds": round(float(info.duration), 2),
        "source": "whisper",
        "model": config.STT_MODEL,
    }


def _transcribe_gemini(path: str, mime_type: str) -> dict:
    import gemini_service
    text = gemini_service.transcribe_audio(path, mime_type)
    # Gemini returns text only; pace/pause metrics need word timings, so
    # they are omitted for this source rather than estimated.
    return {
        "text": text, "words": [], "language": config.STT_LANGUAGE or None,
        "duration_seconds": None, "source": "gemini", "model": config.GEMINI_EVALUATION_MODEL,
    }


# -------------------------------------------------------------
# BLOCK 3: Public entry point
# -------------------------------------------------------------
def transcribe(path: str, mime_type: str = "audio/webm", context: str | None = None) -> dict:
    """Transcribe an audio file.

    ``context`` (the question text) primes Whisper with the vocabulary the
    answer is likely to use, e.g. "PostgreSQL" or "idempotency".
    Returns ``{text, words: [{word, start, end, probability}], language,
    duration_seconds, source, model}``. Raises ``TranscriptionError``.
    """
    provider = config.STT_PROVIDER
    if provider == "off":
        raise TranscriptionError("Speech-to-text is turned off on this server.")

    if provider == "whisper":
        try:
            result = _transcribe_whisper(path, context)
        except Exception as err:
            logger.warning("faster-whisper failed: %s", err)
            if not config.GEMINI_API_KEY:
                raise TranscriptionError("The recording could not be transcribed. Please try again or type your answer.") from err
            provider = "gemini"
        else:
            if result["duration_seconds"] and result["duration_seconds"] > config.STT_MAX_AUDIO_SECONDS:
                raise TranscriptionError(f"Recordings longer than {config.STT_MAX_AUDIO_SECONDS // 60} minutes are not supported.")
            return result

    if provider == "gemini":
        try:
            return _transcribe_gemini(path, mime_type)
        except Exception as err:
            logger.warning("Gemini transcription failed: %s", err)
            raise TranscriptionError("The recording could not be transcribed. Please try again or type your answer.") from err

    raise TranscriptionError(f"Unknown STT_PROVIDER '{provider}'.")


def is_loaded() -> bool:
    """True once the Whisper model is in memory."""
    return _model is not None
