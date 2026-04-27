export type {
  AnyCanonResult,
  CanonCompareResult,
  CanonConfig,
  CanonEntityInput,
  CanonEntityType,
  CanonProfile,
  CanonResult,
  CanonVerdict,
  CompanyRoleCanonResult,
  CompanyRoleInput,
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MatchOptions,
  TextCanonOptions,
  UrlCanonOptions,
} from "./types.js";
export {
  DEFAULT_CANON_CONFIG,
  DEFAULT_CANON_PROFILE,
  canonicalizeCompany,
  canonicalizeCompanyRole,
  canonicalizeEntity,
  canonicalizeRole,
  canonicalizeUrl,
  compareCanon,
  loadCanonConfig,
  parseCompanyRoleInput,
  resolveProfile,
} from "./canon.js";
export {
  formatCanonResult,
  formatCompareResult,
  formatConfigSummary,
} from "./format.js";
export { isJsonObject, parseJson, stableStringify } from "./json.js";
