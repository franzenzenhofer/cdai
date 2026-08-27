#!/usr/bin/env node

// src/commands/doctor.ts
import { existsSync as existsSync5 } from "node:fs";

// src/config.ts
import { readFileSync, existsSync } from "node:fs";

// src/paths.ts
import { homedir } from "node:os";
import { join, isAbsolute, resolve, sep } from "node:path";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
var APP_NAME = "cdai";
var TMP_SUFFIX = ".tmp";
var FILE_MODE = 420;
var configDir = () => {
  const override = process.env["CDAI_CONFIG_DIR"];
  if (override !== void 0 && override !== "") return resolve(expandTilde(override));
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg !== void 0 && xdg !== "") return join(xdg, APP_NAME);
  return join(homedir(), ".config", APP_NAME);
};
var dataDir = () => {
  const override = process.env["CDAI_DATA_DIR"];
  if (override !== void 0 && override !== "") return resolve(expandTilde(override));
  const xdg = process.env["XDG_DATA_HOME"];
  if (xdg !== void 0 && xdg !== "") return join(xdg, APP_NAME);
  return join(homedir(), ".local", "share", APP_NAME);
};
var configFile = () => join(configDir(), "config.json");
var dbFile = () => join(dataDir(), "db.json");
var indexFile = () => join(dataDir(), "index.json");
var visitsLog = () => join(dataDir(), "visits.log");
var expandTilde = (input) => {
  if (input === "~") return homedir();
  if (input.startsWith(`~${sep}`)) return join(homedir(), input.slice(2));
  return input;
};
var contractTilde = (input) => {
  const home = homedir();
  if (input === home) return "~";
  if (input.startsWith(home + sep)) return `~${sep}${input.slice(home.length + 1)}`;
  return input;
};
var absolutize = (input) => {
  const expanded = expandTilde(input);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
};
var ensureDir = (dir) => {
  mkdirSync(dir, { recursive: true });
};
var writeAtomic = (file, contents) => {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}${TMP_SUFFIX}`;
  writeFileSync(tmp, contents, { encoding: "utf8", mode: FILE_MODE });
  renameSync(tmp, file);
};
var dirname = (file) => {
  const idx = file.lastIndexOf(sep);
  return idx <= 0 ? sep : file.slice(0, idx);
};
var isUnder = (child, parent) => {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

// src/config.ts
var DEFAULT_DEPTH = 2;
var DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".cache"
];
var DEFAULT_AI = {
  enabled: true,
  command: "claude",
  args: [],
  model: "sonnet",
  /** Measured `claude -p` round trip on a warm machine is 13 to 17s, so 20s would be a coin flip. */
  timeoutMs: 45e3
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readRoots = (value) => {
  if (!Array.isArray(value)) return [];
  const roots = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      roots.push({ path: absolutize(entry), depth: DEFAULT_DEPTH });
      continue;
    }
    if (!isRecord(entry) || typeof entry["path"] !== "string") continue;
    const depth = entry["depth"];
    roots.push({
      path: absolutize(entry["path"]),
      depth: typeof depth === "number" && depth > 0 ? Math.floor(depth) : DEFAULT_DEPTH
    });
  }
  return roots;
};
var readAi = (value) => {
  if (!isRecord(value)) return { ...DEFAULT_AI };
  const args = value["args"];
  return {
    enabled: typeof value["enabled"] === "boolean" ? value["enabled"] : DEFAULT_AI.enabled,
    command: typeof value["command"] === "string" ? value["command"] : DEFAULT_AI.command,
    args: Array.isArray(args) ? args.filter((a) => typeof a === "string") : [],
    model: typeof value["model"] === "string" ? value["model"] : DEFAULT_AI.model,
    timeoutMs: typeof value["timeoutMs"] === "number" && value["timeoutMs"] > 0 ? value["timeoutMs"] : DEFAULT_AI.timeoutMs
  };
};
var readIgnore = (value) => Array.isArray(value) ? value.filter((v) => typeof v === "string") : [...DEFAULT_IGNORE];
var emptyConfig = () => ({ roots: [], ignore: [...DEFAULT_IGNORE], ai: { ...DEFAULT_AI } });
var configExists = () => existsSync(configFile());
var loadConfig = () => {
  const file = configFile();
  if (!existsSync(file)) return emptyConfig();
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`config is not a JSON object: ${file}`);
  return {
    roots: readRoots(parsed["roots"]),
    ignore: readIgnore(parsed["ignore"]),
    ai: readAi(parsed["ai"])
  };
};
var saveConfig = (config) => {
  writeAtomic(configFile(), `${JSON.stringify(config, null, 2)}
`);
};

// src/picker.ts
import { spawnSync } from "node:child_process";
import { closeSync, existsSync as existsSync2, openSync, readSync } from "node:fs";
import { delimiter, join as join2 } from "node:path";

// src/protocol.ts
var EXIT = {
  /** A path was printed on stdout, the shell function should cd to it. */
  ok: 0,
  /** Something went wrong (no match, bad usage, unreadable config). */
  error: 1,
  /** Handled, but deliberately no cd (user aborted the picker, doctor/setup output). */
  noCd: 3
};
var emitPath = (path) => {
  process.stdout.write(`${path}
`);
};
var note = (message) => {
  process.stderr.write(`${message}
