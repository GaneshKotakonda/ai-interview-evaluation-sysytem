// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CodeEditor from './CodeEditor';

afterEach(cleanup);

it('renders CodeMirror with the code, a label, and blocks paste', () => {
  const onChange = vi.fn();
  const { rerender } = render(<CodeEditor value={'print("hi")'} language="python" onChange={onChange} />);
  const content = screen.getByRole('textbox', { name: 'Code editor' });
  expect(content).toHaveTextContent('print("hi")');
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  content.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  // A new value from outside (language switch) replaces the text without reporting typing.
  rerender(<CodeEditor value="int main() {}" language="cpp" onChange={onChange} />);
  expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveTextContent('int main() {}');
});
