'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveDesktopPath, validateInput, buildOutputPath } = require('./convert');

// Temp directory for files created during tests
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-test-'));

function tmpFile(name) {
  return path.join(TMP, name);
}

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveDesktopPath
// ---------------------------------------------------------------------------

describe('resolveDesktopPath', () => {
  test('returns a non-empty string', () => {
    const result = resolveDesktopPath();
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  test('path contains "Desktop" or "Escritorio" segment', () => {
    const result = resolveDesktopPath();
    const normalised = result.replace(/\\/g, '/');
    assert.ok(
      normalised.includes('/Desktop') || normalised.includes('/Escritorio'),
      `Expected a desktop path, got: ${result}`
    );
  });
});

// ---------------------------------------------------------------------------
// validateInput
// ---------------------------------------------------------------------------

describe('validateInput', () => {
  test('accepts .mp4 file that exists', () => {
    const file = tmpFile('sample.mp4');
    fs.writeFileSync(file, '');
    assert.doesNotThrow(() => validateInput(file));
  });

  test('accepts .mov file that exists', () => {
    const file = tmpFile('sample.mov');
    fs.writeFileSync(file, '');
    assert.doesNotThrow(() => validateInput(file));
  });

  test('accepts .MP4 uppercase extension', () => {
    const file = tmpFile('sample.MP4');
    fs.writeFileSync(file, '');
    assert.doesNotThrow(() => validateInput(file));
  });

  test('rejects .avi extension', () => {
    const file = tmpFile('sample.avi');
    fs.writeFileSync(file, '');
    assert.throws(() => validateInput(file), /Unsupported format/);
  });

  test('rejects .mkv extension', () => {
    const file = tmpFile('sample.mkv');
    fs.writeFileSync(file, '');
    assert.throws(() => validateInput(file), /Unsupported format/);
  });

  test('rejects file that does not exist', () => {
    assert.throws(
      () => validateInput(tmpFile('ghost.mp4')),
      /Input file not found/
    );
  });

  test('error message contains the unsupported extension', () => {
    const file = tmpFile('bad.wmv');
    fs.writeFileSync(file, '');
    assert.throws(
      () => validateInput(file),
      err => {
        assert.ok(err.message.includes('.wmv'), `Expected ".wmv" in: ${err.message}`);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// buildOutputPath
// ---------------------------------------------------------------------------

describe('buildOutputPath', () => {
  test('replaces .mp4 extension with .webm', () => {
    const input = tmpFile('clip.mp4');
    fs.writeFileSync(input, '');
    const output = buildOutputPath(input);
    assert.equal(path.extname(output), '.webm');
    assert.equal(path.basename(output), 'clip.webm');
  });

  test('replaces .mov extension with .webm', () => {
    const input = tmpFile('clip.mov');
    fs.writeFileSync(input, '');
    const output = buildOutputPath(input);
    assert.equal(path.extname(output), '.webm');
    assert.equal(path.basename(output), 'clip.webm');
  });

  test('output lives in the same directory as input', () => {
    const input = tmpFile('video.mp4');
    fs.writeFileSync(input, '');
    const output = buildOutputPath(input);
    assert.equal(path.dirname(output), TMP);
  });

  test('throws if output file already exists', () => {
    const input = tmpFile('existing.mp4');
    const output = tmpFile('existing.webm');
    fs.writeFileSync(input, '');
    fs.writeFileSync(output, '');
    assert.throws(() => buildOutputPath(input), /Output already exists/);
  });

  test('handles filenames with spaces', () => {
    const input = tmpFile('my vacation clip.mp4');
    fs.writeFileSync(input, '');
    const output = buildOutputPath(input);
    assert.equal(path.basename(output), 'my vacation clip.webm');
  });

  test('handles filenames with Unicode characters', () => {
    const input = tmpFile('vacaciones_2024_España.mp4');
    fs.writeFileSync(input, '');
    const output = buildOutputPath(input);
    assert.equal(path.basename(output), 'vacaciones_2024_España.webm');
  });
});
