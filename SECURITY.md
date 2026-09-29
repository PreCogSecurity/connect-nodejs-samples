# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than in a public
issue. Use GitHub's **Security → Report a vulnerability** button on this
repository, which opens a private advisory visible only to the maintainers.

Please do not open a public issue for an unfixed vulnerability, and please do
not include real credentials in a report — even sandbox ones.

## Scope

This repository is a **sample**, and it is useful to be explicit about what
that means:

- It talks to the Spotware **sandbox** Open API by default. Pointing it at a
  live endpoint is possible but out of scope for this repository.
- It holds **no** trading logic beyond subscribing to spot prices. It does not
  place, modify or cancel orders.
- It is **not** a long-running production service. There is no reconnection
  with backoff, no session resume, no persistence, and no rate limiting.

If you need those, build on `connect-js-api` directly rather than on this
sample.

## Historical credential exposure

Earlier revisions of this repository committed sandbox credentials directly in
`index.js` (`clientId`, `clientSecret` and an `accessToken`). They have been
removed from the source in this release.

Important consequences:

- **Those values remain in git history.** Removing a secret from the current
  file does not remove it from the repository's history, so they should be
  treated as permanently disclosed.
- They were **sandbox** credentials, never production ones, and the sandbox
  grants no access to funds or live accounts.
- Any credential that has ever been typed into this repository — in source, in
  a `.env` file, in a test fixture, or in an issue — should be rotated before
  being used anywhere else.

## Handling credentials safely

- Put credentials in the environment or in an untracked `.env` file, never in
  source and never in a test fixture.
- Use throwaway sandbox credentials locally. Do not reuse a production
  credential in a sample project.
- Prefer your platform's secret store in production and do not write a `.env`
  file to disk at all; the sample reads plain environment variables.
- Rotate on suspicion. Rotation is cheap; disclosure is not.

## What this sample does to protect secrets

- Credentials are never read from, or written to, source files.
- Configuration is validated before any network connection is opened, and a
  configuration error reports variable *names* only, never values.
- `lib/redact.js` scrubs secrets from log output two ways: by matching
  credential-shaped field names, and by removing any loaded secret value found
  inside an arbitrary string — which is what catches a credential embedded in
  a third-party error message.
- `.gitignore` excludes `.env`; `.dockerignore` excludes it from image layers.
- CI runs `npm audit` on every build.
