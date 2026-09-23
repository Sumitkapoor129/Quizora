import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { resourceKind } from '@/utils/resourceKind';

export default function Resources() {
  const list = useQuery({ queryKey: ['student', 'resources'], queryFn: () => api.student.resources() });

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Resources</h1>
          <p className="page-sub">Study material shared by your instructors.</p>
        </div>
      </div>

      {list.isPending && (
        <div className="card-grid" role="status" aria-live="polite">
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
          description="Study material will appear here when your instructor shares it."
        />
      )}

      {list.isSuccess && list.data.resources.length > 0 && (
        <div className="card-grid">
          {list.data.resources.map((resource) => {
            const kind = resourceKind(resource.kind);
            return (
              <Card key={resource.id} className="resource-card">
                <h3 className="test-card__title">{resource.title}</h3>
                <Badge variant={kind.variant}>{kind.label}</Badge>
                {resource.description && <p className="test-card__meta">{resource.description}</p>}
                <div className="test-card__cta">
                  <a className="btn btn--primary btn--md" href={resource.driveUrl} target="_blank" rel="noopener noreferrer">
                    Open
                    <span className="sr-only">Opens in a new tab</span>
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}