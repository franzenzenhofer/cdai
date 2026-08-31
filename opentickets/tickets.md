# JIRA Tickets

## Personas

- P1: Developer new to cdai; wants a five-minute zsh setup; macOS laptop; unfamiliar with shell wrappers.
- P2: CLI power user; expects zsh/Bash/fish and native `cd` edge cases to agree; keyboard-first workflow.
- P3: Privacy-conscious team lead; wants deterministic navigation and explicit control over cloud AI exposure.

## Task Scripts

- P1 tasks: install and run setup; reload the shell; Tab-complete an indexed folder; run doctor after an error; check the installed version.
- P2 tasks: use `-L`/`-P` and zsh old-new substitution; combine flags with indexed intent; navigate explicit missing paths; test CDPATH; refresh the index.
- P3 tasks: inspect the selected AI backend; disable AI; verify what data can leave the machine; repeat a confirmed natural-language jump.

## Tickets

### TCK-001: Route management controls past the shell wrapper

- Status: Done in 0.2.1
- Epic: EPIC-001
- Type: Bug
- Severity: S1
- Priority: P1
- Persona: P1
- Scenario: Run documented maintenance commands after evaluating `cdai init <shell>`.
- Steps:
  1. Load the generated shell integration.
  2. Run `cdai doctor`, `cdai index --refresh`, or `cdai --version`.
- Expected: The executable dispatcher handles the command, cwd stays unchanged, and success exits zero.
- Actual: In 0.2.0 the wrapper treated controls as native paths or intent; `doctor` could invoke AI.
- IS: Fixed in 0.2.1 with one shared reserved-control contract and real zsh/Bash routing coverage.
- SHOULD: Keep every public control routed directly in all supported shells and never pass it to AI.
- Reasoning: A wrapper must not hide the setup, recovery, diagnostic, or version commands documented to users.
- Code hints: `src/shell/control.ts`, shell templates, CLI command exit codes, shell routing tests.
- Acceptance criteria:
  - Every reserved control reaches the executable after shell initialization.
  - Management success exits zero and never changes cwd.
  - `doctor` and help/version never enter query or AI paths.

### TCK-002: Compose native cd flags with indexed intent

- Status: Done in 0.3.0
- Epic: EPIC-001
- Type: UX
- Severity: S2
- Priority: P1
- Persona: P2
- Scenario: Resolve an indexed name while requesting physical or logical path semantics.
- Steps:
  1. Index a directory not reachable as a literal relative path.
  2. Run `cdai -P <intent>` and press Tab after the flag.
- Expected: cdai resolves the intent, then applies valid shell-native flags to the trusted result.
- Actual: The builtin receives the unresolved word, fails, and the wrapper returns; indexed completion also disappears.
- IS: Fixed in 0.3.0; zsh/Bash parse valid native flags, resolve only the intent, then apply the flags to the trusted path.
- SHOULD: Parse supported shell flags, complete the remaining intent, resolve it, and apply the original flags.
- Reasoning: The stated product goal is native `cd` behavior plus intent, so these capabilities must compose.
- Code hints: zsh/Bash/fish jumpers and completers; table-driven flag matrices per shell.
- Acceptance criteria:
  - `-L`/`-P` work with literal and indexed destinations in zsh and Bash.
  - zsh stack forms and Bash-specific valid flags retain native behavior.
  - Completion ignores valid flags when ranking indexed names.
  - Invalid options preserve the builtin diagnostic and status.

### TCK-003: Preserve native errors for explicit missing paths

- Status: Done in 0.3.0
- Epic: EPIC-001
- Type: Bug
- Severity: S2
- Priority: P1
- Persona: P2
- Scenario: Mistype an explicit relative or absolute path.
- Steps:
  1. Run `cdai ./missing`, `cdai ../missing`, or `cdai /missing`.
  2. Observe fallback behavior and error text.
- Expected: Explicit path syntax stays native-only and reports the shell builtin error.
- Actual: The native error is suppressed and the path can be fuzzy/AI-rerouted as intent.
- IS: Fixed in 0.3.0; slash-bearing and tilde-shaped arguments remain native-only after failure.
- SHOULD: Treat slash-bearing/path-shaped arguments as authoritative native paths.
- Reasoning: Explicit syntax signals strong intent; silently guessing another destination is unsafe.
- Code hints: native-first decision in all three shell templates; path-shape parity tests.
- Acceptance criteria:
  - Explicit missing paths never invoke index, picker, or AI.
  - Builtin status and diagnostic are preserved.
  - Plain non-path words still fall back to cdai intent.

### TCK-004: Add behavioral completion parity and duplicate context

