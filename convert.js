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

// Construir rutas
const desktopPath =  desktoUserPath;
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
  .output(outputPath)
  .videoCodec('libvpx-vp9')
  .audioCodec('libopus')
  .outputOptions([
    '-crf 30',     // calidad (más bajo = mejor)
    '-b:v 0',      // modo calidad constante
    '-deadline good', // balance velocidad/calidad
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
  .on('error', err => {
    console.error('\n❌ Error durante la conversión:', err.message);
    process.exit(1);
  })
  .run();