import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SelectField } from '@/components/ui/SelectField';
import { TextareaField } from '@/components/ui/TextareaField';
import { resourceKind } from '@/utils/resourceKind';
import type { CreateResourceInput, ErrorDetail, Resource, ResourceKind } from '@/types';

const RESOURCES_KEY = ['admin', 'resources'];

const KIND_OPTIONS: { value: ResourceKind; label: string }[] = [
  { value: 'PDF', label: 'PDF' },
  { value: 'ZIP', label: 'ZIP' },
  { value: 'IMAGE', label: 'Image' },
  { value: 'OTHER', label: 'Other' },
];

function parseDetails(details: unknown): ErrorDetail[] {
  if (!Array.isArray(details)) return [];
  return details.filter(
    (item): item is ErrorDetail =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ErrorDetail).field === 'string' &&
      typeof (item as ErrorDetail).message === 'string',
  );
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface AddResourceModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddResourceModal({ onClose, onCreated }: AddResourceModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ResourceKind>('PDF');
  const [driveUrl, setDriveUrl] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: CreateResourceInput) => api.admin.resources.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESOURCES_KEY });
      onCreated();
    },
    onError: (err) => {
      setFormError(null);
      if (err instanceof ApiError) {
        const details = parseDetails(err.details);
        const mapped: Record<string, string | undefined> = {};
        for (const detail of details) {
          if (detail.field === 'title') mapped.title = detail.message;
          if (detail.field === 'description') mapped.description = detail.message;
          if (detail.field === 'kind') mapped.kind = detail.message;
          if (detail.field === 'driveUrl') mapped.driveUrl = detail.message;
        }
        if (Object.keys(mapped).length > 0) {
          setFieldErrors((prev) => ({ ...prev, ...mapped }));
          focusFirstInvalid(mapped);
          return;
        }
      }
      setFormError('Something went wrong. Please try again.');
    },
  });

  function focusFirstInvalid(errors: Record<string, string | undefined>) {
    const order = ['title', 'description', 'kind', 'drive-url'];
    for (const id of order) {
      if (errors[id]) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const errors: Record<string, string | undefined> = {};
    if (title.trim() === '') errors.title = 'Title is required.';
    if (description.length > 500) errors.description = 'Description must be 500 characters or fewer.';
    if (!isValidUrl(driveUrl)) errors['drive-url'] = 'Enter a valid link starting with http or https.';
    setFieldErrors(errors);
    focusFirstInvalid(errors);
    if (Object.values(errors).some(Boolean)) return;

    create.mutate({ title: title.trim(), description: description.trim() || undefined, kind, driveUrl: driveUrl.trim() });
  }

  function handleClose() {
    if (create.isPending) return;
    onClose();
  }

  return (
    <Modal
      open
      onClose={handleClose}
      id="add-resource-modal-title"
      title="Add resource"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={handleSubmit}>
            Add resource
          </Button>
        </>
      }
    >
      {formError && (
        <div className="form-error" role="alert">
          {formError}
        </div>
      )}
      <Field
        id="title"
        label="Title"
        placeholder="e.g. Optics formula sheet"
        required
        maxLength={120}
        value={title}
        error={fieldErrors.title}
        disabled={create.isPending}
        onChange={(event) => {
          setTitle(event.target.value);
          setFieldErrors((prev) => ({ ...prev, title: undefined }));
        }}
      />
      <TextareaField
        id="description"
        label="Short description"
        rows={3}
        maxLength={500}
        hint="Optional — shown to students on the resource card."
        value={description}
        error={fieldErrors.description}
        disabled={create.isPending}
        onChange={(event) => {
          setDescription(event.target.value);
          setFieldErrors((prev) => ({ ...prev, description: undefined }));
        }}
      />
      <SelectField
        id="kind"
        label="Kind"
        value={kind}
        error={fieldErrors.kind}
        disabled={create.isPending}
        onChange={(event) => {
          setKind(event.target.value as ResourceKind);
          setFieldErrors((prev) => ({ ...prev, kind: undefined }));
        }}
      >
        {KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
      <Field
        id="drive-url"
        label="Drive link"
        type="url"
        placeholder="https://drive.google.com/…"
        hint="Students open this link in a new tab."
        value={driveUrl}
        error={fieldErrors['drive-url']}
        disabled={create.isPending}
        onChange={(event) => {
          setDriveUrl(event.target.value);
          setFieldErrors((prev) => ({ ...prev, 'drive-url': undefined }));
        }}
      />
    </Modal>
  );
}

export default function ResourceList() {
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Resource | null>(null);

  const list = useQuery({ queryKey: RESOURCES_KEY, queryFn: api.admin.resources.list });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: RESOURCES_KEY });

  const remove = useMutation({
    mutationFn: (resource: Resource) => api.admin.resources.remove(resource.id),
    onSuccess: () => {
      setPendingDelete(null);
      setBanner({ type: 'success', text: 'Resource deleted.' });
      invalidate();
    },
    onError: (err) => {
      setPendingDelete(null);
      setBanner({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      });
    },
  });

  function handleDeleteClose() {
    if (remove.isPending) return;
    setPendingDelete(null);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Resources</h1>
          <p className="page-sub">Share study material with students — PDFs, archives, images, or links.</p>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            Add resource
          </Button>
        </div>
      </div>

      {banner && (
        <div className={`banner ${banner.type === 'success' ? 'banner--success' : 'banner--error'}`} role="status">
          <p className="banner__text">{banner.text}</p>
          <button type="button" className="banner__close" aria-label="Dismiss message" onClick={() => setBanner(null)}>
            ✕
          </button>
        </div>
      )}

      {list.isPending && (
        <div className="tests-list" role="status" aria-live="polite">
          <span className="sr-only">Loading resources…</span>
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
        </div>
      )}

      {list.isError && <ErrorState onRetry={() => list.refetch()} />}

      {list.isSuccess && list.data.resources.length === 0 && (
        <EmptyState
          title="No resources yet."
          description="Share study material like PDFs, question banks, or images. Students will see them under Resources."
          action={
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Add your first resource
            </Button>
          }
        />
      )}

      {list.isSuccess && list.data.resources.length > 0 && (
        <div className="tests-list">
          {list.data.resources.map((resource) => {
            const kind = resourceKind(resource.kind);
            return (
              <Card key={resource.id} className="test-row">
                <div className="test-row__main">
                  <div className="test-row__head">
                    <span className="test-row__title">{resource.title}</span>
                    <Badge variant={kind.variant}>{kind.label}</Badge>
                  </div>
                  <p className="test-row__meta">{resource.description || 'No description.'}</p>
                </div>
                <div className="test-row__actions">
                  <a
                    className="test-row__meta"
                    style={{ color: 'var(--ink-muted)', textDecoration: 'underline' }}
                    href={resource.driveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open link
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={remove.isPending && remove.variables?.id === resource.id}
                    onClick={() => setPendingDelete(resource)}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddResourceModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            setBanner({ type: 'success', text: 'Resource added. Students can now see it.' });
          }}
        />
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={handleDeleteClose}
        id="delete-resource-modal-title"
        title="Delete resource"
        footer={
          <>
            <Button variant="secondary" onClick={handleDeleteClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete)}
            >
              Delete resource
            </Button>
          </>
        }
      >
        <p>
          Delete <strong>{pendingDelete?.title}</strong>? Students will no longer see it. This can't be undone.
        </p>
      </Modal>
    </>
  );
}