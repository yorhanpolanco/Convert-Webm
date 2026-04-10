# 🎬 Video Tools CLI

CLI simple, rápida y profesional para convertir videos **MP4 → WebM** directamente desde tu escritorio usando **FFmpeg** y Node.js.

---

## 🚀 Características

- ✅ Conversión automática a **WebM (VP9 + Opus)**
- ✅ Solo necesitas el **nombre del archivo**
- ✅ Asume archivos ubicados en el **Desktop**
- ✅ Validación de existencia del archivo
- ✅ Progreso en tiempo real en consola
- ✅ Manejo de errores robusto
- ✅ Configuración optimizada (calidad vs tamaño)
- ✅ Ejecutable global tipo comando (`convert-webm`)

---

## 📦 Instalación

### 1. Clonar el proyecto (o crear manualmente)

```bash
git clone <repo-url>
cd video-tools
```

### 2. Instalar dependencias

```bash
npm install
```

---

## 🔗 Registrar comando global

Para usar el comando desde cualquier ubicación del sistema:

```bash
npm link
```

---

## ▶️ Uso

Desde cualquier carpeta (incluyendo el escritorio):

```bash
convert-webm video.mp4
```

---

## 🧪 Ejemplo

```bash
convert-webm vacaciones.mp4
```

### 📥 Input
```
C:\Users\<usuario>\Desktop\vacaciones.mp4
```

### 📤 Output
```
C:\Users\<usuario>\Desktop\vacaciones.webm
```

---

## ⚙️ Configuración de conversión

El script utiliza:

- 🎥 Video Codec: **VP9 (`libvpx-vp9`)**
- 🔊 Audio Codec: **Opus (`libopus`)**
- ⚖️ Modo: **calidad constante**

### Parámetros aplicados:

```
-crf 30
-b:v 0
-deadline good
```

---

## 🎯 Ajuste de calidad

| Nivel       | CRF |
|------------|-----|
| Alta       | 28  |
| Balance    | 30  |
| Comprimido | 32–35 |

> 🔽 Menor CRF = mejor calidad (archivo más pesado)  
> 🔼 Mayor CRF = menor tamaño (más compresión)

---

## 📁 Estructura del proyecto

```
video-tools/
│
├── convert.js       # Script principal CLI
├── package.json     # Configuración del proyecto
└── README.md        # Documentación
```

---

## 🧠 Cómo funciona

1. Recibe el nombre del archivo como argumento
2. Construye la ruta al escritorio automáticamente
3. Verifica que el archivo exista
4. Ejecuta FFmpeg usando fluent-ffmpeg
5. Genera el archivo `.webm` en el mismo escritorio

---

## ⚠️ Requisitos

- Node.js ≥ 16
- npm ≥ 8

Dependencias:

- `@ffmpeg-installer/ffmpeg`
- `fluent-ffmpeg`

---

## 🐛 Troubleshooting

### ❌ `convert-webm` no es reconocido

Ejecuta:

```bash
npm link
```

Luego reinicia la terminal.

---

### ❌ Archivo no encontrado

Asegúrate de:

- El archivo está en el escritorio
- El nombre coincide exactamente (incluyendo extensión)

---

### ❌ Conversión lenta

Esto es normal con VP9 (alta compresión).

Opciones:

- Aumentar `crf` (ej: 32–35)
- Cambiar `deadline` a `realtime` (menos calidad, más rápido)

---

### ❌ Error de permisos

Ejecuta PowerShell como administrador (en casos raros).

---

## 🔥 Uso avanzado (futuro)

Ejemplos de posibles mejoras:

```bash
convert-webm video.mp4 --quality=high
convert-webm video.mp4 --output=C:\videos
convert-webm *.mp4
convert-webm video.mp4 --parallel=4
```

---

## 🧠 Roadmap

- [ ] Soporte para múltiples archivos
- [ ] Parámetros CLI (`--quality`, `--output`)
- [ ] Procesamiento en paralelo
- [ ] Detección automática de resolución
- [ ] Barra de progreso avanzada
- [ ] Soporte cross-platform (Mac/Linux)

---

## 📄 Licencia

MIT

---

## 👨‍💻 Autor

Herramienta desarrollada para automatización de conversión de video y flujos de trabajo eficientes.

---

## ⭐ Filosofía

> Simplicidad + Automatización + Performance

---

## 🔗 Tecnologías usadas

- Node.js
- FFmpeg
- fluent-ffmpeg

---

## 🏁 Conclusión

Este CLI está diseñado para ser:

- ⚡ Rápido de usar  
- 🧠 Inteligente en defaults  
- 🔧 Extensible  
- 💼 Profesional  

Ideal para automatizar conversiones sin complicaciones.
