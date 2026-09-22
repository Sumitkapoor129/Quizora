import { InferSchemaType, Schema, model } from 'mongoose';

export const optionSchema = new Schema({
  order: { type: Number, required: true },
  text: { type: String },
  imageUrl: { type: String },
  isCorrect: { type: Boolean, default: false }
});

export const questionSchema = new Schema({
  type: { type: String, enum: ['SINGLE', 'MULTI'], default: 'SINGLE' },
  order: { type: Number, required: true },
  text: { type: String },
  imageUrl: { type: String },
  marks: { type: Number, required: true },
  negativeMarks: { type: Number },
  explanation: { type: String },
  options: [optionSchema]
});

export const sectionSchema = new Schema({
  title: { type: String, required: true, trim: true },
  order: { type: Number, required: true },
  durationSec: { type: Number, required: true },
  negativeMarksOverride: { type: Number },
  questions: [questionSchema]
});

export const testSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' },
    defaultNegativeMarks: { type: Number, default: 0 },
    shuffleQuestions: { type: Boolean, default: true },
    shuffleOptions: { type: Boolean, default: true },
    deletedAt: { type: Date },
    sections: [sectionSchema]
  },
  { timestamps: true }
);

export type TestDoc = InferSchemaType<typeof testSchema>;
export const Test = model('Test', testSchema);