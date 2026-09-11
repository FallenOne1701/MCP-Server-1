import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { GoogleAuthProvider } from "./auth.js";
import { AppError, normalizeError } from "../../errors/index.js";
import type { Logger } from "../../logging/index.js";

export interface CreateEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  idempotencyKey?: string;
}

export interface GmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

export interface GmailSendResult {
  messageId: string;
  threadId: string;
}

export interface GmailProvider {
  createDraft(input: CreateEmailInput): Promise<GmailDraftResult>;
  sendEmail(input: CreateEmailInput): Promise<GmailSendResult>;
}

export async function buildMimeMessage(input: CreateEmailInput): Promise<string> {
  const mail = new MailComposer({
    to: input.to.join(", "),
    cc: input.cc?.length ? input.cc.join(", ") : undefined,
    bcc: input.bcc?.length ? input.bcc.join(", ") : undefined,
    subject: input.subject,
    text: input.isHtml ? undefined : input.body,
    html: input.isHtml ? input.body : undefined,
  });

  const buffer = await mail.compile().build();
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class GoogleGmailProvider implements GmailProvider {
  constructor(
    private readonly auth: GoogleAuthProvider,
    private readonly logger: Logger,
  ) {}

  async createDraft(input: CreateEmailInput): Promise<GmailDraftResult> {
    try {
      const auth = await this.auth.getAuthorizedClient();
      const gmail = google.gmail({ version: "v1", auth });
      const raw = await buildMimeMessage(input);

      const res = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: { raw },
        },
      });

      const draftId = res.data.id;
      const messageId = res.data.message?.id;
      const threadId = res.data.message?.threadId;

      if (!draftId || !messageId || !threadId) {
        throw new AppError(
          "GOOGLE_API_ERROR",
          "Gmail draft was created but required identifiers were missing in the response.",
        );
      }

      this.logger.info("Created Gmail draft", {
        provider: "gmail",
        success: true,
      });

      return { draftId, messageId, threadId };
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async sendEmail(input: CreateEmailInput): Promise<GmailSendResult> {
    try {
      const auth = await this.auth.getAuthorizedClient();
      const gmail = google.gmail({ version: "v1", auth });
      const raw = await buildMimeMessage(input);

      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });

      const messageId = res.data.id;
      const threadId = res.data.threadId;

      if (!messageId || !threadId) {
        // Do not claim success when outcome identifiers are unknown.
        throw new AppError(
          "GOOGLE_API_ERROR",
          "Gmail send completed without message identifiers; outcome is indeterminate.",
        );
      }

      this.logger.info("Sent Gmail message", {
        provider: "gmail",
        success: true,
      });

      return { messageId, threadId };
    } catch (err) {
      throw normalizeError(err);
    }
  }
}
