"""Identity verification: is the person answering the person who enrolled?

At the start of an interview the candidate enrols: one photo and a short
sentence read aloud. Afterwards:
  * every spoken answer is compared with the enrolled voice (speaker
    embeddings), including short windows inside the answer, so a second
    voice that answers part of a question is found too;
  * face snapshots taken during the interview are compared with the
    enrolled face.

Open-source models, run locally on the server (nothing is sent elsewhere):
  * voice: NVIDIA NeMo TitaNet-small speaker embeddings through sherpa-onnx;
  * face:  OpenCV YuNet detector + SFace recogniser (Apache-2.0).
``download_models.py`` fetches them into backend/models.

Similarities are cosine scores. Thresholds were checked on real interview
recordings: the same speaker scored 0.25-0.87 across answers (0.32+ within
one session), a different voice -0.06-0.11; the same face 0.52-0.88 within
a session, a different face 0.07-0.35. Scores between the two thresholds are "uncertain" and are only
ever reported for review, never penalised.

Everything degrades gracefully: when a model or package is missing the
checks report ``unavailable`` and the interview continues normally.
"""
import logging
import os
import threading
from typing import Optional

import config

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000

VOICE_MATCH = 0.30
VOICE_MISMATCH = 0.15
# Short windows are noisier than whole answers, so a window counts as a
# different voice only well below the whole-answer threshold.
VOICE_WINDOW_MISMATCH = 0.10
FACE_MATCH = 0.45
FACE_MISMATCH = 0.30

# Speech needed for a reliable voiceprint, and the window used inside answers.
MIN_VOICE_SECONDS = 3.0
WINDOW_SECONDS = 4.0
# Gallery growth: confident matches are added so later checks tolerate the
# difference between reading a sentence and answering spontaneously.
GALLERY_ADD_SIMILARITY = 0.45
FACE_GALLERY_ADD_SIMILARITY = 0.60
MAX_GALLERY = 6

# Face quality: smaller or less certain detections are not compared.
MIN_FACE_PIXELS = 60
MIN_FACE_SCORE = 0.85


class IdentityUnavailable(Exception):
    """The models (or their packages) are not installed on this server."""


# -------------------------------------------------------------
# BLOCK 1: Lazily loaded models
# -------------------------------------------------------------
_lock = threading.Lock()
_speaker = None
_face = None
_failed: dict[str, str] = {}


def _model_path(name: str) -> str:
    return os.path.join(config.IDENTITY_MODEL_DIR, name)


def _speaker_model():
    global _speaker
    with _lock:
        if _speaker is None:
            if "voice" in _failed:
                raise IdentityUnavailable(_failed["voice"])
            try:
                import sherpa_onnx
                path = _model_path(config.SPEAKER_MODEL)
                if not os.path.isfile(path):
                    raise FileNotFoundError(f"{path} is missing; run backend/download_models.py")
                _speaker = sherpa_onnx.SpeakerEmbeddingExtractor(
                    sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=path, num_threads=2))
            except Exception as err:
                _failed["voice"] = str(err)
                logger.warning("Voice verification unavailable: %s", err)
                raise IdentityUnavailable(str(err)) from err
        return _speaker


def _face_models():
    global _face
    with _lock:
        if _face is None:
            if "face" in _failed:
                raise IdentityUnavailable(_failed["face"])
            try:
                import cv2
                detector_path = _model_path(config.FACE_DETECTOR_MODEL)
                recognizer_path = _model_path(config.FACE_RECOGNIZER_MODEL)
                for path in (detector_path, recognizer_path):
                    if not os.path.isfile(path):
                        raise FileNotFoundError(f"{path} is missing; run backend/download_models.py")
                detector = cv2.FaceDetectorYN.create(detector_path, "", (320, 240), 0.7, 0.3, 5)
                recognizer = cv2.FaceRecognizerSF.create(recognizer_path, "")
                _face = (detector, recognizer, threading.Lock())
            except Exception as err:
                _failed["face"] = str(err)
                logger.warning("Face verification unavailable: %s", err)
                raise IdentityUnavailable(str(err)) from err
        return _face


def enabled() -> bool:
    return config.IDENTITY_CHECKS == "on"


def status() -> dict:
    """Which checks can run here (loads the models on first call)."""
    if not enabled():
        return {"voice": False, "face": False}
    result = {}
    for name, loader in (("voice", _speaker_model), ("face", _face_models)):
        try:
            loader()
            result[name] = True
        except IdentityUnavailable:
            result[name] = False
    return result


