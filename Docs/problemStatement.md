# MCP Server for Gmail and Google Docs

## 1. Problem Statement

We need to build a **generic Model Context Protocol (MCP) server** that enables AI agents to interact with Google Workspace through two core capabilities:

1. **Gmail**
   - Draft an email.
   - Send an email.

2. **Google Docs**
   - Append content to an existing Google Doc.

The MCP server must not be tightly coupled to our current AI agent. It should expose clean, well-described MCP tools that can be consumed by **any MCP-compatible AI agent/client**.

The server should act as a secure integration layer between an AI agent and Google APIs. The AI agent supplies structured intent and content; the MCP server handles Google authentication, API calls, validation, error handling, and normalized responses.

---

## 2. Goals

### Primary Goals

- Implement a standards-compliant MCP server.
- Integrate with Gmail API.
- Integrate with Google Docs API.
- Support creating Gmail drafts.
- Support sending Gmail messages.
- Support appending plain-text content to Google Docs.
- Make the tool interface generic enough for different AI agents.
- Use OAuth 2.0 for Google authentication.
- Keep Google credentials and tokens inside the MCP server/integration layer rather than exposing them to the AI agent.
- Provide predictable, structured success and error responses.
- Make the server easy to run locally and suitable for later deployment.

### Secondary Goals

- Make the implementation modular so more Google Workspace tools can be added later.
- Provide useful tool descriptions/schema so LLMs can understand when and how to call each tool.
- Include logging and diagnostics without leaking email bodies, OAuth tokens, client secrets, or other sensitive information.
- Provide unit/integration tests for the core functionality.
- Provide clear setup and configuration documentation.

---

## 3. Non-Goals

The initial implementation should **not** attempt to become a complete Google Workspace MCP server.

The following are out of scope for the first version:

- Reading/searching Gmail.
- Deleting or modifying Gmail messages.
- Managing Gmail labels or filters.
- Sending attachments unless explicitly required later.
- Creating Google Docs.
- Deleting Google Docs.
- Editing arbitrary ranges in Google Docs.
- Applying advanced Google Docs formatting.
- Managing Google Drive files/folders.
- Calendar integration.
- Contacts integration.
- Administrative/domain-wide Google Workspace management.

These may be added later without redesigning the core architecture.

---

## 4. High-Level Architecture

The expected architecture is:

```text
┌──────────────────────┐
│   MCP-compatible     │
│      AI Agent        │
└──────────┬───────────┘
           │ MCP
           ▼
┌─────────────────────────────┐
│        MCP Server           │
│                             │
│  ┌───────────────────────┐  │
│  │ MCP Tool Definitions  │  │
│  └───────────┬───────────┘  │
│              │              │
│  ┌───────────▼───────────┐  │
│  │ Validation / Errors   │  │
│  └───────────┬───────────┘  │
│              │              │
│  ┌───────────▼───────────┐  │
│  │ Google Auth Manager   │  │
│  └───────────┬───────────┘  │
│              │              │
│       ┌──────┴──────┐       │
│       ▼             ▼       │
│  Gmail Service   Docs Service
└───────┬─────────────┬───────┘
        │             │
        ▼             ▼
    Gmail API      Google Docs API
```

The MCP layer should remain provider-agnostic at the tool-contract level, while the implementation internally uses Google APIs.

---

## 5. MCP Tools

The initial server should expose the following tools.

### 5.1 `gmail_create_draft`

Creates a draft email in the authenticated user's Gmail account.

#### Purpose

Allows an AI agent to prepare an email without sending it.

#### Input Schema

```json
{
  "to": ["recipient@example.com"],
  "cc": ["optional@example.com"],
  "bcc": ["optional@example.com"],
  "subject": "Email subject",
  "body": "Email body",
  "is_html": false
}
```

#### Input Requirements

- `to` is required and must contain at least one valid email address.
- `cc` is optional.
- `bcc` is optional.
- `subject` is required.
- `body` is required.
- `is_html` defaults to `false`.
- Empty recipient arrays should be rejected.
- Email addresses should be validated before calling Gmail.
- The server must prevent malformed MIME messages from being sent to Gmail.

#### Expected Response

```json
{
  "success": true,
  "draft_id": "draft-id",
  "message_id": "message-id",
  "thread_id": "thread-id",
  "provider": "gmail"
}
```

