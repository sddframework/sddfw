# Architecture and maintainer guide

SDDFW v0.1 is a Node.js 22+ ESM CLI with a Playwright adapter and local coding-agent
orchestration. The CLI is packaged as `@sddfw/cli` with the `sddfw` executable.
It uses local files for specifications, approval, task instructions, and evidence.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| CLI and initialization | Validate commands, preserve existing projects, configure the workflow, and scaffold the optional demo. |
| Specification and approval | Validate native JSON criteria and require explicit acceptance of their normalized hash. |
| Agent orchestration | Provide bounded tasks to the user's local agent for specification drafting, test creation/adaptation, and implementation. |
| Playwright reporter | Record test discovery, execution attempts, expected status, errors, and attachment references. |
| Acceptance evaluator | Map criterion tags to executed checks and derive honest acceptance states. |
| Report writer | Produce JSON, Markdown, and escaped self-contained HTML from the same result. |
| Provenance/freshness | Tie evidence to specification, sources, configuration, and execution context; detect stale reports. |
| Fullstack template | Provide a deterministic frontend/API example using real local HTTP requests. |

The [v0.1 specification](../specs/v0.1.md) records the public product scope
and acceptance criteria. Public usage lives in the other guides.

## Data flow

```text
intent + project context
  → draft spec
  → human review + spec hash approval
  → agent task: reuse/create/adapt tests
  → baseline Playwright execution + acceptance report
  → agent implementation with frozen tests
  → Playwright execution + criterion evaluation + run provenance
  → acceptance.json / acceptance.md / acceptance.html
  → if completed checks fail: one further product repair + verification
  → human review of the diff and current evidence
```

Agent calls are bounded to 15 minutes each; Playwright runs to 10 minutes each.
The orchestration loop permits at most two implementation attempts and supplies
the previous failed acceptance report for diagnosis. Missing, blocked, or flaky
evidence stops repair. Local `tests-changes.json` and `implement-changes.json`
record changed paths and before/after hashes for the latest completed phase;
per-invocation logs preserve agent output separately.

The manual path stops at task preparation. Verification can run independently
of agent invocation, against manually authored code or existing tests.

## Invariants

- Agents cannot approve specifications; acceptance is tied to the reviewed hash.
  Post-phase control snapshots also check configuration, agent guidance, and
  specifications and approvals across other changes.
- Criterion IDs are stable and unique within a spec; tests link through
  `@sddfw:<criterion-id>` tags.
- One passing mapped check cannot hide another relevant omitted, skipped,
  expected-failure, flaky, or failed check.
- Evidence is tied to the executed sources and environment. Changes invalidate
  its freshness rather than retroactively certifying new code.
- Test preparation is confined to configured test paths and Playwright config.
  Implementation cannot modify those frozen files; violations stop acceptance
  and preserve the edits for review.
- Initialization preserves pre-existing project and agent instruction files.
  Guidance is written to `.sddfw/AGENT.md`.
- Reports do not automatically upload user code or evidence. HTML escapes
  user-controlled content and keeps local artifact references constrained.
- Agent invocation respects the user's installed tool and permissions. It does
  not authorize credentials, deployment, publishing, or merging.

These invariants do not make the local file system an adversarial trust boundary.
A user or unrestricted process can edit local approval and evidence files.
SDDFW provides an inspectable workflow, not a tamper-proof attestation system.

## Extension approach

Add an adapter only when a real workflow needs it. Keep specification parsing,
execution normalization, acceptance evaluation, and report presentation separate.
An additional test runner must preserve discovery, attempts, expected outcomes,
environment, and evidence limits; translating only an exit code is insufficient.

An additional spec format should produce the same explicit criteria without
pretending that inferred requirements were human-approved. OpenSpec and Spec Kit
imports are future work. An additional agent adapter should use a documented
local invocation, respect host permissions, bound execution, and leave useful
failure diagnostics.

## Maintainer verification

Install development dependencies and run the repository's checks:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:demo
npm run test:integration
npm pack --dry-run
```

Check the published package contents and execute a packaged installation in a
clean temporary project before releasing. The full product validation should
cover demo UI/API behavior, a deliberately broken implementation, missing/skip/
flaky mappings, changed-spec approval, stale evidence, and at least one actual
agent-authored change when an authenticated local agent is available.

The configured CI runs on Ubuntu with Node.js 22, including browser demo and
packaged integration checks. Local validation runs on macOS. Windows agent
shim resolution has unit coverage but no live Windows workflow proof yet. Record
the exact runtime and platform for executed gates; configuration alone is not
a passing Linux run. The [validation record](validation.md) separates completed
checks from outstanding gates.

A passing unit suite is evidence for the covered invariants; it does not replace
the packaged user journey. Record unavailable adapters and environments as
unverified. A source package is not an npm release, and a local report is not a
hosted or production gate.

## Contributing

Small reproducible examples, boundary cases, clearer scenarios, and regression
reports are useful contributions alongside code. Include the spec, expected
behavior, execution environment, and reproduction steps, removing sensitive
data from evidence before sharing it. Discuss substantial changes first through
the project's issues or discussions. See [governance](../GOVERNANCE.md) for
maintainer decisions and access.
