'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseEnvFile, readEnvFile, MAX_ENV_FILE_BYTES } = require('../lib/env_file');
const { ConfigurationError } = require('../lib/errors');

/** Builds an env line whose value embeds a specific control character. */
const valueWith = (charCode) => `A="bad${String.fromCharCode(charCode)}value"`;

test('parses simple assignments', () => {
    const parsed = parseEnvFile('CONNECT_CLIENT_ID=abc\nCONNECT_PORT=5032');
    assert.deepEqual(parsed, { CONNECT_CLIENT_ID: 'abc', CONNECT_PORT: '5032' });
});

test('ignores blank lines and comments', () => {
    const parsed = parseEnvFile(
        ['# a comment', '', '   ', '   # indented comment', 'A=1', ''].join('\n')
    );
    assert.deepEqual(parsed, { A: '1' });
});

test('handles CRLF line endings', () => {
    assert.deepEqual(parseEnvFile('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('strips surrounding whitespace around key and value', () => {
    assert.deepEqual(parseEnvFile('  A  =  1  '), { A: '1' });
});

test('supports the export prefix', () => {
    assert.deepEqual(parseEnvFile('export A=1'), { A: '1' });
});

test('an empty value is preserved, not dropped', () => {
    assert.deepEqual(parseEnvFile('A='), { A: '' });
});

test('unquoted values keep hashes and equals signs verbatim', () => {
    // dotenv-style inline comment stripping corrupts values like these.
    assert.deepEqual(parseEnvFile('A=abc#def=ghi'), { A: 'abc#def=ghi' });
});

test('double quotes are stripped and escapes resolved', () => {
    assert.deepEqual(parseEnvFile('A="line1\\nline2"'), { A: 'line1\\nline2' });
    assert.deepEqual(parseEnvFile('A="say \\"hi\\""'), { A: 'say "hi"' });
    assert.deepEqual(parseEnvFile('A="a\\\\b"'), { A: 'a\\b' });
});

test('single quotes are fully literal', () => {
    assert.deepEqual(parseEnvFile("A='no \\n escapes here'"), { A: 'no \\n escapes here' });
    assert.deepEqual(parseEnvFile("A='say \"hi\"'"), { A: 'say "hi"' });
});

test('there is no variable interpolation', () => {
    // The core reason this reader exists instead of a dotenv dependency: a
    // value can never pull another environment variable into the process.
    assert.deepEqual(parseEnvFile('A=${SECRET}\nB=$SECRET'), {
        A: '${SECRET}',
        B: '$SECRET'
    });
});

test('a missing equals sign is rejected with the line number', () => {
    assert.throws(
        () => parseEnvFile('A=1\nJUST_A_NAME\n', 'my.env'),
        (error) => {
            assert.ok(error instanceof ConfigurationError);
            assert.match(error.message, /my\.env:2/);
            return true;
        }
    );
});

test('an invalid variable name is rejected', () => {
    for (const bad of ['1BAD=1', 'has-dash=1', 'has space=1', '=novalue']) {
        assert.throws(() => parseEnvFile(bad), ConfigurationError, `${bad} should be rejected`);
    }
});

test('the offending value is never echoed in the error message', () => {
    assert.throws(
        () => parseEnvFile(valueWith(0x0a)),
        (error) => {
            assert.equal(error.message.includes(String.fromCharCode(0x0a)), false);
            assert.equal(error.message.includes('value"'), false);
            return true;
        }
    );
});

test('control characters in values are rejected', () => {
    for (const code of [0x00, 0x08, 0x1b, 0x7f]) {
        assert.throws(
            () => parseEnvFile(valueWith(code)),
            ConfigurationError,
            `charCode ${code} should be rejected`
        );
    }
});

test('a tab is allowed inside a value', () => {
    assert.deepEqual(parseEnvFile(`A="a${String.fromCharCode(0x09)}b"`), {
        A: `a${String.fromCharCode(0x09)}b`
    });
});

test('duplicate keys are rejected rather than silently last-wins', () => {
    assert.throws(
        () => parseEnvFile('A=1\nA=2'),
        (error) => {
            assert.match(error.message, /defined more than once/);
            return true;
        }
    );
});

test('non-string input is rejected', () => {
    assert.throws(() => parseEnvFile(undefined), ConfigurationError);
    assert.throws(() => parseEnvFile(123), ConfigurationError);
});

test('readEnvFile returns an empty object when the file is absent', () => {
    const missing = path.join(os.tmpdir(), `definitely-missing-${process.pid}.env`);
    assert.deepEqual(readEnvFile(missing), {});
});

test('readEnvFile rejects a directory', () => {
    assert.throws(() => readEnvFile(os.tmpdir()), ConfigurationError);
});

test('readEnvFile rejects an oversized file', () => {
    const file = path.join(os.tmpdir(), `oversized-${process.pid}.env`);
    fs.writeFileSync(file, `A=${'x'.repeat(MAX_ENV_FILE_BYTES + 1)}`);
    try {
        assert.throws(() => readEnvFile(file), /over the/);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('readEnvFile round-trips a real file', () => {
    const file = path.join(os.tmpdir(), `roundtrip-${process.pid}.env`);
    fs.writeFileSync(file, 'CONNECT_CLIENT_ID=abc\nCONNECT_CLIENT_SECRET="s e c"\n');
    try {
        assert.deepEqual(readEnvFile(file), {
            CONNECT_CLIENT_ID: 'abc',
            CONNECT_CLIENT_SECRET: 's e c'
        });
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('readEnvFile surfaces parse errors verbatim', () => {
    const file = path.join(os.tmpdir(), `malformed-${process.pid}.env`);
    fs.writeFileSync(file, 'NOT_AN_ASSIGNMENT\n');
    try {
        assert.throws(() => readEnvFile(file), ConfigurationError);
    } finally {
        fs.rmSync(file, { force: true });
    }
});