`);
};
var jump = (path) => {
  note(`\u2192 ${contractTilde(path)}`);
  emitPath(path);
};
var fail = (message, hint) => {
  note(`cdai: ${message}`);
  if (hint !== void 0) note(`      ${hint}`);
};

// src/picker.ts
var TTY = "/dev/tty";
var FZF = "fzf";
var READ_BUFFER_BYTES = 256;
var FZF_ARGS = ["--height=40%", "--reverse", "--prompt=cdai> "];
var findOnPath = (command) => {
  const raw = process.env["PATH"] ?? "";
  for (const dir of raw.split(delimiter)) {
    if (dir === "") continue;
    const full = join2(dir, command);
    if (existsSync2(full)) return full;
  }
  return null;
};
var hasTty = () => existsSync2(TTY) && canOpenTty();
var canOpenTty = () => {
  try {
    closeSync(openSync(TTY, "r"));
    return true;
  } catch {
    return false;
  }
};
var pickWithFzf = (items) => {
  const input = items.map((item) => item.label).join("\n");
  const result = spawnSync(FZF, FZF_ARGS, { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
  if (result.status !== 0) return null;
  const chosen = result.stdout.trim();
  const match = items.find((item) => item.label === chosen);
  return match?.path ?? null;
};
var readLineFromTty = () => {
  const fd = openSync(TTY, "r");
  try {
    const buffer = Buffer.alloc(READ_BUFFER_BYTES);
    const bytes = readSync(fd, buffer, 0, READ_BUFFER_BYTES, null);
    return buffer.toString("utf8", 0, bytes).trim();
  } finally {
    closeSync(fd);
  }
};
var pickNumbered = (items) => {
  items.forEach((item, i) => note(`  ${i + 1}) ${item.label}`));
  process.stderr.write("cdai: pick 1-" + items.length + " (enter to abort): ");
  const answer = readLineFromTty();
  const choice = Number.parseInt(answer, 10);
  if (!Number.isFinite(choice) || choice < 1 || choice > items.length) return null;
  return items[choice - 1]?.path ?? null;
};
var confirm = (question) => {
  if (!hasTty()) {
    note(`${question} [no terminal, accepted]`);
    return true;
  }
  process.stderr.write(`${question} [Y/n] `);
  const answer = readLineFromTty().toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
};
var toItems = (paths) => paths.map((path) => ({ path, label: contractTilde(path) }));
var pick = (items) => {
  if (items.length === 0) return null;
  if (!hasTty()) {
    note("cdai: several matches, no terminal to ask on:");
    items.forEach((item) => note(`  ${item.label}`));
    return null;
  }
  if (findOnPath(FZF) !== null) return pickWithFzf(items);
  return pickNumbered(items);
};

// src/store/db.ts
import { existsSync as existsSync3, readFileSync as readFileSync2, readdirSync, renameSync as renameSync2, rmSync } from "node:fs";
import { join as join3 } from "node:path";

// src/store/frecency.ts
var HOUR_SECONDS = 3600;
var DAY_SECONDS = 86400;
var WEEK_SECONDS = 604800;
var AGE_WEIGHT = {
  withinHour: 4,
  withinDay: 2,
  withinWeek: 0.5,
  older: 0.25
};
var AGING_THRESHOLD = 9e3;
var AGING_FACTOR = 0.9;
var AGING_DROP_BELOW = 1;
var ageWeight = (ageSeconds) => {
  if (ageSeconds < HOUR_SECONDS) return AGE_WEIGHT.withinHour;
  if (ageSeconds < DAY_SECONDS) return AGE_WEIGHT.withinDay;
  if (ageSeconds < WEEK_SECONDS) return AGE_WEIGHT.withinWeek;
  return AGE_WEIGHT.older;
};
var frecency = (record, nowSeconds) => record.visits * ageWeight(Math.max(0, nowSeconds - record.lastVisit));
var totalVisits = (records) => records.reduce((sum, r) => sum + r.visits, 0);
var needsAging = (records) => totalVisits(records) > AGING_THRESHOLD;
var applyAging = (records) => records.map((r) => ({ ...r, visits: r.visits * AGING_FACTOR })).filter((r) => r.visits >= AGING_DROP_BELOW);

// src/store/db.ts
var DB_VERSION = 1;
var INGEST_PREFIX = "visits.log.ingest.";
var FIELD_SEPARATOR = "	";
var VISIT_INCREMENT = 1;
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readVisitRecord = (value) => {
  if (!isRecord2(value)) return void 0;
  const { path, visits, lastVisit } = value;
  if (typeof path !== "string" || path === "") return void 0;
  if (typeof visits !== "number" || typeof lastVisit !== "number") return void 0;
  return { path, visits, lastVisit };
};
var emptyDb = () => ({ version: DB_VERSION, records: [] });
var loadDb = () => {
  const file = dbFile();
  if (!existsSync3(file)) return emptyDb();
  const parsed = JSON.parse(readFileSync2(file, "utf8"));
  if (!isRecord2(parsed) || !Array.isArray(parsed["records"])) return emptyDb();
  const records = parsed["records"].map(readVisitRecord).filter((r) => r !== void 0);
  return { version: DB_VERSION, records };
};
var saveDb = (db) => {
  writeAtomic(dbFile(), `${JSON.stringify({ version: DB_VERSION, records: db.records })}
`);
};
var parseVisitLines = (contents) => {
  const visits = [];
  for (const line of contents.split("\n")) {
    if (line === "") continue;
    const tab = line.indexOf(FIELD_SEPARATOR);
    if (tab <= 0) continue;
    const epoch = Number.parseInt(line.slice(0, tab), 10);
    const path = line.slice(tab + 1);
    if (!Number.isFinite(epoch) || path === "") continue;
    visits.push({ path, epoch });
  }
  return visits;
};
var claimLogs = () => {
  const dir = dataDir();
  ensureDir(dir);
  const live = visitsLog();
  if (existsSync3(live)) {
    const claimed = join3(dir, `${INGEST_PREFIX}${process.pid}.${Date.now()}`);
    try {
      renameSync2(live, claimed);
    } catch {
      return pendingLogs(dir);
    }
  }
  return pendingLogs(dir);
};
var pendingLogs = (dir) => readdirSync(dir).filter((name) => name.startsWith(INGEST_PREFIX)).map((name) => join3(dir, name));
var mergeVisits = (db, visits) => {
  const byPath = new Map(db.records.map((r) => [r.path, r]));
  for (const visit of visits) {
    const existing = byPath.get(visit.path);
    byPath.set(visit.path, {
      path: visit.path,
      visits: (existing?.visits ?? 0) + VISIT_INCREMENT,
      lastVisit: Math.max(existing?.lastVisit ?? 0, visit.epoch)
    });
  }
  const records = [...byPath.values()];
  return { version: DB_VERSION, records: needsAging(records) ? applyAging(records) : records };
};
var ingest = () => {
  const logs = claimLogs();
  const db = loadDb();
  if (logs.length === 0) return db;
  const visits = [];
  for (const log of logs) {
    visits.push(...parseVisitLines(readFileSync2(log, "utf8")));
    rmSync(log, { force: true });
  }
  if (visits.length === 0) return db;
  const merged = mergeVisits(db, visits);
  saveDb(merged);
  return merged;
};

// src/store/indexer.ts
import { existsSync as existsSync4, readFileSync as readFileSync3, readdirSync as readdirSync2, realpathSync, statSync } from "node:fs";
import { basename, join as join4 } from "node:path";
var INDEX_VERSION = 1;
var INDEX_TTL_MS = 60 * 60 * 1e3;
var MAX_ENTRIES = 5e4;
var MAX_WALK_MS = 5e3;
var HIDDEN_PREFIX = ".";
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readEntry = (value) => {
  if (!isRecord3(value)) return void 0;
  const { path, name, mtime, root } = value;
  if (typeof path !== "string" || typeof name !== "string") return void 0;
  if (typeof mtime !== "number" || typeof root !== "string") return void 0;
  return { path, name, mtime, root };
};
var emptyIndex = () => ({ version: INDEX_VERSION, generatedAt: 0, entries: [] });
var loadIndex = () => {
  const file = indexFile();
  if (!existsSync4(file)) return emptyIndex();
  const parsed = JSON.parse(readFileSync3(file, "utf8"));
  if (!isRecord3(parsed) || !Array.isArray(parsed["entries"])) return emptyIndex();
  const generatedAt = parsed["generatedAt"];
  return {
    version: INDEX_VERSION,
    generatedAt: typeof generatedAt === "number" ? generatedAt : 0,
    entries: parsed["entries"].map(readEntry).filter((e) => e !== void 0)
  };
};
var saveIndex = (index) => {
  writeAtomic(indexFile(), `${JSON.stringify(index)}
