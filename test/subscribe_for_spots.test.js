'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const subscribeForSpots = require('../lib/subscribe_for_spots');
const { createFakeConnect, PAYLOAD_TYPES } = require('./helpers/fakes');
const { ValidationError } = require('../lib/errors');

const PARAMS = Object.freeze({
    accountId: 62002,
    accessToken: 'access-token-000111',
    symbol: 'EURUSD'
});

test('sends ProtoOASubscribeForSpotsReq with the upstream field name', async () => {
    const connect = createFakeConnect();

    await subscribeForSpots.call(connect, { ...PARAMS });

    assert.equal(connect.sent.length, 1);
    assert.deepEqual(connect.sent[0], {
        payloadType: PAYLOAD_TYPES.ProtoOASubscribeForSpotsReq,
        params: {
            accountId: 62002,
            accessToken: PARAMS.accessToken,
            // Upstream OpenApiMessages.proto really does spell it 'symblolName'.
            symblolName: 'EURUSD'
        }
    });
});

test('the symbol is normalised to upper case on the wire', async () => {
    const connect = createFakeConnect();

    await subscribeForSpots.call(connect, { ...PARAMS, symbol: 'eurusd' });

    assert.equal(connect.sent[0].params.symblolName, 'EURUSD');
});

test('the legacy misspelled input still works', async () => {
    // Copies of this sample in the wild pass 'symblolName'; they must not break.
    const connect = createFakeConnect();

    await subscribeForSpots.call(connect, {
        accountId: 62002,
        accessToken: PARAMS.accessToken,
        symblolName: 'GBPUSD'
    });

    assert.equal(connect.sent[0].params.symblolName, 'GBPUSD');
});

test('a numeric accountId string is accepted and coerced', async () => {
    const connect = createFakeConnect();

    await subscribeForSpots.call(connect, { ...PARAMS, accountId: '62002' });

    assert.equal(connect.sent[0].params.accountId, 62002);
});

test('returns the promise from sendGuaranteedCommand', async () => {
    const connect = createFakeConnect();
    connect.resolveWith({ subscriptionId: 7 });

    assert.deepEqual(await subscribeForSpots.call(connect, { ...PARAMS }), { subscriptionId: 7 });
});

test('sends nothing when any parameter is missing or invalid', () => {
    const connect = createFakeConnect();

    const invalid = [
        { ...PARAMS, accountId: 0 },
        { ...PARAMS, accountId: -5 },
        { ...PARAMS, accountId: 'not-a-number' },
        { ...PARAMS, accessToken: '' },
        { ...PARAMS, accessToken: 'has space' },
        { ...PARAMS, symbol: '' },
        { ...PARAMS, symbol: 'EUR USD' },
        { accountId: 62002, accessToken: PARAMS.accessToken },
        { accountId: 62002, symbol: 'EURUSD' },
        {}
    ];

    for (const params of invalid) {
        assert.throws(
            () => subscribeForSpots.call(connect, params),
            ValidationError,
            `${JSON.stringify(params)} should be rejected`
        );
    }
    assert.equal(connect.sent.length, 0);
});

test('refuses to send when the protocol was never loaded', () => {
    const connect = createFakeConnect({ withoutProtocol: true });

    assert.throws(() => subscribeForSpots.call(connect, { ...PARAMS }), ValidationError);
    assert.equal(connect.sent.length, 0);
});

test('surfaces server rejections to the caller', async () => {
    const connect = createFakeConnect();
    connect.rejectWith(new Error('subscription refused'));

    await assert.rejects(() => subscribeForSpots.call(connect, { ...PARAMS }), /subscription refused/);
});
