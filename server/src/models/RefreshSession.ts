import { InferSchemaType, Schema, model } from 'mongoose';

export const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    previousTokenHash: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date }
  },
  { timestamps: true }
);

export type RefreshSessionDoc = InferSchemaType<typeof refreshSessionSchema>;
export const RefreshSession = model('RefreshSession', refreshSessionSchema);