'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, configSecrets, DEFAULTS } = require('../lib/config');
const { ConfigurationError } = require('../lib/errors');

const VALID_ENV = Object.freeze({
    CONNECT_CLIENT_ID: 'client-id-abc123',
    CONNECT_CLIENT_SECRET: 'client-secret-xyz789',
    CONNECT_ACCESS_TOKEN: 'access-token-000111',
    CONNECT_ACCOUNT_ID: '62002'
});

const load = (env, options = {}) => loadConfig({ env, envFile: false, ...options });

/** Every required variable is present, so only the field under test can fail. */
const envWith = (overrides) => ({ ...VALID_ENV, ...overrides });

test('a complete environment produces a frozen configuration', () => {
    const config = load(VALID_ENV);

    assert.equal(config.clientId, 'client-id-abc123');
    assert.equal(config.clientSecret, 'client-secret-xyz789');
    assert.equal(config.accessToken, 'access-token-000111');
    assert.equal(config.accountId, 62002);
    assert.ok(Object.isFrozen(config));
});

test('connection defaults are applied and are overridable', () => {
    const defaults = load(VALID_ENV);
    assert.equal(defaults.host, DEFAULTS.CONNECT_HOST);
    assert.equal(defaults.host, 'sandbox-tradeapi.spotware.com');
    assert.equal(defaults.port, 5032);
    assert.equal(defaults.symbol, 'EURUSD');
    assert.equal(defaults.pingIntervalMs, 1000);
    assert.equal(defaults.logLevel, 'info');

    const overridden = load(
        envWith({
            CONNECT_HOST: 'tradeapi.spotware.com',
            CONNECT_PORT: '5033',
            CONNECT_SYMBOL: 'gbpusd',
            CONNECT_PING_INTERVAL_MS: '250',
            LOG_LEVEL: 'DEBUG'
        })
    );
    assert.equal(overridden.host, 'tradeapi.spotware.com');
    assert.equal(overridden.port, 5033);
    assert.equal(overridden.symbol, 'GBPUSD');
    assert.equal(overridden.pingIntervalMs, 250);
    assert.equal(overridden.logLevel, 'debug');
});

test('the env file supplies values the environment does not', () => {
    const envWithoutToken = { ...VALID_ENV };
    delete envWithoutToken.CONNECT_ACCESS_TOKEN;

    const readFile = () => ({ CONNECT_ACCESS_TOKEN: 'from-file' });
    const config = loadConfig({ env: envWithoutToken, readFile });

    assert.equal(config.accessToken, 'from-file');
    assert.equal(config.clientId, 'client-id-abc123');
});

test('the real environment wins over the env file', () => {
    const readFile = () => ({ CONNECT_CLIENT_SECRET: 'from-file' });
    const config = loadConfig({ env: VALID_ENV, readFile });

    assert.equal(config.clientSecret, 'client-secret-xyz789');
});

test('an explicitly empty environment variable does not fall back to the file', () => {
    // Fail closed: an empty shell export must be a visible error, not a silent
    // rescue by a file the operator may not know exists.
    const readFile = () => ({ CONNECT_CLIENT_SECRET: 'from-file' });

    assert.throws(
        () => loadConfig({ env: envWith({ CONNECT_CLIENT_SECRET: '' }), readFile }),
        (error) => {
            assert.match(error.message, /CONNECT_CLIENT_SECRET/);
            assert.equal(error.message.includes('from-file'), false);
            return true;
        }
    );
});

test('envFile false skips disk access entirely', () => {
    const config = loadConfig({ env: VALID_ENV, envFile: false });
    assert.equal(config.envFilePath, null);
});

test('every missing required variable is reported at once, by name only', () => {
    assert.throws(
        () => load({}),
        (error) => {
            assert.ok(error instanceof ConfigurationError);
            for (const name of [
                'CONNECT_CLIENT_ID',
                'CONNECT_CLIENT_SECRET',
                'CONNECT_ACCESS_TOKEN',
                'CONNECT_ACCOUNT_ID'
            ]) {
                assert.match(error.message, new RegExp(name));
            }
            return true;
        }
    );
});

test('configuration errors never contain credential values', () => {
    // Each value below is invalid *and* distinctive, so if any of them reached
    // the message the assertion below would fail.
    const injected = 'super-secret-value\nforged-log-line';
    const spaced = 'id with spaces';
    const overlong = 'z'.repeat(300);

    assert.throws(
        () =>
            load(
                envWith({
                    CONNECT_CLIENT_SECRET: injected,
                    CONNECT_ACCESS_TOKEN: 'short',
                    CONNECT_CLIENT_ID: spaced,
                    CONNECT_ACCOUNT_ID: overlong
                })
            ),
        (error) => {
            assert.equal(error.message.includes(injected), false, 'leaked the client secret');
            assert.equal(error.message.includes('forged-log-line'), false, 'leaked a log line');
            assert.equal(error.message.includes(spaced), false, 'leaked the client id');
            assert.equal(error.message.includes(overlong), false, 'leaked the account id');
            // ...but the operator still learns exactly what to fix.
            assert.match(error.message, /CONNECT_CLIENT_SECRET/);
            assert.match(error.message, /CONNECT_CLIENT_ID/);
            return true;
        }
    );
});

