#!/usr/bin/env node
/**
 * Interactive OAuth setup for local development.
 * Opens the Google consent URL and listens on GOOGLE_REDIRECT_URI for the code.
 */
import http from "node:http";
import { URL } from "node:url";
import open from "open";
import { loadConfig } from "../config/index.js";
import { createLogger } from "../logging/index.js";
import { GoogleOAuthProvider } from "../providers/google/auth.js";

async function main(): Promise<void> {
  const config = loadConfig({ requireAuthEnv: true });
  const logger = createLogger(config.logLevel);
  const auth = new GoogleOAuthProvider(config, logger);

  const redirect = new URL(config.googleRedirectUri);
  const port = Number(redirect.port || 3000);
  // Accept the configured path and bare "/" (Desktop clients often redirect to /).
  const callbackPath = redirect.pathname || "/";

  const authUrl = auth.getAuthUrl("mcp-local-auth");

  console.error("Google Workspace MCP — OAuth setup");
  console.error("----------------------------------");
  console.error(`Listening for callback on ${config.googleRedirectUri}`);
  console.error("Opening browser for Google consent…");
  console.error("Sign in, grant Gmail + Docs access, then return here.");
  console.error(`If the browser does not open, visit:\n${authUrl}\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        const pathOk =
          reqUrl.pathname === callbackPath ||
          reqUrl.pathname === "/" ||
          reqUrl.pathname === "/oauth2callback";
        if (!pathOk) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`Authorization failed: ${error}`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        const oauthCode = reqUrl.searchParams.get("code");
        if (!oauthCode) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing authorization code");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<html><body><h1>Authorization successful</h1><p>You can close this window and return to the terminal.</p></body></html>",
        );
        server.close();
        resolve(oauthCode);
      } catch (err) {
        reject(err);
      }
    });

    const host =
      redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1"
        ? "127.0.0.1"
        : undefined;
    server.listen(port, host);
    void open(authUrl).catch(() => {
      console.error("Could not open browser automatically.");
    });
  });

  await auth.exchangeCode(code);
  console.error(`Tokens saved to ${config.googleTokenStorage}`);
  console.error("You can now start the MCP server (npm run dev / npm start).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
