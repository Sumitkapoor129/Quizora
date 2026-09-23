import { InferSchemaType, Schema, model } from 'mongoose';

export const resourceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    description: { type: String, maxlength: 500 },
    kind: { type: String, enum: ['PDF', 'ZIP', 'IMAGE', 'OTHER'], required: true },
    driveUrl: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export type ResourceDoc = InferSchemaType<typeof resourceSchema>;
export const Resource = model('Resource', resourceSchema);