- Status: Done in 0.3.0
- Epic: EPIC-002
- Type: UX
- Severity: S2
- Priority: P1
- Persona: P2
- Scenario: Use indexed Tab completion across shells, flags, spaces, and duplicate folder names.
- Steps:
  1. Create duplicate indexed basenames in different roots.
  2. Complete a partial name in zsh, Bash, and fish, with and without flags.
- Expected: Safe insertion, useful root/path context, and equivalent supported behavior across shells.
- Actual: zsh was interactively verified, Bash has partial automation, fish has no runtime test, and duplicate names collapse to one bare label.
- IS: Fixed in 0.3.1 with flag stripping, stale-history rejection, safe duplicate basenames, real PTY coverage, and Fish CI coverage.
- SHOULD: Keep shell-level completion tests and defer duplicate destination choice to the resolver picker.
- Reasoning: Tab is a primary flow; generated-script assertions alone cannot catch quoting or cursor bugs.
- Code hints: `src/commands/complete.ts`, shell completers, CI image with fish, PTY completion harness.
- Acceptance criteria:
  - Interactive or equivalent behavioral tests cover all supported shells.
  - Spaces, unicode, flags, missing index, and duplicate roots are covered.
  - Tab never crawls, opens a picker, or invokes AI.

### TCK-005: Refresh stale or vanished confident hits once

- Status: Done in 0.3.0
- Epic: EPIC-002
- Type: Bug
- Severity: S3
- Priority: P2
- Persona: P2
- Scenario: A cached high-confidence directory was moved or deleted after indexing.
- Steps:
  1. Build an index and move a clear-hit directory.
  2. Run the same intent while the cache is stale.
- Expected: cdai refreshes once, re-resolves, and either finds the new entry or gives current suggestions.
- Actual: Refresh only occurs for an `unsure` decision; a vanished clear hit errors without retrying.
- IS: Fixed in 0.3.0; vanished hits refresh and re-resolve once, and index config fingerprints invalidate changed roots/depth/ignore.
- SHOULD: On a nonexistent hit, refresh at most once and resolve again, with configuration fingerprints invalidating incompatible caches.
- Reasoning: Users care about filesystem truth, not the confidence of an obsolete snapshot.
- Code hints: query orchestration and index metadata; guard against repeated crawls.
- Acceptance criteria:
  - A vanished hit triggers at most one refresh per invocation.
  - The second decision uses the refreshed index.
  - Hot-path latency remains unchanged for existing hits.

### TCK-006: Disclose AI selection and remember confirmed intent locally

- Status: Done in 0.3.0
- Epic: EPIC-003
- Type: UX
- Severity: S3
- Priority: P2
- Persona: P3
- Scenario: Finish setup and repeatedly use the same natural-language intent.
- Steps:
  1. Run setup with an auto-detected cloud backend.
  2. Confirm an AI-selected directory, then repeat the same intent.
- Expected: Setup names the backend/data exposure and the confirmed intent resolves locally on repeat.
- Actual: AI defaults to auto with limited onboarding disclosure; confirmed phrasing is not remembered.
- IS: Fixed in 0.3.0 with setup disclosure/opt-out and a bounded, versioned, validated local alias store.
- SHOULD: Offer a clear opt-out and store only normalized, confirmed intent aliases with safe invalidation.
- Reasoning: Progressive trust reduces privacy surprise, latency, and repeated model cost.
- Code hints: setup copy/config flow, a small versioned alias store, query fast path before AI.
- Acceptance criteria:
  - Setup states selected backend and that query/candidate paths may leave the machine.
  - Users can disable AI during setup.
  - Only confirmed aliases are stored locally.
  - Missing or invalid alias targets safely fall through to deterministic resolution.

### TCK-007: Fail closed when setup or AI confirmation has no terminal

- Status: Done in 0.3.1
- Epic: EPIC-004
- Type: Security
- Severity: S1
- Priority: P1
- Persona: P3
- Scenario: Run first-time setup or an ambiguous AI-assisted query from a script, pipe, or background process.
- Steps:
  1. Invoke setup without a controlling terminal.
  2. Omit an explicit AI choice, or trigger an AI answer that would require confirmation.
- Expected: No root, AI setting, or remembered alias is accepted without explicit consent.
- Actual: Headless confirmation previously defaulted to yes, silently enabling setup choices and persisting AI-selected intent.
- IS: Fixed in 0.3.1; first-time headless setup requires `--yes` plus `--ai` or `--no-ai`, and headless AI confirmation declines without saving.
- SHOULD: Every consent boundary fail closed when the user cannot answer.
- Reasoning: Absence of a terminal is not consent, especially when directory names can leave the machine.
- Code hints: `src/picker.ts`, setup option parsing, query confirmation, PTY and headless tests.
- Acceptance criteria:
  - Headless first setup rejects incomplete consent and writes no config.
  - `--yes --ai` and `--yes --no-ai` remain explicit automation paths.
  - An unconfirmed AI result never changes cwd or creates an alias.
  - Interactive acceptance is covered with a real pseudo-terminal.

