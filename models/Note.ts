import mongoose, { type InferSchemaType } from "mongoose";

const noteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
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
      index: -1, // descending — latest note first
    },
  },
  { collection: "notes" }
);

export type NoteDoc = InferSchemaType<typeof noteSchema>;

export default mongoose.models.Note ??
  mongoose.model("Note", noteSchema);
