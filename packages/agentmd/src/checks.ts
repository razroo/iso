export type CheckType =
  | "word_count_le"
  | "word_count_ge"
  | "char_count_le"
  | "does_not_contain"
  | "contains_all"
  | "regex"
  | "llm_judge";

export type MatchMode = "substring" | "regex";

export interface Expectation {
  rule: string;
  check: CheckType;
  value?: unknown;
  prompt?: string;
  mode?: MatchMode;
}

export interface CheckResult {
  passed: boolean;
  detail: string;
}

export type JudgeFn = (judgePrompt: string, output: string) => Promise<boolean>;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function runCheck(
  exp: Expectation,
  output: string,
  judge?: JudgeFn,
): Promise<CheckResult> {
  switch (exp.check) {
    case "word_count_le": {
      const limit = Number(exp.value);
      const n = wordCount(output);
      return { passed: n <= limit, detail: `${n} words (limit ${limit})` };
    }
    case "word_count_ge": {
      const limit = Number(exp.value);
      const n = wordCount(output);
      return { passed: n >= limit, detail: `${n} words (min ${limit})` };
    }
    case "char_count_le": {
      const limit = Number(exp.value);
      const n = output.length;
      return { passed: n <= limit, detail: `${n} chars (limit ${limit})` };
    }
    case "does_not_contain": {
      const values = Array.isArray(exp.value) ? exp.value : [exp.value];
      if (exp.mode === "regex") {
        for (const v of values) {
          const pattern = String(v);
          let re: RegExp;
          try {
            re = new RegExp(pattern, "i");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { passed: false, detail: `invalid regex /${pattern}/: ${msg}` };
          }
          if (re.test(output)) {
            return { passed: false, detail: `found forbidden pattern: /${pattern}/i` };
          }
        }
        return { passed: true, detail: `none of ${values.length} forbidden patterns matched` };
      }
      const hit = values.find((v) =>
        output.toLowerCase().includes(String(v).toLowerCase()),
      );
      if (hit !== undefined) {
        return { passed: false, detail: `found forbidden substring: "${hit}"` };
      }
      return { passed: true, detail: `none of ${values.length} forbidden substrings present` };
    }
    case "contains_all": {
      const values = Array.isArray(exp.value) ? exp.value : [exp.value];
      if (exp.mode === "regex") {
        const missing: string[] = [];
        for (const v of values) {
          const pattern = String(v);
          let re: RegExp;
          try {
            re = new RegExp(pattern, "i");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { passed: false, detail: `invalid regex /${pattern}/: ${msg}` };
          }
          if (!re.test(output)) missing.push(pattern);
        }
        if (missing.length) {
          return { passed: false, detail: `missing required patterns: ${missing.map((m) => `/${m}/i`).join(", ")}` };
        }
        return { passed: true, detail: `all ${values.length} required patterns matched` };
      }
      const missing = values.filter(
        (v) => !output.toLowerCase().includes(String(v).toLowerCase()),
      );
      if (missing.length) {
        return { passed: false, detail: `missing required: ${missing.map((m) => `"${m}"`).join(", ")}` };
      }
      return { passed: true, detail: `all ${values.length} required substrings present` };
    }
    case "regex": {
      const pattern = String(exp.value);
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { passed: false, detail: `invalid regex /${pattern}/: ${msg}` };
      }
      const matches = re.test(output);
      return { passed: matches, detail: matches ? `matched /${pattern}/` : `did not match /${pattern}/` };
    }
    case "llm_judge": {
      if (!judge) {
        return { passed: false, detail: "no judge function configured (missing API key?)" };
      }
      const prompt = exp.prompt ?? "";
      if (!prompt) {
        return { passed: false, detail: "llm_judge requires a 'prompt' field" };
      }
      const ok = await judge(prompt, output);
      return { passed: ok, detail: ok ? "judge: yes" : "judge: no" };
    }
    default: {
      return { passed: false, detail: `unknown check: ${(exp as Expectation).check}` };
    }
  }
}
