// K 線重播（仿 TradingView「重播」）：
// 1. 在圖上點一下選起點（或拖曳框選一段），起點之後的 K 線會先藏起來
// 2. 播放時 K 線一根一根長出來，每根 K 線內部也會逐筆走出 開→高/低→收 的路徑，止盈止損會在途中觸發
// 3. 控制列：選擇起點、倒轉回起點、後退一根、播放/暫停、前進一根、加速、退出

export const SPEEDS = [0.5, 1, 2, 3, 5, 10, 20, 50];
const SVG = inner => `<svg viewBox="0 0 28 28" width="28" height="28">${inner}</svg>`;
const S = 'fill="none" stroke="currentColor"';
const IC = {
  pick: `<path ${S} d="M14 5v18M9.5 9.5l-3 4.5 3 4.5M18.5 9.5l3 4.5-3 4.5"/>`,
  rewind: `<path fill="currentColor" d="M7 8h1.5v12H7zM20.5 8.3v11.4L11 14z"/>`,
  back: `<path fill="currentColor" d="M18.5 8.3v11.4L9 14z"/><path fill="currentColor" d="M19.5 8h1.5v12h-1.5z"/>`,
  play: `<path fill="currentColor" d="M9.5 7.5v13l11-6.5z"/>`,
  pause: `<path fill="currentColor" d="M9 7.5h3.5v13H9zM15.5 7.5H19v13h-3.5z"/>`,
  fwd: `<path fill="currentColor" d="M9.5 8.3v11.4L19 14z"/><path fill="currentColor" d="M19.5 8h1.5v12h-1.5z"/>`,
  fast: `<path fill="currentColor" d="M5.5 8.3v11.4L14 14zM14 8.3v11.4L22.5 14z"/>`,
  close: `<path ${S} d="M8 8l12 12M20 8L8 20"/>`,
};

// 用 K 棒時間當種子，讓同一根 K 線每次重播走的路徑都一樣（方便重拍）
function rand(seed) {
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  return () => { x = Math.sin(x * 78.233 + 1.23) * 43758.5453; return x - Math.floor(x); };
}

// 一根 K 線內部的價格路徑：陽線 開→低→高→收、陰線 開→高→低→收，中間加一點小擺動
function buildPath(b) {
  const up = b.close >= b.open;
  const keys = up ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
  const r = rand(b.time);
  const range = Math.max(b.high - b.low, 1e-12);
  const pts = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], c = keys[i];
    for (const t of [0.35, 0.7]) {
      const noise = (r() - 0.5) * range * 0.18;
      pts.push(Math.min(b.high, Math.max(b.low, a + (c - a) * t + noise)));
    }
    pts.push(c);
  }
  const dist = [0];
  for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + Math.abs(pts[i] - pts[i - 1]) + range * 0.02);
  const total = dist[dist.length - 1] || 1;
  return pts.map((p, i) => ({ p, f: dist[i] / total }));
}

function priceAt(path, f) {
  for (let i = 1; i < path.length; i++) {
    if (f <= path[i].f) {
      const a = path[i - 1], b = path[i];
      return a.p + ((b.p - a.p) * (f - a.f)) / (b.f - a.f || 1);
    }
  }
  return path[path.length - 1].p;
}

export class Replay {
  // hooks: getBars, applyBars(bars, mode), feedPrice(p), enter(), exit(), snapshot(), restore(snap), fmtTime(t), toast(...)
  constructor({ chart, wrap, captureRoot, hooks }) {
    Object.assign(this, { chart, wrap, hooks });
    this.active = false;
    this.picking = false;
    this.playing = false;
    this.speedIdx = 3;   // 3x
    this._buildDom();
    this._bindPick(captureRoot);
    this._bindKeys();
    this._loop = this._loop.bind(this);
  }

  get speed() { return SPEEDS[this.speedIdx]; }

