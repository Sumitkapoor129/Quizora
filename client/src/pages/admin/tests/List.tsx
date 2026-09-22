import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import ImportTestModal from '@/pages/admin/tests/ImportTestModal';
import type { AdminTestListItem, TestStatus } from '@/types';

const TESTS_KEY = ['admin', 'tests'];

const STATUS_LABEL: Record<TestStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const STATUS_VARIANT: Record<TestStatus, BadgeVariant> = {
  DRAFT: 'default',
  PUBLISHED: 'success',
  ARCHIVED: 'default',
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatDuration(totalSec: number): string {
  const minutes = Math.round(totalSec / 60);
  return `${minutes} min`;
}

export default function TestsList() {
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminTestListItem | null>(null);
  const [pendingUnpublish, setPendingUnpublish] = useState<AdminTestListItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({ queryKey: TESTS_KEY, queryFn: api.tests.list });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: TESTS_KEY });
  const fail = (err: unknown) => setBanner(errorMessage(err));

  const publish = useMutation({
    mutationFn: (test: AdminTestListItem) => api.tests.publish(test.id),
    onSuccess: invalidate,
    onError: fail,
  });

  const unpublish = useMutation({
    mutationFn: (test: AdminTestListItem) => api.tests.unpublish(test.id),
    onSuccess: () => {
      setPendingUnpublish(null);
      invalidate();
    },
    onError: (err) => {
      setPendingUnpublish(null);
      fail(err);
    },
  });

  const remove = useMutation({
    mutationFn: (test: AdminTestListItem) => api.tests.remove(test.id),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
    onError: (err) => {
      setPendingDelete(null);
      fail(err);
    },
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Tests</h1>
          <p className="page-sub">Create, publish, and manage tests.</p>
        </div>
        <div className="page-header__actions">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import test
          </Button>
          <Link className="btn btn--primary btn--md" to="/admin/tests/new">
            Create test
          </Link>
        </div>
      </div>

      {banner && (
        <div className="banner banner--error" role="alert">
          <p className="banner__text">{banner}</p>
          <button type="button" className="banner__close" aria-label="Dismiss message" onClick={() => setBanner(null)}>
            ✕
          </button>
        </div>
      )}

      {list.isPending && (
        <div className="tests-list" role="status" aria-live="polite">
          <span className="sr-only">Loading tests…</span>
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
          <div className="skeleton-row" aria-hidden="true" />
        </div>
      )}

      {list.isError && <ErrorState onRetry={() => list.refetch()} />}

      {list.isSuccess && list.data.tests.length === 0 && (
        <EmptyState
          title="No tests yet."
          description="Create a test, add sections and questions, then publish it for students. Have an export? Import it instead."
          action={
            <div className="empty-state__actions">
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                Import test
              </Button>
              <Link className="btn btn--primary btn--md" to="/admin/tests/new">
                Create your first test
              </Link>
            </div>
          }
        />
      )}

      {list.isSuccess && list.data.tests.length > 0 && (
        <div className="tests-list">
          {list.data.tests.map((test) => (
            <Card key={test.id} className="test-row">
              <div className="test-row__main">
                <div className="test-row__head">
                  <Link className="test-row__title" to={`/admin/tests/${test.id}/edit`}>
                    {test.title}
                  </Link>
                  <Badge variant={STATUS_VARIANT[test.status]}>{STATUS_LABEL[test.status]}</Badge>
                </div>
                <p className="test-row__meta">
                  {plural(test.sectionCount, 'section')} · {plural(test.questionCount, 'question')} ·{' '}
                  {test.totalMarks} marks · {formatDuration(test.totalDurationSec)}
                </p>
              </div>
              <div className="test-row__actions">
                <Link className="btn btn--secondary btn--sm" to={`/admin/tests/${test.id}/edit`}>
                  Edit
                </Link>
                {test.status === 'PUBLISHED' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={unpublish.isPending && unpublish.variables?.id === test.id}
                    onClick={() => setPendingUnpublish(test)}
                  >
                    Unpublish
                  </Button>
                ) : test.status === 'DRAFT' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={publish.isPending && publish.variables?.id === test.id}
                    onClick={() => publish.mutate(test)}
                  >
                    Publish
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  loading={remove.isPending && remove.variables?.id === test.id}
                  onClick={() => setPendingDelete(test)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete test"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => pendingDelete && remove.mutate(pendingDelete)}>
              Delete test
            </Button>
          </>
        }
      >
        <p>
          Delete <strong>{pendingDelete?.title}</strong>? This stops the test for any student currently taking it.
          This can't be undone.
        </p>
      </Modal>

      <Modal
        open={pendingUnpublish !== null}
        onClose={() => setPendingUnpublish(null)}
        id="unpublish-modal-title"
        title="Unpublish test"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingUnpublish(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={unpublish.isPending}
              onClick={() => pendingUnpublish && unpublish.mutate(pendingUnpublish)}
            >
              Unpublish test
            </Button>
          </>
        }
      >
        <p>
          Unpublish <strong>{pendingUnpublish?.title}</strong>? Students will no longer see it. Existing attempts are
          kept.
        </p>
      </Modal>

      {importOpen && <ImportTestModal onClose={() => setImportOpen(false)} />}
    </>
  );
}
