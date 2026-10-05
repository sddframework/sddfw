# The development workflow

SDDFW keeps one small change connected to its expected behavior and executed
checks. Your coding agent performs the engineering work; SDDFW supplies the
review boundary and captures acceptance evidence.

## 1. Describe the change

```sh
sddfw change favorite-notes --intent "Let users add a note to a saved favorite" --agent codex
```

The agent drafts a structured specification in
`.sddfw/changes/favorite-notes/spec.json`. Without `--agent`, `change` creates a
draft for you to complete. Drafting is not approval.

Use stable IDs and observable scenarios. For example:

```json
{
  "schemaVersion": 1,
  "title": "Notes on saved favorites",
  "intent": "Help users remember why they saved an item.",
  "criteria": [
    {
      "id": "NOTE-001",
      "description": "A note survives reloading the application.",
      "given": "Alice has saved an item and is viewing her favorites.",
      "when": "She saves a note and reloads the page.",
      "then": "The same note appears beside that item."
    }
  ]
}
```

This snippet illustrates the format, not a complete feature specification.
Decide limits, invalid-input behavior, and user separation before approving.
Add a criterion for each behavior you intend to accept. ID prefixes start with
an uppercase letter, contain uppercase letters or digits, and are followed by a
hyphen and at least three digits. IDs must be unique within a specification.

## 2. Review and approve the specification

Check that the scenarios express the requested outcome and cover meaningful
boundaries. Keep uncertain decisions explicit with a `TODO:` or `TBD:` marker until they are resolved. Normal domain words such as “todo item” are allowed.

```sh
sddfw approve favorite-notes
```

Approval records the normalized specification's SHA-256 and the time it was
accepted. Editing the accepted behavior invalidates approval. A local coding
agent cannot approve specifications. There is no promise that an approved spec
is complete or correct; approval records a deliberate human review step.

## 3. Plan, generate checks, and implement

```sh
sddfw plan favorite-notes
sddfw run favorite-notes --agent codex
```

`plan` prepares the task instructions. `run` can do that preparation itself;
running `plan` separately is useful when you want to inspect the task first.

The agent examines the project, reuses tests that already cover a criterion,
creates missing tests, and adapts tests when the reviewed behavior requires it.
Tests carry criterion tags such as `@sddfw:NOTE-001`. SDDFW executes those
prepared checks against the current application before implementation. A
functional failure is an expected starting point for new behavior; missing,
blocked, or flaky evidence stops the workflow until it is resolved.

The implementation phase then freezes the Playwright configuration, effective project test directories, and all discovered test files using the baseline hashes. These same hashes remain fixed across both implementation attempts.
The agent must change product code to satisfy the accepted criteria. If it
changes protected test files, SDDFW stops and preserves the edits for review.
If a prepared test is wrong, correct it deliberately before starting a new run;
do not quietly relax it during implementation.

Use dedicated test directories for automation. An effective test directory that
also contains application source freezes those files too; use manual mode or
separate the tests before asking the agent to implement there. When Playwright's
test directory is the project root, SDDFW freezes the discovered test files
rather than freezing the whole application.

Backend behavior can be checked through Playwright's request fixture;
frontend behavior can be checked through the browser.

The generated instructions require the agent to preserve meaningful assertions
and explain material test changes. Review that explanation and the actual diff.
The freeze detects test-file changes during implementation. SDDFW cannot
mechanically determine whether an assertion adapted during test preparation
is weaker. A passing run is not permission to silently redefine expected behavior.

`--agent auto` picks an available supported adapter. `--agent manual` writes the
plan and stops; perform the work with your chosen tool, then use `verify`.

The agent runs under its configured permissions. SDDFW does not bypass them,
provision credentials, deploy, merge, or publish on your behalf. Agent calls are
bounded; if an invocation fails or stops, inspect its output and the current diff
before retrying. Each agent invocation has a 15-minute limit and its own local
log. Each Playwright verification has a 10-minute limit.

## 4. Execute acceptance checks

`run` invokes verification after each implementation attempt. If completed
checks still fail, it supplies the previous acceptance report to the agent for
one additional product-code repair, keeping the same tests frozen. There are
at most two implementation attempts. Missing, blocked, or flaky evidence stops
the loop for diagnosis rather than triggering an automatic repair. You can
repeat verification without AI, including after manual changes:

```sh
sddfw verify favorite-notes
```

SDDFW executes the configured Playwright project and maps discovered tests to
each criterion. It records the command, timestamps, source state, specification,
environment, and declared mocked services. A browser or service setup problem
is reported as blocked; an observed assertion failure is failed. A missing,
omitted, skipped, expected-failure, or unstable check does not produce clean
acceptance. See [testing and evidence](testing.md) for the exact distinctions.

## 5. Review the evidence and the change

```sh
sddfw report favorite-notes
```

Inspect the local `tests-changes.json` and `implement-changes.json` in the
change directory when reviewing generated work. They record changed paths and
before/after source hashes for the latest completed phase; per-invocation agent
logs are retained separately. Logs can contain project data and are ignored by
default, like detailed run artifacts. They help review a diff but do not establish that
the change is correct or form a tamper-proof audit trail.

Read the Markdown report, open the self-contained HTML report, and follow the
local test and artifact references. `report` checks whether evidence still
matches the current sources and accepted spec. Re-run verification when it has
become stale.

For a pull request, include the acceptance summary together with the tested
environment and unresolved criteria. Inspect detailed artifacts before sharing;
traces can contain application data. SDDFW does not upload them automatically.

Review both implementation and checks:

- Does every criterion describe the behavior people actually need?
- Do its tests exercise the relevant frontend, API, persistence, or boundaries?
- Do assertions check the outcome, rather than merely the presence of a button?
- Do declared mocks limit what was established?
- Did test changes preserve the expected behavior?
- Is evidence fresh, and are any criteria unverified, flaky, or blocked?

## Example: a test passes but acceptance is incomplete

Alice saves an item and the heart icon changes. That proves a visible reaction,
but it does not establish persistence. Add a reload and inspect the saved list
to check the persistence criterion. For duplicate handling, perform the API
request twice and inspect the stored result. For isolation, retrieve the list as
a second user.

Those are separate scenarios because each answers a different question. The
[fullstack example](../examples/README.md) contains executable UI/API checks of
these behaviors.