  // ================= DOM =================
  _buildDom() {
    this.sel = document.createElement('div');
    this.sel.className = 'rp-sel';
    this.sel.hidden = true;
    this.sel.innerHTML = '<div class="rp-shade"></div><div class="rp-line"></div><div class="rp-hint">點擊選擇重播起點　·　按住拖曳可框選一段　·　Esc 取消</div>';
    this.endLine = document.createElement('div');
    this.endLine.className = 'rp-endline';
    this.endLine.hidden = true;
    this.bar = document.createElement('div');
    this.bar.className = 'replay-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = `
      <button class="rpb" data-a="pick" title="選擇起點（重新框選）">${SVG(IC.pick)}</button>
      <div class="rpb-sep"></div>
      <button class="rpb" data-a="rewind" title="倒轉回起點">${SVG(IC.rewind)}</button>
      <button class="rpb" data-a="back" title="後退一根 ←">${SVG(IC.back)}</button>
      <button class="rpb rpb-play" data-a="play" title="播放 / 暫停（空白鍵）">${SVG(IC.play)}</button>
      <button class="rpb" data-a="fwd" title="前進一根 →">${SVG(IC.fwd)}</button>
      <div class="rpb-sep"></div>
      <button class="rpb rpb-fast" data-a="fast" title="加速 ↑（↓ 減速）">${SVG(IC.fast)}</button>
      <div class="rpb-speedwrap">
        <button class="rpb rpb-speed" data-a="speed" title="播放速度"></button>
        <div class="rpb-menu" hidden>${SPEEDS.map((s, i) => `<button data-speed="${i}">${s}x</button>`).join('')}</div>
      </div>
      <div class="rpb-sep"></div>
      <span class="rpb-time"></span>
      <div class="rpb-sep"></div>
      <button class="rpb" data-a="exit" title="退出重播">${SVG(IC.close)}</button>`;
    this.wrap.append(this.sel, this.endLine, this.bar);

    this.bar.addEventListener('pointerdown', e => e.stopPropagation());
    this.bar.addEventListener('click', e => {
      const sp = e.target.closest('[data-speed]');
      if (sp) { this.speedIdx = +sp.dataset.speed; this._menu(false); this._ui(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'speed') { this._menu(); return; }
      this._menu(false);
      ({
        pick: () => this.startPick(),
        rewind: () => this.rewind(),
        back: () => this.stepBack(),
        play: () => this.toggle(),
        fwd: () => this.stepForward(),
        fast: () => this.faster(),
        exit: () => this.exit(),
      })[a]();
    });
  }

  _menu(show) {
    const m = this.bar.querySelector('.rpb-menu');
    m.hidden = show === undefined ? !m.hidden : !show;
  }

  _ui() {
    this.bar.querySelector('[data-a="play"]').innerHTML = SVG(this.playing ? IC.pause : IC.play);
    this.bar.querySelector('[data-a="play"]').classList.toggle('on', this.playing);
    this.bar.classList.toggle('playing', this.playing);
    this.bar.querySelector('.rpb-speed').textContent = `${this.speed}x`;
    this.bar.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === this.speedIdx));
    const cur = this.bars?.[this.bars.length - 1];
    this.bar.querySelector('.rpb-time').textContent = cur ? this.hooks.fmtTime(cur.time) : '';
  }

  // ================= 選擇起點 / 框選 =================
  startPick() {
    this.pause();
    if (this.active) {
      // 重新選擇時先把全部 K 線放回來
      this.bars = this.all.slice();
      this.hooks.applyBars(this.bars, 'full');
    } else {
      this.all = this.hooks.getBars().slice();
    }
    this.picking = true;
    this.sel.hidden = false;
    this.wrap.classList.add('replay-picking');
    this.hooks.onPickChange?.(true);
  }

  cancelPick() {
    if (!this.picking) return;
    this.picking = false;
    this.dragFrom = null;
    this.sel.hidden = true;
    this.wrap.classList.remove('replay-picking');
    if (this.active) this._gotoIndex(this.pos, 0);
    this.hooks.onPickChange?.(false);
  }

  _idxAt(clientX) {
    const r = this.wrap.getBoundingClientRect();
    const l = Math.round(this.chart.timeScale().coordinateToLogical(clientX - r.left) ?? 0);
    return Math.max(30, Math.min(this.all.length - 2, l));
  }

  _xOf(i) { return this.chart.timeScale().logicalToCoordinate(i); }

  _drawSel(a, b) {
    const shade = this.sel.querySelector('.rp-shade'), line = this.sel.querySelector('.rp-line');
    const w = this.chart.timeScale().width();
    const h = this.chart.panes()[0].getHeight();
    const xa = this._xOf(a);
    if (b == null || a === b) {
      line.style.left = `${xa}px`; line.style.height = `${h}px`; line.hidden = false;
      shade.style.left = `${xa}px`; shade.style.width = `${Math.max(0, w - xa)}px`; shade.style.height = `${h}px`;
    } else {
      const x1 = this._xOf(Math.min(a, b)), x2 = this._xOf(Math.max(a, b));
      line.style.left = `${x1}px`; line.style.height = `${h}px`;
      shade.style.left = `${x1}px`; shade.style.width = `${x2 - x1}px`; shade.style.height = `${h}px`;
    }
  }

  _bindPick(root) {
    const inChart = e => this.wrap.contains(e.target) && !e.target.closest('.replay-bar');
    root.addEventListener('pointerdown', e => {
      if (!this.picking || e.button !== 0 || !inChart(e)) return;
      e.stopPropagation(); e.preventDefault();
      this.dragFrom = this._idxAt(e.clientX);
      this._swallow = true;
    }, true);
    root.addEventListener('mousedown', e => { if (this._swallow) { e.stopPropagation(); this._swallow = false; } }, true);
    window.addEventListener('pointermove', e => {
      if (!this.picking) return;
      const i = this._idxAt(e.clientX);
      this._drawSel(this.dragFrom ?? i, this.dragFrom != null ? i : null);
    });
    window.addEventListener('pointerup', e => {
      if (!this.picking || this.dragFrom == null) return;
      const a = this.dragFrom, b = this._idxAt(e.clientX);
      this.dragFrom = null;
      this.picking = false;
      this.sel.hidden = true;
      this.wrap.classList.remove('replay-picking');
      this.hooks.onPickChange?.(false);
      if (Math.abs(b - a) >= 2) this._begin(Math.min(a, b), Math.max(a, b));
      else this._begin(a, null);
    });
  }

  // ================= 開始 / 結束 =================
  _begin(start, end) {
    if (!this.active) { this.active = true; this.hooks.enter(); }
    this.start = start;
    this.end = end;
    this.snap = null;
    this._gotoIndex(start, 0);
    const ts = this.chart.timeScale();
    const span = end != null ? Math.max(60, end - start + 40) : 150;
    ts.setVisibleLogicalRange({ from: start - span * 0.75, to: start + span * 0.25 + (end != null ? end - start : 0) * 0.75 });
    this.bar.hidden = false;
    this.endLine.hidden = end == null;
    this._ui();
    this._trackEnd();
    this.hooks.toast?.('重播', end != null ? `已框選 ${end - start} 根K線，按 ▶ 開始播放` : '已選擇起點，按 ▶ 開始播放', 'info');
  }

  // 不經過 hooks.exit 直接停止（換商品/週期時用）
  reset() {
    this.pause();
    this.cancelPick();
    this.active = false;
    this.bar.hidden = true;
    this.endLine.hidden = true;
  }

  exit() {
    this.pause();
    this.cancelPick();
    if (!this.active) return;
    this.active = false;
    this.bar.hidden = true;
    this.endLine.hidden = true;
    this.hooks.exit();
  }

  // 跳到某一根（pos = 最後一根完整顯示的 K 線）
  _gotoIndex(pos, prog) {
    this.pos = pos;
    this.prog = prog;
    this.fed = 0;
    this.bars = this.all.slice(0, pos + 1);
    this.hooks.applyBars(this.bars, 'full');
    this.hooks.feedPrice([this.bars[pos].close]);
    this._ui();
  }

  get endIdx() { return this.end ?? this.all.length - 1; }

  _trackEnd() {
    if (!this.active) return;
    if (this.end != null) {
      const x = this._xOf(this.end);
      const h = this.chart.panes()[0].getHeight();
      this.endLine.style.transform = `translateX(${x ?? -10}px)`;
      this.endLine.style.height = `${h}px`;
    }
    requestAnimationFrame(() => this._trackEnd());
  }

  // ================= 播放控制 =================
  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    if (!this.active || this.playing) return;
    if (this.pos >= this.endIdx && this.prog === 0) { this.hooks.toast?.('重播', '已經到終點了，可以按 ⏮ 倒轉回起點', 'info'); return; }
    // 從起點開始播時記下帳戶狀態，倒轉時可以還原（方便重拍）
    if (this.pos === this.start && this.prog === 0) this.snap = this.hooks.snapshot();
    this.playing = true;
    this.lastTs = performance.now();
    this._ui();
    requestAnimationFrame(this._loop);
  }

  pause() {
    this.playing = false;
    if (this.bar) this._ui();
  }

  faster() {
    this.speedIdx = Math.min(SPEEDS.length - 1, this.speedIdx + 1);
    this._ui();
  }

  slower() {
    this.speedIdx = Math.max(0, this.speedIdx - 1);
    this._ui();
  }

  rewind() {
    if (!this.active) return;
    this.pause();
    this._gotoIndex(this.start, 0);
    if (this.snap) this.hooks.restore(this.snap);
    const r = this.chart.timeScale().getVisibleLogicalRange();
    if (r) {
      const w = r.to - r.from;
      this.chart.timeScale().setVisibleLogicalRange({ from: this.start - w * 0.75, to: this.start + w * 0.25 });
    }
  }

  stepBack() {
    if (!this.active) return;
    this.pause();
    this._gotoIndex(this.prog > 0 ? this.pos : Math.max(30, this.pos - 1), 0);
  }

  stepForward() {
    if (!this.active) return;
    this.pause();
    if (!this._commit()) return;
    this.prog = 0;
    this._ui();
  }

  _loop(ts) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.prog += dt * this.speed;
    while (this.prog >= 1) {
      this.prog -= 1;
      if (!this._commit()) {
        this.prog = 0;
        this.pause();
        this.hooks.toast?.('重播', this.end != null ? '已播放到框選範圍的終點' : '已播放到最新的K線', 'info');
        return;
      }
    }
    this._partial();
    this._ui();
    requestAnimationFrame(this._loop);
  }

  // 下一根 K 線完整收盤
  _commit() {
    const next = this.pos + 1;
    if (next > this.endIdx) return false;
    const b = this.all[next];
    const path = buildPath(b);
    this.hooks.feedPrice(path.filter(pt => pt.f > this.fed).map(pt => pt.p));
    const grew = this.bars.length === next;
    this.bars[next] = b;
    this.pos = next;
    this.fed = 0;
    this.hooks.applyBars(this.bars, grew ? 'new' : 'last');
    return true;
  }

  // 正在形成中的 K 線（第 pos+1 根，進度 prog）
  _partial() {
    const next = this.pos + 1;
    if (this.prog <= 0 || next > this.endIdx) return;
    const b = this.all[next];
    const path = buildPath(b);
    const f = this.prog;
    const p = priceAt(path, f);
    const passed = path.filter(pt => pt.f <= f).map(pt => pt.p);
    const hi = Math.max(...passed, p), lo = Math.min(...passed, p);
    const grew = this.bars.length === next;
    this.bars[next] = { time: b.time, open: b.open, high: hi, low: lo, close: p, volume: b.volume * f };
    // 把這一幀之間經過的轉折點依序餵給券商，止盈止損才不會被跳過
    this.hooks.feedPrice([...path.filter(pt => pt.f > this.fed && pt.f <= f).map(pt => pt.p), p]);
    this.fed = f;
    this.hooks.applyBars(this.bars, grew ? 'new' : 'last');
  }

  _bindKeys() {
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea')) return;
      if (this.picking && e.key === 'Escape') { this.cancelPick(); if (!this.active) this.hooks.onCancel?.(); return; }
      if (!this.active) return;
      if (e.key === ' ') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.stepForward(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.stepBack(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.faster(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.slower(); }
    });
  }
}
