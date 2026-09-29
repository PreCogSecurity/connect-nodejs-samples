# Runtime image for the Connect Open API sample.
#
# Static note: this file was written and reviewed but NOT built in the change
# that introduced it, because the authoring environment had no Docker engine.
# The layers below are the standard npm ci pattern; if you change the Node
# version or the dependency pins, rebuild and re-run `npm test` locally.

FROM node:22-alpine

# Never run the sample as root. `node` (uid 1000) ships with the base image.
WORKDIR /app

# Dependencies first, so an edit to application source does not invalidate the
# install layer.
#
# `npm ci` (not `npm install`) is deliberate: it installs exactly the tree in
# package-lock.json and fails if package.json has drifted. `--omit=dev` keeps
# the 20 MB of ESLint out of the runtime image. `--ignore-scripts` is not used,
# because some transitive packages legitimately need their install step.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Application source. .dockerignore keeps .env and node_modules out of this
# layer.
COPY index.js ./
COPY lib ./lib

USER node

# No health endpoint exists: this process opens a TLS session to an external
# API rather than serving traffic, so there is nothing to probe. It exits
# non-zero if configuration is invalid or the connection drops, which is what a
# supervisor should key on.
#
# Run with `--init` (compose sets `init: true`) so PID 1 reaps zombies and
# forwards SIGTERM to the Node process, which handles it for a clean shutdown.
CMD ["node", "index.js"]
