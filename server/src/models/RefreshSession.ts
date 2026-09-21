import { InferSchemaType, Schema, model } from 'mongoose';

export const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    // Indexed: replay detection looks rows up by this field on every failed refresh.
    previousTokenHash: { type: String, index: true },
    // Set on every rotation. Lets replay detection tell a two-tab refresh race
    // (rotation moments ago) apart from a genuine replay (rotation long ago).
    rotatedAt: { type: Date },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date }
  },
  { timestamps: true }
);

export type RefreshSessionDoc = InferSchemaType<typeof refreshSessionSchema>;
export const RefreshSession = model('RefreshSession', refreshSessionSchema);