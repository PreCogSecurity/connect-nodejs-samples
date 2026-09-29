'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ping = require('../lib/ping');
const { createFakeConnect, PAYLOAD_TYPES } = require('./helpers/fakes');
const { ValidationError } = require('../lib/errors');
const { MIN_PING_INTERVAL_MS } = require('../lib/config');

/** Runs `ping` with real timers, then clears the handle and hands back the fake. */
const withPinger = (interval) =>
    new Promise((resolve) => {
        const connect = createFakeConnect();
        const handle = ping.call(connect, interval);
        setTimeout(() => {
            clearInterval(handle);
            resolve(connect);
        }, interval * 4);
    });

test('registers the interval on the connect instance and returns it', () => {
    const connect = createFakeConnect();

    const handle = ping.call(connect, MIN_PING_INTERVAL_MS);

    assert.ok(handle);
    assert.equal(connect.pingInterval, handle);
    clearInterval(handle);
});

test('sends ProtoPingReq on a repeating interval with a timestamp', async () => {
    const connect = await withPinger(MIN_PING_INTERVAL_MS);

    const pings = connect.commandsFor(PAYLOAD_TYPES.ProtoPingReq);
    assert.ok(pings.length >= 2, `expected repeated pings, saw ${pings.length}`);
    for (const command of pings) {
        assert.equal(typeof command.params.timestamp, 'number');
        assert.ok(command.params.timestamp > 0);
        assert.deepEqual(Object.keys(command.params), ['timestamp']);
    }
});

test('rejects an unusable interval without starting a timer', () => {
    const connect = createFakeConnect();

    for (const bad of [0, -1, 99, 1.5, '1000', NaN, undefined, null, 600_001]) {
        assert.throws(
            () => ping.call(connect, bad),
            ValidationError,
            `interval ${String(bad)} should be rejected`
        );
    }
    assert.equal(connect.pingInterval, undefined);
});

test('refuses to start when the protocol was never loaded', () => {
    const connect = createFakeConnect({ withoutProtocol: true });

    assert.throws(() => ping.call(connect, MIN_PING_INTERVAL_MS), ValidationError);
    assert.equal(connect.pingInterval, undefined);
});

test('a rejected ping does not become an unhandled rejection', async () => {
    const connect = createFakeConnect();
    connect.rejectWith(new Error('no pong'));

    // Unhandled rejections are fatal on modern Node. The interval callback
    // must absorb the failure instead.
    const seen = [];
    const onUnhandled = (reason) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
        const handle = ping.call(connect, MIN_PING_INTERVAL_MS);
        await new Promise((resolve) => setTimeout(resolve, MIN_PING_INTERVAL_MS * 4));
        clearInterval(handle);

        assert.ok(connect.commandsFor(PAYLOAD_TYPES.ProtoPingReq).length >= 1);
        assert.deepEqual(seen, []);
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        clearInterval(connect.pingInterval);
    }
});

test('clearing the handle stops further pings', async () => {
    const connect = createFakeConnect();

    const handle = ping.call(connect, MIN_PING_INTERVAL_MS);
    await new Promise((resolve) => setTimeout(resolve, MIN_PING_INTERVAL_MS * 2));
    clearInterval(handle);

    const afterClear = connect.commandsFor(PAYLOAD_TYPES.ProtoPingReq).length;
    await new Promise((resolve) => setTimeout(resolve, MIN_PING_INTERVAL_MS * 3));

    assert.equal(connect.commandsFor(PAYLOAD_TYPES.ProtoPingReq).length, afterClear);
});
