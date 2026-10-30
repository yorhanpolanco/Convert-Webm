'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pkg = require('./package.json');
const { resolveBinaries, runConversion, probeMedia } = require('./convert');

const CLI = path.join(__dirname, 'convert.js');
const { ffmpeg: FFMPEG, ffprobe: FFPROBE } = resolveBinaries();
const isWindows = process.platform === 'win32';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-cli-'));
const WORKDIR = path.join(ROOT, 'work dir');

const inWork = name => path.join(WORKDIR, name);
const exists = name => fs.existsSync(inWork(name));

function makeVideo(file, { seconds = 2, size = '320x240', audio = true } = {}) {
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=30`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  args.push(...(audio ? ['-c:a', 'aac', '-shortest'] : ['-an']));
  args.push(file);
  const result = spawnSync(FFMPEG, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `fixture generation failed: ${result.stderr}`);
}

function runCli(args, { env = {}, cwd = WORKDIR } = {}) {
  const baseEnv = { ...process.env, ...env };
  delete baseEnv.NO_COLOR;
  delete baseEnv.FORCE_COLOR;
  if (env.NO_COLOR) baseEnv.NO_COLOR = env.NO_COLOR;
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: baseEnv, cwd });
}

function streamsOf(file) {
  const result = spawnSync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).streams;
}

function assertPlayable(file) {
  const result = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `output is not decodable: ${result.stderr}`);
  assert.equal(result.stderr.trim(), '');
}

function assertNoLeftovers(base) {
  assert.equal(exists(`${base}.webm`), false, `${base}.webm should not exist`);
  assert.equal(exists(`${base}.webm.part`), false, `${base}.webm.part should not exist`);
}

before(() => {
  fs.mkdirSync(WORKDIR, { recursive: true });
  makeVideo(inWork('clip.mp4'));
  makeVideo(inWork('clip2.mov'));
  makeVideo(inWork('silent.mp4'), { audio: false });
  makeVideo(inWork('mi video ñandú (1).mp4'));
  makeVideo(inWork('exists.mp4'));
  fs.writeFileSync(inWork('exists.webm'), 'precious');
  fs.writeFileSync(inWork('broken.mp4'), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 251)));
  fs.writeFileSync(inWork('movie.avi'), 'x');
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('successful conversions', () => {
  test('MP4 with audio -> playable WebM (VP9 + Opus)', () => {
    const result = runCli(['clip.mp4']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Conversión completada/);
    assert.match(result.stdout, /MP4 -> WebM/);
    const codecs = streamsOf(inWork('clip.webm')).map(s => `${s.codec_type}:${s.codec_name}`).sort();
    assert.deepEqual(codecs, ['audio:opus', 'video:vp9']);
    assertPlayable(inWork('clip.webm'));
    assert.equal(exists('clip.webm.part'), false);
    assert.equal(fs.existsSync(inWork('clip.mp4')), true, 'source must be preserved');
  });

  test('MOV with audio -> playable WebM (VP9 + Opus)', () => {
    const result = runCli(['clip2.mov']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MOV -> WebM/);
    const codecs = streamsOf(inWork('clip2.webm')).map(s => `${s.codec_type}:${s.codec_name}`).sort();
    assert.deepEqual(codecs, ['audio:opus', 'video:vp9']);
    assertPlayable(inWork('clip2.webm'));
  });

  test('video without audio -> WebM with video only', () => {
    const result = runCli(['silent.mp4']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sin audio/);
    assert.deepEqual(streamsOf(inWork('silent.webm')).map(s => s.codec_type), ['video']);
    assertPlayable(inWork('silent.webm'));
  });

  test('path with spaces, accents and parentheses', () => {
    const result = runCli(['mi video ñandú (1).mp4']);
    assert.equal(result.status, 0, result.stderr);
    assertPlayable(inWork('mi video ñandú (1).webm'));
  });

  test('works from any directory: absolute path, output next to the source', () => {
    const elsewhere = fs.mkdtempSync(path.join(ROOT, 'elsewhere-'));
    makeVideo(inWork('abs.mp4'));
    const result = runCli([inWork('abs.mp4')], { cwd: elsewhere });
    assert.equal(result.status, 0, result.stderr);
    assertPlayable(inWork('abs.webm'));
    assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing should be written to the cwd');
  });

  test('relative paths with subfolders and ".." resolve against the current directory', () => {
    const sub = path.join(WORKDIR, 'sub folder');
    fs.mkdirSync(sub, { recursive: true });
    makeVideo(path.join(sub, 'nested.mov'));
    const down = runCli([path.join('sub folder', 'nested.mov')]);
    assert.equal(down.status, 0, down.stderr);
    assertPlayable(path.join(sub, 'nested.webm'));

    makeVideo(path.join(sub, 'up.mp4'));
    makeVideo(path.join(WORKDIR, 'sibling.mp4'));
    const up = runCli([path.join('..', 'sibling.mp4')], { cwd: sub });
    assert.equal(up.status, 0, up.stderr);
    assertPlayable(path.join(WORKDIR, 'sibling.webm'));
  });

  test('piped output has no ANSI codes or carriage returns', () => {
    makeVideo(inWork('plain.mp4'));
    const result = runCli(['plain.mp4']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /[\x1b\r]/);
  });

  test('success report lists both file sizes', () => {
    makeVideo(inWork('report.mp4'));
    const result = runCli(['report.mp4']);
    assert.match(result.stdout, /Tamaño\s+.+ -> .+\(.+(menor|mayor)\)/);
    assert.match(result.stdout, /Salida\s+.+report\.webm/);
    assert.match(result.stdout, /Tiempo\s+\d{2}:\d{2}/);
  });
});

describe('input and destination errors', () => {
  test('missing file', () => {
    const result = runCli(['ghost.mp4']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No se encontró el archivo/);
    assert.match(result.stderr, /Sugerencia/);
    assert.equal(result.stdout.includes('Convirtiendo'), false);
  });

  test('unsupported extension is rejected before any conversion starts', () => {
    const result = runCli(['movie.avi']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"\.avi" no es compatible/);
    assert.match(result.stderr, /\.mp4, \.mov/);
    assertNoLeftovers('movie');
  });

  test('missing extension suggests the matching file', () => {
    const result = runCli(['clip']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no tiene extensión/);
    assert.match(result.stderr, /¿Quisiste decir "clip\.mp4"\?/);
  });

  test('corrupted input gives a friendly error and leaves no partial files', () => {
    const result = runCli(['broken.mp4']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dañado|incompleto/);
    assert.doesNotMatch(result.stderr, /ffmpeg version|Stream #|configuration:/);
    assertNoLeftovers('broken');
  });

  test('existing output is never overwritten', () => {
    const result = runCli(['exists.mp4']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ya existe y no se sobrescribe/);
    assert.equal(fs.readFileSync(inWork('exists.webm'), 'utf8'), 'precious');
  });

  test('read-only destination folder', { skip: isWindows || isRoot }, () => {
    const ro = path.join(ROOT, 'read-only');
    fs.mkdirSync(ro, { recursive: true });
    makeVideo(path.join(ro, 'ro.mp4'));
    fs.chmodSync(ro, 0o555);
    try {
      const result = runCli(['ro.mp4'], { cwd: ro });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /permisos para escribir/);
      assert.equal(fs.readdirSync(ro).join(), 'ro.mp4');
    } finally {
      fs.chmodSync(ro, 0o755);
    }
  });
});

describe('FFmpeg failures', () => {
  test('missing FFmpeg binary', () => {
    const result = runCli(['clip2.mov'], { env: { FFMPEG_PATH: path.join(ROOT, 'no-such-ffmpeg') } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No se encontró FFmpeg/);
    assert.match(result.stderr, /FFMPEG_PATH/);
  });

  test('missing ffprobe binary', () => {
    const result = runCli(['clip2.mov'], { env: { FFPROBE_PATH: path.join(ROOT, 'no-such-ffprobe') } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No se encontró ffprobe/);
  });

  test('FFmpeg exits with an error: short detail, no raw dump, no partial output', { skip: isWindows }, () => {
    makeVideo(inWork('fail.mp4'));
    const fake = path.join(ROOT, 'fake-ffmpeg.sh');
    fs.writeFileSync(
      fake,
      `#!/bin/sh\ncase "$*" in *-formats*|*-codecs*|*-encoders*|*-filters*|*-version*) exec "${FFMPEG}" "$@";; esac\n` +
        `echo "noise line 1" >&2\necho "Error: simulated encoder failure" >&2\necho "Conversion failed!" >&2\nexit 1\n`,
      { mode: 0o755 }
    );
    const result = runCli(['fail.mp4'], { env: { FFMPEG_PATH: fake } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FFmpeg no pudo completar la conversión/);
    assert.match(result.stderr, /Detalle\s+Error: simulated encoder failure/);
    assert.match(result.stderr, /--verbose/);
    assert.doesNotMatch(result.stderr, /noise line 1/);
    assertNoLeftovers('fail');

    const verbose = runCli(['fail.mp4', '--verbose'], { env: { FFMPEG_PATH: fake } });
    assert.match(verbose.stderr, /noise line 1/);
    assert.match(verbose.stderr, /\[debug\]/);
  });
});

