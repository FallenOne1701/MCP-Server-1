export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "RATE_LIMITED"
  | "GOOGLE_API_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR";

export interface AppErrorBody {
  code: ErrorCode;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }

  toJSON(): AppErrorBody {
    return { code: this.code, message: this.message };
  }
}

export interface SuccessResponse<T extends Record<string, unknown>> {
  success: true;
  provider: string;
}

export type ToolSuccess<T extends Record<string, unknown>> = {
  success: true;
  provider: string;
} & T;

export interface ToolFailure {
  success: false;
  error: AppErrorBody;
}

export type ToolResult<T extends Record<string, unknown>> =
  | ToolSuccess<T>
  | ToolFailure;

export function successResult<T extends Record<string, unknown>>(
  provider: string,
  data: T,
): ToolSuccess<T> {
  return { success: true, provider, ...data };
}

export function failureResult(error: AppError | AppErrorBody): ToolFailure {
  if (error instanceof AppError) {
    return { success: false, error: error.toJSON() };
  }
  return { success: false, error };
}

/**
 * Map unknown thrown values (including googleapis errors) into AppError
 * without leaking tokens, secrets, or stack traces to clients.
 */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (err && typeof err === "object") {
    const anyErr = err as {
      code?: number | string;
      status?: number;
      message?: string;
      errors?: Array<{ message?: string; reason?: string }>;
      response?: {
        status?: number;
        statusText?: string;
        data?: {
          error?: {
            message?: string;
            status?: string;
            errors?: Array<{ message?: string; reason?: string }>;
          };
        };
      };
    };

    const status =
      anyErr.status ??
      anyErr.response?.status ??
      (typeof anyErr.code === "number" ? anyErr.code : undefined);

    const apiMessage =
      anyErr.response?.data?.error?.message ??
      anyErr.errors?.[0]?.message ??
      anyErr.message;

    const safeMessage = sanitizeClientMessage(apiMessage);

    if (status === 401) {
      return new AppError(
        "AUTHENTICATION_REQUIRED",
        safeMessage || "Google account authorization is required.",
        status,
      );
    }
    if (status === 403) {
      return new AppError(
        "AUTHORIZATION_DENIED",
        safeMessage || "Google API permission was denied for this operation.",
        status,
      );
    }
    if (status === 404) {
      return new AppError(
        "RESOURCE_NOT_FOUND",
        safeMessage || "The requested Google resource was not found.",
        status,
      );
    }
    if (status === 429) {
      return new AppError(
        "RATE_LIMITED",
        safeMessage || "Google API rate limit exceeded. Try again later.",
        status,
      );
    }
    if (status !== undefined && status >= 400 && status < 600) {
      return new AppError(
        "GOOGLE_API_ERROR",
        safeMessage || "Google API request failed.",
        status,
      );
    }

    const codeStr = String(anyErr.code ?? "");
    if (
      codeStr === "ENOTFOUND" ||
      codeStr === "ECONNRESET" ||
      codeStr === "ETIMEDOUT" ||
      codeStr === "ECONNREFUSED"
    ) {
      return new AppError(
        "NETWORK_ERROR",
        "A network error occurred while contacting Google APIs.",
      );
    }
  }

  if (err instanceof Error) {
    return new AppError(
      "INTERNAL_ERROR",
      sanitizeClientMessage(err.message) || "An unexpected internal error occurred.",
    );
  }

  return new AppError("INTERNAL_ERROR", "An unexpected internal error occurred.");
}

function sanitizeClientMessage(message: string | undefined): string {
  if (!message) return "";
  // Strip anything that looks like a bearer token or client secret fragment.
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/ya29\.[A-Za-z0-9._~+/-]+/g, "[REDACTED]")
    .replace(/1\/\/[A-Za-z0-9._~+/-]+/g, "[REDACTED]")
    .slice(0, 500);
}
