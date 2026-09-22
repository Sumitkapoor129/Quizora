import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextareaField } from '@/components/ui/TextareaField';
import type { ErrorDetail, ImportSummary } from '@/types';

const TESTS_KEY = ['admin', 'tests'];

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatDuration(totalSec: number): string {
  return `${Math.round(totalSec / 60)} min`;
}

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

interface ImportTestModalProps {
  onClose: () => void;
}

export default function ImportTestModal({ onClose }: ImportTestModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [content, setContent] = useState('');
  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState<ErrorDetail[]>([]);
  const [preview, setPreview] = useState<{ hash: string; summary: ImportSummary } | null>(null);
  const [stale, setStale] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const validate = useMutation({
    mutationFn: (text: string) => api.imports.validate({ content: text }),
    onSuccess: (result) => {
      setPreview(result);
      setJsonError(null);
      setFormError(null);
      setDetails([]);
      setStale(false);
      setConfirmError(null);
      setStep('preview');
    },
    onError: (err) => {
      setJsonError(null);
      setFormError(null);
      setDetails([]);
      if (err instanceof ApiError && err.code === 'INVALID_JSON') {
        setJsonError(err.message);
      } else if (err instanceof ApiError) {
        setFormError(err.message);
        setDetails(parseDetails(err.details));
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    },
  });

  const confirm = useMutation({
    mutationFn: () => api.imports.confirm({ content, hash: preview?.hash ?? '' }),
    onSuccess: (test) => {
      queryClient.invalidateQueries({ queryKey: TESTS_KEY });
      onClose();
      navigate(`/admin/tests/${test.id}/edit`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'IMPORT_STALE') {
        setStale(true);
      } else {
        setConfirmError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    },
  });

  const backToEdit = () => {
    setStep('edit');
    setPreview(null);
    setStale(false);
    setConfirmError(null);
  };

  const handleClose = useCallback(() => {
    if (confirm.isPending || validate.isPending) return;
    onClose();
  }, [confirm.isPending, validate.isPending, onClose]);

  return (
    <Modal
      key={step}
      open
      onClose={handleClose}
      id="import-modal-title"
      title={step === 'edit' ? 'Import test' : 'Preview import'}
      footer={
        step === 'edit' ? (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button loading={validate.isPending} disabled={content.trim() === ''} onClick={() => validate.mutate(content)}>
              Validate
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={backToEdit}>
              Back
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Import test
            </Button>
          </>
        )
      }
    >
      {step === 'edit' ? (
        <>
          {formError && (
            <div className="banner banner--error" role="alert">
              <p className="banner__text">{formError}</p>
              {details.length > 0 && (
                <ul className="banner__details">
                  {details.map((detail, i) => (
                    <li key={`${detail.field}-${i}`}>
                      <code>{detail.field}</code> — {detail.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <TextareaField
            id="import-json"
            label="Test JSON"
            rows={12}
            value={content}
            error={jsonError ?? undefined}
            hint="Paste the exported test JSON, then validate it before importing."
            placeholder='{ "title": "Midterm", "sections": [] }'
            className="import-json"
            disabled={validate.isPending}
            onChange={(event) => {
              setContent(event.target.value);
              setJsonError(null);
              setFormError(null);
              setDetails([]);
            }}
          />
        </>
      ) : (
        <div>
          {stale && (
            <div className="banner banner--error" role="alert">
              <p className="banner__text">
                This preview has expired. Use Back, then validate the JSON again before importing.
              </p>
            </div>
          )}
          {confirmError && (
            <div className="banner banner--error" role="alert">
              <p className="banner__text">{confirmError}</p>
            </div>
          )}
          <dl className="import-summary">
            <div className="import-summary__row">
              <dt>Title</dt>
              <dd>{preview?.summary.title ?? ''}</dd>
            </div>
            <div className="import-summary__row">
              <dt>Sections</dt>
              <dd>{preview ? plural(preview.summary.sectionCount, 'section') : ''}</dd>
            </div>
            <div className="import-summary__row">
              <dt>Questions</dt>
              <dd>{preview ? plural(preview.summary.questionCount, 'question') : ''}</dd>
            </div>
            <div className="import-summary__row">
              <dt>Duration</dt>
              <dd>{preview ? formatDuration(preview.summary.totalDurationSec) : ''}</dd>
            </div>
            <div className="import-summary__row">
              <dt>Marks</dt>
              <dd>{preview?.summary.totalMarks ?? ''}</dd>
            </div>
          </dl>
          <p className="import-note">The whole test imports as a draft.</p>
        </div>
      )}
    </Modal>
  );
}