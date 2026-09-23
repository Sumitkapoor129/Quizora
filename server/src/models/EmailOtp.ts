import { InferSchemaType, Schema, model } from 'mongoose';

export const EMAIL_OTP_PURPOSES = ['REGISTER', 'PASSWORD_RESET'] as const;
export type EmailOtpPurpose = (typeof EMAIL_OTP_PURPOSES)[number];

export const emailOtpSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    purpose: { type: String, enum: EMAIL_OTP_PURPOSES, required: true },
    // SHA-256 hex of the 6-digit code. Never returned to the client.
    codeHash: { type: String, required: true, select: false },
    // TTL index: MongoDB drops the document ~when expiresAt passes.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    attemptsLeft: { type: Number, required: true, default: 5, min: 0 }
  },
  { timestamps: true }
);

export type EmailOtpDoc = InferSchemaType<typeof emailOtpSchema>;
export const EmailOtp = model('EmailOtp', emailOtpSchema);