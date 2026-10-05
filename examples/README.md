# Runnable examples

The first example is the [favorites full-stack template](../templates/fullstack/README.md). Create an isolated demo project with `sddfw init --demo`, or copy `templates/fullstack` and follow its README.

It is an intentionally small, complete path: reviewed intent → frontend interaction → real HTTP API → local file persistence → Playwright UI/API checks → acceptance evidence. Five criteria map to five tagged tests. No evidence is shipped pre-generated and no specification is pre-approved.

The backend's Alice/Bob identities are explicitly simulated. They are useful for testing separate data sets and are not an authentication or authorization implementation. No external services are mocked; the server, UI and persistence run locally.

When contributing another example, include a reproducible local start, an isolated fixture, reviewed acceptance criteria, tagged tests and an explanation of environment limits. Keep it small enough for someone to understand and adapt to an existing project.

## Demonstrate a real failing criterion

Work in a disposable copy of `templates/fullstack` with its test dependency installed. First run the unchanged suite and confirm it passes. In that copy only, change the addition expression in `server.mjs` from `[...new Set([...current, id])]` to `[...current, id]`. Do not change the specification or tests.

Then run:

```sh
npx playwright test --grep '@sddfw:FAV-003'
```

The real API receives concurrent additions and the test must fail because the saved list contains duplicates. The failure is useful evidence: this criterion distinguishes correct idempotency from a broken backend. Restore `[...new Set([...current, id])]`, run the full suite again and discard the temporary copy. When using the SDDFW CLI, inspect the generated acceptance report to see `FAV-003` as failed while keeping execution and specification provenance.
