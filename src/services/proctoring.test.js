// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startProctoring } from './proctoring';

// jsdom has no Fullscreen API; simulate it.
let fullscreenElement = null;
let visibility = 'visible';
let focused = true;

beforeEach(() => {
  fullscreenElement = document.documentElement;
  visibility = 'visible';
  focused = true;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  document.documentElement.requestFullscreen = vi.fn();
  document.hasFocus = () => focused;
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const onLeave = vi.fn();
  const onReturn = vi.fn();
  const onMinor = vi.fn();
  const proctor = startProctoring({ onLeave, onReturn, onMinor, context: () => ({ question_index: 3, part: 1, at: 12 }) });
  return { proctor, onLeave, onReturn, onMinor };
}

describe('proctoring', () => {
  it('merges the events of one switch-away into a single episode', () => {
    const { proctor, onLeave, onReturn } = setup();
    focused = false;
    window.dispatchEvent(new Event('blur'));
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onLeave.mock.calls[0][0]).toMatchObject({ type: 'window_blur', question_index: 3, part: 1, at: 12 });
    expect(proctor.isAway()).toBe(true);

    // Back in the tab and focused, but not yet fullscreen: still away.
    visibility = 'visible';
    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(onReturn).not.toHaveBeenCalled();

    fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(onReturn.mock.calls[0][0].types.sort()).toEqual(['fullscreen_exit', 'tab_hidden', 'window_blur']);
    expect(onReturn.mock.calls[0][0].duration).toBeGreaterThanOrEqual(0);
    proctor.stop();
  });

  it('blocks paste and copy, logging each kind at most once per 5 seconds', () => {
    const { proctor, onMinor } = setup();
    const paste = new Event('paste', { cancelable: true });
    document.dispatchEvent(paste);
    document.dispatchEvent(new Event('paste', { cancelable: true }));
    document.dispatchEvent(new Event('copy', { cancelable: true }));
    expect(paste.defaultPrevented).toBe(true);
    expect(onMinor.mock.calls.map(([event]) => event.type)).toEqual(['paste_blocked', 'copy_blocked']);
    proctor.stop();
  });

  it('flags developer-tools shortcuts and stops listening after stop()', () => {
    const { proctor, onMinor, onLeave } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'I', ctrlKey: true, shiftKey: true, cancelable: true }));
    expect(onMinor.mock.calls[0][0].type).toBe('devtools_shortcut');
    proctor.stop();
    window.dispatchEvent(new Event('blur'));
    expect(onLeave).not.toHaveBeenCalled();
  });
});
