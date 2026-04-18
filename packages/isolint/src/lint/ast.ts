/**
 * Markdown AST infrastructure
 * ---------------------------
 * Lazy, memoized `parseMarkdown(source)` that returns an mdast Root.
 *
 * Rules that need structural queries (is this a heading / list item / table
 * cell / blockquote?) call `getAst(ctx)` instead of writing fresh regex.
 * The current regex rules keep working — AST is additive.
 *
 * Each call caches the parse result on `ctx` via a WeakMap so multiple rules
 * on the same file re-use one parse.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Paragraph, Link, Table, List, ListItem, Code } from "mdast";
import { visit } from "unist-util-visit";
import type { LintContext } from "./types.js";

const astCache = new WeakMap<LintContext, Root>();

const parser = unified().use(remarkParse);

export function getAst(ctx: LintContext): Root {
  const cached = astCache.get(ctx);
  if (cached) return cached;
  const root = parser.parse(ctx.source) as Root;
  astCache.set(ctx, root);
  return root;
}

/** Concatenate all text children of a node. Cheap, no escaping. */
export function nodeText(node: { type: string; children?: unknown[]; value?: string }): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return (node as { value: string }).value ?? "";
  }
  if (!node.children) return "";
  const parts: string[] = [];
  for (const child of node.children as Array<{ type: string; children?: unknown[]; value?: string }>) {
    parts.push(nodeText(child));
  }
  return parts.join("");
}

/** Walk every heading in the AST, yielding `{ depth, text, start, end }`. */
export function* headings(root: Root): Generator<{ depth: number; text: string; start: number; end: number }> {
  for (const node of root.children) {
    if (node.type === "heading") {
      const h = node as Heading;
      yield {
        depth: h.depth,
        text: nodeText(h).trim(),
        start: h.position?.start.offset ?? 0,
        end: h.position?.end.offset ?? 0,
      };
    }
  }
}

/** Walk every paragraph, yielding its offsets + flattened text. */
export function* paragraphs(root: Root): Generator<{ text: string; start: number; end: number }> {
  const seen: Array<{ text: string; start: number; end: number }> = [];
  visit(root, "paragraph", (node: Paragraph) => {
    seen.push({
      text: nodeText(node),
      start: node.position?.start.offset ?? 0,
      end: node.position?.end.offset ?? 0,
    });
  });
  for (const p of seen) yield p;
}

/** True when `offset` falls inside a table cell. Used for context-aware rules. */
export function isInsideTable(root: Root, offset: number): boolean {
  let hit = false;
  visit(root, (node) => {
    if (hit) return false;
    if (node.type !== "table") return undefined;
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? 0;
    if (offset >= start && offset < end) hit = true;
    return undefined;
  });
  return hit;
}

/**
 * Validate that fenced code blocks tagged with a specific language actually
 * parse as that language. Currently only JSON — more can follow (YAML, etc).
 *
 * Returns `{ line, column, message }` for each invalid block. Called by the
 * new `invalid-code-fence` rule.
 */
export interface CodeFenceProblem {
  start_offset: number;
  end_offset: number;
  language: string;
  error: string;
}

/**
 * Heading structure: `[{ depth, start, end, text }, ...]` in document order.
 * Used by heading-hierarchy to detect skipped levels (`# A` → `### B`).
 */
export interface HeadingInfo {
  depth: number;
  text: string;
  start_offset: number;
  end_offset: number;
}

export function collectHeadings(root: Root): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  visit(root, "heading", (node: Heading) => {
    out.push({
      depth: node.depth,
      text: nodeText(node).trim(),
      start_offset: node.position?.start.offset ?? 0,
      end_offset: node.position?.end.offset ?? 0,
    });
  });
  return out;
}

/**
 * Links: `[label](url "title")`. Returns the link URL + its source offsets
 * so stale-link-reference can verify local-path targets.
 */
export interface LinkInfo {
  label: string;
  url: string;
  title: string | undefined;
  start_offset: number;
  end_offset: number;
}

