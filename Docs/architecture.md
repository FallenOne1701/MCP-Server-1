# Architecture — Google Workspace MCP Server

## 1. Purpose

This document defines the architecture for a **generic Model Context Protocol (MCP) server** that lets any MCP-compatible AI agent interact with Google Workspace through three capabilities:

| Capability | MCP Tool | Side effect |
|---|---|---|
| Create Gmail draft | `gmail_create_draft` | Writes a draft (not sent) |
| Send Gmail email | `gmail_send_email` | Sends email externally |
| Append to Google Doc | `google_docs_append_content` | Mutates document content |

The server is an integration boundary: agents supply structured intent; the server owns OAuth, Google API calls, validation, error normalization, and safe responses. Google credentials and tokens never leave the server.

**Source requirements:** [problemStatement.md](./problemStatement.md)

---

## 2. Design Principles

1. **Agent-agnostic contracts** — Tool names, schemas, and responses must work for any MCP client, not a single product.
2. **Least privilege** — Prefer narrow Google OAuth scopes (`gmail.compose`, `drive.file` where possible).
3. **Separation of concerns** — MCP handlers orchestrate; providers talk to Google; auth is isolated; validation is shared.
4. **Predictable outcomes** — Every tool returns a structured success or normalized error; never leak secrets or stack traces to clients.
5. **Hide Google complexity** — Agents must not deal with MIME, base64url, token refresh, Docs indexes, or raw Google error shapes.
6. **Extensibility without redesign** — New Workspace tools should plug in as new MCP tools + provider methods on the same auth and server core.
7. **Safe side effects** — Send vs draft are separate tools; send is explicitly documented as an external side effect.

---

## 3. System Context

```text
┌──────────────────────┐
│  MCP-compatible      │
│  AI Agent / Client   │
└──────────┬───────────┘
           │ MCP (stdio or network transport)
           ▼
┌──────────────────────────────────────────┐
│           MCP Server (this project)      │
│  Tools · Validation · Auth · Providers   │
└──────────┬───────────────────┬───────────┘
           │                   │
           ▼                   ▼
     Gmail API           Google Docs API
     (Google Cloud OAuth 2.0)
```

**Trust boundary:** Everything inside the MCP server is trusted with Google credentials. The MCP client is untrusted for secrets and must only receive sanitized tool results.

---

## 4. Logical Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        MCP Server                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Transport / Server bootstrap                       │    │
│  │  (MCP SDK, tool registration, lifecycle)            │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │  MCP Tool Layer                                     │    │
│  │  gmail_create_draft · gmail_send_email ·            │    │
│  │  google_docs_append_content                         │    │
│  │  (descriptions, JSON Schema, handler entry points)  │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │  Validation & Error Normalization                   │    │
│  │  email/doc input checks · shared error codes        │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │  Google Auth Manager / Credential Provider          │    │
│  │  OAuth 2.0 · token store · refresh · account ctx    │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│              ┌──────────────┴──────────────┐                │
│              ▼                             ▼                │
│  ┌─────────────────────┐     ┌─────────────────────┐        │
│  │  Gmail Provider     │     │  Docs Provider      │        │
│  │  MIME · drafts ·    │     │  batchUpdate ·      │        │
│  │  messages.send      │     │  endOfSegment ·     │        │
│  └──────────┬──────────┘     │  WriteControl       │        │
│             │                └──────────┬──────────┘        │
└─────────────┼───────────────────────────┼───────────────────┘
              ▼                           ▼
         Gmail API                  Google Docs API
