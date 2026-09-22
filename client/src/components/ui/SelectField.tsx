import type { ReactNode, SelectHTMLAttributes } from 'react';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

export function SelectField({ id, label, hint, className = '', children, ...rest }: SelectFieldProps) {
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={`field__input${className ? ` ${className}` : ''}`}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
