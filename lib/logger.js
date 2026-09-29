'use strict';

const { createRedactor } = require('./redact');

/**
 * Minimal structured logger.
 *
 * The previous sample wrote bare `console.log` lines, which makes output
 * unparseable, unfilterable and impossible to redact. This emits one JSON
 * object per line, which is what log shippers and `jq` expect, and routes every
 * value through the redactor before it reaches a stream.
 *
 * The logger never throws: a broken stdout must not take down a trading
 * session that is otherwise healthy.
 */

const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100
};

const LOG_LEVEL_NAMES = Object.keys(LEVELS);

/**
 * @param {boolean} includeStack stacks are debug-only. A stack's first line is
 *   the error message, and an upstream message can carry a URL or token, so
 *   emitting stacks at error level would undo the redaction of `message`.
 */
const normaliseError = (error, includeStack) => {
    if (!(error instanceof Error)) {
        return error;
    }
    const serialised = typeof error.toJSON === 'function' ? error.toJSON() : null;
    return {
        name: error.name,
        code: error.code,
        message: error.message,
        ...(serialised || {}),
        ...(includeStack && error.stack ? { stack: error.stack } : {})
    };
};

const normaliseFields = (fields, includeStack) => {
    const output = {};
    for (const [key, value] of Object.entries(fields)) {
        output[key] = value instanceof Error ? normaliseError(value, includeStack) : value;
    }
    return output;
};

/**
 * @param {object} [options]
 * @param {string} [options.level] one of `debug|info|warn|error|silent`
 * @param {NodeJS.WritableStream} [options.stream]
 * @param {object} [options.redactor] a redactor from ./redact
 * @param {() => string} [options.now] timestamp source, injectable for tests
 */
const createLogger = (options = {}) => {
    const redactor = options.redactor || createRedactor();
    const stream = options.stream || process.stdout;
    const now = options.now || (() => new Date().toISOString());
    const threshold = LEVELS[options.level] ?? LEVELS.info;

    const write = (level, message, fields) => {
        if (LEVELS[level] < threshold) {
            return;
        }

        const record = {
            ts: now(),
            level,
            msg: redactor.redactString(String(message)),
            ...redactor.redactValue(normaliseFields(fields, level === 'debug'))
        };

        let line;
        try {
            line = JSON.stringify(record);
        } catch {
            // A field held a BigInt or a circular structure. Never lose the
            // event because of it.
            line = JSON.stringify({
                ts: record.ts,
                level: 'error',
                msg: 'log record could not be serialised'
            });
        }

        try {
            stream.write(`${line}\n`);
        } catch {
            // Swallow stream errors deliberately: telemetry must not break
            // the process it is describing.
        }
    };

    return {
        level: options.level || 'info',
        addSecrets: redactor.addSecrets,
        redactValue: redactor.redactValue,
        debug: (message, fields = {}) => write('debug', message, fields),
        info: (message, fields = {}) => write('info', message, fields),
        warn: (message, fields = {}) => write('warn', message, fields),
        error: (message, fields = {}) => write('error', message, fields)
    };
};

module.exports = { createLogger, LEVELS, LOG_LEVEL_NAMES };
