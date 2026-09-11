export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  tool?: string;
  correlationId?: string;
  success?: boolean;
  provider?: string;
  errorCode?: string;
  latencyMs?: number;
  [key: string]: unknown;
}

const SENSITIVE_KEY =
  /^(authorization|access_?token|refresh_?token|client_?secret|password|body|email_?body|raw)$/i;

function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }
  return value;
}

export class Logger {
  constructor(private readonly minLevel: LogLevel = "info") {}

  child(base: LogFields): Logger {
    const childLogger = new Logger(this.minLevel);
    const write = childLogger["write"].bind(childLogger);
    childLogger["write"] = (level, message, fields) => {
      write(level, message, { ...base, ...fields });
    };
    return childLogger;
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(fields ? (redact(fields) as LogFields) : {}),
    };
    // MCP stdio uses stdout for protocol; always log to stderr.
    console.error(JSON.stringify(entry));
  }
}

export function createLogger(level: string | undefined): Logger {
  const normalized = (level ?? "info").toLowerCase() as LogLevel;
  const minLevel = LEVEL_ORDER[normalized] !== undefined ? normalized : "info";
  return new Logger(minLevel);
}

export function newCorrelationId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
