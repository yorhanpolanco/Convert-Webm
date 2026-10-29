# Video Tools CLI

CLI para convertir videos **MP4 y MOV a WebM** desde el escritorio, usando FFmpeg y Node.js.  
Funciona en **Windows** y **macOS** (Apple Silicon e Intel).

---

## Características

- Conversión MP4 → WebM y MOV → WebM (VP9 + Opus)
- Detección automática del escritorio en Windows y macOS
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
convert-webm video.mp4
convert-webm grabacion.mov
```

El archivo de entrada debe estar en el escritorio. El archivo `.webm` se genera en la misma ubicación.

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

Cubre validación de formatos, rutas, nombres con espacios, Unicode y protección de sobreescritura.  
Las pruebas de conversión real requieren un archivo de video disponible localmente.

---

## Estructura

```
Convert-Webm/
├── convert.js       # CLI principal
├── convert.test.js  # Tests unitarios
├── package.json
└── README.md
```

---

## Notas de compatibilidad

### Windows
- El escritorio se detecta automáticamente, incluyendo rutas con OneDrive.
- `USERPROFILE` debe estar definido (lo está en todas las instalaciones estándar de Windows).

### macOS
- El escritorio se resuelve via `os.homedir() + /Desktop`.
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
