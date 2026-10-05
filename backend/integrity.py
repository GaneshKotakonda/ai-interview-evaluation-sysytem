"""Interview integrity (proctoring) rules. Pure functions, unit-testable.

What a web browser can observe — and therefore what this records:
  * the candidate leaving the interview: exiting fullscreen, switching tab,
    or giving focus to another window or application;
  * blocked copy / paste / right-click and suspicious shortcuts;
  * a second display connected at the start (Chromium browsers);
  * from the camera: extra faces and time out of frame.

A browser cannot list background applications or see other devices, so
those are deliberately not claimed. Integrity is reported next to the
score and never changes the competence score itself; only an interview
ended early scores its unanswered questions as 0.
"""
from typing import Iterable, Optional

# Leaving the interview window: these count towards the violation limit.
MAJOR_EVENTS = {"fullscreen_exit", "tab_hidden", "window_blur"}
# Blocked or suspicious actions: logged, shown in the report, not counted.
MINOR_EVENTS = {"paste_blocked", "copy_blocked", "context_menu", "devtools_shortcut",
                "print_screen", "multiple_displays", "fullscreen_unavailable"}
EVENT_TYPES = MAJOR_EVENTS | MINOR_EVENTS

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
            time_away += float(event.get("duration_seconds") or 0)

    multiple_faces = int((vision or {}).get("multipleFaceEvents") or 0)
    low_presence = int((vision or {}).get("lowPresenceAnswers") or 0)
    minor = sum(n for kind, n in counts.items() if kind in MINOR_EVENTS)

    if ended_early or violations >= 3 or multiple_faces >= 2:
        level = "flagged"
    elif violations or minor or multiple_faces or low_presence:
        level = "minor"
    else:
        level = "clean"

    return {
        "level": level,
        "violations": violations,
        "time_away_seconds": round(time_away, 1),
        "counts": counts,
        "multiple_face_events": multiple_faces,
        "low_presence_answers": low_presence,
        "ended_early": bool(ended_early),
    }
