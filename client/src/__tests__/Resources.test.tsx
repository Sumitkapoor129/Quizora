import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import ResourceList from '@/pages/admin/resources/ResourceList';
import Resources from '@/pages/student/Resources';
import type { Resource } from '@/types';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      student: {
        ...actual.api.student,
        resources: vi.fn(),
      },
      admin: {
        ...actual.api.admin,
        resources: {
          list: vi.fn(),
          create: vi.fn(),
          remove: vi.fn(),
        },
      },
    },
  };
});

const pdf: Resource = {
  id: 'r1',
  title: 'Optics Formula Sheet',
  description: 'Key formulas for the midterm.',
  kind: 'PDF',
  driveUrl: 'https://drive.google.com/file/d/abc/view',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const image: Resource = {
  id: 'r2',
  title: 'Diagram Pack',
  kind: 'IMAGE',
  driveUrl: 'https://drive.google.com/file/d/def/view',
  createdAt: '2026-01-02T00:00:00.000Z',
};

function renderStudentResources() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Resources />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderAdminResources() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ResourceList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Student resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders preview cards with kind labels, descriptions, and external Open links', async () => {
    vi.mocked(api.student.resources).mockResolvedValue({ resources: [pdf, image] });
    renderStudentResources();

    expect(await screen.findByRole('heading', { name: 'Resources' })).toBeInTheDocument();
    // Waits for the query (headings render before data resolves).
    expect(await screen.findByText('Optics Formula Sheet')).toBeInTheDocument();
    expect(screen.getByText('Key formulas for the midterm.')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /^Open/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://drive.google.com/file/d/abc/view');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(links[0]).getByText('Opens in a new tab')).toBeInTheDocument();
  });

  it('shows the empty state when the instructor has not shared anything yet', async () => {
    vi.mocked(api.student.resources).mockResolvedValue({ resources: [] });
    renderStudentResources();

    expect(await screen.findByText('No resources yet.')).toBeInTheDocument();
    expect(screen.getByText('Study material will appear here when your instructor shares it.')).toBeInTheDocument();
  });
});

describe('Admin resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists resources with kind badges, one-line description fallback, and external link', async () => {
    vi.mocked(api.admin.resources.list).mockResolvedValue({ resources: [pdf, image] });
    renderAdminResources();

    expect(await screen.findByText('Optics Formula Sheet')).toBeInTheDocument();
    expect(screen.getByText('Key formulas for the midterm.')).toBeInTheDocument();
    // No-description rows show a quiet placeholder instead of an empty cell.
    expect(screen.getByText('No description.')).toBeInTheDocument();

    const openLinks = screen.getAllByRole('link', { name: /Open link/ });
    expect(openLinks[0]).toHaveAttribute('href', 'https://drive.google.com/file/d/abc/view');
    expect(openLinks[0]).toHaveAttribute('target', '_blank');
    expect(openLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens the add modal, validates fields, and does not send an invalid resource', async () => {
    vi.mocked(api.admin.resources.list).mockResolvedValue({ resources: [pdf] });
    const user = userEvent.setup();
    renderAdminResources();

    await user.click(await screen.findByRole('button', { name: 'Add resource' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add resource' }));

    expect(await within(dialog).findByText('Title is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid link starting with http or https.')).toBeInTheDocument();
    expect(api.admin.resources.create).not.toHaveBeenCalled();
  });

  it('creates a resource and shows the success banner', async () => {
    vi.mocked(api.admin.resources.list).mockResolvedValue({ resources: [] });
    vi.mocked(api.admin.resources.create).mockResolvedValue({ resource: pdf });
    const user = userEvent.setup();
    renderAdminResources();

    await user.click(await screen.findByRole('button', { name: 'Add your first resource' }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText('Title'), 'Optics Formula Sheet');
    await user.selectOptions(within(dialog).getByLabelText('Kind'), 'PDF');
    await user.type(
      within(dialog).getByLabelText('Drive link'),
      'https://drive.google.com/file/d/abc/view',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add resource' }));

    await waitFor(() =>
      expect(api.admin.resources.create).toHaveBeenCalledWith({
        title: 'Optics Formula Sheet',
        description: undefined,
        kind: 'PDF',
        driveUrl: 'https://drive.google.com/file/d/abc/view',
      }),
    );
    expect(await screen.findByText('Resource added. Students can now see it.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms before deleting and shows a success banner', async () => {
    vi.mocked(api.admin.resources.list).mockResolvedValue({ resources: [pdf] });
    vi.mocked(api.admin.resources.remove).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAdminResources();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Delete resource' })).toBeInTheDocument();
    expect(screen.getByText(/This can't be undone\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete resource' }));
    await waitFor(() => expect(api.admin.resources.remove).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('Resource deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delete resource' })).not.toBeInTheDocument();
  });

  it('cannot close the delete modal while the delete is pending', async () => {
    vi.mocked(api.admin.resources.list).mockResolvedValue({ resources: [pdf] });
    let resolveDelete: () => void = () => {};
    vi.mocked(api.admin.resources.remove).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const user = userEvent.setup();
    renderAdminResources();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete resource' }));
    await waitFor(() => expect(api.admin.resources.remove).toHaveBeenCalledWith('r1'));

    // Cancel is a no-op while the delete is in flight — closing would claim a
    // cancellation that never happened once the delete completes.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Escape is a no-op too; the backdrop/✕ route through the same `onClose`.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolveDelete();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});