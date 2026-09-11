import { describe, expect, it, vi } from "vitest";
import { AppError, normalizeError, failureResult, successResult } from "../../src/errors/index.js";
import { isValidEmail, parseOrThrow, emailInputSchema, appendDocInputSchema } from "../../src/validation/index.js";
import { normalizeAppendText } from "../../src/providers/google/docs.js";
import { buildMimeMessage } from "../../src/providers/google/gmail.js";
import { handleGmailCreateDraft } from "../../src/mcp/tools/gmail_create_draft.js";
import { handleGmailSendEmail } from "../../src/mcp/tools/gmail_send_email.js";
import { handleGoogleDocsAppendContent } from "../../src/mcp/tools/google_docs_append_content.js";
import type { GmailProvider } from "../../src/providers/google/gmail.js";
import type { GoogleDocsProvider } from "../../src/providers/google/docs.js";
import { createLogger } from "../../src/logging/index.js";

const silentLogger = createLogger("error");

describe("email validation", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects empty to array", () => {
    expect(() =>
      parseOrThrow(emailInputSchema, {
        to: [],
        subject: "Hi",
        body: "Hello",
      }),
    ).toThrow(AppError);
  });

  it("rejects missing subject", () => {
    expect(() =>
      parseOrThrow(emailInputSchema, {
        to: ["a@b.com"],
        subject: "",
        body: "Hello",
      }),
    ).toThrow(/subject/i);
  });

  it("rejects missing body", () => {
    expect(() =>
      parseOrThrow(emailInputSchema, {
        to: ["a@b.com"],
        subject: "Hi",
        body: "",
      }),
    ).toThrow(/body/i);
  });

  it("rejects invalid recipient", () => {
    expect(() =>
      parseOrThrow(emailInputSchema, {
        to: ["bad"],
        subject: "Hi",
        body: "Hello",
      }),
    ).toThrow(/Invalid email/);
  });

  it("accepts cc/bcc and defaults is_html", () => {
    const parsed = parseOrThrow(emailInputSchema, {
      to: ["a@b.com"],
      cc: ["c@d.com"],
      bcc: ["e@f.com"],
      subject: "Hi",
      body: "Hello",
    });
    expect(parsed.is_html).toBe(false);
    expect(parsed.cc).toEqual(["c@d.com"]);
  });
});

describe("docs validation", () => {
  it("rejects empty content", () => {
    expect(() =>
      parseOrThrow(appendDocInputSchema, {
        document_id: "doc123",
        content: "",
      }),
    ).toThrow(/content/i);
  });

  it("requires document_id", () => {
    expect(() =>
      parseOrThrow(appendDocInputSchema, {
        document_id: "",
        content: "x",
      }),
    ).toThrow(/document_id/i);
  });
});

describe("normalizeAppendText", () => {
  it("adds newline before when requested", () => {
    expect(normalizeAppendText("Line 3", true, false)).toBe("\nLine 3");
  });

  it("does not double newline before", () => {
    expect(normalizeAppendText("\nLine 3", true, false)).toBe("\nLine 3");
  });

  it("adds newline after when requested", () => {
    expect(normalizeAppendText("Line 3", false, true)).toBe("Line 3\n");
  });

  it("handles both flags", () => {
    expect(normalizeAppendText("Line 3", true, true)).toBe("\nLine 3\n");
  });
});

describe("MIME construction", () => {
  it("builds base64url plain-text MIME", async () => {
    const raw = await buildMimeMessage({
      to: ["alice@example.com"],
      cc: ["cc@example.com"],
      subject: "Meeting",
      body: "Hello Alice",
      isHtml: false,
    });
    expect(raw).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    expect(decoded).toMatch(/To:.*alice@example.com/i);
    expect(decoded).toMatch(/Subject: Meeting/i);
    expect(decoded).toMatch(/Hello Alice/);
    expect(decoded).toMatch(/text\/plain/i);
  });

  it("builds HTML MIME when isHtml", async () => {
    const raw = await buildMimeMessage({
      to: ["bob@example.com"],
      subject: "Hi",
      body: "<p><strong>Hi</strong></p>",
      isHtml: true,
    });
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    expect(decoded).toMatch(/text\/html/i);
    expect(decoded).toMatch(/<strong>Hi<\/strong>/);
  });
});

