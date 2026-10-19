// 繪圖工具（仿 TradingView 左側工具列）
// 全部畫在一個掛在主 K 線 series 上的 primitive 裡；滑鼠互動在 chart 容器上以 capture 攔截，
// 這樣拖曳繪圖時不會同時拖動圖表。

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, "Microsoft JhengHei", sans-serif';
const BLUE = '#2962ff', GREEN = '#089981', RED = '#f23645', GRAY = '#808080';
const FIB_LEVELS = [
  { v: 0, c: GRAY }, { v: 0.236, c: RED }, { v: 0.382, c: '#ff9800' }, { v: 0.5, c: '#4caf50' },
  { v: 0.618, c: GREEN }, { v: 0.786, c: '#00bcd4' }, { v: 1, c: GRAY }, { v: 1.618, c: BLUE },
  { v: 2.618, c: RED }, { v: 3.618, c: '#9c27b0' }, { v: 4.236, c: '#e91e63' },
];
const FIB_TIME = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
const POS_ACCOUNT = 1000;   // TradingView 部位工具預設：帳戶 1000
const POS_RISK = 0.25;      // 風險 25%
const STORE_KEY = 'fake-tv-drawings-v1';

// 各工具需要幾個點
const POINTS = {
  trend: 2, ray: 2, extended: 2, arrow: 2, rect: 2, circle: 2, fib: 2, fibtime: 2,
  pricerange: 2, daterange: 2, datepricerange: 2, measure: 2,
  channel: 3, abcd: 4, xabcd: 5,
  hline: 1, hray: 1, vline: 1, crossline: 1, text: 1, pricelabel: 1, emoji: 1,
};
const FREEHAND = new Set(['brush', 'highlighter']);
const DEFAULTS = {
  trend: { color: BLUE, width: 2 }, ray: { color: BLUE, width: 2 }, extended: { color: BLUE, width: 2 },
  arrow: { color: BLUE, width: 2 }, hline: { color: BLUE, width: 1 }, hray: { color: BLUE, width: 1 },
  vline: { color: BLUE, width: 1 }, crossline: { color: BLUE, width: 1 }, channel: { color: BLUE, width: 1 },
  rect: { color: '#9c27b0', width: 1 }, circle: { color: '#ff9800', width: 1 },
  fib: { color: GRAY, width: 1 }, fibtime: { color: BLUE, width: 1 },
  abcd: { color: '#089981', width: 2 }, xabcd: { color: BLUE, width: 2 },
  pricerange: { color: BLUE, width: 1 }, daterange: { color: BLUE, width: 1 }, datepricerange: { color: BLUE, width: 1 },
  brush: { color: BLUE, width: 2 }, highlighter: { color: '#ffeb3b', width: 18 },
  text: { color: BLUE, size: 14 }, pricelabel: { color: BLUE }, emoji: { size: 28 },
  long: {}, short: {},
};
export const TOOL_NAMES = {
  trend: '趨勢線', ray: '射線', extended: '延長線', arrow: '箭頭', hline: '水平線', hray: '水平射線',
  vline: '垂直線', crossline: '十字線', channel: '平行通道', rect: '矩形', circle: '圓形',
  fib: '斐波那契回撤', fibtime: '斐波那契時間週期', abcd: 'ABCD 型態', xabcd: 'XABCD 型態',
  pricerange: '價格範圍', daterange: '日期範圍', datepricerange: '日期和價格範圍', measure: '測量',
  brush: '筆刷', highlighter: '螢光筆', text: '文字', pricelabel: '價格標籤', emoji: '圖示',
  long: '多頭部位', short: '空頭部位',
};

class DrawingLayer {
  constructor(mgr) {
    this.mgr = mgr;
    this._view = {
      zOrder: () => 'top',
      renderer: () => ({ draw: t => t.useMediaCoordinateSpace(s => mgr._render(s.context, s.mediaSize)) }),
    };
  }
  attached(p) { this.requestUpdate = p.requestUpdate; }
  detached() { this.requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return [this._view]; }
  priceAxisViews() { return this.mgr._priceAxisViews(); }
  timeAxisViews() { return this.mgr._timeAxisViews(); }
}

export class Drawings {
  constructor(opts) {
    Object.assign(this, opts);   // chart, series, wrap, getBars, getStep, getPrecision, fmt, fmtTime, fmtVol, onToolDone, onChange, onSelect
    this.list = [];
    this.tool = 'cursor';
    this.selected = null;
    this.hovered = null;
    this.creating = null;
    this.drag = null;
    this.measure = null;
    this.zoomBox = null;
    this.magnet = 'off';        // off | weak | strong
    this.stayInDrawing = false;
    this.lockAll = false;
    this.hidden = false;
    this.symbol = null;
    this.undoStack = [];
    this.redoStack = [];
    this._measureCtx = document.createElement('canvas').getContext('2d');
    this.layer = new DrawingLayer(this);
    this.series.attachPrimitive(this.layer);
    this._bindEvents();
  }

  // ================= 外部 API =================
  setSeries(series) {
    this.series.detachPrimitive(this.layer);
    this.series = series;
    series.attachPrimitive(this.layer);
  }

  setSymbol(symbol) {
    if (this.symbol) this._save();
    this.symbol = symbol;
    try { this.list = JSON.parse(localStorage.getItem(`${STORE_KEY}:${symbol}`)) || []; } catch { this.list = []; }
    this.list.forEach(migrate);
    this.undoStack = [];
    this.redoStack = [];
    this._snap = JSON.stringify(this.list);
    this.creating = this.measure = null;
    this._select(null);
    this.update();
  }

  setTool(tool) {
    if (this.creating) this._cancelCreate();
    this.tool = tool;
    this.wrap.classList.toggle('cursor-draw', !['cursor', 'eraser'].includes(tool));
    this.wrap.classList.toggle('cursor-eraser', tool === 'eraser');
    this.update();
  }

