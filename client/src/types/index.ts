export type Role = 'student' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type User = AuthUser;

export interface SessionResponse {
  user: AuthUser;
  sessionExpiresAt: string;
}

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ErrorDetail {
  field: string;
  message: string;
}

/* ---------- Admin test authoring ---------- */

export type TestStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type QuestionType = 'SINGLE' | 'MULTI';

export interface AdminTestOption {
  id: string;
  order: number;
  text?: string;
  imageUrl?: string;
  isCorrect: boolean;
}

export interface AdminTestQuestion {
  id: string;
  type: QuestionType;
  order: number;
  text?: string;
  imageUrl?: string;
  marks: number;
  negativeMarks?: number;
  explanation?: string;
  options: AdminTestOption[];
}

export interface AdminTestSection {
  id: string;
  title: string;
  order: number;
  durationSec: number;
  negativeMarksOverride?: number;
  questions: AdminTestQuestion[];
}

export interface AdminTest {
  id: string;
  title: string;
  description?: string;
  status: TestStatus;
  defaultNegativeMarks: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  sections: AdminTestSection[];
  createdAt: string;
  updatedAt: string;
}

/** PUT body: full Test without id/status/createdAt/updatedAt. */
export type AdminTestWrite = Omit<AdminTest, 'id' | 'status' | 'createdAt' | 'updatedAt'>;

export interface AdminTestListItem {
  id: string;
  title: string;
  status: TestStatus;
  defaultNegativeMarks: number;
  sectionCount: number;
  questionCount: number;
  totalDurationSec: number;
  totalMarks: number;
  updatedAt: string;
}

export interface ListTestsResponse {
  tests: AdminTestListItem[];
}

export interface UploadResponse {
  url: string;
}

/* ---------- Admin test import ---------- */

export interface ImportSummary {
  title: string;
  sectionCount: number;
  questionCount: number;
  totalDurationSec: number;
  totalMarks: number;
}

export interface ValidateImportResponse {
  hash: string;
  summary: ImportSummary;
}

/** Backend import error details match { field, message }. */
export type ImportErrorDetail = ErrorDetail;

/* ---------- Student test-taking (exam engine) ---------- */

export type AttemptStatus = 'GATED' | 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT';

/** Lightweight per-test attempt marker carried on the student test list. */
export interface StudentAttemptRef {
  id: string;
  status: AttemptStatus;
}

export interface StudentTestListItem {
  id: string;
  title: string;
  description?: string;
  sectionCount: number;
  questionCount: number;
  totalDurationSec: number;
  totalMarks: number;
  defaultNegativeMarks: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  attempt?: StudentAttemptRef | null;
}

export interface StudentTestsResponse {
  tests: StudentTestListItem[];
}

export interface CreateAttemptResponse {
  attempt: { id: string; status: AttemptStatus; testId: string };
}

export interface StartedAttemptSection {
  sectionId: string;
  sectionIndex: number;
  title: string;
  durationSec: number;
  endAt: string;
  negativeMarks: number;
  questions: unknown[];
}

export interface StartAttemptResponse {
  attempt: {
    id: string;
    status: AttemptStatus;
    testId: string;
    startedAt: string;
    endAt: string;
    currentQuestionIndex: number;
    warningCount: number;
    testTitle: string;
    sections: StartedAttemptSection[];
  };
}

export interface StudentOption {
  optionId: string;
  text?: string;
  imageUrl?: string;
}

export interface StudentQuestion {
  questionId: string;
  questionIndex: number;
  type: QuestionType;
  text?: string;
  imageUrl?: string;
  marks: number;
  negativeMarks: number;
  options: StudentOption[];
}

export interface StudentSection {
  sectionId: string;
  sectionIndex: number;
  title: string;
  durationSec: number;
  endAt?: string;
  negativeMarks: number;
  questions: StudentQuestion[];
}

export interface StudentAnswer {
  questionId: string;
  selectedOptionIds: string[];
  isAttempted: boolean;
  isMarked: boolean;
  isCorrect?: boolean;
  marksAwarded?: number;
}

export interface StudentAttemptEvent {
  type: string;
  payload?: unknown;
  createdAt: string;
}

export interface StudentAttempt {
  id: string;
  testId: string;
  testTitle: string;
  status: AttemptStatus;
  startedAt?: string;
  endAt?: string;
  submittedAt?: string;
  currentQuestionIndex: number;
  warningCount: number;
  maxScore: number;
  totalQuestions: number;
  sections: StudentSection[];
  answers: StudentAnswer[];
  events: StudentAttemptEvent[];
}

export interface AttemptResponse {
  attempt: StudentAttempt;
}

export type AntiCheatEventType =
  | 'FULLSCREEN_EXIT'
  | 'COPY'
  | 'PASTE'
  | 'CUT'
  | 'CONTEXT_MENU'
  | 'VISIBILITY_HIDDEN'
  | 'FOCUS_LOST'
  | 'NETWORK_RECONNECT';

export interface PostEventResponse {
  status: AttemptStatus;
  warningCount: number;
  submitted: boolean;
}

