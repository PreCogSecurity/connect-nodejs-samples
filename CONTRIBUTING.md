# Contributing

Thanks for helping improve this sample.

## Getting set up

```shell
npm ci
cp .env.example .env    # fill in sandbox credentials if you want to run the app
```

Node.js 22 or newer is required. `nvm use` reads `.nvmrc`.

You do **not** need credentials to work on the code: the test suite is fully
offline and needs no `.env` file.

## Before you open a pull request

```shell
npm run verify     # lint + test
```

Both must pass. CI runs exactly these on Node 22 and 24, so `npm run verify`
locally is the same check.

## Ground rules

**Changes ship with their tests.** A behavioural change without a test that
pins the new behaviour will be asked for changes. `npm test` uses Node's
built-in runner, so there is no framework to install:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
```

**One focused change per commit.** A commit that reformats, refactors *and*
changes behaviour is hard to review and hard to revert. Conventional Commit
prefixes are used in this repository:

```
feat: validate the access token length before sending
fix: clear the ping interval when the transport errors
test: cover redaction of credentials inside error messages
docs: document the pinned dependency SHAs
chore: pin connect-js-encode-decode to a commit SHA
```

**Never commit credentials.** Not in source, not in a test fixture, not in a
`.env` file. See [SECURITY.md](SECURITY.md). If you paste a real credential
anywhere, rotate it — including in your own local git history.

**Stay in scope.** This is a sample. Adding reconnection, order placement,
persistence or a service framework turns it into something else. If you need
those, the right place is a downstream project built on `connect-js-api`.

## Code style

ESLint is the single source of truth (`.eslintrc.json`); JSHint is no longer
used. Notable rules: 4-space indent, single quotes, `const` over `let` over
`var`, `no-console`, and no `process.exit` — return an exit code instead and
let the entrypoint decide.

Run `npm run lint:fix` for the mechanical fixes.

## Dependencies

The four `connect-*` runtime dependencies are not on npm and are pinned to
commit SHAs. If you bump one:

1. Update the SHA in `package.json`.
2. Run `npm install --package-lock-only` and commit `package-lock.json` with it.
3. Note the change in [CHANGELOG.md](CHANGELOG.md).

`package.json` and `package-lock.json` must always agree, or `npm ci` — and
therefore CI — fails immediately.

## Reporting security issues

Not a public issue. See [SECURITY.md](SECURITY.md).
