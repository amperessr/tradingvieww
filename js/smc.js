// 幣聖課指標（ACDC_College）：3+1指標 Lv1、馬刺策略_BSC2026
//
// 定義照「AI 特效生成工具」專案裡的 three-plus-one / spur-amd 範本（安培指定的標準），
// 那邊是在造好的資料上找「一次」，這裡改成在真實 K 線上**由左到右掃出所有符合的訊號**。
// 只用已經走出來的 K 棒判斷（擺動點要等右邊 k 根收完才算數），所以重播時訊號不會提前劇透。
// 做空＝做多的鏡像：K 棒上下翻過來、用同一套做多的邏輯找，再把價位翻回去。

const flip = b => ({ time: b.time, o: -b.open, c: -b.close, h: -b.low, l: -b.high });
const norm = b => ({ time: b.time, o: b.open, c: b.close, h: b.high, l: b.low });

/** 擺動高／低點：前後 k 根都沒有更高（更低）的 */
function swings(cs, k, hi) {
  const out = [];
  for (let i = k; i < cs.length - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (hi ? cs[j].h >= cs[i].h : cs[j].l <= cs[i].l) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

// =====================================================================
// 3+1：① CHoCH → ② BOS → ③ 失衡區 → ④ 回踩訂單塊，四個依序成立才出訊號
// =====================================================================
function scan3p1Long(cs, { k = 2, maxGap = 60 } = {}) {
  const his = swings(cs, k, true);
  const los = swings(cs, k, false);
  const out = [];
  let from = 0;   // 上一個訊號之後才找下一個，避免同一段行情重複出訊號
  for (const bottom of los) {
    if (bottom < from) continue;
    // ① CHoCH：底之前最近的擺動高點（最後一個更低的高點），被底之後的收盤突破
    const before = his.filter(i => i < bottom);
    if (!before.length) continue;
    const chFrom = before[before.length - 1];
    // 要是「更低的高點」才是下跌趨勢裡的性質改變
    if (before.length >= 2 && cs[before[before.length - 2]].h <= cs[chFrom].h) continue;
    let choch = -1;
    for (let i = bottom + 1; i < cs.length && i <= bottom + maxGap; i++) {
      if (cs[i].l < cs[bottom].l) break;               // 先破底：這個底不成立
      if (cs[i].c > cs[chFrom].h) { choch = i; break; }
    }
    if (choch < 0) continue;

    // ② BOS：CHoCH 之後形成的第一個擺動高點，再被收盤突破
    const bosFrom = his.find(i => i > choch && i <= choch + maxGap);
    if (bosFrom == null) continue;
    let bos = -1;
    for (let i = bosFrom + 1; i < cs.length && i <= bosFrom + maxGap; i++) {
      if (cs[i].c > cs[bosFrom].h) { bos = i; break; }
    }
    if (bos < 0) continue;

    // ④ 訂單塊：推升起點（BOS 之前最後一個擺動低點）之前的最後一根陰線
    const losBefore = los.filter(i => i < bos);
    let impStart = losBefore.length ? losBefore[losBefore.length - 1] : bosFrom;
    if (impStart < bosFrom) {
      let lo = Infinity;
      for (let i = bosFrom; i <= bos; i++) if (cs[i].l < lo) { lo = cs[i].l; impStart = i; }
    }
    let ob = -1;
    for (let i = impStart; i >= Math.max(1, impStart - 10); i--) if (cs[i].c < cs[i].o) { ob = i; break; }
    if (ob < 0) continue;
    const obZone = { lo: Math.min(cs[ob].o, cs[ob].c), hi: Math.max(cs[ob].o, cs[ob].c) };

    // ③ 失衡區：推升那段裡「第一根的高點 < 第三根的低點」，取最大的缺口
    let fvg = null;
    for (let i = Math.max(1, ob); i < Math.min(cs.length - 1, bos + 1); i++) {
      const glo = cs[i - 1].h, ghi = cs[i + 1].l;
      if (ghi > glo && (!fvg || ghi - glo > fvg.hi - fvg.lo)) fvg = { at: i, lo: glo, hi: ghi };
    }
    if (!fvg) continue;

    // 進場：BOS 之後價格回來碰到訂單塊（收到訂單塊下面就算失敗）
    let retest = -1;
    for (let i = bos + 1; i < cs.length && i <= bos + maxGap; i++) {
      if (cs[i].l <= obZone.hi) { retest = cs[i].c >= obZone.lo ? i : -2; break; }
    }
    if (retest < 0) { if (retest === -1) from = bos; continue; }

    out.push({ chFrom, chLevel: cs[chFrom].h, choch, bosFrom, bosLevel: cs[bosFrom].h, bos, ob, obZone, fvg, retest });
    from = retest + 1;
  }
  return out;
}

export function detect3p1(bars, params = {}) {
  const cs = bars.map(norm);
  const longs = scan3p1Long(cs, params).map(s => ({ ...s, dir: 1 }));
  const shorts = scan3p1Long(bars.map(flip), params).map(s => ({
    ...s, dir: -1, chLevel: -s.chLevel, bosLevel: -s.bosLevel,
    obZone: { lo: -s.obZone.hi, hi: -s.obZone.lo }, fvg: { at: s.fvg.at, lo: -s.fvg.hi, hi: -s.fvg.lo },
  }));
  return [...longs, ...shorts].sort((a, b) => a.retest - b.retest);
}

// =====================================================================
// 馬刺（AMD）：吸籌箱 → 操縱（刺破箱底又收回）→ BOS 站上箱頂才出訊號
// =====================================================================
function boxOf(cs, aS, aEnd) {
  let R = -Infinity, S = Infinity, hiIdx = aS;
  for (let i = aS; i <= aEnd; i++) {
    if (cs[i].h > R) { R = cs[i].h; hiIdx = i; }
    if (cs[i].l < S) S = cs[i].l;
  }
  return { R, S, hiIdx, H: R - S };
}

// 區間內前後各 2 根的擺動點（只看區間內）
function swingsIn(cs, from, to, hi, k = 2) {
  const out = [];
  for (let i = from + k; i <= to - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (hi ? cs[j].h > cs[i].h : cs[j].l < cs[i].l) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

function atr(cs, i, n = 14) {
  let s = 0, c = 0;
  for (let j = Math.max(1, i - n + 1); j <= i; j++) {
    s += Math.max(cs[j].h - cs[j].l, Math.abs(cs[j].h - cs[j - 1].c), Math.abs(cs[j].l - cs[j - 1].c));
    c++;
  }
  return c ? s / c : 0;
}

function scanSpurLong(cs, { lens = [60, 48, 40, 32, 24, 18, 14, 10], maxWait = 60, maxBoxAtr = 8 } = {}) {
  const out = [];
  let from = 0;
  for (let m = Math.max(...lens) + 1; m < cs.length; m++) {
    if (m < from) continue;
    // 吸籌：操縱那根之前的一段橫盤。每種長度都完整檢查一遍（箱子、操縱、BOS），長的優先
    const k = cs[m];
    let hit = null;
    for (const L of lens) {
      const aS = m - L, e = m - 1;
      if (aS < 1) continue;
      const b = boxOf(cs, aS, e);
      if (!(b.H > 0) || b.H > maxBoxAtr * atr(cs, e)) continue;           // 太寬就不是橫盤
      const tol = b.H * 0.2;
      if (swingsIn(cs, aS, e, true).filter(i => cs[i].h >= b.R - tol).length < 2) continue;   // 箱頂附近至少碰兩次
      if (swingsIn(cs, aS, e, false).filter(i => cs[i].l <= b.S + tol).length < 2) continue;  // 箱底附近至少碰兩次
      const { R, S, H } = b;
      // 操縱：吸籌之後第一根刺破箱底、收盤收回箱內，刺得夠深才看得出是一根「刺」
      if (!(k.l < S) || k.c < S || k.c > R || S - k.l < H * 0.15) continue;
      // 派發：操縱之後第一根收盤站上箱頂（BOS）；之前不能收到箱底下、也不能再破操縱的低點
      let bos = -1, failed = false;
      for (let i = m + 1; i < cs.length && i <= m + maxWait; i++) {
        if (cs[i].l <= k.l || cs[i].c < S) { failed = true; break; }
        if (cs[i].c > R) { bos = i; break; }
      }
      if (failed || bos < 0) continue;
      hit = { aS, R, S, hiIdx: b.hiIdx, bos };
      break;
    }
    if (!hit) continue;
    const { aS, R, S, hiIdx, bos } = hit;
    out.push({ aS, aEnd: m - 1, R, S, hiIdx, m, tip: k.l, bos });
    from = bos + 1;
  }
  return out;
}

export function detectSpur(bars, params = {}) {
  const cs = bars.map(norm);
  const longs = scanSpurLong(cs, params).map(s => ({ ...s, dir: 1 }));
  const shorts = scanSpurLong(bars.map(flip), params).map(s => ({ ...s, dir: -1, R: -s.R, S: -s.S, tip: -s.tip }));
  return [...longs, ...shorts].sort((a, b) => a.bos - b.bos);
}

// =====================================================================
// 畫在主圖上的圖層（series primitive）
// =====================================================================
const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, "Microsoft JhengHei", sans-serif';
const LONG_C = '#089981', SHORT_C = '#f23645', FVG_C = '#2962ff';

function hexA(hex, a) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function pill(ctx, x, y, text, bg, below) {
  ctx.font = `600 11px ${FONT}`;
  const w = ctx.measureText(text).width + 12, h = 18;
  const top = below ? y + 8 : y - 8 - h;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, top, w, h, 3);
  ctx.fill();
  // 小三角指向那根 K 棒
  ctx.beginPath();
  if (below) { ctx.moveTo(x - 4, top); ctx.lineTo(x, y + 2); ctx.lineTo(x + 4, top); }
  else { ctx.moveTo(x - 4, top + h); ctx.lineTo(x, y - 2); ctx.lineTo(x + 4, top + h); }
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, top + h / 2 + 0.5);
}

function levelLine(ctx, x1, x2, y, color, label, above) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(x1, Math.round(y) + 0.5); ctx.lineTo(x2, Math.round(y) + 0.5); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `10px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = above ? 'bottom' : 'top';
  ctx.fillText(label, (x1 + x2) / 2, above ? y - 2 : y + 2);
}

export class SignalLayer {
  // kind: '3p1' | 'spur'
  constructor(chart, kind) {
    this.chart = chart;
    this.kind = kind;
    this.items = [];
    this.visible = true;
    this._view = {
      zOrder: () => 'top',
      renderer: () => ({ draw: t => t.useMediaCoordinateSpace(s => this._draw(s.context)) }),
    };
  }
  attached(p) { this.requestUpdate = p.requestUpdate; this.series = p.series; }
  detached() { this.requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return [this._view]; }
  set(items) { this.items = items; this.requestUpdate?.(); }
  setVisible(v) { this.visible = v; this.requestUpdate?.(); }

  _x(i) { return this.chart.timeScale().logicalToCoordinate(i); }
  _y(p) { return this.series.priceToCoordinate(p); }

  _draw(ctx) {
    if (!this.visible || !this.series) return;
    const r = this.chart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    const bar = this.chart.timeScale().width() / Math.max(1, r.to - r.from);
    ctx.save();
    for (const it of this.items) {
      const last = this.kind === '3p1' ? it.retest : it.bos;
      const first = this.kind === '3p1' ? it.chFrom : it.hiIdx;
      if (last < r.from - 5 || first > r.to + 5) continue;
      if (this.kind === '3p1') this._draw3p1(ctx, it, bar);
      else this._drawSpur(ctx, it, bar);
    }
    ctx.restore();
  }

  _draw3p1(ctx, s, bar) {
    const long = s.dir > 0, col = long ? LONG_C : SHORT_C;
    const X = i => this._x(i), Y = p => this._y(p);
    const xEnd = X(s.retest) + bar * 2;
    // 訂單塊（實心淡色）
    const oy1 = Y(s.obZone.hi), oy2 = Y(s.obZone.lo), ox = X(s.ob) - bar / 2;
    if ([oy1, oy2, ox].every(v => v != null)) {
      ctx.fillStyle = hexA(col, 0.16);
      ctx.fillRect(ox, oy1, xEnd - ox, oy2 - oy1);
      ctx.strokeStyle = hexA(col, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy1 + 0.5, xEnd - ox, oy2 - oy1);
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = col;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('OB', ox + 3, Math.min(oy1, oy2) - 1);
    }
    // 失衡區（斜線＋上下緣，表示「沒有成交過的缺口」）
    const fy1 = Y(s.fvg.hi), fy2 = Y(s.fvg.lo), fx = X(s.fvg.at - 1) - bar / 2;
    if ([fy1, fy2, fx].every(v => v != null)) {
      const top = Math.min(fy1, fy2), h = Math.abs(fy2 - fy1), w = xEnd - fx;
      ctx.save();
      ctx.beginPath(); ctx.rect(fx, top, w, h); ctx.clip();
      ctx.strokeStyle = hexA(FVG_C, 0.35);
      ctx.lineWidth = 1;
      for (let d = -h; d < w; d += 6) { ctx.beginPath(); ctx.moveTo(fx + d, top + h); ctx.lineTo(fx + d + h, top); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = hexA(FVG_C, 0.8);
      ctx.beginPath(); ctx.moveTo(fx, Math.round(top) + 0.5); ctx.lineTo(fx + w, Math.round(top) + 0.5);
      ctx.moveTo(fx, Math.round(top + h) + 0.5); ctx.lineTo(fx + w, Math.round(top + h) + 0.5); ctx.stroke();
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = FVG_C;
      ctx.textAlign = 'left';
      ctx.textBaseline = long ? 'top' : 'bottom';
      ctx.fillText('FVG', fx + 3, long ? top + h + 1 : top - 1);
    }
    // CHoCH、BOS：標籤標在突破的那一側
    const cy = Y(s.chLevel), by = Y(s.bosLevel);
    if (cy != null) levelLine(ctx, X(s.chFrom), X(s.choch), cy, col, 'CHoCH', long);
    if (by != null) levelLine(ctx, X(s.bosFrom), X(s.bos), by, col, 'BOS', long);
    // 訊號：回踩那根
    const bars = this.bars?.();
    const k = bars?.[s.retest];
    if (k) {
      const yy = Y(long ? k.low : k.high);
      if (yy != null) pill(ctx, X(s.retest), yy, long ? '3+1做多' : '3+1做空', col, long);
    }
  }

  _drawSpur(ctx, s, bar) {
    const long = s.dir > 0, col = long ? LONG_C : SHORT_C;
    const X = i => this._x(i), Y = p => this._y(p);
    // BOS 線：從箱頂那根畫到站上箱頂那根
    const ry = Y(s.R);
    if (ry != null) levelLine(ctx, X(s.hiIdx), X(s.bos) + bar, ry, col, 'BOS', long);
    // 訊號標在操縱那根的尖端（BOS 成立才會被掃到，所以不會提前出現）
    const ty = Y(s.tip);
    if (ty != null) pill(ctx, X(s.m), ty, long ? '馬刺做多' : '馬刺做空', col, long);
  }
}
