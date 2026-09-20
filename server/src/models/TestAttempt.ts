import { InferSchemaType, Schema, model } from 'mongoose';

export const attemptEventSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        'FULLSCREEN_EXIT',
        'COPY',
        'PASTE',
        'CUT',
        'CONTEXT_MENU',
        'VISIBILITY_HIDDEN',
        'FOCUS_LOST',
        'NETWORK_RECONNECT',
        'START',
        'SUBMIT'
      ],
      required: true
    },
    payload: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

export const answerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedOptionIds: [{ type: Schema.Types.ObjectId }],
    isAttempted: { type: Boolean, default: false },
    isCorrect: { type: Boolean },
    marksAwarded: { type: Number },
    updatedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

export const sectionAttemptSchema = new Schema(
  {
    sectionId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String },
    endAt: { type: Date },
    score: { type: Number },
    correctCount: { type: Number },
    submittedAt: { type: Date }
  },
  { _id: false }
);

export const testAttemptSchema = new Schema({
  testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['GATED', 'IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT'], default: 'GATED' },
  startedAt: { type: Date },
  submittedAt: { type: Date },
  warningCount: { type: Number, default: 0 },
  score: { type: Number },
  maxScore: { type: Number },
  correctCount: { type: Number },
  totalQuestions: { type: Number },
  voided: { type: Boolean, default: false },
  sectionAttempts: [sectionAttemptSchema],
  answers: [answerSchema],
  events: [attemptEventSchema]
});

// One attempt per student per test.
testAttemptSchema.index({ testId: 1, studentId: 1 }, { unique: true });
testAttemptSchema.index({ studentId: 1, status: 1 });
testAttemptSchema.index({ testId: 1, status: 1 });

export type TestAttemptDoc = InferSchemaType<typeof testAttemptSchema>;
export const TestAttempt = model('TestAttempt', testAttemptSchema);