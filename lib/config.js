'use strict';

const path = require('path');
const { ConfigurationError } = require('./errors');
const { readEnvFile } = require('./env_file');
const { LOG_LEVEL_NAMES } = require('./logger');

/**
 * Environment-driven configuration with fail-closed validation.
 *
 * Design rules, all of which exist for security or operational reasons:
 *
 *  - Nothing is defaulted for the credential fields. A missing credential is a
 *    hard, immediate error before any socket is opened, never a silent
 *    fallback to a built-in value.
 *  - Validation is exhaustive: every problem is reported in one pass, by
 *    *variable name only*. Values are never interpolated into an error
 *    message, so a typo in a startup log cannot disclose a secret.
 *  - `host`/`port` are constrained to a bare hostname and a valid port. They
 *    are handed to `tls.connect`, and an unvalidated value carrying a port,
 *    scheme or path fragment would point TLS traffic somewhere unintended.
 *  - Credentials are rejected if they contain whitespace or control
 *    characters. Both are almost always copy/paste damage, and control
 *    characters are a log-injection primitive.
 *
 * Precedence: a variable already present in the real environment wins over the
 * same variable in the `.env` file. An explicitly empty real variable counts
 * as *set but invalid* rather than falling back, so an operator cannot
 * accidentally shadow a good file value with an empty shell export.
 */

const DEFAULTS = {
    CONNECT_HOST: 'sandbox-tradeapi.spotware.com',
    CONNECT_PORT: '5032',
    CONNECT_SYMBOL: 'EURUSD',
    CONNECT_PING_INTERVAL_MS: '1000',
    LOG_LEVEL: 'info',
    CONNECT_ENV_FILE: '.env'
};

const LIMITS = {
    clientId: { min: 1, max: 128 },
    clientSecret: { min: 1, max: 256 },
    accessToken: { min: 1, max: 512 },
    symbol: { min: 1, max: 32 },
    host: { min: 1, max: 253 }
};

const HOSTNAME_PATTERN =
    /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const DIGITS_PATTERN = /^\d+$/;

const MAX_PING_INTERVAL_MS = 600_000;
const MIN_PING_INTERVAL_MS = 100;

/**
 * True when the value contains a character that has no business being in a
 * credential: any whitespace, any C0 control character, or DEL.
 */
const hasUnsafeCredentialCharacter = (value) => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x20 || code === 0x7f) {
            return true;
        }
    }
    return false;
};

/** Collects problems so one run reports every misconfiguration at once. */
class Problems {
    constructor() {
        this.messages = [];
    }

    add(variable, detail) {
        this.messages.push(`${variable}: ${detail}`);
    }

    get empty() {
        return this.messages.length === 0;
    }
}

const readCredential = (resolver, variable, limits, problems) => {
    const value = resolver(variable);

    if (value === undefined) {
        problems.add(variable, 'is required but was not set');
        return undefined;
    }
    if (value.length < limits.min || value.length > limits.max) {
        problems.add(
            variable,
            `must be between ${limits.min} and ${limits.max} characters (got ${value.length})`
        );
        return undefined;
    }
    if (hasUnsafeCredentialCharacter(value)) {
        problems.add(variable, 'must not contain whitespace or control characters');
        return undefined;
    }

    return value;
};

const readInteger = (resolver, variable, fallback, min, max, problems) => {
    const raw = resolver(variable) ?? fallback;

    if (raw === undefined) {
        problems.add(variable, 'is required but was not set');
        return undefined;
    }
    if (!DIGITS_PATTERN.test(raw)) {
        problems.add(variable, 'must be a whole number');
        return undefined;
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        problems.add(variable, `must be between ${min} and ${max}`);
        return undefined;
    }

    return parsed;
};

