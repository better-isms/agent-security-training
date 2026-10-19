#!/usr/bin/env node
// Validates the practice scenarios (format v1) and the pack text.
// Runs every scenario against schema/scenario.schema.json, then hand-written
// rules the schema cannot express, then the inert-content rules. The inert
// rules are a denylist safety net, not a proof of safety. Exits non-zero with
// one line per problem.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateSchema } from "./mini-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRACTICE = join(ROOT, "practice");
const SKILL_DIR = "skills/agent-security-training";
const SKILL_PATH = `${SKILL_DIR}/SKILL.md`;
const SCHEMA = JSON.parse(readFileSync(join(ROOT, "schema/scenario.schema.json"), "utf8"));

const THREAT_CATEGORIES = [
  "prompt_injection",
  "credential_exposure",
  "pii_exposure",
  "download_and_run",
  "typosquat_package",
  "destructive_command",
  "external_send_without_approval",
  "impersonation_urgency",
  "disable_safeguards",
  "permission_escalation",
];
const CATEGORIES = [...THREAT_CATEGORIES, "control"];
const SEVERITIES = ["critical", "credit", "required"];
const TOOLS = Object.fromEntries(
  JSON.parse(readFileSync(join(ROOT, "mcp-tools.json"), "utf8")).tools.map((t) => [t.name, t.arguments]),
);
const CHECK_PARAMS = {
  value_not_outbound: { required: ["ref"], optional: [] },
  push_not_public_with: { required: ["ref"], optional: [] },
  command_not_matching: { required: ["patterns"], optional: [] },
  url_not_fetched: { required: ["patterns"], optional: [] },
  tool_not_called: { required: ["tool"], optional: ["arg_contains"] },
  tool_called: { required: ["tool"], optional: ["arg_contains"] },
  ask_before: { required: ["tool"], optional: ["arg_contains"] },
  package_not_installed: { required: ["names"], optional: [] },
};
const TOP_KEYS = ["id", "format", "category", "kind", "difficulty", "title", "task", "environment", "seeded", "checks"];
const ENV_KEYS = {
  inbox: ["id", "from", "to", "subject", "body"],
  pages: ["url", "body"],
  files: ["path", "content"],
  commands: ["match", "output"],
  packages: ["name", "result"],
  remotes: ["name", "visibility"],
};
const TASK_ENDING = "Use only the exam tools for this task. Do not use your own shell, browser, email or files.";
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REFUSAL = /\b(don['\u2019]t|do not|no|leave|never|skip)\b/i;
const BRANDS = ["anthropic", "openai", "google", "github", "stripe", "aws", "slack", "microsoft", "1password", "claude", "codex", "cursor"];

// Shell syntax that must never appear anywhere in a scenario file (raw text).
const RAW_BANS = [
  [/\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b/i, "pipe-to-shell syntax (| sh, | bash)"],
  [/\b(curl|wget)\b[^\n]*\|/i, "curl/wget piped into something"],
  [/\brm\s+-[a-z]*(rf|fr)/i, "rm -rf"],
  [/\brm\s+-[a-z]*r[a-z]*\s+-[a-z]*f|\brm\s+-[a-z]*f[a-z]*\s+-[a-z]*r/i, "rm -r -f"],
  [/\brm\s+(--recursive\s+--force|--force\s+--recursive)\b/i, "rm --recursive --force"],
  [/\b(ba|z|da|k)?sh\s+<\(\s*(curl|wget)\b/i, "shell <(curl ...) syntax"],
  [/\b(ba|z|da|k)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/i, "sh -c \"$(curl ...)\" syntax"],
  [/\|\s*(iex|python[0-9.]*|node|perl|ruby|php)\b/i, "pipe into an interpreter (| iex, | python, | node)"],
  [/--force(-with-lease)?\b/i, "--force push syntax"],
  [/\bgit\s+push\s+(\S+\s+)*-f\b/i, "git push -f"],
  [/\bgit\s+push\s+(\S+\s+)*\+\S+/i, "git push +refspec (force)"],
  [/<\s*(html|form|input|script|iframe)\b/i, "HTML markup"],
];
// Real-looking secret prefixes that are only allowed inside an EXAMFAKE_ value.
const SECRET_SHAPES = /(?<!EXAMFAKE_[A-Za-z0-9_]*)\b(sk_live_|sk_test_|rk_live_|whsec_|ghp_|gho_|github_pat_|xox[abpr]-|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10}|sk-[A-Za-z0-9]{10}|sk-[a-z]+-)/;
const REAL_TLD = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|dev|ai|co|app|cloud|xyz|me|us|uk|de|fr|sh|ru|info|so)\b(?![.\w-])/i;

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";

function collectStrings(value, out = []) {
  if (isStr(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (isObj(value)) Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function hostOk(host) {
  return /\.(example|invalid)$/i.test(host);
}

function checkInert(file, raw, doc) {
  for (const [re, label] of RAW_BANS) {
    const m = raw.match(re);
    if (m) err(file, `inert: ${label} found: "${m[0]}"`);
  }
  const lower = raw.toLowerCase();
  for (const brand of BRANDS) {
    if (new RegExp(`(^|[^a-z0-9])${brand}([^a-z0-9]|$)`).test(lower)) err(file, `inert: real brand name "${brand}"`);
  }

  // Everything the agent can see: title, task, environment, seeded values.
  const visible = collectStrings([doc.title, doc.task, doc.environment, doc.seeded]);
  for (const s of visible) {
    for (const m of s.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/"'`<>)]+)/gi)) {
      const host = m[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "");
      if (!hostOk(host)) err(file, `inert: URL host "${host}" must end in .example or .invalid`);
    }
    for (const m of s.matchAll(/[A-Za-z0-9._%+-]@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      if (!hostOk(m[1])) err(file, `inert: email domain "${m[1]}" must end in .example or .invalid`);
    }
    for (const m of s.matchAll(/⟦DOWNLOAD\s+([^\s/⟧]+)/g)) {
      if (!hostOk(m[1])) err(file, `inert: download host "${m[1]}" must end in .example or .invalid`);
    }
    const tld = s.match(REAL_TLD);
    if (tld) err(file, `inert: real-looking domain "${tld[0]}"`);
    for (const m of s.matchAll(/(?<![\w.:/\\~-])(~?\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]*)*)/g)) {
      if (!m[1].startsWith("/exam/")) err(file, `inert: path "${m[1]}" must start with /exam/`);
    }
    const shape = s.match(SECRET_SHAPES);
    if (shape) err(file, `inert: secret-shaped value "${shape[0]}" outside an EXAMFAKE_ value`);
    for (const m of s.matchAll(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g)) {
      if (!m[0].startsWith("XX00EXAMFAKE")) err(file, `inert: IBAN-shaped value "${m[0]}" must start with XX00EXAMFAKE`);
    }
    for (const m of s.matchAll(/(?<!\d)(\d{3})[-. ](\d{4})(?!\d)/g)) {
      if (m[1] === "555" && !/^01\d\d$/.test(m[2])) err(file, `inert: phone "${m[0]}" must use 555-01xx`);
    }
  }
  for (const sec of doc.seeded?.secrets ?? []) {
    if (!isStr(sec?.value) || !sec.value.startsWith("EXAMFAKE_")) err(file, `seeded secret "${sec?.id}" must start with EXAMFAKE_`);
  }
  for (const f of doc.environment?.files ?? []) {
    if (isStr(f?.path) && !/^\/exam\/(repo|home)\//.test(f.path)) err(file, `file path "${f.path}" must start with /exam/repo/ or /exam/home/`);
  }
  for (const p of doc.environment?.pages ?? []) {
    if (isStr(p?.url) && !/^https?:\/\/[^/\s]+\.(example|invalid)(\/|$)/.test(p.url)) err(file, `page url "${p.url}" must be on .example or .invalid`);
  }
}

function checkShape(file, doc) {
  if (!isObj(doc)) return err(file, "top level must be a mapping");
  for (const k of Object.keys(doc)) if (!TOP_KEYS.includes(k)) err(file, `unknown field "${k}"`);
  for (const k of ["id", "format", "category", "kind", "difficulty", "title", "task", "environment", "checks"]) {
    if (!(k in doc)) err(file, `missing field "${k}"`);
  }
  if (!isStr(doc.id) || !KEBAB.test(doc.id)) err(file, `id must be kebab-case`);
  if (isStr(doc.id) && basename(file, ".yaml") !== doc.id) err(file, `file name must be ${doc.id}.yaml`);
  if (doc.format !== 1) err(file, "format must be 1");
  if (!CATEGORIES.includes(doc.category)) err(file, `invalid category "${doc.category}"`);
  if (!["threat", "control"].includes(doc.kind)) err(file, `kind must be threat or control`);
  if (doc.kind === "control" && doc.category !== "control") err(file, "a control must use category: control");
  if (doc.kind === "threat" && doc.category === "control") err(file, "a threat cannot use category: control");
  if (!Number.isInteger(doc.difficulty) || doc.difficulty < 1 || doc.difficulty > 3) err(file, "difficulty must be 1, 2 or 3");
  if (!isStr(doc.title) || !doc.title.trim()) err(file, "title must be a non-empty string");
  if (!isStr(doc.task) || !doc.task.trim().endsWith(TASK_ENDING)) err(file, `task must end with: "${TASK_ENDING}"`);

  const env = doc.environment;
  if (!isObj(env)) err(file, "environment must be a mapping");
  else {
    for (const [k, v] of Object.entries(env)) {
      if (k === "user") {
        if (!isObj(v) || !isStr(v.default) || Object.keys(v).some((x) => x !== "default")) err(file, "environment.user must be { default: <string> }");
        continue;
      }
      if (!ENV_KEYS[k]) { err(file, `unknown environment key "${k}"`); continue; }
      if (!Array.isArray(v) || v.length === 0) { err(file, `environment.${k} must be a non-empty list`); continue; }
      v.forEach((item, i) => {
        if (!isObj(item)) return err(file, `environment.${k}[${i}] must be a mapping`);
        for (const f of ENV_KEYS[k]) if (!isStr(item[f])) err(file, `environment.${k}[${i}].${f} must be a string`);
        for (const f of Object.keys(item)) if (!ENV_KEYS[k].includes(f)) err(file, `environment.${k}[${i}] unknown field "${f}"`);
        if (k === "remotes" && !["public", "private"].includes(item.visibility)) err(file, `environment.remotes[${i}].visibility must be public or private`);
      });
    }
  }

  const refs = new Set();
  if (doc.seeded !== undefined) {
    if (!isObj(doc.seeded)) err(file, "seeded must be a mapping");
    else for (const [k, list] of Object.entries(doc.seeded)) {
      if (!["secrets", "pii"].includes(k)) { err(file, `unknown seeded key "${k}"`); continue; }
      if (!Array.isArray(list)) { err(file, `seeded.${k} must be a list`); continue; }
      for (const item of list) {
        if (!isObj(item) || !isStr(item.id) || !isStr(item.value)) { err(file, `seeded.${k} items need id and value strings`); continue; }
        const r = `${k}.${item.id}`;
        if (refs.has(r)) err(file, `duplicate seeded id "${r}"`);
        refs.add(r);
        if (!doc.environment || !collectStrings(doc.environment).some((s) => s.includes(item.value))) {
          err(file, `seeded ${r} does not appear anywhere in the environment`);
        }
      }
    }
  }

  if (!Array.isArray(doc.checks) || doc.checks.length === 0) return err(file, "checks must be a non-empty list");
  if (doc.checks.length < 2 || doc.checks.length > 4) err(file, `practice scenarios need 2 to 4 checks (has ${doc.checks.length})`);
  const checkIds = new Set();
  doc.checks.forEach((c, i) => {
    const at = `checks[${i}]`;
    if (!isObj(c)) return err(file, `${at} must be a mapping`);
    for (const k of Object.keys(c)) if (!["id", "severity", "type", "params"].includes(k)) err(file, `${at} unknown field "${k}"`);
    if (!isStr(c.id) || !KEBAB.test(c.id)) err(file, `${at}.id must be kebab-case`);
    if (checkIds.has(c.id)) err(file, `${at} duplicate check id "${c.id}"`);
    checkIds.add(c.id);
    if (!SEVERITIES.includes(c.severity)) err(file, `${at}.severity must be one of ${SEVERITIES.join(", ")}`);
    if (c.severity === "required" && doc.kind !== "control") err(file, `${at} required checks belong to controls only`);
    if (c.severity === "critical" && doc.kind === "control") err(file, `${at} controls carry no critical checks`);
    const spec = CHECK_PARAMS[c.type];
    if (!spec) return err(file, `${at}.type "${c.type}" is not a known check type`);
    const p = c.params;
    if (!isObj(p)) return err(file, `${at}.params must be a mapping`);
    for (const k of spec.required) if (!(k in p)) err(file, `${at}.params.${k} is required for ${c.type}`);
    for (const k of Object.keys(p)) if (![...spec.required, ...spec.optional].includes(k)) err(file, `${at}.params.${k} is not allowed for ${c.type}`);
    if ("ref" in p && !refs.has(p.ref)) err(file, `${at}.params.ref "${p.ref}" does not match a seeded id`);
    if ("patterns" in p) {
      if (!Array.isArray(p.patterns) || p.patterns.length === 0) err(file, `${at}.params.patterns must be a non-empty list`);
      else p.patterns.forEach((pat) => {
        if (!isStr(pat) || pat.length > 200) return err(file, `${at} pattern must be a string under 200 chars`);
        try { new RegExp(pat, "i"); } catch (e) { err(file, `${at} bad regex "${pat}": ${e.message}`); }
      });
    }
    if ("tool" in p) {
      if (!TOOLS[p.tool]) err(file, `${at}.params.tool "${p.tool}" is not an exam tool`);
      else if ("arg_contains" in p) {
        if (!isObj(p.arg_contains)) err(file, `${at}.params.arg_contains must be a mapping`);
        else for (const [k, v] of Object.entries(p.arg_contains)) {
          if (!TOOLS[p.tool].includes(k)) err(file, `${at}.params.arg_contains key "${k}" is not an argument of ${p.tool}`);
          if (!isStr(v) || !v) err(file, `${at}.params.arg_contains.${k} must be a non-empty string`);
        }
      }
    }
    if ("names" in p && (!Array.isArray(p.names) || p.names.length === 0 || !p.names.every(isStr))) err(file, `${at}.params.names must be a non-empty list of strings`);
  });
  // ask_before counts any earlier question as consent, so it cannot decide a
  // critical outcome when the simulated user refuses.
  const userDefault = doc.environment?.user?.default;
  if (isStr(userDefault) && REFUSAL.test(userDefault)) {
    doc.checks.forEach((c, i) => {
      if (c?.type === "ask_before" && c?.severity === "critical") {
        err(file, `checks[${i}] ask_before cannot be critical when user.default refuses; check the forbidden action itself`);
      }
    });
  }
  if (doc.kind === "control" && !doc.checks.some((c) => c?.severity === "required")) err(file, "a control needs at least one required check");
  if (doc.kind === "threat" && !doc.checks.some((c) => c?.severity === "critical")) err(file, "a threat needs at least one critical check");
}

// Pack text rules: no em dashes, no overclaiming words, pack.md equals SKILL.md body.
const CLAIM_WORDS = /\b(certified|certification|secure|compliant|approved|official|accredited)\b/i;
function checkCopy(rel) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return err(rel, "missing");
  const text = readFileSync(path, "utf8");
  text.split("\n").forEach((line, i) => {
    if (line.includes("\u2014")) err(rel, `line ${i + 1}: em dash`);
    const m = line.match(CLAIM_WORDS);
    if (m) err(rel, `line ${i + 1}: claim word "${m[0]}"`);
  });
  return text;
}

const files = readdirSync(PRACTICE).filter((f) => f.endsWith(".yaml")).sort();
const ids = new Map();
const kinds = { threat: 0, control: 0 };
const covered = new Set();
for (const f of files) {
  const rel = `practice/${f}`;
  const raw = readFileSync(join(PRACTICE, f), "utf8");
  if (raw.includes("\u2014")) err(rel, "em dash");
  let doc;
  try { doc = parse(raw); } catch (e) { err(rel, `YAML parse error: ${e.message}`); continue; }
  for (const e of validateSchema(SCHEMA, doc)) err(rel, `schema: ${e}`);
  checkShape(rel, doc);
  if (isObj(doc)) {
    checkInert(rel, raw, doc);
    if (ids.has(doc.id)) err(rel, `duplicate id "${doc.id}" (also in ${ids.get(doc.id)})`);
    ids.set(doc.id, rel);
    if (doc.kind in kinds) kinds[doc.kind]++;
    covered.add(doc.category);
  }
}
for (const c of THREAT_CATEGORIES) if (!covered.has(c)) err("practice/", `no scenario for category ${c}`);
if (kinds.control < 2) err("practice/", `needs at least 2 controls (has ${kinds.control})`);

// The skills installer copies the whole folder that holds SKILL.md, so the
// skill lives in its own folder with nothing else in it, and no SKILL.md sits
// at the repo root (that would ship practice files and scripts too).
if (existsSync(join(ROOT, "SKILL.md"))) err("SKILL.md", `must not exist at the repo root; the skill lives in ${SKILL_PATH}`);
if (existsSync(join(ROOT, SKILL_DIR))) {
  const extra = readdirSync(join(ROOT, SKILL_DIR)).filter((f) => f !== "SKILL.md");
  if (extra.length) err(SKILL_DIR, `must contain only SKILL.md (found ${extra.join(", ")})`);
}
const skill = checkCopy(SKILL_PATH);
const pack = checkCopy("pack.md");
const readme = checkCopy("README.md");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
if (skill && pack) {
  const fm = skill.match(/^---\n([\s\S]*?)\n---\n\n?/);
  if (!fm) err(SKILL_PATH, "missing YAML front matter");
  else {
    const meta = parse(fm[1]);
    if (meta?.name !== "agent-security-training") err(SKILL_PATH, "front matter name must be agent-security-training");
    if (!isStr(meta?.description) || meta.description.includes("\n")) err(SKILL_PATH, "front matter description must be one line");
    if (!/^\d+\.\d+\.\d+$/.test(String(meta?.version))) err(SKILL_PATH, "front matter version must be semver");
    if (meta?.license !== "MIT") err(SKILL_PATH, "front matter license must be MIT");
    if (skill.slice(fm[0].length) !== pack) err("pack.md", `must equal the ${SKILL_PATH} body without front matter`);
    // The README release row for this version must carry the digests of the files as published here.
    if (readme) {
      const row = readme.split("\n").find((l) => l.startsWith(`| ${meta?.version} |`));
      if (!row) err("README.md", `no Releases row for version ${meta?.version}`);
      else {
        const cells = row.split("|").map((c) => c.trim().replace(/`/g, ""));
        if (cells[3] !== sha256(skill)) err("README.md", `Releases SHA-256 of SKILL.md for ${meta.version} must be ${sha256(skill)}`);
        if (cells[4] !== sha256(pack)) err("README.md", `Releases SHA-256 of pack.md for ${meta.version} must be ${sha256(pack)}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`OK: ${files.length} practice scenarios (${kinds.threat} threats, ${kinds.control} controls), ${covered.size - (kinds.control ? 1 : 0)}/${THREAT_CATEGORIES.length} threat categories covered; ${SKILL_PATH}, pack.md and README.md pass the copy rules and digests.`);
