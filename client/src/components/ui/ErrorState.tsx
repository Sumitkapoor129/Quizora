import { Button } from '@/components/ui/Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong.',
  message = "We couldn't load this. Please try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <h3 className="error-state__title">{title}</h3>
      {message && <p className="error-state__body">{message}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}