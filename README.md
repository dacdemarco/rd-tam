# RD-TAM — Transcripción y Análisis Multimedia

Aplicación de escritorio para transcribir audio y video localmente con Whisper y explorar textos mediante palabras clave en contexto (KWIC). La interfaz tiene las pestañas **Transcribir** y **Análisis**, temas claro/oscuro y la identidad RD.

## Versión para navegador

La edición web está pensada para versiones recientes de Chrome, Edge y Safari. Procesa los archivos dentro del navegador con Whisper y WebAssembly; no necesita una clave de API ni sube el material a un servidor. Su compatibilidad debe verificarse en cada navegador antes de distribuir una versión definitiva. El rendimiento depende de la memoria y CPU del dispositivo.

El archivo `release/RD-TAM-navegador.zip` contiene una web estática. Para compartirla mediante un enlace, extrae su contenido completo en un alojamiento estático HTTPS. Para usar el paquete local, sirve la carpeta por HTTP en `localhost`: con Python 3 instalado puedes ejecutar `Iniciar.py` o, en Windows, `Iniciar-Windows.cmd`. **Abrir `index.html` con doble clic no sirve** para cargar los motores WebAssembly. Un enlace compartido de Drive/Dropbox que solo descarga archivos tampoco reemplaza un alojamiento web.

Los modelos web se descargan al usarlos por primera vez y el navegador puede guardarlos en su caché. La caché puede borrarse o ser expulsada por el navegador, así que no garantiza uso permanente sin conexión. Los modelos web y los modelos de escritorio usan formatos diferentes. El navegador admite archivos de hasta 512 MB y el límite práctico puede ser menor por la memoria necesaria para decodificar y transcribir; para grabaciones extensas, usa la edición de escritorio. Los formatos nativos se decodifican con Web Audio y los demás se intentan con FFmpeg incluido en la distribución.

Construcción de la web con Node.js y las dependencias del proyecto:

```sh
npm ci
npm run build
python scripts/package_web.py
python scripts/launch_browser.py
```

La salida estática queda en `dist/browser`; el último comando abre esa copia en el navegador con un servidor accesible únicamente desde el equipo local. El código de los lanzadores no recibe ni guarda el contenido de los archivos de audio/video.

El ZIP web también incluye **Iniciar.exe** para Windows: extrae la carpeta completa y ábrelo para usar el navegador sin instalar Python. Cierra su ventana de consola para detener el servidor. En macOS usa un alojamiento HTTPS o el lanzador Python incluido.

## Distribución de escritorio

Cada sistema necesita su propio binario. Una carpeta de Windows no funciona en macOS. Los modelos descargados sí se pueden compartir entre las versiones de escritorio.

| Sistema | Paquete portátil | Instalación |
| --- | --- | --- |
| Windows x64 | Descomprimir el ZIP y abrir `RD-TAM.exe` dentro de la carpeta completa. | Ejecutar el archivo `*-setup.exe`, cuando se haya generado con Inno Setup. |
| macOS Apple Silicon | Descomprimir el ZIP correspondiente y abrir `RD-TAM.app`. | Abrir el DMG y arrastrar la aplicación a Aplicaciones. |

El código y las recetas de construcción son multiplataforma. Los binarios solo se pueden considerar verificados en los sistemas donde se hayan construido y probado. Este repositorio no incluye certificados de firma de Windows ni notarización de Apple; los sistemas pueden mostrar sus avisos de aplicación no reconocida.

### USB y uso sin conexión

Conserva la carpeta completa, incluido `_internal` en Windows. `portable.flag` hace que los datos y modelos se guarden en `data/` junto al ejecutable; en macOS, junto a `RD-TAM.app`. Usa una carpeta con permiso de escritura. Una USB de solo lectura no sirve para descargar modelos o guardar la sesión.

Cada modelo se descarga desde su botón en la casilla **Modelo**, que muestra porcentaje, velocidad y tiempo restante. Una descarga interrumpida continúa donde quedó. Después, ese modelo funciona sin conexión. El audio y video se procesan en el equipo, sin enviarlos a un servicio de transcripción. Para preparar los tres modelos antes de entregar una USB, desde el entorno de desarrollo:

```sh
python scripts/download_models.py --data-dir dist/RD-TAM/data
```

Para macOS, indica como `--data-dir` la carpeta `data` que esté junto a la aplicación portátil. Los pesos pueden ocupar varios GB; la descarga inicial y su velocidad dependen de la conexión. No es necesario incluir los tres modelos: se puede añadir `--models tiny` o `--models tiny small`.

## Interfaz

Tiene dos temas. El de día, «Oficina», usa papel beige, tinta azul marino y azul pastel. El de noche, «Terminal», usa ámbar sobre negro con datos en cian. Todo el texto va en Departure Mono, una fuente de píxel. Los iconos están dibujados en una rejilla de 24 píxeles. Al abrir, un trazo de luz dibuja el logo, que se desliza a su lugar, y cada casilla se ensambla con líneas y bandas; un clic o una tecla lo saltan. Toda la ventana lleva grano de película. Las animaciones siempre están activas, aunque el sistema pida reducir el movimiento. El detalle está en `docs/design-reference.txt`; el muestrario de desarrollo, en `web/specimen.html`.

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

Los recursos gráficos y Plotly se cargan desde `assets/` y `web/vendor/`; no se requiere CDN para el escritorio. Si se están regenerando los recursos, usa `scripts/prepare_assets.py` con los archivos de marca disponibles.

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
python -m pytest tests -q              # motor, contrato de interfaz, exportaciones
npm test                               # análisis KWIC
node scripts/check-contrast.mjs        # contraste AA de los dos temas
node scripts/check-logo.mjs            # logo vectorial fiel al original
node scripts/test-design.mjs           # diseño, iconos, movimiento y foco por teclado
node scripts/test-browser.mjs --browser=edge   # edición web construida
python main.py --self-test
python main.py --smoke-test
```

Las pruebas opcionales de integración están en `scripts/test-browser.mjs` y `scripts/test_transcription.py`; requieren respectivamente Playwright/Edge y un modelo tiny local con los archivos de prueba indicados por el script. `python main.py --self-test` comprueba las bibliotecas y `python main.py --smoke-test` abre y verifica la ventana. El ejecutable compilado admite los mismos argumentos. `RD-TAM.exe --browser` abre la versión web incluida sin requerir Python o Node en el equipo receptor.

Además de las pruebas automatizadas, cada distribución debe abrirse y probarse con audio real en su plataforma antes de publicarse. Compilar correctamente no verifica por sí solo los permisos, las ventanas de archivos, la carga del motor o la reproducción del diseño en otra plataforma.

## Nombre

El nombre oficial es **RD-TAM — Transcripción y Análisis Multimedia**. RD-TAM se usa en los paquetes y accesos directos; la interfaz muestra el logo RD.

Consulta [THIRD_PARTY.md](THIRD_PARTY.md) para las fuentes y avisos de componentes.
