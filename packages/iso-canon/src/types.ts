export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type CanonEntityType = "url" | "company" | "role" | "company-role";
export type CanonVerdict = "same" | "possible" | "different";

export interface CanonConfig {
  version: 1;
  profiles: CanonProfile[];
}

export interface CanonProfile {
  name: string;
  url?: UrlCanonOptions;
  company?: TextCanonOptions;
  role?: TextCanonOptions;
  match?: MatchOptions;
}

export interface UrlCanonOptions {
  dropHash?: boolean;
  stripWww?: boolean;
  lowercaseHost?: boolean;
  keepTrailingSlash?: boolean;
  stripQueryParams?: string[];
}

export interface TextCanonOptions {
  aliases?: Record<string, string>;
  suffixes?: string[];
  stopWords?: string[];
}

export interface MatchOptions {
  strong?: number;
  possible?: number;
}

export interface CanonResult {
  kind: "url" | "company" | "role";
  input: string;
  canonical: string;
  key: string;
  tokens: string[];
  warnings: string[];
}

export interface CompanyRoleInput {
  company: string;
  role: string;
}

export interface CompanyRoleCanonResult {
  kind: "company-role";
  input: CompanyRoleInput;
  canonical: string;
  key: string;
  tokens: string[];
  warnings: string[];
  company: CanonResult;
  role: CanonResult;
}

export type AnyCanonResult = CanonResult | CompanyRoleCanonResult;
export type CanonEntityInput = string | CompanyRoleInput;

export interface CanonCompareResult {
  type: CanonEntityType;
  verdict: CanonVerdict;
  score: number;
  reasons: string[];
  left: AnyCanonResult;
  right: AnyCanonResult;
}