### TCK-008: Serialize and privatize learned state

- Status: Done in 0.3.1
- Epic: EPIC-004
- Type: Bug
- Severity: S1
- Priority: P1
- Persona: P2
- Scenario: Several shell sessions record visits, ingest logs, or remember aliases at the same time.
- Steps:
  1. Create many independent visit claims or alias writes.
  2. Start concurrent cdai processes against one data directory.
- Expected: Every valid update is applied exactly once, survives interruption, and remains private to the owner.
- Actual: Read-modify-write races lost visits and aliases; visit claims could be removed before a durable database save; state used permissive default modes.
- IS: Fixed in 0.3.1 with recoverable cross-process locks, durable claim markers, atomic owner-only writes, legacy mode tightening, schema validation, canonical identities, and bounded databases.
- SHOULD: State transactions be atomic, replay-safe, private, bounded, and forward-schema safe.
- Reasoning: Ranking quality degrades invisibly when learning data races, while paths reveal sensitive project and client names.
- Code hints: `src/store/lock.ts`, `src/store/db.ts`, `src/store/aliases.ts`, `src/paths.ts`.
- Acceptance criteria:
  - Multi-process visit ingestion produces the exact expected count.
  - Multi-process alias updates preserve every unique alias.
  - A failed database save leaves the source claim recoverable.
  - Config/data directories are `0700` and state files are `0600` or stricter.
  - Future database/index schemas are rejected safely and record counts are capped.

### TCK-009: Preserve native behavior across all supported shell forms

- Status: Done in 0.3.1
- Epic: EPIC-005
- Type: Bug
- Severity: S1
- Priority: P1
- Persona: P2
- Scenario: Use directory history, CDPATH, late invalid flags, multiple operands, physical/logical flags, or a directory named like a management command.
- Steps:
  1. Exercise the forms in zsh, Bash, older Fish, and Fish 4.8.
  2. Compare cdai status, cwd, and diagnostics with the shell's native `cd`.
- Expected: Native syntax wins; only plain unresolved intent enters the matcher.
- Actual: Fish bypassed its `cd` wrapper and history, only the first operand was checked for explicit paths, late flags could be guessed, and reserved-name directories were unreachable.
- IS: Fixed in 0.3.1 with all-operand path checks, late-option rejection, stable native diagnostics, local-directory precedence, Fish history/CDPATH preservation, and feature-detected Fish 4.8 flags.
- SHOULD: cdai behave as native `cd` for every form it does not intentionally extend.
- Reasoning: Navigation mistakes are high-cost and immediately destroy muscle-memory trust.
- Code hints: shell parsers/jumpers, `src/shell/control.ts`, real-shell parity matrices.
- Acceptance criteria:
  - Explicit paths in any operand never invoke fuzzy or AI resolution.
  - Native invalid forms preserve a nonzero native status and diagnostic.
  - `cd -`, directory history, CDPATH, and zsh substitution work end to end.
  - Current Fish long/short logical and physical flags compose with indexed intent.
  - An existing one-word reserved directory remains reachable.

### TCK-010: Make Tab completion additive, directory-only, and deterministic

- Status: Done in 0.3.1
- Epic: EPIC-005
- Type: UX
- Severity: S2
- Priority: P1
- Persona: P1
- Scenario: Press Tab on a partial filesystem directory, an indexed name, a duplicate, a hyphenated name, or an unrelated token.
- Steps:
  1. Load each generated shell integration in a real shell.
  2. Complete partial words with and without flags and `--`.
- Expected: Filesystem directories and confident cached intent coexist; the typed token is never erased or shortened; files and unrelated guesses are absent.
- Actual: zsh's unconditional replacement and unrelated fuzzy results could erase text; Bash indexed output could hide exact filesystem completion; Fish admitted generic file candidates.
- IS: Fixed in 0.3.1 with guarded compact/typo/multi-word completion, shell-native and CDPATH directory candidates, match-class ordering, safe duplicate basenames, management option completion, and real PTY tests. Multiple non-prefix results are suppressed so shells cannot shorten the active token.
- SHOULD: Completion be additive, non-destructive, directory-only, cached, and independent of AI/crawling.
- Reasoning: Tab is the highest-frequency UI and must be safe even when a guess is weak.
- Code hints: `src/commands/complete.ts`, shell completers, `test/e2e-completion-pty.test.ts`.
- Acceptance criteria:
  - Real Bash and zsh Tab sessions preserve/complete the intended token.
  - Fish behavioral completion excludes regular files.
  - Compact fuzzy, typo, operators, aliases, duplicates, unrelated input, and literal paths are covered.
  - Spaces, Unicode, duplicate names, flags, and `--` are covered.
  - Completion never invokes AI, picker, or index refresh.
  - Cached completion median/p95 and a synthetic 50,000-entry typo path stay within hard budgets.

