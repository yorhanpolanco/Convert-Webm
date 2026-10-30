# Video Tools CLI

CLI para convertir videos **MP4 y MOV a WebM** desde cualquier carpeta, usando FFmpeg y Node.js.  
Funciona en **Windows** y **macOS** (Apple Silicon e Intel).

---

## Características

- Conversión MP4 → WebM y MOV → WebM (VP9 + Opus)
- Funciona desde cualquier carpeta: nombre, ruta relativa o ruta absoluta
- Manejo de videos sin pista de audio
- Protección contra sobreescritura de archivos existentes
- Validación de formato antes de iniciar la conversión
- Progreso en tiempo real en consola

---

## Requisitos

- Node.js ≥ 18
- npm ≥ 8

FFmpeg y ffprobe se descargan automáticamente como dependencias del paquete.  
No es necesario instalarlos manualmente.

---

## Instalación

```bash
git clone <repo-url>
cd Convert-Webm
npm install
```

### Registro como comando global (opcional)

#### macOS

`npm link` falla con `EACCES` si npm apunta a `/usr/local` (requiere root).  
Ejecuta esto **una sola vez** para redirigir los paquetes globales a tu carpeta de usuario:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Luego ya funciona sin `sudo`:

```bash
npm link
```

#### Windows

En Windows `npm link` funciona directamente sin pasos adicionales:

```bash
npm link
```

Si aparece un error de permisos, abre PowerShell como administrador y vuelve a ejecutarlo.

---

## Uso

```bash
cd ~/Videos
convert-webm video.mp4                        # en la carpeta actual
convert-webm clips/grabacion.mov              # ruta relativa
convert-webm "/Users/yo/Mis Videos/boda.mp4"  # ruta absoluta (usa comillas si tiene espacios)
```

El video se busca desde la carpeta donde ejecutas el comando, o puedes indicar una ruta completa.
El archivo `.webm` se genera **junto al video original** y **nunca sobrescribe** uno existente. Solo se convierte un archivo por ejecución.

### Opciones

| Opción | Descripción |
|--------|-------------|
| `--verbose` | Muestra el comando de FFmpeg y su salida completa si algo falla |
| `--no-color` | Desactiva los colores (también respeta la variable `NO_COLOR`) |
| `-h`, `--help` | Muestra la ayuda |
| `-v`, `--version` | Muestra la versión |

### Variables de entorno

| Variable | Uso |
|----------|-----|
| `FFMPEG_PATH`, `FFPROBE_PATH` | Usar un FFmpeg/ffprobe propio en lugar de los incluidos en `node_modules` |
| `NO_COLOR` | Desactiva los colores |

### Salida en consola

- Encabezado con origen (tamaño, resolución, duración), destino y ajustes.
- Barra de progreso real (calculada con la duración del video), tiempo transcurrido y ETA;
  el ETA solo aparece cuando hay datos suficientes (≥ 3 % y ≥ 3 s).
- Al terminar: ruta de salida, tamaño original → final, porcentaje de reducción y tiempo total.
- Si la salida no es una terminal (redirigida a archivo o pipe) se imprimen líneas simples cada 10 %,
  sin colores ni caracteres de control. En terminales sin soporte Unicode se usan símbolos ASCII.
- Los errores explican el problema, el archivo afectado y una sugerencia (archivo inexistente o
  dañado, formato no compatible, FFmpeg ausente, permisos, disco lleno, destino inválido).
- `Ctrl+C` cancela la conversión y elimina el archivo incompleto (código de salida 130).
  Mientras se convierte, el video se escribe como `nombre.webm.part` y solo se renombra a `.webm` al terminar bien.

Códigos de salida: `0` éxito, `1` error de conversión, `2` uso incorrecto, `130` cancelado.

---

## Codecs utilizados

| Parámetro   | Valor        |
|-------------|--------------|
| Video       | VP9 (`libvpx-vp9`) |
| Audio       | Opus (`libopus`) — omitido si el video no tiene audio |
| CRF         | 32 (calidad constante, archivo compacto) |
| Deadline    | `good` (equilibrio calidad/velocidad) |

---

## Ajuste de calidad

| Calidad     | CRF  |
|-------------|------|
| Alta        | 28   |
| Balance     | 30   |
| Comprimido  | 32–35 |

> Menor CRF = mejor calidad (archivo más pesado)

---

## Tests

```bash
npm test
```

Incluye pruebas unitarias (formato, ETA, barra de progreso, detección de terminal, clasificación de errores)
y pruebas end-to-end que generan videos MP4/MOV con el FFmpeg incluido, convierten de verdad y verifican
con ffprobe que el WebM resultante es VP9 + Opus y decodifica sin errores. También cubren archivos sin audio,
nombres con espacios/acentos, archivo dañado, sobrescritura, FFmpeg ausente o fallando, carpeta sin permisos
de escritura y cancelación con `SIGINT` (las dos últimas se omiten en Windows).

---

## Estructura

```
Convert-Webm/
├── convert.js           # CLI: lógica de conversión y orquestación
├── ui.js                # Presentación: colores, progreso, reportes
├── errors.js            # Errores accionables y clasificación de fallos de FFmpeg
├── *.test.js            # Tests (unitarios y end-to-end)
├── package.json
└── README.md
```

---

## Notas de compatibilidad

### Windows
- Acepta rutas con `\` o `/`, con espacios y con acentos.

### macOS
- El binario de FFmpeg para ARM64 e Intel se selecciona automáticamente por `@ffmpeg-installer/ffmpeg`.
- El binario de FFmpeg y ffprobe para ARM64 e Intel se selecciona automáticamente.
- En macOS puede ser necesario aprobar los scripts de instalación:
  ```bash
  npm install-scripts approve @ffmpeg-installer/darwin-arm64
  npm install-scripts approve @ffprobe-installer/darwin-arm64
  npm install
  ```

---

## Licencia

MIT
