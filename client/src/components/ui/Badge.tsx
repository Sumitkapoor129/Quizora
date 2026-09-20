import type { ReactNode } from 'react';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warn' | 'danger';

export interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}

export function Badge({ variant = 'default', className = '', children }: BadgeProps) {
  return <span className={`badge badge--${variant}${className ? ` ${className}` : ''}`}>{children}</span>;
}