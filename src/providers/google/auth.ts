import { google, type Auth } from "googleapis";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertGoogleAuthEnvConfigured,
  type AppConfig,
} from "../../config/index.js";
import { AppError } from "../../errors/index.js";
import type { Logger } from "../../logging/index.js";

export type AuthorizedGoogleClient = Auth.OAuth2Client;

export interface GoogleAuthProvider {
  getAuthorizedClient(): Promise<AuthorizedGoogleClient>;
}

export interface StoredToken {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
}

export class GoogleOAuthProvider implements GoogleAuthProvider {
  private client: Auth.OAuth2Client | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  createOAuthClient(): Auth.OAuth2Client {
    assertGoogleAuthEnvConfigured();
    return new google.auth.OAuth2(
      this.config.googleClientId,
      this.config.googleClientSecret,
      this.config.googleRedirectUri,
    );
  }

  getAuthUrl(state?: string): string {
    const client = this.createOAuthClient();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: this.config.googleScopes,
      state,
    });
  }

  async exchangeCode(code: string): Promise<StoredToken> {
    const client = this.createOAuthClient();
    const { tokens } = await client.getToken(code);
    await this.saveTokens(tokens as StoredToken);
    return tokens as StoredToken;
  }

  async saveTokens(tokens: StoredToken): Promise<void> {
    const filePath = path.resolve(this.config.googleTokenStorage);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    let merged: StoredToken = { ...tokens };
    try {
      const existing = await this.readTokensFromFile();
      if (existing) {
        merged = {
          ...existing,
          ...tokens,
          // Never drop a refresh token if Google omits it on refresh.
          refresh_token: tokens.refresh_token ?? existing.refresh_token,
        };
      }
    } catch {
      // no existing file
    }

    // Prefer env refresh token as fallback when Google omits it.
    if (!merged.refresh_token && this.config.googleRefreshToken) {
      merged.refresh_token = this.config.googleRefreshToken;
    }

    await fs.writeFile(filePath, JSON.stringify(merged, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    this.logger.info("Saved Google OAuth tokens", {
      path: filePath,
      hasRefreshToken: Boolean(merged.refresh_token),
    });
  }

  private async readTokensFromFile(): Promise<StoredToken | null> {
    const filePath = path.resolve(this.config.googleTokenStorage);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as StoredToken;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Load tokens from file volume and/or GOOGLE_REFRESH_TOKEN env.
   * Env refresh token is the Railway v1 fallback when the volume is empty.
   */
  async readTokens(): Promise<StoredToken | null> {
    const fromFile = await this.readTokensFromFile();
    const envRefresh = this.config.googleRefreshToken;

    if (!fromFile && !envRefresh) {
      return null;
    }

    if (!fromFile && envRefresh) {
      return {
        refresh_token: envRefresh,
        token_type: "Bearer",
      };
    }

    if (fromFile && !fromFile.refresh_token && envRefresh) {
      return { ...fromFile, refresh_token: envRefresh };
    }

    return fromFile;
  }

  async getAuthorizedClient(): Promise<AuthorizedGoogleClient> {
    if (this.client) {
      return this.client;
    }

    const tokens = await this.readTokens();
    if (!tokens?.refresh_token && !tokens?.access_token) {
      throw new AppError(
        "AUTHENTICATION_REQUIRED",
        "Google account authorization is required. Run `npm run auth` locally, or set GOOGLE_REFRESH_TOKEN / complete OAuth setup on the HTTP server.",
      );
    }

    const client = this.createOAuthClient();
    client.setCredentials(tokens);

    client.on("tokens", (fresh) => {
      void this.saveTokens(fresh as StoredToken).catch((saveErr) => {
        this.logger.error("Failed to persist refreshed Google tokens", {
          errorCode: "INTERNAL_ERROR",
          detail: saveErr instanceof Error ? saveErr.message : "unknown",
        });
      });
    });

    this.client = client;
    return client;
  }
}