`);
};
var isStale = (index, now) => now - index.generatedAt > INDEX_TTL_MS;
var shouldSkip = (name, ignore) => name.startsWith(HIDDEN_PREFIX) || ignore.includes(name);
var canonical = (dir) => {
  try {
    return realpathSync(dir);
  } catch {
    return void 0;
  }
};
var mtimeOf = (dir) => {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
};
var isDirectoryPath = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
var listDirs = (dir, ignore) => {
  let entries;
  try {
    entries = readdirSync2(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => ({ name: d.name, link: d.isSymbolicLink() }));
  } catch {
    return [];
  }
  return entries.filter((entry) => !shouldSkip(entry.name, ignore)).map((entry) => ({ path: join4(dir, entry.name), link: entry.link })).filter((entry) => !entry.link || isDirectoryPath(entry.path)).map((entry) => entry.path);
};
var walk = (dir, depth, root, state) => {
  if (depth > root.depth) return;
  if (state.entries.length >= MAX_ENTRIES || Date.now() > state.deadline) return;
  for (const child of listDirs(dir, state.ignore)) {
    if (state.entries.length >= MAX_ENTRIES || Date.now() > state.deadline) return;
    const real = canonical(child);
    if (real === void 0 || state.seen.has(real)) continue;
    state.seen.add(real);
    state.entries.push({ path: child, name: basename(child), mtime: mtimeOf(child), root: root.path });
    walk(child, depth + 1, root, state);
  }
};
var buildIndex = (config, now = Date.now()) => {
  const state = {
    entries: [],
    seen: /* @__PURE__ */ new Set(),
    deadline: now + MAX_WALK_MS,
    ignore: config.ignore
  };
  for (const root of config.roots) {
    if (!existsSync4(root.path)) continue;
    const real = canonical(root.path);
    if (real !== void 0) state.seen.add(real);
    walk(root.path, 1, root, state);
  }
  return { version: INDEX_VERSION, generatedAt: now, entries: state.entries };
};
var refreshIndex = (config, now = Date.now()) => {
  const index = buildIndex(config, now);
  saveIndex(index);
  return index;
};
var childrenOf = (index, path) => {
  const prefix = `${path}/`;
  return index.entries.filter(
    (e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes("/")
  );
};

// src/commands/doctor.ts
var MILLIS_PER_MINUTE = 6e4;
var mark = (ok) => ok ? "ok  " : "miss";
var reportRoots = () => {
  const config = loadConfig();
  note(`roots  ${config.roots.length}`);
  for (const root of config.roots) {
    note(`  ${mark(existsSync5(root.path))} ${contractTilde(root.path)} (depth ${root.depth})`);
  }
  note(`ai     ${config.ai.enabled ? "enabled" : "disabled"} via ${config.ai.command} ${config.ai.model}`);
  note(`  ${mark(findOnPath(config.ai.command) !== null)} ${config.ai.command} on PATH`);
};
var runDoctor = () => {
  note("cdai doctor");
  note(`node   ${process.version}`);
  note(`config ${mark(configExists())} ${configFile()}`);
  note(`data   ${dataDir()}`);
  if (!configExists()) {
    note("run `cdai setup` to get started");
    return EXIT.error;
  }
  reportRoots();
  const index = loadIndex();
  const ageMinutes = Math.round((Date.now() - index.generatedAt) / MILLIS_PER_MINUTE);
  note(`index  ${mark(existsSync5(indexFile()))} ${index.entries.length} dirs, ${ageMinutes}min old${isStale(index, Date.now()) ? " (stale)" : ""}`);
  note(`db     ${mark(existsSync5(dbFile()))} ${loadDb().records.length} remembered paths`);
  note(`visits ${mark(existsSync5(visitsLog()))} ${visitsLog()}`);
  note(`fzf    ${mark(findOnPath("fzf") !== null)}`);
  note(`tty    ${mark(hasTty())}`);
  return EXIT.noCd;
};

// src/commands/import-zoxide.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync6 } from "node:fs";
var ZOXIDE = "zoxide";
var ZOXIDE_ARGS = ["query", "--list", "--score"];
var MILLIS_PER_SECOND = 1e3;
var MIN_VISITS = 1;
var parseZoxideList = (stdout, nowSeconds) => {
  const records = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s+(.+)$/.exec(line);
    if (match === null) continue;
    const [, score, path] = match;
    if (score === void 0 || path === void 0) continue;
    records.push({
      path,
      visits: Math.max(MIN_VISITS, Math.round(Number.parseFloat(score))),
      /** Imported history is dated one day back, so it ranks below anything visited today. */
      lastVisit: nowSeconds - DAY_SECONDS
    });
  }
  return records;
};
var runImportZoxide = () => {
  if (findOnPath(ZOXIDE) === null) {
    fail("zoxide not found on PATH", "nothing to import");
    return EXIT.error;
  }
  const result = spawnSync2(ZOXIDE, ZOXIDE_ARGS, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`zoxide exited with ${String(result.status)}`, result.stderr.trim());
    return EXIT.error;
  }
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const imported = parseZoxideList(result.stdout, nowSeconds).filter((r) => existsSync6(r.path));
  const db = loadDb();
  const byPath = new Map(db.records.map((record) => [record.path, record]));
  for (const record of imported) {
    if (byPath.has(record.path)) continue;
    byPath.set(record.path, record);
  }
  saveDb({ version: db.version, records: [...byPath.values()] });
  note(`cdai: imported ${imported.length} paths from zoxide`);
  return EXIT.noCd;
};

// src/commands/index-cmd.ts
var MILLIS_PER_MINUTE2 = 6e4;
var runIndex = (args) => {
  const config = loadConfig();
  if (config.roots.length === 0) {
    fail("no roots configured", "run `cdai setup` once to pick the directories to learn");
    return EXIT.error;
  }
  if (args.includes("--refresh")) {
    const started = Date.now();
    const index2 = refreshIndex(config);
    note(`cdai: indexed ${index2.entries.length} directories in ${Date.now() - started}ms`);
    return EXIT.noCd;
  }
  const index = loadIndex();
  const ageMinutes = Math.round((Date.now() - index.generatedAt) / MILLIS_PER_MINUTE2);
  note(`cdai: ${index.entries.length} directories, ${ageMinutes}min old${isStale(index, Date.now()) ? " (stale)" : ""}`);
  for (const root of config.roots) {
    const count = index.entries.filter((entry) => entry.root === root.path).length;
    note(`      ${contractTilde(root.path)} depth ${root.depth}: ${count}`);
  }
  return EXIT.noCd;
};

// src/commands/query.ts
import { existsSync as existsSync8, statSync as statSync3 } from "node:fs";

// src/ai/claude.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync7, statSync as statSync2 } from "node:fs";
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var extractJsonBlock = (text) => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};
var parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
};
var parseAiAnswer = (raw) => {
  const envelope = parseJson(raw);
  const inner = isRecord4(envelope) && typeof envelope["result"] === "string" ? envelope["result"] : raw;
  const block = extractJsonBlock(inner);
  if (block === null) return null;
  const parsed = parseJson(block);
  if (!isRecord4(parsed)) return null;
  const path = parsed["path"];
  const reason = parsed["reason"];
  if (path !== null && typeof path !== "string") return null;
  return {
    path: path === null || path === "" ? null : path,
    reason: typeof reason === "string" ? reason : ""
  };
};
var aiArgs = (ai, prompt) => [
  ...ai.args,
  "-p",
  "--model",
  ai.model,
  "--output-format",
  "json",
  "--tools",
  "",
  "--no-session-persistence",
  prompt
];
var runCommand = (ai, prompt) => new Promise((resolve2, reject) => {
  const child = spawn(ai.command, aiArgs(ai, prompt), {
    signal: AbortSignal.timeout(ai.timeoutMs),
    stdio: ["ignore", "pipe", "ignore"]
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
  });
  child.on("error", reject);
  child.on(
    "close",
    (code) => code === 0 ? resolve2(out) : reject(new Error(`${ai.command} exited with ${String(code)}`))
  );
});
var isDirectory = (path) => {
  try {
    return existsSync7(path) && statSync2(path).isDirectory();
  } catch {
    return false;
  }
};
var validateAiPath = (path, config) => isDirectory(path) && config.roots.some((root) => isUnder(path, root.path));
var askAi = async (prompt, config) => {
  let raw;
  try {
    raw = await runCommand(config.ai, prompt);
  } catch (error) {
    return { kind: "none", why: error instanceof Error ? error.message : "ai backend failed" };
  }
  const answer = parseAiAnswer(raw);
  if (answer === null) return { kind: "none", why: "unparseable answer" };
  if (answer.path === null) return { kind: "none", why: answer.reason === "" ? "no idea" : answer.reason };
  if (!validateAiPath(answer.path, config)) {
    return { kind: "none", why: "answer is not an existing directory under a configured root" };
  }
  return { kind: "path", path: answer.path, reason: answer.reason };
};

// src/match/constants.ts
var SCORE = {
  exact: 1e3,
  prefix: 800,
  wordBoundary: 600,
  substring: 400,
  fuzzyMax: 380,
  /** Token found nowhere in the name but present in the path above it. */
  pathOnly: 200,
  none: 0
};
var FUZZY = {
  /** Base share of fuzzyMax awarded for matching all characters at all. */
  baseShare: 0.45,
  /** Share awarded proportionally to how densely the characters sit together. */
  densityShare: 0.35,
  /** Share awarded for how much of the candidate name the query covers. */
  coverageShare: 0.2
};
var BONUS = {
  /** Weight of log2(1 + frecency). */
  frecency: 100,
  /** Candidate lives under the current working directory. */
  underCwd: 25,
  /**
   * Deterministic tie break: awarded in proportion to how much of the candidate name the
   * query covers, so "bella" prefers "petalworks" over "petalworks-2026" at equal match class.
   */
  brevity: 40
};
var THRESHOLD = {
  /** A single candidate at or above this score wins outright when the gap is big enough. */
  hit: 550,
  /** Minimum gap between best and runner up for an outright win. */
  gap: 200,
  /** Candidates at or above this score are worth showing in the picker. */
  candidate: 400,
  /** Fewer than this many picker-worthy candidates falls through to the AI tier. */
  minPickerCandidates: 2
};
var LIMIT = {
  /** Candidates offered to the picker. */
  picker: 10,
  /** Fuzzy candidates handed to the AI tier. */
  aiFuzzy: 30,
  /** Most frecent paths handed to the AI tier. */
  aiFrecent: 20,
  /** Guesses printed when nothing matched. */
  suggestions: 3
};
var STOPWORDS = /* @__PURE__ */ new Set([
  "folder",
  "dir",
  "directory",
  "the",
  "project",
  "go",
  "to",
  "my",
  "in"
]);
var LATEST_WORDS = /* @__PURE__ */ new Set(["latest", "newest", "last", "recent"]);
var OLDEST_WORDS = /* @__PURE__ */ new Set(["oldest", "first"]);
var IN_OPERATOR = "in";
var YEAR_MIN = 1990;
var YEAR_MAX = 2999;

// src/ai/prompt.ts
var frecentPaths = (db, nowSeconds) => [...db.records].sort((a, b) => frecency(b, nowSeconds) - frecency(a, nowSeconds)).slice(0, LIMIT.aiFrecent).map((record) => record.path);
var bullets = (paths) => paths.length === 0 ? "  (none)" : paths.map((path) => `  ${path}`).join("\n");
var buildPrompt = (input) => {
  const fuzzy = input.ranked.slice(0, LIMIT.aiFuzzy).map((r) => r.candidate.path);
  return [
    "You map a shell user's vague directory request to exactly one existing directory path.",
    "",
    `User request: ${input.query}`,
    `Current directory: ${input.cwd}`,
    "",
    "Fuzzy match candidates (best first):",
    bullets(fuzzy),
    "",
    "Recently and frequently used directories:",
    bullets(frecentPaths(input.db, input.nowSeconds)),
    "",
    "Answer with ONE JSON object and nothing else:",
    '{"path": "<absolute path from the lists above>", "confidence": <0..1>, "reason": "<max 8 words>"}',
    'If no listed path plausibly matches, answer {"path": null, "reason": "<max 8 words>"}.',
    "Never invent a path that is not in the lists."
  ].join("\n");
};

// src/match/resolve.ts
import { basename as basename2, dirname as dirname2 } from "node:path";

// src/match/score.ts
var SEGMENT_SPLIT = /[^a-z0-9]+/;
var LOG_BASE_2 = Math.LN2;
var fuzzyScore = (token, name) => {
  if (token === "" || name === "") return SCORE.none;
  let first = -1;
  let last = -1;
  let cursor = 0;
  for (let i = 0; i < name.length && cursor < token.length; i += 1) {
    if (name[i] !== token[cursor]) continue;
    if (first === -1) first = i;
    last = i;
    cursor += 1;
  }
  if (cursor < token.length) return SCORE.none;
  const span = last - first + 1;
  const density = token.length / span;
  const coverage = token.length / name.length;
  const share = FUZZY.baseShare + FUZZY.densityShare * density + FUZZY.coverageShare * coverage;
  return Math.round(SCORE.fuzzyMax * share);
};
var hasBoundaryHit = (token, name) => name.split(SEGMENT_SPLIT).some((segment) => segment !== "" && segment.startsWith(token));
var matchName = (token, name) => {
  const lower = name.toLowerCase();
  if (lower === token) return SCORE.exact;
  if (lower.startsWith(token)) return SCORE.prefix;
  if (hasBoundaryHit(token, lower)) return SCORE.wordBoundary;
  if (lower.includes(token)) return SCORE.substring;
  return fuzzyScore(token, lower);
};
var parentPath = (path) => {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
};
var tokenScore = (token, candidate) => {
  const nameScore = matchName(token, candidate.name);
  if (nameScore > SCORE.none) return nameScore;
  return parentPath(candidate.path).toLowerCase().includes(token) ? SCORE.pathOnly : SCORE.none;
};
var frecencyBonus = (frecency2) => frecency2 <= 0 ? 0 : BONUS.frecency * (Math.log1p(frecency2) / LOG_BASE_2);
var brevityBonus = (query, candidate) => {
  const queried = query.tokens.reduce((sum, token) => sum + token.length, 0);
  if (queried === 0 || candidate.name.length === 0) return 0;
  return BONUS.brevity * Math.min(1, queried / candidate.name.length);
};
var passesFilters = (query, candidate) => {
  const lowerPath = candidate.path.toLowerCase();
  if (!query.years.every((year) => lowerPath.includes(year))) return false;
  if (query.rootFilter === null) return true;
  return candidate.root.toLowerCase().includes(query.rootFilter) || lowerPath.includes(query.rootFilter);
};
var scoreCandidate = (query, candidate, context) => {
  if (!passesFilters(query, candidate)) return SCORE.none;
  if (query.tokens.length === 0) return SCORE.none;
  let sum = 0;
  for (const token of query.tokens) {
    const single = tokenScore(token, candidate);
    if (single === SCORE.none) return SCORE.none;
    sum += single;
  }
  const base = sum / query.tokens.length;
  const frecency2 = context.frecencyByPath.get(candidate.path) ?? 0;
  const underCwd = candidate.path !== context.cwd && candidate.path.startsWith(`${context.cwd}/`) ? BONUS.underCwd : 0;
  return base + frecencyBonus(frecency2) + underCwd + brevityBonus(query, candidate);
};
var looseScore = (query, candidate) => {
  const name = candidate.name.toLowerCase();
  let best = SCORE.none;
  for (const token of query.tokens) {
    const forward = fuzzyScore(token, name);
    const backward = fuzzyScore(name, token);
    best = Math.max(best, forward, backward);
  }
  return best;
};
var rankCandidates = (query, candidates, context) => candidates.map((candidate) => ({ candidate, score: scoreCandidate(query, candidate, context) })).filter((scored) => scored.score > SCORE.none).sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path));

// src/match/resolve.ts
var frecencyMap = (db, nowSeconds) => new Map(db.records.map((record) => [record.path, frecency(record, nowSeconds)]));
var buildCandidates = (input) => {
  const byPath = /* @__PURE__ */ new Map();
  for (const entry of input.index.entries) byPath.set(entry.path, entry);
  for (const record of input.db.records) {
    if (byPath.has(record.path)) continue;
    byPath.set(record.path, { path: record.path, name: basename2(record.path), mtime: 0, root: "" });
  }
  return [...byPath.values()];
};
var isChained = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
var collapseChains = (ranked) => {
  const kept = [];
  for (const scored of ranked) {
    if (kept.some((k) => isChained(k.candidate.path, scored.candidate.path))) continue;
    kept.push(scored);
  }
  return kept;
};
var dropDescendants = (ranked) => {
  const paths = new Set(ranked.map((r) => r.candidate.path));
  return ranked.filter((scored) => {
    let parent = dirname2(scored.candidate.path);
    while (parent.length > 1) {
      if (paths.has(parent)) return false;
      parent = dirname2(parent);
    }
    return true;
  });
};
var pickByMtime = (candidates, newest) => [...candidates].sort((a, b) => newest ? b.mtime - a.mtime : a.mtime - b.mtime)[0];
var orderPool = (ranked, index) => {
  const best = ranked[0];
  if (best === void 0) return [];
  const contenders = ranked.filter((r) => r.score >= best.score - THRESHOLD.gap);
  return contenders.flatMap((r) => childrenOf(index, r.candidate.path));
};
var applyOrder = (query, ranked, index) => {
  const best = ranked[0];
  if (best === void 0) return { kind: "unsure", candidates: [] };
  const newest = query.order === "latest";
  const children = orderPool(ranked, index);
  const pool = children.length > 0 ? children : ranked.map((r) => r.candidate);
  const chosen = pickByMtime(pool, newest);
  if (chosen === void 0) return { kind: "unsure", candidates: ranked };
  return { kind: "hit", path: chosen.path, score: best.score };
};
var decide = (ranked) => {
  const best = ranked[0];
  if (best === void 0) return { kind: "unsure", candidates: [] };
  const runnerUp = ranked[1];
  const gap = best.score - (runnerUp?.score ?? 0);
  if (best.score >= THRESHOLD.hit && gap >= THRESHOLD.gap) {
    return { kind: "hit", path: best.candidate.path, score: best.score };
  }
  const shortlist = ranked.filter((r) => r.score >= THRESHOLD.candidate).slice(0, LIMIT.picker);
  if (shortlist.length >= THRESHOLD.minPickerCandidates) {
    return { kind: "choose", candidates: shortlist };
  }
  if (shortlist.length === 1 && best.score >= THRESHOLD.hit) {
    return { kind: "hit", path: best.candidate.path, score: best.score };
  }
  return { kind: "unsure", candidates: ranked.slice(0, LIMIT.aiFuzzy) };
};
var looseCandidates = (query, input) => buildCandidates(input).map((candidate) => ({ candidate, score: looseScore(query, candidate) })).filter((scored) => scored.score > 0).sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path)).slice(0, LIMIT.aiFuzzy);
var resolveQuery = (query, input) => {
  const context = {
    cwd: input.cwd,
    frecencyByPath: frecencyMap(input.db, input.nowSeconds)
  };
  if (query.order !== "none") {
    const detached = { cwd: "", frecencyByPath: /* @__PURE__ */ new Map() };
    const ordered = dropDescendants(rankCandidates(query, buildCandidates(input), detached));
    if (ordered.length > 0) return applyOrder(query, ordered, input.index);
  }
  const ranked = collapseChains(rankCandidates(query, buildCandidates(input), context));
  return decide(ranked);
};

// src/match/tokenize.ts
var YEAR_PATTERN = /^\d{4}$/;
var isYear = (token) => {
  if (!YEAR_PATTERN.test(token)) return false;
  const value = Number.parseInt(token, 10);
  return value >= YEAR_MIN && value <= YEAR_MAX;
};
var splitWords = (input) => input.toLowerCase().split(/\s+/).filter((word) => word !== "");
var takeRootFilter = (words) => {
  const rest = [];
  let rootFilter = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === void 0) continue;
    const next = words[i + 1];
    if (word === IN_OPERATOR && next !== void 0 && rootFilter === null) {
      rootFilter = next;
      i += 1;
      continue;
    }
    rest.push(word);
  }
  return { rest, rootFilter };
};
var takeOrder = (words) => {
  const rest = [];
  let order = "none";
  for (const word of words) {
    if (LATEST_WORDS.has(word) && order === "none") {
      order = "latest";
      continue;
    }
    if (OLDEST_WORDS.has(word) && order === "none") {
      order = "oldest";
      continue;
    }
    rest.push(word);
  }
  return { rest, order };
};
var tokenize = (input) => {
  const words = splitWords(input);
  const { rest: afterIn, rootFilter } = takeRootFilter(words);
  const { rest: afterOrder, order } = takeOrder(afterIn);
  const years = afterOrder.filter(isYear);
  const tokens = afterOrder.filter((word) => !isYear(word) && !STOPWORDS.has(word));
  return { raw: input, tokens, order, years, rootFilter };
};
var tokenizeArgs = (args) => tokenize(args.join(" "));

// src/commands/query.ts
var MILLIS_PER_SECOND2 = 1e3;
var isDirectory2 = (path) => {
  try {
    return existsSync8(path) && statSync3(path).isDirectory();
  } catch {
    return false;
  }
};
var suggest = (ranked, raw) => {
  fail(`no match for "${raw}"`);
  const guesses = ranked.slice(0, LIMIT.suggestions);
  if (guesses.length === 0) {
    note("      try `cdai index --refresh`, or add a root with `cdai setup`");
    return EXIT.error;
  }
  note("      closest:");
  guesses.forEach((g) => note(`        ${contractTilde(g.candidate.path)}`));
  return EXIT.error;
};
var aiTier = async (strict, context) => {
  const { ai } = context.config;
  const ranked = strict.length > 0 ? strict : looseCandidates(context.query, context.input);
  if (!ai.enabled) return suggest(strict, context.query.raw);
  if (findOnPath(ai.command) === null) {
    note(`cdai: ${ai.command} not on PATH, staying deterministic`);
    return suggest(strict, context.query.raw);
  }
  note(`cdai: thinking... (${ai.command} ${ai.model})`);
  const prompt = buildPrompt({
    query: context.query.raw,
    cwd: process.cwd(),
    ranked,
    db: context.db,
    nowSeconds: context.nowSeconds
  });
  const outcome = await askAi(prompt, context.config);
  if (outcome.kind === "none") {
    note(`cdai: ai had no usable answer (${outcome.why})`);
    return suggest(strict, context.query.raw);
  }
  const label = outcome.reason === "" ? "" : ` (${outcome.reason})`;
  if (!confirm(`cdai: ${contractTilde(outcome.path)}${label}`)) return EXIT.noCd;
  jump(outcome.path);
  return EXIT.ok;
};
var finish = async (decision, context) => {
  if (decision.kind === "hit") {
    jump(decision.path);
    return EXIT.ok;
  }
  if (decision.kind === "choose") {
    const chosen = pick(toItems(decision.candidates.map((c) => c.candidate.path)));
    if (chosen === null) return EXIT.noCd;
    jump(chosen);
    return EXIT.ok;
  }
  return aiTier(decision.candidates, context);
};
var freshIndex = (config) => {
  const index = loadIndex();
  return index.entries.length === 0 ? refreshIndex(config) : index;
};
var runQuery = async (args) => {
  const first = args[0];
  if (args.length === 1 && first !== void 0 && isDirectory2(absolutize(first))) {
    jump(absolutize(first));
    return EXIT.ok;
  }
  const query = tokenizeArgs(args);
  if (query.tokens.length === 0) {
    fail("nothing to search for", "usage: cdai <words describing the directory>");
    return EXIT.error;
  }
  const config = loadConfig();
  if (config.roots.length === 0) {
    fail("no roots configured", "run `cdai setup` once to pick the directories to learn");
    return EXIT.error;
  }
  const db = ingest();
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND2);
  let input = { index: freshIndex(config), db, cwd: process.cwd(), nowSeconds };
  let decision = resolveQuery(query, input);
  if (decision.kind === "unsure" && isStale(input.index, Date.now())) {
    input = { ...input, index: refreshIndex(config) };
    decision = resolveQuery(query, input);
  }
  return finish(decision, { query, config, db, nowSeconds, input });
};

// src/commands/setup.ts
import { basename as basename3 } from "node:path";

// src/commands/detect.ts
import { existsSync as existsSync9, readdirSync as readdirSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join5 } from "node:path";
var DEV_DIR_NAMES = ["dev", "code", "src", "projects", "work", "Developer", "repos", "git"];
var DEV_DEPTH = 2;
var CLOUD_DEPTH = 3;
var CLOUD_PATTERN = /dropbox|google drive|onedrive|icloud|nextcloud/i;
var HUB_MIN_CHILDREN = 20;
var CLOUD_SCAN_DEPTH = 4;
var CLOUD_SCAN_MS = 3e3;
var childDirs = (dir) => {
  try {
    return readdirSync3(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => join5(dir, entry.name));
  } catch {
    return [];
  }
};
var scanHubs = (dir, depth, deadline, found) => {
  if (depth > CLOUD_SCAN_DEPTH || Date.now() > deadline) return;
  const children = childDirs(dir);
  if (children.length >= HUB_MIN_CHILDREN) found.push({ path: dir, children: children.length });
  for (const child of children) scanHubs(child, depth + 1, deadline, found);
};
var bestHub = (cloudRoot, now = Date.now()) => {
  const found = [];
  scanHubs(cloudRoot, 1, now + CLOUD_SCAN_MS, found);
  const best = [...found].sort((a, b) => b.children - a.children)[0];
  return best?.path ?? null;
};
var cloudRoots = (home) => childDirs(home).filter((dir) => CLOUD_PATTERN.test(dir.slice(home.length + 1)));
var detectRoots = (home = homedir2()) => {
  const roots = [];
  for (const name of DEV_DIR_NAMES) {
    const dir = join5(home, name);
    if (existsSync9(dir)) roots.push({ path: dir, depth: DEV_DEPTH });
  }
  for (const cloud of cloudRoots(home)) {
    const hub = bestHub(cloud);
    if (hub !== null) roots.push({ path: hub, depth: CLOUD_DEPTH });
  }
  return roots;
};

// src/commands/setup.ts
var SHELL_LINES = {
  zsh: 'eval "$(cdai init zsh)"   # in ~/.zshrc',
  bash: 'eval "$(cdai init bash)"  # in ~/.bashrc',
  fish: "cdai init fish | source   # in ~/.config/fish/config.fish"
};
var DEFAULT_SHELL = "zsh";
var currentShell = () => {
  const shell = process.env["SHELL"];
  if (shell === void 0 || shell === "") return DEFAULT_SHELL;
  const name = basename3(shell);
  return name in SHELL_LINES ? name : DEFAULT_SHELL;
};
var mergeRoots = (existing, added) => {
  const byPath = new Map(existing.map((root) => [root.path, root]));
  for (const root of added) byPath.set(root.path, root);
  return [...byPath.values()];
};
var acceptedRoots = (candidates, all) => {
  if (!all) {
    return candidates.filter(
      (root) => confirm(`cdai: learn ${contractTilde(root.path)} (depth ${root.depth})?`)
    );
  }
  candidates.forEach((root) => note(`      ${contractTilde(root.path)} (depth ${root.depth})`));
  return [...candidates];
};
var runSetup = (args) => {
  const all = args.includes("--yes");
  const existing = loadConfig();
  const candidates = detectRoots().filter(
    (root) => !existing.roots.some((known) => known.path === root.path)
  );
  if (candidates.length === 0 && existing.roots.length === 0) {
    note("cdai: found no obvious project roots, add them by hand:");
    note(`      ${configFile()}`);
    return EXIT.error;
  }
  note("cdai: detected these project roots");
  const config = {
    roots: mergeRoots(existing.roots, acceptedRoots(candidates, all)),
    ignore: existing.ignore.length > 0 ? existing.ignore : [...DEFAULT_IGNORE],
    ai: existing.roots.length > 0 ? existing.ai : { ...DEFAULT_AI }
  };
  saveConfig(config);
  note(`cdai: wrote ${configFile()}`);
  const index = refreshIndex(config);
  note(`cdai: indexed ${index.entries.length} directories`);
  note("cdai: add this line to your shell config, then open a new shell");
  note(`      ${SHELL_LINES[currentShell()] ?? SHELL_LINES[DEFAULT_SHELL] ?? ""}`);
  return EXIT.noCd;
};

// src/shell/quote.ts
var shellQuote = (value) => `'${value.split(`'`).join(`'\\''`)}'`;
var fishQuote = (value) => `'${value.split(`'`).join(`\\'`)}'`;

// src/shell/bash.ts
var recorder = () => `if [ -n "\${EPOCHSECONDS+x}" ]; then
  __cdai_now() { printf '%s' "$EPOCHSECONDS"; }
