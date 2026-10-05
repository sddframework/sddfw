# v0.1 validation record

Recorded on 2026-10-05. These are executed development and publication checks
for the source preview, not a production certification or an npm release.

## Completed local checks

The main local environment is macOS, Node.js 26.10.0, npm 11.19.1,
Playwright 1.63.0, and Chromium build 1243.

| Gate | Observed result |
| --- | --- |
| Core, evidence, backend and workflow controls | 40/40 passed with no skipped tests: 14 core, 15 evidence, 6 backend and 5 workflow-control checks. Guards cover all effective test directories and reject changed or renewed approvals, changed specifications, and stale configuration between phases. |
| Packaged installation and integration | 2/2 passed, approximately 10 seconds. A tarball installed in a clean project ran real UI/API checks and detected broken code, skipped coverage, missing criteria, invalid approval, and stale evidence. A simulated agent adapter also exercised both implementation attempts against a real HTTP service and Playwright. |
| Minimum runtime | All 42 core/evidence/backend/control/integration checks passed on Node.js 22 with no skips. |
| Fullstack browser/API demo | 5/5 Playwright tests passed against the real local backend and persistence. |
| Deliberate product regression | Allowing duplicate favorites made `FAV-003` fail; the original implementation was preserved. |
| Landing | Check and build passed. Light/dark layouts had no page overflow at 360, 390, 768, and 1440 pixels. Axe reported zero automated violations; decorative contrast was reviewed manually. |
| Real acceptance HTML | The seven-criterion report was inspected at 390 and 1440 pixels without overflow. Status labels remain whole; Node.js version and unavailable Git context are explicit. Axe reported zero violations and zero incomplete checks; no page errors were observed. |

The landing's interactive reservation report is illustrative. The fullstack
demo results above came from executed checks. Website verification details are
in its [README](https://github.com/sddframework/website/blob/main/README.md).

The integration fixture explicitly simulates Codex; it does not call an AI
provider. Its six real Playwright executions prove baseline → failed first
attempt → successful repair, and baseline → failed first attempt → failed final
attempt. It checks that the second attempt receives the first attempt's actual
failure report, retains the prepared test/configuration hashes and preserves an
existing regression. Persistent failure exits unsuccessfully without a third
implementation attempt. The separate trial below used real Codex.

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

## Hosted and published checks

The [Ubuntu/Node.js 22 workflow](https://github.com/sddframework/sddfw/actions/runs/37375413250)
passed on commit `19927b95c06550d078f74f60b1bc9da02883e323`, using Node.js
22.23.3: source checks, all 40 core/evidence/backend/control tests, all five
Chromium demo tests, both integration journeys, and package inspection.
The packaged integration now gives each installation its own initially empty
npm cache and permits registry access when required. Both the CLI tarball and
demo dependencies therefore work without a prewarmed developer cache.

A separate clean clone from public `main` on Node.js 22.23.3 followed the actual
install guide: `npm install`, `npm link` with an isolated global prefix,
`sddfw init --demo --install`, approval, verification and report. All five
criteria passed with fresh evidence. No AI account was used in this install
check.

The [GitHub Pages deployment](https://github.com/sddframework/website/actions/runs/37374956220)
completed successfully. The HTML served at [sddfw.com](https://sddfw.com/)
matched the production build byte for byte, with HTTP → HTTPS and `www` → apex
redirects. Playwright checked light/dark layouts at 390 and 1440 pixels, all
nine in-page links, mobile navigation, FAQ disclosure, sample correction and
Markdown download; no overflow or JavaScript errors were observed.

Documentation links now use each repository's `main` branch. After the three
work branches were deleted, all 23 audited public URLs returned HTTP 200 and
all three section fragments were valid. Relative documents, assets and
cross-repository targets were checked against the integrated sources.
