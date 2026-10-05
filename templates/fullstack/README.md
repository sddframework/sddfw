# Favorites: a runnable SDDFW full-stack demo

This small example joins an accessible vanilla frontend, a real Node.js HTTP backend and tagged Playwright UI/API tests. It uses no backend runtime dependencies or external service mocks.

## Run the demo

Use Node.js 22 or newer. From this directory:

```sh
npm install
npm start
```

Open `http://127.0.0.1:4173`. Add a favorite, reload the page, remove it or switch the **Demo identity** selector between Alice and Bob.

The server binds to `127.0.0.1`. The default data file is `.sddfw-demo/favorites.json`, relative to the working directory. `SDDFW_DEMO_DATA` sets another controlled data-file path, and `SDDFW_DEMO_PORT` sets another port. Writes are serialized and use an atomic rename so concurrent additions do not create duplicates. Restarting the backend with the same data file preserves favorites.

Alice and Bob are **simulated identities, not authenticated accounts**. Any local caller can send the `X-Demo-User` header. The example demonstrates data partitioning; it does not demonstrate authentication, authorization or production security. Keep it local.

## Verify the behavior

Install the Chromium browser once, then run the suite:

```sh
npx playwright install chromium
npm test
```

Playwright starts its own backend automatically. Stop the interactive demo first because the tests deliberately refuse to reuse an existing server on their selected port. For another available port:

```sh
SDDFW_DEMO_PORT=4174 npm test
```

Each run gets a separate temporary data file and each test resets it before executing. The reset endpoint exists only when the backend is started with `SDDFW_DEMO_TEST_MODE=1`. Tests run with one worker and no retries. The temporary directory is removed at teardown. API requests and browser actions reach the same real backend; no `page.route` response stubs are used.

| Criterion | Observable behavior |
| --- | --- |
| `FAV-001` | Add in UI, reload, read API and inspect persisted JSON. |
| `FAV-002` | Remove in UI, reload and confirm absence through API. |
| `FAV-003` | Concurrent and repeated API additions produce one favorite. |
| `FAV-004` | Alice and Bob retain distinct favorites in UI and API. |
| `FAV-005` | Invalid identities/items return HTTP 400 and preserve state. |

`spec.json` contains the reviewable intent and criteria. Tests in `tests/favorites.spec.mjs` carry matching `@sddfw:FAV-001` through `@sddfw:FAV-005` tags. Review the specification before accepting it in SDDFW; this template does not contain an approval or fabricated acceptance evidence.

After `sddfw init --demo`, the CLI config points at this Playwright suite. Use the commands in the framework quickstart to approve and verify the scaffolded `favorites` change. A passed run demonstrates the listed behaviors in this local Chromium environment. It does not certify production behavior or the correctness of the requirement itself.

## API

| Method and path | Demo request | Result |
| --- | --- | --- |
| `GET /api/items` | No identity required | The fixed item catalog. |
| `GET /api/favorites` | `X-Demo-User: alice` or `bob` | That identity's favorites. |
| `PUT /api/favorites/toast` | Same header | Add a favorite idempotently. |
| `DELETE /api/favorites/toast` | Same header | Remove a favorite idempotently. |

The catalog IDs are `toast`, `salad` and `soup`. Unknown IDs, unknown identities and missing identity headers return HTTP 400 without modifying stored favorites.