The response should contain enough metadata for the AI agent to refer to the created draft without returning unnecessary Gmail data.

---

### 5.2 `gmail_send_email`

Sends an email through Gmail.

#### Purpose

Allows an AI agent to send an email on behalf of the authenticated Google account.

#### Input Schema

```json
{
  "to": ["recipient@example.com"],
  "cc": ["optional@example.com"],
  "bcc": ["optional@example.com"],
  "subject": "Email subject",
  "body": "Email body",
  "is_html": false
}
```

#### Input Requirements

- `to` is required and must contain at least one valid email address.
- `cc` and `bcc` are optional.
- `subject` is required.
- `body` is required.
- `is_html` defaults to `false`.
- Validate recipient addresses.
- Reject invalid input before contacting Gmail.
- Sending is an external side effect and must be clearly described as such in the MCP tool metadata/description.
- The implementation must not silently modify recipient addresses or email content.

#### Expected Response

```json
{
  "success": true,
  "message_id": "gmail-message-id",
  "thread_id": "gmail-thread-id",
  "provider": "gmail"
}
```

---

### 5.3 `google_docs_append_content`

Appends content to an existing Google Doc.

#### Purpose

Allows an AI agent to add content to the end of a specific Google Doc without requiring the agent to understand Google Docs API indexes.

#### Input Schema

```json
{
  "document_id": "google-document-id",
  "content": "Content to append",
  "add_newline_before": true,
  "add_newline_after": false
}
```

#### Input Requirements

- `document_id` is required.
- `content` is required and must not be empty.
- The server should accept the Google Docs document ID, not require the complete document URL.
- Optional newline controls should be normalized by the server.
- The tool should append content to the document body.
- The AI agent should not need to calculate Google Docs insertion indexes.

#### Expected Response

```json
{
  "success": true,
  "document_id": "google-document-id",
  "appended_characters": 123,
  "provider": "google_docs"
}
```

---

## 6. Google API Implementation

### Gmail

Use the **Gmail API** for both draft creation and sending.

Gmail supports creating messages as MIME content encoded in base64url and then using the appropriate Gmail API endpoint to create/send the message. Draft creation should use the Gmail drafts endpoint; direct sending should use the Gmail messages send endpoint.

Official reference:
https://developers.google.com/workspace/gmail/api/guides/sending

For minimum required functionality, prefer the narrow Gmail OAuth scope:

```text
https://www.googleapis.com/auth/gmail.compose
```

This scope supports managing drafts and sending email.

Do not request broader Gmail scopes unless a future feature genuinely requires them.

Official scope reference:
https://developers.google.com/workspace/gmail/api/auth/scopes

### Google Docs

Use the Google Docs API.

Appending should be implemented using `documents.batchUpdate` with an `InsertTextRequest` targeting the document's `endOfSegmentLocation` for the document body.

The AI agent should not be responsible for calculating document indexes.

Relevant API concepts:

- `documents.get` can be used when the implementation needs the document's current state.
- `documents.batchUpdate` is the primary mutation operation.
- `InsertTextRequest` supports `endOfSegmentLocation`.

Official references:

https://developers.google.com/workspace/docs/api/concepts/document

https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate

https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request

For authorization, prefer:

```text
https://www.googleapis.com/auth/drive.file
```

where compatible with the chosen access flow, because Google documents this as the recommended per-file scope for Docs access.

Only use the broader:

```text
https://www.googleapis.com/auth/documents
```

scope if the implementation specifically requires it and the narrower access model cannot support the chosen UX/authentication flow.

Official scope reference:

https://developers.google.com/workspace/docs/api/auth

---

## 7. Authentication and Authorization

The MCP server must use **OAuth 2.0** for Google API access.

### Requirements

- Google OAuth client credentials must be supplied through environment variables or a secure secret-management mechanism.
- Never hard-code client secrets.
- Never commit OAuth tokens or refresh tokens to source control.
- Access tokens should be refreshed automatically when required.
- Refresh tokens must be stored securely if persistent authentication is required.
- The MCP server should expose a clear authentication/setup process.
- Authentication failures must return actionable errors without exposing secrets.

Google documents server-side OAuth flows for applications that need to access a user's Google data on their behalf.

Official reference:

https://developers.google.com/workspace/gmail/api/auth/web-server

