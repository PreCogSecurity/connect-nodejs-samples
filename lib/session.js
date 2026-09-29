'use strict';

const { ConnectionError } = require('./errors');

/**
 * Owns the lifetime of a Connect session.
 *
 * The original sample wired the lifecycle inline in `index.js` and got it
 * wrong in four ways, all of which this module fixes:
 *
 *  1. `connect.onError` was defined but never invoked. `connect-js-api` routes
 *     *both* `socket.on('error')` and `socket.on('end')` through
 *     `Connect.prototype._onEnd`, which calls `onEnd(e)`. Any error handling
 *     placed in `onError` was dead code.
 *  2. `startTime` was only assigned inside `onConnect`, so an error before the
 *     socket ever opened produced `"Connection closed in NaN seconds"`.
 *  3. The `auth` -> `subscribeForSpots` promise chain had no `.catch`. On
 *     modern Node an unhandled rejection terminates the process.
 *  4. The ping interval was only cleared in `onEnd`, and the process had no
 *     signal handling, so the sample could hang with an open timer.
 *
 * This module is deliberately transport-agnostic and has no import-time side
 * effects, so the whole flow is unit-testable against a fake `connect`.
 *
 * Non-goal: automatic reconnection. A production client should add bounded
 * exponential backoff with jitter and a session-resume path; a sample that
 * half-implemented it would teach the wrong thing.
 *
 * @param {object} options
 * @param {object} options.connect a `connect-js-api` instance
 * @param {object} options.config validated configuration from ./config
 * @param {object} options.logger structured logger from ./logger
 * @param {Function} options.ping bound ping function
 * @param {Function} options.auth bound auth function
 * @param {Function} options.subscribeForSpots bound subscribe function
 * @param {string[]} [options.signals] signals to trap, defaults to SIGINT/SIGTERM
 */
const createSession = (options) => {
    const { connect, config, logger, ping, auth, subscribeForSpots } = options;
    const signals = options.signals || ['SIGINT', 'SIGTERM'];

    // Seeded at construction, not in onConnect: an error before the first
    // successful open must still produce a real uptime figure.
    let startTime = Date.now();
    let closed = false;
    let closeInfo = null;
    let onSpot = null;

    let resolveClose;
    const closePromise = new Promise((resolve) => {
        resolveClose = resolve;
    });

    function stopPing() {
        if (connect.pingInterval) {
            clearInterval(connect.pingInterval);
            connect.pingInterval = undefined;
        }
    }

    function handleSpot(msg) {
        if (onSpot) {
            onSpot(msg);
            return;
        }
        logger.info('spot update', { bidPrice: msg.bidPrice, askPrice: msg.askPrice });
    }

    async function authenticate() {
        await auth({ clientId: config.clientId, clientSecret: config.clientSecret });
        logger.info('authenticated', { host: config.host, port: config.port });

        await subscribeForSpots({
            accountId: config.accountId,
            accessToken: config.accessToken,
            symbol: config.symbol
        });

        const spotPayloadType = connect.protocol.getPayloadTypeByName('ProtoOASpotEvent');
        if (typeof spotPayloadType === 'number') {
            connect.on(spotPayloadType, handleSpot);
        } else {
            logger.warn('spot payload type unavailable; price updates will not be emitted');
        }

        logger.info('subscribed for spots', {
            symbol: config.symbol,
            accountId: config.accountId
        });
    }

    function onConnect() {
        startTime = Date.now();
        stopPing();
        ping(config.pingIntervalMs);
        logger.info('connected', { host: config.host, port: config.port });

        authenticate().catch((error) => {
            // An unhandled rejection before; now a logged, typed failure that
            // also tears the session down.
            logger.error('session setup failed', { error });
            stop('setup-failed');
        });
    }

    /**
     * Handles both a clean `end` and an `error`: the library routes socket
     * errors here as well.
     */
    function onEnd(error) {
        const uptimeMs = Date.now() - startTime;

        if (error) {
            logger.error('connection lost', {
                error:
                    error instanceof Error
                        ? error
                        : new ConnectionError(String(error)),
                uptimeMs
            });
        } else {
            logger.info('connection closed', { uptimeMs });
        }

        stop(error ? 'error' : 'end');
    }

    function onError(error) {
        // Defensive: the library does not call this today, but if a future
        // version does, errors must not disappear.
        logger.error('transport error', { error });
        stop('error');
    }

    /**
     * Idempotent teardown. Always clears the keep-alive timer so the event loop
     * can drain, and resolves the close promise exactly once.
     */
    function stop(reason = 'stopped') {
        stopPing();

        if (!closed) {
            closed = true;
            closeInfo = { reason, uptimeMs: Date.now() - startTime };
            for (const signal of signals) {
                process.removeListener(signal, onSignal);
            }
            resolveClose(closeInfo);
        }

        return closeInfo;
    }

    function onSignal(signal) {
        logger.info('shutting down', { signal });
        stop(signal);
    }

    function start() {
        for (const signal of signals) {
            process.on(signal, onSignal);
        }
        connect.onConnect = onConnect;
        connect.onEnd = onEnd;
        connect.onError = onError;
        connect.start();
    }

    return {
        start,
        stop,
        onConnect,
        onEnd,
        onError,
        /** Registers a custom spot handler, replacing the default logging one. */
        setSpotHandler(handler) {
            onSpot = handler;
        },
        waitForClose: () => closePromise,
        get closed() {
            return closed;
        },
        get closeInfo() {
            return closeInfo;
        }
    };
};

module.exports = { createSession };