```

### Layer responsibilities

| Layer | Responsibility | Must not |
|---|---|---|
| **Transport / Server** | Start MCP runtime, register tools, wire config/logging | Contain Google API details |
| **MCP Tools** | Map agent calls → validated domain ops; return structured results | Hold OAuth tokens or raw `googleapis` calls |
| **Validation** | Enforce schemas, email format, non-empty content | Call external APIs |
| **Auth Manager** | OAuth flow, token persistence/refresh, authorized client | Be invoked from the agent with raw tokens |
| **Providers** | Gmail MIME + API; Docs append + concurrency controls | Know MCP protocol details |
| **Observability** | Structured logs with correlation IDs | Log bodies, tokens, or secrets |

---

## 5. Recommended Project Structure

Language is not mandated. Prefer **TypeScript + official MCP TypeScript SDK** or **Python + official MCP Python SDK** (see §13). Layout below is language-agnostic:

```text
src/
  server.*                 # MCP server bootstrap & transport
  config/                  # env loading, defaults, feature flags
  mcp/
    tools/
      gmail_create_draft.*
      gmail_send_email.*
      google_docs_append_content.*
    schemas/               # shared JSON Schema / Zod / Pydantic models
  providers/
    google/
      auth.*               # OAuth + token storage + client factory
      gmail.*              # drafts.create, messages.send, MIME
      docs.*               # documents.batchUpdate append
  validation/              # email addresses, shared input rules
  errors/                  # error codes, mapping from Google/HTTP
  logging/                 # structured logger, redaction helpers
tests/
  unit/
  integration/             # optional; live Google or recorded fixtures
Docs/
  problemStatement.md
  architecture.md
.env.example
README.md
```

**Rule:** Tool modules call providers through interfaces; providers never import MCP transport types.

---

## 6. Internal Interfaces

Keep Google behind small provider contracts so tools stay thin.

```typescript
// Conceptual — adapt to chosen language

interface CreateEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  idempotencyKey?: string; // reserved for future send idempotency
}

interface GmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

interface GmailSendResult {
  messageId: string;
  threadId: string;
}

interface GmailProvider {
  createDraft(input: CreateEmailInput): Promise<GmailDraftResult>;
  sendEmail(input: CreateEmailInput): Promise<GmailSendResult>;
}

interface AppendDocInput {
  documentId: string;
  content: string;
  addNewlineBefore?: boolean;
  addNewlineAfter?: boolean;
}

interface AppendDocResult {
  documentId: string;
  appendedCharacters: number;
}

interface GoogleDocsProvider {
  appendContent(input: AppendDocInput): Promise<AppendDocResult>;
}

interface GoogleAuthProvider {
  getAuthorizedClient(): Promise<AuthorizedGoogleClient>;
  // Future: getAuthorizedClient(accountId: string)
}
```

**Request flow (every tool):**

```text
MCP invoke
  → parse/validate input (reject early → VALIDATION_ERROR / INVALID_ARGUMENT)
  → obtain authorized Google client (fail → AUTHENTICATION_REQUIRED / AUTHORIZATION_DENIED)
  → provider call
  → map success → { success: true, …, provider }
  → map failure → { success: false, error: { code, message } }
  → log outcome (no sensitive payloads)
```

---

## 7. MCP Tool Contracts

### 7.1 `gmail_create_draft`

- **When to use:** Prepare email without sending.
- **Inputs:** `to` (required, ≥1 valid email), optional `cc`/`bcc`, required `subject`/`body`, `is_html` default `false`.
- **Behavior:** Build RFC-compliant MIME → Gmail drafts API.
- **Success:** `{ success, draft_id, message_id, thread_id, provider: "gmail" }`

### 7.2 `gmail_send_email`

- **When to use:** Send immediately on behalf of the authenticated user.
- **Inputs:** Same shape as draft.
- **Behavior:** Build MIME → Gmail `messages.send`. Do not silently demote to draft.
- **Side effect:** External; tool description must state this clearly.
- **Idempotency (v1):** Not guaranteed; document clearly. Architecture reserves optional `idempotency_key` for later.
- **Success:** `{ success, message_id, thread_id, provider: "gmail" }`

### 7.3 `google_docs_append_content`

- **When to use:** Append text to an existing doc by ID only (no URL, no index math).
- **Inputs:** required `document_id`, non-empty `content`; optional `add_newline_before` / `add_newline_after`.
- **Behavior:** `documents.batchUpdate` with `InsertTextRequest` at `endOfSegmentLocation` (body). Normalize newlines without creating excessive blank lines.
- **Concurrency:** Prefer `WriteControl` / revision awareness when useful so stale state fails loudly rather than applying blindly.
- **Success:** `{ success, document_id, appended_characters, provider: "google_docs" }`

Tool metadata must include: purpose, when to use, required/optional params, side effects, success meaning, and common failures.

---

## 8. Google API Integration

### 8.1 Gmail

| Concern | Approach |
|---|---|
| Message format | MIME via a standard email library (plain or HTML per `is_html`) |
| Encoding | base64url for Gmail API wire format |
| Draft | Gmail drafts endpoint |
| Send | Gmail messages send endpoint |
| Scope | `https://www.googleapis.com/auth/gmail.compose` |