export interface StudentAnswerInput {
  questionId: string;
  selectedOptionIds: string[];
  isMarked?: boolean;
}

export interface SaveAnswersBody {
  currentQuestionIndex: number;
  answers: StudentAnswerInput[];
}

export interface SaveAnswersResponse {
  savedAt: string;
  status: AttemptStatus;
  endAt: string | null;
}

export interface ResultSection {
  sectionId: string;
  sectionIndex: number;
  title: string;
  score: number;
  maxScore: number;
  correctCount: number;
}

export interface ResultQuestion {
  questionId: string;
  questionIndex: number;
  isCorrect: boolean;
  marksAwarded: number;
  isAttempted: boolean;
  selectedOptionIds: string[];
}

export interface AttemptResultData {
  id: string;
  testId: string;
  testTitle: string;
  status: 'SUBMITTED' | 'TIMED_OUT';
  score: number;
  maxScore: number;
  correctCount: number;
  totalQuestions: number;
  submittedAt: string;
  startedAt: string;
  sections: ResultSection[];
  questions: ResultQuestion[];
}

export interface AttemptResultResponse {
  attempt: AttemptResultData;
}

/* ---------- Admin attempts review ---------- */

export interface AdminAttemptStudent {
  id: string;
  name: string;
  email: string;
}

export interface AdminAttemptListItem {
  id: string;
  testId: string;
  testTitle: string;
  student: AdminAttemptStudent;
  status: AttemptStatus;
  score: number;
  maxScore: number;
  correctCount: number;
  totalQuestions: number;
  warningCount: number;
  startedAt: string | null;
  submittedAt: string | null;
}

export interface AdminAttemptOption {
  optionId: string;
  text?: string;
  imageUrl?: string;
  isCorrect: boolean;
  selected: boolean;
}

export interface AdminAttemptQuestion {
  questionId: string;
  questionIndex: number;
  sectionIndex: number;
  type: QuestionType;
  text?: string;
  imageUrl?: string;
  explanation?: string;
  marks: number;
  negativeMarks: number;
  options: AdminAttemptOption[];
  selectedOptionIds: string[];
  isCorrect: boolean;
  marksAwarded: number;
  isAttempted: boolean;
}

export interface AdminAttemptDetail extends AdminAttemptListItem {
  endAt: string | null;
  sections: ResultSection[];
  questions: AdminAttemptQuestion[];
  events: StudentAttemptEvent[];
}

export interface AdminAttemptListResponse {
  attempts: AdminAttemptListItem[];
}

export interface AdminAttemptDetailResponse {
  attempt: AdminAttemptDetail;
}

/* ---------- Admin analytics ---------- */

export type AdminAnalyticsQuestionType = 'SINGLE' | 'MULTI';

export interface AdminAnalyticsDistributionBucket {
  bucket: number;
  count: number;
}

export interface AdminAnalyticsPerQuestion {
  questionId: string;
  testId: string;
  testTitle: string;
  sectionIndex: number;
  type: AdminAnalyticsQuestionType;
  text?: string;
  marks: number;
  attempted: number;
  correct: number;
  difficulty: number | null;
}

export interface AdminAnalyticsViolations {
  byType: Record<string, number>;
  attemptsWithViolations: number;
  totalWarnings: number;
}

export interface AdminAnalyticsSummary {
  scoredAttempts: number;
  attemptsToday: number;
  avgScorePercent: number | null;
  highestScorePercent: number | null;
  lowestScorePercent: number | null;
  avgCorrectPercent: number | null;
  totalWarnings: number;
}

export interface AdminAnalytics {
  testId: string | null;
  summary: AdminAnalyticsSummary;
  distribution: AdminAnalyticsDistributionBucket[];
  perQuestion: AdminAnalyticsPerQuestion[];
  violations: AdminAnalyticsViolations;
}

/* ---------- Study resources (Phase 10) ---------- */

export type ResourceKind = 'PDF' | 'ZIP' | 'IMAGE' | 'OTHER';

export interface Resource {
  id: string;
  title: string;
  /** Server sends `string | null`; normalized to undefined at the api layer. */
  description?: string;
  kind: ResourceKind;
  driveUrl: string;
  createdAt: string;
  /** Admin-only — the creator's id. Absent from the student feed. */
  createdBy?: string;
}

export interface ResourceListResponse {
  resources: Resource[];
}

export interface CreateResourceInput {
  title: string;
  description?: string;
  kind: ResourceKind;
  driveUrl: string;
}

/* ---------- Student portal (Phase 11) ---------- */

export interface StudentAttemptSummary {
  attemptId: string;
  testId: string;
  testTitle: string;
  status: AttemptStatus;
  marksEarned: number;
  totalMarks: number;
  percent: number;
  date: string;
}

export interface StudentAttemptsResponse {
  attempts: StudentAttemptSummary[];
}

export interface ProfileUpdateInput {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}

/** PATCH /api/student/profile → same shape as /auth/me. */
export interface ProfileUpdateResponse extends SessionResponse {}
