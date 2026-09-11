import { McpServer } from "@modelcontextprotocol/server";
import { loadConfig, type AppConfig } from "./config/index.js";
import { createLogger, type Logger } from "./logging/index.js";
import { registerTools } from "./mcp/register.js";
import { GoogleOAuthProvider } from "./providers/google/auth.js";
import { GoogleDocsApiProvider } from "./providers/google/docs.js";
import { GoogleGmailProvider } from "./providers/google/gmail.js";
import type { GmailProvider } from "./providers/google/gmail.js";
import type { GoogleDocsProvider } from "./providers/google/docs.js";

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  auth: GoogleOAuthProvider;
  gmail: GmailProvider;
  docs: GoogleDocsProvider;
}

/**
 * Shared providers + config used by both stdio and HTTP entrypoints.
 * Create once at process start and reuse across MCP requests.
 */
export function createAppContext(options?: {
  requireAuthEnv?: boolean;
}): AppContext {
  const config = loadConfig({
    requireAuthEnv: options?.requireAuthEnv ?? true,
  });
  const logger = createLogger(config.logLevel);
  const auth = new GoogleOAuthProvider(config, logger);
  const gmail = new GoogleGmailProvider(auth, logger);
  const docs = new GoogleDocsApiProvider(auth, logger);
  return { config, logger, auth, gmail, docs };
}

/**
 * Fresh McpServer with tools registered. Safe to create per HTTP request
 * (stateless Streamable HTTP).
 */
export function createAppServer(ctx: AppContext): McpServer {
  const server = new McpServer({
    name: "google-workspace-mcp",
    version: "1.0.0",
  });
  registerTools(server, {
    gmail: ctx.gmail,
    docs: ctx.docs,
    logger: ctx.logger,
  });
  return server;
}
