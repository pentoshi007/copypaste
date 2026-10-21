import mongoose from "mongoose";
import { BLOCK_COLORS, BLOCK_TYPES, MAX_INDENT } from "@/lib/editor/blockTypes";

const attachmentSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    kind: { type: String, enum: ["image", "file"], required: true },
    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    publicId: { type: String, default: "" },
    storageKey: { type: String, default: "" },
    caption: { type: String, default: "" },
  },
  { _id: false },
);

const blockSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Page", required: true },
    type: { type: String, enum: BLOCK_TYPES, required: true },
    content: { type: String, default: "" },
    language: { type: String, default: "" },
    position: { type: Number, required: true },
    indent: { type: Number, default: 0, min: 0, max: MAX_INDENT },
    checked: { type: Boolean, default: false },
    collapsed: { type: Boolean, default: false },
    color: { type: String, enum: BLOCK_COLORS, default: "default" },
    imageUrl: { type: String, default: "" },
    publicId: { type: String, default: "" },
    storage: { type: String, enum: ["cloudinary", "r2", "mixed", "none"], default: "none" },
    storageKey: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: undefined },
    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "" },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "notes" },
);

blockSchema.index({ userId: 1, chatId: 1, deletedAt: 1, position: 1 });
blockSchema.index({ userId: 1, createdAt: -1 });
blockSchema.index({ userId: 1, deletedAt: 1 });

export default mongoose.models.Block ?? mongoose.model("Block", blockSchema);
