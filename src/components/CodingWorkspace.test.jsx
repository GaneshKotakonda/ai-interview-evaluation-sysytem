// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CodingWorkspace from './CodingWorkspace';
import { createAnswerSignals } from '../services/malpracticeSignals';

const { api, editor } = vi.hoisted(() => ({
  api: { getCodingLanguages: vi.fn(), runCode: vi.fn() },
  editor: { props: null },
}));
vi.mock('../services/api', () => ({ api }));
vi.mock('./CodeEditor', () => ({
  default: (props) => {
    editor.props = props;
    return <textarea aria-label="Code editor" value={props.value} onChange={(event) => props.onChange(event.target.value)} />;
  },
}));

const question = {
  index: 2,
  coding: {
    title: 'Two Sum', difficulty: 'easy', tags: ['arrays'], statement: 'Find two numbers.', input_format: 'n, values, target',
    output_format: 'two indices', constraints: ['2 <= n'], hidden_tests: 5, minutes: 20, complexity: 'O(n)',
    examples: [{ input: '4\n2 7 11 15\n9\n', expected: '0 1', explanation: '2 + 7 = 9' }],
    starter_code: { python: '# python starter', cpp: '// cpp starter' },
  },
};

beforeEach(() => {
  localStorage.clear();
  api.getCodingLanguages.mockResolvedValue([{ id: 'python', label: 'Python 3' }, { id: 'cpp', label: 'C++17' }]);
});
afterEach(cleanup);

it('shows the problem, runs the examples and submits the chosen language', async () => {
  api.runCode.mockResolvedValue({ compiled: true, results: [{ status: 'wrong_answer', time_ms: 12, stdout: '1 0', expected: '0 1', custom: false }], runs_left: 39 });
  const onSubmit = vi.fn();
  render(<CodingWorkspace interviewId="iv" question={question} onSubmit={onSubmit} />);
  expect(screen.getByRole('heading', { name: 'Two Sum' })).toBeInTheDocument();
  expect(screen.getByText(/5 hidden tests/)).toBeInTheDocument();
  expect(screen.getByLabelText('Code editor')).toHaveValue('# python starter');
  await screen.findByRole('option', { name: 'C++17' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cpp' } });
  expect(screen.getByLabelText('Code editor')).toHaveValue('// cpp starter');
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'int main(){}' } });
  fireEvent.click(screen.getByRole('button', { name: /Run/ }));
  expect(await screen.findByText('0 of 1 examples passed')).toBeInTheDocument();
  expect(screen.getByText('Wrong answer')).toBeInTheDocument();
  expect(api.runCode).toHaveBeenCalledWith('iv', expect.objectContaining({ language: 'cpp', code: 'int main(){}', customInput: null }));
  fireEvent.click(screen.getByRole('button', { name: /Submit solution/ }));
  expect(onSubmit).toHaveBeenCalledWith({ language: 'cpp', code: 'int main(){}' });
  // Drafts survive a reload.
  expect(localStorage.getItem('vpl-draft:iv:2:cpp')).toBe('int main(){}');
});

it('reports code that appears without typing', async () => {
  const signals = createAnswerSignals({ voiceMode: false, now: 0 });
  const onInjected = vi.fn();
  render(<CodingWorkspace interviewId="iv" question={question} onSubmit={vi.fn()} signals={signals} onInjected={onInjected} />);
  editor.props.onActivity({ typed: 12, inserted: 0 });
  editor.props.onActivity({ typed: 0, inserted: 300 });
  await waitFor(() => expect(onInjected).toHaveBeenCalledWith(300));
  expect(signals.summary(312).typing).toEqual(expect.objectContaining({ keystrokes: 12, largest_insert: 300 }));
});

const functionQuestion = {
  index: 3,
  coding: {
    title: 'Two Sum', difficulty: 'easy', tags: ['arrays'], statement: 'Find two numbers.', mode: 'function',
    signature: { method: 'twoSum', params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'long' }], returns: 'int[]' },
    input_format: 'nums: the array. target: the sum.', output_format: 'The two indices.', constraints: [], hidden_tests: 5, minutes: 20,
    examples: [{ args: [{ name: 'nums', value: '[2,7,11,15]' }, { name: 'target', value: '9' }], input: '4\n2 7 11 15\n9\n', expected: '0 1', expected_display: '[0,1]' }],
    starter_code: { python: 'class Solution:\n    def twoSum(self, nums, target):\n        pass\n' },
  },
};

it('shows a function-style problem and runs the candidate\'s own arguments', async () => {
  api.runCode.mockResolvedValue({
    compiled: true, runs_left: 38,
    results: [
      { status: 'passed', time_ms: 9, stdout: '[0,1]', expected: '[0,1]', printed: '', custom: false },
      { status: 'ran', time_ms: 8, stdout: '[1,2]', expected: null, printed: 'debug 3', custom: true },
    ],
  });
  render(<CodingWorkspace interviewId="iv" question={functionQuestion} onSubmit={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Parameters' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Returns' })).toBeInTheDocument();
  expect(screen.getByText(/nothing to print/)).toBeInTheDocument();
  expect(screen.getByText(/nums = \[2,7,11,15\]/)).toBeInTheDocument();
  expect(screen.getByText('[0,1]')).toBeInTheDocument();
  expect(screen.getByLabelText('Code editor').value).toContain('def twoSum');

  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByLabelText('Your value for nums')).toHaveValue('[2,7,11,15]');
  fireEvent.change(screen.getByLabelText('Your value for nums'), { target: { value: '[1,5,3]' } });
  fireEvent.change(screen.getByLabelText('Your value for target'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: /Run/ }));
  expect(await screen.findByText('1 of 1 examples passed')).toBeInTheDocument();
  expect(api.runCode).toHaveBeenCalledWith('iv', expect.objectContaining({ customArgs: { nums: '[1,5,3]', target: '8' } }));
  expect(api.runCode.mock.calls.at(-1)[1]).not.toHaveProperty('customInput');
  expect(screen.getAllByText('Returned')).toHaveLength(2);
  expect(screen.getByText('Printed (not graded)')).toBeInTheDocument();
  expect(screen.getByText('debug 3')).toBeInTheDocument();
});
