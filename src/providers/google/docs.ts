import { google } from "googleapis";
import type { GoogleAuthProvider } from "./auth.js";
import { AppError, normalizeError } from "../../errors/index.js";
import type { Logger } from "../../logging/index.js";

export interface AppendDocInput {
  documentId: string;
  content: string;
  addNewlineBefore?: boolean;
  addNewlineAfter?: boolean;
}

export interface AppendDocResult {
  documentId: string;
  appendedCharacters: number;
}

export interface GoogleDocsProvider {
  appendContent(input: AppendDocInput): Promise<AppendDocResult>;
}

/**
 * Normalize newline options without creating excessive blank lines.
 * - If addNewlineBefore and content does not already start with \n, prefix one.
 * - If addNewlineAfter and content does not already end with \n, suffix one.
 */
export function normalizeAppendText(
  content: string,
  addNewlineBefore: boolean,
  addNewlineAfter: boolean,
): string {
  let text = content;

  if (addNewlineBefore && !text.startsWith("\n")) {
    text = `\n${text}`;
  }
  if (addNewlineAfter && !text.endsWith("\n")) {
    text = `${text}\n`;
  }

  return text;
}

export class GoogleDocsApiProvider implements GoogleDocsProvider {
  constructor(
    private readonly auth: GoogleAuthProvider,
    private readonly logger: Logger,
  ) {}

  async appendContent(input: AppendDocInput): Promise<AppendDocResult> {
    try {
      const auth = await this.auth.getAuthorizedClient();
      const docs = google.docs({ version: "v1", auth });

      const documentId = input.documentId.trim();
      if (!documentId) {
        throw new AppError("VALIDATION_ERROR", "document_id is required");
      }

      const text = normalizeAppendText(
        input.content,
        input.addNewlineBefore ?? true,
        input.addNewlineAfter ?? false,
      );

      // Fetch revision for WriteControl so concurrent edits fail loudly.
      const current = await docs.documents.get({
        documentId,
        fields: "revisionId,documentId",
      });

      const revisionId = current.data.revisionId;
      if (!revisionId) {
        throw new AppError(
          "GOOGLE_API_ERROR",
          "Could not read document revision for safe append.",
        );
      }

      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                text,
                endOfSegmentLocation: {
                  segmentId: "",
                },
              },
            },
          ],
          writeControl: {
            requiredRevisionId: revisionId,
          },
        },
      });

      this.logger.info("Appended content to Google Doc", {
        provider: "google_docs",
        success: true,
        appendedCharacters: text.length,
      });

      return {
        documentId,
        appendedCharacters: text.length,
      };
    } catch (err) {
      throw normalizeError(err);
    }
  }
}
