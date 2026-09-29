'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLogger, LEVELS, LOG_LEVEL_NAMES } = require('../lib/logger');
const { createRedactor } = require('../lib/redact');
const { createMemoryStream } = require('./helpers/fakes');
const { ValidationError } = require('../lib/errors');

const buildLogger = (overrides = {}) => {
    const stream = createMemoryStream();
    const logger = createLogger({
        level: 'debug',
        stream,
        now: () => '2026-01-01T00:00:00.000Z',
        ...overrides
    });
    return { logger, stream };
};

test('emits one JSON object per line with a timestamp, level and message', () => {
    const { logger, stream } = buildLogger();

    logger.info('subscribed for spots', { symbol: 'EURUSD', accountId: 62002 });

    assert.equal(stream.lines.length, 1);
    assert.equal(stream.lines[0].endsWith('\n'), true);
    assert.deepEqual(stream.records[0], {
        ts: '2026-01-01T00:00:00.000Z',
        level: 'info',
        msg: 'subscribed for spots',
        symbol: 'EURUSD',
        accountId: 62002
    });
});

test('honours the level threshold', () => {
    const { logger, stream } = buildLogger({ level: 'warn' });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assert.deepEqual(
        stream.records.map((r) => r.level),
        ['warn', 'error']
    );
});

test('silent suppresses everything', () => {
    const { logger, stream } = buildLogger({ level: 'silent' });
    logger.error('still nothing');
    assert.equal(stream.lines.length, 0);
});

test('an unknown level falls back to info', () => {
    const { logger, stream } = buildLogger({ level: 'chatty' });
    logger.debug('d');
    logger.info('i');
    assert.deepEqual(
        stream.records.map((r) => r.level),
        ['info']
    );
});

test('registered secrets are scrubbed from the message', () => {
    const { logger, stream } = buildLogger({
        redactor: createRedactor(['client-secret-xyz789'])
    });

    logger.info('auth failed for client-secret-xyz789');

    assert.equal(stream.records[0].msg.includes('client-secret-xyz789'), false);
});

test('credential-shaped fields are redacted even when never registered', () => {
    const { logger, stream } = buildLogger();

    logger.info('request', { accountId: 62002, accessToken: 'unregistered-token' });

    assert.equal(stream.records[0].accountId, 62002);
    assert.equal(stream.records[0].accessToken, '[redacted]');
});

test('an Error field is serialised with name, code and message', () => {
    const { logger, stream } = buildLogger();

    logger.error('request failed', {
        error: new ValidationError('bad symbol', { field: 'symbol' })
    });

    const { error } = stream.records[0];
    assert.equal(error.name, 'ValidationError');
    assert.equal(error.code, 'ERR_CONNECT_VALIDATION');
    assert.equal(error.message, 'bad symbol');
    assert.equal(error.field, 'symbol');
});

test('stacks are suppressed at error level and included at debug level', () => {
    // A stack's first line is the error message, and an upstream message can
    // carry a URL or token. Redacting `message` but not the stack would
    // reintroduce the leak through the back door.
    const { logger, stream } = buildLogger();
    const error = new Error('connect failed for https://host/?token=leaky');

    logger.error('failed', { error });
    logger.debug('failed', { error });

    const [errored, debugged] = stream.records;
    assert.equal('stack' in errored.error, false);
    assert.equal(typeof debugged.error.stack, 'string');
});

test('a secret inside a stack is still scrubbed at debug level', () => {
    const { logger, stream } = buildLogger({
        redactor: createRedactor(['tok-abcdef'])
    });

    logger.debug('failed', { error: new Error('upstream said tok-abcdef') });

    assert.equal(stream.lines.join('').includes('tok-abcdef'), false);
});

test('the logger never throws when the stream is broken', () => {
    const stream = {
        write() {
            throw new Error('EPIPE');
        }
    };
    const logger = createLogger({ level: 'info', stream });

    assert.doesNotThrow(() => logger.info('still fine'));
});

test('the logger never throws on an unserialisable field', () => {
    const { logger, stream } = buildLogger();

    const circular = { name: 'loop' };
    circular.self = circular;
    circular.big = 10n;

    assert.doesNotThrow(() => logger.info('weird', { circular }));

    assert.equal(stream.records[0].level, 'error');
    assert.match(stream.records[0].msg, /could not be serialised/);
});

test('level names and ordering are exported for reuse', () => {
    assert.deepEqual(LOG_LEVEL_NAMES, ['debug', 'info', 'warn', 'error', 'silent']);
    assert.ok(LEVELS.debug < LEVELS.info);
    assert.ok(LEVELS.error < LEVELS.silent);
});
