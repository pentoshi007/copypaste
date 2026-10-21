import type { z } from "zod";
import dbConnect from "@/lib/db";
import { allowWrite, currentUserId } from "@/lib/server/auth";
import { withUserLock } from "@/lib/server/locks";
import { firstIssue } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export async function runWrite<Input, Result extends object>(
  schema: z.ZodType<Input>,
  input: unknown,
  handler: (userId: string, data: Input) => Promise<ActionResult<Result>>,
  failure: string,
): Promise<ActionResult<Result>> {
  const userId = await currentUserId();
  if (!userId) return fail("Unauthorized");
  if (!allowWrite(userId)) return fail("You're making changes too quickly. Please slow down.");

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    await dbConnect();
    return await withUserLock(userId, () => handler(userId, parsed.data));
  } catch {
    return fail(failure);
  }
}
