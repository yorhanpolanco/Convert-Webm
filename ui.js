'use strict';

const SYMBOLS = {
  unicode: { ok: '✔', fail: '✖', warn: '⚠', full: '█', empty: '░', dot: '·', arrow: '→' },
  ascii: { ok: '[OK]', fail: '[ERROR]', warn: '[!]', full: '#', empty: '-', dot: '|', arrow: '->' },
};

const ETA_MIN_RATIO = 0.03;
const ETA_MIN_ELAPSED_SEC = 3;
const BAR_MAX_WIDTH = 30;
const BAR_MIN_WIDTH = 8;
const INDENT = '  ';

function isUnicodeSupported(env, platform) {
  if (platform !== 'win32') return env.TERM !== 'linux';
  return Boolean(
    env.WT_SESSION ||
      env.TERMINUS_SUBLIME ||
      env.ConEmuTask === '{cmd::Cmder}' ||
      env.TERM_PROGRAM === 'vscode' ||
      env.TERM === 'xterm-256color' ||
      env.TERM === 'alacritty' ||
      env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  );
}

function streamCaps(stream, { env = process.env, platform = process.platform, noColor = false } = {}) {
  const tty = Boolean(stream && stream.isTTY);
  const forced = env.FORCE_COLOR !== undefined && !['', '0', 'false'].includes(env.FORCE_COLOR);
  let color;
  if (noColor || (env.NO_COLOR !== undefined && env.NO_COLOR !== '')) color = false;
  else if (forced) color = true;
  else if (!tty || env.TERM === 'dumb') color = false;
  else color = typeof stream.hasColors === 'function' ? stream.hasColors() : true;
  return { tty, color, unicode: tty && isUnicodeSupported(env, platform) };
}

function painter(enabled) {
  const wrap = (open, close) => text => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'desconocido';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return i === 0 ? `${value} B` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function describeSizeChange(inputBytes, outputBytes) {
  if (!(inputBytes > 0) || !(outputBytes >= 0)) return null;
  const diff = outputBytes - inputBytes;
  if (diff === 0) return { text: 'sin cambios', larger: false };
  const pct = ((Math.abs(diff) / inputBytes) * 100).toFixed(1);
  return diff < 0
    ? { text: `${pct}% menor`, larger: false }
    : { text: `${pct}% mayor`, larger: true };
}

function computeEta(ratio, elapsedSec) {
  if (ratio == null || ratio < ETA_MIN_RATIO || ratio >= 1 || elapsedSec < ETA_MIN_ELAPSED_SEC) return null;
  return (elapsedSec * (1 - ratio)) / ratio;
}

function renderBar(ratio, width, symbols) {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width);
  return symbols.full.repeat(filled) + symbols.empty.repeat(width - filled);
}

function renderProgressLine({ label, ratio, elapsed, columns, symbols }) {
  let line;
  if (ratio == null) {
    line = `${INDENT}${label}  ${formatClock(elapsed)} transcurrido`;
  } else {
    const eta = computeEta(ratio, elapsed);
    const tail =
      `${String(Math.round(ratio * 100)).padStart(3)}%  ${formatClock(elapsed)}` +
      (eta != null ? `  ETA ${formatClock(eta)}` : '');
    const prefix = `${INDENT}${label}  `;
    const barWidth = Math.min(BAR_MAX_WIDTH, columns - prefix.length - tail.length - 5);
    const bar = barWidth >= BAR_MIN_WIDTH ? `[${renderBar(ratio, barWidth, symbols)}]  ` : '';
    line = prefix + bar + tail;
  }
  return line.length > columns - 1 ? line.slice(0, Math.max(0, columns - 1)) : line;
}

class ProgressReporter {
  constructor({ stream, caps, symbols, paint, label, determinate, now = Date.now, throttleMs = 100 }) {
    this.stream = stream;
    this.caps = caps;
    this.symbols = symbols;
    this.paint = paint;
    this.label = label;
    this.determinate = determinate;
    this.now = now;
    this.throttleMs = throttleMs;
    this.active = false;
    this.ratio = null;
    this.prevLength = 0;
    this.lastRender = -Infinity;
    this.lastMilestone = 0;
  }

  start() {
    this.active = true;
    this.startedAt = this.now();
    this.lastRender = this.startedAt;
    this.ratio = this.determinate ? 0 : null;
    if (this.caps.tty) this.render();
    else this.stream.write(`${INDENT}${this.label}...\n`);
  }

  update(ratio) {
    if (!this.active) return;
    if (ratio != null) this.ratio = Math.max(this.ratio || 0, ratio);
    const t = this.now();
    if (this.caps.tty) {
      if (t - this.lastRender < this.throttleMs) return;
      this.lastRender = t;
      this.render();
    } else if (this.ratio != null) {
      const milestone = Math.floor(this.ratio * 10) * 10;
      if (milestone > this.lastMilestone && milestone < 100) {
        this.lastMilestone = milestone;
        this.stream.write(`${INDENT}${this.label} ${milestone}% (${formatClock(this._elapsed())})\n`);
      }
    }
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    if (!this.caps.tty) return;
    if (this.determinate) this.ratio = 1;
    this.render();
    this.stream.write('\n');
  }

