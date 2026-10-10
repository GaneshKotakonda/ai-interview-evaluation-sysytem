"""Interview integrity (proctoring) rules. Pure functions, unit-testable.

What a web browser can observe — and therefore what this records:
  * the candidate leaving the interview: exiting fullscreen, switching tab,
    or giving focus to another window or application;
  * blocked copy / paste / right-click and suspicious shortcuts;
  * a second display connected at the start (Chromium browsers);
  * from the microphone: steady sound that is not the candidate (music, a TV);
  * from the camera: another person or a phone in view, the candidate out
    of frame, a covered or frozen camera, and speech while the candidate's
    lips are not moving;
  * typed answers that appear without being typed.
The server adds identity events: a face or a voice that does not match the
candidate's enrolment (identity.py).

A browser cannot list background applications or see devices outside the
camera's view, so those are deliberately not claimed. Answer penalties and
the interview verdict are decided in malpractice.py.
"""
from typing import Iterable, Optional

# Leaving the interview window (their duration is "time away").
LEAVE_EVENTS = {"fullscreen_exit", "tab_hidden", "window_blur"}
# Seen or heard during the interview; also warned about and counted.
MALPRACTICE_EVENTS = {"extra_person", "phone_detected", "face_absent", "other_voice",
                      "camera_blocked", "camera_frozen", "text_injected", "background_sound"}
# Raised by the server's identity checks, never accepted from the browser.
SERVER_EVENTS = {"face_mismatch", "voice_mismatch"}
# Every major event counts towards the violation limit.
MAJOR_EVENTS = LEAVE_EVENTS | MALPRACTICE_EVENTS | SERVER_EVENTS
# Blocked or suspicious actions: logged, shown in the report, not counted.
MINOR_EVENTS = {"paste_blocked", "copy_blocked", "context_menu", "devtools_shortcut",
                "print_screen", "multiple_displays", "fullscreen_unavailable",
                "book_detected", "virtual_device", "reading_pattern",
                "looking_away"}
EVENT_TYPES = MAJOR_EVENTS | MINOR_EVENTS
CLIENT_EVENT_TYPES = EVENT_TYPES - SERVER_EVENTS

LABELS = {
    "fullscreen_exit": "Left fullscreen",
    "tab_hidden": "Switched tab or minimised the window",
    "window_blur": "Switched to another window or app",
    "paste_blocked": "Paste blocked",
    "copy_blocked": "Copy blocked",
    "context_menu": "Right-click blocked",
    "devtools_shortcut": "Developer tools shortcut",
    "print_screen": "Screenshot key",
    "multiple_displays": "Additional display connected",
    "fullscreen_unavailable": "Fullscreen not supported",
    "extra_person": "Another person in view",
    "phone_detected": "Phone in view",
    "face_absent": "Candidate not visible on camera",
    "other_voice": "Speech while the candidate's lips were not moving",
    "camera_blocked": "Camera covered or too dark",
    "camera_frozen": "Camera image frozen",
    "background_sound": "Music or other sound playing nearby",
    "text_injected": "Text inserted without typing",
    "face_mismatch": "Different person on camera",
    "voice_mismatch": "Answer in a different voice",
    "book_detected": "Book or notes in view",
    "virtual_device": "Virtual camera or microphone",
    "reading_pattern": "Eye movements like reading",
    "looking_away": "Looked away from the interview screen",
}


def is_major(event_types: Iterable[str]) -> bool:
    return any(t in MAJOR_EVENTS for t in event_types)


def summarize(events: list[dict], vision: Optional[dict] = None, ended_early: bool = False) -> dict:
    """Integrity summary for the report.

    ``events``: rows with ``event_type``, ``duration_seconds``, ``details``.
    One "episode" of leaving may carry several types (blur + tab hidden +
    fullscreen exit fire together); it is stored as one row whose primary
    type is major, so ``violations`` counts episodes, not browser events.
    """
    counts: dict[str, int] = {}
    violations = 0
    time_away = 0.0
    for event in events:
        kind = event.get("event_type")
        counts[kind] = counts.get(kind, 0) + 1
        if kind in MAJOR_EVENTS:
            violations += 1
        if kind in LEAVE_EVENTS:
            time_away += float(event.get("duration_seconds") or 0)

    multiple_faces = int((vision or {}).get("multipleFaceEvents") or 0)
    low_presence = int((vision or {}).get("lowPresenceAnswers") or 0)
    # Gaze estimation is approximate: looking_away is reported on its own and
    # never raises the integrity level by itself.
    gaze_warnings = counts.get("looking_away", 0)
    minor = sum(n for kind, n in counts.items() if kind in MINOR_EVENTS and kind != "looking_away")

    identity = sum(n for kind, n in counts.items() if kind in SERVER_EVENTS)
    malpractice = sum(n for kind, n in counts.items() if kind in MALPRACTICE_EVENTS)
    if ended_early or violations >= 3 or multiple_faces >= 2 or identity:
        level = "flagged"
    elif violations or minor or multiple_faces or low_presence:
        level = "minor"
    else:
        level = "clean"

    return {
        "level": level,
        "violations": violations,
        "time_away_seconds": round(time_away, 1),
        "gaze_warnings": gaze_warnings,
        "malpractice_events": malpractice,
        "identity_events": identity,
        "counts": counts,
        "multiple_face_events": multiple_faces,
        "low_presence_answers": low_presence,
        "ended_early": bool(ended_early),
    }