else
  __cdai_now() { date +%s; }
fi

__cdai_record() {
  [ "$PWD" = "$__CDAI_LAST" ] && return 0
  __CDAI_LAST="$PWD"
  printf '%s\\t%s\\n' "$(__cdai_now)" "$PWD" >> "$_CDAI_DATA/visits.log" 2>/dev/null
}
case "$PROMPT_COMMAND" in
  *__cdai_record*) ;;
  *) PROMPT_COMMAND="__cdai_record\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac`;
var jumper = () => `cdai() {
  if [ "$#" -eq 0 ]; then
    builtin cd -- "$HOME"
    return
  fi
  if [ "$#" -eq 1 ] && [ "$1" = "-" ]; then
    builtin cd -
    return
  fi
  if [ "$#" -eq 1 ] && [ -d "$1" ]; then
    builtin cd -- "$1"
    return
  fi
  local result
  result="$(command \${CDAI_BIN:-cdai} query -- "$@")" || return $?
  [ -n "$result" ] && builtin cd -- "$result"
}`;
var bashInit = () => `# cdai shell integration (bash)
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
_CDAI_DATA="$CDAI_DATA_DIR"
[ -d "$_CDAI_DATA" ] || mkdir -p "$_CDAI_DATA"

${recorder()}

${jumper()}
`;

