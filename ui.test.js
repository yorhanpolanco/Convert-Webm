'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { stripVTControlCharacters } = require('node:util');

const {
  createUI,
  streamCaps,
  isUnicodeSupported,
  formatBytes,
  formatClock,
  describeSizeChange,
  computeEta,
  renderBar,
  renderProgressLine,
  SYMBOLS,
} = require('./ui');
const { ConversionError, classifyError, interrupted } = require('./errors');

function fakeStream({ tty = false, columns = 80 } = {}) {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  stream.isTTY = tty;
  if (tty) {
    stream.columns = columns;
    stream.hasColors = () => true;
  }
  stream.output = () => chunks.join('');
  return stream;
}

describe('formatters', () => {
  test('formatBytes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(999), '999 B');
    assert.equal(formatBytes(1500), '1.5 KB');
    assert.equal(formatBytes(84_200_000), '84.2 MB');
    assert.equal(formatBytes(250_000_000), '250 MB');
    assert.equal(formatBytes(NaN), 'desconocido');
    assert.equal(formatBytes(-1), 'desconocido');
  });

  test('formatClock', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(65.4), '01:05');
    assert.equal(formatClock(3725), '1:02:05');
    assert.equal(formatClock(-3), '00:00');
  });

  test('describeSizeChange reports smaller, larger and equal', () => {
    assert.deepEqual(describeSizeChange(1000, 250), { text: '75.0% menor', larger: false });
    assert.deepEqual(describeSizeChange(1000, 1200), { text: '20.0% mayor', larger: true });
    assert.deepEqual(describeSizeChange(1000, 1000), { text: 'sin cambios', larger: false });
  });

  test('describeSizeChange returns null when the ratio is not meaningful', () => {
    assert.equal(describeSizeChange(0, 100), null);
    assert.equal(describeSizeChange(NaN, 100), null);
  });
});

describe('computeEta', () => {
  test('is withheld until there is enough data', () => {
    assert.equal(computeEta(null, 10), null);
    assert.equal(computeEta(0.01, 10), null);
    assert.equal(computeEta(0.5, 1), null);
    assert.equal(computeEta(1, 10), null);
  });

  test('extrapolates from elapsed time and ratio', () => {
    assert.equal(computeEta(0.25, 10), 30);
    assert.equal(computeEta(0.5, 8), 8);
  });
});

