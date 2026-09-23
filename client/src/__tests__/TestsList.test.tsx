import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import TestsList from '@/pages/admin/tests/List';
import type { AdminTestListItem } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      tests: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        publish: vi.fn(),
        unpublish: vi.fn(),
      },
      uploads: { upload: vi.fn() },
    },
  };
});

const sample: AdminTestListItem = {
  id: 't1',
  title: 'Algebra Midterm',
  status: 'PUBLISHED',
  defaultNegativeMarks: 0.25,
  sectionCount: 3,
  questionCount: 12,
  totalDurationSec: 2700,
  totalMarks: 100,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/admin/tests']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/admin/tests" element={<TestsList />} />
          <Route path="/admin/tests/new" element={<h1>New test builder</h1>} />
          <Route path="/admin/tests/:id/edit" element={<h1>Edit test builder</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TestsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tests returned by the API', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [sample] });
    renderList();

    expect(await screen.findByRole('link', { name: 'Algebra Midterm' })).toHaveAttribute(
      'href',
      '/admin/tests/t1/edit',
    );
    // "Published" also appears as a status-filter option, so scope the badge.
    expect(screen.getByText('Published', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText(/12 questions/)).toBeInTheDocument();
  });

  it('shows the empty state with a create CTA when there are no tests', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [] });
    renderList();

    expect(await screen.findByText('No tests yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first test' })).toHaveAttribute(
      'href',
      '/admin/tests/new',
    );
  });

  it('confirms before deleting a test', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [sample] });
    vi.mocked(api.tests.remove).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Delete test' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete test' }));
    await waitFor(() => expect(api.tests.remove).toHaveBeenCalledWith('t1'));
  });

  it('filters tests client-side by title search and status', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({
      tests: [
        { ...sample, id: 't1', title: 'Algebra Midterm', status: 'PUBLISHED' },
        { ...sample, id: 't2', title: 'Physics Quiz', status: 'DRAFT' },
      ],
    });
    renderList();

    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Search tests'), 'physics');
    expect(screen.getByRole('link', { name: 'Physics Quiz' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Algebra Midterm' })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search tests'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PUBLISHED');
    expect(screen.getByRole('link', { name: 'Algebra Midterm' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Physics Quiz' })).not.toBeInTheDocument();
  });

  it('shows a no-match empty state when filters exclude every test and clears on demand', async () => {
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [sample] });
    renderList();

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Status'), 'ARCHIVED');

    expect(await screen.findByText('No tests match your filters.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Algebra Midterm' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('link', { name: 'Algebra Midterm' })).toBeInTheDocument();
  });
});
