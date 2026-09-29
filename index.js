'use strict';

const path = require('path');
const ProtoMessages = require('connect-protobuf-messages');
const AdapterTLS = require('connect-js-adapter-tls');
const EncodeDecode = require('connect-js-encode-decode');
const Connect = require('connect-js-api');

const { loadConfig, configSecrets } = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { createRedactor } = require('./lib/redact');
const { createSession } = require('./lib/session');
const { ConnectSampleError } = require('./lib/errors');
const ping = require('./lib/ping');
const auth = require('./lib/auth');
const subscribeForSpots = require('./lib/subscribe_for_spots');

/**
 * Composition root.
 *
 * Everything interesting now lives in ./lib and is unit tested; this file only
 * assembles the pieces. Credentials are *not* present here, in any form: they
 * come from the environment (or a git-ignored .env file) via ./lib/config,
 * which validates them and refuses to start without them.
 */

// Resolved relative to this file rather than the working directory, so the
// sample still starts when launched from elsewhere (systemd, Docker, cron).
const PROTO_DIR = path.join(
    __dirname,
    'node_modules',
    'connect-protobuf-messages',
    'src',
    'main',
    'protobuf'
);

const PROTO_FILES = [
    path.join(PROTO_DIR, 'CommonMessages.proto'),
    path.join(PROTO_DIR, 'OpenApiMessages.proto')
];

const buildProtocol = () => {
    const protocol = new ProtoMessages(PROTO_FILES.map((file) => ({ file })));
    protocol.load();
    protocol.build();
    return protocol;
};

const main = async () => {
    // Bootstrap logger: usable even when configuration is invalid, and already
    // primed with the raw secret values so that no code path can echo one.
    const bootstrapLogger = createLogger({
        level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
        redactor: createRedactor([
            process.env.CONNECT_CLIENT_SECRET,
            process.env.CONNECT_ACCESS_TOKEN
        ])
    });

    let config;
    try {
        config = loadConfig();
    } catch (error) {
        if (error instanceof ConnectSampleError) {
            bootstrapLogger.error('configuration rejected', { error });
            return 1;
        }
        throw error;
    }

    const logger = createLogger({
        level: config.logLevel,
        redactor: createRedactor(configSecrets(config))
    });

    logger.info('starting', {
        host: config.host,
        port: config.port,
        symbol: config.symbol,
        accountId: config.accountId,
        node: process.version
    });

    const connect = new Connect({
        adapter: new AdapterTLS({ host: config.host, port: config.port }),
        encodeDecode: new EncodeDecode(),
        protocol: buildProtocol()
    });

    const session = createSession({
        connect,
        config,
        logger,
        ping: ping.bind(connect),
        auth: auth.bind(connect),
        subscribeForSpots: subscribeForSpots.bind(connect)
    });

    session.start();

    const close = await session.waitForClose();
    logger.info('session ended', close);

    return close.reason === 'error' || close.reason === 'setup-failed' ? 1 : 0;
};

main()
    .then((exitCode) => {
        process.exitCode = exitCode;
    })
    .catch((error) => {
        // Last-resort handler. Never let a startup crash print a stack that
        // might contain a secret, and never leave a non-zero-less exit.
        process.stderr.write(
            `${JSON.stringify({
                ts: new Date().toISOString(),
                level: 'error',
                msg: 'fatal',
                error: { name: error.name, code: error.code, message: error.message }
            })}\n`
        );
        process.exitCode = 1;
    });
