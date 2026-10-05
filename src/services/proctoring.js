// -------------------------------------------------------------
// Interview proctoring (integrity) in the browser
// -------------------------------------------------------------
// Detects the candidate LEAVING the interview — exiting fullscreen,
// switching tab, or giving focus to another window or application — and
// blocks copy / paste / right-click and common inspection shortcuts.
//
// A web page cannot see background applications or other devices; it can
// only see that it lost focus, visibility or fullscreen, which is exactly
// what using another app or window requires.
//
// Several browser events fire for one action (switching apps fires blur,
// then visibility hidden, then fullscreen exit), so they are merged into a
// single "episode" that ends when the candidate is back: focused, visible
// and (where supported) in fullscreen.

let sequence = 0;
const newId = () => `${Date.now().toString(36)}-${(sequence += 1)}-${Math.random().toString(36).slice(2, 7)}`;

export const fullscreenSupported = () => typeof document !== 'undefined'
  && Boolean(document.documentElement?.requestFullscreen) && document.fullscreenEnabled !== false;

export const isFullscreen = () => typeof document !== 'undefined' && Boolean(document.fullscreenElement);

export async function enterFullscreen() {
  if (!fullscreenSupported()) return false;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // Leaving fullscreen is best effort.
  }
}

// Chrome/Edge (Window Management API): true when more than one display is connected.
export const hasMultipleDisplays = () => typeof window !== 'undefined' && window.screen?.isExtended === true;

const BLOCKED_KEYS = (event) => {
  const key = (event.key || '').toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  if (key === 'f12' || (ctrl && event.shiftKey && ['i', 'j', 'c'].includes(key)) || (ctrl && key === 'u')) return 'devtools_shortcut';
  if (key === 'printscreen') return 'print_screen';
  return null;
};

/**
 * Start watching. Callbacks:
 *   onLeave(episode)   the candidate left the interview (counts as a violation)
 *   onReturn(episode)  they came back; episode.duration is filled in
 *   onMinor(event)     a blocked action (copy, paste, right-click, shortcut)
 * `context()` returns { question_index, part, at } for the event record.
 */
export function startProctoring({ onLeave, onReturn, onMinor, context = () => ({}) }) {
  let episode = null;
  const lastMinor = {};
  const needsFullscreen = fullscreenSupported();

  const isBack = () => document.visibilityState === 'visible'
    && (typeof document.hasFocus !== 'function' || document.hasFocus())
    && (!needsFullscreen || isFullscreen());

  const leave = (type) => {
    if (episode) {
      episode.types.add(type);
      return;
    }
    episode = { id: newId(), type, types: new Set([type]), startedAt: performance.now(), ...context() };
    onLeave?.(episode);
  };

  const maybeReturn = () => {
    if (!episode || !isBack()) return;
    const finished = {
      ...episode,
      types: [...episode.types],
      duration: Math.round((performance.now() - episode.startedAt) / 100) / 10,
    };
    episode = null;
    onReturn?.(finished);
  };

  const minor = (type, event) => {
    event?.preventDefault?.();
    const now = Date.now();
    if (lastMinor[type] && now - lastMinor[type] < 5000) return; // one log per type per 5 s
    lastMinor[type] = now;
    onMinor?.({ id: newId(), type, ...context() });
  };

  const handlers = {
    fullscreenchange: () => (isFullscreen() ? maybeReturn() : needsFullscreen && leave('fullscreen_exit')),
    visibilitychange: () => (document.visibilityState === 'hidden' ? leave('tab_hidden') : maybeReturn()),
    blur: () => leave('window_blur'),
    focus: () => maybeReturn(),
    copy: (event) => minor('copy_blocked', event),
    cut: (event) => minor('copy_blocked', event),
    paste: (event) => minor('paste_blocked', event),
    contextmenu: (event) => minor('context_menu', event),
    keydown: (event) => {
      const type = BLOCKED_KEYS(event);
      if (type) minor(type, event);
    },
  };

  document.addEventListener('fullscreenchange', handlers.fullscreenchange);
  document.addEventListener('visibilitychange', handlers.visibilitychange);
  window.addEventListener('blur', handlers.blur);
  window.addEventListener('focus', handlers.focus);
  ['copy', 'cut', 'paste', 'contextmenu', 'keydown'].forEach((name) => document.addEventListener(name, handlers[name], true));

  return {
    /** Re-check after the candidate pressed "Return to the interview". */
    check: maybeReturn,
    isAway: () => Boolean(episode),
    stop() {
      document.removeEventListener('fullscreenchange', handlers.fullscreenchange);
      document.removeEventListener('visibilitychange', handlers.visibilitychange);
      window.removeEventListener('blur', handlers.blur);
      window.removeEventListener('focus', handlers.focus);
      ['copy', 'cut', 'paste', 'contextmenu', 'keydown'].forEach((name) => document.removeEventListener(name, handlers[name], true));
    },
  };
}