### Suggested environment configuration

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_TOKEN_STORAGE=
MCP_SERVER_PORT=
LOG_LEVEL=
```

The exact variable names may be adjusted during implementation, but configuration should remain environment-driven.

---

## 8. Token and Account Model

The first implementation can assume **one authenticated Google user/account per MCP server instance or configured credential store**.

However, the architecture should not hard-code this assumption into tool contracts.

Design the authentication layer so that multi-account support can be introduced later, for example:

```text
Agent request
    ↓
MCP server
    ↓
Credential provider
    ↓
Google account context
    ↓
Gmail / Docs API
```

Do not expose raw access tokens to the MCP client.

A future version may support multiple Google accounts or per-user OAuth contexts.

---

## 9. Generic MCP Design Requirements

The MCP server must be designed as a reusable server, not as a private API specifically for one AI agent.

### Tool descriptions

Each tool must have a high-quality MCP description that explains:

- What the tool does.
- When the agent should use it.
- Required parameters.
- Optional parameters.
- Important side effects.
- What successful output means.
- Common failure conditions.

Tool schemas should use explicit JSON Schema types and required fields.

### Naming

Use stable, descriptive tool names such as:

```text
gmail_create_draft
gmail_send_email
google_docs_append_content
```

Do not include application-specific prefixes such as:

```text
my_company_gmail_send
internal_agent_send_email
```

unless there is a strong reason.

### Provider abstraction

Keep Google-specific API logic behind service classes/modules.

For example:

```text
src/
  mcp/
    tools/
      gmail_create_draft.*
      gmail_send_email.*
      google_docs_append_content.*
  providers/
    google/
      gmail.*
      docs.*
      auth.*
  validation/
  config/
  errors/
  server.*
```

The exact directory structure may differ depending on the language/framework.

---

## 10. Email Handling

### MIME construction

The implementation should correctly construct RFC-compliant MIME email messages before encoding them for Gmail.

At minimum support:

- Plain-text body.
- Optional HTML body.
- To.
- CC.
- BCC.
- Subject.

Use a standard email/MIME library rather than manually concatenating MIME boundaries wherever the selected programming language provides one.

### HTML

`is_html` should determine the body content type.

Example:

```json
{
  "body": "<p>Hello <strong>John</strong></p>",
  "is_html": true
}
```

The server should not automatically convert arbitrary plaintext into HTML unless explicitly designed to do so.

### Draft vs send

Draft creation and sending must be separate MCP tools.

The AI agent should never have to emulate "draft mode" by asking the send tool not to send.

---

## 11. Google Docs Append Semantics

`google_docs_append_content` should hide Google Docs indexing complexity.

The expected behavior is:

```text
Existing document:
------------------
Line 1
Line 2

AI content:
"Line 3"

Result:
------------------
Line 1
Line 2
Line 3
```

The server should use an end-of-segment insertion rather than making the agent discover a numeric insertion index.

If `add_newline_before=true`, the implementation should ensure the appended content begins on a new line.

If `add_newline_after=true`, the implementation should ensure the appended content ends with a newline.

Avoid accidentally creating excessive blank lines when newline options are used.

---

## 12. Concurrency and Document Consistency

Google Docs can be edited by multiple users concurrently.

The implementation should account for the possibility that the document changes between reads and writes.

Where useful, use Google Docs `WriteControl` / revision handling so the server can detect stale document state rather than silently overwriting an unexpected version.

The append operation itself should be as small and atomic as practical.

Relevant Google documentation:

https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate

---

## 13. Error Handling

Errors should be normalized into a consistent MCP-friendly structure.

Example:

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Google account authorization is required."
  }
}
```

Suggested error categories:

```text
INVALID_ARGUMENT
VALIDATION_ERROR
AUTHENTICATION_REQUIRED
AUTHORIZATION_DENIED
RESOURCE_NOT_FOUND
RATE_LIMITED
GOOGLE_API_ERROR
NETWORK_ERROR
INTERNAL_ERROR
```

Do not expose:

- OAuth client secrets.
- Access tokens.
- Refresh tokens.
- Internal stack traces in normal tool responses.
- Sensitive request headers.

However, server-side logs may contain technical diagnostics subject to the logging/privacy policy.

---

## 14. Idempotency and Duplicate Sends

Email sending has a significant duplicate-send risk.

