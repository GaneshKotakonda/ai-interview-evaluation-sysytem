// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import Arena from './Arena';
afterEach(cleanup);
function Destination() { return <pre data-testid="config">{JSON.stringify(useLocation().state)}</pre>; }
function open(path = '/arena', state) {
  render(<MemoryRouter initialEntries={[{ pathname: path, state }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/arena" element={<Arena />} /><Route path="/arena/play" element={<Destination />} />
  </Routes></MemoryRouter>);
}
it('offers practice areas and passes the selected config to gameplay', () => {
  open();
  expect(screen.getAllByRole('radio')).toHaveLength(7);
  fireEvent.click(screen.getByRole('radio', { name: 'Frontend / React' }));
  expect(screen.getByRole('radio', { name: 'Frontend / React' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Start Arena Challenge' }));
  expect(JSON.parse(screen.getByTestId('config').textContent)).toMatchObject({ arenaConfig: { role_title: 'Frontend Developer', topic: 'React', interview_mode: 'game' } });
});
it('lists what the Arena is for and sends the ranking category and coding choice', () => {
  open();
  expect(screen.getByRole('heading', { name: 'What the Arena is for' })).toBeInTheDocument();
  expect(screen.getByText('Category ranks')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'SQL / Database' }));
  expect(screen.getByRole('checkbox', { name: /Include coding challenges/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Data Structures & Algorithms' }));
  expect(screen.getByRole('checkbox', { name: /Include coding challenges/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Start Arena Challenge' }));
  expect(JSON.parse(screen.getByTestId('config').textContent).arenaConfig).toMatchObject({ category: 'dsa', coding: true });
});
it('requires a nonblank custom topic and preserves a custom description', () => {
  open();
  fireEvent.click(screen.getByRole('radio', { name: 'Custom Topic' }));
  expect(screen.getByRole('button', { name: 'Start Arena Challenge' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Custom topic'), { target: { value: '  React Performance Optimization  ' } });
  fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Focus on profiling' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start Arena Challenge' }));
  expect(JSON.parse(screen.getByTestId('config').textContent).arenaConfig).toMatchObject({ topic: 'React Performance Optimization', job_description: 'Practice React Performance Optimization interview questions. Focus on profiling', custom_description: 'Focus on profiling', interview_mode: 'game' });
});
