#!/usr/bin/env node
/**
 * Remote MCP entrypoint (Streamable HTTP) for Railway / hosted deploy.
 * Local Cursor stdio use remains `src/server.ts`.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createAppContext, createAppServer } from "./app.js";

function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against self to keep timing roughly constant on length mismatch.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function requireMcpApiKey(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token || !safeEqualString(token, apiKey)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

async function main(): Promise<void> {
  const ctx = createAppContext({ requireAuthEnv: true });
  const { config, logger, auth } = ctx;

  if (!config.mcpApiKey) {
    throw new Error(
      "MCP_API_KEY is required for HTTP mode. Set it in the environment before starting.",
    );
  }

  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts:
      config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  if (config.enableOauthSetup) {
    logger.warn("OAuth setup routes are ENABLED (ENABLE_OAUTH_SETUP=true)", {
      routes: ["/oauth/start", "/oauth2callback"],
    });

    app.get("/oauth/start", (_req, res) => {
      const url = auth.getAuthUrl("mcp-http-setup");
      res.redirect(302, url);
    });

    app.get("/oauth2callback", async (req, res) => {
      try {
        const error = typeof req.query.error === "string" ? req.query.error : undefined;
        if (error) {
          res.status(400).type("html").send(
            `<html><body><h1>Authorization failed</h1><p>${error}</p></body></html>`,
          );
          return;
        }

        const code = typeof req.query.code === "string" ? req.query.code : undefined;
        if (!code) {
          res.status(400).type("html").send(
            "<html><body><h1>Missing authorization code</h1></body></html>",
          );
          return;
        }

        const tokens = await auth.exchangeCode(code);
        logger.info("OAuth setup completed", {
          hasRefreshToken: Boolean(tokens.refresh_token),
          storage: config.googleTokenStorage,
        });

        res.status(200).type("html").send(
          `<html><body>
            <h1>Authorization successful</h1>
            <p>Tokens were saved. Copy the refresh token into <code>GOOGLE_REFRESH_TOKEN</code> if you are not using a volume, then set <code>ENABLE_OAUTH_SETUP=false</code>.</p>
            <p>You can close this window.</p>
          </body></html>`,
        );
      } catch (err) {
        logger.error("OAuth callback failed", {
          errorCode: "AUTHENTICATION_REQUIRED",
          detail: err instanceof Error ? err.message : "unknown",
        });
        res.status(500).type("html").send(
          "<html><body><h1>Authorization error</h1><p>See server logs.</p></body></html>",
        );
      }
    });
  } else {
    // Locked-down stub so misconfigured Google redirects are not silent 404s.
    app.get("/oauth2callback", (_req, res) => {
      res.status(403).json({
        error: "OAuth setup is disabled. Set ENABLE_OAUTH_SETUP=true temporarily.",
      });
    });
  }

  const mcpHandler = createMcpHandler(() => createAppServer(ctx));
  const nodeHandler = toNodeHandler(mcpHandler);

  app.all(
    "/mcp",
    requireMcpApiKey(config.mcpApiKey),
    (req, res) => {
      void nodeHandler(req, res, req.body).catch((err) => {
        logger.error("MCP request failed", {
          detail: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      });
    },
  );

  app.listen(config.port, config.host, () => {
    logger.info("Google Workspace MCP HTTP server listening", {
      transport: "streamable-http",
      host: config.host,
      port: config.port,
      health: "/health",
      mcp: "/mcp",
      oauthSetup: config.enableOauthSetup,
      tools: [
        "gmail_create_draft",
        "gmail_send_email",
        "google_docs_append_content",
      ],
    });
  });
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Fatal HTTP server error",
      detail: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
