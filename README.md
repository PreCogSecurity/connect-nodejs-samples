# connect-nodejs-samples

Samples of using the [Connect Open API](https://connect.spotware.com/documentation/section/api-reference)
in JavaScript and Node.js.

The sample opens a TLS session to the Spotware sandbox, authenticates, and
streams `EURUSD` bid/ask prices to stdout as structured JSON logs.

## Quick start

Requires **Node.js 22 or newer** (see `.nvmrc`; `nvm use` if you use nvm).

```shell
git clone https://github.com/PreCogSecurity/connect-nodejs-samples.git
cd connect-nodejs-samples
npm ci                 # reproducible install from package-lock.json
cp .env.example .env   # then fill in your four credentials
npm start
```

Expected output — one JSON object per line:

```json
{"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"starting","host":"sandbox-tradeapi.spotware.com","port":5032,"symbol":"EURUSD","accountId":62002}
{"ts":"2026-01-01T00:00:01.000Z","level":"info","msg":"connected","host":"sandbox-tradeapi.spotware.com","port":5032}
{"ts":"2026-01-01T00:00:01.010Z","level":"info","msg":"authenticated","host":"sandbox-tradeapi.spotware.com","port":5032}
{"ts":"2026-01-01T00:00:01.020Z","level":"info","msg":"subscribed for spots","symbol":"EURUSD","accountId":62002}
{"ts":"2026-01-01T00:00:02.100Z","level":"info","msg":"spot update","bidPrice":1.0612,"askPrice":1.0614}
```

With no credentials configured the app refuses to start and names every
variable it needs, without echoing any value:

```json
{"ts":"...","level":"error","msg":"configuration rejected","error":{"name":"ConfigurationError","code":"ERR_CONNECT_CONFIG","message":"Invalid configuration:\n  - CONNECT_CLIENT_ID: is required but was not set\n  ..."}}
```

## Commands

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm ci`            | Reproducible install; fails if the lockfile has drifted.  |
| `npm start`         | Run the sample against the configured endpoint.           |
| `npm test`          | Run the unit suite (`node:test`, 119 specs, no network).   |
| `npm run test:watch`| Re-run tests on change.                                   |
| `npm run lint`      | ESLint over source and tests. Gates CI.                   |
| `npm run lint:fix`  | ESLint with autofix.                                      |
| `npm run verify`    | `lint` then `test`.                                       |

The test suite uses Node's built-in test runner, so it needs no test framework
dependency and runs in well under a second with no network access.

## Architecture

```
index.js                 composition root: reads config, builds the client, starts the session
├── lib/config.js        environment -> validated, frozen configuration (fails closed)
├── lib/env_file.js      strict .env reader (no interpolation, no expansion)
├── lib/logger.js        structured JSON logging with level filtering
├── lib/redact.js        secret redaction, by key name and by value
├── lib/session.js       connection lifecycle, keep-alive, graceful shutdown
├── lib/auth.js          ProtoOAAuthReq
├── lib/subscribe_for_spots.js  ProtoOASubscribeForSpotsReq
├── lib/ping.js          ProtoPingReq keep-alive loop
├── lib/validation.js    shared request-parameter checks
└── lib/errors.js        typed error hierarchy with stable codes
```

The Connect libraries themselves:

```
connect-js-adapter-tls ─┐
connect-js-api ──────────┼──> index.js  ──> TLS session to the Connect Open API
connect-protobuf-messages┤
connect-js-encode-decode ┘
```

`index.js` deliberately contains no logic beyond assembly, which is what makes
the whole flow unit-testable against a fake transport.

### Connection lifecycle

`lib/session.js` owns the lifecycle so it can be tested:

1. `onConnect` starts the keep-alive ping, then authenticates, then subscribes,
   then registers the spot-price handler. Any failure in that chain is caught,
   logged, and tears the session down.
2. `onEnd` handles both a clean close and a transport error — `connect-js-api`
   routes `socket.on('error')` *through* `onEnd`, so errors cannot slip past.
3. `stop` is idempotent and always clears the ping interval, so the process
   exits instead of hanging on an open timer. `SIGINT` and `SIGTERM` are
   trapped for the same reason.

Reconnection is a deliberate non-goal: a production client should add bounded
exponential backoff with jitter plus session resume, and a sample that
half-implemented it would teach the wrong thing.

![Alt text](http://g.gravizo.com/g?
  digraph usage {
    "connect-js-adapter-tls" -> "connect-js-api";
    "connect-protobuf-messages" -> "connect-js-api";
    "connect-js-encode-decode" -> "connect-js-api";
    "connect-nodejs-samples" [style=filled,color="grey"];
    "connect-js-api" -> "ctrader-telegram-bot";
    "connect-js-api" -> "connect-nodejs-samples";
  }
)

## Environment variables

Credentials are read from the environment, never from source. See
[`.env.example`](.env.example) for the annotated template.

| Variable                   | Required | Default                          | Description                                                     |
| -------------------------- | -------- | -------------------------------- | --------------------------------------------------------------- |
| `CONNECT_CLIENT_ID`        | yes      | —                                | Client id from the Connect app registration.                    |
| `CONNECT_CLIENT_SECRET`    | yes      | —                                | Client secret. Never log or commit it.                          |
| `CONNECT_ACCESS_TOKEN`     | yes      | —                                | Access token issued for the trading account.                    |
| `CONNECT_ACCOUNT_ID`       | yes      | —                                | Trading account id, a positive whole number.                    |
| `CONNECT_HOST`             | no       | `sandbox-tradeapi.spotware.com`  | Bare hostname only: no scheme, port or path.                    |
| `CONNECT_PORT`             | no       | `5032`                           | TLS port, 1–65535.                                              |
| `CONNECT_SYMBOL`           | no       | `EURUSD`                         | Symbol to subscribe to; upper-cased on use.                     |
| `CONNECT_PING_INTERVAL_MS` | no       | `1000`                           | Keep-alive interval, 100–600000 ms.                              |
| `LOG_LEVEL`                | no       | `info`                           | `debug`, `info`, `warn`, `error` or `silent`.                   |
| `CONNECT_ENV_FILE`         | no       | `.env`                           | Path to the env file, relative to the working directory.        |

Resolution order: **a real environment variable always wins over `.env`**. An
explicitly empty environment variable is treated as *set but invalid* rather
than falling back, so an empty shell export cannot silently mask a good file
value.

In production, prefer your platform's secret store and do not write a `.env`
file to disk at all — the app works with environment variables alone.

## Security

- **No credentials in source.** The four values the sample needs come from the
  environment. Configuration is validated before any socket is opened, and a
  validation error names variables only — never their values.
- **Secrets are redacted from logs.** `lib/redact.js` scrubs both
  credential-shaped field names *and* any string containing a loaded secret, so
  a credential embedded in a third-party error message is still caught.
- **Fail closed.** Missing or malformed configuration aborts startup. Nothing
  falls back to a built-in default.
- **Input validation** on every outbound parameter, including a check that the
  protocol is actually loaded — without it protobuf silently encodes payload
  type `0` and puts a malformed frame on the wire.
- **`.env` is git-ignored** and `.dockerignore` keeps it out of image layers.

Earlier revisions of this repository committed sandbox credentials in
`index.js`. They are sandbox-only and void, but they remain in git history. See
[SECURITY.md](SECURITY.md) before reusing any credential you have ever typed
into this repository.

## Dependencies

The four `connect-*` runtime dependencies are **not published to the npm
registry** — Spotware distributes them from GitHub only. They are therefore
pinned to immutable commit SHAs rather than mutable tags or branch names:

| Package                    | Pinned commit                                  |
| -------------------------- | ---------------------------------------------- |
| `connect-js-adapter-tls`   | `7c75dd6037f3a3cb403e121f953ea01313e55a25`      |
| `connect-js-api`           | `4c2e13cdc8305b06ba4fe2427eb0a49ff28d4682`      |
| `connect-js-encode-decode` | `29b72952c86c94f555019f3021af14e3c5f74cab`      |
| `connect-protobuf-messages`| `b6d79a4ee76059fd92e0dd3748e3874f047e47ab`      |

Pinning by SHA rather than tag matters here: `connect-js-encode-decode` was
previously referenced with no ref at all, which resolved to whatever the
default branch happened to point at on each install. A tag can also be moved;
a commit SHA cannot.

These repositories have had no release activity since 2021, so upgrades are
manual. `npm audit` runs in CI and is reported rather than gating, precisely
because an advisory in this unmaintainable tree would otherwise block every
pull request indefinitely.

## Docker

```shell
cp .env.example .env   # fill in your four credentials
docker compose up --build
```

Compose reads the project `.env` automatically, so no credential is baked into
the image. The container runs as a non-root user with a read-only filesystem,
all capabilities dropped, and `no-new-privileges`. See
[`docker-compose.yml`](docker-compose.yml) and the
[static-validation note in the Dockerfile](Dockerfile).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: `npm run verify` before
you open a pull request, and keep the change and its tests in one commit.

## License

[MIT](LICENSE)