describe('renderProgressLine', () => {
  const symbols = SYMBOLS.ascii;

  test('shows bar, percentage and elapsed time', () => {
    const line = renderProgressLine({ label: 'Convirtiendo', ratio: 0.5, elapsed: 2, columns: 80, symbols });
    assert.match(line, /\[#+-+\]/);
    assert.match(line, /50%/);
    assert.match(line, /00:02/);
    assert.doesNotMatch(line, /ETA/);
  });

  test('includes ETA only when reliable', () => {
    const line = renderProgressLine({ label: 'Convirtiendo', ratio: 0.25, elapsed: 10, columns: 80, symbols });
    assert.match(line, /ETA 00:30/);
  });

  test('never exceeds the terminal width', () => {
    for (const columns of [20, 30, 40, 60, 120]) {
      const line = renderProgressLine({ label: 'Convirtiendo', ratio: 0.42, elapsed: 125, columns, symbols });
      assert.ok(line.length <= columns - 1, `width ${columns}: got ${line.length}`);
    }
  });

  test('drops the bar on narrow terminals', () => {
    const line = renderProgressLine({ label: 'Convirtiendo', ratio: 0.42, elapsed: 5, columns: 38, symbols });
    assert.doesNotMatch(line, /\[/);
    assert.match(line, /42%/);
  });

  test('indeterminate progress shows elapsed time without a percentage', () => {
    const line = renderProgressLine({ label: 'Convirtiendo', ratio: null, elapsed: 7, columns: 80, symbols });
    assert.match(line, /00:07 transcurrido/);
    assert.doesNotMatch(line, /%/);
  });

  test('renderBar fills proportionally and clamps', () => {
    assert.equal(renderBar(0.5, 10, SYMBOLS.ascii), '#####-----');
    assert.equal(renderBar(2, 4, SYMBOLS.ascii), '####');
    assert.equal(renderBar(-1, 4, SYMBOLS.ascii), '----');
  });
});

describe('terminal capability detection', () => {
  test('no color and ASCII when output is not a TTY', () => {
    const caps = streamCaps(fakeStream({ tty: false }), { env: { TERM: 'xterm-256color' }, platform: 'darwin' });
    assert.deepEqual(caps, { tty: false, color: false, unicode: false });
  });

  test('color and unicode on a capable TTY', () => {
    const caps = streamCaps(fakeStream({ tty: true }), { env: { TERM: 'xterm-256color' }, platform: 'darwin' });
    assert.deepEqual(caps, { tty: true, color: true, unicode: true });
  });

  test('NO_COLOR and --no-color disable color even on a TTY', () => {
    const tty = fakeStream({ tty: true });
    assert.equal(streamCaps(tty, { env: { NO_COLOR: '1' }, platform: 'darwin' }).color, false);
    assert.equal(streamCaps(tty, { env: {}, platform: 'darwin', noColor: true }).color, false);
  });

  test('TERM=dumb disables color', () => {
    assert.equal(streamCaps(fakeStream({ tty: true }), { env: { TERM: 'dumb' }, platform: 'darwin' }).color, false);
  });

  test('FORCE_COLOR enables color on a pipe', () => {
    assert.equal(streamCaps(fakeStream(), { env: { FORCE_COLOR: '1' }, platform: 'darwin' }).color, true);
  });

  test('Windows unicode support only on known modern terminals', () => {
    assert.equal(isUnicodeSupported({}, 'win32'), false);
    assert.equal(isUnicodeSupported({ WT_SESSION: 'abc' }, 'win32'), true);
    assert.equal(isUnicodeSupported({ TERM_PROGRAM: 'vscode' }, 'win32'), true);
    assert.equal(isUnicodeSupported({ TERM: 'linux' }, 'linux'), false);
  });
});

describe('ProgressReporter', () => {
  function setup({ tty, columns = 80 }) {
    const stdout = fakeStream({ tty, columns });
    let time = 0;
    const ui = createUI({
      stdout,
      stderr: fakeStream({ tty }),
      env: { TERM: 'xterm-256color', NO_COLOR: '1' },
      platform: 'darwin',
      now: () => time,
    });
    const progress = ui.createProgress({ label: 'Convirtiendo', determinate: true });
    return { stdout, progress, advance: ms => (time += ms) };
  }

  test('TTY: redraws a single line with carriage returns and throttles updates', () => {
    const { stdout, progress, advance } = setup({ tty: true });
    progress.start();
    advance(10);
    progress.update(0.1);
    advance(10);
    progress.update(0.2);
    advance(500);
    progress.update(0.3);
    progress.finish();
    const out = stdout.output();
    assert.doesNotMatch(out.replace(/\n$/, ''), /\n/);
    assert.equal(out.split('\r').length - 1, 3);
    assert.match(stripVTControlCharacters(out), /100%/);
    assert.ok(out.endsWith('\n'));
  });

  test('TTY: progress never goes backwards', () => {
    const { stdout, progress, advance } = setup({ tty: true });
    progress.start();
    advance(500);
    progress.update(0.6);
    advance(500);
    progress.update(0.4);
    const percentages = [...stdout.output().matchAll(/(\d+)%/g)].map(m => Number(m[1]));
    assert.deepEqual(percentages, [...percentages].sort((a, b) => a - b));
    assert.equal(percentages.at(-1), 60);
  });

  test('TTY: abort ends the line so following messages start clean', () => {
    const { stdout, progress } = setup({ tty: true });
    progress.start();
    progress.abort();
    assert.ok(stdout.output().endsWith('\n'));
    progress.abort();
    assert.equal(stdout.output().split('\n').length, 2);
  });

  test('non-TTY: prints plain lines per 10% milestone, no carriage returns or ANSI', () => {
    const { stdout, progress, advance } = setup({ tty: false });
    progress.start();
    for (const ratio of [0.04, 0.12, 0.15, 0.31, 0.99, 1]) {
      advance(100);
      progress.update(ratio);
    }
    progress.finish();
    const out = stdout.output();
    assert.doesNotMatch(out, /[\r\x1b]/);
    const milestones = [...out.matchAll(/Convirtiendo (\d+)%/g)].map(m => Number(m[1]));
    assert.deepEqual(milestones, [10, 30, 90]);
  });
});

describe('createUI reports', () => {
  function plainUI() {
    const stdout = fakeStream();
    const stderr = fakeStream();
    const ui = createUI({ stdout, stderr, env: {}, platform: 'darwin' });
    return { ui, stdout, stderr };
  }

  test('success report shows output path, sizes, reduction and time', () => {
    const { ui, stdout } = plainUI();
    ui.success({
      elapsed: 65,
      outputPath: '/videos/clip.webm',
      inputName: 'clip.mov',
      inputSize: 84_200_000,
      outputSize: 21_400_000,
    });
    const out = stdout.output();
    assert.match(out, /Conversión completada/);
    assert.match(out, /clip\.mov/);
    assert.match(out, /\/videos\/clip\.webm/);
    assert.match(out, /84\.2 MB -> 21\.4 MB/);
    assert.match(out, /74\.6% menor/);
    assert.match(out, /01:05/);
    assert.doesNotMatch(out, /\x1b/);
  });

  test('failure report is actionable and hides FFmpeg output unless --verbose', () => {
    const { ui, stderr } = plainUI();
    const error = new ConversionError('FFMPEG_FAILED', 'FFmpeg falló.', {
      file: '/v/a.mp4',
      hint: 'Haz algo.',
      detail: 'boom',
      stderr: 'line1\nline2\nboom\n',
    });
    ui.failure(error);
    const out = stderr.output();
    assert.match(out, /Problema\s+FFmpeg falló\./);
    assert.match(out, /Archivo\s+\/v\/a\.mp4/);
    assert.match(out, /Sugerencia\s+Haz algo\./);
    assert.match(out, /Detalle\s+boom/);
    assert.match(out, /--verbose/);
    assert.doesNotMatch(out, /line1/);
  });

  test('verbose failure includes the full FFmpeg output', () => {
    const stderr = fakeStream();
    const ui = createUI({ stdout: fakeStream(), stderr, env: {}, platform: 'darwin', verbose: true });
    ui.failure(new ConversionError('FFMPEG_FAILED', 'FFmpeg falló.', { stderr: 'line1\nline2\n' }));
    assert.match(stderr.output(), /line1\nline2/);
  });

  test('cancellation is reported as cancelled, not as an error', () => {
    const { ui, stderr } = plainUI();
    ui.failure(interrupted());
    const out = stderr.output();
    assert.match(out, /Conversión cancelada/);
    assert.doesNotMatch(out, /No se pudo completar/);
  });

  test('debug messages only appear in verbose mode', () => {
    const quiet = plainUI();
    quiet.ui.debug('secreto');
    assert.equal(quiet.stderr.output(), '');
    const stderr = fakeStream();
    createUI({ stdout: fakeStream(), stderr, env: {}, platform: 'darwin', verbose: true }).debug('detalle');
    assert.match(stderr.output(), /\[debug\] detalle/);
  });
});

describe('classifyError', () => {
  const cases = [
    ['missing binary', { message: 'Cannot find ffmpeg' }, 'FFMPEG_MISSING'],
    ['spawn ENOENT', { message: 'x', code: 'ENOENT', syscall: 'spawn /bin/ffmpeg' }, 'FFMPEG_MISSING'],
    ['spawn EACCES', { message: 'x', code: 'EACCES', syscall: 'spawn /bin/ffmpeg' }, 'FFMPEG_NOT_EXECUTABLE'],
    ['disk full (stderr)', { message: 'x', ffmpegStderr: 'av_write_frame: No space left on device' }, 'DISK_FULL'],
    ['disk full (errno)', { message: 'x', code: 'ENOSPC' }, 'DISK_FULL'],
    ['permission denied (stderr)', { message: 'x', ffmpegStderr: 'out.webm: Permission denied' }, 'PERMISSION_DENIED'],
    ['permission denied (errno)', { message: 'x', code: 'EPERM' }, 'PERMISSION_DENIED'],
    ['corrupt file', { message: 'ffprobe exited with code 1\nmoov atom not found' }, 'INVALID_MEDIA'],
    ['invalid data', { message: 'x', ffmpegStderr: 'Invalid data found when processing input' }, 'INVALID_MEDIA'],
    ['SIGINT seen by ffmpeg', { message: 'x', ffmpegStderr: 'Exiting normally, received signal 2.' }, 'INTERRUPTED'],
    ['anything else', { message: 'x', ffmpegStderr: 'Unrecognized option\nConversion failed!' }, 'FFMPEG_FAILED'],
  ];

  for (const [name, input, code] of cases) {
    test(`${name} -> ${code}`, () => {
      assert.equal(classifyError(Object.assign(new Error(input.message), input), { file: '/f.mp4' }).code, code);
    });
  }

  test('keeps an already classified error untouched', () => {
    const original = new ConversionError('OUTPUT_EXISTS', 'ya existe');
    assert.equal(classifyError(original), original);
  });

  test('extracts a short detail instead of the full FFmpeg dump', () => {
    const err = Object.assign(new Error('x'), {
      ffmpegStderr: 'ffmpeg version 4.4\nframe=  10 fps=0.0\nUnrecognized option "foo".\nConversion failed!\n',
    });
    const classified = classifyError(err);
    assert.equal(classified.detail, 'Unrecognized option "foo".');
    assert.ok(classified.stderr.includes('ffmpeg version'));
  });
});
