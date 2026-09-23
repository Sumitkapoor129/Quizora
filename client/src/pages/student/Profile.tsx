import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import type { ErrorDetail } from '@/types';

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

function firstErrorId(errors: Record<string, string | undefined>): string | null {
  // Error state uses short keys; map back to the focused field's DOM id.
  const fieldIds: Record<string, string> = {
    current: 'current-password',
    new: 'new-password',
    confirm: 'confirm-password',
  };
  for (const key of ['current', 'new', 'confirm']) {
    if (errors[key]) return fieldIds[key];
  }
  return null;
}

export default function Profile() {
  const { user } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string | undefined>>({});
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);

  const account = useMutation({
    mutationFn: (input: { name: string }) => api.student.profile.update(input),
    onSuccess: () => {
      setAccountSuccess('Profile updated.');
    },
    onError: (err) => {
      setAccountFormError(null);
      if (err instanceof ApiError) {
        const details = parseDetails(err.details);
        const nameDetail = details.find((d) => d.field === 'name');
        if (nameDetail) {
          setNameError(nameDetail.message);
          document.getElementById('full-name')?.focus();
          return;
        }
      }
      setAccountFormError('Something went wrong. Please try again.');
    },
  });

  const password = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.student.profile.update(input),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
      setPasswordSuccess('Password updated.');
    },
    onError: (err) => {
      setPasswordFormError(null);
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        setPasswordErrors((prev) => ({ ...prev, current: 'Current password is incorrect.' }));
        document.getElementById('current-password')?.focus();
        return;
      }
      if (err instanceof ApiError) {
        const details = parseDetails(err.details);
        const mapped: Record<string, string | undefined> = {};
        for (const detail of details) {
          if (detail.field === 'currentPassword') mapped.current = detail.message;
          if (detail.field === 'newPassword') mapped.new = detail.message;
        }
        if (Object.keys(mapped).length > 0) {
          setPasswordErrors((prev) => ({ ...prev, ...mapped }));
          const first = firstErrorId({ ...passwordErrors, ...mapped });
          if (first) document.getElementById(first)?.focus();
          return;
        }
      }
      setPasswordFormError('Something went wrong. Please try again.');
    },
  });

  function handleAccountSubmit(event: FormEvent) {
    event.preventDefault();
    setAccountSuccess(null);
    setAccountFormError(null);
    setNameError(undefined);
    if (name.trim() === '') {
      setNameError('Enter a name.');
      document.getElementById('full-name')?.focus();
      return;
    }
    account.mutate({ name: name.trim() });
  }

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordSuccess(null);
    setPasswordFormError(null);
    const errors: Record<string, string | undefined> = {};
    if (currentPassword.trim() === '') errors.current = 'Enter your current password.';
    if (newPassword.length < 8) errors.new = 'Password must be at least 8 characters.';
    if (confirmPassword !== newPassword) errors.confirm = "Passwords don't match.";
    setPasswordErrors(errors);
    const first = firstErrorId(errors);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    password.mutate({ currentPassword, newPassword });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Profile</h1>
          <p className="page-sub">Update your name or password.</p>
        </div>
      </div>

      <section className="section" aria-labelledby="account-heading">
        <h2 className="section-title" id="account-heading">
          Account
        </h2>
        <form onSubmit={handleAccountSubmit} noValidate>
          {accountFormError && (
            <div className="form-error" role="alert">
              {accountFormError}
            </div>
          )}
          {accountSuccess && (
            <div className="form-success" role="status">
              {accountSuccess}
            </div>
          )}
          <Field
            id="full-name"
            label="Full name"
            type="text"
            autoComplete="name"
            maxLength={120}
            value={name}
            error={nameError}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(undefined);
              setAccountSuccess(null);
            }}
          />
          <Button
            type="submit"
            variant="primary"
            loading={account.isPending}
            disabled={password.isPending}
          >
            Save changes
          </Button>
        </form>
      </section>

      <section className="section" aria-labelledby="password-heading">
        <h2 className="section-title" id="password-heading">
          Change password
        </h2>
        <form onSubmit={handlePasswordSubmit} noValidate>
          {passwordFormError && (
            <div className="form-error" role="alert">
              {passwordFormError}
            </div>
          )}
          {passwordSuccess && (
            <div className="form-success" role="status">
              {passwordSuccess}
            </div>
          )}
          <Field
            id="current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            hint="Required to change your password."
            value={currentPassword}
            error={passwordErrors.current}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
              setPasswordErrors((prev) => ({ ...prev, current: undefined }));
              setPasswordSuccess(null);
            }}
          />
          <Field
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            value={newPassword}
            error={passwordErrors.new}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setPasswordErrors((prev) => ({ ...prev, new: undefined }));
              setPasswordSuccess(null);
            }}
          />
          <Field
            id="confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            error={passwordErrors.confirm}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setPasswordErrors((prev) => ({ ...prev, confirm: undefined }));
              setPasswordSuccess(null);
            }}
          />
          <Button
            type="submit"
            variant="primary"
            loading={password.isPending}
            disabled={account.isPending}
          >
            Update password
          </Button>
        </form>
      </section>
    </>
  );
}