describe('interruption', () => {
  test('SIGINT cancels the conversion and removes the partial file', { skip: isWindows }, async () => {
    makeVideo(inWork('long.mp4'), { seconds: 120, size: '960x540', audio: false });
    const child = spawn(process.execPath, [CLI, 'long.mp4'], {
      cwd: WORKDIR,
    });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', d => (stderr += d));
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`never started: ${stdout}${stderr}`)), 30_000);
      child.stdout.on('data', d => {
        stdout += d;
        if (stdout.includes('Convirtiendo')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const exited = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));

    await started;
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(exists('long.webm.part'), true, 'partial file should exist while converting');
    child.kill('SIGINT');
    const { code } = await exited;

    assert.equal(code, 130);
    assert.match(stderr, /Conversión cancelada/);
    assertNoLeftovers('long');
  });
});

describe('progress reporting', () => {
  test('ratios are within [0,1] and never decrease', async () => {
    makeVideo(inWork('progress.mp4'), { seconds: 10 });
    const media = await probeMedia(inWork('progress.mp4'));
    assert.ok(Math.abs(media.duration - 10) < 0.5, `probed duration ${media.duration}`);
    const ratios = [];
    await runConversion(inWork('progress.mp4'), inWork('progress.webm.part'), media.hasAudio, {
      duration: media.duration,
      onProgress: ratio => ratios.push(ratio),
    });
    assert.ok(ratios.length > 0, 'expected at least one progress event');
    assert.ok(ratios.every(r => r >= 0 && r <= 1));
    assert.deepEqual(ratios, [...ratios].sort((a, b) => a - b));
  });
});

describe('command line', () => {
  test('no arguments prints usage and exits with 2', () => {
    const result = runCli([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Falta el nombre del archivo/);
    assert.match(result.stderr, /Uso: convert-webm/);
  });

  test('several files are rejected instead of silently ignored', () => {
    const result = runCli(['clip.mp4', 'clip2.mov']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /un archivo a la vez/);
  });

  test('unknown option', () => {
    const result = runCli(['--nope', 'clip.mp4']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Opción desconocida: --nope/);
  });

  test('--help and --version', () => {
    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--verbose/);
    const version = runCli(['--version']);
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), pkg.version);
  });
});
