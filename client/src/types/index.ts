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

/* ---------- Student test-taking (exam engine) ---------- */

export type AttemptStatus = 'GATED' | 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT';

export interface StudentAttemptSummary {
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
  attempt?: StudentAttemptSummary | null;
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
  endAt: string;
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