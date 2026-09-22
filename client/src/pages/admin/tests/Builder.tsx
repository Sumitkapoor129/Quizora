import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, assetUrl } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SelectField } from '@/components/ui/SelectField';
import { TextareaField } from '@/components/ui/TextareaField';
import type {
  AdminTest,
  AdminTestOption,
  AdminTestQuestion,
  AdminTestSection,
  AdminTestWrite,
  ErrorDetail,
  QuestionType,
  TestStatus,
} from '@/types';

const EMPTY_DRAFT: AdminTestWrite = {
  title: '',
  description: '',
  defaultNegativeMarks: 0,
  shuffleQuestions: true,
  shuffleOptions: true,
  sections: [],
};

function newId(): string {
  return crypto.randomUUID();
}

function toNum(value: string, fallback = 0): number {
  if (value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNum(value: string): number | undefined {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const copy = items.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

function normalize(draft: AdminTestWrite): AdminTestWrite {
  return {
    title: draft.title.trim(),
    description: draft.description?.trim() ? draft.description : undefined,
    defaultNegativeMarks: draft.defaultNegativeMarks,
    shuffleQuestions: draft.shuffleQuestions,
    shuffleOptions: draft.shuffleOptions,
    sections: draft.sections.map((section, si) => ({
      ...section,
      order: si,
      questions: section.questions.map((question, qi) => ({
        ...question,
        order: qi,
        options: question.options.map((option, oi) => ({ ...option, order: oi })),
      })),
    })),
  };
}

function toDraft(test: AdminTest): AdminTestWrite {
  return {
    title: test.title,
    description: test.description ?? '',
    defaultNegativeMarks: test.defaultNegativeMarks,
    shuffleQuestions: test.shuffleQuestions,
    shuffleOptions: test.shuffleOptions,
    sections: test.sections,
  };
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

function newQuestion(): AdminTestQuestion {
  return {
    id: newId(),
    type: 'SINGLE',
    order: 0,
    text: '',
    marks: 1,
    explanation: '',
    options: [
      { id: newId(), order: 0, text: '', isCorrect: true },
      { id: newId(), order: 1, text: '', isCorrect: false },
    ],
  };
}

function QuestionImage({
  value,
  disabled,
  onChange,
}: {
  value?: string;
  disabled?: boolean;
  onChange: (url: string | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { url } = await api.uploads.upload(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="question-image">
      {value && (
        <>
          <img className="thumb" src={assetUrl(value)} alt="Question image preview" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          >
            Remove image
          </Button>
        </>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={uploading}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {value ? 'Replace image' : 'Add image'}
      </Button>
      <span className="field__hint">PNG, JPEG, GIF, or WebP up to 2MB.</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload question image"
        onChange={handleFile}
      />
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface QuestionEditorProps {
  question: AdminTestQuestion;
  index: number;
  count: number;
  disabled: boolean;
  onChange: (patch: Partial<AdminTestQuestion>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

function QuestionEditor({ question, index, count, disabled, onChange, onMove, onRemove }: QuestionEditorProps) {
  const base = useId();

  const setOptions = (options: AdminTestOption[]) => onChange({ options });

  function changeType(type: QuestionType) {
    if (type === 'SINGLE' && question.type !== 'SINGLE') {
      const firstCorrect = question.options.findIndex((option) => option.isCorrect);
      const keep = firstCorrect === -1 ? 0 : firstCorrect;
      // One combined patch: a second onChange would map stale options and undo this one.
      onChange({
        type,
        options: question.options.map((option, i) => ({ ...option, isCorrect: i === keep })),
      });
      return;
    }
    onChange({ type });
  }

  return (
    <Card className="question-editor">
      <div className="question-editor__head">
        <h5 className="question-editor__title">Question {index + 1}</h5>
        <div className="question-editor__actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Move question ${index + 1} up`}
          >
            Up
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`Move question ${index + 1} down`}
          >
            Down
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      <div className="field-row">
        <SelectField
          id={`${base}-type`}
          label="Type"
          value={question.type}
          disabled={disabled}
          onChange={(event) => changeType(event.target.value as QuestionType)}
        >
          <option value="SINGLE">Single answer</option>
          <option value="MULTI">Multiple answers</option>
        </SelectField>
        <Field
          id={`${base}-marks`}
          label="Marks"
          type="number"
          min={0}
          step={0.25}
          value={question.marks}
          disabled={disabled}
          onChange={(event) => onChange({ marks: toNum(event.target.value) })}
        />
        <Field
          id={`${base}-negative`}
          label="Negative marks"
          type="number"
          min={0}
          step={0.25}
          value={question.negativeMarks ?? ''}
          disabled={disabled}
          hint="Optional. Overrides the test default."
          onChange={(event) => onChange({ negativeMarks: toOptionalNum(event.target.value) })}
        />
      </div>

      <TextareaField
        id={`${base}-text`}
        label="Question text"
        value={question.text ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ text: event.target.value })}
      />

      <TextareaField
        id={`${base}-explanation`}
        label="Explanation"
        value={question.explanation ?? ''}
        disabled={disabled}
        hint="Shown after grading. Optional."
        onChange={(event) => onChange({ explanation: event.target.value })}
      />

      <QuestionImage
        value={question.imageUrl}
        disabled={disabled}
        onChange={(imageUrl) => onChange({ imageUrl })}
      />

      <fieldset className="options" disabled={disabled}>
        <legend className="options__legend">Options</legend>
        {question.options.map((option, oi) => (
          <div className="option-row" key={option.id}>
            {question.type === 'SINGLE' ? (
              <input
                type="radio"
                name={`${base}-correct`}
                checked={option.isCorrect}
                onChange={() => setOptions(question.options.map((item, i) => ({ ...item, isCorrect: i === oi })))}
                aria-label={`Mark option ${oi + 1} correct`}
              />
            ) : (
              <input
                type="checkbox"
                checked={option.isCorrect}
                onChange={() =>
                  setOptions(question.options.map((item, i) => (i === oi ? { ...item, isCorrect: !item.isCorrect } : item)))
                }
                aria-label={`Mark option ${oi + 1} correct`}
              />
            )}
            <input
              className="field__input option-row__text"
              aria-label={`Option ${oi + 1} text`}
              value={option.text ?? ''}
              disabled={disabled}
              onChange={(event) =>
                setOptions(question.options.map((item, i) => (i === oi ? { ...item, text: event.target.value } : item)))
              }
            />
            <div className="option-row__actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || oi === 0}
                onClick={() => setOptions(moveItem(question.options, oi, oi - 1))}
                aria-label={`Move option ${oi + 1} up`}
              >
                Up
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || oi === question.options.length - 1}
                onClick={() => setOptions(moveItem(question.options, oi, oi + 1))}
                aria-label={`Move option ${oi + 1} down`}
              >
                Down
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || question.options.length <= 1}
                onClick={() => setOptions(question.options.filter((_, i) => i !== oi))}
                aria-label={`Remove option ${oi + 1}`}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => setOptions([...question.options, { id: newId(), order: question.options.length, text: '', isCorrect: false }])}
        >
          Add option
        </Button>
      </fieldset>
    </Card>
  );
}

interface SectionEditorProps {
  section: AdminTestSection;
  index: number;
  count: number;
  disabled: boolean;
  onChange: (patch: Partial<AdminTestSection>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

function SectionEditor({ section, index, count, disabled, onChange, onMove, onRemove }: SectionEditorProps) {
  const base = useId();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const setQuestions = (questions: AdminTestQuestion[]) => onChange({ questions });

  return (
    <Card className="section-editor">
      <div className="section-editor__head">
        <h3 className="section-editor__title">Section {index + 1}</h3>
        <div className="section-editor__actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Move section ${index + 1} up`}
          >
            Up
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`Move section ${index + 1} down`}
          >
            Down
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setConfirmingRemove(true)}
          >
            Remove
          </Button>
        </div>
      </div>

      <Field
        id={`${base}-title`}
        label="Section title"
        value={section.title}
        disabled={disabled}
        onChange={(event) => onChange({ title: event.target.value })}
      />

      <div className="field-row">
        <Field
          id={`${base}-duration`}
          label="Duration (minutes)"
          type="number"
          min={0}
          step={1}
          value={Math.round(section.durationSec / 60)}
          disabled={disabled}
          hint="Total time allowed for this section."
          onChange={(event) => onChange({ durationSec: toNum(event.target.value) * 60 })}
        />
        <Field
          id={`${base}-negative`}
          label="Negative marks override"
          type="number"
          min={0}
          step={0.25}
          value={section.negativeMarksOverride ?? ''}
          disabled={disabled}
          hint="Optional. Applied to this section's questions."
          onChange={(event) => onChange({ negativeMarksOverride: toOptionalNum(event.target.value) })}
        />
      </div>

      <div className="section-editor__questions">
        <div className="row-head">
          <h4 className="subsection-title">Questions</h4>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => setQuestions([...section.questions, newQuestion()])}
          >
            Add question
          </Button>
        </div>

        {section.questions.length === 0 && <p className="muted">No questions in this section yet.</p>}

        {section.questions.map((question, qi) => (
          <QuestionEditor
            key={question.id}
            question={question}
            index={qi}
            count={section.questions.length}
            disabled={disabled}
            onChange={(patch) =>
              setQuestions(section.questions.map((item, i) => (i === qi ? { ...item, ...patch } : item)))
            }
            onMove={(delta) => setQuestions(moveItem(section.questions, qi, qi + delta))}
            onRemove={() => setQuestions(section.questions.filter((_, i) => i !== qi))}
          />
        ))}
      </div>

      <Modal
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title="Remove section"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmingRemove(false);
                onRemove();
              }}
            >
              Remove section
            </Button>
          </>
        }
      >
        <p>
          Remove <strong>{section.title || `Section ${index + 1}`}</strong> and its{' '}
          {section.questions.length} question{section.questions.length === 1 ? '' : 's'}? This can't be undone.
        </p>
      </Modal>
    </Card>
  );
}

export default function TestBuilder() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const testQuery = useQuery({
    queryKey: ['admin', 'test', id],
    queryFn: () => api.tests.get(id as string),
    enabled: isEdit,
  });

  const [draft, setDraft] = useState<AdminTestWrite>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<AdminTestWrite>(EMPTY_DRAFT);
  const [status, setStatus] = useState<TestStatus>('DRAFT');
  const [initialized, setInitialized] = useState(!isEdit);
  const [frozen, setFrozen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState<ErrorDetail[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const allowNavigation = useRef(false);

  useEffect(() => {
    if (!isEdit || !testQuery.data || initialized) return;
    const loaded = toDraft(testQuery.data);
    setDraft(loaded);
    setBaseline(loaded);
    setStatus(testQuery.data.status);
    setInitialized(true);
  }, [isEdit, testQuery.data, initialized]);

  const dirty = useMemo(
    () => JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(baseline)),
    [draft, baseline],
  );

  const blocker = useBlocker(() => dirty && !allowNavigation.current);

  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const titleEmpty = draft.title.trim().length === 0;
  const editingDisabled = frozen || !initialized;

  function patchDraft(patch: Partial<AdminTestWrite>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function confirmDiscard() {
    if (blocker.state === 'blocked') blocker.proceed();
    if (discardOpen) {
      setDraft(baseline);
      setDiscardOpen(false);
    }
  }

  function cancelDiscard() {
    if (blocker.state === 'blocked') blocker.reset();
    setDiscardOpen(false);
  }

  async function handleSave() {
    if (titleEmpty || saving || frozen) return;
    setSaving(true);
    setSaved(false);
    setFormError(null);
    setDetails([]);
    const body = normalize(draft);

    try {
      if (isEdit && id) {
        const updated = await api.tests.update(id, body);
        const next = toDraft(updated);
        setDraft(next);
        setBaseline(next);
        setStatus(updated.status);
        queryClient.setQueryData(['admin', 'test', id], updated);
        queryClient.invalidateQueries({ queryKey: ['admin', 'tests'] });
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      } else {
        const created = await api.tests.create({
          title: body.title,
          description: body.description,
          defaultNegativeMarks: body.defaultNegativeMarks,
        });
        // POST only accepts metadata; persist any sections the admin queued
        // up before the test existed. (Ponytail: contract-faithful client flow.)
        if (body.sections.length > 0) {
          await api.tests.update(created.id, body);
        }
        allowNavigation.current = true;
        queryClient.invalidateQueries({ queryKey: ['admin', 'tests'] });
        navigate(`/admin/tests/${created.id}/edit`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TEST_FROZEN') {
        setFrozen(true);
        setFormError(err.message);
      } else if (err instanceof ApiError && err.status === 400) {
        setFormError('Please fix the highlighted problems and try again.');
        setDetails(parseDetails(err.details));
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (isEdit && !initialized) {
    if (testQuery.isError) {
      return (
        <>
          <div className="page-header">
            <div>
              <Link className="back-link" to="/admin/tests">
                ← Tests
              </Link>
              <h1 className="page-heading">Edit test</h1>
            </div>
          </div>
          <ErrorState onRetry={() => testQuery.refetch()} />
        </>
      );
    }
    return (
      <div className="builder-loading" role="status">
        <span className="sr-only">Loading test…</span>
        <div className="skeleton-row" aria-hidden="true" />
        <div className="skeleton-block" aria-hidden="true" />
        <div className="skeleton-block" aria-hidden="true" />
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Link className="back-link" to="/admin/tests">
            ← Tests
          </Link>
          <div className="builder-title-row">
            <h1 className="page-heading">{isEdit ? 'Edit test' : 'New test'}</h1>
            {status !== 'DRAFT' && (
              <Badge variant={status === 'PUBLISHED' ? 'success' : 'default'}>
                {status === 'PUBLISHED' ? 'Published' : 'Archived'}
              </Badge>
            )}
          </div>
        </div>
        <div className="page-header__actions">
          {dirty && !frozen && <span className="unsaved">Unsaved changes</span>}
          {frozen && <Badge variant="warn">Frozen</Badge>}
          <Button variant="secondary" disabled={!dirty || frozen} onClick={() => setDiscardOpen(true)}>
            Discard
          </Button>
          <Button disabled={titleEmpty || frozen} loading={saving} onClick={handleSave}>
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>

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

      <Card className="builder-settings">
        <Field
          id="test-title"
          label="Title"
          value={draft.title}
          disabled={editingDisabled}
          onChange={(event) => patchDraft({ title: event.target.value })}
        />
        <TextareaField
          id="test-description"
          label="Description"
          value={draft.description ?? ''}
          disabled={editingDisabled}
          hint="Optional. Shown to students before they start."
          onChange={(event) => patchDraft({ description: event.target.value })}
        />
        <Field
          id="test-negative"
          label="Default negative marks"
          type="number"
          min={0}
          step={0.25}
          value={draft.defaultNegativeMarks}
          disabled={editingDisabled}
          hint="Applied to questions that don't set their own."
          onChange={(event) => patchDraft({ defaultNegativeMarks: toNum(event.target.value) })}
        />
      </Card>

      <section aria-labelledby="sections-heading">
        <div className="builder-sections__head">
          <h2 className="section-title" id="sections-heading">
            Sections
          </h2>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={editingDisabled}
            onClick={() =>
              patchDraft({
                sections: [
                  ...draft.sections,
                  { id: newId(), title: '', order: draft.sections.length, durationSec: 600, questions: [] },
                ],
              })
            }
          >
            Add section
          </Button>
        </div>

        {draft.sections.length === 0 && (
          <p className="muted">No sections yet. Add a section to start building questions.</p>
        )}

        {draft.sections.map((section, si) => (
          <SectionEditor
            key={section.id}
            section={section}
            index={si}
            count={draft.sections.length}
            disabled={editingDisabled}
            onChange={(patch) =>
              patchDraft({ sections: draft.sections.map((item, i) => (i === si ? { ...item, ...patch } : item)) })
            }
            onMove={(delta) => patchDraft({ sections: moveItem(draft.sections, si, si + delta) })}
            onRemove={() => patchDraft({ sections: draft.sections.filter((_, i) => i !== si) })}
          />
        ))}
      </section>

      <Modal
        open={discardOpen || blocker.state === 'blocked'}
        onClose={cancelDiscard}
        id="discard-modal-title"
        title="Discard changes?"
        footer={
          <>
            <Button variant="secondary" onClick={cancelDiscard}>
              {blocker.state === 'blocked' && !discardOpen ? 'Keep editing' : 'Cancel'}
            </Button>
            <Button variant="danger" onClick={confirmDiscard}>
              Discard
            </Button>
          </>
        }
      >
        <p>You have unsaved changes. If you leave now, they'll be lost.</p>
      </Modal>
    </>
  );
}
