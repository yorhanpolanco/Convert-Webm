#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const pkg = require('./package.json');
const { ConversionError, classifyError, interrupted } = require('./errors');
const { createUI, formatBytes, formatClock } = require('./ui');

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov']);
const ENCODING = Object.freeze({ videoCodec: 'libvpx-vp9', audioCodec: 'libopus', crf: 32, fps: 30 });
const PART_SUFFIX = '.part';

const USAGE = `Uso: convert-webm <archivo.mp4|archivo.mov> [opciones]

Convierte un video a WebM (VP9 + Opus). Acepta un nombre, una ruta relativa
a la carpeta actual o una ruta absoluta. El archivo .webm se guarda junto al
original y nunca sobrescribe uno existente.

Opciones:
  --verbose      Muestra detalles técnicos (comando y salida completa de FFmpeg)
  --no-color     Desactiva los colores
  -h, --help     Muestra esta ayuda
  -v, --version  Muestra la versión

Variables de entorno:
  FFMPEG_PATH, FFPROBE_PATH  Usa binarios propios en lugar de los incluidos
  NO_COLOR                   Desactiva los colores`;

function loadInstalledPath(moduleName) {
  try {
    return require(moduleName).path;
  } catch {
    return null;
  }
}

function resolveBinaries(env = process.env) {
  return {
    ffmpeg: env.FFMPEG_PATH || loadInstalledPath('@ffmpeg-installer/ffmpeg'),
    ffprobe: env.FFPROBE_PATH || loadInstalledPath('@ffprobe-installer/ffprobe'),
  };
}

const binaries = resolveBinaries();
if (binaries.ffmpeg) ffmpeg.setFfmpegPath(binaries.ffmpeg);
if (binaries.ffprobe) ffmpeg.setFfprobePath(binaries.ffprobe);

function assertBinary(label, binPath, envVar) {
  if (!binPath || !fs.existsSync(binPath)) {
    const platformPackage = `@${label.toLowerCase()}-installer/${process.platform}-${process.arch}`;
    throw new ConversionError('FFMPEG_MISSING', `No se encontró ${label}.`, {
      file: binPath || undefined,
      hint: process.env[envVar]
        ? `Revisa que ${envVar} apunte a un ejecutable válido.`
        : `Ejecuta "npm install" en la carpeta del proyecto (si npm bloqueó scripts: ` +
          `"npm install-scripts approve ${platformPackage}"), ` +
          `o define ${envVar} con la ruta de un ${label} instalado.`,
    });
  }
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(binPath, fs.constants.X_OK);
    } catch {
      throw new ConversionError('FFMPEG_NOT_EXECUTABLE', `${label} no tiene permisos de ejecución.`, {
        file: binPath,
        hint: `Ejecuta: chmod u+x "${binPath}"`,
      });
    }
  }
}

function assertBinariesAvailable() {
  assertBinary('FFmpeg', binaries.ffmpeg, 'FFMPEG_PATH');
  assertBinary('ffprobe', binaries.ffprobe, 'FFPROBE_PATH');
}

function validateInput(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    const supported = [...SUPPORTED_EXTENSIONS].join(', ');
    let hint = `Formatos compatibles: ${supported}.`;
    if (!ext) {
      const match = [...SUPPORTED_EXTENSIONS].find(e => fs.existsSync(inputPath + e));
      if (match) hint = `¿Quisiste decir "${path.basename(inputPath)}${match}"?`;
    }
    throw new ConversionError(
      'UNSUPPORTED_FORMAT',
      ext ? `El formato "${ext}" no es compatible.` : 'El archivo no tiene extensión.',
      { file: inputPath, hint }
    );
  }
  if (!fs.existsSync(inputPath)) {
    throw new ConversionError('INVALID_INPUT', 'No se encontró el archivo.', {
      file: inputPath,
      hint: `Revisa el nombre (incluida la extensión) y que el archivo esté en ${path.dirname(inputPath)}.`,
    });
  }
  if (!fs.statSync(inputPath).isFile()) {
    throw new ConversionError('INVALID_INPUT', 'La ruta indicada no es un archivo.', { file: inputPath });
  }
  try {
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch {
    throw new ConversionError('PERMISSION_DENIED', 'No hay permisos para leer el archivo.', {
      file: inputPath,
      hint: 'Verifica los permisos del archivo.',
    });
  }
}

