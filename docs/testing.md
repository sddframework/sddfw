# Testing and acceptance evidence

Playwright executes the checks. SDDFW links those checks to reviewed acceptance
criteria and explains the result of each criterion.

## Map a criterion to a test

Use a stable tag in Playwright's test details:

```js
import { test, expect } from '@playwright/test';

test('a saved favorite survives reload', {
  tag: '@sddfw:FAV-001',
}, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Sourdough toast to favorites' }).click();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Saved favorites' }))
    .toHaveText('Sourdough toast');
});
```

This snippet uses the demo's actual routes and accessible names. Reset its test
fixture before each test as shown in the [complete demo tests](../templates/fullstack/tests/favorites.spec.mjs).
For another application, use its routes, accessible names, and isolated data.
Playwright also accepts tags in test titles. See its official
[tag documentation](https://playwright.dev/docs/test-annotations#tag-tests).

Several tests can map to one criterion, and one test can map to several criteria
using an array of tags. Prefer separate checks when they exercise different
behaviors. Merely tagging a test does not prove that it checks the criterion.

## Check backend behavior directly

An API check can establish idempotency independently of frontend feedback:

```js
test('saving the same item twice creates one favorite', {
  tag: '@sddfw:FAV-003',
}, async ({ request }) => {
  const options = {
    headers: { 'X-Demo-User': 'alice' },
  };
  const first = await request.put('/api/favorites/toast', options);
  const second = await request.put('/api/favorites/toast', options);
  expect(first.ok()).toBeTruthy();
  expect(second.ok()).toBeTruthy();
  const response = await request.get('/api/favorites', {
    headers: { 'X-Demo-User': 'alice' },
  });
  const body = await response.json();
  expect(body.favorites.filter(item => item.id === 'toast')).toHaveLength(1);
});
```

This snippet uses the example's actual API contract. Its complete test also
exercises concurrent requests and checks the UI. Adapt routes and fixtures for
your own API. `X-Demo-User` is a simulated test identity and
must not be treated as a production authentication design.

The same technique works with a separately running backend: set Playwright's
`baseURL`, arrange test fixtures, and use `request` for its routes. SDDFW does not
require the backend to be written in JavaScript. The initial demo uses Node.js
to keep the setup small.

## Acceptance states

Every mapped test must run and pass across the configured projects in the
verification run. Setup dependency projects are not acceptance targets by
default; set the optional `acceptanceProjects` list in SDDFW configuration when
you need an explicit matrix. One successful check cannot hide another skipped or failed
check mapped to the same criterion.

| State | Evidence |
| --- | --- |
| `passed` | All mapped checks executed and passed without flaky retries. |
| `failed` | At least one relevant check ended with an assertion or test failure. |
| `unverified` | No adequate executed evidence, including missing mapping, skipped/fixme checks, omitted checks, or expected failures. |
| `flaky` | A mapped check passed only after one or more failed attempts. |
| `blocked` | Infrastructure, configuration, interruption, or runner setup prevented a useful check. |

`test.fail()` describes an expected failure in Playwright; it does not establish
that the accepted product behavior works. `test.skip()` and `test.fixme()` also
leave gaps. Keep them visible until the relevant scenario is checked.

Use the full configured test selection for acceptance. A focused test or filtered
project only provides evidence for what actually ran. Preserve existing tests
and fix regressions discovered elsewhere in the suite.

## What is recorded

Each run writes local artifacts under `.sddfw/runs/<run-id>/`:

- `playwright.json`: normalized runner output, test identity, attempts, errors,
  and attachment references.
- `acceptance.json`: structured criterion results and run context.
- `acceptance.md`: a summary suitable for deliberate inclusion in a review.
- `acceptance.html`: a self-contained report for local inspection.
- Playwright attachments and traces when produced by the configured tests.

Run context includes timestamps, commit, uncommitted source state, specification
hash, environment, mocked services, command, Node.js and Playwright versions. A source or
specification change after execution can make the report stale. `sddfw report`
checks freshness; run `verify` again to collect current evidence.

The source snapshot excludes standard generated output directories (`dist`,
`coverage`, `.next`, `.cache`, `.data`, `.artifacts`), dependency directories,
Git metadata, SDDFW runtime evidence, and common credential-file names.
Configured paths, effective Playwright project test directories, discovered test files, and the Playwright configuration remain included even
inside an excluded output directory. Arbitrary `.gitignore` rules do not extend
these exclusions. Source symlinks and files above 20 MB stop snapshot creation;
place generated artifacts in an excluded output directory. Source fingerprints
do not cover remote state, private files, or generated product files in those
excluded directories.

Configure traces in your Playwright configuration, for example
`use: { trace: 'retain-on-failure' }`. The demo provides its own settings. Inspect
traces locally with Playwright's
[Trace Viewer](https://playwright.dev/docs/trace-viewer-intro). Traces may contain
screenshots, requests, and application data; they are not automatically safe to
publish. The run context does not record environment variable values. All
artifacts still need review. Markdown and HTML redact known secret patterns;
redaction cannot guarantee that arbitrary application output contains no secrets.

## Declare the limits of your environment

Set a meaningful environment and list mocked services in `.sddfw/config.json`:

```json
{
  "schemaVersion": 1,
  "playwrightConfig": "playwright.config.ts",
  "testDir": "tests",
  "environment": "local",
  "mockedServices": ["payment-provider"]
}
```

A passing checkout scenario with a mocked payment provider establishes behavior
against that mock. It does not establish payment processing with the provider.
Mock declarations are project metadata: SDDFW cannot detect every hidden mock or
external dependency. Keep them accurate and inspect the test setup.

## Review generated tests

The coding agent can create and adapt tests, but their meaning still needs
review. Check observable outcomes, meaningful boundaries, fixture isolation, and
whether assertions would catch a broken implementation. Prefer Playwright's
retrying assertions for browser state; see the official
[assertions guide](https://playwright.dev/docs/test-assertions).

A useful manual experiment is to deliberately break duplicate prevention in a
local throwaway copy, verify that `FAV-003` fails, restore the implementation,
and verify again. The demo guide documents its provided mutation exercise.
This checks the utility of that test; it does not prove complete coverage.

## Boundaries of v0.1

The first adapter is Playwright Test for web UI/API workflows. There is no
automatic proof of test adequacy, production security, accessibility, performance,
or stakeholder intent. The CLI cannot certify that an agent did not weaken an
assertion. Review the accepted specification, generated code and tests, and
execution context together. Native spec JSON is supported; OpenSpec and Spec Kit
imports and other test runners are future adapters, not current capabilities.