export function collectLinks(root: Root): LinkInfo[] {
  const out: LinkInfo[] = [];
  visit(root, "link", (node: Link) => {
    out.push({
      label: nodeText(node).trim(),
      url: node.url,
      title: node.title ?? undefined,
      start_offset: node.position?.start.offset ?? 0,
      end_offset: node.position?.end.offset ?? 0,
    });
  });
  return out;
}

/**
 * Tables: for each, record the number of cells in the header and the number
 * in every body row. Rows with mismatched cell counts are malformed.
 */
export interface TableInfo {
  start_offset: number;
  end_offset: number;
  header_cells: number;
  rows: Array<{ cells: number; start_offset: number; end_offset: number }>;
}

export function collectTables(root: Root): TableInfo[] {
  const out: TableInfo[] = [];
  visit(root, "table", (node: Table) => {
    if (node.children.length === 0) return;
    const [header, ...body] = node.children;
    out.push({
      start_offset: node.position?.start.offset ?? 0,
      end_offset: node.position?.end.offset ?? 0,
      header_cells: header.children.length,
      rows: body.map((row) => ({
        cells: row.children.length,
        start_offset: row.position?.start.offset ?? 0,
        end_offset: row.position?.end.offset ?? 0,
      })),
    });
  });
  return out;
}

/**
 * List markers: for every unordered list, record the bullet character(s)
 * actually used at each item. Mixed usage (`-` + `*` in one list) confuses
 * weak models that treat marker style as semantic.
 */
export interface ListInfo {
  start_offset: number;
  end_offset: number;
  ordered: boolean;
  markers: string[];
}

export function collectLists(root: Root, source: string): ListInfo[] {
  const out: ListInfo[] = [];
  visit(root, "list", (node: List) => {
    const markers: string[] = [];
    for (const child of node.children as ListItem[]) {
      const start = child.position?.start.offset ?? 0;
      // The marker is the first non-whitespace char of the item line.
      let i = start;
      while (i < source.length && /[ \t]/.test(source[i])) i++;
      const ch = source[i];
      if (ch) markers.push(ch);
    }
    out.push({
      start_offset: node.position?.start.offset ?? 0,
      end_offset: node.position?.end.offset ?? 0,
      ordered: !!node.ordered,
      markers,
    });
  });
  return out;
}

export interface CodeBlockInfo {
  language: string;
  value: string;
  start_offset: number;
  end_offset: number;
}

export function collectCodeBlocks(root: Root): CodeBlockInfo[] {
  const out: CodeBlockInfo[] = [];
  visit(root, "code", (node: Code) => {
    out.push({
      language: (node.lang ?? "").toLowerCase(),
      value: node.value ?? "",
      start_offset: node.position?.start.offset ?? 0,
      end_offset: node.position?.end.offset ?? 0,
    });
  });
  return out;
}

export interface ListBlockInfo {
  ordered: boolean;
  start_offset: number;
  end_offset: number;
  items: Array<{ text: string; start_offset: number; end_offset: number }>;
}

export function collectListBlocks(root: Root): ListBlockInfo[] {
  const out: ListBlockInfo[] = [];
  visit(root, "list", (node: List) => {
    out.push({
      ordered: !!node.ordered,
      start_offset: node.position?.start.offset ?? 0,
      end_offset: node.position?.end.offset ?? 0,
      items: (node.children as ListItem[]).map((child) => ({
        text: nodeText(child).trim(),
        start_offset: child.position?.start.offset ?? 0,
        end_offset: child.position?.end.offset ?? 0,
      })),
    });
  });
  return out;
}

export function findInvalidJsonFences(root: Root): CodeFenceProblem[] {
  const problems: CodeFenceProblem[] = [];
  visit(root, "code", (node) => {
    const lang = (node.lang ?? "").toLowerCase();
    if (lang !== "json") return;
    const value = node.value ?? "";
    if (!value.trim()) return;
    try {
      JSON.parse(value);
    } catch (err) {
      problems.push({
        start_offset: node.position?.start.offset ?? 0,
        end_offset: node.position?.end.offset ?? 0,
        language: lang,
        error: (err as Error).message.split("\n")[0],
      });
    }
  });
  return problems;
}

export type { Root };