  clear() { this.list = []; this._select(null); this._commit(); }
  update() { this.layer.requestUpdate?.(); }

  deleteSelected() {
    if (!this.selected) return;
    this.list.splice(this.list.indexOf(this.selected), 1);
    this._select(null);
    this._commit();
  }

  setStyle(patch) {
    if (!this.selected) return;
    Object.assign(this.selected, patch);
    this._commit();
    this.onSelect?.(this.selected);
  }

  select(d) { this._select(d); this.update(); }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this._snap);
    this._snap = this.undoStack.pop();
    this.list = JSON.parse(this._snap);
    this._select(null);
    this._save(); this.update(); this.onChange?.();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this._snap);
    this._snap = this.redoStack.pop();
    this.list = JSON.parse(this._snap);
    this._select(null);
    this._save(); this.update(); this.onChange?.();
  }

  // 繪圖在畫面上的位置（給浮動工具列定位用）
  screenBox(d) {
    const pts = this._handles(d).filter(h => h.x != null && h.y != null);
    if (!pts.length) return null;
    return { x: Math.min(...pts.map(p => p.x)), y: Math.min(...pts.map(p => p.y)) };
  }

  // ================= 座標轉換 =================
  _base() { return this.getBars()[0]?.time ?? 0; }
  toX(t) { return this.chart.timeScale().logicalToCoordinate((t - this._base()) / this.getStep()); }
  toY(p) { return this.series.priceToCoordinate(p); }
  _logical(x) { return this.chart.timeScale().coordinateToLogical(x); }
  _timeAt(x, exact = false) {
    const l = this._logical(x);
    return this._base() + (exact ? l : Math.round(l)) * this.getStep();
  }
  _round(p) { const k = 10 ** this.getPrecision(); return Math.round(p * k) / k; }
  _priceAt(y, x) {
    let p = this.series.coordinateToPrice(y);
    if (this.magnet !== 'off' && x != null) {
      const bar = this.getBars()[Math.round(this._logical(x))];
      if (bar) {
        const near = [bar.open, bar.high, bar.low, bar.close].reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
        if (this.magnet === 'strong' || Math.abs(this.toY(near) - y) < 30) p = near;
      }
    }
    return this._round(p);
  }
  _pt(x, y, exact = false) { return { t: this._timeAt(x, exact), price: exact ? this.series.coordinateToPrice(y) : this._priceAt(y, x) }; }
  _local(e) { const r = this.wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _paneH() { return this.chart.panes()[0].getHeight(); }
  _paneW() { return this.chart.timeScale().width(); }
  _inPane(x, y) { return x >= 0 && x <= this._paneW() && y >= 0 && y <= this._paneH(); }
  _xy(q) { return { x: this.toX(q.t), y: this.toY(q.price) }; }

  // ================= 事件 =================
  _bindEvents() {
    const ignore = e => e.target.closest?.('.tl, #legend, #paneLegends .lg-ind, .ctx-menu, .float-tb, .txt-editor, .ps-gear, .ps-cur');
    const block = e => { e.stopPropagation(); e.preventDefault(); this._swallow = true; };

    this.wrap.addEventListener('pointerdown', e => {
      if (e.button !== 0 || ignore(e)) return;
      const { x, y } = this._local(e);
      if (!this._inPane(x, y)) return;

      // 測量結果：下一次點擊就消失
      if (this.measure && !this.creating) { this.measure = null; block(e); this.update(); if (this.tool === 'measure') this.onToolDone(); return; }
      if (this.creating) { block(e); this._addPoint(x, y); return; }

      if (this.tool === 'zoom') { block(e); this.zoomBox = { x0: x, y0: y, x1: x, y1: y }; return; }
      if (this.tool === 'eraser') {
        block(e);
        const hit = this._hitTest(x, y);
        if (hit) { this.list.splice(this.list.indexOf(hit.d), 1); this.hovered = null; this._commit(); }
        return;
      }
      if (this.tool === 'measure' || (this.tool === 'cursor' && e.shiftKey)) { block(e); this._startCreate('measure', x, y); return; }
      if (this.tool !== 'cursor') { block(e); this._startCreate(this.tool, x, y); return; }

      const hit = this.hidden ? null : this._hitTest(x, y);
      if (hit) {
        block(e);
        this._select(hit.d);
        if (!this.lockAll && !hit.d.locked) {
          this.drag = { ...hit, l0: this._logical(x), p0: this.series.coordinateToPrice(y), orig: structuredClone(hit.d), moved: false };
        }
        this.update();
      } else if (this.selected) {
        this._select(null);
        this.update();
      }
    }, true);

    this.wrap.addEventListener('mousedown', e => { if (this._swallow) { e.stopPropagation(); this._swallow = false; } }, true);

    this.wrap.addEventListener('dblclick', e => {
      if (ignore(e)) return;
      const { x, y } = this._local(e);
      const hit = this._hitTest(x, y);
      if (hit && hit.d.type === 'text') { e.stopPropagation(); this._editText(hit.d); }
    }, true);

    window.addEventListener('pointermove', e => {
      const { x, y } = this._local(e);
      if (this.drag) { this.drag.moved = true; this._doDrag(x, y); return; }
      if (this.zoomBox) { this.zoomBox.x1 = x; this.zoomBox.y1 = y; this.update(); return; }
      if (this.creating) { this._moveCreate(x, y); return; }
      if (!['cursor', 'eraser'].includes(this.tool) || this.hidden) return;
      const over = this.wrap.contains(e.target) && !ignore(e) && this._inPane(x, y);
      this._setHover(over ? this._hitTest(x, y) : null);
    });

    window.addEventListener('pointerup', e => {
      this._swallow = false;
      if (this.drag) { const moved = this.drag.moved; this.drag = null; if (moved) this._commit(); return; }
      if (this.zoomBox) { this._finishZoom(); return; }
      const c = this.creating;
      if (!c) return;
      if (c.freehand) { this._finishCreate(); return; }
      // 按住拖曳也能畫兩點工具（和 TradingView 一樣支援「點-點」和「拖曳」兩種方式）
      if (c.down && POINTS[c.d.type] === 2 && c.d.p.length === 2) {
        const { x, y } = this._local(e);
        if (Math.hypot(x - c.down.x, y - c.down.y) > 6) this._finishCreate();
      }
      if (c) c.down = null;
    });

    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { this.deleteSelected(); e.preventDefault(); }
      else if (e.key === 'Escape') {
        if (this.creating) this._cancelCreate();
        this.measure = this.zoomBox = null;
        this._select(null);
        if (this.tool !== 'cursor') this.onToolDone(true);
        this.update();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    });
  }

  _select(d) {
    if (this.selected === d) return;
    this.selected = d;
    this.onSelect?.(d);
  }

  _setHover(hit) {
    const d = hit?.d ?? null;
    const cls = !hit || this.tool === 'eraser' ? null
      : hit.handle === 'body' ? 'cursor-move' : hit.handle === 'width' ? 'cursor-ew' : 'cursor-pointer';
    this.wrap.classList.remove('cursor-move', 'cursor-pointer', 'cursor-ew');
    if (cls) this.wrap.classList.add(cls);
    if (d !== this.hovered) { this.hovered = d; this.update(); }
  }

  // ================= 建立繪圖 =================
  _startCreate(type, x, y) {
    const pt = this._pt(x, y);
    const d = { type, ...structuredClone(DEFAULTS[type] || {}) };

    if (type === 'long' || type === 'short') {
      const h = this._paneH();
      const risk = Math.abs(this.series.coordinateToPrice(y) - this.series.coordinateToPrice(y + h * 0.08));
      const dir = type === 'long' ? 1 : -1;
      Object.assign(d, { t1: pt.t, t2: pt.t + 30 * this.getStep(), entry: pt.price, sl: this._round(pt.price - dir * risk), tp: this._round(pt.price + dir * risk) });
      // 放在最新一根 K 線上（例如重播時）就從下一根開始算進場，不把已經走完的那根算進去
      const bars = this.getBars();
      if (bars.length && pt.t >= bars[bars.length - 1].time) d.fromNext = true;
      this.list.push(d);
      this._done(d);
      return;
    }
    if (FREEHAND.has(type)) {
      d.p = [this._pt(x, y, true)];
      this.list.push(d);
      this.creating = { d, freehand: true };
      return;
    }
    if (type === 'text') { d.p = [pt]; d.text = ''; this._editText(d, true); return; }
    if (type === 'emoji') { d.p = [pt]; d.char = this.emoji || '😀'; this.list.push(d); this._done(d); return; }

    d.p = [pt];
    if (POINTS[type] === 1) { this.list.push(d); this._done(d); return; }
    d.p.push({ ...pt });
    if (type === 'measure') this.measure = d; else this.list.push(d);
    this.creating = { d, down: { x, y } };
    this._select(type === 'measure' ? null : d);
    this.update();
  }

  _moveCreate(x, y) {
    const c = this.creating;
    if (c.freehand) {
      const last = this._xy(c.d.p[c.d.p.length - 1]);
      if (Math.hypot(last.x - x, last.y - y) > 2) c.d.p.push(this._pt(x, y, true));
    } else {
      c.d.p[c.d.p.length - 1] = this._pt(x, y);
    }
    this.update();
  }

  _addPoint(x, y) {
    const d = this.creating.d;
    d.p[d.p.length - 1] = this._pt(x, y);
    if (d.p.length >= POINTS[d.type]) { this._finishCreate(); return; }
    d.p.push(this._pt(x, y));
    this.update();
  }

  _finishCreate() {
    const d = this.creating.d;
    this.creating = null;
    if (d.type === 'channel') { d.offset = this._chanOffset(d); d.p.length = 2; }
    if (d.type === 'measure') { this.update(); return; }   // 測量結果留在畫面上，直到下一次點擊
    this._done(d);
  }

  _cancelCreate() {
    const d = this.creating.d;
    this.creating = null;
    if (d.type === 'measure') this.measure = null;
    else this.list.splice(this.list.indexOf(d), 1);
    this._select(null);
  }

  _done(d) {
    this._select(d);
    this._commit();
    if (!this.stayInDrawing) this.onToolDone();
  }

  _finishZoom() {
    const z = this.zoomBox;
    this.zoomBox = null;
    if (Math.abs(z.x1 - z.x0) > 5) {
      const a = this._logical(Math.min(z.x0, z.x1)), b = this._logical(Math.max(z.x0, z.x1));
      this.chart.timeScale().setVisibleLogicalRange({ from: a, to: b });
    }
    this.update();
    this.onToolDone();
  }

  _editText(d, isNew = false) {
    const { x, y } = this._xy(d.p[0]);
    const ta = document.createElement('textarea');
    ta.className = 'txt-editor';
    ta.value = d.text || '';
    ta.style.left = `${x}px`;
    ta.style.top = `${y}px`;
    ta.style.color = d.color;
    ta.style.fontSize = `${d.size}px`;
    this.wrap.appendChild(ta);
    setTimeout(() => ta.focus(), 0);
    let finished = false;
    const finish = ok => {
      if (finished) return;
      finished = true;
      ta.remove();
      const text = ta.value.trim();
      if (!ok || !text) {
        if (!isNew && !text) { this.list.splice(this.list.indexOf(d), 1); this._select(null); this._commit(); }
        if (isNew) this.onToolDone();
        return;
      }
      d.text = text;
      if (isNew) { this.list.push(d); this._done(d); } else this._commit();
    };
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') finish(false);
    });
    ta.addEventListener('blur', () => finish(true));
  }

  _commit() {
    const json = JSON.stringify(this.list);
    if (json !== this._snap) {
      this.undoStack.push(this._snap);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this._snap = json;
    }
    this._save();
    this.update();
    this.onChange?.();
  }

  _save() {
    if (!this.symbol) return;
    try { localStorage.setItem(`${STORE_KEY}:${this.symbol}`, JSON.stringify(this.list)); } catch { /* 忽略 */ }
  }

  // ================= 拖曳編輯 =================
  _doDrag(x, y) {
    const { d, handle, orig } = this.drag;
    const step = this.getStep();
    const dl = Math.round(this._logical(x) - this.drag.l0);
    const dp = this.series.coordinateToPrice(y) - this.drag.p0;
    const pt = this._pt(x, y);

    if (handle === 'body') {
      if (d.p) d.p = orig.p.map(q => ({ t: q.t + dl * step, price: FREEHAND.has(d.type) ? q.price + dp : this._round(q.price + dp) }));
      else {
        d.t1 = orig.t1 + dl * step; d.t2 = orig.t2 + dl * step;
        d.entry = this._round(orig.entry + dp); d.tp = this._round(orig.tp + dp); d.sl = this._round(orig.sl + dp);
      }
    } else if (d.p) {
      if (/^p\d$/.test(handle)) d.p[+handle[1]] = pt;
      else if (handle === 'c01') { d.p[0].t = pt.t; d.p[1].price = pt.price; }
      else if (handle === 'c10') { d.p[1].t = pt.t; d.p[0].price = pt.price; }
      else if (handle === 'off') d.offset = pt.price - this._lineAt(d, pt.t);
    } else {
      const long = d.type === 'long';
      const gap = 10 ** -this.getPrecision();
      if (handle === 'tp') d.tp = long ? Math.max(pt.price, d.entry + gap) : Math.min(pt.price, d.entry - gap);
      if (handle === 'sl') d.sl = long ? Math.min(pt.price, d.entry - gap) : Math.max(pt.price, d.entry + gap);
      if (handle === 'entry') {
        d.entry = long ? Math.min(Math.max(pt.price, d.sl + gap), d.tp - gap) : Math.min(Math.max(pt.price, d.tp + gap), d.sl - gap);
        d.t1 = Math.min(pt.t, d.t2 - step);
      }
      if (handle === 'width') d.t2 = Math.max(pt.t, d.t1 + step);
    }
    this.update();
  }

  _lineAt(d, t) {
    const [a, b] = d.p;
    if (b.t === a.t) return a.price;
    return a.price + ((b.price - a.price) * (t - a.t)) / (b.t - a.t);
  }
  _chanOffset(d) {
    if (d.offset != null) return d.offset;
    if (d.p.length < 3) return 0;
    return d.p[2].price - this._lineAt(d, d.p[2].t);
  }

  // ================= 命中測試 =================
  _handles(d) {
    if (d.p) {
      const P = d.p.map(q => this._xy(q));
      switch (d.type) {
        case 'hline': case 'vline': case 'crossline': case 'text': case 'emoji': case 'pricelabel':
        case 'brush': case 'highlighter':
          return [];
        case 'hray': return [{ id: 'p0', ...P[0] }];
        case 'rect': return [{ id: 'p0', ...P[0] }, { id: 'p1', ...P[1] }, { id: 'c01', x: P[0].x, y: P[1].y }, { id: 'c10', x: P[1].x, y: P[0].y }];
        case 'channel': {
          const off = this._chanOffset(d);
          const hs = P.slice(0, 2).map((p, i) => ({ id: `p${i}`, ...p }));
          if (d.p.length >= 2) hs.push({ id: 'off', x: (P[0].x + P[1].x) / 2, y: this.toY((d.p[0].price + d.p[1].price) / 2 + off) });
          return hs;
        }
        default: return P.map((p, i) => ({ id: `p${i}`, ...p }));
      }
    }
    const x1 = this.toX(d.t1), x2 = this.toX(this._posT2(d));
    return [
      { id: 'tp', x: x1, y: this.toY(d.tp), square: true }, { id: 'sl', x: x1, y: this.toY(d.sl), square: true },
      { id: 'entry', x: x1, y: this.toY(d.entry) }, { id: 'width', x: x2, y: this.toY(d.entry), square: true },
    ];
  }

  _hitTest(x, y) {
    for (const d of [this.selected, this.hovered].filter(Boolean)) {
      for (const h of this._handles(d)) {
        if (h.x != null && h.y != null && Math.hypot(h.x - x, h.y - y) <= 8) return { d, handle: h.id };
      }
    }
    for (const d of [...this.list].reverse()) if (this._hitBody(d, x, y)) return { d, handle: 'body' };
    return null;
  }

  _hitBody(d, x, y) {
    const W = this._paneW(), H = this._paneH();
    if (d.type === 'long' || d.type === 'short') {
      const x1 = this.toX(d.t1), x2 = this.toX(this._posT2(d)), ys = [this.toY(d.tp), this.toY(d.sl)];
      return x >= x1 && x <= x2 && y >= Math.min(...ys) && y <= Math.max(...ys);
    }
    const P = d.p.map(q => this._xy(q));
    if (P.some(p => p.x == null || p.y == null) && !['hline', 'vline'].includes(d.type)) return false;
    const seg = (a, b) => distToSeg(x, y, a, b) <= 5;
    switch (d.type) {
      case 'trend': case 'arrow': return seg(P[0], P[1]);
      case 'ray': return seg(P[0], extendPt(P[0], P[1]));
      case 'extended': return seg(extendPt(P[1], P[0]), extendPt(P[0], P[1]));
      case 'hline': return Math.abs(this.toY(d.p[0].price) - y) <= 5;
      case 'hray': return Math.abs(P[0].y - y) <= 5 && x >= P[0].x - 5;
      case 'vline': return Math.abs(this.toX(d.p[0].t) - x) <= 5;
      case 'crossline': return Math.abs(P[0].y - y) <= 5 || Math.abs(P[0].x - x) <= 5;
      case 'channel': {
        const off = this._chanOffset(d);
        const Q = d.p.slice(0, 2).map(q => this._xy({ t: q.t, price: q.price + off }));
        if (seg(P[0], P[1]) || seg(Q[0], Q[1])) return true;
        return x >= Math.min(P[0].x, P[1].x) && x <= Math.max(P[0].x, P[1].x) && pointInPoly(x, y, [P[0], P[1], Q[1], Q[0]]);
      }
      case 'circle': { const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y); return Math.hypot(x - P[0].x, y - P[0].y) <= r + 4; }
      case 'brush': case 'highlighter':
        for (let i = 1; i < P.length; i++) if (distToSeg(x, y, P[i - 1], P[i]) <= Math.max(5, d.width / 2)) return true;
        return false;
      case 'abcd': case 'xabcd':
        for (let i = 1; i < P.length; i++) if (seg(P[i - 1], P[i])) return true;
        return d.type === 'xabcd' && P.length >= 3 && (pointInPoly(x, y, P.slice(0, 3)) || (P.length === 5 && pointInPoly(x, y, P.slice(2, 5))));
      case 'text': case 'emoji': case 'pricelabel': {
        const b = this._labelBox(d, P[0]);
        return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      }
      case 'fibtime': {
        const dt = d.p[1].t - d.p[0].t;
        return FIB_TIME.some(n => Math.abs(this.toX(d.p[0].t + n * dt) - x) <= 4) || seg(P[0], P[1]);
      }
      default: {   // rect, fib, ranges
        const inX = x >= Math.min(P[0].x, P[1].x) - 4 && x <= Math.max(P[0].x, P[1].x) + 4;
        if (d.type === 'fib') {
          const ys = FIB_LEVELS.map(l => this.toY(d.p[1].price + (d.p[0].price - d.p[1].price) * l.v));
          return inX && y >= Math.min(...ys) - 4 && y <= Math.max(...ys) + 4;
        }
        return inX && y >= Math.min(P[0].y, P[1].y) - 4 && y <= Math.max(P[0].y, P[1].y) + 4;
      }
    }
    void W; void H;
  }

  _labelBox(d, p) {
    const ctx = this._measureCtx;
    if (d.type === 'emoji') return { x: p.x - d.size / 2, y: p.y - d.size / 2, w: d.size, h: d.size };
    if (d.type === 'pricelabel') {
      ctx.font = `12px ${FONT}`;
      const w = ctx.measureText(this.fmt(d.p[0].price)).width + 16;
      return { x: p.x - w / 2, y: p.y - 30, w, h: 22 };
    }
    ctx.font = `${d.size}px ${FONT}`;
    const lines = (d.text || '').split('\n');
    const w = Math.max(...lines.map(l => ctx.measureText(l).width), 10);
    return { x: p.x, y: p.y, w, h: lines.length * d.size * 1.25 };
  }

  // ================= 繪製 =================
  _render(ctx, size) {
    ctx.save();
    ctx.font = `12px ${FONT}`;
    ctx.textBaseline = 'middle';
    if (!this.hidden) {
      for (const d of this.list) {
        const active = d === this.selected || d === this.hovered;
        ctx.save();
        this._draw(ctx, d, size, active);
        ctx.restore();
        if (active && !(this.tool === 'eraser')) this._drawHandles(ctx, d);
        if (this.tool === 'eraser' && d === this.hovered) this._drawEraseMark(ctx, d);
      }
    }
    if (this.measure) { ctx.save(); this._drawRange(ctx, this.measure, 'measure'); ctx.restore(); }
    if (this.zoomBox) {
      const z = this.zoomBox;
      ctx.fillStyle = 'rgba(41, 98, 255, 0.12)';
      ctx.strokeStyle = 'rgba(41, 98, 255, 0.6)';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.strokeRect(z.x0 + 0.5, z.y0 + 0.5, z.x1 - z.x0, z.y1 - z.y0);
    }
    ctx.restore();
  }

  _stroke(ctx, d) {
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.width ?? 1;
    ctx.setLineDash(d.style === 'dashed' ? [6, 4] : d.style === 'dotted' ? [2, 3] : []);
    ctx.lineCap = 'round';
  }

  _draw(ctx, d, size, active) {
    const W = size.width, H = size.height;
    if (d.type === 'long' || d.type === 'short') return this._drawPosition(ctx, d, active);
    const P = d.p.map(q => this._xy(q));
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const hpx = y => Math.round(y) + 0.5;
    this._stroke(ctx, d);
    switch (d.type) {
      case 'trend': line(P[0], P[1]); break;
      case 'ray': line(P[0], extendPt(P[0], P[1])); break;
      case 'extended': line(extendPt(P[1], P[0]), extendPt(P[0], P[1])); break;
      case 'arrow': {
        line(P[0], P[1]);
        const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x), L = 6 + (d.width ?? 2) * 3;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(P[1].x - L * Math.cos(ang - 0.45), P[1].y - L * Math.sin(ang - 0.45));
        ctx.lineTo(P[1].x, P[1].y);
        ctx.lineTo(P[1].x - L * Math.cos(ang + 0.45), P[1].y - L * Math.sin(ang + 0.45));
        ctx.stroke();
        break;
      }
      case 'hline': { const y = hpx(this.toY(d.p[0].price)); line({ x: 0, y }, { x: W, y }); break; }
      case 'hray': { const y = hpx(P[0].y); line({ x: P[0].x, y }, { x: W, y }); break; }
      case 'vline': { const x = hpx(this.toX(d.p[0].t)); line({ x, y: 0 }, { x, y: H }); break; }
      case 'crossline': {
        const x = hpx(P[0].x), y = hpx(P[0].y);
        line({ x: 0, y }, { x: W, y }); line({ x, y: 0 }, { x, y: H });
        break;
      }
      case 'channel': {
        const off = this._chanOffset(d);
        const Q = d.p.slice(0, 2).map(q => this._xy({ t: q.t, price: q.price + off }));
        ctx.fillStyle = hexA(d.color, 0.2);
        ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.lineTo(Q[1].x, Q[1].y); ctx.lineTo(Q[0].x, Q[0].y); ctx.closePath(); ctx.fill();
        line(P[0], P[1]); line(Q[0], Q[1]);
        ctx.setLineDash([4, 4]);
        line({ x: P[0].x, y: (P[0].y + Q[0].y) / 2 }, { x: P[1].x, y: (P[1].y + Q[1].y) / 2 });
        break;
      }
      case 'rect':
        ctx.fillStyle = hexA(d.color, 0.2);
        ctx.fillRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y);
        ctx.strokeRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y);
        break;
      case 'circle': {
        const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
        ctx.fillStyle = hexA(d.color, 0.2);
        ctx.beginPath(); ctx.arc(P[0].x, P[0].y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      }
      case 'fib': this._drawFib(ctx, d, P); break;
      case 'fibtime': {
        const dt = d.p[1].t - d.p[0].t;
        ctx.textAlign = 'left';
        FIB_TIME.forEach((n, i) => {
          const x = hpx(this.toX(d.p[0].t + n * dt));
          ctx.strokeStyle = i % 2 ? d.color : hexA(d.color, 0.6);
          line({ x, y: 0 }, { x, y: H });
          ctx.fillStyle = d.color;
          ctx.fillText(String(n), x + 4, H - 12);
        });
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = GRAY;
        line(P[0], P[1]);
        break;
      }
      case 'abcd': case 'xabcd': this._drawPattern(ctx, d, P); break;
      case 'pricerange': case 'daterange': case 'datepricerange': this._drawRange(ctx, d, d.type); break;
      case 'brush': case 'highlighter':
        if (d.type === 'highlighter') { ctx.globalAlpha = 0.35; ctx.lineCap = 'round'; }
        ctx.lineJoin = 'round';
        ctx.beginPath();
        P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (P.length === 1) ctx.lineTo(P[0].x + 0.1, P[0].y);
        ctx.stroke();
        break;
      case 'text': {
        ctx.font = `${d.size}px ${FONT}`;
        ctx.fillStyle = d.color;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        (d.text || '').split('\n').forEach((l, i) => ctx.fillText(l, P[0].x, P[0].y + i * d.size * 1.25));
        if (active) {
          const b = this._labelBox(d, P[0]);
          ctx.strokeStyle = BLUE; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
        }
        break;
      }
      case 'emoji':
        ctx.font = `${d.size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(d.char, P[0].x, P[0].y + 1);
        if (active) {
          const b = this._labelBox(d, P[0]);
          ctx.strokeStyle = BLUE; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
        }
        break;
      case 'pricelabel': {
        const b = this._labelBox(d, P[0]);
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, 4);
        ctx.moveTo(P[0].x - 6, b.y + b.h); ctx.lineTo(P[0].x, P[0].y - 2); ctx.lineTo(P[0].x + 6, b.y + b.h);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(this.fmt(d.p[0].price), P[0].x, b.y + b.h / 2 + 0.5);
        break;
      }
    }
  }

  _drawFib(ctx, d, P) {
    const [p1, p0] = [d.p[0].price, d.p[1].price];
    const xl = Math.min(P[0].x, P[1].x), xr = Math.max(P[0].x, P[1].x);
    const levels = FIB_LEVELS.map(l => ({ ...l, price: p0 + (p1 - p0) * l.v })).map(l => ({ ...l, y: this.toY(l.price) }));
    for (let i = 0; i < levels.length - 1; i++) {
      ctx.fillStyle = hexA(levels[i + 1].c, 0.2);
      ctx.fillRect(xl, levels[i].y, xr - xl, levels[i + 1].y - levels[i].y);
    }
    ctx.lineWidth = d.width ?? 1;
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    for (const l of levels) {
      const y = Math.round(l.y) + 0.5;
      ctx.strokeStyle = l.c;
      ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(xr, y); ctx.stroke();
      ctx.fillStyle = l.c;
      ctx.fillText(`${l.v} (${this.fmt(l.price)})`, xl - 8, l.y);
    }
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.9)';
    ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.stroke();
  }

  _drawPattern(ctx, d, P) {
    const names = d.type === 'xabcd' ? ['X', 'A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D'];
    const pr = d.p.map(q => q.price);
    const ratio = (i, j, k, l) => (P.length > Math.max(i, j, k, l) ? Math.abs(pr[j] - pr[i]) / Math.abs(pr[l] - pr[k] || 1) : null);
    if (d.type === 'xabcd') {
      ctx.fillStyle = hexA(d.color, 0.2);
      [[0, 1, 2], [2, 3, 4]].forEach(tri => {
        if (P.length <= tri[2]) return;
        ctx.beginPath(); tri.forEach((k, i) => (i ? ctx.lineTo(P[k].x, P[k].y) : ctx.moveTo(P[k].x, P[k].y))); ctx.closePath(); ctx.fill();
      });
    }
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    // 虛線與比例
    const dashes = d.type === 'xabcd'
      ? [[0, 2, ratio(1, 2, 0, 1)], [1, 3, ratio(2, 3, 1, 2)], [2, 4, ratio(3, 4, 2, 3)], [0, 4, ratio(1, 4, 0, 1)]]
      : [[0, 2, ratio(1, 2, 0, 1)], [1, 3, ratio(2, 3, 1, 2)]];
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const [i, j, r] of dashes) {
      if (P.length <= j || r == null) continue;
      ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.stroke();
      tag(ctx, (P[i].x + P[j].x) / 2, (P[i].y + P[j].y) / 2, r.toFixed(3), d.color);
    }
    ctx.setLineDash([]);
    P.forEach((p, i) => {
      const up = i === 0 ? (P[1] ? p.y > P[1].y : true) : p.y >= P[i - 1].y;
      tag(ctx, p.x, p.y + (up ? 16 : -16), names[i], d.color);
    });
  }

  // 價格範圍 / 日期範圍 / 測量
  _drawRange(ctx, d, kind) {
    const [a, b] = d.p;
    const A = this._xy(a), B = this._xy(b);
    if (A.x == null || B.x == null) return;
    const dp = b.price - a.price;
    const down = dp < 0;
    const color = kind === 'measure' ? (down ? RED : BLUE) : d.color;
    const showPrice = kind !== 'daterange', showTime = kind !== 'pricerange';
    const xl = Math.min(A.x, B.x), xr = Math.max(A.x, B.x), yt = Math.min(A.y, B.y), yb = Math.max(A.y, B.y);
    ctx.fillStyle = hexA(color, 0.2);
    ctx.fillRect(xl, yt, xr - xl, yb - yt);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const arrow = (x1, y1, x2, y2) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x2 - 7 * Math.cos(ang - 0.5), y2 - 7 * Math.sin(ang - 0.5)); ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - 7 * Math.cos(ang + 0.5), y2 - 7 * Math.sin(ang + 0.5)); ctx.stroke();
    };
    if (showPrice && Math.abs(B.y - A.y) > 4) arrow((xl + xr) / 2, A.y, (xl + xr) / 2, B.y);
    if (showTime && Math.abs(B.x - A.x) > 4) arrow(A.x, (yt + yb) / 2, B.x, (yt + yb) / 2);
    if (kind === 'pricerange') { ctx.beginPath(); ctx.moveTo(xl, yt + 0.5); ctx.lineTo(xr, yt + 0.5); ctx.moveTo(xl, yb - 0.5); ctx.lineTo(xr, yb - 0.5); ctx.stroke(); }
    if (kind === 'daterange') { ctx.beginPath(); ctx.moveTo(xl + 0.5, yt); ctx.lineTo(xl + 0.5, yb); ctx.moveTo(xr - 0.5, yt); ctx.lineTo(xr - 0.5, yb); ctx.stroke(); }

    const lines = [];
    const prec = this.getPrecision();
    const sign = v => (v < 0 ? '−' : '');
    if (showPrice) {
      const pct = (dp / a.price) * 100;
      const ticks = Math.round(dp / 10 ** -prec);
      lines.push(`${sign(dp)}${this.fmt(Math.abs(dp))} (${sign(pct)}${Math.abs(pct).toFixed(2)}%) ${sign(ticks)}${Math.abs(ticks).toLocaleString('en-US')}`);
    }
    if (showTime) {
      const step = this.getStep();
      const bars = Math.round((b.t - a.t) / step);
      lines.push(`${bars} 根K線, ${duration(Math.abs(b.t - a.t))}`);
      const all = this.getBars(), base = this._base();
      const i0 = Math.round((Math.min(a.t, b.t) - base) / step), i1 = Math.round((Math.max(a.t, b.t) - base) / step);
      let vol = 0;
      for (let i = Math.max(0, i0); i <= Math.min(all.length - 1, i1); i++) vol += all[i].volume;
      lines.push(`成交量 ${this.fmtVol(vol)}`);
    }
    const ly = (kind === 'daterange' ? B.y >= A.y : !down) ? yt - 8 - lines.length * 9 : yb + 8 + lines.length * 9;
    box(ctx, (xl + xr) / 2, ly, lines, color);
  }

  _posState(d) {
    const bars = this.getBars();
    if (!bars.length) return { open: null };
    const step = this.getStep(), base = bars[0].time, long = d.type === 'long';
    // 放在最新 K 線上的部位框會一直往右延伸，直到碰到止盈或止損
    const end = d.fromNext ? bars.length - 1 : Math.min(bars.length - 1, Math.floor((d.t2 - base) / step));
    let open = null, close = null;
    for (let i = Math.max(0, Math.ceil((d.t1 - base) / step) + (d.fromNext ? 1 : 0)); i <= end; i++) {
      const b = bars[i];
      if (!open) {
        if (b.low <= d.entry && b.high >= d.entry) open = { t: b.time };
        else continue;
      }
      if (long ? b.low <= d.sl : b.high >= d.sl) { close = { t: b.time, price: d.sl }; break; }
      if (long ? b.high >= d.tp : b.low <= d.tp) { close = { t: b.time, price: d.tp }; break; }
    }
    if (!open) return { open: null };
    const cur = close ?? { t: bars[end].time, price: bars[end].close };
    return { open, close, cur };
  }

  // 部位框實際的右緣：一般就是 t2；放在最新 K 線上的（例如重播時）會延伸到平倉那根，未平倉時延伸到最新 K 線的下一根
  _posT2(d, st = this._posState(d)) {
    if (!d.fromNext) return d.t2;
    const bars = this.getBars();
    if (!bars.length) return d.t2;
    const step = this.getStep();
    return Math.max(d.t2, (st.close ? st.close.t : bars[bars.length - 1].time) + step);
  }

  _drawPosition(ctx, d, active) {
    const st = this._posState(d);
    const x1 = this.toX(d.t1), x2 = this.toX(this._posT2(d, st));
    const yE = this.toY(d.entry), yT = this.toY(d.tp), yS = this.toY(d.sl);
    if ([x1, x2, yE, yT, yS].some(v => v == null)) return;
    const w = x2 - x1, long = d.type === 'long', dir = long ? 1 : -1;

    ctx.fillStyle = 'rgba(8, 153, 129, 0.2)';
    ctx.fillRect(x1, Math.min(yE, yT), w, Math.abs(yT - yE));
    ctx.fillStyle = 'rgba(242, 54, 69, 0.2)';
    ctx.fillRect(x1, Math.min(yE, yS), w, Math.abs(yS - yE));

    let pnl = 0;
    if (st.open) {
      const xo = this.toX(st.open.t), xc = this.toX(st.cur.t), yc = this.toY(st.cur.price);
      pnl = (st.cur.price - d.entry) * dir;
      ctx.fillStyle = pnl >= 0 ? 'rgba(8, 153, 129, 0.2)' : 'rgba(242, 54, 69, 0.2)';
      ctx.fillRect(xo, Math.min(yE, yc), xc - xo, Math.abs(yc - yE));
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.9)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(xo, yE); ctx.lineTo(xc, yc); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x1, Math.round(yE) + 0.5); ctx.lineTo(x2, Math.round(yE) + 0.5); ctx.stroke();

    // 數據標籤預設一直顯示（錄影時滑鼠不在框上也看得到），可在浮動工具列關掉
    if (!active && d.hideStats) return;
    const prec = this.getPrecision();
    const risk = Math.abs(d.entry - d.sl), reward = Math.abs(d.tp - d.entry);
    const qty = (POS_ACCOUNT * POS_RISK) / risk;
    const num = (v, dp = 2) => v.toLocaleString('en-US', { maximumFractionDigits: dp });
    const pct = v => ((v / d.entry) * 100).toFixed(3);
    const ticks = v => Math.round(v / 10 ** -prec).toLocaleString('en-US');
    const signed = v => `${v < 0 ? '−' : ''}${this.fmt(Math.abs(v))}`;
    const cx = x1 + w / 2;
    const top = Math.min(yT, yS), bottom = Math.max(yT, yS);
    const tY = long ? top - 13 : bottom + 13, sY = long ? bottom + 13 : top - 13;
    box(ctx, cx, tY, [`目標：${this.fmt(reward)} (${pct(reward)}%) ${ticks(reward)}, 金額：${+(POS_ACCOUNT + qty * reward).toFixed(2)}`], GREEN);
    box(ctx, cx, sY, [`停損：${this.fmt(risk)} (${pct(risk)}%) ${ticks(risk)}, 金額：${+(POS_ACCOUNT - qty * risk).toFixed(2)}`], RED);
    const label = st.close ? '已平倉盈虧' : '未平倉盈虧';
    box(ctx, cx, yE, [`${label}：${signed(pnl)}, 數量：${num(qty, 3)}`, `風險/報酬比：${num(reward / risk)}`],
      !st.open ? '#5d606b' : pnl >= 0 ? GREEN : RED, d === this.selected);
  }

  _drawHandles(ctx, d) {
    for (const h of this._handles(d)) {
      if (h.x == null || h.y == null) continue;
      ctx.beginPath();
      if (h.square) ctx.roundRect(h.x - 5.5, h.y - 5.5, 11, 11, 2.5);
      else ctx.arc(h.x, h.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f0f0f';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = BLUE;
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }

  _drawEraseMark(ctx, d) {
    ctx.globalAlpha = 0.5;
    this._draw(ctx, { ...d, color: RED }, { width: this._paneW(), height: this._paneH() }, false);
    ctx.globalAlpha = 1;
  }

  // ================= 價格軸 / 時間軸標籤 =================
  _priceAxisViews() {
    if (this.hidden) return [];
    const views = [];
    const mk = (price, bg) => views.push({
      coordinate: () => this.toY(price) ?? -100, text: () => this.fmt(price),
      textColor: () => '#ffffff', backColor: () => bg, visible: () => true, tickVisible: () => true,
    });
    for (const d of this.list) {
      const sel = d === this.selected || d === this.hovered;
      if (d.type === 'hline' || d.type === 'hray' || d.type === 'crossline') mk(d.p[0].price, d.color);
      else if ((d.type === 'long' || d.type === 'short') && (sel || !d.hideStats)) { mk(d.tp, GREEN); mk(d.entry, '#5d606b'); mk(d.sl, RED); }
      else if (d.p && d === this.selected && !FREEHAND.has(d.type) && d.type !== 'vline') d.p.forEach(q => mk(q.price, BLUE));
    }
    if (this.measure) this.measure.p.forEach(q => mk(q.price, this.measure.p[1].price < this.measure.p[0].price ? RED : BLUE));
    return views;
  }

  _timeAxisViews() {
    if (this.hidden) return [];
    const views = [];
    const mk = (t, bg) => views.push({
      coordinate: () => this.toX(t) ?? -100, text: () => this.fmtTime(t),
      textColor: () => '#ffffff', backColor: () => bg, visible: () => true, tickVisible: () => true,
    });
    for (const d of this.list) {
      if (d.type === 'vline' || d.type === 'crossline') mk(d.p[0].t, d.color);
      else if (d.p && d === this.selected && !FREEHAND.has(d.type) && !['hline', 'hray'].includes(d.type)) d.p.forEach(q => mk(q.t, BLUE));
      else if ((d.type === 'long' || d.type === 'short') && d === this.selected) { mk(d.t1, BLUE); mk(this._posT2(d), BLUE); }
    }
    return views;
  }
}

// ================= 小工具 =================
function migrate(d) {
  if (d.type === 'hline' && d.price != null && !d.p) { d.p = [{ t: 0, price: d.price }]; delete d.price; }
  for (const [k, v] of Object.entries(DEFAULTS[d.type] || {})) d[k] ??= v;
}

function box(ctx, cx, cy, lines, bg, border = false) {
  ctx.font = `12px ${FONT}`;
  const padX = 8, lh = 16;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
  const h = lines.length * lh + 6;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  if (border) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke(); }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, cx, y + 3 + lh / 2 + i * lh + 0.5));
}

function tag(ctx, cx, cy, text, bg) {
  ctx.font = `12px ${FONT}`;
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - 9, w, 18, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);
}

function duration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}天`, h && `${h}小時`, m && `${m}分`].filter(Boolean).join(' ') || '0分';
}

function extendPt(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  return { x: b.x + (dx / len) * 1e4, y: b.y + (dy / len) * 1e4 };
}

function distToSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function hexA(hex, a) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
