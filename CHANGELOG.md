# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

### Security

- **Removed credentials from source.** `index.js` embedded a `clientId`, a
  `clientSecret` and an `accessToken` as string literals. All four credentials
  are now read from the environment through `lib/config.js`. See
  [SECURITY.md](SECURITY.md) — the old sandbox values remain in git history
  and must be treated as disclosed.
- **Configuration now fails closed.** Missing, malformed or out-of-range values
  abort startup before any socket is opened. Nothing falls back to a built-in
  default, and a configuration error reports variable *names* only, never
  values, so a startup log cannot disclose a secret.
- **Added `lib/redact.js`.** Log output is scrubbed two ways: credential-shaped
  field names are replaced wholesale, and any loaded secret value is removed
  from arbitrary strings — which catches a credential embedded in a
  third-party error message.
- **Added input validation** to every outbound request parameter, including a
  check that the protobuf protocol is actually loaded. Previously an unloaded
  protocol resolved to `undefined`, which protobuf encodes as payload type `0`,
  putting a silently malformed frame on the wire.
- **Pinned `connect-js-encode-decode` to a commit SHA.** It was referenced with
  no ref at all, so every `npm install` resolved it to whatever the upstream
  default branch pointed at. All four `connect-*` dependencies are now pinned by
  immutable commit SHA rather than by (mutable) tag.
- **Added `.env.example`**, documented the variables, and git-ignored `.env`.
- **Added `.dockerignore`** so a local `.env` cannot be baked into an image
  layer, and made the container run as a non-root user with a read-only
  filesystem, all capabilities dropped, and `no-new-privileges`.
- **CI now runs `npm audit`** on every build.

### Fixed

- **`npm ci` was broken.** `package-lock.json` declared `eslint` and `jest` as
  devDependencies that `package.json` did not have, so the two were out of sync
  and the first CI step failed on every run. The lockfile has been reconciled
  with `package.json` and the unused `jest` tree removed (379 → 134 packages).
- **`connect.onError` was dead code.** `connect-js-api` routes both
  `socket.on('error')` and `socket.on('end')` through `_onEnd` → `onEnd(e)`, so
  the sample's error handler was never called and socket errors were silently
  dropped.
- **Uptime could be `NaN`.** `startTime` was only assigned inside `onConnect`,
  so an error before the socket opened logged `Connection closed in NaN
  seconds`.
- **Unhandled promise rejections.** The `auth` → `subscribeForSpots` chain had
  no `.catch`, which terminates the process on modern Node. A failed ping could
  do the same. Both are now caught, logged, and tear the session down.
- **Stack traces were logged at error level.** The logger emitted
  `error.stack`, whose first line is the error message, which reintroduced
  through the back door exactly the credential leak that redacting `message`
  was meant to prevent. Stacks are now debug-only, and a secret inside a stack
  is scrubbed there too.
- **The process could hang.** The keep-alive interval was only cleared on a
  clean close, and there was no signal handling. `SIGINT`/`SIGTERM` are now
  trapped and the interval is always cleared.
- **A reconnect left duplicate keep-alive timers running.** Any previous
  interval is now cleared before a new one starts.
- **Protocol paths were resolved against the working directory**, so the
  sample only started when launched from the repository root. They are now
  resolved relative to the module.
- **`subscribeForSpots` rejected `accountId` inconsistently**, accepting
  `'1e3'`, `'0x10'` and `'  12  '` through `Number()`. Integer strings are now
  parsed strictly, matching `lib/config.js`.
- **`requirePayloadType` now fails loudly** instead of letting `undefined`
  become a payload type of `0`.

### Added

- **A test suite: 119 specs across 10 files**, using Node's built-in
  `node:test` runner. No test-framework dependency, fully offline, under a
  second. The tests caught four real bugs during development (a stale redactor
  pattern, a redactor pattern that was not rebuilt when secrets were registered
  after construction, the `Number()` coercion above, and a missing `apiKey`
  redaction rule).
- **`lib/session.js`**, which owns the connection lifecycle and makes the whole
  flow unit-testable against a fake transport.
- **`lib/errors.js`**, a typed error hierarchy with stable `code` values and a
  `toJSON()` that omits the stack and `cause`, both of which can carry
  credentials.
- **`lib/logger.js`**, structured single-line JSON logging with level
  filtering, replacing bare `console.log`.
- **`lib/env_file.js`**, a strict `.env` reader replacing a `dotenv`
  dependency: no `${...}` interpolation (so a value can never pull another
  environment variable into the process), no mutation of `process.env`, a size
  cap, a strict key grammar, and rejection of control characters.
- **CI enforces lint.** The ESLint config existed but was never invoked. CI now
  runs `npm run lint` and `npm test` on a Node 22/24 matrix, with
  least-privilege `permissions`, concurrency cancellation, and job timeouts.
- **Dependabot**, covering GitHub Actions and npm.
- **Dockerfile, `docker-compose.yml` and `.dockerignore`** for one-command
  startup.
- **`.nvmrc`** and an `engines` field, both pinning Node 22+.
- **README** rewritten with architecture, the connection lifecycle, the full
  environment-variable reference, a security section, and the pinned
  dependency SHAs.
- **CONTRIBUTING.md**, **SECURITY.md** and this changelog.

### Changed

- Modernised the source from ES5 `var`/function style to `const`, arrow
  functions and classes, matching the stated `es2022` target.
- Replaced the `require('dotenv')` step in the credential-removal plan with
  `lib/env_file.js` and Node's own tooling. This removes a dependency rather
  than adding one, and is strictly safer: no interpolation, no environment
  mutation, and a hard failure on malformed input.
- Strengthened `.eslintrc.json` from bare `eslint:recommended` to a full ruleset
  (no `var`, `prefer-const`, `eqeqeq`, `curly`, `no-console`,
  `no-process-exit`, `no-throw-literal`, `no-use-before-define`, formatting
  rules, and more).
- **Removed `.travis.yml`.** Travis is defunct for open-source projects and the
  config pinned Node 5, which cannot run this code. GitHub Actions is the only
  CI.
- **Removed `.jshintrc`.** JSHint is no longer used; ESLint is the single
  source of truth.

### Notes

- The `connect-*` dependencies have had no upstream releases since 2021 and are
  not published to npm, so they cannot be upgraded automatically. `npm audit`
  is reported rather than gating in CI for the same reason.
- The `symblolName` spelling on the wire is defined by upstream's
  `OpenApiMessages.proto` and is preserved deliberately. The *input* parameter
  is now the correctly spelled `symbol`; the old `symblolName` input still
  works so existing copies of this sample do not break.

## [1.0.2] and earlier

See the git history. The initial releases were a minimal demonstration of the
Connect Open API with no tests, no credential handling, and a CI job that ran a
`test` script which did not exist.
