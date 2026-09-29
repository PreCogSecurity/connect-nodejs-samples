'use strict';

const fs = require('fs');
const { ConfigurationError } = require('./errors');

/**
 * A deliberately small, strict `.env` reader.
 *
 * This exists instead of a dotenv dependency because the requirements here are
 * narrow and the security posture is stronger without one:
 *
 *  - No interpolation or `${...}` expansion. Values are taken literally, so a
 *    value read out of a `.env` file can never be used to pull another
 *    environment variable into the process.
 *  - No mutation of `process.env`. Parsing is a pure function of file content,
 *    which is what makes it testable and what keeps "an already exported shell
 *    variable wins" enforceable by the caller.
 *  - Bounded input: a size cap, a strict key grammar, and no control characters
 *    in values.
 *
 * As with any dotenv reader, a `.env` file is a plaintext secret on disk and
 * must never be committed. `.gitignore` enforces that; see SECURITY.md.
 */

const MAX_ENV_FILE_BYTES = 64 * 1024;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NON_ASCII_PATTERN = /[^\x20-\x7e]/g;

/**
 * Reject C0 control characters and DEL. Tab is allowed because it is the one
 * control character that legitimately shows up inside a quoted value.
 */
const hasControlCharacters = (value) => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
            return true;
        }
    }
    return false;
};

const stripQuotes = (raw) => {
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
        // Single quotes are literal: no escape processing at all.
        return raw.slice(1, -1);
    }
    return raw;
};

/**
 * Parse `.env` text into a plain object.
 *
 * @param {string} text raw file contents
 * @param {string} [source] path used in error messages
 * @returns {Object<string, string>}
 * @throws {ConfigurationError} on malformed input; the offending value is never
 *   included in the message.
 */
const parseEnvFile = (text, source = '.env') => {
    if (typeof text !== 'string') {
        throw new ConfigurationError(`${source}: expected the env file to be text.`);
    }

    const parsed = {};

    text.split(/\r?\n/).forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const line = rawLine.trim();

        if (line === '' || line.startsWith('#')) {
            return;
        }

        // Tolerate `export KEY=value`, which is common in shell-derived files.
        const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
        const separator = body.indexOf('=');

        if (separator === -1) {
            throw new ConfigurationError(
                `${source}:${lineNumber}: expected KEY=VALUE, found a line with no '='.`
            );
        }

        const key = body.slice(0, separator).trim();
        const rawValue = body.slice(separator + 1).trim();

        if (!KEY_PATTERN.test(key)) {
            throw new ConfigurationError(
                `${source}:${lineNumber}: ` +
                    `'${key.replace(NON_ASCII_PATTERN, '')}' is not a valid variable name ` +
                    '(expected letters, digits and underscores, not starting with a digit).'
            );
        }

        const value = stripQuotes(rawValue);

        if (hasControlCharacters(value)) {
            throw new ConfigurationError(
                `${source}:${lineNumber}: value for '${key}' contains control characters.`
            );
        }

        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            throw new ConfigurationError(
                `${source}:${lineNumber}: '${key}' is defined more than once.`
            );
        }

        parsed[key] = value;
    });

    return parsed;
};

/**
 * Read and parse an env file from disk.
 *
 * @param {string} path absolute or cwd-relative path
 * @returns {Object<string, string>} empty object when the file does not exist
 * @throws {ConfigurationError} when the path exists but is not a readable,
 *   regular, reasonably sized file
 */
const readEnvFile = (path) => {
    let stats;
    try {
        stats = fs.statSync(path);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw new ConfigurationError(`Could not read the env file at '${path}'.`, {
            cause: error.code
        });
    }

    if (!stats.isFile()) {
        throw new ConfigurationError(`The env file path '${path}' is not a regular file.`);
    }

    if (stats.size > MAX_ENV_FILE_BYTES) {
        throw new ConfigurationError(
            `The env file at '${path}' is ${stats.size} bytes, over the ` +
                `${MAX_ENV_FILE_BYTES} byte limit.`
        );
    }

    try {
        return parseEnvFile(fs.readFileSync(path, 'utf8'), path);
    } catch (error) {
        if (error instanceof ConfigurationError) {
            throw error;
        }
        throw new ConfigurationError(`Could not read the env file at '${path}'.`, {
            cause: error.code
        });
    }
};

module.exports = { parseEnvFile, readEnvFile, MAX_ENV_FILE_BYTES };
