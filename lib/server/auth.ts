import { auth } from "@/auth";
import { rateLimit } from "@/lib/rateLimit";

const WRITE_LIMIT = { maxAttempts: 600, windowMs: 60_000 };

export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export function allowWrite(userId: string): boolean {
  return rateLimit("write", userId, WRITE_LIMIT);
}