Do not request broader Gmail scopes unless a future feature requires them.

### 8.2 Google Docs

| Concern | Approach |
|---|---|
| Append | `InsertTextRequest` + `endOfSegmentLocation` |
| Optional read | `documents.get` only if needed for WriteControl / diagnostics |
| Scope | Prefer `https://www.googleapis.com/auth/drive.file`; use `documents` only if the auth UX cannot work with the narrower scope |

### 8.3 Out of scope (v1)

Reading/searching mail, attachments, labels, creating/deleting docs, range edits, Drive folder management, Calendar, Contacts, admin APIs. These must not force changes to the core auth/server architecture when added later.

---

## 9. Authentication & Account Model

### 9.1 OAuth 2.0

- Client ID/secret and redirect URI from environment or a secret manager — never hard-coded or committed.
- Access tokens refreshed automatically; refresh tokens stored securely when persistence is required.
- Auth failures return actionable, secret-free errors.

### 9.2 Suggested configuration

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_TOKEN_STORAGE=          # path or backend identifier
MCP_SERVER_PORT=               # if using HTTP/SSE transport
LOG_LEVEL=
```

Exact names may vary; configuration remains environment-driven. Ship `.env.example` and README setup steps.

### 9.3 Account model

**v1:** One authenticated Google user per server instance / credential store.

**Forward-compatible path:**

```text
Agent request → MCP server → Credential provider → Google account context → Gmail/Docs APIs
```

Tool contracts must not hard-code “single account.” Do not expose access tokens to the MCP client. Multi-account / per-user OAuth can later extend the credential provider without renaming tools.

---

## 10. Error Model

Normalize all failures into MCP-friendly payloads:

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Google account authorization is required."
  }
}
```

| Code | Typical cause |
|---|---|
| `INVALID_ARGUMENT` | Malformed parameters |
| `VALIDATION_ERROR` | Schema/business validation (empty `to`, bad email, empty content) |
| `AUTHENTICATION_REQUIRED` | No/expired credentials needing user auth |
| `AUTHORIZATION_DENIED` | Insufficient Google permissions |
| `RESOURCE_NOT_FOUND` | Unknown document ID, etc. |
| `RATE_LIMITED` | Google quota / rate limits |
| `GOOGLE_API_ERROR` | Other Google API failures |
| `NETWORK_ERROR` | Connectivity / timeouts |
| `INTERNAL_ERROR` | Unexpected server faults |

**Never return to clients:** client secrets, access/refresh tokens, auth headers, or internal stack traces (stack traces may stay in server-side logs under privacy rules).

**Unknown send outcome:** Do not claim success if Gmail’s result is indeterminate.

---

## 11. Cross-Cutting Concerns

### 11.1 Security

- OAuth 2.0 + least-privilege scopes + secure token storage.
- Validate all inputs server-side; sanitize email addresses; reject empty recipient arrays.
- No arbitrary HTTP proxying via tool parameters.
- Agents cannot supply OAuth tokens.
- HTTPS for production; keep dependencies current.
- Send remains an explicit side effect (clients may add confirmation UX; the server does not invent draft-fallback behavior).