describe("error normalization", () => {
  it("maps 401 to AUTHENTICATION_REQUIRED", () => {
    const err = normalizeError({ status: 401, message: "Invalid Credentials" });
    expect(err.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("maps 403 to AUTHORIZATION_DENIED", () => {
    const err = normalizeError({ response: { status: 403, data: { error: { message: "Forbidden" } } } });
    expect(err.code).toBe("AUTHORIZATION_DENIED");
  });

  it("maps 404 to RESOURCE_NOT_FOUND", () => {
    expect(normalizeError({ status: 404 }).code).toBe("RESOURCE_NOT_FOUND");
  });

  it("maps 429 to RATE_LIMITED", () => {
    expect(normalizeError({ status: 429 }).code).toBe("RATE_LIMITED");
  });

  it("redacts bearer tokens in messages", () => {
    const err = normalizeError({
      status: 500,
      message: "Bearer ya29.abc123secret failed",
    });
    expect(err.message).not.toMatch(/ya29/);
    expect(err.message).toMatch(/REDACTED/i);
  });

  it("preserves AppError", () => {
    const original = new AppError("VALIDATION_ERROR", "bad");
    expect(normalizeError(original)).toBe(original);
  });
});

describe("tool result helpers", () => {
  it("builds success and failure shapes", () => {
    expect(successResult("gmail", { message_id: "1", thread_id: "2" })).toEqual({
      success: true,
      provider: "gmail",
      message_id: "1",
      thread_id: "2",
    });
    expect(failureResult(new AppError("VALIDATION_ERROR", "nope"))).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "nope" },
    });
  });
});

describe("tool handlers with mocked providers", () => {
  it("gmail_create_draft success", async () => {
    const gmail: GmailProvider = {
      createDraft: vi.fn().mockResolvedValue({
        draftId: "d1",
        messageId: "m1",
        threadId: "t1",
      }),
      sendEmail: vi.fn(),
    };
    const result = await handleGmailCreateDraft(
      gmail,
      { to: ["a@b.com"], subject: "S", body: "B" },
      silentLogger,
    );
    expect(result).toEqual({
      success: true,
      provider: "gmail",
      draft_id: "d1",
      message_id: "m1",
      thread_id: "t1",
    });
    expect(JSON.stringify(result)).not.toMatch(/token|secret|ya29/i);
  });

  it("gmail_create_draft validation failure", async () => {
    const gmail: GmailProvider = {
      createDraft: vi.fn(),
      sendEmail: vi.fn(),
    };
    const result = await handleGmailCreateDraft(
      gmail,
      { to: ["bad"], subject: "S", body: "B" },
      silentLogger,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    expect(gmail.createDraft).not.toHaveBeenCalled();
  });

  it("gmail_send_email success", async () => {
    const gmail: GmailProvider = {
      createDraft: vi.fn(),
      sendEmail: vi.fn().mockResolvedValue({ messageId: "m2", threadId: "t2" }),
    };
    const result = await handleGmailSendEmail(
      gmail,
      {
        to: ["a@b.com", "c@d.com"],
        cc: ["e@f.com"],
        subject: "S",
        body: "<b>Hi</b>",
        is_html: true,
      },
      silentLogger,
    );
    expect(result).toMatchObject({
      success: true,
      message_id: "m2",
      thread_id: "t2",
      provider: "gmail",
    });
    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isHtml: true, to: ["a@b.com", "c@d.com"] }),
    );
  });

  it("gmail_send_email maps provider auth failure", async () => {
    const gmail: GmailProvider = {
      createDraft: vi.fn(),
      sendEmail: vi.fn().mockRejectedValue(
        new AppError("AUTHENTICATION_REQUIRED", "Google account authorization is required."),
      ),
    };
    const result = await handleGmailSendEmail(
      gmail,
      { to: ["a@b.com"], subject: "S", body: "B" },
      silentLogger,
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Google account authorization is required.",
      },
    });
  });

  it("google_docs_append_content success", async () => {
    const docs: GoogleDocsProvider = {
      appendContent: vi.fn().mockResolvedValue({
        documentId: "doc1",
        appendedCharacters: 10,
      }),
    };
    const result = await handleGoogleDocsAppendContent(
      docs,
      { document_id: "doc1", content: "hello", add_newline_before: false },
      silentLogger,
    );
    expect(result).toEqual({
      success: true,
      provider: "google_docs",
      document_id: "doc1",
      appended_characters: 10,
    });
  });

  it("google_docs_append_content rejects empty content", async () => {
    const docs: GoogleDocsProvider = { appendContent: vi.fn() };
    const result = await handleGoogleDocsAppendContent(
      docs,
      { document_id: "doc1", content: "" },
      silentLogger,
    );
    expect(result.success).toBe(false);
    expect(docs.appendContent).not.toHaveBeenCalled();
  });
});
