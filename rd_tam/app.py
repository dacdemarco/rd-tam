"""Local desktop shell. The web channel is exposed only to bundled UI files."""
import base64
import json
import os
import re
from pathlib import Path
import sys
import uuid

from PySide6.QtCore import QObject, QTimer, QUrl, Signal, Slot, QStandardPaths
from PySide6.QtGui import QColor, QIcon
from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow, QMessageBox
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView

from .engine import QueueManager, MODELS, LANGUAGES

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))


def data_directory():
    base = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else ROOT
    if sys.platform == 'darwin' and base.name == 'MacOS':
        base = base.parents[2]
    override = os.environ.get('RD_TAM_DATA_DIR')
    if override:
        result = Path(override).expanduser()
    elif (base / 'portable.flag').exists():
        result = base / 'data'
    else:
        result = Path(QStandardPaths.writableLocation(QStandardPaths.AppLocalDataLocation))
    result.mkdir(parents=True, exist_ok=True)
    return result


def chart_document(figure):
    if not isinstance(figure, dict):
        raise ValueError('Gráfica no válida')
    figures = figure.get('figures', [figure])
    if not figures or any(not isinstance(f, dict) or not isinstance(f.get('data'), list) for f in figures):
        raise ValueError('Gráfica no válida')
    paper = (figures[0].get('layout') or {}).get('paper_bgcolor')
    background = paper if isinstance(paper, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', paper) else '#EFEBE1'
    figure = {'figures': figures}
    payload = json.dumps(figure, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    plotly = (ROOT / 'web/vendor/plotly.min.js').read_text(encoding='utf-8')
    return '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Análisis</title><style>body{margin:0;background:' + background + ";font-family:ui-monospace,'Cascadia Mono',Consolas,monospace}.plot{min-height:420px;height:70vh}</style>" + '<main id="plots"></main><script>' + plotly + '</script><script>const figure=' + payload + ';figure.figures.forEach((f,i)=>{const d=document.createElement("div");d.className="plot";document.getElementById("plots").append(d);Plotly.newPlot(d,f.data,f.layout,{...f.config,responsive:true,scrollZoom:true,displaylogo:false});});</script></html>'


class LocalPage(QWebEnginePage):
    def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
        if not is_main_frame:
            return url.scheme() in ('file', 'qrc', 'data', 'blob')
        return url.isLocalFile() and Path(url.toLocalFile()).resolve() == (ROOT / 'web/index.html').resolve()


class Bridge(QObject):
    stateChanged = Signal(str)
    documentsLoaded = Signal(str)
    notified = Signal(str)

    def __init__(self, window, data_dir):
        super().__init__(window)
        self.window = window
        self.manager = QueueManager(data_dir)
        self.last_state = ''
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(300)

    @Slot(result=str)
    def config(self):
        return json.dumps({'models': MODELS, 'languages': LANGUAGES, 'platform': 'desktop'}, ensure_ascii=False)

    @Slot()
    def ready(self):
        self.last_state = ''
        self.poll()

    def poll(self):
        try:
            state = json.dumps(self.manager.tick(), ensure_ascii=False)
            if state != self.last_state:
                self.stateChanged.emit(state)
                self.last_state = state
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str, str)
    def openMedia(self, model, language):
        paths, _ = QFileDialog.getOpenFileNames(self.window, 'Abrir audio o video', '', 'Audio y video (*.*)')
        if paths:
            try:
                self.manager.add_files(paths, model=model, language=language or None)
                self.poll()
            except Exception as exc:
                self.notified.emit(str(exc))

    @Slot(str, str)
    def startJobs(self, model, language):
        try:
            self.manager.start_waiting(model, language or None)
            self.poll()
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str)
    def downloadModel(self, model):
        try:
            self.manager.download_model(model)
            self.poll()
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str)
    def cancelDownload(self, model):
        self.manager.cancel_download(model)

    @Slot(str)
    def pause(self, job_id):
        try:
            self.manager.pause(job_id)
            self.poll()
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str)
    def resume(self, job_id):
        try:
            self.manager.resume(job_id)
            self.poll()
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str)
    def cancel(self, job_id):
        try:
            self.manager.cancel(job_id)
            self.poll()
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str, str)
    def exportJob(self, job_id, formats):
        directory = QFileDialog.getExistingDirectory(self.window, 'Exportar transcripción')
        if directory:
            try:
                paths = self.manager.export(job_id, directory, tuple(json.loads(formats)))
                self.notified.emit(f'Exportado · {len(paths)} archivo(s)')
            except Exception as exc:
                self.notified.emit(str(exc))

    @Slot()
    def openAnalysis(self):
        paths, _ = QFileDialog.getOpenFileNames(self.window, 'Abrir transcripciones', '', 'Transcripciones (*.txt *.srt)')
        docs = []
        for filename in paths:
            try:
                path = Path(filename)
                if path.stat().st_size > 80 * 1024 * 1024:
                    raise ValueError('El archivo supera 80 MB')
                raw = path.read_bytes()
                if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
                    content = raw.decode('utf-16')
                else:
                    try:
                        content = raw.decode('utf-8-sig')
                    except UnicodeDecodeError:
                        content = raw.decode('cp1252')
                docs.append({'id': uuid.uuid4().hex, 'name': path.name, 'text': content})
            except Exception as exc:
                self.notified.emit(f'{Path(filename).name}: {exc}')
        if docs:
            self.documentsLoaded.emit(json.dumps(docs, ensure_ascii=False))

    def save(self, name, content, kind):
        filename, _ = QFileDialog.getSaveFileName(self.window, 'Exportar', Path(name).name, kind)
        if filename:
            try:
                if isinstance(content, bytes):
                    Path(filename).write_bytes(content)
                else:
                    Path(filename).write_text(content, encoding='utf-8')
                self.notified.emit('Exportado')
            except Exception as exc:
                self.notified.emit(str(exc))

    @Slot(str, str)
    def saveText(self, name, content):
        self.save(name, content, 'Texto (*.txt *.html)')

    @Slot(str, str)
    def saveImage(self, name, data_url):
        try:
            if not data_url.startswith('data:image/png;base64,'):
                raise ValueError('Imagen no válida')
            self.save(name, base64.b64decode(data_url.split(',', 1)[1], validate=True), 'PNG (*.png)')
        except Exception as exc:
            self.notified.emit(str(exc))

    @Slot(str, str)
    def saveChart(self, name, figure_json):
        try:
            self.save(name, chart_document(json.loads(figure_json)), 'HTML (*.html)')
        except Exception as exc:
            self.notified.emit(str(exc))


