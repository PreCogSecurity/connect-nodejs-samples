'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/auth');
const { createFakeConnect, PAYLOAD_TYPES } = require('./helpers/fakes');
const { ValidationError } = require('../lib/errors');

const PARAMS = Object.freeze({
    clientId: 'client-id-abc123',
    clientSecret: 'client-secret-xyz789'
});

test('sends ProtoOAAuthReq with exactly the credential fields', async () => {
    const connect = createFakeConnect();

    await auth.call(connect, { ...PARAMS });

    assert.equal(connect.sent.length, 1);
    assert.deepEqual(connect.sent[0], {
        payloadType: PAYLOAD_TYPES.ProtoOAAuthReq,
        params: { clientId: PARAMS.clientId, clientSecret: PARAMS.clientSecret }
    });
});

test('returns the promise from sendGuaranteedCommand', async () => {
    const connect = createFakeConnect();
    connect.resolveWith({ authenticated: true });

    const result = await auth.call(connect, { ...PARAMS });

    assert.deepEqual(result, { authenticated: true });
});

test('does not send anything when a parameter is missing', () => {
    const connect = createFakeConnect();

    assert.throws(() => auth.call(connect, { clientId: PARAMS.clientId }), ValidationError);
    assert.throws(() => auth.call(connect, { clientSecret: PARAMS.clientSecret }), ValidationError);
    assert.throws(() => auth.call(connect, {}), ValidationError);
    assert.throws(() => auth.call(connect), ValidationError);

    assert.equal(connect.sent.length, 0);
});

test('rejects malformed credentials before they reach the wire', () => {
    const connect = createFakeConnect();

    for (const bad of ['', 'has space', 'x'.repeat(129), 42, null]) {
        assert.throws(
            () => auth.call(connect, { ...PARAMS, clientId: bad }),
            ValidationError,
            `clientId ${JSON.stringify(bad)} should be rejected`
        );
    }
    assert.equal(connect.sent.length, 0);
});

test('refuses to send when the protocol was never loaded', () => {
    // Without this guard the sample would put payload type 0 on the wire.
    const connect = createFakeConnect({ withoutProtocol: true });

    assert.throws(() => auth.call(connect, { ...PARAMS }), ValidationError);
    assert.equal(connect.sent.length, 0);
});

test('surfaces server rejections to the caller', async () => {
    const connect = createFakeConnect();
    const rejection = new Error('unauthorized');
    connect.rejectWith(rejection);

    await assert.rejects(() => auth.call(connect, { ...PARAMS }), /unauthorized/);
});
