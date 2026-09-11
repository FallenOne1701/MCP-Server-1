import type { McpServer } from "@modelcontextprotocol/server";
import type { GmailProvider } from "../providers/google/gmail.js";
import type { GoogleDocsProvider } from "../providers/google/docs.js";
import type { Logger } from "../logging/index.js";
import {
  docsAppendToolInputSchema,
  gmailToolInputSchema,
} from "./schemas/index.js";
import {
  GMAIL_CREATE_DRAFT_DESCRIPTION,
  handleGmailCreateDraft,
} from "./tools/gmail_create_draft.js";
import {
  GMAIL_SEND_EMAIL_DESCRIPTION,
  handleGmailSendEmail,
} from "./tools/gmail_send_email.js";
import {
  GOOGLE_DOCS_APPEND_DESCRIPTION,
  handleGoogleDocsAppendContent,
} from "./tools/google_docs_append_content.js";

function toToolContent(result: unknown) {
  const text = JSON.stringify(result, null, 2);
  const isError =
    typeof result === "object" &&
    result !== null &&
    "success" in result &&
    (result as { success: unknown }).success === false;

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: result as Record<string, unknown>,
    isError,
  };
}

export interface ToolDependencies {
  gmail: GmailProvider;
  docs: GoogleDocsProvider;
  logger: Logger;
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  const { gmail, docs, logger } = deps;

  server.registerTool(
    "gmail_create_draft",
    {
      title: "Create Gmail draft",
      description: GMAIL_CREATE_DRAFT_DESCRIPTION,
      inputSchema: gmailToolInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => toToolContent(await handleGmailCreateDraft(gmail, args, logger)),
  );

  server.registerTool(
    "gmail_send_email",
    {
      title: "Send Gmail email",
      description: GMAIL_SEND_EMAIL_DESCRIPTION,
      inputSchema: gmailToolInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => toToolContent(await handleGmailSendEmail(gmail, args, logger)),
  );

  server.registerTool(
    "google_docs_append_content",
    {
      title: "Append to Google Doc",
      description: GOOGLE_DOCS_APPEND_DESCRIPTION,
      inputSchema: docsAppendToolInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      toToolContent(await handleGoogleDocsAppendContent(docs, args, logger)),
  );
}
