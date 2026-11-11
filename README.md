# RD-TAM — Transcripción y Análisis Multimedia

Aplicación de escritorio para transcribir audio y video en el propio equipo con Whisper y para buscar palabras clave en contexto (KWIC) dentro de textos. Tiene dos pestañas: **Transcribir** y **Análisis**.

## Versión para navegador

La edición web solo incluye **Análisis**: abre archivos TXT/SRT, busca palabras en contexto y exporta las gráficas. Funciona en Safari (también en iPad), Chrome y Edge recientes, en https://dacdemarco.github.io/rd-tam/. La transcripción solo existe en la aplicación de escritorio, porque en un navegador sería mucho más lenta y Safari la detiene cuando la pantalla se apaga. Los archivos se leen en el navegador y no se suben a ningún servidor.

Cada cambio en `main` vuelve a publicar la página (`.github/workflows/pages.yml`). Para construirla y abrirla en local:

```sh
npm ci
npm run build
python scripts/launch_browser.py
```

La salida queda en `dist/browser`, y el último comando la abre con un servidor local. Abrir `index.html` con doble clic no funciona.

## Distribución de escritorio

Cada sistema necesita su propio binario: una carpeta de Windows no funciona en macOS. Los modelos descargados sí se pueden compartir entre sistemas.

| Sistema | Paquete portátil | Instalación |
| --- | --- | --- |
| Windows x64 | Descomprimir el ZIP y abrir `RD-TAM.exe` dentro de la carpeta completa. | Ejecutar el archivo `*-setup.exe`, cuando se haya generado con Inno Setup. |
| macOS Apple Silicon | Descomprimir el ZIP correspondiente y abrir `RD-TAM.app`. | Abrir el DMG y arrastrar la aplicación a Aplicaciones. |

El código y los scripts de construcción son multiplataforma, pero un binario solo está verificado en el sistema donde se construyó y probó. Los paquetes no están firmados (Windows) ni notarizados (Apple), así que el sistema puede avisar de que la aplicación no es reconocida.

### USB y uso sin conexión

Conserva la carpeta completa, incluido `_internal` en Windows. `portable.flag` hace que los datos y modelos se guarden en `data/` junto al ejecutable; en macOS, junto a `RD-TAM.app`. Usa una carpeta con permiso de escritura. Una USB de solo lectura no sirve para descargar modelos o guardar la sesión.

Cada modelo se descarga desde su botón en la casilla **Modelo**, que muestra porcentaje, velocidad y tiempo restante. Una descarga interrumpida continúa donde quedó. Después, ese modelo funciona sin conexión. El audio y video se procesan en el equipo, sin enviarlos a un servicio de transcripción. Para preparar los tres modelos antes de entregar una USB, desde el entorno de desarrollo:

```sh
python scripts/download_models.py --data-dir dist/RD-TAM/data
```

Para macOS, indica como `--data-dir` la carpeta `data` que esté junto a la aplicación portátil. Los pesos pueden ocupar varios GB; la descarga inicial y su velocidad dependen de la conexión. No es necesario incluir los tres modelos: se puede añadir `--models tiny` o `--models tiny small`.

## Uso

- En **Transcribir**, ningún modelo viene elegido. Descarga el que quieras desde su casilla, elígelo, abre uno o varios archivos en cualquier orden, elige el idioma y pulsa **Transcribir**. Nada empieza antes de eso. Se procesa un archivo a la vez. La cola identifica los pendientes y el archivo en proceso. Puedes pausar, reanudar o cancelar. El texto aparece a medida que Whisper entrega segmentos; no es un dictado instantáneo palabra por palabra.
- Selecciona TXT, SRT o ambos y exporta la transcripción. Los SRT conservan los tiempos.
- En **Análisis**, abre archivos TXT/SRT, busca palabras o frases y ajusta el número de palabras de contexto. Explora la línea de tiempo, la frecuencia de palabras, el texto continuo y las coincidencias KWIC. Las gráficas se exportan como PNG o HTML interactivo.
- En un TXT sin tiempos, el eje representa posición en el texto. La herramienta no inventa marcas temporales. Cuando hay TXT y SRT juntos, sus ejes se muestran por separado.