// src/shell/fish.ts
var recorder2 = () => `function __cdai_record --on-variable PWD
    printf '%s\\t%s\\n' (date +%s) "$PWD" >> "$CDAI_DATA_DIR/visits.log" 2>/dev/null
end`;
var jumper2 = () => `function cdai
    if test (count $argv) -eq 0
        builtin cd -- "$HOME"
        return
    end
    if test (count $argv) -eq 1; and test "$argv[1]" = "-"
        builtin cd -
        return
    end
    if test (count $argv) -eq 1; and test -d "$argv[1]"
        builtin cd -- "$argv[1]"
        return
    end
    set -l bin cdai
    if set -q CDAI_BIN
        set bin (string split ' ' -- $CDAI_BIN)
    end
    set -l result (command $bin query -- $argv)
    or return $status
    if test -n "$result"
        builtin cd -- "$result"
    end
end`;
var fishInit = () => `# cdai shell integration (fish)
if not set -q CDAI_DATA_DIR
    set -gx CDAI_DATA_DIR ${fishQuote(dataDir())}
end
if not test -d "$CDAI_DATA_DIR"
    mkdir -p "$CDAI_DATA_DIR"
end

${recorder2()}

${jumper2()}
`;

// src/shell/zsh.ts
var zshInit = () => `# cdai shell integration (zsh)
zmodload zsh/datetime 2>/dev/null
autoload -Uz add-zsh-hook
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
typeset -g _CDAI_DATA=\${CDAI_DATA_DIR}
[[ -d "$_CDAI_DATA" ]] || mkdir -p "$_CDAI_DATA"

__cdai_record() {
  print -r -- "\${EPOCHSECONDS}"$'\\t'"\${PWD}" >> "$_CDAI_DATA/visits.log" 2>/dev/null
}
add-zsh-hook chpwd __cdai_record

cdai() {
  if (( $# == 0 )); then
    builtin cd -- "$HOME"
    return
  fi
  if [[ $# -eq 1 && "$1" == "-" ]]; then
    builtin cd -
    return
  fi
  if [[ $# -eq 1 && -d "$1" ]]; then
    builtin cd -- "$1"
    return
  fi
  local result
  result="$(command \${=CDAI_BIN:-cdai} query -- "$@")" || return $?
  [[ -n "$result" ]] && builtin cd -- "$result"
}
`;