### TCK-011: Reject ambiguous path protocols and terminate AI process trees

- Status: Done in 0.3.1
- Epic: EPIC-006
- Type: Security
- Severity: S2
- Priority: P1
- Persona: P3
- Scenario: Encounter a newline-bearing directory name or an AI CLI that hangs after spawning descendants.
- Steps:
  1. Index or record a path that cannot be represented by the line protocol.
  2. Run a backend shim that starts a sleeping child and exceeds its timeout.
- Expected: Ambiguous paths are never emitted, output stays bounded, and the whole backend process group terminates promptly.
- Actual: Newlines could corrupt the one-path-per-line contract, and timeout killed only the direct child while descendants survived.
- IS: Fixed in 0.3.1 with protocol-safe path validation, O(1) output accounting, a 1 MiB cap, detached process groups, TERM/KILL escalation, and descendant tests.
- SHOULD: External process failure remain bounded in bytes, time, and process lifetime.
- Reasoning: A navigation helper must not corrupt its shell protocol or leak long-running AI processes.
- Code hints: `src/paths.ts`, `src/ai/process.ts`, AI shim tests.
- Acceptance criteria:
  - Newline-bearing paths are excluded from index, history, aliases, and output.
  - AI output over 1 MiB is rejected without unbounded buffering.
  - Timeout returns promptly and terminates backend descendants.
  - All AI failure modes fall back without emitting an untrusted path.

### TCK-012: Make setup, indexing, diagnostics, and alias recovery complete

- Status: Done in 0.3.1
- Epic: EPIC-006
- Type: UX
- Severity: S2
- Priority: P1
- Persona: P1
- Scenario: Configure a nonstandard root, correct a remembered mistake, or diagnose an incomplete index.
- Steps:
  1. Run setup with custom root/depth or an unknown flag.
  2. Force an index entry/time limit and run index/doctor.
  3. List and forget a confirmed intent alias.
- Expected: Options are strict and discoverable; partial state is visible and non-successful; mistakes are recoverable without editing JSON.
- Actual: Unknown options were ignored, setup could write an empty success, roots were only auto-detected, truncation was silent, and aliases had no correction command.
- IS: Fixed in 0.3.1 with strict command parsers/help, `--root`/`--depth`, cancellation without writes, partial-index errors, privacy diagnostics, and alias list/forget commands.
- SHOULD: Every durable decision be observable and correctable from the CLI.
- Reasoning: Recovery affordances remove the need for unsafe manual state edits.
- Code hints: setup/index/doctor/alias commands and shell management completers.
- Acceptance criteria:
  - Unknown or conflicting management options fail with focused usage.
  - Custom roots and depths work in interactive and explicit headless setup.
  - Rejecting every proposed root writes nothing.
  - Index and doctor expose partial state and remediation.
  - Users can list and forget confirmed intent aliases.

### TCK-013: Gate prompt safety, latency, Linux behavior, and the packed release

- Status: Done in 0.3.1
- Epic: EPIC-006
- Type: Reliability
- Severity: S2
- Priority: P1
- Persona: P2
- Scenario: Upgrade cdai across Node versions and shells, then install the produced package rather than running the source tree.
- Steps:
  1. Run CI on macOS/Linux and supported Node releases.
  2. Exercise prompt hooks, concurrent state, shell completion, latency, and a packed install.
- Expected: Previous command status is preserved, behavior is platform-correct, performance has percentile gates, and the committed bundle equals the build.
- Actual: Bash's prepended prompt hook masked `$?`, Linux unreadable-directory/Fish paths lacked complete local evidence, latency checked only a loose single bound, and no packed artifact was installed in tests.
- IS: Fixed in 0.3.1 with scalar/array `PROMPT_COMMAND` tests, non-root Linux runs, old/current Fish lanes, median/p95 gates, packed-install smoke tests, and a clean-dist CI assertion.
- SHOULD: Release claims be backed by executable evidence at source, shell, performance, and package boundaries.
- Reasoning: Passing unit tests is insufficient when generated shell code and packaging are the user-facing product.
- Code hints: CI workflow, latency/PTY/package/concurrency E2E tests.
- Acceptance criteria:
  - Bash preserves previous status for scalar and array prompt commands.
  - Non-root Linux runs all filesystem permission tests.
  - Both older and current Fish behavior are exercised.
  - Exact query and completion enforce median/p95 budgets.
  - `npm pack` output installs and runs successfully.
  - Rebuilding leaves committed `dist/cdai.js` unchanged.
