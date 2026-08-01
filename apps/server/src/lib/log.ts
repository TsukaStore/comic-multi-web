/**
 * Minimal leveled logging. Level from AppSettings.logLevel (default: warn).
 * silent < error < warn < info < debug
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let current: LogLevel = "warn";

export function setLogLevel(level: LogLevel | string | undefined) {
  if (level && level in ORDER) current = level as LogLevel;
}

function ok(level: LogLevel): boolean {
  if (current === "silent") return false;
  return ORDER[level] <= ORDER[current];
}

export const log = {
  error: (...args: unknown[]) => {
    if (ok("error")) console.error(...args);
  },
  warn: (...args: unknown[]) => {
    if (ok("warn")) console.warn(...args);
  },
  info: (...args: unknown[]) => {
    if (ok("info")) console.log(...args);
  },
  debug: (...args: unknown[]) => {
    if (ok("debug")) console.log(...args);
  },
};
