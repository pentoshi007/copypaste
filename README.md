# CopyPaste

A fast, cross-device clipboard & notes sync app. Type or paste text, code, links, or images on your laptop — open the same app on your phone and copy what you need. No more WhatsApp/Telegram round-trips just to move a snippet between devices.

Notes are organized into **chats** (like conversation threads). Each chat auto-titles itself from your first note. The app opens at your most recently active chat — never a blank slate.

## Features

- **Chat-based organization** — Notes live inside chats. Create, rename, and delete chats. Each chat auto-titles from its first note's content.
- **Five note types** with type-specific actions:
  - **Text** — copy to clipboard with one tap.
  - **Code** — syntax-highlighted (Prism) with a copy-block button and language label.
  - **Link** — copy URL or open in a new tab (`rel="noopener noreferrer"`). Only `http`/`https` URLs accepted — `javascript:` and `data:` schemes are rejected by Zod validation.
  - **Image** — upload to Cloudinary, copy-to-clipboard, download, and view full-size. Thumbnails use on-the-fly Cloudinary transforms (`c_limit,w_520,f_auto,q_auto`).
  - **File** — any non-image file (documents, archives, audio, video) stored in a **private** Cloudflare R2 bucket. Uploaded straight from the browser with a presigned PUT and progress bar; downloaded through an ownership-checked redirect that preserves the original filename.
- **In-app previews** for attachments, mounted only when asked for so a chat full of files doesn't fetch them all on load:
  - **PDF** renders in an iframe served straight from Cloudflare's edge, so range requests let page 1 appear without downloading the whole document.
  - **Video / audio** use the native players, also range-served.
  - **Text, code, CSV, logs** are read through a bounded `Range` request (first 512 KB) and rendered as escaped text — previewing a 50 MB log costs one small read.
  - **Word / Excel / PowerPoint** are download-only. Browsers can't render them, and the alternative is shipping a signed URL to Microsoft's or Google's viewer, which would send private files to a third party.
- **Installable (PWA)** — web app manifest with maskable icons, a static-asset service worker, and safe-area handling so it behaves correctly in standalone mode.
- **Cross-device sync** — MongoDB Atlas stores everything per-user. Log in on any device and your chats and notes are there.
- **Opens at latest chat** — the most recently updated chat is selected on load.
- **Input methods** — type, paste (the clipboard `paste` handler picks up images *and* files), drag-and-drop, or the attach button. Images route to Cloudinary and everything else to R2 automatically.
- **Per-note delete** within a chat; **per-chat delete** removes the chat and all its notes, cleaning up both Cloudinary assets and R2 objects after the response is flushed.
- **Responsive** — split-pane on desktop (chat list | notes + editor), stacked on mobile.
- **Dark mode** — Tailwind `class` strategy, toggle persisted to `localStorage`.
- **Keyboard shortcuts** — `Ctrl/Cmd+Enter` to save a note.
- **Toast notifications** for copy/save/delete via Sonner.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.11 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Database | MongoDB Atlas (free tier M0) via Mongoose 9 |
| Auth | Auth.js v5 (`next-auth@beta`) — Credentials provider, JWT sessions |
| Password hashing | bcryptjs (12 salt rounds) |
| Image hosting | Cloudinary — server-signed direct uploads (no client SDK) |
| Code highlighting | react-syntax-highlighter (`PrismAsyncLight`, lazy-loaded) |
| Icons | lucide-react |
| Toasts | sonner |
| Validation | Zod 4 |

## Local Development Setup

### Prerequisites

- Node.js 20+ (Next.js 16 requires Node 20 or later)
- An `npm` (or compatible) package manager
- A MongoDB Atlas account (free tier works)
- A Cloudinary account (free tier works)

### 1. Clone & install

```bash
git clone <your-repo-url> syncnote
cd syncnote
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# MongoDB Atlas connection string
# Get from: Atlas Dashboard → Connect → Drivers
# Format: mongodb+srv://<username>:<password>@<cluster>.mongodb.net/syncnote?retryWrites=true&w=majority
MONGODB_URI=

# Auth.js secret — generate with:
#   openssl rand -base64 32
AUTH_SECRET=

# Cloudinary credentials — from https://cloudinary.com/console
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Public Cloudinary vars (safe for client bundle)
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
NEXT_PUBLIC_CLOUDINARY_API_KEY=
```

