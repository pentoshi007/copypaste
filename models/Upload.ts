import mongoose from "mongoose";

const uploadSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["image", "file"], required: true },
    key: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    consumedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "uploads" },
);

uploadSchema.index({ userId: 1, key: 1 }, { unique: true });
uploadSchema.index({ consumedAt: 1, createdAt: 1 });

export default mongoose.models.Upload ?? mongoose.model("Upload", uploadSchema);
