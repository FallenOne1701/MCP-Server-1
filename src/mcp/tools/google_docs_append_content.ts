import type { GoogleDocsProvider } from "../../providers/google/docs.js";
import {
  AppError,
  failureResult,
  normalizeError,
  successResult,
  type ToolResult,
} from "../../errors/index.js";
import { createLogger, newCorrelationId, type Logger } from "../../logging/index.js";
import { appendDocInputSchema, parseOrThrow } from "../../validation/index.js";

export const GOOGLE_DOCS_APPEND_DESCRIPTION = `Append plain text to the end of an existing Google Doc.

When to use:
- Add content to a known document without calculating Google Docs insertion indexes.
- Pass the document ID only (not a full Docs URL).

Required parameters: document_id, content (non-empty).
Optional: add_newline_before (default true), add_newline_after (default false).

Side effects: Mutates the document body by inserting text at the end of the body segment.
Uses revision WriteControl so concurrent edits are detected rather than applied blindly.

Success: Returns document_id, appended_characters, and provider "google_docs".
Common failures: VALIDATION_ERROR (empty content), RESOURCE_NOT_FOUND, AUTHENTICATION_REQUIRED, AUTHORIZATION_DENIED, GOOGLE_API_ERROR (including stale revision).`;

export async function handleGoogleDocsAppendContent(
  docs: GoogleDocsProvider,
  args: unknown,
  logger: Logger = createLogger("info"),
): Promise<ToolResult<{
  document_id: string;
  appended_characters: number;
}>> {
  const correlationId = newCorrelationId();
  const log = logger.child({
    tool: "google_docs_append_content",
    correlationId,
  });
  const started = Date.now();

  try {
    const input = parseOrThrow(appendDocInputSchema, args);
    const result = await docs.appendContent({
      documentId: input.document_id,
      content: input.content,
      addNewlineBefore: input.add_newline_before,
      addNewlineAfter: input.add_newline_after,
    });

    log.info("Tool succeeded", {
      success: true,
      provider: "google_docs",
      latencyMs: Date.now() - started,
    });

    return successResult("google_docs", {
      document_id: result.documentId,
      appended_characters: result.appendedCharacters,
    });
  } catch (err) {
    const appErr = err instanceof AppError ? err : normalizeError(err);
    log.error("Tool failed", {
      success: false,
      provider: "google_docs",
      errorCode: appErr.code,
      latencyMs: Date.now() - started,
    });
    return failureResult(appErr);
  }
}
