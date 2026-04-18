export type LogLevel = "silent" | "info" | "debug";

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const enabled = {
    debug: level === "debug",
    info: level !== "silent",
    warn: level !== "silent",
    error: true,
  };

  const fmt = (tag: string, msg: string, meta?: Record<string, unknown>) => {
    const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[isolint] ${tag} ${msg}${suffix}`;
  };

  return {
    info: (m, meta) => enabled.info && console.log(fmt("info ", m, meta)),
    debug: (m, meta) => enabled.debug && console.log(fmt("debug", m, meta)),
    warn: (m, meta) => enabled.warn && console.warn(fmt("warn ", m, meta)),
    error: (m, meta) => enabled.error && console.error(fmt("error", m, meta)),
  };
}