> **Note:** Only `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` and `NEXT_PUBLIC_CLOUDINARY_API_KEY` are exposed to the client. The API **secret** is never sent to the browser — it stays server-side and is used only to sign upload requests.

### 3. Generate AUTH_SECRET

```bash
openssl rand -base64 32
```

Paste the output into `AUTH_SECRET` in `.env.local`.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login`.

### 5. Create an account

Click "Sign up", choose a username (3–20 chars) and password (8+ chars), and you're in.

## Environment Variables Reference

| Variable | Required | Public? | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | ✅ | No | MongoDB Atlas connection string |
| `AUTH_SECRET` | ✅ | No | JWT signing secret (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | ✅ | Yes | Cloudinary cloud name — used to build image delivery URLs |
| `CLOUDINARY_API_KEY` | ✅ | No | Cloudinary API key (returned to the client only as part of a signed upload) |
| `CLOUDINARY_API_SECRET` | ✅ | No | Cloudinary API secret (server-side only — never in the client bundle) |
| `R2_ACCOUNT_ID` | ✅ | No | Cloudflare account ID, from the bucket's S3 API endpoint |
| `R2_BUCKET` | ✅ | No | R2 bucket name (`copypaste`) |
| `R2_ACCESS_KEY_ID` | ✅ | No | R2 API token access key ID |
| `R2_SECRET_ACCESS_KEY` | ✅ | No | R2 API token secret access key |
| `R2_MAX_FILE_BYTES` | — | No | Max upload size in bytes. Defaults to `104857600` (100MB) |

There is deliberately **no** `NEXT_PUBLIC_CLOUDINARY_API_KEY` and no public R2 URL: the
browser receives the Cloudinary API key only inside a signed-upload response, and R2
objects are never exposed on a public hostname.

## Cloudflare R2 Setup

Files (everything that isn't an image) live in a **private** R2 bucket. Three things
are required, and one common step is deliberately skipped.

### 1. Create an API token

R2 → **API** → **Manage API tokens** → **Create Account API token**

- Permission: **Object Read & Write**
- Scope it to the `copypaste` bucket only (not "all buckets")

Copy the **Access Key ID** and **Secret Access Key** into `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`. The secret is shown once.

### 2. Add a CORS policy

Bucket → **Settings** → **CORS Policy** → **Add CORS policy**. Without this the
browser's preflight fails and uploads are blocked, even though the presigned URL
itself is valid.

```json
[
  {
    "AllowedOrigins": [
      "https://copypaste.aniketpandey.website",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-disposition"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedOrigins` must list the exact deployed origin, scheme included. Only `PUT` is
needed — downloads and previews go through redirects, not cross-origin fetches, so
they never trigger CORS. Note that Vercel preview deployments get generated
hostnames that won't match; add `https://*.vercel.app` if you upload from those.

### 3. Leave public access disabled

Do **not** enable the Public Development URL (`r2.dev`) or attach a custom domain.
The bucket should stay private:

- **Upload** — the browser asks `/api/upload-url` (auth-gated) for a presigned `PUT`
  valid for 15 minutes, then sends the bytes directly to R2. Nothing proxies through
  the app server, so uploads cost no app bandwidth.
- **Download** — the browser hits `/api/files/[noteId]`, which verifies the note
  belongs to the logged-in user and then `302`s to a presigned `GET` valid for 2
  minutes. Because that's a top-level navigation, no CORS configuration is involved.

`Content-Disposition` is written onto the object at upload time, so downloads keep
their original name. R2 does **not** support the `response-content-disposition` query
override on `GetObject`, so the choice is permanent per object and is made from the
file's type:

- `inline` for PDF, image, video and audio — the formats a browser renders natively,
  which is what makes the in-app preview possible.
- `attachment` for everything else.

Text and HTML are deliberately `attachment`. Serving an uploaded `.html` inline from
the storage hostname would make it a stored-XSS vector on that origin, so text
previews are read through `/api/files/[noteId]/text` instead, which returns JSON that
the client renders as escaped text.

> Files uploaded before this behaviour existed were all stored as `attachment`, so
> they download instead of previewing. Re-upload them to get previews.

### Free tier

R2's free allowance is 10 GB-month of storage, 1 million Class A operations (writes)
and 10 million Class B operations (reads) per month, with **no egress charges**.
`DeleteObject` is free. One upload costs 1 Class A op; one download costs 1 Class B
op plus 1 for the ownership `HEAD` performed when the note is created. At those rates
the operation limits are effectively unreachable for personal use — storage is the
only meaningful constraint.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
Content was rephrased for compliance with licensing restrictions.

## Project Structure

```
syncnote/
├── app/
│   ├── (app)/                 # Protected app routes (auth required)
│   │   ├── layout.tsx          # Session check + app shell
│   │   ├── page.tsx            # Server Component: fetches chats + notes
│   │   └── loading.tsx         # Loading skeleton
│   ├── (auth)/                 # Auth pages (login, signup)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  # Auth.js route handler
│   │   ├── notes/route.ts              # GET notes by chatId (auth-gated)
│   │   └── upload-sign/route.ts        # Cloudinary signed upload (auth-gated)
│   ├── layout.tsx              # Root layout
│   └── globals.css
├── actions/
│   ├── auth.ts                 # signupAction, loginAction, logoutAction + rate limiting
│   ├── chats.ts                # createChat, updateChatTitle, deleteChat
│   └── notes.ts                # createNote, deleteNote
├── components/
│   ├── AppShell.tsx            # Orchestrates chat list + note list + editor
│   ├── ChatList.tsx            # Sidebar: chat list, new chat, rename, delete
│   ├── NoteEditor.tsx          # Note input: type selector, textarea, paste/drop upload
│   ├── NoteView.tsx            # Renders notes by type with actions
│   ├── CodeBlock.tsx           # Syntax-highlighted code + copy button
│   ├── ImageBlock.tsx          # Image thumbnail, copy, download, view-full
│   ├── TextBlock.tsx           # Text note + copy
│   ├── LinkBlock.tsx           # Link note + copy + open
│   └── Header.tsx              # Top bar: logo, user menu, logout, dark-mode toggle
├── lib/
│   ├── db.ts                   # Mongoose global-cache connection
│   ├── rateLimit.ts            # In-memory rate limiter (per-IP + per-username)
│   └── types.ts                # Shared TypeScript types
├── models/
│   ├── User.ts                 # { username, passwordHash, createdAt }
│   ├── Chat.ts                 # { userId, title, createdAt, updatedAt }
│   └── Note.ts                 # { userId, chatId, type, content, imageUrl, publicId, language, createdAt }
├── auth.config.ts              # Edge-safe Auth.js config (middleware route protection)
├── auth.ts                     # Full Auth.js config (Credentials provider, bcrypt)
├── middleware.ts               # Route protection middleware
└── next.config.ts
```

## Security

CopyPaste is built security-first. The core invariant: **a user can only ever read or modify their own data — never another user's.**

### Authentication & sessions
- Passwords hashed with bcryptjs (12 salt rounds). Never stored in plaintext, never returned in API responses.
- Auth.js v5 Credentials provider: `authorize()` runs `bcrypt.compare` server-side; returns `null` on any failure (no user enumeration — same error for bad username vs bad password).
- JWT sessions in `httpOnly`, `SameSite=Lax` cookies (Auth.js default) — not readable by JavaScript, not CSRF-leakable across origins.

### Authorization / IDOR prevention
- **Every** server action and API route calls `auth()` to get the session, then scopes **every** Mongoose query by `session.user.id`:
  - `Note.find({ chatId, userId })` — notes are always filtered by the authenticated user.
  - `Note.findOne({ _id, userId })` — delete re-verifies ownership before deleting.
  - `Chat.findOne({ _id, userId })` — chat rename/delete checks ownership.
  - `Note.create({ userId: session.user.id, ... })` — `userId` is always set from the session, never from client input.
- `createNote` additionally verifies the target `chatId` belongs to the authenticated user before creating a note in it.
- `deleteChat` deletes all notes scoped by `{ chatId, userId }` — never by `chatId` alone.
- A client-sent `userId` is **never trusted**.

### Input validation & injection resistance
- All server action inputs validated with Zod schemas at the boundary (username, password, note content/type/language, chat title, IDs).
- MongoDB ObjectId format enforced via Zod regex (`/^[a-f0-9]{24}$/i`) before any query.
- Mongoose enforces field types + the `type` enum; queries use typed ObjectId fields (no raw string interpolation → no NoSQL injection).
- Note `content` is rendered as **text only** (React escapes by default; `react-syntax-highlighter` renders code as escaped tokens). `dangerouslySetInnerHTML` is never used.
- Links are validated as URLs with scheme allowlist (`http`/`https` only) — `javascript:` and `data:` URLs are rejected by Zod and never rendered as `href`.

### Signed uploads
Both upload paths are authorized server-side, and in both cases the **server chooses
the destination** — the client only supplies bytes.

- **Images → Cloudinary.** `/api/upload-sign` returns `401` without a session, then
  generates the `public_id` itself as `u/<userId>/<random>` and signs only the
  parameters it generated.

  This endpoint must never sign caller-supplied parameters. An earlier version
  signed whatever `paramsToSign` object it was handed, which made it a general
  signing oracle: a logged-in user could request a signature for
  `public_id=<another user's asset>` with `overwrite=true` and replace someone
  else's image, or attach arbitrary eager transformations. Uploads also target
  `/image/upload` rather than `/auto/upload`, so Cloudinary rejects non-images.

- **Files → R2.** `/api/upload-url` picks the object key as `f/<userId>/<random>/<name>`,
  enforces the size cap, and returns a 15-minute presigned `PUT`.

- The Cloudinary API **secret** and the R2 **secret access key** never reach the client.

### Attachment ownership
Because the browser uploads directly to storage, the identifiers it sends back when
creating a note are untrusted input. `createNote` verifies every one of them:

- A Cloudinary `publicId` must start with `u/<userId>/`, and `imageUrl` must be an
  `https` URL on `res.cloudinary.com`. Without the prefix check, a user could submit
  another user's `public_id` and destroy their image by deleting their own note.
- An R2 `storageKey` must start with `f/<userId>/`, contain no `..` or `//`, and the
  object must actually exist — verified with a `HEAD`, which also supplies the real
  size and content type instead of the client-reported values. Without this, a user
  could claim `f/<victimId>/…` as their own note and read it through the
  ownership-checked download route.
- The presigned `PUT` doesn't constrain body length, so the size declared at presign
  time is advisory. The `HEAD` is the real check, and an oversized object is deleted
  rather than left consuming the storage quota.

### File downloads
`/api/files/[noteId]` requires a session, looks the note up scoped by `userId`, and
rejects requests whose `Sec-Fetch-Site` indicates a cross-site initiator — so a
hostile page can't make a visitor's browser pull their own files. The signed URL it
redirects to lives for 2 minutes and is served `Cache-Control: private, no-store`.

### Security headers
`next.config.ts` sets a Content Security Policy plus `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`,
`Strict-Transport-Security` and `Cross-Origin-Opener-Policy`. The CSP still needs
`'unsafe-inline'` for scripts because the pre-paint theme script is inline and Next
emits its own inline bootstrap; moving to nonces would mean generating the policy per
request in middleware. Even so it blocks externally-hosted scripts, framing, plugins,
and form submissions to other origins.

### Rate limiting
- Login and signup: per-IP + per-username, 5 attempts per 15 seconds.
- Upload authorization (`/api/upload-url`, `/api/upload-sign`): per-user, 40 per minute — a cap on how fast the free-tier write allowance can be burned.
- Client IP resolution prefers platform headers (`x-vercel-forwarded-for`, `cf-connecting-ip`, `x-real-ip`) over `x-forwarded-for`, which a caller can forge to get a fresh bucket per request. The per-username bucket is the backstop, since no header can change that.
- **Known limitation:** the limiter is in-memory and therefore per-instance, so on a multi-instance deployment the effective limit is multiplied by the instance count. For real brute-force resistance, move it to **Upstash Redis** or **Vercel KV**.

### Secrets & client bundle
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` is the only public value.
- `MONGODB_URI`, `AUTH_SECRET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` all stay server-side.
- `storageKey` is excluded from every note projection sent to the client — downloads go through `/api/files/[noteId]`, so the raw R2 key is never exposed.
- `.env*.local` is in `.gitignore`.

## Deployment

### Vercel (recommended)

1. Push your repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Add all environment variables in the Vercel dashboard (Project Settings → Environment Variables):
   - `MONGODB_URI`
   - `AUTH_SECRET`
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   - `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
   - `NEXT_PUBLIC_CLOUDINARY_API_KEY`
4. Deploy. Vercel auto-detects Next.js.

### MongoDB Atlas

1. Create a free-tier M0 cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Add a database user (Database Access → Add new user).
3. Allow your IP (Network Access → Add IP address). For Vercel, you'll need to allow `0.0.0.0/0` or use Vercel's IP ranges.
4. Get the connection string (Connect → Drivers) and set it as `MONGODB_URI`.
5. The Mongoose global-cache pattern in `lib/db.ts` (`bufferCommands: false`, `maxPoolSize: 10`) prevents connection exhaustion during hot-reload and serverless cold starts.

### Cloudinary

1. Create a free account at [cloudinary.com](https://cloudinary.com).
2. Find your cloud name, API key, and API secret in the [console](https://cloudinary.com/console).
3. Set them as environment variables (see table above).
4. Uploads are signed server-side — the API secret is never exposed to the client.

## Production Hardening Checklist

Before going to production, consider these upgrades:

- [ ] **Distributed rate limiting** — Replace the in-memory limiter with Upstash Redis or Vercel KV for multi-instance deployments.
- [ ] **Secure cookies** — Set `cookies.secure = true` in Auth.js config when serving over HTTPS (Vercel does this automatically).
- [ ] **Shorter JWT expiry** — JWT sessions can't be server-side invalidated. Consider a shorter `maxAge` and refresh strategy.
- [ ] **Upload size limits** — Configure Cloudinary upload presets with max file size and allowed MIME types.
- [ ] **CSRF protection** — Auth.js v5 handles this for server actions; verify your custom API routes (`/api/notes`, `/api/upload-sign`) if you add mutating endpoints.
- [ ] **Monitoring** — Add error tracking (Sentry) and log aggregation.
- [ ] **Database backups** — Enable Atlas backups for production data.

## Performance Optimizations

The database layer has been tuned for fast note loading and minimal overhead:

### Compound indexes (ESR rule)
- **Note**: `{ userId: 1, chatId: 1, createdAt: 1 }` — serves the primary query `Note.find({ userId, chatId }).sort({ createdAt: 1 })` with a single index scan, no in-memory sort. Replaces three separate single-field indexes.
- **Chat**: `{ userId: 1, updatedAt: -1 }` — serves `Chat.find({ userId }).sort({ updatedAt: -1 })` efficiently.

### Lean queries + field projections
- All read paths use `.lean()` — skips Mongoose document hydration (getters, setters, change tracking), returning plain JS objects (2–5× faster, ~5× less memory).
- `.select()` / projection objects on every query fetch only the fields the client needs — no over-fetching.

### Query result caps
- `.limit(500)` on note fetches and `.limit(200)` on chat list — prevents unbounded scans on very old accounts while being well above any realistic usage.

### Collapsed multi-query patterns
- `deleteNote` uses `findOneAndDelete` (single atomic op) instead of `findOne` + `deleteOne` (two round-trips).
- `updateChatTitle` uses `findOneAndUpdate` with `{ new: true }` instead of `findOne` + `save()`.
- `updateNote` uses `findOneAndUpdate` instead of fetch-modify-save.
- `deleteChat` uses `findOneAndDelete` for the chat, then `deleteMany` for notes.

### Parallel Cloudinary cleanup
- `deleteChat` now runs all `cloudinary.v2.uploader.destroy()` calls concurrently via `Promise.allSettled` instead of sequentially — significantly faster when a chat has multiple image notes.

### Connection pool tuning
- `minPoolSize: 1` keeps a warm connection ready for the first request after idle.
- `connectTimeoutMS: 10000` and `socketTimeoutMS: 45000` prevent hung connections from blocking the pool.

### Auth query optimization
- `authorize()` in `auth.ts` uses `.select({ passwordHash: 1 })` — fetches only the hash needed for bcrypt comparison, not the full user document.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Turbopack) on `localhost:3000` |
| `npm run build` | Production build (typecheck + lint + build) |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## License

Private project.