/**
 * Build the configuration.
 *
 * @param {object} [options]
 * @param {object} [options.env] environment to read, defaults to `process.env`
 * @param {string|false} [options.envFile] path to the env file, `false` to skip
 * @param {(filePath: string) => Object<string, string>} [options.readFile]
 * @returns {Readonly<object>} frozen configuration
 * @throws {ConfigurationError} listing every problem found
 */
const loadConfig = (options = {}) => {
    const env = options.env || process.env;
    const problems = new Problems();

    const requested =
        options.envFile === undefined
            ? env.CONNECT_ENV_FILE ?? DEFAULTS.CONNECT_ENV_FILE
            : options.envFile;
    const envFilePath = requested === false ? null : path.resolve(requested);
    const fileEnv = requested === false ? {} : (options.readFile || readEnvFile)(envFilePath);

    // The real environment wins; the env file is only a fallback.
    const resolver = (name) => {
        const fromEnv = env[name];
        return fromEnv !== undefined ? fromEnv : fileEnv[name];
    };

    const clientId = readCredential(resolver, 'CONNECT_CLIENT_ID', LIMITS.clientId, problems);
    const clientSecret = readCredential(
        resolver,
        'CONNECT_CLIENT_SECRET',
        LIMITS.clientSecret,
        problems
    );
    const accessToken = readCredential(
        resolver,
        'CONNECT_ACCESS_TOKEN',
        LIMITS.accessToken,
        problems
    );
    const accountId = readInteger(
        resolver,
        'CONNECT_ACCOUNT_ID',
        undefined,
        1,
        Number.MAX_SAFE_INTEGER,
        problems
    );


    const host = resolver('CONNECT_HOST') ?? DEFAULTS.CONNECT_HOST;
    if (host.length > LIMITS.host.max) {
        problems.add('CONNECT_HOST', `must be at most ${LIMITS.host.max} characters`);
    } else if (!HOSTNAME_PATTERN.test(host)) {
        problems.add(
            'CONNECT_HOST',
            'must be a bare hostname (letters, digits, hyphens and dots only; ' +
                'no scheme, port or path)'
        );
    }

    const port = readInteger(
        resolver,
        'CONNECT_PORT',
        DEFAULTS.CONNECT_PORT,
        1,
        65_535,
        problems
    );
    const pingIntervalMs = readInteger(
        resolver,
        'CONNECT_PING_INTERVAL_MS',
        DEFAULTS.CONNECT_PING_INTERVAL_MS,
        MIN_PING_INTERVAL_MS,
        MAX_PING_INTERVAL_MS,
        problems
    );

    const symbol = (resolver('CONNECT_SYMBOL') ?? DEFAULTS.CONNECT_SYMBOL).toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) {
        problems.add(
            'CONNECT_SYMBOL',
            'must be 1-32 characters of letters, digits, dot, underscore or dash'
        );
    }

    const logLevel = (resolver('LOG_LEVEL') ?? DEFAULTS.LOG_LEVEL).toLowerCase();
    if (!LOG_LEVEL_NAMES.includes(logLevel)) {
        problems.add('LOG_LEVEL', `must be one of ${LOG_LEVEL_NAMES.join(', ')}`);
    }

    if (!problems.empty) {
        throw new ConfigurationError(
            `Invalid configuration:\n  - ${problems.messages.join('\n  - ')}\n` +
                'Set these in the environment or in your .env file; see .env.example.'
        );
    }

    return Object.freeze({
        clientId,
        clientSecret,
        accessToken,
        accountId,
        host,
        port,
        symbol,
        pingIntervalMs,
        logLevel,
        envFilePath
    });
};

/** The configuration values that must never appear in a log. */
const configSecrets = (config) => [config.clientSecret, config.accessToken].filter(Boolean);

module.exports = {
    loadConfig,
    configSecrets,
    hasUnsafeCredentialCharacter,
    DEFAULTS,
    LIMITS,
    HOSTNAME_PATTERN,
    SYMBOL_PATTERN,
    MIN_PING_INTERVAL_MS,
    MAX_PING_INTERVAL_MS
};