### 11.2 Logging & observability

Structured logs should include: timestamp, tool name, correlation ID, success/failure, provider, error category, latency.

**Do not log by default:** full email bodies, tokens, client secrets, authorization headers.

### 11.3 Concurrency (Docs)

Expect concurrent editors. Keep appends small/atomic; use revision/`WriteControl` where it improves safety.

### 11.4 Idempotency (Gmail send)

v1 may document non-idempotent send. Design inputs so an optional `idempotency_key` can be added without breaking clients.

---

## 12. Runtime & Deployment

### Local development flow

1. Google Cloud project → enable Gmail API + Docs API  
2. OAuth consent screen + OAuth client credentials  
3. Configure env → run MCP server → complete Google authorization  
4. Connect MCP client → exercise the three tools  

### Deployment posture

Local-first is fine; architecture must allow remote deploy:

- HTTPS, secret manager, persistent token storage  
- Authenticate callers to the MCP endpoint (do not expose unauthenticated public endpoints)  
- Rate-limit abuse-prone operations; audit externally visible actions (especially sends)  
- Follow the chosen official MCP SDK and current stable MCP specification (avoid deprecated protocol behavior)

---

## 13. Technology Choices

| Priority | Criterion |
|---|---|
| 1 | Official MCP SDK support |
| 2 | Mature Google API client libraries |
| 3 | Strong schema validation |
| 4 | Easy local setup |
| 5 | Maintainability |

**Option A — TypeScript / Node.js (recommended default):** TypeScript, Node.js, official MCP TypeScript SDK, `googleapis`, Zod (or equivalent).

**Option B — Python:** Official MCP Python SDK, `google-api-python-client`, Pydantic.

Pick one stack for the whole server; keep provider interfaces stable so a language choice does not leak into tool contracts.

---

## 14. Testing Strategy

| Layer | Focus | Google APIs |
|---|---|---|
| **Unit** | Validation, MIME construction, newline normalization, error mapping, tool schema shape | Mocked |
| **Integration** | Real or recorded OAuth/API paths | Isolated from default CI |
| **MCP** | Tool discovery, schema validation, invoke success/error, no credential leakage in outputs | Mocked providers |

**Gmail cases:** valid draft/send, invalid recipients, missing subject/body, multi To/CC/BCC, plain vs HTML, auth/permission/API failures.

**Docs cases:** valid append, empty content, bad document ID, auth/permission failures, newline flags, sequential appends, stale/concurrent handling where supported.

---

## 15. Extension Path

Add future tools as new MCP tool modules + provider methods without changing core auth or transport:

```text
gmail_search_messages · gmail_get_message · gmail_reply_to_email
google_docs_read_content · google_docs_create_document · google_docs_update_text
google_drive_find_file
google_calendar_create_event · google_calendar_list_events
```

Naming stays stable and descriptive (`gmail_*`, `google_docs_*`) — no application-specific prefixes.

---

## 16. Acceptance Mapping

Architecture is successful when implementation can satisfy:

- MCP: start, discover tools, explicit schemas, useful descriptions, structured results/errors  
- Gmail: draft + send, To/CC/BCC, plain + HTML, secure auth, normalized failures  
- Docs: append by ID + content only, server-owned indexes, correct newlines, clean auth/permission errors, concurrency considered  
- Security: no hard-coded secrets, no tokens to client, least privilege, redacted logs  
- Maintainability: providers separate from tools, auth isolated, tests for success/failure, README + `.env.example`

---

## 17. Guiding Summary

```text
Agent thinks:  "Draft / send this email" · "Append this text to that doc"
Server owns:   MIME · OAuth refresh · Docs indexes · Google error shapes · safe responses
```

Deliverable: a **reusable Google Workspace MCP server** any MCP-compatible agent can use safely and predictably.
