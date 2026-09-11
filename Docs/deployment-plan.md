# Deployment Plan — Railway (Google Workspace MCP Server)

## 1. Goal

Deploy this MCP server to **Railway** as a **remote MCP endpoint** over HTTPS so MCP clients (Cursor, Claude, custom agents) can call:

- `gmail_create_draft`
- `gmail_send_email`
- `google_docs_append_content`

without running the server on a developer laptop.

**Local today:** stdio + file-based `token.json`  
**Railway target:** Streamable HTTP + secured public URL + persistent Google token storage

---

## 2. Current gaps (must fix before deploy)

| Gap | Why it blocks Railway | Required change |
|---|---|---|
| **Stdio-only transport** (`src/server.ts`) | Railway is an HTTP service; clients connect by URL, not `node dist/server.js` | Add Streamable HTTP entrypoint (e.g. `src/http.ts`) on `PORT` |
| **File token storage** (`token.json`) | Container filesystem is ephemeral; restarts lose tokens unless persisted | Railway **Volume**, or store refresh token in Railway encrypted variables / external secret store |
| **Desktop OAuth redirect** (`http://127.0.0.1:3000/`) | Loopback redirects do not work for a hosted auth callback | Create/use a **Web** OAuth client with `https://<railway-domain>/oauth2callback` |
| **No MCP caller auth** | A public URL that can send email is dangerous | Require `Authorization: Bearer <MCP_API_KEY>` (or MCP OAuth) on `/mcp` |
| **No health endpoint** | Railway health checks need a simple HTTP GET | Add `GET /health` → `200 ok` |

Tool logic, providers, validation, and error model can stay as-is; transport + auth + token persistence are the deploy work.

---

## 3. Target architecture on Railway

```text
MCP Client (Cursor / Claude / agent)
        │  HTTPS + Bearer token
        ▼
┌──────────────────────────────────────────┐
│  Railway Service (Node 20+)              │
│                                          │
│  GET  /health          → liveness        │
│  GET  /oauth2callback  → Google OAuth    │
│  POST /mcp             → Streamable HTTP │
│       │                  MCP (auth gate) │
│       ▼                                  │
│  Same tool + provider stack as local     │
│       │                                  │
│  Google refresh token (Volume or secret) │
└──────────────────┬───────────────────────┘
                   │
                   ▼
            Gmail API / Docs API
```

- Prefer **stateless Streamable HTTP** (MCP 2026-07-28): no sticky sessions required for protocol state.
- Keep **one Google account per service** for v1 (matches current design). Multi-account later via credential provider, not tool renames.

---

## 4. Phased plan

### Phase 0 — Prerequisites (no code)

1. Railway account + new project/service.
2. GitHub (or GitLab) repo for this project (do **not** commit `.env`, `token.json`, `Credential.json`).
3. Google Cloud project already has Gmail API + Docs API enabled.
4. Decide production Google identity (which Gmail/Docs account the server acts as).

### Phase 1 — Code changes for remote hosting

Implement before first Railway deploy:

1. **HTTP entrypoint** (`src/http.ts` or similar)
   - Listen on `process.env.PORT` (Railway injects this).
   - Framework: Express/Hono/Node adapter from MCP SDK (`@modelcontextprotocol/node` or `/express`).
   - Mount Streamable HTTP MCP at `/mcp`.
   - Keep existing stdio `src/server.ts` for local Cursor stdio use.

2. **Health check**
   - `GET /health` → `{ "status": "ok" }` (no secrets).

3. **Protect `/mcp`**
   - Shared secret: `MCP_API_KEY` in Railway variables.
   - Reject missing/invalid `Authorization: Bearer …` with `401`.
   - Do not put this key in the repo or client-visible logs.

4. **Package scripts / Railway start**
   ```json
   "start:http": "node dist/http.js",
   "build": "tsc"
   ```
   Railway start command: `npm run start:http` (or `node dist/http.js`).
   Build command: `npm run build` (Railway usually runs `npm install` + build automatically if configured).

