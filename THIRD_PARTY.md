# Componentes y referencias

RD-TAM usa los siguientes proyectos. Las marcas y los logos RD proporcionados por el titular conservan sus derechos. Este archivo no asigna una licencia al código propio de RD-TAM.

| Componente | Uso | Fuente y licencia |
| --- | --- | --- |
| Whisper | Modelos de reconocimiento de voz | [OpenAI Whisper, MIT](https://github.com/openai/whisper/blob/main/LICENSE) |
| faster-whisper | Inferencia local | [SYSTRAN, MIT](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE) |
| CTranslate2 | Motor de inferencia | [OpenNMT, MIT](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE) |
| PySide6 / Qt | Ventana, puente local y Qt WebEngine | [Qt for Python licensing](https://doc.qt.io/qtforpython-6/licenses.html) |
| PyAV / FFmpeg | Decodificación de audio y video | [PyAV](https://github.com/PyAV-Org/PyAV/blob/main/LICENSE.txt), [FFmpeg licensing](https://ffmpeg.org/legal.html) |
| Plotly.js | Gráficas interactivas y exportación | [Plotly, MIT](https://github.com/plotly/plotly.js/blob/master/LICENSE) |
| Departure Mono 1.500 | Tipografía de etiquetas, tiempos y títulos (11/22 px) | [Departure Mono, SIL OFL 1.1](https://github.com/rektdeckard/departure-mono); licencia en `licenses/fonts/DepartureMono-OFL.txt` |
| pixelarticons 2.4.2 | Iconos pixel de la interfaz (adaptados a mano a la rejilla de 24) | [pixelarticons, MIT](https://github.com/halfmage/pixelarticons); aviso completo al final de este archivo |
| psutil | Pausa, reanudación y cancelación de procesos | [psutil, BSD 3-Clause](https://github.com/giampaolo/psutil/blob/master/LICENSE) |
| PyInstaller | Generación de paquetes de escritorio | [Licencia y excepción de distribución](https://pyinstaller.org/en/stable/license.html) |
| Transformers.js / ONNX Runtime Web | Inferencia Whisper en el navegador | [Transformers.js, Apache 2.0](https://github.com/huggingface/transformers.js/blob/main/LICENSE), [ONNX Runtime, MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| ffmpeg.wasm | Decodificación adicional en el navegador | [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/LICENSE), [licencias de los núcleos y códecs](https://ffmpegwasm.netlify.app/docs/overview/) |

La construcción recopila los avisos de licencia incluidos en las distribuciones de Python instaladas y los coloca en `_internal/licenses` (o dentro del paquete de macOS), con un inventario de versiones. Los paquetes Qt/Chromium y los códecs pueden incluir avisos adicionales dentro de sus recursos. La colección automática no sustituye la revisión de las obligaciones aplicables antes de distribuir públicamente una versión firmada.

El análisis KWIC se implementa específicamente para esta herramienta: se usa como referencia conceptual [mattbriggs/KWIC](https://github.com/mattbriggs/KWIC) y como referencia funcional unas capturas de pantalla. No se incorpora el código de ese repositorio.

El estilo es papel y tinta, terminal y fósforo: superficies planas, reglas de 1px, toda la interfaz en Departure Mono, grano de película y líneas de vector. Referencias de tono (sin recursos incorporados): la oficina Lumon de *Severance* para el día y la terminal CRT de *Alien: Isolation* para la noche. La composición se documenta en `docs/design-reference.txt`.

## Aviso MIT de pixelarticons

```
MIT License

Copyright (c) 2019 Gerrit Halfmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