The implementation should consider an idempotency mechanism for `gmail_send_email`, especially if the MCP client retries requests after a timeout.

A future-compatible design could accept an optional field:

```json
{
  "idempotency_key": "unique-request-id"
}
```

For the first version, it is acceptable to document that `gmail_send_email` is **not inherently idempotent**, provided this limitation is clear and the architecture leaves room to add idempotency later.

Do not falsely report success when the Gmail API result is unknown.

---

## 15. Security Requirements

Security is a first-class requirement because the MCP server can perform external actions on behalf of a user.

### Must-have controls

- OAuth 2.0.
- Least-privilege Google scopes.
- Secure token storage.
- No credentials in source control.
- No sensitive information in debug logs.
- Validate all tool inputs.
- Sanitize/validate email addresses.
- Do not allow arbitrary HTTP requests through MCP tool parameters.
- Do not let the AI agent supply OAuth access tokens directly.
- Do not trust tool inputs as already validated.
- Use HTTPS in production deployments.
- Keep dependencies reasonably current and scan for known vulnerabilities.

### Confirmation / external side effects

Sending an email is an external side effect.

The tool description should make this explicit so MCP clients/agents can decide whether additional user confirmation is appropriate.

The MCP server itself should not silently convert a send request into a draft merely because confirmation is absent.

---

## 16. Observability and Logging

Implement structured logging.

Log useful operational information such as:

```text
timestamp
request/tool name
request correlation ID
success/failure
provider
error category
latency
```

Do not log full email bodies by default.

Do not log access tokens, refresh tokens, client secrets, or authorization headers.

For failures, logs should preserve enough information to debug Google API failures without storing sensitive payloads unnecessarily.

---

## 17. Testing Requirements

Provide automated tests for:

### Gmail

- Valid draft creation.
- Invalid recipient address.
- Missing subject.
- Missing body.
- Multiple recipients.
- CC/BCC.
- Plain-text email.
- HTML email.
- Gmail API authentication failure.
- Gmail API permission failure.
- Draft creation failure.
- Send failure.

### Google Docs

- Valid append.
- Empty content rejection.
- Invalid document ID.
- Authentication failure.
- Permission failure.
- Correct newline behavior.
- Multiple sequential appends.
- Concurrent/stale document handling where supported.

### MCP

- Tool discovery.
- Tool input schema validation.
- Successful tool invocation.
- Normalized error responses.
- No credential leakage in tool outputs.

Mock Google APIs in unit tests.

Use integration tests separately so the test suite does not require live Google credentials for every run.

---

## 18. Local Development

The project should include a simple local development workflow.

Expected developer flow:

```text
1. Create Google Cloud project.
2. Enable Gmail API.
3. Enable Google Docs API.
4. Configure OAuth consent screen.
5. Create OAuth client credentials.
6. Configure environment variables.
7. Run MCP server.
8. Complete Google authorization.
9. Connect an MCP-compatible AI client.
10. Test the three tools.
```

The repository should contain:

```text
README.md
.env.example
problemStatement.md
```

and, depending on implementation language:

```text
package.json / pyproject.toml / equivalent
```

The README should explain how to configure Google Cloud and authenticate.

---

## 19. Deployment Considerations

The first implementation may run locally, but the architecture should not prevent remote deployment.

For production/remote deployment:

- Use HTTPS.
- Store credentials using a secret manager.
- Use persistent secure token storage.
- Add request authentication/authorization appropriate to the deployment environment.
- Avoid exposing an unauthenticated MCP endpoint.
- Rate-limit expensive or abuse-prone operations where appropriate.
- Maintain audit logs for externally visible actions such as sent emails.

The MCP server should be compatible with the current MCP specification and use an officially supported MCP SDK for the chosen language.

The 2026-07-28 MCP specification is the current stable MCP specification as of this document's creation date; implementation should follow the SDK/specification version selected by the developer and avoid relying on deprecated protocol behavior.

Official reference:

https://modelcontextprotocol.io/

---

## 20. Suggested Technology Choices

The implementation language is not strictly mandated.

Preferred options:

### Option A — TypeScript / Node.js

Recommended when the project expects broad JavaScript ecosystem support and easy integration with existing agent tooling.

Potential stack:

```text
TypeScript
Node.js
Official MCP TypeScript SDK
googleapis
Zod or equivalent schema validation
```