// src/cli.ts
var VERSION = "0.1.0";
var USAGE = [
  "cdai - cd with intent",
  "",
  "usage:",
  "  cdai <words>              jump to the directory you mean (via the shell function)",
  "  cdai query -- <words>     resolve only, prints the path on stdout",
  "  cdai init <zsh|bash|fish> print the shell integration, meant for eval",
  "  cdai setup [--yes]        detect project roots and write the config",
  "  cdai index [--refresh]    show or rebuild the directory index",
  "  cdai import zoxide        seed frecency from an existing zoxide database",
  "  cdai doctor               show what cdai sees on this machine",
  "  cdai --version"
].join("\n");
var INIT_TEMPLATES = {
  zsh: zshInit,
  bash: bashInit,
  fish: fishInit
};
var runInit = (shell) => {
  const template = shell === void 0 ? void 0 : INIT_TEMPLATES[shell];
  if (template === void 0) {
    fail("unknown shell", "usage: cdai init <zsh|bash|fish>");
    return EXIT.error;
  }
  process.stdout.write(template());
  return EXIT.ok;
};
var runImport = (target) => {
  if (target !== "zoxide") {
    fail("unknown import source", "usage: cdai import zoxide");
    return EXIT.error;
  }
  return runImportZoxide();
};
var queryArgs = (args) => {
  const rest = args.slice(1);
  return rest[0] === "--" ? rest.slice(1) : rest;
};
var dispatch = async (args) => {
  const command = args[0];
  if (command === void 0 || command === "--help" || command === "-h") {
    note(USAGE);
    return command === void 0 ? EXIT.error : EXIT.noCd;
  }
  if (command === "--version" || command === "-v") {
    note(VERSION);
    return EXIT.noCd;
  }
  if (command === "init") return runInit(args[1]);
  if (command === "setup") return runSetup(args.slice(1));
  if (command === "index") return runIndex(args.slice(1));
  if (command === "import") return runImport(args[1]);
  if (command === "doctor") return runDoctor();
  if (command === "query") return runQuery(queryArgs(args));
  return runQuery(args);
};
var main = async (argv) => {
  try {
    return await dispatch(argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return EXIT.error;
  }
};
process.exitCode = await main(process.argv.slice(2));
export {
  VERSION,
  main
};
