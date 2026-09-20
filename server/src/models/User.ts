import { InferSchemaType, Schema, model } from 'mongoose';

export const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['ADMIN', 'STUDENT'], default: 'STUDENT' }
  },
  { timestamps: true }
);

export type UserRole = 'ADMIN' | 'STUDENT';
export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);