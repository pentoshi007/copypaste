"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { signIn, signOut } from "@/auth";
import dbConnect from "@/lib/db";
import User from "@/models/User";
import { rateLimit } from "@/lib/rateLimit";
import { headers } from "next/headers";

const credentialsSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});

export type AuthState = { error?: string; ok?: boolean };

/**
 * Best-effort client IP for rate limiting.
 *
 * Order matters. `x-forwarded-for` is attacker-controllable — a client can send
 * its own value, and reading the leftmost entry first meant an attacker could
 * rotate that header to get a fresh rate-limit bucket per request. Platform
 * headers are checked first because the edge sets them and strips any inbound
 * copy; `x-forwarded-for` is only a last resort.
 *
 * Brute-force protection doesn't rest on this alone: attempts are also bucketed
 * per username, which no header can change.
 */
async function getIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-vercel-forwarded-for") ||
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function signupAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const ip = await getIp();
  if (!rateLimit("signup-ip", ip)) {
    return { error: "Too many attempts. Please wait a moment." };
  }

  const parsed = credentialsSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { username, password } = parsed.data;
  const normalized = username.toLowerCase();

  if (!rateLimit("signup-user", normalized)) {
    return { error: "Too many attempts. Please wait a moment." };
  }

  try {
    await dbConnect();
    const existing = await User.findOne({ username: normalized })
      .select("_id")
      .lean();
    if (existing) {
      return { error: "Username already taken" };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ username: normalized, passwordHash });

    await signIn("credentials", {
      username: normalized,
      password,
      redirect: false,
    });

    return { ok: true };
  } catch (err) {
    // The check-then-create above has a race: two simultaneous signups for the
    // same name can both pass it. The unique index on `username` is the actual
    // guarantee, so surface its duplicate-key error as the real reason rather
    // than a generic failure.
    if (isDuplicateKeyError(err)) {
      return { error: "Username already taken" };
    }
    return { error: "Something went wrong. Please try again." };
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const ip = await getIp();
  if (!rateLimit("login-ip", ip)) {
    return { error: "Too many attempts. Please wait a moment." };
  }

  const parsed = credentialsSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Invalid username or password" };
  }

  const { username, password } = parsed.data;
  const normalized = username.toLowerCase();

  if (!rateLimit("login-user", normalized)) {
    return { error: "Too many attempts. Please wait a moment." };
  }

  try {
    await signIn("credentials", {
      username: normalized,
      password,
      redirect: false,
    });
    return { ok: true };
  } catch {
    // Same error for bad username vs bad password — no enumeration
    return { error: "Invalid username or password" };
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirect: false });
}
