import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import TestBuilder from '@/pages/admin/tests/Builder';
import type { AdminTest } from '@/types';

/*
 * The Builder uses `useBlocker`, which needs a data router. Data-router
 * navigation is broken under jsdom (undici rejects jsdom's AbortSignal), so
 * tests run on MemoryRouter with `useBlocker` stubbed — the discard/confirm
 * UI is still exercised via the Discard button.
 */
const { blocker } = vi.hoisted(() => ({
  blocker: { current: { state: 'unblocked' } as Record<string, unknown> },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useBlocker: (() => blocker.current) as unknown as typeof actual.useBlocker,
  };
});

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

const sampleTest: AdminTest = {
  id: 't1',
  title: 'Algebra Midterm',
  description: '',
  status: 'DRAFT',
  defaultNegativeMarks: 0,
  shuffleQuestions: true,
  shuffleOptions: true,
  sections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderBuilder(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/admin/tests" element={<h1>Tests list</h1>} />
          <Route path="/admin/tests/new" element={<TestBuilder />} />
          <Route path="/admin/tests/:id/edit" element={<TestBuilder />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TestBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blocker.current = { state: 'unblocked' };
  });

  it('creates a test and navigates to its edit page', async () => {
    vi.mocked(api.tests.create).mockResolvedValue({ ...sampleTest, title: 'New test' });
    vi.mocked(api.tests.get).mockResolvedValue({ ...sampleTest, title: 'New test' });
    const user = userEvent.setup();
    renderBuilder('/admin/tests/new');

    await user.type(screen.getByLabelText('Title'), 'New test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.tests.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New test', defaultNegativeMarks: 0 }),
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Edit test' })).toBeInTheDocument();
  });

  it('loads an existing test and saves changes in place', async () => {
    vi.mocked(api.tests.get).mockResolvedValue(sampleTest);
    vi.mocked(api.tests.update).mockResolvedValue({ ...sampleTest, title: 'Algebra Final' });
    const user = userEvent.setup();
    renderBuilder('/admin/tests/t1/edit');

    const title = await screen.findByLabelText('Title');
    await waitFor(() => expect(title).toHaveValue('Algebra Midterm'));

    await user.clear(title);
    await user.type(title, 'Algebra Final');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.tests.update).toHaveBeenCalledWith('t1', expect.objectContaining({ title: 'Algebra Final' })),
    );
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument();
  });

  it('confirms and reverts unsaved changes when Discard is pressed', async () => {
    vi.mocked(api.tests.get).mockResolvedValue(sampleTest);
    const user = userEvent.setup();
    renderBuilder('/admin/tests/t1/edit');

    const title = await screen.findByLabelText('Title');
    await waitFor(() => expect(title).toHaveValue('Algebra Midterm'));

    await user.type(title, '!');
    await user.click(screen.getByRole('button', { name: 'Discard' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Discard changes?' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Algebra Midterm'));
  });
});
