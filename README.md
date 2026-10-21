# CopyPaste

A fast, private, Notion-style workspace for everything you move between devices — text, code, links, images and files. Write or paste on your laptop, open the same page on your phone, copy what you need.

## Features

### Pages
- **Nested pages** in a sidebar tree — expand/collapse, drag to reorder or nest (long-press on touch), "Move to…" picker, sub-page list at the bottom of every page.
- **Favorites**, **emoji icons**, **full-width** layout, **duplicate**, **copy link**, **export / copy as Markdown**.
- **Trash** with undo, restore and permanent delete. Trashed pages are purged after 30 days.
- **Breadcrumbs**, deep links (`/?p=<pageId>`), browser back/forward, and the app reopens your most recently edited page.
- Untitled pages title themselves from their first content, as chats used to.

### Blocks
- Text, Heading 1–3, To-do, Bulleted list, Numbered list, Toggle, Quote, Callout, Code (syntax-highlighted, 24 languages), Link bookmark, Divider, Image, File, and legacy file groups.
- **Slash menu** (`/`) with filtering and keyboard navigation.
- **Markdown shortcuts**: `#`, `##`, `###`, `-`, `1.`, `[]`, `[x]`, `>` (toggle), `"` (quote), `!` (callout), ` ``` ` (code), `---` (divider).
- **Inline formatting** rendered safely: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[label](url)`, auto-linked URLs. `⌘B`, `⌘I`, `⌘E`, `⌘⇧S`; pasting a URL over selected text makes it a link.
- **Nesting** with `Tab` / `⇧Tab`; toggles collapse their children.
- **Drag and drop** blocks (and their children) with a drop indicator and auto-scroll, or drop them on a page in the sidebar to move them there.
- **Multi-select** (`Esc`, `⇧Click`, `⇧↑/↓`, `⌘A`) then delete, duplicate (`⌘D`), copy (`⌘C`), move (`⌘⇧↑/↓`), recolor or turn into another type.
- **Block menu** (click the ⋮⋮ handle): turn into, color, copy, duplicate, move to page, move up/down, split a legacy group, download, delete. Deleting offers **Undo**.
- **Uploads anywhere**: paste or drop files onto the page, use `/image` or `/file`, or the mobile toolbar. Each file becomes its own block with progress, cancel and retry, and keeps uploading while you navigate.
- **Quick capture**: paste anywhere on a page (nothing focused) to append a text, link, image or file block.
- **Previews** for PDF, video, audio and text files, mounted only on demand. Images get copy, download and full-screen view.
- One-tap **copy** on every text block, code block and link.

### Everywhere
- **Optimistic, debounced autosave** through a single ordered queue with retry, a Saving / Saved indicator, and a guard against closing the tab mid-save.
- **Cross-device refresh**: returning to the tab re-syncs pages and the open page.
- **Search** (`⌘K` / `⌘P`) across page titles, block text, captions and file names, with highlighted snippets and jump-to-block.
- **Responsive**: sidebar drawer and a keyboard-aware block toolbar on phones, safe-area aware, installable PWA, dark mode.

## Tech stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MongoDB via Mongoose 9, Auth.js v5 (credentials, JWT), Cloudinary (images), Cloudflare R2 (files), Zod 4, lucide-react, sonner.

## Project structure

```
actions/            Server actions: auth, pages, blocks
app/(app)/          Authenticated workspace route
app/api/            pages, page blocks, trash, search, uploads, file download/preview
components/blocks/  Block renderers (text, code, link, image, file, group…)
components/editor/  Page editor, block row, slash/block menus, mobile toolbar
components/workspace/ Sidebar, page tree, top bar, search, trash, pickers
components/ui/      Popover, menu, dialog, emoji picker
lib/editor/         Pure domain logic: block types, layout, positions, inline parser, markdown
lib/client/         Block store, save queue, pointer drag, textarea helpers, hooks
lib/server/         Auth guard, serializers, data access, attachment verification, quotas, purge
models/             Page (collection `chats`), Block (collection `notes`), Upload, User
```

Existing data needs no migration: chats become top-level pages and notes become blocks. Missing positions are back-filled on first load in their original order.

## Security

The invariant is unchanged: **a user can only ever read or modify their own data.**

- **Every server action** goes through one guard (`lib/server/actions.ts`): session check, per-user write rate limit, Zod validation, and generic error messages. Every query is scoped by the session's `userId`; client-supplied ids are only ever used together with it.
- **Every API route** requires a session, rejects cross-site requests via `Sec-Fetch-Site`, and responds `private, no-store`. Pages that aren't yours return the same 404 as pages that don't exist.
- **Pages**: moves are checked for cycles and a maximum depth; icons come from a fixed allowlist; per-account page and block caps prevent storage abuse.
- **Uploads are reserved server-side**. `/api/upload-url` and `/api/upload-sign` record every key they authorize, enforce a per-user storage quota (`USER_STORAGE_QUOTA_BYTES`, default 2 GB) and a cap on unfinished uploads. A block can only be created from a reservation that belongs to you and hasn't been used. Abandoned reservations are swept and their objects deleted after an hour.
- **R2 presigned PUTs sign `Content-Length`, `Content-Type` and `Content-Disposition`**, so the bytes uploaded must match what was authorized. This closes oversize uploads and the stored-XSS route of uploading HTML with an `inline` disposition.
- **Images are verified with Cloudinary's API** before a block is saved: the server reads the real size and delivery URL instead of trusting the browser.
- **File ownership** is verified on every attachment (`f/<userId>/…` prefix plus `HEAD`). This also fixes a gap where grouped attachments skipped the prefix check.
- **Shared blobs are reference-checked** before deletion, so duplicating a block and deleting one copy never breaks the other.
- **Rendering**: block text is parsed into React elements, never HTML. Links are limited to `http`, `https` and `mailto` and open with `noopener noreferrer`. SVG is treated as a file and never previewed inline.
- **Downloads** still go through `/api/files/[blockId]`, which checks ownership and redirects to a 2-minute signed URL; `storageKey` is never sent to the client.
- Passwords are hashed with bcrypt (12 rounds); login and signup are rate limited per IP and per username.

Known limitation: rate limits are in-memory and per instance. Use Redis/KV for multi-instance deployments.

## Local development

Requires Node.js 20+, MongoDB, a Cloudinary account and a Cloudflare R2 bucket.

```bash
npm install
cp .env.example .env.local
npm run dev
```

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | ✅ | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | ✅ | Server-side only; used to sign uploads and verify images |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | ✅ | Private R2 bucket credentials |
| `R2_MAX_FILE_BYTES` | — | Max file size, default 100 MB |
| `USER_STORAGE_QUOTA_BYTES` | — | Per-user storage quota, default 2 GB |

## Cloudflare R2 setup

1. Create an **Object Read & Write** API token scoped to the bucket.
2. Add a CORS policy (only `PUT` is needed — downloads are top-level redirects):

   ```json
   [
     {
       "AllowedOrigins": ["https://your-domain.example", "http://localhost:3000"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type", "content-disposition"],
       "ExposeHeaders": ["etag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   `Content-Length` is set by the browser and isn't part of the preflight, so it doesn't need listing. Don't add other upload headers without updating this policy — R2 rejects the whole preflight if one is missing.
3. Keep the bucket **private**: no `r2.dev` URL and no custom domain.

`Content-Disposition` is fixed at upload time: `inline` for PDF, image, video and audio (so previews work), `attachment` for everything else. Text previews are read through `/api/files/[blockId]/text` as JSON and rendered as escaped text.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |
