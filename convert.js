#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov']);

function resolveDesktopPath() {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE;
    if (!userProfile) throw new Error('USERPROFILE environment variable is not set.');
    const oneDrivePath = path.join(
      userProfile,
      'OneDrive - Superintendencia de Bancos de la Republica Dominicana',
      'Escritorio'
    );
    return fs.existsSync(oneDrivePath) ? oneDrivePath : path.join(userProfile, 'Desktop');
  }
  // macOS / Linux
  return path.join(os.homedir(), 'Desktop');
}

function validateInput(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    const supported = [...SUPPORTED_EXTENSIONS].join(', ');
    throw new Error(`Unsupported format "${ext}". Supported: ${supported}`);
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
}

function buildOutputPath(inputPath) {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '.webm');
  if (fs.existsSync(outputPath)) {
    throw new Error(`Output already exists: ${outputPath}\nDelete or rename it before converting.`);
  }
  return outputPath;
}

function probeAudioStreams(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');
      resolve(hasAudio);
    });
  });
}

function runConversion(inputPath, outputPath, hasAudio) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const command = ffmpeg(inputPath)
      .inputOptions([
        '-fflags +genpts+discardcorrupt',
        '-avoid_negative_ts make_zero',
        '-err_detect ignore_err',
      ])
      .output(outputPath)
      .videoCodec('libvpx-vp9')
      .outputOptions([
        '-r 30',
        '-vsync 1',
        '-crf 32',
        '-b:v 0',
        '-deadline good',
        '-max_muxing_queue_size 4096',
      ]);

    if (hasAudio) {
      command.audioCodec('libopus');
    } else {
      command.noAudio();
    }

    command
      .on('progress', progress => {
        if (progress.percent != null) {
          const pct = Math.min(progress.percent, 100).toFixed(1);
          process.stdout.write(`\r  Progress: ${pct}%   `);
        }
      })
      .on('end', () => {
        process.stdout.write('\n');
        resolve(((Date.now() - startTime) / 1000).toFixed(2));
      })
      .on('error', (err, _stdout, stderr) => {
        process.stdout.write('\n');
        reject(Object.assign(err, { ffmpegStderr: stderr }));
      })
      .run();
  });
}

async function main() {
  const inputFileName = process.argv[2];

  if (!inputFileName) {
    console.error('Usage: convert-webm <filename.mp4|filename.mov>');
    process.exit(1);
  }

  try {
    const desktopPath = resolveDesktopPath();
    const inputPath = path.join(desktopPath, inputFileName);

    validateInput(inputPath);

    const outputPath = buildOutputPath(inputPath);
    const hasAudio = await probeAudioStreams(inputPath);

    console.log(`Input:  ${inputPath}`);
    console.log(`Output: ${outputPath}`);
    console.log(`Audio:  ${hasAudio ? 'yes' : 'none detected'}`);
    console.log('Converting...');

    const elapsed = await runConversion(inputPath, outputPath, hasAudio);

    console.log(`Done in ${elapsed}s`);
    console.log(`Output: ${outputPath}`);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    if (err.ffmpegStderr) {
      console.error('\nFFmpeg output:\n' + err.ffmpegStderr);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { resolveDesktopPath, validateInput, buildOutputPath, probeAudioStreams, runConversion };
