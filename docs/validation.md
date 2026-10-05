# v0.1 validation record

Recorded on 2026-10-05. These are local development checks for the source preview,
not a production certification or an npm release. Pending gates remain pending
until an actual execution confirms them.

## Completed local checks

The main local environment is macOS, Node.js 26.10.0, npm 11.19.1,
Playwright 1.63.0, and Chromium build 1243.

| Gate | Observed result |
| --- | --- |
| Core, evidence, and backend tests | 32/32 passed with no skipped tests: 12 core, 14 evidence, and 6 backend. New regressions cover a missing project-matrix check, protected `dist/tests` files, and ordinary use of the word “todo.” |
| Packaged installation and integration | Current-source packaged integration: 1 passed, approximately 10 seconds. A tarball installed in a clean project ran real UI/API checks and detected broken code, skipped coverage, missing criteria, invalid approval, and stale evidence. |
| Minimum runtime | The same 32 core/evidence/backend checks passed on Node.js 22 with no skips. |
| Fullstack browser/API demo | 5/5 Playwright tests passed against the real local backend and persistence. |
| Deliberate product regression | Allowing duplicate favorites made `FAV-003` fail; the original implementation was preserved. |
| Landing | Check and build passed. Light/dark layouts had no page overflow at 360, 390, 768, and 1440 pixels. Axe reported zero automated violations; decorative contrast was reviewed manually. |

The landing's interactive reservation report is illustrative. The fullstack
demo results above came from executed checks. Website verification details are
in its [README](https://github.com/sddframework/website/blob/feat/v0.1-playwright-docs/README.md).

## Live coding-agent trial

A real Codex trial has seven explicitly approved criteria. Its test-preparation
phase created `CLR-001` and `CLR-002` while preserving `FAV-001`–`FAV-005`.
The executed baseline recorded five passed and two failed checks because the
new button did not exist. Codex implemented the interface and real backend
operation on the first attempt. Final acceptance recorded **7/7 passed**, and
`report` confirmed fresh evidence. Before/after hashes confirm that the prepared
tests remained unchanged during implementation; only frontend/backend product
files changed in that phase. No mocked agent response was used for this trial.

The trial reused and restructured the existing five tests into explicit scenario
steps, then added two checks for clearing a populated or already empty list.
The new checks inspected the interface and real API after reload and preserved
the other simulated identity's favorites. One successful local change is proof
of this executed workflow, not a claim that every generated test is adequate.
The clear operation was exercised as Alice; Bob's state was checked for isolation.
The new clear scenarios reload the browser but do not restart the backend.

The Claude Code adapter is implemented but has no live validation because the
local CLI is unavailable. Windows adapter shim handling has unit coverage, with
no live Windows workflow proof.

## Remaining gates

- Ubuntu/Node.js 22 GitHub Actions after publication of the pull request.

The CI workflow is configured to run source checks, tests, the browser demo,
packaged integration, and package inspection. Its configuration does not prove
that those Linux checks passed. Update this record with actual results before
describing an outstanding gate as complete.
