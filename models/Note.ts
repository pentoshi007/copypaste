import mongoose, { type InferSchemaType } from "mongoose";

const noteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    type: {
      type: String,
      enum: ["text", "code", "link", "image"],
      required: true,
    },
    content: {
      type: String,
      default: "",
    },
    imageUrl: {
      type: String,
      default: "",
    },
    publicId: {
      type: String,
      default: "",
    },
    language: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: "notes" }
);

// Compound index: covers the primary query pattern
//   Note.find({ userId, chatId }).sort({ createdAt: 1 })
// ESR rule: Equality (userId, chatId) → Sort (createdAt)
// A single compound index replaces three separate single-field indexes
// and lets MongoDB serve the sorted query without an in-memory sort.
noteSchema.index({ userId: 1, chatId: 1, createdAt: 1 });

export type NoteDoc = InferSchemaType<typeof noteSchema>;

export default mongoose.models.Note ??
  mongoose.model("Note", noteSchema);
