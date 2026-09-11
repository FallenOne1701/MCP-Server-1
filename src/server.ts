#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createAppContext, createAppServer } from "./app.js";

async function main(): Promise<void> {
  const ctx = createAppContext({ requireAuthEnv: true });
  const server = createAppServer(ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  ctx.logger.info("Google Workspace MCP server started", {
    transport: "stdio",
    tools: [
      "gmail_create_draft",
      "gmail_send_email",
      "google_docs_append_content",
    ],
  });
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Fatal server error",
      detail: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
