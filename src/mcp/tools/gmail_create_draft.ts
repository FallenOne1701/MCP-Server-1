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

export const GMAIL_CREATE_DRAFT_DESCRIPTION = `Create a draft email in the authenticated user's Gmail account without sending it.

When to use:
- The agent should prepare an email for later review or sending.
- Prefer this over gmail_send_email when the user has not confirmed sending.

Required parameters: to (non-empty array of valid emails), subject, body.
Optional: cc, bcc, is_html (default false).

Side effects: Creates a Gmail draft only. Does not send the email.

Success: Returns draft_id, message_id, thread_id, and provider "gmail".
Common failures: VALIDATION_ERROR (bad emails/missing fields), AUTHENTICATION_REQUIRED, AUTHORIZATION_DENIED, GOOGLE_API_ERROR.`;

export async function handleGmailCreateDraft(
  gmail: GmailProvider,
  args: unknown,
  logger: Logger = createLogger("info"),
): Promise<ToolResult<{
  draft_id: string;
  message_id: string;
  thread_id: string;
}>> {
  const correlationId = newCorrelationId();
  const log = logger.child({ tool: "gmail_create_draft", correlationId });
  const started = Date.now();

  try {
    const input = parseOrThrow(emailInputSchema, args);
    const result = await gmail.createDraft({
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
      draft_id: result.draftId,
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
