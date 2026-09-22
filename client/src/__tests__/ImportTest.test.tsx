import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/api/client';
import TestsList from '@/pages/admin/tests/List';
import type { AdminTest, ImportSummary } from '@/types';

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
      imports: {
        validate: vi.fn(),
        confirm: vi.fn(),
      },
    },
  };
});

const summary: ImportSummary = {
  title: 'Imported Test',
  sectionCount: 2,
  questionCount: 10,
  totalDurationSec: 1800,
  totalMarks: 50,
};

const importedTest: AdminTest = {
  id: 't9',
  title: 'Imported Test',
  description: '',
  status: 'DRAFT',
  defaultNegativeMarks: 0,
  shuffleQuestions: true,
  shuffleOptions: true,
  sections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VALID_JSON = '{"title":"Imported Test","sections":[]}';

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

async function openImportModal(user: ReturnType<typeof userEvent.setup>) {
  const buttons = await screen.findAllByRole('button', { name: 'Import test' });
  await user.click(buttons[0]);
  expect(await screen.findByRole('heading', { name: 'Import test' })).toBeInTheDocument();
}

describe('Test import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.tests.list).mockResolvedValue({ tests: [] });
  });

  it('opens the modal with a paste field and a Validate button', async () => {
    const user = userEvent.setup();
    renderList();
    await openImportModal(user);

    expect(screen.getByLabelText('Test JSON')).toBeInTheDocument();
    expect(screen.getByText(/Paste the exported test JSON/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows the preview summary and round-trips the hash to confirm and navigates on success', async () => {
    vi.mocked(api.imports.validate).mockResolvedValue({ hash: 'h1', summary });
    vi.mocked(api.imports.confirm).mockResolvedValue(importedTest);
    const user = userEvent.setup();
    renderList();
    await openImportModal(user);

    fireEvent.change(screen.getByLabelText('Test JSON'), { target: { value: VALID_JSON } });
    await user.click(screen.getByRole('button', { name: 'Validate' }));

    expect(await screen.findByRole('heading', { name: 'Preview import' })).toBeInTheDocument();
    expect(screen.getByText('Imported Test')).toBeInTheDocument();
    expect(screen.getByText('2 sections')).toBeInTheDocument();
    expect(screen.getByText('10 questions')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText(/imports as a draft/i)).toBeInTheDocument();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import test' }));
    await waitFor(() => expect(api.imports.confirm).toHaveBeenCalledWith({ content: VALID_JSON, hash: 'h1' }));

    expect(await screen.findByRole('heading', { name: 'Edit test builder' })).toBeInTheDocument();
  });

  it('surfaces INVALID_JSON as an inline error on the field', async () => {
    vi.mocked(api.imports.validate).mockRejectedValue(
      new ApiError(400, { error: { code: 'INVALID_JSON', message: 'Invalid JSON: unexpected token' } }),
    );
    const user = userEvent.setup();
    renderList();
    await openImportModal(user);

    await user.type(screen.getByLabelText('Test JSON'), 'not json');
    await user.click(screen.getByRole('button', { name: 'Validate' }));

    const field = await screen.findByLabelText('Test JSON');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Invalid JSON: unexpected token')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Preview import' })).not.toBeInTheDocument();
  });

  it('surfaces VALIDATION_ERROR details as a message list', async () => {
    vi.mocked(api.imports.validate).mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please fix the highlighted problems and try again.',
          details: [{ field: 'sections.0.title', message: 'Title is required' }],
        },
      }),
    );
    const user = userEvent.setup();
    renderList();
    await openImportModal(user);

    fireEvent.change(screen.getByLabelText('Test JSON'), { target: { value: VALID_JSON } });
    await user.click(screen.getByRole('button', { name: 'Validate' }));

    expect(await screen.findByText('Please fix the highlighted problems and try again.')).toBeInTheDocument();
    expect(screen.getByText('sections.0.title')).toBeInTheDocument();
    expect(screen.getByText(/Title is required/)).toBeInTheDocument();
  });

  it('shows a stale banner on 409 and Back returns to editing the JSON', async () => {
    vi.mocked(api.imports.validate).mockResolvedValue({ hash: 'h1', summary });
    vi.mocked(api.imports.confirm).mockRejectedValue(
      new ApiError(409, { error: { code: 'IMPORT_STALE', message: 'This preview has expired.' } }),
    );
    const user = userEvent.setup();
    renderList();
    await openImportModal(user);

    fireEvent.change(screen.getByLabelText('Test JSON'), { target: { value: VALID_JSON } });
    await user.click(screen.getByRole('button', { name: 'Validate' }));
    await screen.findByRole('heading', { name: 'Preview import' });

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import test' }));
    expect(await screen.findByText(/preview has expired/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Import test' })).toBeInTheDocument();
    expect(screen.getByLabelText('Test JSON')).toHaveValue(VALID_JSON);
  });
});