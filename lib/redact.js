'use strict';

/**
 * Secret redaction.
 *
 * Two independent defences, because either one alone leaks:
 *
 *  1. Key-based: any object property whose name looks like a credential is
 *     replaced wholesale, so a `{ accessToken: 'x' }` payload can never reach
 *     stdout even if it was never registered.
 *  2. Value-based: every secret the process actually loaded is registered, and
 *     any string that *contains* a registered secret is scrubbed. This is what
 *     catches the dangerous case -- a credential embedded inside a third-party
 *     error message, a URL, or a stack frame -- where no key name is involved.
 *
 * Values shorter than MIN_REDACTED_LENGTH are not string-replaced: a 2-3
 * character "secret" would otherwise shred unrelated log output without
 * protecting anything meaningful.
 */

const REDACTED = '[redacted]';
const MIN_REDACTED_LENGTH = 4;

/**
 * Property names that are always treated as secrets, matched case-insensitively
 * against the whole name. Deliberately broad: over-redacting a field named
 * "token" is cheap, under-redacting it is a credential leak.
 */
const SENSITIVE_KEY_PATTERNS = [
    /secret/i,
    /passw(or)?d/i,
    /^token$/i,
    /token$/i,
    /access.?key/i,
    /api.?key/i,
    /private.?key/i,
    /credential/i,
    /^auth(orization)?$/i,
    /session.?id/i,
    /cookie/i,
    /signature/i
];

const isSensitiveKey = (key) =>
    typeof key === 'string' && SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createRedactor = (initialSecrets = []) => {
    const secrets = new Set();
    let pattern = null;

    /**
     * Longest first, so overlapping secrets redact greedily rather than
     * leaving a fragment of the longer one behind.
     */
    const rebuildPattern = () => {
        pattern =
            secrets.size === 0
                ? null
                : new RegExp(
                    [...secrets]
                        .sort((a, b) => b.length - a.length)
                        .map(escapeRegExp)
                        .join('|'),
                    'g'
                );
    };

    const addSecrets = (values) => {
        let added = false;
        for (const value of Array.isArray(values) ? values : [values]) {
            if (typeof value === 'string' && value.length >= MIN_REDACTED_LENGTH) {
                secrets.add(value);
                added = true;
            }
        }
        if (added) {
            rebuildPattern();
        }
    };

    addSecrets(initialSecrets);

    const redactString = (value) =>
        typeof value === 'string' && pattern ? value.replace(pattern, REDACTED) : value;

    const redactValue = (value, seen = new WeakSet()) => {
        if (typeof value === 'string') {
            return redactString(value);
        }

        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (seen.has(value)) {
            return '[circular]';
        }
        seen.add(value);

        if (value instanceof Error) {
            // Prefer the error's own safe serialiser, then scrub the strings.
            const serialised = typeof value.toJSON === 'function' ? value.toJSON() : value;
            return redactValue({ ...serialised, name: value.name }, seen);
        }

        if (Array.isArray(value)) {
            return value.map((entry) => redactValue(entry, seen));
        }

        if (value instanceof Map) {
            return redactValue(Object.fromEntries(value), seen);
        }

        if (value instanceof Set) {
            return redactValue([...value], seen);
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, seen);
        }
        return output;
    };

    return {
        addSecrets,
        redactString,
        redactValue,
        hasSecrets: () => secrets.size > 0
    };
};

module.exports = { createRedactor, REDACTED, isSensitiveKey, MIN_REDACTED_LENGTH };
