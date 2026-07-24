import mongoose, { type InferSchemaType } from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      default: "New Chat",
      trim: true,
      maxlength: 100,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
      index: -1, // descending — most recently active chat first
    },
  },
  { collection: "chats" }
);

export type ChatDoc = InferSchemaType<typeof chatSchema>;

export default mongoose.models.Chat ??
  mongoose.model("Chat", chatSchema);
