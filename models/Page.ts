import mongoose from "mongoose";
import { MAX_TITLE_LENGTH } from "@/lib/editor/titles";

export const MAX_ICON_LENGTH = 16;

const pageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, default: "", trim: true, maxlength: MAX_TITLE_LENGTH },
    icon: { type: String, default: "", maxlength: MAX_ICON_LENGTH },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Page", default: null },
    position: { type: Number, required: true },
    favorite: { type: Boolean, default: false },
    fullWidth: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    trashRootId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "chats" },
);

pageSchema.index({ userId: 1, deletedAt: 1, position: 1 });
pageSchema.index({ userId: 1, updatedAt: -1 });
pageSchema.index({ userId: 1, trashRootId: 1 });

export default mongoose.models.Page ?? mongoose.model("Page", pageSchema);
