import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';

// -------------------------------------------------------------
// VPL code editor (CodeMirror 6)
// -------------------------------------------------------------
// Syntax highlighting, auto-indent, bracket matching and Tab indentation.
// Paste and drag-and-drop are blocked (code must be typed). Every change is
// reported to `onActivity({ typed, inserted })`: `typed` counts characters
// entered by typing (or editor completion), `inserted` is the size of any
// other insertion, so text that appears without being typed is noticed.
const LANGUAGES = { python, javascript, cpp, java };
// Marks programmatic replacements so they are not reported as insertions.
const external = Annotation.define();

const theme = EditorView.theme({
  '&': { fontSize: '13.5px', height: '100%', backgroundColor: 'var(--editor-bg, #fbfaf7)' },
  '.cm-scroller': { fontFamily: '"Geist Mono", ui-monospace, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#9a958a' },
  '&.cm-focused': { outline: 'none' },
});

export default function CodeEditor({ value, language, onChange, onActivity, readOnly = false, label = 'Code editor' }) {
  const host = useRef(null);
  const view = useRef(null);
  const languageSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const callbacks = useRef({ onChange, onActivity });
  callbacks.current = { onChange, onActivity };

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          theme,
          languageSlot.current.of((LANGUAGES[language] || python)()),
          readOnlySlot.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorView.domEventHandlers({
            paste: (event) => { event.preventDefault(); return true; },
            drop: (event) => { event.preventDefault(); return true; },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            update.transactions.forEach((tr) => {
              if (!tr.docChanged || tr.annotation(external)) return;
              let inserted = 0;
              tr.changes.iterChanges((_a, _b, _c, _d, text) => { inserted += text.length; });
              const typed = tr.isUserEvent('input.type') || tr.isUserEvent('input.complete')
                || tr.isUserEvent('delete') || tr.isUserEvent('input.indent') || tr.isUserEvent('move');
              callbacks.current.onActivity?.(typed ? { typed: inserted, inserted: 0 } : { typed: 0, inserted });
            });
            callbacks.current.onChange?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
    // The editor is created once; props below are applied through effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: languageSlot.current.reconfigure((LANGUAGES[language] || python)()) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  // A new value from outside (language switch, restored draft) replaces the text.
  useEffect(() => {
    const current = view.current?.state.doc.toString();
    if (view.current && value !== current) {
      view.current.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: external.of(true),
      });
    }
  }, [value]);

  return <div ref={host} className="h-full min-h-[320px] overflow-hidden" data-testid="code-editor" />;
}
