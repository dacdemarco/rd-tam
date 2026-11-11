# Componentes y referencias

RD-TAM usa los siguientes proyectos. Este archivo no asigna una licencia al código propio de RD-TAM.

| Componente | Uso | Fuente y licencia |
| --- | --- | --- |
| Whisper | Modelos de reconocimiento de voz | [OpenAI Whisper, MIT](https://github.com/openai/whisper/blob/main/LICENSE) |
| faster-whisper | Inferencia local | [SYSTRAN, MIT](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE) |
| CTranslate2 | Motor de inferencia | [OpenNMT, MIT](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE) |
| PySide6 / Qt | Ventana, puente local y Qt WebEngine | [Qt for Python licensing](https://doc.qt.io/qtforpython-6/licenses.html) |
| PyAV / FFmpeg | Decodificación de audio y video | [PyAV](https://github.com/PyAV-Org/PyAV/blob/main/LICENSE.txt), [FFmpeg licensing](https://ffmpeg.org/legal.html) |
| Plotly.js | Gráficas interactivas y exportación | [Plotly, MIT](https://github.com/plotly/plotly.js/blob/master/LICENSE) |
| Departure Mono 1.500 | Fuente de la interfaz | [Departure Mono, SIL OFL 1.1](https://github.com/rektdeckard/departure-mono); licencia en `licenses/fonts/DepartureMono-OFL.txt` |
| pixelarticons 2.4.2 | Iconos de la interfaz | [pixelarticons, MIT](https://github.com/halfmage/pixelarticons); aviso completo al final de este archivo |
| psutil | Pausa, reanudación y cancelación de procesos | [psutil, BSD 3-Clause](https://github.com/giampaolo/psutil/blob/master/LICENSE) |
| PyInstaller | Generación de paquetes de escritorio | [Licencia y excepción de distribución](https://pyinstaller.org/en/stable/license.html) |

La construcción copia los avisos de licencia de las distribuciones de Python instaladas a `_internal/licenses` (o al paquete de macOS), junto con un inventario de versiones. Qt/Chromium y los códecs pueden traer avisos adicionales en sus propios recursos. Esa copia automática no sustituye revisar las obligaciones de licencia antes de distribuir una versión públicamente.

El análisis KWIC está escrito para esta herramienta. [mattbriggs/KWIC](https://github.com/mattbriggs/KWIC) sirvió de referencia conceptual, pero no se incorpora su código.

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
