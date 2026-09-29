'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ConnectSampleError,
    ConfigurationError,
    ValidationError,
    ConnectionError,
    ProtocolError
} = require('../lib/errors');

test('ConnectSampleError is a real Error with a default code', () => {
    const error = new ConnectSampleError('boom');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof ConnectSampleError);
    assert.equal(error.name, 'ConnectSampleError');
    assert.equal(error.code, 'ERR_CONNECT_SAMPLE');
});

test('every subclass gets its own name and code', () => {
    const cases = [
        [ConfigurationError, 'ConfigurationError', 'ERR_CONNECT_CONFIG'],
        [ValidationError, 'ValidationError', 'ERR_CONNECT_VALIDATION'],
        [ConnectionError, 'ConnectionError', 'ERR_CONNECT_CONNECTION'],
        [ProtocolError, 'ProtocolError', 'ERR_CONNECT_PROTOCOL']
    ];

    for (const [Type, name, code] of cases) {
        const error = new Type('x');
        assert.equal(error.name, name);
        assert.equal(error.code, code);
        assert.ok(error instanceof ConnectSampleError);
    }
});

test('toJSON omits the stack and the cause, both of which may leak secrets', () => {
    const error = new ValidationError('bad accessToken=super-secret', {
        field: 'accessToken',
        cause: new Error('inner: super-secret')
    });

    const serialised = error.toJSON();

    assert.deepEqual(serialised, {
        name: 'ValidationError',
        code: 'ERR_CONNECT_VALIDATION',
        message: 'bad accessToken=super-secret',
        field: 'accessToken'
    });
    assert.equal('stack' in serialised, false);
    assert.equal('cause' in serialised, false);
});

test('ValidationError and ProtocolError expose their extra fields', () => {
    assert.equal(new ValidationError('m', { field: 'symbol' }).field, 'symbol');
    assert.equal(new ProtocolError('m', { payloadType: 4001 }).payloadType, 4001);
    assert.equal(new ProtocolError('m').payloadType, undefined);
});

test('an explicit code overrides the subclass default', () => {
    assert.equal(new ConfigurationError('m', { code: 'ERR_CUSTOM' }).code, 'ERR_CUSTOM');
});