5. **OAuth callback route for production**
   - Serve `/oauth2callback` on the same service (or a one-off admin path).
   - Exchange code → persist refresh token.
   - Optionally gate this route (e.g. only enable when `ENABLE_OAUTH_SETUP=true`, or require admin secret) so random visitors cannot start OAuth.

6. **Token persistence abstraction**
   - Keep `GoogleOAuthProvider` API.
   - Support at least:
     - **Volume path** (e.g. `/data/token.json` mounted Railway volume), and/or
     - **`GOOGLE_REFRESH_TOKEN` env var** (simplest for single-account v1; rotate via Railway variables).

### Phase 2 — Google Cloud for production

1. Create (or reuse) an OAuth client of type **Web application**.
2. Authorized redirect URI:
   ```text
   https://<your-service>.up.railway.app/oauth2callback
   ```
3. Authorized JavaScript origins (if prompted):
   ```text
   https://<your-service>.up.railway.app
   ```
4. Prefer keeping scopes least-privilege:
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/documents`
5. If the consent screen is in **Testing**, add the production Google user as a test user.
6. Do **not** reuse Desktop-only redirect URIs for Railway.

### Phase 3 — Railway project setup

1. **New Project → Deploy from GitHub** → select this repo.
2. **Settings**
   - Root directory: repo root
   - Node version: **20+** (`engines.node` already set)
   - Build: `npm ci && npm run build` (or Railway Nixpacks default + `npm run build`)
   - Start: `npm run start:http`
3. **Networking**
   - Generate public domain (Railway TLS / HTTPS).
   - Note the URL: `https://<name>.up.railway.app`
4. **Volume** (if using file tokens)
   - Mount e.g. `/data`
   - Set `GOOGLE_TOKEN_STORAGE=/data/token.json`
5. **Health check**
   - Path: `/health`
   - Use Railway’s HTTP health check so bad deploys fail fast.

### Phase 4 — Configure secrets (Railway Variables)

Set these in Railway (never commit):

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Web OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Web OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://<railway-domain>/oauth2callback` |
| `GOOGLE_TOKEN_STORAGE` | `/data/token.json` **or** leave unused if using env refresh token |
| `GOOGLE_REFRESH_TOKEN` | Optional alternate to file storage |
| `MCP_API_KEY` | Bearer token required for `/mcp` |
| `LOG_LEVEL` | `info` (or `warn` in prod) |
| `NODE_ENV` | `production` |
| `PORT` | Set by Railway automatically — do not hardcode |

Optional:

| Variable | Purpose |
|---|---|
| `ENABLE_OAUTH_SETUP` | `true` only while completing first Google login |
| `GOOGLE_SCOPES` | Override default scopes if needed |

**Recommended v1 secret strategy**

1. Run OAuth once (local with prod redirect temporarily, or Railway with `ENABLE_OAUTH_SETUP=true`).
2. Copy the **refresh token** into Railway `GOOGLE_REFRESH_TOKEN`.
3. Disable public OAuth setup route.
4. Rely on automatic access-token refresh at runtime.

### Phase 5 — First deploy & Google authorization

1. Push Phase 1 code; wait for Railway deploy success.
2. Confirm `GET https://<domain>/health` → `200`.
3. Complete Google OAuth once (setup mode or offline token import).
4. Confirm token persistence survives a **Railway restart/redeploy**.
5. Turn off open OAuth setup if it was enabled.

### Phase 6 — Connect MCP clients

Example Cursor / client remote config shape:

