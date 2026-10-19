// 技術指標：計算 + 在圖表上建立對應的 series
import { LineSeries, HistogramSeries, LineStyle } from '../lib/lightweight-charts.standalone.production.mjs';

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      if (i >= n - 1) {
        let s = 0;
        for (let j = i - n + 1; j <= i; j++) s += values[j];
        prev = s / n;
        out[i] = prev;
      }
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function stdev(values, n, means) {
  return values.map((_, i) => {
    if (means[i] == null) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - means[i]) ** 2;
    return Math.sqrt(s / n);
  });
}

function rsi(values, n) {
  const out = new Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      gain += g; loss += l;
      if (i === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

// 每種指標：名稱、預設參數、要畫哪幾條線、怎麼計算
export const INDICATORS = {
  MA: {
    name: '移動平均線', short: 'MA', overlay: true, params: { length: 9 },
    lines: [{ key: 'ma', color: '#2962ff', width: 1 }],
    calc: (bars, p) => ({ ma: sma(bars.map(b => b.close), p.length) }),
    title: p => `MA ${p.length} close`,
  },
  EMA: {
    name: '指數移動平均線', short: 'EMA', overlay: true, params: { length: 21 },
    lines: [{ key: 'ema', color: '#ff9800', width: 1 }],
    calc: (bars, p) => ({ ema: ema(bars.map(b => b.close), p.length) }),
    title: p => `EMA ${p.length} close`,
  },
  BB: {
    name: '布林通道', short: 'BB', overlay: true, params: { length: 20, mult: 2 },
    lines: [
      { key: 'basis', color: '#2962ff', width: 1 },
      { key: 'upper', color: '#f23645', width: 1 },
      { key: 'lower', color: '#089981', width: 1 },
    ],
    calc: (bars, p) => {
      const c = bars.map(b => b.close);
      const basis = sma(c, p.length);
      const sd = stdev(c, p.length, basis);
      return {
        basis,
        upper: basis.map((m, i) => (m == null ? null : m + p.mult * sd[i])),
        lower: basis.map((m, i) => (m == null ? null : m - p.mult * sd[i])),
      };
    },
    title: p => `BB ${p.length} SMA close ${p.mult}`,
  },
  RSI: {
    name: '相對強弱指數', short: 'RSI', overlay: false, params: { length: 14 },
    lines: [{ key: 'rsi', color: '#7e57c2', width: 1 }],
    levels: [70, 30],
    calc: (bars, p) => ({ rsi: rsi(bars.map(b => b.close), p.length) }),
    title: p => `RSI ${p.length} close`,
    precision: 2,
  },
  MACD: {
    name: '指數平滑異同移動平均線', short: 'MACD', overlay: false, params: { fast: 12, slow: 26, signal: 9 },
    lines: [
      { key: 'hist', type: 'histogram' },
      { key: 'macd', color: '#2962ff', width: 1 },
      { key: 'signal', color: '#ff6d00', width: 1 },
    ],
    calc: (bars, p) => {
      const c = bars.map(b => b.close);
      const f = ema(c, p.fast), s = ema(c, p.slow);
      const macd = c.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
      const firstIdx = macd.findIndex(v => v != null);
      const sig = new Array(c.length).fill(null);
      if (firstIdx >= 0) ema(macd.slice(firstIdx), p.signal).forEach((v, i) => (sig[i + firstIdx] = v));
      return { macd, signal: sig, hist: macd.map((m, i) => (m == null || sig[i] == null ? null : m - sig[i])) };
    },
    title: p => `MACD ${p.close ?? 'close'} ${p.fast} ${p.slow} ${p.signal}`,
    precision: 2,
  },
};

let nextId = 1;

export class IndicatorManager {
  constructor(chart, getBars, getPrecision, onChange) {
    this.chart = chart;
    this.getBars = getBars;
    this.getPrecision = getPrecision;
    this.onChange = onChange;
    this.list = [];
  }

  add(type, params = {}) {
    const def = INDICATORS[type];
    const ind = { id: nextId++, type, def, params: { ...def.params, ...params }, series: {}, visible: true, values: {} };
    let paneIndex = 0;
    if (!def.overlay) paneIndex = this.chart.panes().length;
    for (const line of def.lines) {
      const opts = {
        lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: line.type !== 'histogram',
        priceFormat: { type: 'price', precision: def.precision ?? this.getPrecision(), minMove: 10 ** -(def.precision ?? this.getPrecision()) },
      };
      const s = line.type === 'histogram'
        ? this.chart.addSeries(HistogramSeries, opts, paneIndex)
        : this.chart.addSeries(LineSeries, { ...opts, color: line.color, lineWidth: line.width }, paneIndex);
      ind.series[line.key] = s;
    }
    if (def.levels) {
      const first = ind.series[def.lines[0].key];
      def.levels.forEach(v => first.createPriceLine({ price: v, color: '#787b86', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
    }
    if (!def.overlay) ind.pane = ind.series[def.lines[0].key].getPane();
    if (!def.overlay) ind.pane.setStretchFactor(0.35);
    this.list.push(ind);
    this.recalc(ind);
    this.onChange();
    return ind;
  }

  remove(id) {
    const i = this.list.findIndex(x => x.id === id);
    if (i < 0) return;
    const [ind] = this.list.splice(i, 1);
    Object.values(ind.series).forEach(s => this.chart.removeSeries(s));
    this.onChange();
  }

  toggle(id) {
    const ind = this.list.find(x => x.id === id);
    ind.visible = !ind.visible;
    Object.values(ind.series).forEach(s => s.applyOptions({ visible: ind.visible }));
    this.onChange();
  }

  recalc(ind) {
    const bars = this.getBars();
    const vals = ind.def.calc(bars, ind.params);
    ind.values = vals;
    for (const line of ind.def.lines) {
      const data = [];
      vals[line.key].forEach((v, i) => {
        if (v == null) data.push({ time: bars[i].time });
        else if (line.type === 'histogram') {
          const prev = vals[line.key][i - 1];
          const color = v >= 0 ? (prev != null && prev > v ? '#b2dfdb' : '#26a69a') : (prev != null && prev < v ? '#ffcdd2' : '#ff5252');
          data.push({ time: bars[i].time, value: v, color });
        } else data.push({ time: bars[i].time, value: v });
      });
      ind.series[line.key].setData(data);
    }
  }

  recalcAll() { this.list.forEach(ind => this.recalc(ind)); }

  // 即時 tick：只更新最後一點
  updateLast() {
    const bars = this.getBars();
    const n = bars.length - 1;
    for (const ind of this.list) {
      const vals = ind.def.calc(bars, ind.params);
      ind.values = vals;
      for (const line of ind.def.lines) {
        const v = vals[line.key][n];
        if (v == null) continue;
        const pt = { time: bars[n].time, value: v };
        if (line.type === 'histogram') {
          const prev = vals[line.key][n - 1];
          pt.color = v >= 0 ? (prev != null && prev > v ? '#b2dfdb' : '#26a69a') : (prev != null && prev < v ? '#ffcdd2' : '#ff5252');
        }
        ind.series[line.key].update(pt);
      }
    }
  }

  // 圖例用：取得某根 K 棒的指標數值
  valuesAt(ind, index) {
    return ind.def.lines.map(l => ({ color: l.color ?? '#26a69a', v: ind.values[l.key]?.[index] }));
  }
}