def warm_up() -> None:
    if enabled():
        status()


# -------------------------------------------------------------
# BLOCK 2: Vectors
# -------------------------------------------------------------
def _unit(vector):
    import numpy as np
    array = np.asarray(vector, dtype="float32").reshape(-1)
    norm = float(np.linalg.norm(array))
    return array / norm if norm else array


def similarity(a, b) -> float:
    """Cosine similarity of two embeddings."""
    return round(float(_unit(a) @ _unit(b)), 3)


def best_similarity(vector, gallery: list) -> Optional[float]:
    """Highest similarity of ``vector`` to any enrolled embedding."""
    scores = [similarity(vector, item) for item in gallery or [] if item]
    return max(scores) if scores else None


def verdict(score: Optional[float], match: float, mismatch: float) -> str:
    if score is None:
        return "unavailable"
    if score >= match:
        return "match"
    if score < mismatch:
        return "mismatch"
    return "uncertain"


def grow_gallery(gallery: list, vector, score: Optional[float],
                 threshold: float = GALLERY_ADD_SIMILARITY) -> list:
    """Add a confident match (bounded) so the profile covers more conditions."""
    if vector is None or score is None or score < threshold or len(gallery) >= MAX_GALLERY:
        return gallery
    return gallery + [[round(float(x), 5) for x in _unit(vector)]]


# -------------------------------------------------------------
# BLOCK 3: Voice
# -------------------------------------------------------------
def load_audio(path: str):
    """Decode any browser recording to 16 kHz mono float32 (PyAV)."""
    from faster_whisper.audio import decode_audio
    return decode_audio(path, sampling_rate=SAMPLE_RATE)


def trim_silence(samples, frame_ms: int = 30):
    """Keep frames clearly louder than the recording's own quiet level."""
    import numpy as np
    frame = int(SAMPLE_RATE * frame_ms / 1000)
    count = len(samples) // frame
    if count == 0:
        return samples[:0]
    frames = samples[: count * frame].reshape(count, frame)
    energy = np.sqrt((frames ** 2).mean(axis=1))
    floor = float(np.percentile(energy, 20))
    threshold = max(0.01, floor * 3)
    return frames[energy > threshold].reshape(-1)


def speech_windows(words: list[dict], window: float = WINDOW_SECONDS) -> list[tuple[float, float]]:
    """Group transcribed words into consecutive windows of about ``window`` s of speech."""
    windows, start, spoken, end = [], None, 0.0, None
    for word in words or []:
        if start is None:
            start = word["start"]
        spoken += max(0.0, word["end"] - word["start"])
        end = word["end"]
        if spoken >= window:
            windows.append((start, end))
            start, spoken = None, 0.0
    if start is not None and spoken >= window * 0.75:
        windows.append((start, end))
    return windows


def _cut(samples, spans: list[tuple[float, float]], pad: float = 0.1):
    import numpy as np
    pieces = [samples[max(0, int((s - pad) * SAMPLE_RATE)): int((e + pad) * SAMPLE_RATE)] for s, e in spans]
    pieces = [p for p in pieces if len(p)]
    return np.concatenate(pieces) if pieces else samples[:0]


def voice_embedding(samples) -> Optional[list]:
    """Speaker embedding of ``samples`` (16 kHz), or None if speech is too short."""
    import numpy as np
    if len(samples) < MIN_VOICE_SECONDS * SAMPLE_RATE:
        return None
    extractor = _speaker_model()
    stream = extractor.create_stream()
    stream.accept_waveform(SAMPLE_RATE, np.ascontiguousarray(samples, dtype="float32"))
    stream.input_finished()
    return [round(float(x), 5) for x in _unit(extractor.compute(stream))]


def enrol_voice(path: str) -> dict:
    """Voiceprint from the enrolment sentence: ``{embedding, speech_seconds}``."""
    speech = trim_silence(load_audio(path))
    seconds = round(len(speech) / SAMPLE_RATE, 1)
    return {"embedding": voice_embedding(speech), "speech_seconds": seconds}


