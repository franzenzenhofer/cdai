# JIRA Epics

## Context

- Product: cdai 0.3.0, a native-first directory jumper with indexed, remembered, and AI intent.
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
