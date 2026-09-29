'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRedactor, REDACTED, isSensitiveKey } = require('../lib/redact');

test('credential-shaped keys are recognised', () => {
    const sensitive = [
        'clientSecret',
        'CLIENT_SECRET',
        'password',
        'passwd',
        'token',
        'accessToken',
        'apiKey',
        'privateKey',
        'credentials',
        'Authorization',
        'sessionId',
        'cookie',
        'signature'
    ];
    for (const key of sensitive) {
        assert.ok(isSensitiveKey(key), `${key} should be treated as sensitive`);
    }
});

test('benign keys are not redacted', () => {
    for (const key of ['accountId', 'symbol', 'host', 'port', 'bidPrice', 'askPrice', 'level']) {
        assert.equal(isSensitiveKey(key), false, `${key} should not be treated as sensitive`);
    }
});

test('a registered secret is scrubbed out of an arbitrary string', () => {
    const redactor = createRedactor(['s3cr3t-value']);
    const scrubbed = redactor.redactString(
        'connect failed for clientSecret=s3cr3t-value retrying'
    );
    assert.equal(scrubbed, `connect failed for clientSecret=${REDACTED} retrying`);
});

test('very short secrets are not string-replaced', () => {
    // A 2-character "secret" would shred unrelated output without protecting
    // anything meaningful, so it is only ever caught by key-based redaction.
    const redactor = createRedactor(['ab']);
    assert.equal(redactor.redactValue({ token: 'ab' }).token, REDACTED);
    assert.equal(redactor.redactString('a stable cabin'), 'a stable cabin');
});

test('overlapping secrets redact greedily, longest first', () => {
    const redactor = createRedactor(['secret', 'secret-extended']);
    const result = redactor.redactString('value=secret-extended');
    assert.equal(result, `value=${REDACTED}`);
});

test('redaction is recursive through objects, arrays, maps and sets', () => {
    const redactor = createRedactor(['tok-abcdef']);
    const input = {
        accountId: 62002,
        accessToken: 'tok-abcdef',
        nested: { clientSecret: 'whatever', deep: [{ accessToken: 'tok-abcdef' }] },
        list: ['tok-abcdef', { password: 'p' }],
        asMap: new Map([['accessToken', 'tok-abcdef']]),
        asSet: new Set(['tok-abcdef'])
    };

    const result = redactor.redactValue(input);

    assert.equal(result.accountId, 62002);
    assert.equal(result.accessToken, REDACTED);
    assert.equal(result.nested.clientSecret, REDACTED);
    assert.equal(result.nested.deep[0].accessToken, REDACTED);
    assert.equal(result.list[0], REDACTED);
    assert.equal(result.list[1].password, REDACTED);
    assert.equal(result.asMap.accessToken, REDACTED);
    assert.equal(result.asSet[0], REDACTED);

    // The input must not be mutated: callers still hold live config objects.
    assert.equal(input.accessToken, 'tok-abcdef');
});

test('circular structures do not blow up the redactor', () => {
    const redactor = createRedactor(['tok-abcdef']);
    const input = { name: 'root' };
    input.self = input;

    const result = redactor.redactValue(input);

    assert.equal(result.name, 'root');
    assert.equal(result.self, '[circular]');
});

test('errors are reduced to their safe serialisation and then scrubbed', () => {
    const { ConfigurationError } = require('../lib/errors');
    const redactor = createRedactor(['tok-abcdef']);

    const result = redactor.redactValue(
        new ConfigurationError('bad token tok-abcdef', { code: 'ERR_X' })
    );

    assert.equal(result.name, 'ConfigurationError');
    assert.equal(result.code, 'ERR_X');
    assert.equal(result.message, `bad token ${REDACTED}`);
});

test('an unknown key holding a registered secret is still scrubbed', () => {
    // The value-based pass is what saves us when a third-party library nests a
    // credential under a name we do not recognise.
    const redactor = createRedactor(['tok-abcdef']);
    const result = redactor.redactValue({ someVendorField: 'prefix tok-abcdef suffix' });
    assert.equal(result.someVendorField, `prefix ${REDACTED} suffix`);
});

test('secrets can be registered after construction', () => {
    const redactor = createRedactor();
    assert.equal(redactor.hasSecrets(), false);

    redactor.addSecrets('later-secret');

    assert.equal(redactor.hasSecrets(), true);
    assert.equal(redactor.redactString('x later-secret y'), `x ${REDACTED} y`);
});

test('secrets containing regex metacharacters are handled literally', () => {
    const redactor = createRedactor(['a.b*c+d(e)']);
    assert.equal(redactor.redactString('token=a.b*c+d(e)'), `token=${REDACTED}`);
    assert.equal(redactor.redactString('token=axbxcxdxe'), 'token=axbxcxdxe');
});

test('non-string primitives pass through unchanged', () => {
    const redactor = createRedactor(['tok-abcdef']);
    assert.equal(redactor.redactValue(42), 42);
    assert.equal(redactor.redactValue(true), true);
    assert.equal(redactor.redactValue(null), null);
    assert.equal(redactor.redactValue(undefined), undefined);
});

test('dates are serialised rather than walked as objects', () => {
    const redactor = createRedactor();
    const date = new Date('2026-01-02T03:04:05.000Z');
    assert.equal(redactor.redactValue({ at: date }).at, date.toISOString());
});
