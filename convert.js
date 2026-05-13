#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');

// Configurar ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Obtener argumento (nombre del archivo)
const inputFileName = process.argv[2];

console.log('inputFileName:', inputFileName);

if (!inputFileName) {
  console.error('❌ Debes proporcionar el nombre del archivo. Ej: node convert.js video.mp4');
  process.exit(1);
}

const userPath = process.env.USERPROFILE;
const desktoUserPath = path.join(userPath, `OneDrive - Superintendencia de Bancos de la Republica Dominicana\\Escritorio`);

let desktopPath;

if (!fs.existsSync(desktoUserPath)) {
  desktopPath = path.join(userPath, `Desktop`);
} else {
  desktopPath = desktoUserPath;
}

// Construir rutas
const inputPath = path.join(desktopPath, inputFileName);

console.log('inputPath:', inputPath);

// Validar existencia
if (!fs.existsSync(inputPath)) {
  console.error(`❌ El archivo no existe en el escritorio: ${inputFileName}`);
  process.exit(1);
}

// Generar nombre de salida
const outputFileName = inputFileName.replace(/\.[^/.]+$/, '.webm');
const outputPath = path.join(desktopPath, outputFileName);

console.log('🚀 Iniciando conversión...');
console.log(`📥 Input: ${inputPath}`);
console.log(`📤 Output: ${outputPath}`);
console.log(`Procesando...`);

const startTime = Date.now();

ffmpeg(inputPath)
  .inputOptions([
    '-fflags +genpts+discardcorrupt',
    '-avoid_negative_ts make_zero',
    '-err_detect ignore_err'
  ])
  .output(outputPath)
  .videoCodec('libvpx-vp9')
  .audioCodec('libopus')
  .outputOptions([
    '-r 30',
    '-vsync 1', // Reemplaza a '-fps_mode cfr' para compatibilidad con versiones anteriores de FFmpeg
    '-crf 32',
    '-b:v 0',
    '-deadline realtime',
    '-max_muxing_queue_size 4096'
    // Se eliminó '-async 1' ya que está obsoleto. Si necesitas sincronizar audio usa '-af aresample=async=1'
  ])
  .on('progress', progress => {
    if (progress.percent) {
      process.stdout.write(`⏳ Progreso: ${progress.percent.toFixed(2)}%   \r`);
    }
  })
  .on('end', () => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Conversión completada en ${duration}s`);
  })
  // ¡AQUÍ ESTÁ LA CLAVE PARA DEBUGGEAR! Se agregaron stdout y stderr
  .on('error', (err, stdout, stderr) => {
    console.error('\n❌ Error durante la conversión:', err.message);
    console.error('\n🔍 DETALLE INTERNO DE FFMPEG (stderr):');
    console.error(stderr); // Esto te dirá exactamente por qué falló
    process.exit(1);
  })
  .run();