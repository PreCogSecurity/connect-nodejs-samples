'use strict';

const { ValidationError } = require('./errors');
const {
    hasUnsafeCredentialCharacter,
    LIMITS,
    SYMBOL_PATTERN,
    MIN_PING_INTERVAL_MS,
    MAX_PING_INTERVAL_MS
} = require('./config');

const INTEGER_PATTERN = /^\d+$/;

/**
 * Shared parameter checks for the request builders.
 *
 * These run on every outbound command. They are cheap, they turn a malformed
 * request into a clear local error instead of an opaque server-side rejection,
 * and -- more importantly -- they stop the process from putting an
 * undefined/NaN value on the wire, which protobuf would otherwise happily
 * encode as a default.
 */

const requireCredential = (value, field, limits) => {
    if (typeof value !== 'string' || value.length === 0) {
        throw new ValidationError(`${field} is required and must be a non-empty string.`, {
            field
        });
    }
    if (value.length > limits.max) {
        throw new ValidationError(`${field} must be at most ${limits.max} characters.`, { field });
    }
    if (hasUnsafeCredentialCharacter(value)) {
        throw new ValidationError(
            `${field} must not contain whitespace or control characters.`,
            { field }
        );
    }
    return value;
};

const requireAccountId = (value, field = 'accountId') => {
    // Strings must be plain integer literals. `Number()` would happily accept
    // '1e3', '0x10' and '  12  ', all of which are copy/paste accidents that
    // would put a surprising account id on the wire.
    const parsed =
        typeof value === 'string' ? (INTEGER_PATTERN.test(value) ? Number(value) : NaN) : value;

    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new ValidationError(
            `${field} must be a positive whole number (received ${JSON.stringify(value)}).`,
            { field }
        );
    }
    return parsed;
};

const requireSymbol = (value, field = 'symbol') => {
    if (typeof value !== 'string' || !SYMBOL_PATTERN.test(value)) {
        throw new ValidationError(
            `${field} must be 1-32 characters of letters, digits, dot, underscore or dash.`,
            { field }
        );
    }
    return value.toUpperCase();
};

const requireInterval = (value, field = 'interval') => {
    if (
        !Number.isSafeInteger(value) ||
        value < MIN_PING_INTERVAL_MS ||
        value > MAX_PING_INTERVAL_MS
    ) {
        throw new ValidationError(
            `${field} must be a whole number of milliseconds between ` +
                `${MIN_PING_INTERVAL_MS} and ${MAX_PING_INTERVAL_MS}.`,
            { field }
        );
    }
    return value;
};

/**
 * Resolve a protobuf message name to its payload type, failing loudly if the
 * protocol was not loaded. Without this, an unloaded protocol yields
 * `undefined`, which protobuf encodes as payload type 0 -- a silently
 * malformed frame instead of an actionable error.
 */
const requirePayloadType = (protocol, messageName) => {
    const payloadType = protocol && protocol.getPayloadTypeByName
        ? protocol.getPayloadTypeByName(messageName)
        : undefined;

    if (typeof payloadType !== 'number') {
        throw new ValidationError(
            `Unknown or unloaded protobuf message '${messageName}'. ` +
                'Call protocol.load() and protocol.build() before sending commands.',
            { field: messageName }
        );
    }
    return payloadType;
};

module.exports = {
    requireCredential,
    requireAccountId,
    requireSymbol,
    requireInterval,
    requirePayloadType,
    credentialLimits: { clientId: LIMITS.clientId, clientSecret: LIMITS.clientSecret }
};
