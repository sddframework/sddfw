# SDDFW

**Spec Driven Development Framework**

Build with intent. Ship with evidence.

SDDFW connects a reviewed specification, your coding agent, Playwright tests,
and an acceptance report you can inspect. Use it for a small frontend or backend
change in an existing web application, or start with the included fullstack demo.

## Status

v0.1 is an early source preview, installed from this repository's `main` branch.
`@sddfw/cli` is the package name; it is **not published to the npm registry**. Start with local
development and review every generated change before using it elsewhere.

## Try the frontend + backend demo

Requires Node.js 22+, npm, and Git. The demo works without an AI account.

```sh
git clone --branch main https://github.com/sddframework/sddfw.git
cd sddfw
npm install
npm link
cd ..
mkdir sddfw-demo
cd sddfw-demo
sddfw init --demo --install
# Read .sddfw/changes/favorites/spec.json before approving it
sddfw approve favorites
sddfw verify favorites
sddfw report favorites
```

`init --demo --install` creates a local application with a real Node.js API,
an accessible frontend, and Playwright UI/API tests, then installs dependencies
and Chromium. Read `.sddfw/changes/favorites/spec.json` **before** approving it.
Verification starts the demo server through its Playwright configuration.
The terminal prints the paths to the generated HTML, Markdown, and JSON reports.

The demo checks adding and removing favorites, persistence after reloading,
concurrent and repeated saves, two-user separation, and invalid API mutations.
Its identity mechanism is a test fixture, not production authentication. [Explore the example](examples/README.md).

## Automate your next change

From your existing Playwright project:

```sh
sddfw init
sddfw doctor
sddfw change favorite-notes --intent "Let users add a note to a saved favorite" --agent codex
```

Review and refine the generated scenarios in
`.sddfw/changes/favorite-notes/spec.json`. Then:

```sh
sddfw approve favorite-notes
sddfw run favorite-notes --agent codex
sddfw report favorite-notes
```

The local coding agent reuses, creates, or adapts Playwright tests. SDDFW checks
them against the current product, then freezes the tests for implementation
and runs acceptance again. If completed checks fail, it can repair product code
once more against the same frozen tests; there are at most two implementation
attempts. Each criterion is linked to tests through a stable tag such as `@sddfw:FAV-001`. Changing an accepted specification
requires a new approval. Agents cannot approve on your behalf.

Use `--agent auto` to select an available adapter, `--agent claude` for Claude
Code, or `--agent manual` to write an actionable plan for your preferred tool.
The manual mode stops after preparation; follow its plan, then run
`sddfw verify favorite-notes`. You can verify existing tests without invoking AI.

SDDFW uses your installed agent and its account. It does not automatically upload
reports or publish code. Agent usage may incur the provider's usual charges.

## What the report means

| Status | Meaning |
| --- | --- |
| Passed | Every mapped check ran and passed for the recorded sources and environment. |
| Failed | A check observed behavior contrary to its assertions. |
| Unverified | A criterion lacks adequate executed checks, for example an omitted or skipped test. |
| Flaky | A check passed only after a retry; acceptance is not clean. |
| Blocked | A configuration, service, browser, or execution problem prevented verification. |

A passing test does not establish that its assertions correctly express the
requirement. Review scenarios and test changes. Local evidence does not certify
production, security, accessibility, or performance. The report records the
commit, uncommitted-source fingerprint, specification, environment, declared
mocks, and execution context; stale evidence needs a fresh run.

Detailed traces can contain application data. Keep `.sddfw/runs/` local and
inspect artifacts before deliberately sharing them.

## Guides

- [Getting started](docs/getting-started.md): demo, existing projects, and troubleshooting.
- [Development workflow](docs/workflow.md): specification review, agent work, and reviewable changes.
- [Testing and evidence](docs/testing.md): frontend/API examples and honest acceptance states.
- [CLI reference](docs/cli.md): commands and configuration.
- [Architecture](docs/architecture.md): maintainer guide and extension points.
- [Validation record](docs/validation.md): executed gates, platforms, and outstanding checks.
- [Fullstack examples](examples/README.md): runnable behavior and an exercise for the next change.

The [website repository](https://github.com/sddframework/website) contains the
English landing and an interactive, explicitly illustrative report. That sample
does not execute application tests; the CLI demo above does.

## Help shape the project

- [Discussions](https://github.com/sddframework/sddfw/discussions): ask questions,
  describe your workflow, compare existing approaches, and propose ideas.
- [Issues](https://github.com/sddframework/sddfw/issues): track reproducible
  problems and focused improvements to this repository.
- Pull requests: improve documentation and examples, or implement a change
  whose scope has been agreed in an issue or discussion.
- Website changes belong in
  [sddframework/website](https://github.com/sddframework/website).

When proposing a feature, describe the real problem, the smallest useful change,
and how someone could verify its value. Compare relevant existing tools before
claiming a new capability.

## Maintainer

Founded and maintained by
[Alfonso José García Bañón (@alfoncode)](https://github.com/alfoncode).
See [GOVERNANCE.md](GOVERNANCE.md) for how decisions and repository access work.

Contribution guidance and community conduct are shared through
[sddframework/.github](https://github.com/sddframework/.github).

## License

[MIT](LICENSE). Contributors retain copyright in their contributions.
