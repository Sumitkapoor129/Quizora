import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from '@/components/ui/Field';

describe('Field', () => {
  it('renders a labelled input and shows inline errors', () => {
    render(<Field id="email" label="Email" error="Email is required." />);

    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'email-error');
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
  });

  it('shows the hint when provided and no error exists', () => {
    render(<Field id="password" label="Password" type="password" hint="At least 8 characters." />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-describedby', 'password-hint');
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
  });
});