function buildOutputPath(inputPath) {
  const { dir, name } = path.parse(inputPath);
  const outputPath = path.join(dir, `${name}.webm`);
  if (fs.existsSync(outputPath)) {
    throw new ConversionError('OUTPUT_EXISTS', 'El archivo de salida ya existe y no se sobrescribe.', {
      file: outputPath,
      hint: 'Elimina o renombra ese archivo antes de convertir.',
    });
  }
  return outputPath;
}

function checkDestination(dir) {
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {
    // reported below
  }
  if (!isDir) {
    throw new ConversionError('INVALID_DESTINATION', 'La carpeta de destino no existe.', {
      file: dir,
      hint: 'Verifica que la carpeta exista y esté disponible.',
    });
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new ConversionError('PERMISSION_DENIED', 'No hay permisos para escribir en la carpeta de destino.', {
      file: dir,
      hint: 'Concede permisos de escritura a la carpeta o mueve el video a otra ubicación.',
    });
  }
}

function getFreeSpace(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function probeMedia(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const streams = metadata.streams || [];
      const video = streams.find(s => s.codec_type === 'video');
      const duration = Number(metadata.format && metadata.format.duration);
      resolve({
        hasVideo: Boolean(video),
        hasAudio: streams.some(s => s.codec_type === 'audio'),
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        width: video && video.width,
        height: video && video.height,
      });
    });
  });
}

async function probeAudioStreams(inputPath) {
  return (await probeMedia(inputPath)).hasAudio;
}

function parseTimemark(timemark) {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(timemark || ''));
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + parseFloat(match[3]) : null;
}

function progressRatio(timemark, duration) {
  const seconds = parseTimemark(timemark);
  if (seconds == null || !duration) return null;
  return Math.min(1, Math.max(0, seconds / duration));
}

function runConversion(inputPath, outputPath, hasAudio, { duration, signal, onStart, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(interrupted());

    const startTime = Date.now();
    let settled = false;

    const command = ffmpeg(inputPath)
      .inputOptions([
        '-fflags +genpts+discardcorrupt',
        '-avoid_negative_ts make_zero',
        '-err_detect ignore_err',
      ])
      .output(outputPath)
      .format('webm')
      .videoCodec(ENCODING.videoCodec)
      .outputOptions([
        `-r ${ENCODING.fps}`,
        '-vsync 1',
        `-crf ${ENCODING.crf}`,
        '-b:v 0',
        '-deadline good',
        '-max_muxing_queue_size 4096',
      ]);

    if (hasAudio) command.audioCodec(ENCODING.audioCodec);
    else command.noAudio();

    const onAbort = () => command.kill('SIGKILL');
    const settle = fn => value => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    command
      .on('start', commandLine => {
        if (signal && signal.aborted) return onAbort();
        if (onStart) onStart(commandLine);
      })
      .on('progress', progress => {
        if (onProgress) onProgress(progressRatio(progress.timemark, duration), progress);
      })
      .on('end', settle(() => resolve(((Date.now() - startTime) / 1000).toFixed(2))))
      .on('error', (err, _stdout, stderr) => {
        err.ffmpegStderr = stderr;
        settle(reject)(signal && signal.aborted ? interrupted() : classifyError(err, { file: inputPath }));
      })
      .run();
  });
}

function commitOutput(partPath, outputPath) {
  const size = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
  if (size === 0) {
    throw new ConversionError('FFMPEG_FAILED', 'FFmpeg terminó sin generar un video válido.', {
      hint: 'Ejecuta de nuevo con --verbose para ver los detalles.',
    });
  }
  if (fs.existsSync(outputPath)) {
    throw new ConversionError('OUTPUT_EXISTS', 'El archivo de salida ya existe y no se sobrescribe.', {
      file: outputPath,
      hint: 'Elimina o renombra ese archivo antes de convertir.',
    });
  }
  fs.renameSync(partPath, outputPath);
  return size;
}

