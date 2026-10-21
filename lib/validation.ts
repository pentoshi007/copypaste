import { z } from "zod";
import { OBJECT_ID_PATTERN } from "@/lib/guards";

export const objectId = z.string().regex(OBJECT_ID_PATTERN, "Invalid id");

export function firstIssue(error: z.ZodError, fallback = "Invalid input"): string {
  return error.issues[0]?.message ?? fallback;
}
