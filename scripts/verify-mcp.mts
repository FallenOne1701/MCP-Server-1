/**
 * Smoke-test: MCP handshake, tool discovery, validation, and Google auth.
 * Does not send email or mutate Docs.
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { loadConfig } from "../src/config/index.js";
import { createLogger } from "../src/logging/index.js";
import { GoogleOAuthProvider } from "../src/providers/google/auth.js";
import { google } from "googleapis";

const EXPECTED_TOOLS = [
  "gmail_create_draft",
  "gmail_send_email",
  "google_docs_append_content",
] as const;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
}

function fail(label: string, detail?: unknown): never {
  console.error(`FAIL  ${label}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
}

async function verifyGoogleAuth(): Promise<void> {
  const config = loadConfig({ requireAuthEnv: true });
  const logger = createLogger("error");
  const auth = new GoogleOAuthProvider(config, logger);
  const client = await auth.getAuthorizedClient();
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const tokenInfo = await client.getAccessToken();
  if (!tokenInfo.token) {
    fail("Google auth — access token available");
  }
  // Token refresh / validity: call tokeninfo without logging the token.
  await oauth2.tokeninfo({ access_token: tokenInfo.token });
  pass("Google OAuth token is valid and usable");
}

async function verifyMcp(): Promise<void> {
  const client = new Client({ name: "verify-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    env: { ...process.env },
    stderr: "pipe",
  });

  transport.stderr?.on("data", (chunk: Buffer) => {
    // Keep protocol stdout clean; surface server logs only on failure paths.
    process.stderr.write(chunk);
  });

  await client.connect(transport);
  pass("MCP initialize / stdio connect");

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = [...EXPECTED_TOOLS].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail("tools/list matches expected tools", { names, expected });
  }
  for (const tool of tools) {
    if (!tool.description || tool.description.length < 20) {
      fail(`tool description present: ${tool.name}`);
    }
    if (!tool.inputSchema) {
      fail(`tool inputSchema present: ${tool.name}`);
    }
  }
  pass(`tools/list → ${names.join(", ")}`);

  const invalid = await client.callTool({
    name: "gmail_create_draft",
    arguments: { to: ["not-an-email"], subject: "x", body: "y" },
  });
  const invalidText =
    Array.isArray(invalid.content) && invalid.content[0]?.type === "text"
      ? invalid.content[0].text
      : JSON.stringify(invalid);
  const invalidJson = JSON.parse(invalidText) as {
    success?: boolean;
    error?: { code?: string };
  };
  if (invalidJson.success !== false || invalidJson.error?.code !== "VALIDATION_ERROR") {
    fail("validation error for bad email", invalidJson);
  }
  if (/ya29\.|GOCSPX-|access_token|refresh_token/i.test(invalidText)) {
    fail("no credential leakage in tool output", invalidText);
  }
  pass("gmail_create_draft rejects invalid email (VALIDATION_ERROR)");

  const missingAuthShape = await client.callTool({
    name: "google_docs_append_content",
    arguments: { document_id: "nonexistent-doc-id-verify-only", content: "ping" },
  });
  const docsText =
    Array.isArray(missingAuthShape.content) &&
    missingAuthShape.content[0]?.type === "text"
      ? missingAuthShape.content[0].text
      : JSON.stringify(missingAuthShape);
  const docsJson = JSON.parse(docsText) as {
    success?: boolean;
    error?: { code?: string; message?: string };
  };
  // With valid auth this should be a Google API / not-found style failure, not a crash.
  if (docsJson.success !== false || !docsJson.error?.code) {
    fail("docs append returns normalized error for bad document", docsJson);
  }
  pass(
    `google_docs_append_content returns normalized error (${docsJson.error.code})`,
  );

  await client.close();
  pass("MCP client closed cleanly");
}

async function main(): Promise<void> {
  console.log("Verifying Google Workspace MCP server…\n");
  await verifyGoogleAuth();
  await verifyMcp();
  console.log("\nAll checks passed. MCP server is working.");
}

main().catch((err) => {
  fail("unexpected error", err instanceof Error ? err.stack ?? err.message : err);
});
