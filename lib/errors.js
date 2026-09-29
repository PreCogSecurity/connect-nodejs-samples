'use strict';

/**
 * Typed error hierarchy for the sample.
 *
 * Every error carries a stable `code` so callers (and log shippers) can branch
 * on failures without string-matching messages, and a `toJSON()` that is safe
 * to serialise into logs. `toJSON()` deliberately never includes the stack or
 * the `cause` chain: both can contain credential material that leaked into an
 * upstream library's error message.
 */
class ConnectSampleError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = new.target.name;
        this.code = options.code || 'ERR_CONNECT_SAMPLE';
        if (options.cause !== undefined) {
            this.cause = options.cause;
        }
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, new.target);
        }
    }

    toJSON() {
        return { name: this.name, code: this.code, message: this.message };
    }
}

/** Invalid, missing or unusable configuration. Always raised before any I/O. */
class ConfigurationError extends ConnectSampleError {
    constructor(message, options = {}) {
        super(message, { code: 'ERR_CONNECT_CONFIG', ...options });
    }
}

/** A parameter failed validation. `field` names the offending input. */
class ValidationError extends ConnectSampleError {
    constructor(message, options = {}) {
        super(message, { code: 'ERR_CONNECT_VALIDATION', ...options });
        this.field = options.field;
    }

    toJSON() {
        return { ...super.toJSON(), field: this.field };
    }
}

/** The transport failed to open, or dropped mid-session. */
class ConnectionError extends ConnectSampleError {
    constructor(message, options = {}) {
        super(message, { code: 'ERR_CONNECT_CONNECTION', ...options });
    }
}

/** The server accepted the transport but rejected the request. */
class ProtocolError extends ConnectSampleError {
    constructor(message, options = {}) {
        super(message, { code: 'ERR_CONNECT_PROTOCOL', ...options });
        this.payloadType = options.payloadType;
    }

    toJSON() {
        return { ...super.toJSON(), payloadType: this.payloadType };
    }
}

module.exports = {
    ConnectSampleError,
    ConfigurationError,
    ValidationError,
    ConnectionError,
    ProtocolError
};
