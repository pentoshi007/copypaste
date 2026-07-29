import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rateLimit";
import { v2 as cloudinary } from "cloudinary";

/**
 * Authorizes a direct-to-Cloudinary image upload.
 *
 * SECURITY: this endpoint builds the parameters itself and signs only those. It
 * must never sign parameters supplied by the caller.
 *
 * An earlier version signed whatever `paramsToSign` object the client sent,
 * which made it a general-purpose signing oracle: a logged-in user could have
 * requested a signature for `public_id=<someone else's asset>` with
 * `overwrite=true` and replaced another user's image, or attached arbitrary
 * eager transformations. Generating the params server-side removes that
 * entirely.
 *
 * The generated `public_id` is namespaced under the authenticated user
 * (`u/<userId>/<random>`), which is what lets `createNotes` verify that an image
 * a user claims actually belongs to them.
 */

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!apiKey || !apiSecret || !cloudName) {
    return NextResponse.json(
      { error: "Image uploads aren't configured" },
      { status: 503 }
    );
  }

  // Sized to cover a full multi-file send (one signature per image) with room
  // for several batches in a minute.
  if (
    !rateLimit("upload-sign", session.user.id, {
      maxAttempts: 120,
      windowMs: 60_000,
    })
  ) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment." },
      { status: 429 }
    );
  }

  // Server-chosen, namespaced, unguessable.
  const publicId = `u/${session.user.id}/${crypto
    .randomUUID()
    .replace(/-/g, "")}`;
  const timestamp = Math.round(Date.now() / 1000);

  try {
    // Cloudinary rejects the upload if the request carries any signed parameter
    // we didn't include here, so the client can't bolt extras on.
    const signature = cloudinary.utils.api_sign_request(
      { public_id: publicId, timestamp },
      apiSecret
    );

    return NextResponse.json(
      { signature, timestamp, publicId, apiKey, cloudName },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to authorize upload" },
      { status: 500 }
    );
  }
}
