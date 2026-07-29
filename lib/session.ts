import { cache } from "react";
import { auth } from "@/auth";

/**
 * Request-scoped session lookup.
 *
 * `auth()` decodes + decrypts the session JWT on every call. The app layout and
 * the page both need the session, so without memoisation we pay that cost twice
 * on every render. React's `cache()` dedupes it for the lifetime of one request.
 */
export const getSession = cache(async () => auth());
