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
      enum: ["text", "code", "link", "image", "file"],
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
    /** Cloudinary public_id — image notes only. */
    publicId: {
      type: String,
      default: "",
    },
    /**
     * Which backend holds the attachment, so deletes go to the right place.
     * Image notes use Cloudinary; `file` notes use R2.
     */
    storage: {
      type: String,
      enum: ["cloudinary", "r2"],
      default: "cloudinary",
    },
    /** R2 object key — `file` notes only. Never exposed to the client. */
    storageKey: {
      type: String,
      default: "",
    },
    /** Original filename, shown in the UI and restored on download. */
    fileName: {
      type: String,
      default: "",
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    mimeType: {
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
