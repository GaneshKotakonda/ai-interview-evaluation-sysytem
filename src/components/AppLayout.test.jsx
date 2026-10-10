// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AppLayout from './AppLayout';

vi.mock('./Sidebar', () => ({ default: () => <nav>Sidebar</nav> }));
vi.mock('./Navbar', () => ({ default: () => <header>Top bar</header> }));
afterEach(cleanup);

function open(path) {
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route element={<AppLayout />}><Route path="*" element={<p>Page</p>} /></Route>
  </Routes></MemoryRouter>);
}

it('hides the sidebar and top bar during an interview or Arena game', () => {
  for (const path of ['/interview', '/arena/play']) {
    open(path);
    expect(screen.getByText('Page')).toBeInTheDocument();
    expect(screen.queryByText('Sidebar')).not.toBeInTheDocument();
    expect(screen.queryByText('Top bar')).not.toBeInTheDocument();
    cleanup();
  }
  open('/dashboard');
  expect(screen.getByText('Sidebar')).toBeInTheDocument();
});
