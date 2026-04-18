export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Minimal, dependency-free argv parser.
 * Supports: `cmd pos1 pos2 --flag --key value --key=value -k value`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let command = "";
  let rest: string[] = argv;
  if (argv.length > 0 && !argv[0].startsWith("-")) {
    command = argv[0];
    rest = argv.slice(1);
  }
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  const setFlag = (key: string, val: string | boolean): void => {
    // Repeated string-valued flags accumulate into a comma-joined list so
    // "--preset a --preset b" is equivalent to "--preset a,b". Flags that
    // only accept a single value (e.g. --format) will reject the joined
    // string at validation time, which is a clearer error than silently
    // dropping one of the values.
    const existing = flags[key];
    if (typeof existing === "string" && typeof val === "string") {
      flags[key] = existing + "," + val;
    } else {
      flags[key] = val;
    }
  };

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        setFlag(tok.slice(2, eq), tok.slice(eq + 1));
      } else {
        const key = tok.slice(2);
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          setFlag(key, next);
          i++;
        } else {
          setFlag(key, true);
        }
      }
    } else if (tok.startsWith("-") && tok.length === 2) {
      const key = tok.slice(1);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        setFlag(key, next);
        i++;
      } else {
        setFlag(key, true);
      }
    } else {
      positional.push(tok);
    }
  }

  return { command, positional, flags };
}

export function flagString(flags: Record<string, string | boolean>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function flagBool(flags: Record<string, string | boolean>, ...keys: string[]): boolean {
  for (const k of keys) {
    if (flags[k] === true || flags[k] === "true") return true;
  }
  return false;
}