### Option B — Python

Also acceptable and appropriate for AI/agent-heavy environments.

Potential stack:

```text
Python
Official MCP Python SDK
google-api-python-client
Pydantic
```

The final choice should prioritize:

1. Current official MCP SDK support.
2. Mature Google API libraries.
3. Strong schema validation.
4. Ease of local setup.
5. Maintainability.

---

## 21. Suggested Internal Interfaces

Keep provider code behind simple interfaces.

Example conceptual interfaces:

```typescript
interface GmailProvider {
  createDraft(input: CreateEmailInput): Promise<GmailDraftResult>;
  sendEmail(input: SendEmailInput): Promise<GmailSendResult>;
}

interface GoogleDocsProvider {
  appendContent(input: AppendDocInput): Promise<AppendDocResult>;
}

interface GoogleAuthProvider {
  getAuthorizedClient(): Promise<AuthorizedGoogleClient>;
}
```

The MCP tool handlers should orchestrate validation and call these providers rather than containing raw Google API logic.

---

## 22. Acceptance Criteria

The project is complete when all of the following are true:

### MCP

- [ ] Server starts successfully.
- [ ] MCP client can discover the available tools.
- [ ] Tool schemas are explicit and valid.
- [ ] Tool descriptions are useful to an arbitrary AI agent.
- [ ] Tools return predictable structured results/errors.

### Gmail

- [ ] AI agent can create a Gmail draft.
- [ ] AI agent can send a Gmail email.
- [ ] To/CC/BCC are supported.
- [ ] Plain-text email works.
- [ ] HTML email works.
- [ ] Gmail authentication is handled securely.
- [ ] Gmail API failures are normalized.

### Google Docs

- [ ] AI agent can append text to a Google Doc using only the document ID and content.
- [ ] Agent does not need to calculate Docs insertion indexes.
- [ ] Newline handling works correctly.
- [ ] Document permission/authentication failures are handled cleanly.
- [ ] Concurrent edit considerations are addressed.

### Security

- [ ] No secrets are hard-coded.
- [ ] No OAuth tokens are exposed to the MCP client.
- [ ] Least-privilege scopes are used where practical.
- [ ] Sensitive payloads are not written to normal logs.

### Maintainability

- [ ] Google API code is separated from MCP tool definitions.
- [ ] Authentication is isolated from business/tool logic.
- [ ] Tests cover success and failure paths.
- [ ] README contains complete local setup instructions.
- [ ] `.env.example` documents required configuration.

---

## 23. Example Agent Interactions

### Draft an email

Agent intent:

```text
Draft an email to alice@example.com with subject "Meeting Follow-up"
and body "Thanks for the meeting today."
```

Expected MCP operation:

```text
gmail_create_draft
```

Expected result:

```json
{
  "success": true,
  "draft_id": "...",
  "message_id": "...",
  "thread_id": "...",
  "provider": "gmail"
}
```

### Send an email

Agent intent:

```text
Send an email to bob@example.com saying the report is ready.
```

Expected MCP operation:

```text
gmail_send_email
```

### Append to a document

Agent intent:

```text
Append this to the project notes document:
"Decision: launch the beta next week."
```

Expected MCP operation:

```text
google_docs_append_content
```

Expected result:

```json
{
  "success": true,
  "document_id": "...",
  "appended_characters": 43,
  "provider": "google_docs"
}
```

---

## 24. Future Extension Path

The architecture should make it straightforward to add future tools such as:

```text
gmail_search_messages
gmail_get_message
gmail_reply_to_email
google_docs_read_content
google_docs_create_document
google_docs_update_text
google_drive_find_file
google_calendar_create_event
google_calendar_list_events
```

These should be implemented as new MCP tools backed by provider modules, without changing the core authentication and server architecture.

---

## 25. Important Implementation Principle

The MCP server should abstract away Google API complexity from the AI agent.

The AI agent should think in terms of:

```text
"Send this email."
"Draft this email."
"Append this content to this document."
```

It should **not** have to understand:

```text
MIME encoding
base64url encoding
Google OAuth token refresh
Google Docs UTF-16 indexes
Google Docs batchUpdate payloads
Google API error formats
```

Those responsibilities belong inside the MCP server.

The result should be a **generic, reusable Google Workspace MCP server** that any MCP-compatible AI agent can use safely and predictably.
