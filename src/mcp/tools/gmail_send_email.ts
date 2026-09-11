import type { GmailProvider } from "../../providers/google/gmail.js";
import {
  AppError,
  failureResult,
  normalizeError,
  successResult,
  type ToolResult,
} from "../../errors/index.js";
import { createLogger, newCorrelationId, type Logger } from "../../logging/index.js";
import { emailInputSchema, parseOrThrow } from "../../validation/index.js";

export const GMAIL_SEND_EMAIL_DESCRIPTION = `Send an email through Gmail on behalf of the authenticated Google account.

IMPORTANT SIDE EFFECT: This tool actually sends an email. It is not a draft. MCP clients/agents should obtain user confirmation when appropriate before calling this tool. The server will not silently convert a send into a draft.

When to use:
- The user explicitly wants the email delivered now.
- Do not use this to "prepare" an email; use gmail_create_draft instead.

Required parameters: to (non-empty array of valid emails), subject, body.
Optional: cc, bcc, is_html (default false), idempotency_key (reserved; not enforced in v1 — sends are not inherently idempotent).

Success: Returns message_id, thread_id, and provider "gmail".
Common failures: VALIDATION_ERROR, AUTHENTICATION_REQUIRED, AUTHORIZATION_DENIED, RATE_LIMITED, GOOGLE_API_ERROR, NETWORK_ERROR.

Recipient addresses and content are not silently modified.`;

export async function handleGmailSendEmail(
  gmail: GmailProvider,
  args: unknown,
  logger: Logger = createLogger("info"),
): Promise<ToolResult<{
  message_id: string;
  thread_id: string;
}>> {
  const correlationId = newCorrelationId();
  const log = logger.child({ tool: "gmail_send_email", correlationId });
  const started = Date.now();

  try {
    const input = parseOrThrow(emailInputSchema, args);
    const result = await gmail.sendEmail({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
      isHtml: input.is_html,
      idempotencyKey: input.idempotency_key,
    });

    log.info("Tool succeeded", {
      success: true,
      provider: "gmail",
      latencyMs: Date.now() - started,
    });

    return successResult("gmail", {
      message_id: result.messageId,
      thread_id: result.threadId,
    });
  } catch (err) {
    const appErr = err instanceof AppError ? err : normalizeError(err);
    log.error("Tool failed", {
      success: false,
      provider: "gmail",
      errorCode: appErr.code,
      latencyMs: Date.now() - started,
    });
    return failureResult(appErr);
  }
}