def check_answer_voice(path: str, words: list[dict], gallery: list) -> dict:
    """Compare one spoken answer with the enrolled voice.

    verdict: match | uncertain | mismatch (another person answered) |
    mixed (the candidate's voice, but another voice in part of the answer) |
    insufficient (too little speech) | unavailable.
    """
    if not gallery:
        return {"verdict": "unavailable", "reason": "no voice enrolment"}
    samples = load_audio(path)
    speech = _cut(samples, [(w["start"], w["end"]) for w in words]) if words else trim_silence(samples)
    seconds = round(len(speech) / SAMPLE_RATE, 1)
    embedding = voice_embedding(speech)
    if embedding is None:
        return {"verdict": "insufficient", "speech_seconds": seconds}

    score = best_similarity(embedding, gallery)
    result = {"verdict": verdict(score, VOICE_MATCH, VOICE_MISMATCH), "similarity": score,
              "speech_seconds": seconds, "segments": [], "other_voice_segments": []}

    # Windows inside the answer: a helper answering part of the question.
    windows = speech_windows(words) if words else []
    if len(windows) >= 2:
        for start, end in windows:
            window_embedding = voice_embedding(_cut(samples, [(start, end)], pad=0))
            if window_embedding is None:
                continue
            window_score = best_similarity(window_embedding, gallery)
            segment = {"start": round(start, 1), "end": round(end, 1), "similarity": window_score}
            result["segments"].append(segment)
            if window_score is not None and window_score < VOICE_WINDOW_MISMATCH:
                result["other_voice_segments"].append(segment)
    if result["verdict"] != "mismatch" and result["other_voice_segments"]:
        result["verdict"] = "mixed"
    result["embedding"] = embedding
    return result


# -------------------------------------------------------------
# BLOCK 4: Face
# -------------------------------------------------------------
def decode_image(data: bytes):
    """JPEG/PNG bytes to a BGR image, or None when it is not an image."""
    import cv2
    import numpy as np
    if not data:
        return None
    image = cv2.imdecode(np.frombuffer(data, dtype="uint8"), cv2.IMREAD_COLOR)
    return image if image is not None and image.size else None


def save_jpeg(image, path: str) -> None:
    """Store an evidence image (JPEG, quality 85)."""
    import cv2
    cv2.imwrite(path, image, [int(cv2.IMWRITE_JPEG_QUALITY), 85])


def analyze_face(image) -> dict:
    """Detect faces; embed the largest one when it is clear enough.

    Returns ``{faces, embedding|None, score, box, quality_ok, brightness}``.
    """
    import cv2
    detector, recognizer, lock = _face_models()
    height, width = image.shape[:2]
    brightness = round(float(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).mean()), 1)
    with lock:  # OpenCV DNN objects are not safe to share across threads
        detector.setInputSize((width, height))
        _, detections = detector.detect(image)
        faces = [] if detections is None else [d for d in detections if float(d[-1]) >= 0.7]
        if not faces:
            return {"faces": 0, "embedding": None, "score": None, "box": None,
                    "quality_ok": False, "brightness": brightness}
        main = max(faces, key=lambda d: float(d[2]) * float(d[3]))
        quality_ok = min(float(main[2]), float(main[3])) >= MIN_FACE_PIXELS and float(main[-1]) >= MIN_FACE_SCORE
        embedding = None
        if quality_ok:
            feature = recognizer.feature(recognizer.alignCrop(image, main))
            embedding = [round(float(x), 5) for x in _unit(feature)]
    return {
        "faces": len(faces), "embedding": embedding, "score": round(float(main[-1]), 3),
        "box": [round(float(v)) for v in main[:4]], "quality_ok": quality_ok, "brightness": brightness,
    }


def check_face(image, gallery: list) -> dict:
    """Compare a snapshot with the enrolled face.

    verdict: match | uncertain | mismatch | no_face | multiple_faces |
    unclear (face too small, dark or blurred) | unavailable.
    """
    analysis = analyze_face(image)
    result = {key: analysis[key] for key in ("faces", "score", "box", "brightness")}
    if analysis["faces"] == 0:
        return {**result, "verdict": "no_face", "similarity": None}
    score = best_similarity(analysis["embedding"], gallery) if analysis["embedding"] else None
    if analysis["faces"] > 1:
        return {**result, "verdict": "multiple_faces", "similarity": score, "embedding": analysis["embedding"]}
    if not analysis["quality_ok"] or score is None:
        return {**result, "verdict": "unclear" if gallery else "unavailable", "similarity": score}
    return {**result, "verdict": verdict(score, FACE_MATCH, FACE_MISMATCH), "similarity": score,
            "embedding": analysis["embedding"]}
