# CLI reference

Run commands from your application's project root. Use `sddfw help` for the
installed version's usage. `--cwd DIR` selects a project directory and
`--version` prints the CLI version. Requires Node.js 22 or later.

## Commands

| Command | Behavior |
| --- | --- |
| `sddfw init` | Add SDDFW configuration and instructions without replacing existing project configuration or tests. |
| `sddfw init --config playwright.config.mjs --test-dir e2e` | Initialize an existing project with explicit configuration and test-directory paths. |
| `sddfw init --demo` | Scaffold the frontend + Node.js API + Playwright example in a new directory. |
| `sddfw init --demo --install` | Scaffold, install its npm dependencies, and install Chromium. |
| `sddfw change <slug> --intent "…"` | Create a specification draft for a focused change. |
| `sddfw change <slug> --intent "…" --agent codex` | Ask the local agent to draft the specification from intent and project context. |
| `sddfw approve <slug>` | Record human acceptance of a valid, complete specification. |
| `sddfw plan <slug>` | Prepare reviewable implementation and test-generation instructions. |
| `sddfw run <slug> --agent auto` | Prepare tests with an available agent, check their baseline, freeze them for up to two implementation attempts, and verify the result. |
| `sddfw run <slug> --agent codex` | Use Codex CLI explicitly. |
| `sddfw run <slug> --agent claude` | Use Claude Code explicitly. |
| `sddfw run <slug> --agent manual` | Write instructions for another tool or human; stops without implementing or verifying. |
| `sddfw verify <slug>` | Execute Playwright and create acceptance reports without an AI call. |
| `sddfw report <slug>` | Display the latest report locations and check whether its evidence is fresh. |
| `sddfw doctor` | Check project setup, Playwright, browsers, and available agent adapters. |
| `sddfw help` | Show usage. |

Choose a readable slug such as `favorite-notes`. `run` requires explicit current
approval; a draft or changed spec cannot silently proceed. `verify` is suitable
for existing tests and manual implementations after approving their spec.

`--install` explicitly authorizes local dependency and browser installation.
Without it, initialization leaves installation to you. Existing-project
initialization preserves package scripts, agent instructions, tests, and
Playwright configuration. Inspect the result and finish the project-specific
configuration before running a change.

## Configuration

`.sddfw/config.json` is project configuration, using relative paths:

```json
{
  "schemaVersion": 1,
  "playwrightConfig": "playwright.config.ts",
  "testDir": "tests",
  "environment": "local",
  "mockedServices": []
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Configuration schema version, currently `1`. |
| `playwrightConfig` | Existing Playwright configuration relative to the project root. |
| `testDir` | Test directory relative to the project root, supplied to agent instructions. |
| `environment` | Human-readable execution environment included in evidence. |
| `mockedServices` | Names of simulated services that limit verification scope. |
| `acceptanceProjects` | Optional nonempty list of named Playwright projects required for every criterion. |

By default, acceptance uses discovered projects other than setup dependencies.
If different projects serve different roles, set `acceptanceProjects`, for
example `["chromium", "firefox"]`, to require your intended acceptance matrix.
A criterion missing a mapped check in a required project stays unverified; an
undiscovered required project blocks acceptance.

The demo uses `playwright.config.mjs`. Configure browser projects, retries,
fixtures, trace retention, and application servers through Playwright itself.

## Project files

```text
.sddfw/
  config.json
  changes/
    favorite-notes/
      spec.json
      approval.json
      plan.md
      tests-changes.json
      implement-changes.json
      agent-<phase>-<timestamp>-<attempt>.log
  runs/
    <run-id>/
      playwright.json
      acceptance.json
      acceptance.md
      acceptance.html
```

Change metadata records changed paths and before/after hashes for the latest
completed phase. Each agent invocation has its own local log. Both aid manual
review; neither is tamper-proof evidence of semantic correctness.
Specs and configuration can be version controlled; execution artifacts are
ignored by default. Keep report provenance when intentionally sharing evidence.

`approval.json` records the accepted normalized spec hash and acceptance time.
Do not edit it to bypass review. Agent prompts explicitly prohibit approval.

## Agent integration

The integrated adapters invoke the user's installed Codex or Claude CLI in the
project. Authentication, provider costs, host permissions, and agent instruction
behavior remain those of the installed tool. `auto` selects an available
adapter; `manual` writes instructions without an agent call.

Each agent invocation is limited to 15 minutes; each Playwright verification
is limited to 10 minutes. `run` makes at most two implementation attempts. It
uses a failed completed report to guide the second repair while preserving
frozen tests; blocked, unverified, or flaky evidence stops automatic repair.

SDDFW does not provide its own hosted model or require an SDDFW account. It does
not automatically upload acceptance reports, push branches, deploy, or merge.

## Interpreting command results

A successful preparation command only establishes that its files were prepared.
Manual mode is preparation, not a passing change. For verification, inspect the
acceptance result as well as command success. Failed, unverified, flaky, blocked,
and stale outcomes need attention; see [testing](testing.md). A setup failure can
prevent report creation, so also read the command's diagnostic output. Preparation
errors exit with code `2`; verification and report commands return `0` only for
passed current acceptance and `1` for a non-passing or stale result.
