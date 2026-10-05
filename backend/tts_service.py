"""Text-to-speech for spoken interview questions.

Engine: Piper (https://github.com/OHF-Voice/piper1-gpl), an open-source
neural text-to-speech system that runs locally on the CPU; no audio or text
is sent to a third party. Licence: GPL-3.0 (running it on our own server
does not require publishing this application's source).

Synthesised WAV files are cached on disk by a hash of the voice, speed and
text, so repeating a question or a fixed phrase costs nothing. When Piper
is unavailable the API returns 503 and the browser falls back to its own
speech synthesis.
"""
import hashlib
import io
import logging
import os
import re
import threading
import wave

import config

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 1200


class SpeechUnavailable(Exception):
    """Raised when speech cannot be produced; the API turns it into 503."""


# -------------------------------------------------------------
# BLOCK 1: Lazily loaded voice
# -------------------------------------------------------------
_voice = None
_voice_lock = threading.Lock()
_synth_lock = threading.Lock()


def _voice_path() -> str:
    return os.path.join(config.PIPER_VOICE_DIR, f"{config.PIPER_VOICE}.onnx")


def _get_voice():
    global _voice
    with _voice_lock:
        if _voice is None:
            from piper import PiperVoice
            from piper.download_voices import download_voice
            from pathlib import Path

            path = _voice_path()
            if not os.path.isfile(path):
                logger.info("Downloading Piper voice %s", config.PIPER_VOICE)
                os.makedirs(config.PIPER_VOICE_DIR, exist_ok=True)
                download_voice(config.PIPER_VOICE, Path(config.PIPER_VOICE_DIR))
            logger.info("Loading Piper voice %s", config.PIPER_VOICE)
            _voice = PiperVoice.load(path)
        return _voice


def warm_up() -> bool:
    """Load the voice and run one tiny synthesis so the first request is fast."""
    if config.TTS_PROVIDER != "piper":
        return False
    try:
        # Load explicitly: synthesize() may be served from the disk cache
        # without ever touching the voice.
        voice = _get_voice()
        with _synth_lock, wave.open(io.BytesIO(), "wb") as wav_file:
            voice.synthesize_wav("Ready.", wav_file)
        return True
    except Exception:
        logger.exception("Piper text-to-speech could not be loaded")
        return False


def is_loaded() -> bool:
    return _voice is not None


# -------------------------------------------------------------
# BLOCK 2: Text preparation
# -------------------------------------------------------------
def prepare_text(text: str) -> str:
    """Make question text pleasant to hear: no markdown, tidy spacing."""
    text = re.sub(r"[`*_#>]+", "", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_TEXT_CHARS]


# -------------------------------------------------------------
# BLOCK 3: Synthesis with an on-disk cache
# -------------------------------------------------------------
def _cache_path(text: str) -> str:
    key = f"{config.PIPER_VOICE}|{config.PIPER_LENGTH_SCALE}|{text}".encode("utf-8")
    return os.path.join(config.TTS_CACHE_DIR, hashlib.sha256(key).hexdigest() + ".wav")


def synthesize(text: str) -> str:
    """Return the path of a WAV file speaking ``text``; raises SpeechUnavailable."""
    if config.TTS_PROVIDER != "piper":
        raise SpeechUnavailable("Text-to-speech is turned off on this server.")
    text = prepare_text(text)
    if not text:
        raise SpeechUnavailable("Nothing to say.")
    path = _cache_path(text)
    if os.path.isfile(path):
        return path
    try:
        from piper import SynthesisConfig

        voice = _get_voice()
        buffer = io.BytesIO()
        with _synth_lock, wave.open(buffer, "wb") as wav_file:
            voice.synthesize_wav(text, wav_file,
                                 syn_config=SynthesisConfig(length_scale=config.PIPER_LENGTH_SCALE))
    except Exception as err:
        logger.warning("Piper synthesis failed: %s", err)
        raise SpeechUnavailable("Speech could not be generated.") from err

    os.makedirs(config.TTS_CACHE_DIR, exist_ok=True)
    temporary = f"{path}.{threading.get_ident()}.tmp"
    with open(temporary, "wb") as handle:
        handle.write(buffer.getvalue())
    os.replace(temporary, path)  # atomic: concurrent readers never see half a file
    return path


# -------------------------------------------------------------
# BLOCK 4: What the interviewer says
# -------------------------------------------------------------
# Fixed phrases are a whitelist so the endpoint cannot be used as a
# general-purpose speech service.
PHRASES = {
    "speaker_test": "This is a speaker test. If you can hear this clearly, your audio is ready for the interview.",
    "thanks": "Thank you.",
    "thanks_next": "Thank you. Let's move on to the next question.",
    "no_speech": "Sorry, I couldn't hear an answer. Please try answering again.",
    "time_up": "Thank you, that's the time for this question.",
}


def intro_text(first_name: str | None, role_title: str, max_turns: int) -> str:
    greeting = f"Hello {first_name}." if first_name else "Hello."
    return (
        f"{greeting} Welcome to your {role_title} interview. I'll ask you {max_turns} questions, "
        "one at a time, and some may follow up on your answers. Take a moment to think, then answer "
        "out loud. When you've finished an answer, select Next, or simply pause and I'll move on. "
        "Let's begin."
    )


def outro_text() -> str:
    return ("That's the end of the interview. Thank you for your time. "
            "I'm now preparing your evaluation report.")


def question_text(index: int, question: str, is_follow_up: bool = False) -> str:
    lead = f"Question {index}, a follow-up." if is_follow_up else f"Question {index}."
    return f"{lead} {question}"
