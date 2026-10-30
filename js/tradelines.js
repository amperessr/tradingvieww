// 圖表上的交易線（持倉、掛單、止盈、止損、下單預覽）：
// 線本身與價格軸標籤用 series.createPriceLine，左側的可拖曳標籤用 HTML 疊在圖上。
import { LineStyle } from '../lib/lightweight-charts.standalone.production.mjs';

export class TradeLines {
  constructor({ chart, series, wrap, overlay, round, getAvoid }) {
    Object.assign(this, { chart, series, wrap, overlay, round, getAvoid });
    this.items = new Map();   // key -> { d, line, el, price }
    this.dragging = null;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    window.addEventListener('pointermove', e => this._onMove(e));
    window.addEventListener('pointerup', () => this._onUp());
  }

  setSeries(series) {
    for (const it of this.items.values()) this.series.removePriceLine(it.line);
    this.series = series;
    for (const it of this.items.values()) it.line = series.createPriceLine(this._lineOpts(it.d, it.price));
  }

  // descs: 目前應該顯示的所有交易線
  set(descs) {
    const keep = new Set();
    for (const d of descs) {
      keep.add(d.key);
      let it = this.items.get(d.key);
      if (!it) {
        it = { d, price: d.price, el: this._makeEl(), line: this.series.createPriceLine(this._lineOpts(d, d.price)) };
        this.items.set(d.key, it);
        this.overlay.appendChild(it.el);
      }
      it.d = d;
      if (this.dragging?.it !== it) it.price = d.price;
      it.line.applyOptions(this._lineOpts(d, it.price));
      this._renderEl(it);
    }
    // 拖曳中的「新增止盈/止損」暫時線要保留
    for (const [key, it] of this.items) {
      if (keep.has(key) || this.dragging?.it === it) continue;
      this._remove(key);
    }
  }

  _remove(key) {
    const it = this.items.get(key);
    if (!it) return;
    this.series.removePriceLine(it.line);
    it.el.remove();
    this.items.delete(key);
  }

  _lineOpts(d, price) {
    return {
      price, color: d.color, lineWidth: 1,
      lineStyle: d.preview || d.dashed ? LineStyle.Dashed : LineStyle.Solid,
      axisLabelVisible: true, axisLabelColor: d.color, axisLabelTextColor: '#ffffff', title: '',
    };
  }

  _makeEl() {
    const el = document.createElement('div');
    el.className = 'tl';
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const it = [...this.items.values()].find(x => x.el === el);
      if (!it) return;
      e.stopPropagation();
      e.preventDefault();
      const role = e.target.closest('[data-role]')?.dataset.role;
      if (role === 'close') { it.d.onClose?.(); return; }
      if (role === 'add-tp' || role === 'add-sl') { this._startGhost(it, role === 'add-tp' ? 'tp' : 'sl', e); return; }
      if (it.d.onCommit) this._startDrag(it, e);
    });
    return el;
  }

  _renderEl(it) {
    const { d } = it;
    const { text, cls } = d.text(it.price);
    const sig = `${d.color}|${text}|${cls}|${d.qty}|${!!d.onClose}|${!!d.addTP}|${!!d.addSL}|${d.preview}`;
    if (it.sig === sig) return;
    it.sig = sig;
    it.el.style.setProperty('--c', d.color);
    it.el.classList.toggle('preview', !!d.preview);
    it.el.style.cursor = d.onCommit ? 'ns-resize' : 'default';
    it.el.innerHTML =
      (d.addTP ? '<span class="tl-add tp" data-role="add-tp" title="拖曳以設定止盈">止盈</span>' : '') +
      (d.addSL ? '<span class="tl-add sl" data-role="add-sl" title="拖曳以設定止損">止損</span>' : '') +
      `<span class="tl-text ${cls || ''}">${text}</span>` +
      (d.qty != null ? `<span class="tl-qty">${d.qty}</span>` : '') +
      (d.onClose ? `<span class="tl-x" data-role="close" title="${d.closeTitle || '取消'}">✕</span>` : '');
  }

  _startDrag(it, e) {
    this.dragging = { it, moved: false, y0: e.clientY };
    it.el.classList.add('dragging');
    this.wrap.classList.add('cursor-ns');
  }

  // 從持倉/掛單線上拖出新的止盈或止損
  _startGhost(parent, kind, e) {
    const spec = kind === 'tp' ? parent.d.addTP : parent.d.addSL;
    const d = {
      key: `${parent.d.key}:new-${kind}`, price: parent.price, color: kind === 'tp' ? '#089981' : '#f23645',
      dashed: true, qty: parent.d.qty, text: spec.text, onCommit: spec.onCommit,
    };
    const it = { d, price: parent.price, el: this._makeEl(), line: this.series.createPriceLine(this._lineOpts(d, parent.price)), ghost: true };
    this.items.set(d.key, it);
    this.overlay.appendChild(it.el);
    this._renderEl(it);
    this._startDrag(it, e);
  }

  _onMove(e) {
    if (!this.dragging) return;
    const { it } = this.dragging;
    if (Math.abs(e.clientY - this.dragging.y0) > 2) this.dragging.moved = true;
    const r = this.wrap.getBoundingClientRect();
    const p = this.series.coordinateToPrice(e.clientY - r.top);
    if (p == null) return;
    it.price = this.round(p);
    it.line.applyOptions({ price: it.price });
    this._renderEl(it);
    it.d.onDrag?.(it.price);
  }

  _onUp() {
    if (!this.dragging) return;
    const { it, moved } = this.dragging;
    this.dragging = null;
    it.el.classList.remove('dragging');
    this.wrap.classList.remove('cursor-ns');
    if (it.ghost) this._remove(it.d.key);
    if (moved) it.d.onCommit(it.price);
    else if (!it.ghost) { it.price = it.d.price; it.line.applyOptions({ price: it.price }); this._renderEl(it); }
  }

  _loop() {
    const paneW = this.chart.timeScale().width();
    const paneH = this.chart.panes()[0]?.getHeight() ?? 0;
    // 價格太接近的標籤往左錯開，避免互相蓋住；也避開部位框等繪圖的文字標籤
    const placed = (this.getAvoid?.() || []).map(r => ({ x: r.x, top: r.y, w: r.w, h: r.h }));
    for (const it of this.items.values()) {
      const y = this.series.priceToCoordinate(it.price);
      if (y == null || y < 0 || y > paneH) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      const w = it.el.offsetWidth, h = 22, top = Math.round(y - 11);
      let x = Math.max(4, paneW - 70 - w);
      for (let moved = true, n = 0; moved && n < 30; n++) {
        moved = false;
        for (const p of placed) {
          const vert = top < p.top + p.h + 1 && top + h > p.top - 1;
          if (vert && x < p.x + p.w + 4 && x + w > p.x - 4) { x = p.x - w - 6; moved = true; }
        }
      }
      placed.push({ x, top, w, h });
      it.el.style.transform = `translate(${Math.max(4, x)}px, ${top}px)`;
    }
    requestAnimationFrame(this._loop);
  }
}