### Modelos

| Nivel | Whisper | Criterio |
| --- | --- | --- |
| Rápido | `tiny` multilingüe | Menor consumo y menor precisión. |
| Equilibrado | `small` multilingüe | Compromiso entre precisión, memoria y tiempo. |
| Preciso | `medium` multilingüe | Mayor precisión potencial y consumo. |

La ejecución de escritorio usa CPU e inferencia INT8 para no exigir una GPU específica. La velocidad y precisión dependen del equipo, el idioma y el audio; los niveles no garantizan un tiempo fijo. La estimación de tiempo se calcula durante el procesamiento y excluye la pausa. Durante descarga/carga de modelos no se muestra un porcentaje ficticio de transcripción.

Se aceptan los contenedores y códecs que pueda decodificar la versión incluida de PyAV/FFmpeg, incluidos los formatos habituales de audio y video. Ninguna herramienta puede garantizar todos los formatos existentes, archivos corruptos, cifrados o medios sin pista de audio. Los errores se informan por archivo y la cola puede continuar.

## Ejecutar desde el código

Requiere Python 3.11 de 64 bits. En Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python main.py
```

En macOS:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python main.py
```

Plotly y los recursos se cargan desde `assets/` y `web/vendor/`, así que la versión de escritorio no necesita conexión a un CDN.

## Construir instaladores y archivos portátiles

Construye en el sistema y arquitectura de destino con el entorno activado:

```sh
python scripts/build.py
```

Los resultados aparecen en `dist/`. Windows genera el instalador si encuentra [Inno Setup 6](https://jrsoftware.org/isinfo.php). Para exigirlo o indicar su ubicación:

```powershell
python scripts/build.py --installer --iscc "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
```

Después de añadir modelos a un paquete portátil de Windows, `python scripts/build.py --skip-freeze` actualiza el archivo comprimido sin volver a compilar. El instalador de Windows conserva los datos de usuario aparte y no incluye el directorio portátil `data`.

Para incluir una carpeta de modelos ya preparada en cualquier paquete portátil, usa `python scripts/build.py --skip-freeze --models-dir data/models`.

El flujo `.github/workflows/build.yml` construye Windows x64 y macOS Apple Silicon en sus propios runners y ejecuta `--self-test` y `--smoke-test` sobre el binario compilado. Se activa manualmente o con una etiqueta `v*`; con la etiqueta, o indicando `release_tag` en la ejecución manual, publica los instaladores en una Release. Tiene una opción para incluir los tres modelos en los paquetes portátiles.

## Verificación

El ZIP portátil de Windows incluye el modelo **Rápido** (`tiny`). Los modelos Equilibrado y Preciso se descargan desde su casilla. El instalador guarda los modelos en el perfil del usuario y no incluye ninguno.

CI construye y prueba la aplicación en Windows x64 y macOS Apple Silicon. Comprobaciones:

```sh
python -m pytest tests -q              # motor, interfaz y exportaciones
npm test                               # análisis KWIC
node scripts/test-browser.mjs --browser=edge   # edición web construida
python main.py --self-test
python main.py --smoke-test
```

Las pruebas opcionales de integración están en `scripts/test-browser.mjs` y `scripts/test_transcription.py`; requieren respectivamente Playwright/Edge y un modelo tiny local con los archivos de prueba indicados por el script. `python main.py --self-test` comprueba las bibliotecas y `python main.py --smoke-test` abre y verifica la ventana. El ejecutable compilado admite los mismos argumentos. `RD-TAM.exe --browser` abre la herramienta de análisis web incluida sin requerir Python o Node en el equipo receptor.

Antes de publicar una distribución, ábrela y pruébala con audio real en su plataforma. Que compile no demuestra que funcionen los permisos, los diálogos de archivos ni la carga del motor.

Los componentes de terceros y sus licencias están en [THIRD_PARTY.md](THIRD_PARTY.md).
