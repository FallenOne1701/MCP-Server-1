import { config as loadDotenv } from "dotenv";
import { AppError } from "../errors/index.js";

loadDotenv();

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  // Document-ID append UX is not compatible with drive.file alone.
  "https://www.googleapis.com/auth/documents",
];

export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleTokenStorage: string;
  /** Optional refresh token from env (Railway secret); alternative to file storage. */
  googleRefreshToken?: string;
  googleScopes: string[];
  logLevel: string;
  /** Bearer token required for remote `/mcp` (HTTP mode only). */
  mcpApiKey?: string;
  /** When true, expose Google OAuth start + callback routes. */
  enableOauthSetup: boolean;
  /** HTTP listen port (Railway injects PORT). */
  port: number;
  /** Bind address; use 0.0.0.0 on Railway. */
  host: string;
  /** Optional Host header allow-list (comma-separated hostnames). */
  allowedHosts: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "AUTHENTICATION_REQUIRED",
      `Missing required environment variable: ${name}. Copy .env.example to .env and run npm run auth.`,
    );
  }
  return value;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseScopes(): string[] {
  const scopesEnv = process.env.GOOGLE_SCOPES?.trim();
  return scopesEnv
    ? scopesEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SCOPES;
}

function parseAllowedHosts(): string[] {
  const raw = process.env.ALLOWED_HOSTS?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(options?: { requireAuthEnv?: boolean }): AppConfig {
  const requireAuthEnv = options?.requireAuthEnv ?? true;
  const googleScopes = parseScopes();
  const enableOauthSetup = parseBool(process.env.ENABLE_OAUTH_SETUP, false);
  const port = Number(process.env.PORT?.trim() || "3000");
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const allowedHosts = parseAllowedHosts();
  const googleRefreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim() || undefined;
  const mcpApiKey = process.env.MCP_API_KEY?.trim() || undefined;

  if (!requireAuthEnv) {
    return {
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
      googleRedirectUri:
        process.env.GOOGLE_REDIRECT_URI?.trim() ??
        "http://localhost:3000/oauth2callback",
      googleTokenStorage:
        process.env.GOOGLE_TOKEN_STORAGE?.trim() ?? ".tokens/google-token.json",
      googleRefreshToken,
      googleScopes,
      logLevel: process.env.LOG_LEVEL?.trim() ?? "info",
      mcpApiKey,
      enableOauthSetup,
      port: Number.isFinite(port) ? port : 3000,
      host,
      allowedHosts,
    };
  }

  return {
    googleClientId: requireEnv("GOOGLE_CLIENT_ID"),
    googleClientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri:
      process.env.GOOGLE_REDIRECT_URI?.trim() ??
      "http://localhost:3000/oauth2callback",
    googleTokenStorage:
      process.env.GOOGLE_TOKEN_STORAGE?.trim() ?? ".tokens/google-token.json",
    googleRefreshToken,
    googleScopes,
    logLevel: process.env.LOG_LEVEL?.trim() ?? "info",
    mcpApiKey,
    enableOauthSetup,
    port: Number.isFinite(port) ? port : 3000,
    host,
    allowedHosts,
  };
}