```json
{
  "mcpServers": {
    "google-workspace": {
      "url": "https://<your-service>.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

Exact field names vary by client; the important parts are:

- HTTPS URL ending in `/mcp` (or whatever path you mount)
- Transport: Streamable HTTP (not stdio)
- Bearer (or equivalent) auth header

### Phase 7 — Verification checklist

- [ ] `/health` returns OK
- [ ] Unauthenticated `/mcp` → `401`
- [ ] Authenticated client can `tools/list` and sees all three tools
- [ ] `gmail_create_draft` creates a real draft (test account)
- [ ] `gmail_send_email` send works only when intended (confirm side effect)
- [ ] `google_docs_append_content` appends to a known doc ID
- [ ] Invalid email still returns `VALIDATION_ERROR` (not a crash)
- [ ] Logs on Railway show tool name / correlation / success — **no** bodies, tokens, or client secrets
- [ ] Redeploy does **not** require re-auth (refresh token persisted)

---

## 5. Railway-specific notes

### Build & runtime

- Use production install: dependencies in `dependencies` (not only `devDependencies`) for runtime. `typescript` can stay in `devDependencies` if build runs during image build with dev deps available; prefer Railway build that runs `npm ci` including devDependencies for `tsc`, then start with `node dist/http.js`.
- Bind `0.0.0.0` and `process.env.PORT`.
- Log to **stdout/stderr** (Railway captures these). Do not use stdout for MCP protocol framing when using HTTP (HTTP response body carries MCP).

### Scaling

- v1: **1 replica** is enough and safest for single Google account + file volume.
- Streamable HTTP (stateless protocol) can scale later; Google token store must still be shared or per-instance account-scoped.
- Do not enable multiple replicas with a local volume token file unless you switch to shared secret storage.

### Cost / sleep

- If the service sleeps on free/hobby tiers, first MCP call may be slow (cold start). Keep the service awake if agents need low latency, or accept cold-start delay.

### Private networking (optional)

- If only other Railway services call this MCP server, prefer **private networking** and no public domain.
- If Cursor on a laptop must call it, public HTTPS + strong bearer auth is required.

---

## 6. Security requirements (non-negotiable)

1. **Never** commit `Credential.json`, `.env`, `token.json`, or refresh tokens.
2. **Never** expose an unauthenticated `/mcp` that can send email.
3. Use HTTPS only (Railway public domain provides TLS).
4. Rotate `MCP_API_KEY` if leaked; treat it like a password.
5. Keep Google scopes minimal.
6. Rate-limit `/mcp` if exposed publicly (Railway middleware, edge rate limit, or app-level limiter) — especially `gmail_send_email`.
7. Audit/log sends (tool name, correlation ID, success/failure) without logging email bodies.
8. Disable or lock down OAuth callback after initial setup.

---

## 7. Suggested implementation order (engineering tickets)

1. Extract shared `createAppServer()` (register tools + providers) used by stdio and HTTP.
2. Add `src/http.ts` with `/health`, bearer auth, Streamable HTTP `/mcp`.
3. Add token store backend: volume path + optional `GOOGLE_REFRESH_TOKEN`.
4. Add production OAuth callback + setup flag.
5. Update `package.json` scripts + `.env.example` for Railway vars.
6. Add `Docs` note / README “Deploy on Railway” section linking here.
7. Deploy to Railway staging URL → verify → promote.

**Out of scope for first Railway ship (can follow):** multi-account OAuth, Redis token store, full MCP OAuth 2.1 authorization server, attachments, extra Workspace tools.

---

## 8. Rollback plan

1. Railway → previous successful deployment (instant rollback).
2. If Google token corrupted: clear volume/secret → re-run OAuth setup → restore `ENABLE_OAUTH_SETUP=false`.
3. If key leak: rotate `MCP_API_KEY` and Google client secret; revoke old Google grants in Google Account security settings if needed.
4. Local stdio server remains available as fallback for development (`npm run dev`).

---

## 9. Success criteria

Deployment is done when:

- Service is healthy on Railway HTTPS.
- Remote MCP client discovers and invokes all three tools with bearer auth.
- Google actions succeed using persisted credentials across restarts.
- No secrets appear in git, Railway build logs, or MCP tool responses.

---

## 10. Immediate next step

After this plan is accepted, implement **Phase 1** (HTTP transport + `/health` + bearer auth + Railway start script), then proceed to Railway project creation and Phase 2–7.
