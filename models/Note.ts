import mongoose, { type InferSchemaType } from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    index: {
      type: Number,
      required: true,
    },
    kind: {
      type: String,
      enum: ["image", "file"],
      required: true,
    },
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
    imageUrl: {
      type: String,
      default: "",
    },
    publicId: {
      type: String,
      default: "",
    },
    storageKey: {
      type: String,
      default: "",
    },
    caption: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

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
      enum: ["text", "code", "link", "image", "file", "group"],
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

    storage: {
      type: String,
      enum: ["cloudinary", "r2", "mixed"],
      default: "cloudinary",
    },

    storageKey: {
      type: String,
      default: "",
    },
    attachments: {
      type: [attachmentSchema],
      default: undefined,
    },

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

noteSchema.index({ userId: 1, chatId: 1, createdAt: 1 });

noteSchema.index({ userId: 1, createdAt: -1 });

export type NoteDoc = InferSchemaType<typeof noteSchema>;

export default mongoose.models.Note ??
  mongoose.model("Note", noteSchema);
