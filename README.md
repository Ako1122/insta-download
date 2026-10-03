# ReelsDl.net

An Astro app for saving media from publicly accessible Instagram reels, photo posts, and public carousels. It never signs into Instagram and does not attempt to access private, login-gated, deleted, or otherwise unavailable content.

Media is resolved in two tiers, fastest first:

1. **Direct GraphQL** — what instagram.com itself does for a logged-out visitor: one page GET to pick up the anonymous session (LSD token + first-visit cookies, cached for 10 minutes), then one `POST` to the web GraphQL API keyed by the post's media id. Typically 1–2s.
2. **Public HTML / embed metadata** — used when Instagram still inlines post JSON into the page.

The `/api/resolve` response includes a `source` field (`graphql` or `html`). Video downloads stream the direct MP4.

Instagram occasionally rotates the GraphQL query id. If the server log starts showing `graphql fast path unavailable … soft-deleted` / `execution error`, set `INSTAGRAM_GRAPHQL_DOC_IDS` to the current `PolarisLoggedOutDesktopWWWPostRootContentQuery` doc id.

## Run locally

```bash
npm install
npm run dev
```

Then visit [http://localhost:4321](http://localhost:4321). Set a long random `DOWNLOAD_TOKEN_SECRET` for any deployment; it signs the short-lived download URLs.

## Deploy on Vercel

1. Install the [Vercel CLI](https://vercel.com/docs/cli) and log in.
2. From this folder: `vercel` for a preview, or `vercel --prod` for production.
3. In the Vercel project settings add:
   - `DOWNLOAD_TOKEN_SECRET` — long random string that signs download tickets
   - `SITE_URL=https://reelsdl.net`
   - `NEXT_PUBLIC_API_URL=https://get.reelsdl.net`

There is a dedicated Instagram audio page at `/instagram-audio-downloader` that extracts MP3 soundtracks from public reels (ffmpeg) or downloads direct audio streams when available.

## Domains

| Host | Role |
|------|------|
| `https://reelsdl.net` | Public website (Cloudflare Worker → Vercel) |
| `https://get.reelsdl.net` | API only (`/api/resolve`, `/api/download`, `/api/health`) on Vercel |

- **reelsdl.net** — Cloudflare Worker route `reelsdl.net/*` (and `www.reelsdl.net/*`). The Worker proxies to `API_ORIGIN = https://get.reelsdl.net` and adds `x-reelsdl-host: reelsdl.net`, which makes Vercel serve the website rather than redirect. Never set it to `reelsdl.net` (loop).
- **get.reelsdl.net** — added as a domain on the Vercel project. Cloudflare DNS: **CNAME** `get` → `cname.vercel-dns.com`, **DNS only** (grey cloud).

Duplicate-content protection — every non-canonical host answers with a **301 to the same path on `https://reelsdl.net`**:

- `get.reelsdl.net/*` except the three API paths (its `robots.txt` only blocks `/api/`, so Google can see the redirects)
- `www.reelsdl.net/*`
- the production `*.vercel.app` hostname, unless the request came through the Worker (`x-reelsdl-host` header)

The API only accepts traffic on `get.reelsdl.net` and only from `https://reelsdl.net`: locked CORS, a signed `__Secure-` site cookie, a required `x-reelsdl-client` header, JSON-only resolve bodies, and HMAC download tickets. API responses carry `X-Robots-Tag: noindex`.

## Project layout

| Path | Role |
|------|------|
| `src/pages/` | Astro pages, `/api/*` endpoints, `robots.txt`, `sitemap.xml` |
| `src/middleware.js` | Host routing, redirects, security headers |
| `components/` | Shared UI (`DownloadPage`, `Downloader`, header, footer, FAQ) |
| `lib/site.jsx` | Page copy, SEO, and FAQ |
| `lib/reelstash.js` | Resolve/download logic (GraphQL, HTML, ffmpeg) |
| `lib/api-guard.js` | API host/origin/cookie checks |
| `worker.js` | Cloudflare Worker: reelsdl.net → Vercel proxy |

## How it works

1. The browser sends an Instagram URL to `POST /api/resolve` (optional `mode: "audio"` on the audio page).
2. The server validates the URL, resolves media (GraphQL → HTML), and returns signed download links.
3. `GET /api/download` streams photos/videos or extracts MP3 audio with ffmpeg when needed.