function discardPartial(partPath) {
  try {
    fs.rmSync(partPath, { force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // best effort: a stale .part file is harmless and replaced on the next run
  }
}

function parseArgs(argv) {
  const args = { files: [], unknown: [], verbose: false, noColor: false, help: false, version: false };
  for (const arg of argv) {
    if (arg === '--verbose') args.verbose = true;
    else if (arg === '--no-color') args.noColor = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg === '-v' || arg === '--version') args.version = true;
    else if (arg.startsWith('-') && arg.length > 1) args.unknown.push(arg);
    else args.files.push(arg);
  }
  return args;
}

function describeMedia(media, inputSize) {
  const parts = [formatBytes(inputSize)];
  if (media.width && media.height) parts.push(`${media.width}x${media.height}`);
  if (media.duration) parts.push(formatClock(media.duration));
  return parts.join(', ');
}

async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, env = process.env, cwd = process.cwd() } = {}) {
  const args = parseArgs(argv);
  const ui = createUI({ stdout, stderr, env, noColor: args.noColor, verbose: args.verbose });

  if (args.help) {
    ui.text(USAGE);
    return 0;
  }
  if (args.version) {
    ui.text(pkg.version);
    return 0;
  }
  if (args.unknown.length > 0) {
    ui.usageError(`Opción desconocida: ${args.unknown.join(', ')}`, USAGE);
    return 2;
  }
  if (args.files.length !== 1) {
    ui.usageError(
      args.files.length === 0
        ? 'Falta el nombre del archivo.'
        : 'Solo se puede convertir un archivo a la vez.',
      USAGE
    );
    return 2;
  }

  const controller = new AbortController();
  let partPath = null;
  let progress = null;
  let inputPath = null;

  const onSignal = () => {
    if (controller.signal.aborted) {
      if (partPath) discardPartial(partPath);
      process.exit(130);
    }
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    assertBinariesAvailable();

    inputPath = path.resolve(cwd, args.files[0]);

    validateInput(inputPath);
    const outputPath = buildOutputPath(inputPath);
    checkDestination(path.dirname(outputPath));

    const inputSize = fs.statSync(inputPath).size;

    let media;
    try {
      media = await probeMedia(inputPath);
    } catch (err) {
      throw classifyError(err, { file: inputPath });
    }
    if (controller.signal.aborted) throw interrupted();
    if (!media.hasVideo) {
      throw new ConversionError('INVALID_MEDIA', 'El archivo no contiene ninguna pista de video.', {
        file: inputPath,
        hint: 'Comprueba que el archivo sea un video y no solo audio.',
      });
    }

    const freeSpace = getFreeSpace(path.dirname(outputPath));
    if (freeSpace !== null && freeSpace < inputSize) {
      ui.warn(`Queda poco espacio en disco (${formatBytes(freeSpace)} libres); la conversión podría fallar.`);
    }

    partPath = outputPath + PART_SUFFIX;
    discardPartial(partPath);

    const settings =
      `VP9 (CRF ${ENCODING.crf}), ${media.hasAudio ? 'Opus' : 'sin audio'}, ${ENCODING.fps} fps`;
    ui.header({
      name: 'convert-webm',
      version: pkg.version,
      from: path.extname(inputPath).slice(1).toUpperCase(),
      to: 'WebM',
      rows: [
        ['Origen', `${path.basename(inputPath)}  (${describeMedia(media, inputSize)})`],
        ['Destino', path.basename(outputPath)],
        ['Carpeta', path.dirname(outputPath)],
        ['Ajustes', settings],
      ],
    });
    ui.debug(`ffmpeg: ${binaries.ffmpeg}`);
    ui.debug(`ffprobe: ${binaries.ffprobe}`);

    progress = ui.createProgress({ label: 'Convirtiendo', determinate: media.duration != null });
    const startedAt = Date.now();

    await runConversion(inputPath, partPath, media.hasAudio, {
      duration: media.duration,
      signal: controller.signal,
      onStart: commandLine => {
        ui.debug(commandLine);
        progress.start();
      },
      onProgress: ratio => progress.update(ratio),
    });

    progress.finish();
    const outputSize = commitOutput(partPath, outputPath);
    partPath = null;

    ui.success({
      elapsed: (Date.now() - startedAt) / 1000,
      outputPath,
      inputName: path.basename(inputPath),
      inputSize,
      outputSize,
    });
    return 0;
  } catch (err) {
    if (progress) progress.abort();
    if (partPath) discardPartial(partPath);
    const failure = classifyError(err, { file: inputPath || undefined });
    ui.failure(failure);
    return failure.code === 'INTERRUPTED' ? 130 : 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  resolveBinaries,
  validateInput,
  buildOutputPath,
  checkDestination,
  probeMedia,
  probeAudioStreams,
  progressRatio,
  runConversion,
  commitOutput,
  parseArgs,
  main,
};
