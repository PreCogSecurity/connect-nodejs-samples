'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    requireCredential,
    requireAccountId,
    requireSymbol,
    requireInterval,
    requirePayloadType
} = require('../lib/validation');
const { ValidationError } = require('../lib/errors');
const { LIMITS, MIN_PING_INTERVAL_MS, MAX_PING_INTERVAL_MS } = require('../lib/config');

test('requireCredential accepts a normal secret and rejects the alternatives', () => {
    const limits = LIMITS.clientSecret;
    assert.equal(requireCredential('abc123', 'clientSecret', limits), 'abc123');

    for (const bad of [undefined, null, '', 123, {}, [], true, 'a'.repeat(limits.max + 1)]) {
        assert.throws(
            () => requireCredential(bad, 'clientSecret', limits),
            ValidationError,
            `${JSON.stringify(bad)} should be rejected`
        );
    }
});

test('requireCredential rejects whitespace and control characters', () => {
    const limits = LIMITS.clientSecret;
    const withControl = (code) => `abc${String.fromCharCode(code)}def`;

    assert.throws(() => requireCredential('a b', 'clientSecret', limits), ValidationError);
    for (const code of [0x00, 0x0a, 0x0d, 0x09, 0x1b, 0x7f]) {
        assert.throws(
            () => requireCredential(withControl(code), 'clientSecret', limits),
            ValidationError,
            `charCode ${code} should be rejected`
        );
    }
});

test('requireCredential reports the offending field name', () => {
    assert.throws(
        () => requireCredential('', 'accessToken', LIMITS.accessToken),
        (error) => {
            assert.equal(error.field, 'accessToken');
            assert.equal(error.code, 'ERR_CONNECT_VALIDATION');
            return true;
        }
    );
});

test('requireAccountId accepts positive integers in string or number form', () => {
    assert.equal(requireAccountId(62002), 62002);
    assert.equal(requireAccountId('62002'), 62002);
    assert.equal(requireAccountId(1), 1);
});

test('requireAccountId rejects everything else', () => {
    for (const bad of [0, -1, 1.5, '1.5', 'abc', '', null, undefined, NaN, Infinity, {}, '1e3']) {
        assert.throws(
            () => requireAccountId(bad),
            ValidationError,
            `${String(bad)} should be rejected`
        );
    }
});

test('requireAccountId allows an explicit field name', () => {
    assert.throws(
        () => requireAccountId(-1, 'params.accountId'),
        /params\.accountId/
    );
});

test('requireSymbol normalises case and constrains the charset', () => {
    assert.equal(requireSymbol('eurusd'), 'EURUSD');
    assert.equal(requireSymbol('EUR.USD'), 'EUR.USD');
    assert.equal(requireSymbol('A'), 'A');
    assert.equal(requireSymbol('A'.repeat(32)), 'A'.repeat(32));

    const rejected = [
        '', '.', '-X', '_X', 'EUR USD', 'A'.repeat(33), 'EUR/USD', 'EUR;USD', 42, null
    ];
    for (const bad of rejected) {
        assert.throws(
            () => requireSymbol(bad),
            ValidationError,
            `${String(bad)} should be rejected`
        );
    }
});

test('requireInterval enforces the keep-alive bounds', () => {
    assert.equal(requireInterval(MIN_PING_INTERVAL_MS), MIN_PING_INTERVAL_MS);
    assert.equal(requireInterval(MAX_PING_INTERVAL_MS), MAX_PING_INTERVAL_MS);

    for (const bad of [0, -1, 99, MAX_PING_INTERVAL_MS + 1, 1000.5, '1000', NaN, Infinity, null]) {
        assert.throws(
            () => requireInterval(bad),
            ValidationError,
            `${String(bad)} should be rejected`
        );
    }
});

test('requirePayloadType resolves a loaded message', () => {
    const protocol = { getPayloadTypeByName: () => 4001 };
    assert.equal(requirePayloadType(protocol, 'ProtoOAAuthReq'), 4001);
});

test('requirePayloadType fails loudly instead of sending payload type 0', () => {
    // protobuf happily encodes undefined as 0, which would put a silently
    // malformed frame on the wire.
    for (const protocol of [
        { getPayloadTypeByName: () => undefined },
        { getPayloadTypeByName: () => null },
        {},
        undefined
    ]) {
        assert.throws(
            () => requirePayloadType(protocol, 'ProtoOAAuthReq'),
            (error) => {
                assert.ok(error instanceof ValidationError);
                assert.match(error.message, /protocol\.load\(\)/);
                return true;
            }
        );
    }
});
