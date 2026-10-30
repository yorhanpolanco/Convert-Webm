'use strict';

class ConversionError extends Error {
  constructor(code, message, { hint, file, detail, stderr, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ConversionError';
    this.code = code;
    this.hint = hint;
    this.file = file;
    this.detail = detail;
    this.stderr = stderr;
  }
}

const PROGRESS_LINE = /^(frame|size|video:|Lsize)=?/i;
const ERROR_LINE = /error|invalid|no such|denied|failed|not found|unable|cannot|could not/i;

function lastMeaningfulLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !PROGRESS_LINE.test(l) && !/^Conversion failed!?$/i.test(l));
  const errorLine = [...lines].reverse().find(l => ERROR_LINE.test(l));
  return errorLine || lines[lines.length - 1];
}

function interrupted() {
  return new ConversionError(
    'INTERRUPTED',
    'Se detuvo la conversión y no se guardó ningún archivo incompleto.'
  );
}

function classifyError(err, { file } = {}) {
  if (err instanceof ConversionError) return err;

  const stderr = err.ffmpegStderr || '';
  const text = `${err.message || ''}\n${stderr}`;
  const isSpawn = typeof err.syscall === 'string' && err.syscall.startsWith('spawn');
  const base = {
    file,
    detail: lastMeaningfulLine(stderr || err.message),
    stderr: stderr || undefined,
    cause: err,
  };

  if (/received signal (2|15)\b/.test(stderr)) return interrupted();

  if (/Cannot find (ffmpeg|ffprobe)/i.test(text) || (isSpawn && err.code === 'ENOENT')) {
    return new ConversionError('FFMPEG_MISSING', 'No se pudo ejecutar FFmpeg.', {
      ...base,
      hint: 'Ejecuta "npm install" en la carpeta del proyecto o define FFMPEG_PATH con la ruta de un FFmpeg instalado.',
    });
  }

  if (isSpawn && err.code === 'EACCES') {
    return new ConversionError('FFMPEG_NOT_EXECUTABLE', 'FFmpeg no tiene permisos de ejecución.', {
      ...base,
      hint: 'Reinstala las dependencias con "npm install" o concede permisos de ejecución al binario.',
    });
  }

  if (err.code === 'ENOSPC' || /No space left on device/i.test(text)) {
    return new ConversionError('DISK_FULL', 'No hay espacio suficiente en el disco para guardar el video.', {
      ...base,
      hint: 'Libera espacio en el disco e inténtalo de nuevo.',
    });
  }

  if (err.code === 'EACCES' || err.code === 'EPERM' || /Permission denied|Operation not permitted/i.test(text)) {
    return new ConversionError('PERMISSION_DENIED', 'No hay permisos suficientes para leer o escribir el archivo.', {
      ...base,
      hint: 'Verifica los permisos de la carpeta y del archivo, y que ningún otro programa lo esté usando.',
    });
  }

  if (/moov atom not found|Invalid data found when processing input|could not find codec parameters|does not contain any stream/i.test(text)) {
    return new ConversionError('INVALID_MEDIA', 'El archivo no se pudo leer como video; puede estar dañado o incompleto.', {
      ...base,
      hint: 'Comprueba que el video se reproduce correctamente; si viene de una descarga o grabación interrumpida, vuelve a obtenerlo.',
    });
  }

  return new ConversionError('FFMPEG_FAILED', 'FFmpeg no pudo completar la conversión.', {
    ...base,
    hint: 'Ejecuta de nuevo con --verbose para ver la salida completa de FFmpeg.',
  });
}

module.exports = { ConversionError, classifyError, interrupted, lastMeaningfulLine };
