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
- IS: Fixed in 0.3.0 with flag stripping, stale-history rejection, duplicate full paths, Bash/zsh E2E, and fish CI coverage.
- SHOULD: Add real shell-level completion tests and shell-appropriate descriptions for duplicates.
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
- SHOULD: On a nonexistent hit, refresh at most once and resolve again; consider a config fingerprint later.
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
