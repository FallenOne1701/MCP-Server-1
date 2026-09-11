import { z } from "zod";

/** Shared Zod schemas used for MCP tool inputSchema registration. */

export const gmailToolInputSchema = z.object({
  to: z
    .array(z.string())
    .min(1)
    .describe("Required. One or more recipient email addresses."),
  cc: z
    .array(z.string())
    .optional()
    .describe("Optional CC recipient email addresses."),
  bcc: z
    .array(z.string())
    .optional()
    .describe("Optional BCC recipient email addresses."),
  subject: z.string().min(1).describe("Required. Email subject line."),
  body: z.string().min(1).describe("Required. Email body content."),
  is_html: z
    .boolean()
    .optional()
    .default(false)
    .describe("When true, body is treated as HTML. Defaults to false (plain text)."),
  idempotency_key: z
    .string()
    .optional()
    .describe(
      "Optional unique key reserved for future send idempotency. Not enforced in v1.",
    ),
});

export const docsAppendToolInputSchema = z.object({
  document_id: z
    .string()
    .min(1)
    .describe(
      "Required. Google Docs document ID (not the full URL).",
    ),
  content: z
    .string()
    .min(1)
    .describe("Required. Non-empty text to append to the document body."),
  add_newline_before: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "When true, ensure appended content starts on a new line. Defaults to true.",
    ),
  add_newline_after: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, ensure appended content ends with a newline. Defaults to false.",
    ),
});
