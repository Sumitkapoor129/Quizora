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

export default function Profile() {
  const { user } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);

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

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-heading">Profile</h1>
          <p className="page-sub">Update the name shown on your account.</p>
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
          <Button type="submit" variant="primary" loading={account.isPending}>
            Save changes
          </Button>
        </form>
      </section>
    </>
  );
}