import mongoose, { type InferSchemaType } from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    },
  },
  { collection: "chats" }
);

// Compound index: covers Chat.find({ userId }).sort({ updatedAt: -1 })
// ESR rule: Equality (userId) → Sort (updatedAt desc)
chatSchema.index({ userId: 1, updatedAt: -1 });

export type ChatDoc = InferSchemaType<typeof chatSchema>;

export default mongoose.models.Chat ??
  mongoose.model("Chat", chatSchema);
