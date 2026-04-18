import YAML from 'yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parse(raw) {
  const m = raw.match(FM_RE);
  if (!m) return { data: {}, body: raw };
  let data = {};
  try {
    data = YAML.parse(m[1]) ?? {};
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${err.message}`);
  }
  const body = raw.slice(m[0].length);
  return { data, body };
}

export function stringify({ data, body }) {
  const keys = Object.keys(data ?? {});
  if (keys.length === 0) return body;
  const fm = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n\n${body.replace(/^\s+/, '')}`;
}