test('accountId must be a positive whole number', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1e3', ' 12', '12 ']) {
        assert.throws(
            () => load(envWith({ CONNECT_ACCOUNT_ID: bad })),
            ConfigurationError,
            `accountId '${bad}' should be rejected`
        );
    }
    assert.equal(load(envWith({ CONNECT_ACCOUNT_ID: '1' })).accountId, 1);
    assert.equal(
        load(envWith({ CONNECT_ACCOUNT_ID: Number.MAX_SAFE_INTEGER })).accountId,
        9_007_199_254_740_991
    );
});

test('port must be a valid TCP port', () => {
    for (const bad of ['0', '65536', '-1', 'http', '5032.0']) {
        assert.throws(() => load(envWith({ CONNECT_PORT: bad })), ConfigurationError);
    }
    assert.equal(load(envWith({ CONNECT_PORT: '1' })).port, 1);
    assert.equal(load(envWith({ CONNECT_PORT: '65535' })).port, 65535);
});

test('host must be a bare hostname', () => {
    const bad = [
        'https://tradeapi.spotware.com',
        'tradeapi.spotware.com:5032',
        'tradeapi.spotware.com/path',
        'tradeapi spotware',
        'tradeapi.spotware.com?x=1',
        '-leading-hyphen.com',
        'user@tradeapi.spotware.com',
        'tradeapi..spotware.com',
        'tradeapi.spotware.com.'
    ];
    for (const host of bad) {
        assert.throws(
            () => load(envWith({ CONNECT_HOST: host })),
            ConfigurationError,
            `host '${host}' should be rejected`
        );
    }
});

test('host accepts hostnames, single labels and IPv4 literals', () => {
    for (const host of [
        'localhost',
        'tradeapi.spotware.com',
        'my-host.sub.domain.example.com',
        '10.0.0.1'
    ]) {
        assert.equal(load(envWith({ CONNECT_HOST: host })).host, host);
    }
});

test('symbol is normalised and constrained', () => {
    assert.equal(load(envWith({ CONNECT_SYMBOL: 'eurusd' })).symbol, 'EURUSD');
    assert.equal(load(envWith({ CONNECT_SYMBOL: 'EUR.USD' })).symbol, 'EUR.USD');

    for (const bad of ['', '.', '-EURUSD', 'EUR USD', 'A'.repeat(33), 'EUR/USD']) {
        assert.throws(
            () => load(envWith({ CONNECT_SYMBOL: bad })),
            ConfigurationError,
            `symbol '${bad}' should be rejected`
        );
    }
});

test('ping interval is bounded to something sane', () => {
    assert.throws(() => load(envWith({ CONNECT_PING_INTERVAL_MS: '0' })), ConfigurationError);
    assert.throws(() => load(envWith({ CONNECT_PING_INTERVAL_MS: '99' })), ConfigurationError);
    assert.throws(() => load(envWith({ CONNECT_PING_INTERVAL_MS: '600001' })), ConfigurationError);
    assert.equal(load(envWith({ CONNECT_PING_INTERVAL_MS: '100' })).pingIntervalMs, 100);
    assert.equal(load(envWith({ CONNECT_PING_INTERVAL_MS: '600000' })).pingIntervalMs, 600_000);
});

test('log level must be one of the known levels', () => {
    for (const level of ['trace', 'fatal', 'verbose', '']) {
        assert.throws(() => load(envWith({ LOG_LEVEL: level })), ConfigurationError);
    }
    for (const level of ['debug', 'info', 'warn', 'error', 'silent']) {
        assert.equal(load(envWith({ LOG_LEVEL: level })).logLevel, level);
    }
});

test('credentials reject whitespace and control characters', () => {
    // Whitespace in a credential is copy/paste damage, and a control character
    // is a log-injection primitive.
    const withControl = (code) => `secret${String.fromCharCode(code)}value`;

    assert.throws(
        () => load(envWith({ CONNECT_CLIENT_SECRET: 'has space' })),
        ConfigurationError
    );
    for (const code of [0x00, 0x0a, 0x0d, 0x1b, 0x7f]) {
        assert.throws(
            () => load(envWith({ CONNECT_ACCESS_TOKEN: withControl(code) })),
            ConfigurationError,
            `charCode ${code} should be rejected`
        );
    }
});

test('credentials containing hyphens, dots and underscores are accepted', () => {
    const value = 'a-b_c.d1/e+f=g';
    const config = load(
        envWith({
            CONNECT_CLIENT_ID: value,
            CONNECT_CLIENT_SECRET: value,
            CONNECT_ACCESS_TOKEN: value
        })
    );
    assert.equal(config.clientId, value);
});

test('over-long credentials are rejected without echoing them', () => {
    const tooLong = 'x'.repeat(129);
    assert.throws(
        () => load(envWith({ CONNECT_CLIENT_ID: tooLong })),
        (error) => {
            assert.match(error.message, /between 1 and 128 characters \(got 129\)/);
            assert.equal(error.message.includes(tooLong), false);
            return true;
        }
    );
});

test('configSecrets exposes only the values that must never be logged', () => {
    const config = load(VALID_ENV);
    assert.deepEqual(configSecrets(config), ['client-secret-xyz789', 'access-token-000111']);
});
