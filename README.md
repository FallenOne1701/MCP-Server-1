# Google Workspace MCP Server

Generic [Model Context Protocol](https://modelcontextprotocol.io/) server that lets any MCP-compatible AI agent:

- **Create Gmail drafts** (`gmail_create_draft`)
- **Send Gmail email** (`gmail_send_email`) — external side effect
- **Append text to a Google Doc** (`google_docs_append_content`)

Google OAuth tokens stay inside this server. Agents never see client secrets or access tokens.

See [Docs/architecture.md](Docs/architecture.md) and [Docs/problemStatement.md](Docs/problemStatement.md).

## Requirements

- Node.js 20+
- A Google Cloud project with **Gmail API** and **Google Docs API** enabled
- OAuth 2.0 Desktop or Web client credentials

## Setup

### 1. Install

```bash
npm install
```

### 2. Google Cloud

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Gmail API** and **Google Docs API**.
3. Configure the OAuth consent screen (add your Google account as a test user if the app is in testing).
4. Create OAuth client credentials (Desktop app is simplest for local use).
5. Add authorized redirect URI: `http://localhost:3000/oauth2callback` (or match `GOOGLE_REDIRECT_URI`).

### 3. Environment

```bash
cp .env.example .env
```

Fill in:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_TOKEN_STORAGE=.tokens/google-token.json
LOG_LEVEL=info
```

### 4. Authorize once

```bash
npm run auth
```

This opens a browser for Google consent and writes tokens to `GOOGLE_TOKEN_STORAGE`.

Default scopes:

- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/documents`

(`documents` is used so agents can append by document ID. Override with `GOOGLE_SCOPES` if needed.)

### 5. Run

```bash
npm run build
npm start
```

Development (TypeScript directly):

```bash
npm run dev
```

## Cursor / MCP client config

Example Cursor MCP settings (stdio):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["C:/Users/dhruv/MCP Server 1/dist/server.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3000/oauth2callback",
        "GOOGLE_TOKEN_STORAGE": "C:/Users/dhruv/MCP Server 1/.tokens/google-token.json",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Or point `command` at `npx tsx` and `args` at `src/server.ts` during development.

## Tools

| Tool | Purpose |
|---|---|
| `gmail_create_draft` | Create a draft (does not send) |
| `gmail_send_email` | Send email immediately (not idempotent in v1) |
| `google_docs_append_content` | Append text at end of doc body by `document_id` |

Structured responses look like:

```json
{ "success": true, "draft_id": "...", "message_id": "...", "thread_id": "...", "provider": "gmail" }
```

or:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

## Deploy on Railway

Remote hosting uses **Streamable HTTP** (not stdio). Full checklist: [Docs/deployment-plan.md](Docs/deployment-plan.md).

Summary:

1. Build/start: `npm run build` then `npm run start:http` (Railway Start Command).
2. Set Railway variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`https://<domain>/oauth2callback`), `MCP_API_KEY`, and either `GOOGLE_REFRESH_TOKEN` or a Volume + `GOOGLE_TOKEN_STORAGE=/data/token.json`.
3. Health check path: `/health`.
4. First Google login: temporarily set `ENABLE_OAUTH_SETUP=true`, visit `/oauth/start`, then disable setup and prefer storing the refresh token in `GOOGLE_REFRESH_TOKEN`.
5. Point MCP clients at `https://<domain>/mcp` with `Authorization: Bearer <MCP_API_KEY>`.

Local HTTP smoke test:

```bash
MCP_API_KEY=dev-secret npm run dev:http
curl http://127.0.0.1:3000/health
```

## Scripts

| Command | Description |
|---|---|
| `npm run auth` | OAuth browser login + token save |
| `npm run dev` | Run stdio server via tsx |
| `npm run dev:http` | Run Streamable HTTP server via tsx |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled stdio server |
| `npm run start:http` | Run compiled HTTP server (Railway) |
| `npm test` | Unit tests (mocked Google APIs) |
| `npm run typecheck` | TypeScript check |

## Project layout

```text
src/
  server.ts                 # MCP stdio bootstrap
  http.ts                   # Streamable HTTP + /health + bearer auth
  app.ts                    # Shared createAppServer / providers
  config/                   # env-driven configuration
  mcp/tools/                # MCP tool handlers
  mcp/schemas/              # Zod input schemas for tools
  providers/google/         # OAuth, Gmail, Docs
  validation/               # email/doc validation
  errors/                   # normalized error codes
  logging/                  # structured stderr logging (redacted)
  scripts/auth.ts           # local OAuth helper
tests/unit/                 # vitest unit tests
```

## Security notes

- Never commit `.env` or token files.
- Logs go to **stderr** (stdout is reserved for MCP) and redact tokens/secrets/bodies.
- `gmail_send_email` is an external side effect; clients should confirm with the user when appropriate.
