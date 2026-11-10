(function (global) {
  'use strict';

  const WORD = /[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu;
  const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
  const STOPWORDS = new Set(('a al algo algunas algunos ante antes como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estaban estado estamos estan estar estas este esto estos estoy fue fueron ha habia han hasta hay la las le les lo los mas me mi mis muy nada ni no nos nosotros o otra otras otro otros para pero poco por porque que quien se sea ser si sin sobre son su sus te tengo ti tiene tienen toda todas todo todos tu tus un una unas uno unos usted va vamos y ya yo ' +
    'a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves').split(/\s+/));

  function normalize(value) {
    return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
  }

  function words(value) {
    return Array.from(String(value).matchAll(WORD), match => ({text: match[0], key: normalize(match[0]), start: match.index, end: match.index + match[0].length}));
  }

  function mappedText(value) {
    let normalized = '', starts = [], ends = [], offset = 0;
    for (const character of String(value)) {
      const end = offset + character.length;
      let part = character.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
      if (/\s/u.test(part)) part = ' ';
      if (!part || (part === ' ' && normalized.endsWith(' '))) {
        if (ends.length) ends[ends.length - 1] = end;
      } else {
        normalized += part;
        for (let index = 0; index < part.length; index += 1) { starts.push(offset); ends.push(end); }
      }
      offset = end;
    }
    return {text: normalized, starts, ends};
  }

  function matchesIn(text, query) {
    const needle = normalize(query);
    if (!needle) return [];
    const mapped = mappedText(text);
    const result = [];
    const needleCharacters = Array.from(needle);
    const needsStartBoundary = WORD_CHAR.test(needleCharacters[0]);
    const needsEndBoundary = WORD_CHAR.test(needleCharacters[needleCharacters.length - 1]);
    let from = 0;
    while (from <= mapped.text.length) {
      const index = mapped.text.indexOf(needle, from);
      if (index < 0) break;
      const end = index + needle.length;
      const previous = Array.from(mapped.text.slice(Math.max(0, index - 2), index)).pop() || '';
      const next = end < mapped.text.length ? String.fromCodePoint(mapped.text.codePointAt(end)) : '';
      const boundaryStart = !needsStartBoundary || !WORD_CHAR.test(previous);
      const boundaryEnd = !needsEndBoundary || !WORD_CHAR.test(next);
      if (boundaryStart && boundaryEnd) result.push({start: mapped.starts[index], end: mapped.ends[end - 1]});
      from = end;
    }
    return result;
  }

  function timestamp(value) {
    const match = String(value).trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!match || +match[2] > 59 || +match[3] > 59) throw new Error('Marca de tiempo SRT inválida.');
    return +match[1] * 3600 + +match[2] * 60 + +match[3] + +(match[4].padEnd(3, '0')) / 1000;
  }

  function formatTime(value, milliseconds = false) {
    const ms = Math.max(0, Math.round((Number(value) || 0) * 1000));
    const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const minutes = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}${milliseconds ? ',' + String(ms % 1000).padStart(3, '0') : ''}`;
  }

  function parseSrt(value) {
    const source = String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!source) return [];
    const blocks = source.split(/\n[\t ]*\n+/);
    return blocks.map((block, index) => {
      const lines = block.split('\n');
      if (/^\d+\s*$/.test(lines[0])) lines.shift();
      const timing = (lines.shift() || '').trim().match(/^(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/);
      if (!timing) throw new Error(`SRT inválido en el segmento ${index + 1}.`);
      const start = timestamp(timing[1]), end = timestamp(timing[2]);
      if (end < start) throw new Error(`El segmento ${index + 1} termina antes de comenzar.`);
      const text = lines.join('\n').replace(/<\/?(?:b|i|u|s|font)(?:\s[^>]*)?>/gi, '').trim();
      if (!text) throw new Error(`El segmento ${index + 1} está vacío.`);
      return {index: index + 1, start, end, text};
    });
  }

  function parseDocument(document) {
    const name = String(document.name || 'Texto.txt');
    const text = String(document.text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const temporal = /\.srt$/i.test(name);
    if (!/\.(?:txt|srt)$/i.test(name)) throw new Error('Selecciona archivos TXT o SRT.');
    let segments;
    if (temporal) segments = parseSrt(text);
    else {
      let position = 0;
      segments = text.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean).map((part, index) => {
        const count = Math.max(1, words(part).length), start = position;
        position += count;
        return {index: index + 1, start, end: position, text: part};
      });
    }
    if (!segments.length) throw new Error(`${name} está vacío.`);
    return {id: String(document.id || `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`), name, temporal, segments, text: segments.map(segment => segment.text).join('\n\n')};
  }

  function contextFor(text, match, around, tokens = words(text)) {
    if (around === 0) return {before: '', keyword: text.slice(match.start, match.end), after: '', prefix: match.start > 0, suffix: match.end < text.length};
    const firstWhere = predicate => {
      let low = 0, high = tokens.length;
      while (low < high) { const middle = Math.floor((low + high) / 2); if (predicate(tokens[middle])) high = middle; else low = middle + 1; }
      return low;
    };
    const beforeCount = firstWhere(token => token.end > match.start);
    const afterIndex = firstWhere(token => token.start >= match.end);
    const left = beforeCount > around ? tokens[beforeCount - around].start : 0;
    const right = tokens.length - afterIndex > around ? tokens[afterIndex + around - 1].end : text.length;
    return {
      before: text.slice(around === 0 ? match.start : left, match.start),
      keyword: text.slice(match.start, match.end),
      after: text.slice(match.end, around === 0 ? match.end : right),
      prefix: around === 0 ? match.start > 0 : left > 0,
      suffix: around === 0 ? match.end < text.length : right < text.length
    };
  }

  function analyze(documents, query, around = 5, excludeStopwords = true) {
    const counts = new Map(), matches = [], matchedSegments = new Set();
    for (const document of documents) {
      for (const segment of document.segments) {
        const tokens = words(segment.text);
        for (const token of tokens) {
          if (!token.key || /^\d+$/.test(token.key) || (excludeStopwords && STOPWORDS.has(token.key))) continue;
          const item = counts.get(token.key) || {word: token.text.toLocaleLowerCase('es'), count: 0};
          item.count += 1;
          counts.set(token.key, item);
        }
        for (const match of matchesIn(segment.text, query)) {
          matchedSegments.add(`${document.id}:${segment.index}`);
          matches.push({document, segment, match, context: contextFor(segment.text, match, Math.max(0, around), tokens)});
        }
      }
    }
    const frequencies = Array.from(counts.values()).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'es')).slice(0, 25);
    return {matches, matchedSegments, frequencies};
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  }

  const icons = { plus:'i-plus', search:'i-search', file:'i-file', close:'i-close', download:'i-download', chart:'i-chart', timeline:'i-timeline', reset:'i-reset', zoomIn:'i-zoom-in', zoomOut:'i-zoom-out', pan:'i-pan' };
  function icon(name) { return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#${icons[name] || icons.file}"/></svg>`; }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }

  class AnalysisController {
    constructor(options) {
      this.options = options;
      this.root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
      this.documents = [];
      this.query = '';
      this.around = 5;
      this.excludeStopwords = true;
      this.theme = document.documentElement.dataset.theme || 'light';
      this.page = 0;
      this.dataPage = 0;
      this.figures = new Map();
      this.enteringDocuments = new Set();
      this.enteringResults = new Set();
      this.build();
      this.refresh();
    }

    build() {
      this.root.classList.add('analysis-layout');
      this.root.innerHTML = `<aside class="analysis-sidebar">
        <div class="analysis-section-label">Archivos <span id="analysis-file-count" hidden></span></div>
        <button class="analysis-open" type="button">${icon('plus')}<span>Abrir archivos</span><span class="analysis-filetype">TXT / SRT</span></button>
        <div class="analysis-files" aria-label="Archivos de análisis"></div>
        <div class="analysis-divider"></div>
        <label class="analysis-section-label" for="analysis-keyword">Palabra clave</label>
        <div class="analysis-search">${icon('search')}<input id="analysis-keyword" type="search" placeholder="Buscar palabra o frase" autocomplete="off" spellcheck="false" aria-label="Palabra clave"/></div>
        <div class="analysis-context-heading"><label class="analysis-section-label" for="analysis-around">Contexto</label><output for="analysis-around">5</output></div>
        <input id="analysis-around" type="range" min="1" max="30" value="5" aria-label="Palabras alrededor"/>
        <div class="analysis-range-labels"><span>1 palabra</span><span>30 palabras</span></div>
        <label class="analysis-stopwords"><input type="checkbox" checked/><span>Excluir stopwords</span></label>
      </aside>
      <div class="analysis-main">
        <header class="analysis-heading"><h1>Análisis</h1><div class="analysis-summary" aria-live="polite"></div></header>
        <div class="analysis-empty"><div class="analysis-empty-glyph">${icon('timeline')}</div><p>TXT / SRT</p></div>
        <div class="analysis-content" hidden>
          <section class="analysis-card analysis-timeline-card"><div class="analysis-card-top"><div><h2>Línea de tiempo</h2></div><div class="analysis-chart-actions"><button type="button" data-action="png">${icon('download')} PNG</button><button type="button" data-action="html">${icon('download')} HTML</button></div></div><div class="analysis-timeline-controls"><div class="analysis-axis-label"></div><div class="analysis-nav"><button type="button" data-nav="zoom-in" title="Acercar" aria-label="Acercar">${icon('zoomIn')}</button><button type="button" data-nav="zoom-out" title="Alejar" aria-label="Alejar">${icon('zoomOut')}</button><button type="button" data-nav="pan" title="Mover" aria-label="Mover" aria-pressed="false">${icon('pan')}</button><button type="button" data-nav="reset" title="Restablecer" aria-label="Restablecer">${icon('reset')}</button></div></div><div class="analysis-plots"></div></section>
          <details class="analysis-data analysis-card"><summary>Ver datos cargados <span class="analysis-data-count"></span></summary><div class="analysis-table-wrap"></div><div class="analysis-pagination analysis-data-pagination" hidden><button type="button" data-data-page="prev">Anterior</button><span></span><button type="button" data-data-page="next">Siguiente</button></div></details>
          <section class="analysis-card analysis-frequency-card"><div class="analysis-card-top"><div><h2>Frecuencia de palabras</h2></div><span class="analysis-subtle">25 más frecuentes</span></div><div class="analysis-frequency"></div></section>
          <section class="analysis-card analysis-kwic-card"><div class="analysis-card-top"><div><h2>KWIC · Contexto</h2></div><span class="analysis-match-count" aria-live="polite"></span></div><div class="analysis-results"></div><div class="analysis-pagination" hidden><button type="button" data-page="prev">Anterior</button><span></span><button type="button" data-page="next">Siguiente</button></div></section>
          <section class="analysis-continuous"><h2>Texto continuo</h2><div></div></section>
        </div>
      </div>`;
      this.$ = selector => this.root.querySelector(selector);
      this.$('.analysis-open').addEventListener('click', () => this.options.openFiles?.());
      this.$('#analysis-keyword').addEventListener('input', event => {
        this.query = event.target.value; this.page = 0;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.refreshResults(), 150);
      });
      this.$('#analysis-around').addEventListener('input', event => {
        this.around = Number(event.target.value); this.$('.analysis-context-heading output').textContent = this.around;
        this.refreshResults(false);
      });
      this.$('.analysis-stopwords input').addEventListener('change', event => { this.excludeStopwords = event.target.checked; this.refreshResults(); });
      this.$('[data-action="png"]').addEventListener('click', () => this.exportPng());
      this.$('[data-action="html"]').addEventListener('click', () => this.exportHtml());
      this.root.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => this.navigate(button.dataset.nav)));
      this.$('[data-page="prev"]').addEventListener('click', () => { this.page -= 1; this.renderMatches(true); });
      this.$('[data-page="next"]').addEventListener('click', () => { this.page += 1; this.renderMatches(true); });
      this.$('[data-data-page="prev"]').addEventListener('click', () => { this.dataPage -= 1; this.renderData(); });
      this.$('[data-data-page="next"]').addEventListener('click', () => { this.dataPage += 1; this.renderData(); });
      this.$('.analysis-data').addEventListener('toggle', () => { if (this.$('.analysis-data').open) this.renderData(); });
    }

    addDocuments(documents) {
      for (const raw of documents || []) {
        try {
          const parsed = parseDocument(raw);
          const old = this.documents.findIndex(document => document.id === parsed.id);
          if (old >= 0) this.documents[old] = parsed; else this.documents.push(parsed);
          this.enteringDocuments.add(parsed.id);
          this.enteringResults.add(parsed.id);
        } catch (error) { this.options.notify?.(`${raw.name || 'Archivo'}: ${error.message}`, 'error'); }
      }
      this.page = 0;
      this.dataPage = 0;
      this.refresh();
    }

    refresh() {
      const hasDocuments = this.documents.length > 0;
      this.$('.analysis-empty').hidden = hasDocuments;
      this.$('.analysis-content').hidden = !hasDocuments;
      this.$('#analysis-file-count').textContent = String(this.documents.length);
      this.$('#analysis-file-count').hidden = !hasDocuments;
      this.$('.analysis-summary').textContent = hasDocuments ? `${this.documents.length} ${this.documents.length === 1 ? 'archivo' : 'archivos'} · ${this.documents.reduce((sum, document) => sum + document.segments.length, 0).toLocaleString('es-MX')} segmentos` : '';
      const list = this.$('.analysis-files'); list.replaceChildren();
      for (const doc of this.documents) {
        const item = el('div', 'analysis-file');
        if (this.enteringDocuments.has(doc.id)) item.classList.add('analysis-file-enter');
        const glyph = el('span', 'analysis-file-icon'); glyph.innerHTML = icon('file');
        const info = el('div', 'analysis-file-info'); info.append(el('span', 'analysis-file-name', doc.name), el('span', 'analysis-file-meta', `${doc.segments.length.toLocaleString('es-MX')} segmentos`)); info.title = doc.name;
        const remove = el('button', 'analysis-file-remove'); remove.type = 'button'; remove.innerHTML = icon('close'); remove.title = `Quitar ${doc.name}`; remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => { this.documents = this.documents.filter(item => item.id !== doc.id); this.page = 0; this.refresh(); });
        item.append(glyph, info, remove); list.append(item);
      }
      this.enteringDocuments.clear();
      this.renderContinuous();
      this.refreshResults();
      if (this.$('.analysis-data').open) this.renderData();
    }

    refreshResults(renderPlots = true) {
      this.result = analyze(this.documents, this.query, this.around, this.excludeStopwords);
      if (renderPlots && this.documents.length) { this.renderTimelines(); this.renderFrequencies(); }
      this.renderMatches();
    }

    palette() {
      const styles = getComputedStyle(this.root);
      const read = name => styles.getPropertyValue(name).trim();
      return {bg: read('--panel'), text: read('--ink'), muted: read('--muted'), line: read('--rule'), action: read('--action'), soft: read('--accent-pastel'), data: read('--data'), control: read('--control')};
    }

    sansFamily() { return getComputedStyle(this.root).fontFamily; }

    monoFamily() { return getComputedStyle(this.root).getPropertyValue('--mono').trim(); }

    plotConfig() { return {displayModeBar: false, responsive: true, scrollZoom: true, displaylogo: false, locale: 'es', doubleClick: 'reset'}; }

    renderTimelines() {
      if (!global.Plotly) return;
      const container = this.$('.analysis-plots'), palette = this.palette();
      const groups = [true, false].map(temporal => ({temporal, documents: this.documents.filter(document => document.temporal === temporal)})).filter(group => group.documents.length);
      const active = new Set(groups.map(group => group.temporal ? 'time' : 'position'));
      for (const [key, figure] of this.figures) if (!active.has(key)) { global.Plotly.purge(figure.element); figure.element.parentElement.remove(); this.figures.delete(key); }
      this.$('.analysis-axis-label').textContent = groups.length === 2 ? 'Tiempo / posición en texto' : groups[0]?.temporal ? 'Horas · minutos · segundos' : 'Posición en texto · palabras';
      for (const group of groups) {
        const key = group.temporal ? 'time' : 'position';
        let figure = this.figures.get(key);
        if (!figure) {
          const wrapper = el('div', 'analysis-timeline-group');
          const label = el('div', 'analysis-plot-label', group.temporal ? 'SRT · Tiempo' : 'TXT · Posición en palabras');
          const plot = el('div', 'analysis-timeline'); wrapper.append(label, plot); container.append(wrapper);
          figure = {element: plot}; this.figures.set(key, figure);
        }
        const segments = [], max = group.documents.reduce((maximum, doc) => doc.segments.reduce((end, segment) => Math.max(end, segment.end), maximum), 1);
        group.documents.forEach((doc, row) => doc.segments.forEach(segment => segments.push({doc, segment, row, matched: this.result.matchedSegments.has(`${doc.id}:${segment.index}`)})));
        const trace = {type: 'bar', orientation: 'h', name: group.temporal ? 'Tiempo' : 'Posición', x: segments.map(item => Math.max(item.segment.end - item.segment.start, max / 3000)), base: segments.map(item => item.segment.start), y: segments.map(item => item.row), width: .52,
          marker: {color: segments.map(item => item.matched ? palette.data : palette.control), line: {color: palette.bg, width: .4}},
          customdata: segments.map(item => [escapeHtml(item.doc.name), group.temporal ? `${formatTime(item.segment.start, true)} — ${formatTime(item.segment.end, true)}` : `${item.segment.start + 1} — ${item.segment.end}`, escapeHtml(item.segment.text.length > 320 ? item.segment.text.slice(0, 317) + '…' : item.segment.text).replace(/\n/g, '<br>')]),
          hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]}<extra></extra>'};
        const tickValues = Array.from({length: 7}, (_, index) => max * index / 6);
        const layout = {paper_bgcolor: palette.bg, plot_bgcolor: palette.bg, font: {family: this.sansFamily(), color: palette.text, size: 11}, margin: {l: 144, r: 24, t: 16, b: 68}, height: Math.max(248, 184 + group.documents.length * 44), bargap: .3, barmode: 'overlay', showlegend: false, dragmode: 'zoom', transition: {duration: 0}, hoverlabel: {bgcolor: palette.bg, bordercolor: palette.control, font: {family: this.sansFamily(), color: palette.text, size: 11}}, uirevision: `timeline-${key}-${group.documents.map(doc => doc.id).join(',')}`,
          xaxis: {range: [0, max * 1.015], gridcolor: palette.line, zeroline: false, tickfont: {family: this.monoFamily(), size: 11, color: palette.muted}, tickmode: 'array', tickvals: tickValues, ticktext: tickValues.map(value => group.temporal ? formatTime(value) : Math.round(value).toLocaleString('es-MX')), rangeslider: {visible: true, thickness: .15, bgcolor: palette.bg, bordercolor: palette.line, borderwidth: 1}, title: {text: group.temporal ? 'Tiempo' : 'Palabras', font: {size: 11, color: palette.muted}}},
          yaxis: {range: [group.documents.length - .4, -.6], tickmode: 'array', tickvals: group.documents.map((_, index) => index), ticktext: group.documents.map(doc => escapeHtml(doc.name.length > 19 ? doc.name.slice(0, 16) + '…' : doc.name)), fixedrange: true, showgrid: false, zeroline: false, tickfont: {family: this.monoFamily(), size: 11, color: palette.muted}}};
        figure.data = [trace]; figure.layout = layout; figure.max = max;
        global.Plotly.react(figure.element, figure.data, layout, this.plotConfig());
        figure.segments = segments;
        figure.element.removeAllListeners?.('plotly_click');
        figure.element.on('plotly_click', event => { const selected = figure.segments[event.points?.[0]?.pointIndex]; if (selected) this.showSegment(selected.doc.id, selected.segment.index); });
        figure.element.removeAllListeners?.('plotly_relayout');
        figure.element.on('plotly_relayout', event => {
          if (!Object.keys(event).some(name => name.startsWith('xaxis.range') || name === 'xaxis.autorange')) return;
          const range = figure.element.layout.xaxis.range || [0, figure.max];
          const values = Array.from({length: 7}, (_, index) => range[0] + (range[1] - range[0]) * index / 6);
          global.Plotly.relayout(figure.element, {'xaxis.tickvals': values, 'xaxis.ticktext': values.map(value => group.temporal ? formatTime(value, range[1] - range[0] < 10) : Math.round(value).toLocaleString('es-MX'))});
        });
      }
    }

    renderFrequencies() {
      if (!global.Plotly) return;
      const palette = this.palette(), frequencies = this.result.frequencies;
      global.Plotly.react(this.$('.analysis-frequency'), [{type: 'bar', x: frequencies.map(item => item.word), y: frequencies.map(item => item.count), marker: {color: palette.data}, hovertemplate: '%{x}: %{y}<extra></extra>'}],
        {paper_bgcolor: palette.bg, plot_bgcolor: palette.bg, height: 300, margin: {l: 48, r: 24, t: 16, b: 100}, font: {family: this.sansFamily(), color: palette.text, size: 11}, xaxis: {tickangle: -45, fixedrange: true, showgrid: false, tickfont: {family: this.sansFamily(), size: 11, color: palette.muted}}, yaxis: {tickfont: {family: this.monoFamily(), size: 11, color: palette.muted}, gridcolor: palette.line, zeroline: false, fixedrange: true, rangemode: 'tozero', dtick: frequencies.length && frequencies[0].count < 6 ? 1 : undefined}, bargap: .32, transition: {duration: 0}}, {displayModeBar: false, responsive: true});
      const plot = this.$('.analysis-frequency');
      plot.removeAllListeners?.('plotly_click');
      plot.on('plotly_click', event => { const word = event.points?.[0]?.x; if (word) { this.query = word; this.$('#analysis-keyword').value = word; this.page = 0; this.refreshResults(); } });
    }

    renderMatches(animatePage = false) {
      if (!this.result) return;
      const results = this.$('.analysis-results'); results.replaceChildren();
      const matches = this.result.matches;
      this.$('.analysis-match-count').textContent = this.query.trim() ? `${matches.length.toLocaleString('es-MX')} ${matches.length === 1 ? 'coincidencia' : 'coincidencias'}` : '';
      const pages = Math.ceil(matches.length / 50);
      this.page = Math.max(0, Math.min(this.page, pages - 1));
      if (!this.query.trim()) results.append(el('div', 'analysis-no-results', 'Busca una palabra o frase.'));
      else if (!matches.length) results.append(el('div', 'analysis-no-results', 'Sin coincidencias.'));
      for (const match of matches.slice(this.page * 50, this.page * 50 + 50)) {
        const row = el('button', 'analysis-result'); row.type = 'button';
        if (animatePage || this.enteringResults.has(match.document.id)) row.classList.add('analysis-result-enter');
        const meta = el('div', 'analysis-result-meta');
        meta.append(el('span', '', match.document.name), el('span', 'analysis-result-time', match.document.temporal ? `${formatTime(match.segment.start, true)} — ${formatTime(match.segment.end, true)}` : `Párrafo ${match.segment.index}`));
        const text = el('div', 'analysis-result-context');
        text.append(document.createTextNode((match.context.prefix ? '…' : '') + match.context.before), el('mark', '', match.context.keyword), document.createTextNode(match.context.after + (match.context.suffix ? '…' : '')));
        row.append(meta, text); row.addEventListener('click', () => this.showSegment(match.document.id, match.segment.index)); results.append(row);
      }
      this.enteringResults.clear();
      this.$('.analysis-kwic-card .analysis-pagination').hidden = pages < 2;
      this.$('.analysis-kwic-card .analysis-pagination span').textContent = `${this.page + 1} / ${Math.max(1, pages)}`;
      this.$('[data-page="prev"]').disabled = this.page === 0;
      this.$('[data-page="next"]').disabled = this.page >= pages - 1;
    }

    renderContinuous() {
      const target = this.$('.analysis-continuous > div'); target.replaceChildren();
      for (const doc of this.documents) {
        const details = el('details', 'analysis-text-document analysis-card'); details.dataset.documentId = doc.id;
        const summary = el('summary'); summary.append(el('span', '', doc.name), el('span', 'analysis-subtle', `${doc.segments.length} segmentos`));
        const body = el('div', 'analysis-fulltext');
        details.append(summary, body);
        details.addEventListener('toggle', () => { if (details.open && !body.childElementCount) this.populateContinuous(doc, body); });
        target.append(details);
      }
    }

    populateContinuous(doc, body) {
      // One paragraph per segment retains timestamps without ever interpreting subtitle markup.
      const fragment = document.createDocumentFragment();
      for (const segment of doc.segments) {
        const paragraph = el('p'); paragraph.dataset.segment = segment.index;
        const stamp = el('span', 'analysis-inline-time', doc.temporal ? formatTime(segment.start) : String(segment.index));
        paragraph.append(stamp, document.createTextNode(segment.text)); fragment.append(paragraph);
      }
      body.append(fragment);
    }

    showSegment(documentId, segmentIndex) {
      const doc = this.documents.find(item => item.id === documentId);
      const details = Array.from(this.root.querySelectorAll('.analysis-text-document')).find(item => item.dataset.documentId === documentId);
      if (!details || !doc) return;
      const body = details.querySelector('.analysis-fulltext');
      if (!body.childElementCount) this.populateContinuous(doc, body);
      details.open = true;
      this.root.querySelectorAll('.analysis-selected-segment').forEach(item => item.classList.remove('analysis-selected-segment'));
      const paragraph = Array.from(body.children).find(item => +item.dataset.segment === segmentIndex);
      if (paragraph) { paragraph.classList.add('analysis-selected-segment'); paragraph.scrollIntoView({block: 'center', behavior: global.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); }
    }

    renderData() {
      const target = this.$('.analysis-table-wrap'); target.replaceChildren();
      const table = el('table'), head = el('thead'), row = el('tr');
      ['Archivo', 'Inicio / posición', 'Fin / posición', 'Texto'].forEach(label => row.append(el('th', '', label))); head.append(row); table.append(head);
      const total = this.documents.reduce((sum, doc) => sum + doc.segments.length, 0);
      const pages = Math.max(1, Math.ceil(total / 200));
      this.dataPage = Math.max(0, Math.min(this.dataPage, pages - 1));
      const body = el('tbody'); let count = 0;
      for (const doc of this.documents) for (const segment of doc.segments) {
        count += 1; if (count <= this.dataPage * 200 || count > this.dataPage * 200 + 200) continue;
        const tr = el('tr');
        [doc.name, doc.temporal ? formatTime(segment.start, true) : segment.start + 1, doc.temporal ? formatTime(segment.end, true) : segment.end, segment.text].forEach(value => tr.append(el('td', '', value)));
        body.append(tr);
      }
      table.append(body); target.append(table);
      this.$('.analysis-data-count').textContent = count > 200 ? `${this.dataPage * 200 + 1}–${Math.min(count, (this.dataPage + 1) * 200)} / ${count}` : `${count}`;
      this.$('.analysis-data-pagination').hidden = pages < 2;
      this.$('.analysis-data-pagination span').textContent = `${this.dataPage + 1} / ${pages}`;
      this.$('[data-data-page="prev"]').disabled = this.dataPage === 0;
      this.$('[data-data-page="next"]').disabled = this.dataPage >= pages - 1;
    }

    navigate(action) {
      if (!global.Plotly) return;
      for (const figure of this.figures.values()) {
        if (action === 'pan') {
          const active = this.$('[data-nav="pan"]').getAttribute('aria-pressed') !== 'true';
          global.Plotly.relayout(figure.element, {dragmode: active ? 'pan' : 'zoom'});
        } else if (action === 'reset') global.Plotly.relayout(figure.element, {'xaxis.range': [0, figure.max * 1.015], dragmode: 'zoom'});
        else {
          const range = figure.element.layout.xaxis.range || [0, figure.max], center = (range[0] + range[1]) / 2;
          const extent = figure.max * 1.015, span = Math.min(extent, Math.max(.001, (range[1] - range[0]) * (action === 'zoom-in' ? .6 : 1.6)));
          const start = Math.max(0, Math.min(extent - span, center - span / 2));
          global.Plotly.relayout(figure.element, {'xaxis.range': [start, start + span]});
        }
      }
      const button = this.$('[data-nav="pan"]');
      if (action === 'pan') button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') !== 'true' ? 'true' : 'false');
      else if (action === 'reset') button.setAttribute('aria-pressed', 'false');
    }

    async exportPng() {
      if (!global.Plotly) return;
      try {
        const images = [];
        for (const figure of this.figures.values()) {
          const data = await global.Plotly.toImage(figure.element, {format: 'png', width: 1600, height: Math.max(400, figure.layout.height), scale: 2});
          images.push(data);
        }
        if (!images.length) return;
        let data = images[0];
        if (images.length > 1) {
          const decoded = await Promise.all(images.map(src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; })));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(...decoded.map(image => image.width)); canvas.height = decoded.reduce((sum, image) => sum + image.height, 0);
          const context = canvas.getContext('2d'); let offset = 0;
          context.fillStyle = this.palette().bg; context.fillRect(0, 0, canvas.width, canvas.height);
          for (const image of decoded) { context.drawImage(image, 0, offset); offset += image.height; }
          data = canvas.toDataURL('image/png');
        }
        if (this.options.saveImage) await this.options.saveImage('RD-linea-tiempo.png', data);
        else this.download(data, 'RD-linea-tiempo.png');
      } catch (error) { this.options.notify?.(`No se pudo exportar PNG: ${error.message}`, 'error'); }
    }

    exportHtml() {
      const figures = Array.from(this.figures.values(), figure => ({data: figure.data, layout: JSON.parse(JSON.stringify(figure.element.layout || figure.layout)), config: {...this.plotConfig(), displayModeBar: true}}));
      if (!figures.length) return;
      if (this.options.saveChart) this.options.saveChart('RD-linea-tiempo.html', JSON.stringify({title: 'Línea de tiempo', figures}));
      else this.options.notify?.('La exportación HTML está disponible en la aplicación de escritorio.', 'error');
    }

    download(href, filename) { const link = el('a'); link.href = href; link.download = filename; link.click(); }
    setTheme(theme) { this.theme = theme; if (this.documents.length) { this.renderTimelines(); this.renderFrequencies(); } }
    resize() { if (global.Plotly) { for (const figure of this.figures.values()) global.Plotly.Plots.resize(figure.element); if (this.$('.analysis-frequency').data) global.Plotly.Plots.resize(this.$('.analysis-frequency')); } }
  }

  const API = {mount: options => new AnalysisController(options), normalize, words, matchesIn, timestamp, formatTime, parseSrt, parseDocument, contextFor, analyze, escapeHtml};
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.RDAnalysis = API;
})(typeof window !== 'undefined' ? window : globalThis);
