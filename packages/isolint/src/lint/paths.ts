/**
 * Harness path classification shared by performance rules and the
 * `isolint cost` command. One source of truth for what counts as
 * "always-loaded" vs. per-mode vs. per-agent context.
 */

/** Paths under conventional harness roots (modes / prompts / skills / agents / Cursor rules). */
export const HARNESS_PATH_RE = /(?:^|\/)(?:modes|prompts|skills|agents)(?:\/|$)|\.cursor\/rules/i;

/** Files loaded into every agent turn (shared prefix / orchestrator instructions). */
export const SHARED_PREFIX_PATH_RE = /(?:^|\/)(?:_shared\.md|AGENTS(?:\.[^/]+)?\.md|CLAUDE\.md|\.cursor\/rules\/[^/]+\.mdc|iso\/instructions\.md|\.opencode\/instructions\.md)$/i;

/** Mode files — loaded when a mode runs. Captures the mode name in group 1. */
export const MODE_PATH_RE = /(?:^|\/)modes\/([^/_][^/]*)\.md$/i;

/** Agent spec files — loaded when the orchestrator dispatches to that agent. */
export const AGENT_PATH_RE = /(?:^|\/)(?:\.claude|\.opencode|\.cursor|iso)\/agents\/[^/]+\.md$/i;
