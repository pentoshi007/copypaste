# CopyPaste

A fast, cross-device clipboard & notes sync app. Type or paste text, code, links, or images on your laptop — open the same app on your phone and copy what you need. No more WhatsApp/Telegram round-trips just to move a snippet between devices.

Notes are organized into **chats** (like conversation threads). Each chat auto-titles itself from your first note. The app opens at your most recently active chat — never a blank slate.

## Features

- **Chat-based organization** — Notes live inside chats. Create, rename, and delete chats. Each chat auto-titles from its first note's content.
- **Four note types** with type-specific actions:
  - **Text** — copy to clipboard with one tap.
  - **Code** — syntax-highlighted (Prism) with a copy-block button and language label.
  - **Link** — copy URL or open in a new tab (`rel="noopener noreferrer"`). Only `http`/`https` URLs accepted — `javascript:` and `data:` schemes are rejected by Zod validation.
  - **Image** — upload to Cloudinary, copy-to-clipboard, download, and view full-size. Thumbnails use on-the-fly Cloudinary transforms (`f_auto,q_auto,w_400`).
- **Cross-device sync** — MongoDB Atlas stores everything per-user. Log in on any device and your chats and notes are there.
- **Opens at latest chat** — the most recently updated chat is selected on load.
- **Input methods** — type, paste (clipboard `paste` event auto-detects images), drag-and-drop files, or use the Cloudinary upload widget.
- **Per-note delete** within a chat; **per-chat delete** removes the chat and all its notes (with best-effort Cloudinary asset cleanup).
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
| Image hosting | Cloudinary via `next-cloudinary` SDK (signed uploads) |
| Code highlighting | react-syntax-highlighter (Prism) |
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
| `CLOUDINARY_CLOUD_NAME` | ✅ | No | Cloudinary cloud name (server-side config) |
| `CLOUDINARY_API_KEY` | ✅ | No | Cloudinary API key (server-side only) |
| `CLOUDINARY_API_SECRET` | ✅ | No | Cloudinary API secret (server-side only — never in client bundle) |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | ✅ | Yes | Cloudinary cloud name (client-side upload widget) |
| `NEXT_PUBLIC_CLOUDINARY_API_KEY` | ✅ | Yes | Cloudinary API key (client-side upload widget — not secret) |

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
- Image uploads go through Cloudinary's **signed upload** flow. The client requests a signature from `/api/upload-sign`, which:
  - Returns `401` if no valid session — no anonymous uploads.
  - Signs upload params server-side using `cloudinary.utils.api_sign_request` with the API secret.
- The Cloudinary API **secret** never reaches the client bundle.

### Rate limiting
- Login and signup server actions use an in-memory rate limiter (per-IP + per-username, 5 attempts per 15 seconds) to blunt brute-force and signup flooding.
- This is a **dev-tier** limiter (in-memory, per-instance). For production, upgrade to **Upstash Redis** or **Vercel KV** for distributed rate limiting that survives multi-instance deployments.

### Secrets & client bundle
- Only `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` and `NEXT_PUBLIC_CLOUDINARY_API_KEY` are public (the API key is not secret — only the API secret is).
- `MONGODB_URI`, `AUTH_SECRET`, `CLOUDINARY_API_SECRET` stay server-side.
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

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Turbopack) on `localhost:3000` |
| `npm run build` | Production build (typecheck + lint + build) |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## License

Private project.
