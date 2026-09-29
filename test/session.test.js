'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSession } = require('../lib/session');
const { createLogger } = require('../lib/logger');
const { createRedactor } = require('../lib/redact');
const {
    createFakeConnect,
    createMemoryStream,
    VALID_CONFIG,
    PAYLOAD_TYPES
} = require('./helpers/fakes');

/** Lets the session's internal promise chain run to completion. */
const settle = async (turns = 5) => {
    for (let i = 0; i < turns; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
};

const build = (overrides = {}) => {
    const connect = overrides.connect || createFakeConnect();
    const stream = createMemoryStream();
    const calls = [];

    const session = createSession({
        connect,
        config: VALID_CONFIG,
        logger: createLogger({
            level: 'debug',
            stream,
            now: () => '2026-01-01T00:00:00.000Z',
            redactor: createRedactor([VALID_CONFIG.clientSecret, VALID_CONFIG.accessToken])
        }),
        ping: (interval) => {
            calls.push(['ping', interval]);
            connect.pingInterval = { fake: 'timer' };
            return connect.pingInterval;
        },
        auth: async (params) => {
            calls.push(['auth', params]);
            if (overrides.authThrows) {
                throw overrides.authThrows;
            }
            return {};
        },
        subscribeForSpots: async (params) => {
            calls.push(['subscribeForSpots', params]);
            if (overrides.subscribeThrows) {
                throw overrides.subscribeThrows;
            }
            return {};
        },
        signals: []
    });

    return { session, connect, stream, calls };
};

const recordFor = (stream, msg) => stream.records.find((record) => record.msg.startsWith(msg));

test('start wires the lifecycle handlers and starts the transport', () => {
    const { session, connect } = build();

    session.start();

    assert.equal(connect.started, true);
    assert.equal(typeof connect.onConnect, 'function');
    assert.equal(typeof connect.onEnd, 'function');
    assert.equal(typeof connect.onError, 'function');
});

test('onConnect pings, authenticates, then subscribes, in that order', async () => {
    const { session, connect, calls } = build();

    session.start();
    connect.onConnect();
    await settle();

    assert.deepEqual(
        calls.map(([name]) => name),
        ['ping', 'auth', 'subscribeForSpots']
    );
    assert.equal(calls[0][1], VALID_CONFIG.pingIntervalMs);
});

test('onConnect forwards configuration to auth and subscribe', async () => {
    const { session, connect, calls } = build();

    session.start();
    connect.onConnect();
    await settle();

    const authParams = calls.find(([name]) => name === 'auth')[1];
    const subscribeParams = calls.find(([name]) => name === 'subscribeForSpots')[1];

    assert.equal(authParams.clientId, VALID_CONFIG.clientId);
    assert.equal(authParams.clientSecret, VALID_CONFIG.clientSecret);
    assert.equal(subscribeParams.accountId, VALID_CONFIG.accountId);
    assert.equal(subscribeParams.accessToken, VALID_CONFIG.accessToken);
    assert.equal(subscribeParams.symbol, VALID_CONFIG.symbol);
});

test('spot events are logged by default and can be replaced by a handler', async () => {
    const { session, connect, stream } = build();

    session.start();
    connect.onConnect();
    await settle();

    assert.ok(connect.listeners.has(PAYLOAD_TYPES.ProtoOASpotEvent));

    connect.emit(PAYLOAD_TYPES.ProtoOASpotEvent, { bidPrice: 1.1, askPrice: 1.2 });
    const logged = recordFor(stream, 'spot update');
    assert.equal(logged.bidPrice, 1.1);
    assert.equal(logged.askPrice, 1.2);

    const seen = [];
    session.setSpotHandler((msg) => seen.push(msg));
    connect.emit(PAYLOAD_TYPES.ProtoOASpotEvent, { bidPrice: 2, askPrice: 2.1 });
    assert.equal(seen.length, 1);
});

test('a rejected auth is logged and tears the session down', async () => {
    const { session, connect, stream } = build({ authThrows: new Error('unauthorized') });

    session.start();
    connect.onConnect();
    await settle();

    // Previously an unhandled rejection, which is fatal on modern Node.
    const failure = recordFor(stream, 'session setup failed');
    assert.ok(failure, 'expected the failure to be logged rather than thrown');
    assert.equal(failure.error.message, 'unauthorized');
    assert.equal(session.closeInfo.reason, 'setup-failed');
});

test('a rejected subscription is logged and tears the session down', async () => {
    const { session, connect, stream } = build({
        subscribeThrows: new Error('subscription refused')
    });

    session.start();
    connect.onConnect();
    await settle();

    const failure = recordFor(stream, 'session setup failed');
    assert.ok(failure);
    assert.equal(failure.error.message, 'subscription refused');
    assert.equal(session.closeInfo.reason, 'setup-failed');
});

test('a transport error routed to onEnd is reported and stops the session', async () => {
    // The bug the original sample had: connect-js-api routes socket errors
    // through _onEnd -> onEnd(e), and the sample only defined onError.
    const { session, connect, stream } = build();

    session.start();
    connect.onEnd(new Error('ECONNRESET'));

    const lost = recordFor(stream, 'connection lost');
    assert.ok(lost);
    assert.equal(lost.error.message, 'ECONNRESET');
    assert.equal(session.closeInfo.reason, 'error');
    assert.equal(session.closed, true);
});

test('a clean end is reported separately from an error', () => {
    const { session, connect, stream } = build();

    session.start();
    connect.onEnd();

    assert.ok(recordFor(stream, 'connection closed'));
    assert.equal(session.closeInfo.reason, 'end');
});

test('uptime is a real number even when the socket fails before opening', () => {
    // startTime used to be assigned only in onConnect, so this used to log
    // "Connection closed in NaN seconds".
    const { session, connect, stream } = build();

    session.start();
    connect.onEnd(new Error('connect ETIMEDOUT'));

    const lost = recordFor(stream, 'connection lost');
    assert.equal(Number.isFinite(lost.uptimeMs), true);
    assert.ok(lost.uptimeMs >= 0);
    assert.equal(Number.isFinite(session.closeInfo.uptimeMs), true);
});

test('a non-Error value from the transport is still reported', () => {
    const { session, connect, stream } = build();

    session.start();
    connect.onEnd('socket hang up');

    const lost = recordFor(stream, 'connection lost');
    assert.ok(lost);
    assert.equal(lost.error.name, 'ConnectionError');
    assert.match(lost.error.message, /socket hang up/);
});

test('stopping clears the keep-alive timer so the event loop can drain', () => {
    const { session, connect } = build();

    session.start();
    connect.onConnect();
    assert.ok(connect.pingInterval);

    session.stop();

    assert.equal(connect.pingInterval, undefined);
});

test('an error before onConnect leaves no timer behind', () => {
    const { session, connect } = build();

    session.start();
    connect.onEnd(new Error('boom'));

    assert.equal(connect.pingInterval, undefined);
    assert.equal(session.closed, true);
});

test('stop is idempotent and resolves waitForClose exactly once', async () => {
    const { session, connect } = build();

    session.start();
    const first = session.stop('manual');
    const second = session.stop('again');
    connect.onEnd(new Error('late error'));

    assert.equal(first.reason, 'manual');
    assert.equal(second, first);
    assert.deepEqual(await session.waitForClose(), first);
});

test('a reconnect does not leave a second keep-alive timer running', async () => {
    const { session, connect, calls } = build();

    session.start();
    connect.onConnect();
    await settle();

    const firstTimer = connect.pingInterval;
    connect.onConnect();
    await settle();

    assert.equal(calls.filter(([name]) => name === 'ping').length, 2);
    assert.notEqual(connect.pingInterval, firstTimer);
    assert.equal(connect.pingInterval.fake, 'timer');
});

test('signal handlers are installed on start and removed on stop', () => {
    const before = process.listenerCount('SIGINT');
    const { session } = createSignalSession();

    session.start();
    assert.equal(process.listenerCount('SIGINT'), before + 1);

    session.stop();
    assert.equal(process.listenerCount('SIGINT'), before);
});

function createSignalSession() {
    const connect = createFakeConnect();
    return {
        session: createSession({
            connect,
            config: VALID_CONFIG,
            logger: createLogger({ level: 'error', stream: createMemoryStream() }),
            ping: () => {},
            auth: async () => ({}),
            subscribeForSpots: async () => ({}),
            signals: ['SIGINT']
        })
    };
}

test('secrets never reach the log stream', async () => {
    const { session, connect, stream } = build();

    session.start();
    connect.onConnect();
    await settle();

    const output = stream.lines.join('');
    assert.equal(output.includes(VALID_CONFIG.clientSecret), false);
    assert.equal(output.includes(VALID_CONFIG.accessToken), false);
});

test('a missing spot payload type is warned about, not thrown', async () => {
    const connect = createFakeConnect();
    const original = connect.protocol.getPayloadTypeByName;
    connect.protocol.getPayloadTypeByName = (name) =>
        name === 'ProtoOASpotEvent' ? undefined : original(name);

    const { session, stream } = build({ connect });

    session.start();
    connect.onConnect();
    await settle();

    assert.ok(recordFor(stream, 'subscribed for spots'));
    assert.ok(
        recordFor(stream, 'spot payload type unavailable'),
        'expected a warning rather than a crash'
    );
});

test('onError is a live handler, not dead code', () => {
    const { session, connect, stream } = build();

    session.start();
    connect.onError(new Error('transport blew up'));

    assert.ok(recordFor(stream, 'transport error'));
    assert.equal(session.closed, true);
});
