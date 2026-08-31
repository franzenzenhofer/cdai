# JIRA Epics

## Context

- Product: cdai 0.3.1, a native-first directory jumper with indexed, remembered, and AI intent.
- Platform: zsh, Bash, and fish on macOS and Linux.
- Primary flows: setup, native directory changes, intent resolution, Tab completion, maintenance, and diagnostics.
- Assumptions: shell integration is installed; the index may contain private paths; AI can be disabled.

## Severity Scale

- S1: Blocker
- S2: Major
- S3: Minor
- S4: Polish

## Epics

### EPIC-001: Preserve trustworthy shell and CLI behavior

- Status: Done in 0.3.0
- Outcome: Users can rely on cdai as a native `cd` superset without losing its management CLI.
- Rationale: Command interception or surprising path fallback destroys trust and can invoke AI unexpectedly.
- Impacted personas: P1, P2, P3
- Linked tickets: TCK-001, TCK-002, TCK-003

### EPIC-002: Make completion and index results dependable

- Status: Done in 0.3.0
- Outcome: Tab and navigation results stay useful across flags, shells, duplicate names, and filesystem changes.
- Rationale: Completion is the high-frequency interaction and must be fast, current, and unambiguous.
- Impacted personas: P1, P2
- Linked tickets: TCK-004, TCK-005

### EPIC-003: Make AI assistance transparent and progressively faster

- Status: Done in 0.3.0
- Outcome: Users understand data exposure and repeated confirmed intent avoids unnecessary model calls.
- Rationale: Optional AI should never surprise users or repeatedly charge latency and privacy cost.
- Impacted personas: P1, P3
- Linked tickets: TCK-006

### EPIC-004: Make local state private and transactionally correct

- Status: Done in 0.3.1
- Outcome: Concurrent shells cannot lose or replay learning data, and path history remains owner-private.
- Rationale: Frecency and aliases are only trustworthy when updates survive contention and private paths are not exposed to other local users.
- Impacted personas: P2, P3
- Linked tickets: TCK-007, TCK-008

### EPIC-005: Finish native shell and completion parity

- Status: Done in 0.3.1
- Outcome: Bash, zsh, older Fish, and current Fish preserve native navigation while adding predictable indexed Tab completion.
- Rationale: cdai is a `cd` enhancement, so shell-native errors, history, flags, paths, and completion must remain authoritative.
- Impacted personas: P1, P2
- Linked tickets: TCK-009, TCK-010

### EPIC-006: Make setup, recovery, and release evidence complete

- Status: Done in 0.3.1
- Outcome: Consent fails closed, diagnostics expose partial/private state, recovery is self-service, and the packed release is continuously verified.
- Rationale: A reliable tool needs safe onboarding and observable failure modes as much as a correct matcher.
- Impacted personas: P1, P2, P3
- Linked tickets: TCK-011, TCK-012, TCK-013
