import { z } from "zod";
import { AppError } from "../errors/index.js";

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

function emailArray(field: string, required: boolean) {
  const base = z
    .array(z.string())
    .superRefine((arr, ctx) => {
      if (required && arr.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must contain at least one email address`,
        });
        return;
      }
      for (const [i, addr] of arr.entries()) {
        if (!isValidEmail(addr)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid email in ${field}[${i}]: ${addr}`,
          });
        }
      }
    });

  return required ? base.min(1) : base.optional().default([]);
}

export const emailInputSchema = z.object({
  to: emailArray("to", true),
  cc: emailArray("cc", false),
  bcc: emailArray("bcc", false),
  subject: z.string().min(1, "subject is required"),
  body: z.string().min(1, "body is required"),
  is_html: z.boolean().optional().default(false),
  idempotency_key: z.string().min(1).optional(),
});

export type EmailInput = z.infer<typeof emailInputSchema>;

export const appendDocInputSchema = z.object({
  document_id: z.string().min(1, "document_id is required"),
  content: z.string().min(1, "content is required and must not be empty"),
  add_newline_before: z.boolean().optional().default(true),
  add_newline_after: z.boolean().optional().default(false),
});

export type AppendDocInputParsed = z.infer<typeof appendDocInputSchema>;

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => i.message)
      .join("; ");
    throw new AppError("VALIDATION_ERROR", message);
  }
  return result.data;
}