  abort() {
    if (!this.active) return;
    this.active = false;
    if (this.caps.tty && this.prevLength > 0) this.stream.write('\n');
  }

  _elapsed() {
    return (this.now() - this.startedAt) / 1000;
  }

  render() {
    const columns = this.stream.columns || 80;
    const line = renderProgressLine({
      label: this.label,
      ratio: this.ratio,
      elapsed: this._elapsed(),
      columns,
      symbols: this.symbols,
    });
    const padding = ' '.repeat(Math.max(0, this.prevLength - line.length));
    this.prevLength = line.length;
    this.stream.write(`\r${this.paint.cyan(line)}${padding}`);
  }
}

function createUI({
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  noColor = false,
  verbose = false,
  now,
} = {}) {
  const outCaps = streamCaps(stdout, { env, platform, noColor });
  const errCaps = streamCaps(stderr, { env, platform, noColor });
  const outSym = SYMBOLS[outCaps.unicode ? 'unicode' : 'ascii'];
  const errSym = SYMBOLS[errCaps.unicode ? 'unicode' : 'ascii'];
  const out = painter(outCaps.color);
  const err = painter(errCaps.color);

  const println = (stream, text = '') => stream.write(`${text}\n`);

  function printRows(stream, paint, rows) {
    const width = Math.max(...rows.map(([label]) => label.length));
    const continuation = `\n${INDENT}${' '.repeat(width)}  `;
    for (const [label, value] of rows) {
      println(stream, `${INDENT}${paint.dim(label.padEnd(width))}  ${String(value).split('\n').join(continuation)}`);
    }
  }

  return {
    caps: { stdout: outCaps, stderr: errCaps },

    text(content) {
      println(stdout, content);
    },

    header({ name, version, from, to, rows }) {
      println(
        stdout,
        `${out.bold(name)} ${out.dim(version)}  ${out.dim(outSym.dot)}  ${from} ${outSym.arrow} ${to}`
      );
      println(stdout);
      printRows(stdout, out, rows);
      println(stdout);
    },

    createProgress({ label, determinate }) {
      return new ProgressReporter({
        stream: stdout,
        caps: outCaps,
        symbols: outSym,
        paint: out,
        label,
        determinate,
        now,
      });
    },

    success({ elapsed, outputPath, inputName, inputSize, outputSize }) {
      println(stdout);
      println(stdout, `${out.green(outSym.ok)} ${out.bold('Conversión completada')}`);
      println(stdout);
      const change = describeSizeChange(inputSize, outputSize);
      const sizeText = `${formatBytes(inputSize)} ${outSym.arrow} ${formatBytes(outputSize)}`;
      const changeText = change ? `  (${change.larger ? out.yellow(change.text) : out.green(change.text)})` : '';
      printRows(stdout, out, [
        ['Origen', inputName],
        ['Salida', outputPath],
        ['Tamaño', sizeText + changeText],
        ['Tiempo', formatClock(elapsed)],
      ]);
    },

    warn(message) {
      println(stderr, `${err.yellow(errSym.warn)} ${message}`);
    },

    debug(message) {
      if (verbose) println(stderr, err.dim(`[debug] ${message}`));
    },

    failure(error) {
      const cancelled = error.code === 'INTERRUPTED';
      println(stderr);
      println(
        stderr,
        cancelled
          ? `${err.yellow(errSym.warn)} ${err.bold('Conversión cancelada')}`
          : `${err.red(errSym.fail)} ${err.bold('No se pudo completar la conversión')}`
      );
      println(stderr);

      if (cancelled) {
        println(stderr, `${INDENT}${error.message}`);
      } else {
        const rows = [['Problema', error.message]];
        if (error.file) rows.push(['Archivo', error.file]);
        if (error.hint) rows.push(['Sugerencia', error.hint]);
        if (error.detail && error.detail !== error.message) rows.push(['Detalle', error.detail]);
        printRows(stderr, err, rows);
      }

      if (verbose) {
        if (error.stderr) {
          println(stderr);
          println(stderr, err.dim('--- salida de FFmpeg ---'));
          println(stderr, error.stderr.trimEnd());
        }
        if (error.cause && error.cause.stack) {
          println(stderr);
          println(stderr, err.dim(error.cause.stack));
        }
      } else if (error.stderr) {
        println(stderr);
        println(stderr, err.dim(`${INDENT}Usa --verbose para ver la salida completa de FFmpeg.`));
      }
    },

    usageError(message, usage) {
      println(stderr, `${err.red(errSym.fail)} ${message}`);
      println(stderr);
      println(stderr, usage);
    },
  };
}

module.exports = {
  createUI,
  streamCaps,
  isUnicodeSupported,
  formatBytes,
  formatClock,
  describeSizeChange,
  computeEta,
  renderBar,
  renderProgressLine,
  ProgressReporter,
  SYMBOLS,
};
