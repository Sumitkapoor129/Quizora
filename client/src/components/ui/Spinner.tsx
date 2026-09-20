export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading' }: SpinnerProps) {
  return (
    <span className={`spinner spinner--${size}`} role="status" aria-label={label}>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}