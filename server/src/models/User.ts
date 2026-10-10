import { InferSchemaType, Schema, model } from 'mongoose';

export const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    // Google account id (the OIDC `sub`). Sparse so documents predating OAuth
    // are still valid; the first Google sign-in links one by email.
    googleId: { type: String, unique: true, sparse: true, index: true },
    role: { type: String, enum: ['ADMIN', 'STUDENT'], default: 'STUDENT' }
  },
  { timestamps: true }
);

export type UserRole = 'ADMIN' | 'STUDENT';
export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);