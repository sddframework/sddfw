# Getting started

SDDFW v0.1 is a local CLI for a reviewed specification → tests → implementation
→ Playwright → acceptance report workflow. Try one small change first.

## Install the preview from GitHub

You need Node.js 22 or later, npm, and Git. Local validation uses macOS; the
repository provides an Ubuntu/Node.js 22 CI gate. Windows adapter shims have
unit coverage but no live Windows workflow validation yet. Check the
[validation record](validation.md) for the platforms and gates actually executed.

The package has not been published to
the npm registry. These commands use the v0.1 preview branch:

```sh
git clone --branch feat/v0.1-playwright https://github.com/sddframework/sddfw.git
cd sddfw
npm install
npm link
sddfw help
```

If your npm global directory needs administrator access, configure a user-owned
npm prefix or run the CLI using its absolute path:
`node /your/path/sddfw/bin/sddfw.js help`. You can replace `sddfw` with that command
throughout this guide. No global installation is required to use the CLI.

## Run the included application

From a new, empty directory outside the framework checkout:

```sh
mkdir sddfw-demo
cd sddfw-demo
sddfw init --demo --install
```

The explicit `--install` option downloads the demo's npm dependencies and
Chromium. Omit it if you want to inspect the generated files before installing;
then run `npm install` and `npx playwright install chromium` in the demo.

Read `.sddfw/changes/favorites/spec.json`. It describes the initial favorites
behavior and its Given/When/Then scenarios. Confirm that it matches what you
intend to check, then approve and verify:

```sh
sddfw approve favorites
sddfw verify favorites
sddfw report favorites
```

Playwright starts the application server, interacts with the frontend, and calls
the actual local API. The reports under `.sddfw/runs/` are real execution results.
Open the printed `acceptance.html` path in your browser or read `acceptance.md`.

The application saves favorites in local demo storage. The two users are
simulated identities. See the [example guide](../examples/README.md) for the
storage scope, test reset, and an explanation of each UI/API scenario. This demo
is not a production-ready authentication or deployment template.

## Use an existing Playwright project

Work in the application's project root. Commit or otherwise preserve your
current work so you can review the agent's changes.

```sh
sddfw init
sddfw doctor
```

Initialization adds SDDFW's files while preserving your existing tests,
Playwright configuration, package scripts, and agent instruction files.
Check `.sddfw/config.json` and set the correct configuration and test-directory
paths, relative to the project root:

```json
{
  "schemaVersion": 1,
  "playwrightConfig": "playwright.config.ts",
  "testDir": "tests",
  "environment": "local",
  "mockedServices": []
}
```

Use the project's Playwright `webServer` configuration to start its frontend and
backend, or start the required services yourself. SDDFW cannot infer or provision
every application's database, credentials, or deployment environment.

## Ask your coding agent to make a change

Install and sign in to Codex CLI or Claude Code separately. `sddfw doctor` checks
which supported adapters are available; your agent retains its host permissions
and account configuration.

```sh
sddfw change favorite-notes --intent "Let users add a note to a saved favorite" --agent codex
```

Review the drafted `.sddfw/changes/favorite-notes/spec.json`. Make the behavior
concrete: who can edit the note, how long it may be, what happens on reload, and
what an API request from another user should do. Then run:

```sh
sddfw approve favorite-notes
sddfw run favorite-notes --agent codex
sddfw report favorite-notes
```

The agent receives your reviewed criteria and instructions to reuse or create
tests, implement the change, and preserve the required assertions. SDDFW then
executes Playwright and produces evidence. Review the diff as well as the report.
If the intent changes, edit the specification and explicitly approve it again.

## Work without an integrated agent

```sh
sddfw change favorite-notes --intent "Let users add a note to a saved favorite"
```

Complete and review the draft scenarios, then:

```sh
sddfw approve favorite-notes
sddfw run favorite-notes --agent manual
```

Follow the generated instructions in your editor or coding agent. Manual mode
prepares work; it does not claim implementation or verification happened.
After making the change, run `sddfw verify favorite-notes` and inspect the report.

To adopt existing tests without AI, write and approve a specification, add the
criterion tags to its tests, and use `verify`. See [testing](testing.md).

## Resolve common problems

| Symptom | Next step |
| --- | --- |
| `sddfw` is not found | Run `npm link` in the framework checkout or use its absolute `bin/sddfw.js` path. |
| Missing Playwright or browser | Install project dependencies and run `npx playwright install chromium`. |
| Missing or incorrect config | Check `playwrightConfig` in `.sddfw/config.json`; run `sddfw doctor`. |
| Agent unavailable | Install/sign in to your chosen CLI or use `--agent manual`. |
| Approval invalidated | Review the changed specification and run `approve` again. |
| Missing mapped tests | Add `@sddfw:ID-001` tags to the intended tests, then verify. |
| Server or API unavailable | Check your Playwright `webServer` and required local services. |
| Report is stale | Run `sddfw verify <change>` against the current sources and configuration. |
| Check failed | Inspect the assertion and trace; establish whether code, test, or environment is wrong. |

The [CLI reference](cli.md) explains command behavior; [workflow](workflow.md)
explains what to review before accepting a change.
