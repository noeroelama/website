export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|session/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(options: {
  service: string;
  level?: LogLevel;
  base?: Record<string, unknown>;
  write?: (line: string) => void;
}): Logger {
  const min = ORDER[options.level ?? "info"];
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const log = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        service: options.service,
        message,
        ...(redact({ ...options.base, ...fields }) as Record<string, unknown>),
      }),
    );
  };
  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
    child: (fields) => createLogger({ ...options, base: { ...options.base, ...fields } }),
  };
}

export function resolveRequestId(inbound: string | null | undefined): string {
  if (inbound && /^[A-Za-z0-9._-]{8,128}$/.test(inbound)) return inbound;
  return crypto.randomUUID();
}

export interface SecurityEvent {
  readonly type:
    | "staff.login"
    | "staff.login_failed"
    | "staff.role_changed"
    | "staff.created"
    | "audit.revert"
    | "apikey.created"
    | "apikey.revoked"
    | "data.export";
  readonly actorId: string | null;
  readonly details?: Record<string, unknown>;
}

export function logSecurityEvent(logger: Logger, event: SecurityEvent): void {
  logger.warn("security_event", {
    securityEvent: event.type,
    actorId: event.actorId,
    ...event.details,
  });
}