class Window(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('RD-TAM')
        self.setWindowIcon(QIcon(str(ROOT / 'assets/icon.png')))
        self.resize(1360, 900)
        self.setMinimumSize(960, 660)
        self.view = QWebEngineView(self)
        self.page = LocalPage(self.view)
        self.page.setBackgroundColor(QColor('#0D1114'))  # the logo stage's black, so opening does not flash white
        self.view.setPage(self.page)
        self.view.settings().setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, False)
        self.bridge = Bridge(self, data_directory())
        self.channel = QWebChannel(self.page)
        self.channel.registerObject('native', self.bridge)
        self.page.setWebChannel(self.channel)
        self.setCentralWidget(self.view)
        self.view.load(QUrl.fromLocalFile(str(ROOT / 'web/index.html')))

    def closeEvent(self, event):
        busy = any(j['status'] in ('processing', 'paused', 'pending') for j in self.bridge.manager.snapshot()['jobs'])
        if busy:
            answer = QMessageBox.question(self, 'Cerrar', 'Hay transcripciones en curso. ¿Cerrar y cancelarlas?', QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if answer != QMessageBox.Yes:
                event.ignore()
                return
        self.bridge.manager.close()
        event.accept()


def run():
    app = QApplication(sys.argv)
    app.setOrganizationName('RD')
    app.setApplicationName('RD-TAM')
    app.setWindowIcon(QIcon(str(ROOT / 'assets/icon.png')))
    window = Window()
    window.show()
    sys.exit(app.exec())
