// 行情來源：Binance 公開 API（REST + WebSocket），連不上時自動切換成本機模擬行情。

export const INTERVALS = [
  { id: '1m', label: '1分', menu: '1 分鐘', legend: '1', sec: 60, group: '分' },
  { id: '3m', label: '3分', menu: '3 分鐘', legend: '3', sec: 180, group: '分' },
  { id: '5m', label: '5分', menu: '5 分鐘', legend: '5', sec: 300, group: '分' },
  { id: '15m', label: '15分', menu: '15 分鐘', legend: '15', sec: 900, group: '分' },
  { id: '30m', label: '30分', menu: '30 分鐘', legend: '30', sec: 1800, group: '分' },
  { id: '1h', label: '1小時', menu: '1 小時', legend: '60', sec: 3600, group: '小時' },
  { id: '2h', label: '2小時', menu: '2 小時', legend: '120', sec: 7200, group: '小時' },
  { id: '4h', label: '4小時', menu: '4 小時', legend: '240', sec: 14400, group: '小時' },
  { id: '6h', label: '6小時', menu: '6 小時', legend: '360', sec: 21600, group: '小時' },
  { id: '12h', label: '12小時', menu: '12 小時', legend: '720', sec: 43200, group: '小時' },
  { id: '1d', label: '天', menu: '1 天', legend: '1D', sec: 86400, group: '天' },
  { id: '3d', label: '3天', menu: '3 天', legend: '3D', sec: 259200, group: '天' },
  { id: '1w', label: '週', menu: '1 週', legend: '1W', sec: 604800, group: '天' },
];
export const FAVORITE_INTERVALS = ['5m', '15m', '30m', '1h', '4h', '1d'];
export const intervalSec = id => INTERVALS.find(i => i.id === id).sec;

// 圖表以本地時區顯示：把 UTC 秒數平移成「看起來像本地時間」的秒數
export const TZ_OFFSET = -new Date().getTimezoneOffset() * 60;

// Binance USDⓈ-M 永續合約（TradingView 上顯示為 XXXUSDT.P）
export const SYMBOLS = {
  BTCUSDT: { name: 'Bitcoin', base: 'BTC', color: '#f7931a', icon: '₿', precision: 1, start: 82000 },
  ETHUSDT: { name: 'Ethereum', base: 'ETH', color: '#627eea', icon: 'Ξ', precision: 2, start: 3100 },
  SOLUSDT: { name: 'Solana', base: 'SOL', color: '#9945ff', icon: 'S', precision: 2, start: 150 },
  BNBUSDT: { name: 'BNB', base: 'BNB', color: '#f3ba2f', icon: 'B', precision: 2, start: 600 },
  XRPUSDT: { name: 'XRP', base: 'XRP', color: '#346aa9', icon: 'X', precision: 4, start: 2.2 },
  DOGEUSDT: { name: 'Dogecoin', base: 'DOGE', color: '#c2a633', icon: 'Ð', precision: 5, start: 0.18 },
  ADAUSDT: { name: 'Cardano', base: 'ADA', color: '#0033ad', icon: 'A', precision: 4, start: 0.7 },
  AVAXUSDT: { name: 'Avalanche', base: 'AVAX', color: '#e84142', icon: 'A', precision: 3, start: 22 },
  LINKUSDT: { name: 'Chainlink', base: 'LINK', color: '#2a5ada', icon: 'L', precision: 3, start: 15 },
  LTCUSDT: { name: 'Litecoin', base: 'LTC', color: '#345d9d', icon: 'Ł', precision: 2, start: 90 },
  TRXUSDT: { name: 'TRON', base: 'TRX', color: '#eb0029', icon: 'T', precision: 5, start: 0.25 },
  DOTUSDT: { name: 'Polkadot', base: 'DOT', color: '#e6007a', icon: 'D', precision: 3, start: 4.5 },
};
// TradingView 上 Binance 永續合約的說明格式
for (const m of Object.values(SYMBOLS)) m.desc = `${m.name} / TetherUS PERPETUAL CONTRACT`;
export const EXCHANGE = 'Binance';
export const displaySymbol = s => `${s}.P`;

export function symbolMeta(symbol) {
  if (SYMBOLS[symbol]) return SYMBOLS[symbol];
  const base = symbol.replace(/(USDT|USDC|BUSD|BTC|ETH)$/, '') || symbol;
  return { desc: `${base} / TetherUS PERPETUAL CONTRACT`, base, color: '#787b86', icon: base[0] || '?', precision: 4, start: 1 };
}

const REST = 'https://fapi.binance.com/fapi/v1';
const WSS = 'wss://fstream.binance.com/stream?streams=';

async function fetchJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 自動重連的 combined stream
function openStream(streams, onData) {
  let ws, closed = false, retry = 0;
  const connect = () => {
    ws = new WebSocket(WSS + streams.join('/'));
    ws.onmessage = e => {
      retry = 0;
      const msg = JSON.parse(e.data);
      onData(msg.data, msg.stream);
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
    };
  };
  connect();
  return () => { closed = true; ws.close(); };
}

const klineToBar = k => ({
  time: Math.floor(k.t / 1000) + TZ_OFFSET,
  open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v,
});

export class Datafeed {
  constructor() {
    this.live = true;
    this.sim = new Simulator();
    this._infoCache = {};
  }

  // 從 exchangeInfo 取得每個合約的最小跳動點（只抓一次）
  _ticks() {
    this._tickPromise ??= fetchJSON(`${REST}/exchangeInfo`, 10000)
      .then(info => Object.fromEntries(info.symbols.map(s => [s.symbol, s.filters.find(f => f.filterType === 'PRICE_FILTER').tickSize])))
      .catch(() => ({}));
    return this._tickPromise;
  }

  async getSymbolInfo(symbol) {
    if (this._infoCache[symbol]) return this._infoCache[symbol];
    let precision = symbolMeta(symbol).precision;
    if (this.live) {
      const tick = (await this._ticks())[symbol];
      if (tick) precision = tick.replace(/0+$/, '').split('.')[1]?.length ?? 0;
    }
    return (this._infoCache[symbol] = { precision, minMove: +(10 ** -precision).toFixed(precision) });
  }

  async hasSymbol(symbol) {
    if (!this.live) return !!SYMBOLS[symbol];
    return symbol in (await this._ticks());
  }

  async getBars(symbol, interval, { limit = 1000, endTime } = {}) {
    if (this.live) {
      try {
        let url = `${REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        if (endTime) url += `&endTime=${(endTime - TZ_OFFSET) * 1000 - 1}`;
        const raw = await fetchJSON(url);
        return raw.map(k => ({
          time: k[0] / 1000 + TZ_OFFSET,
          open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
        }));
      } catch (err) {
        if (endTime) return [];
        console.warn('Binance 連線失敗，改用模擬行情', err);
        this.live = false;
      }
    }
    return this.sim.bars(symbol, interval, limit, endTime);
  }

  async get24h(symbols) {
    if (this.live) {
      try {
        const list = (await fetchJSON(`${REST}/ticker/24hr`)).filter(t => symbols.includes(t.symbol));
        return Object.fromEntries(list.map(t => [t.symbol, {
          last: +t.lastPrice, open: +t.openPrice, high: +t.highPrice, low: +t.lowPrice,
          volume: +t.volume, quoteVolume: +t.quoteVolume,
        }]));
      } catch { /* 交給模擬 */ }
    }
    return Object.fromEntries(symbols.map(s => [s, this.sim.ticker(s)]));
  }

  subscribeKline(symbol, interval, cb) {
    if (!this.live) return this.sim.on('kline', { symbol, interval, cb });
    return openStream([`${symbol.toLowerCase()}@kline_${interval}`], d => cb(klineToBar(d.k)));
  }

  subscribeBook(symbol, cb) {
    if (!this.live) return this.sim.on('book', { symbol, cb });
    return openStream([`${symbol.toLowerCase()}@bookTicker`], d => cb({ bid: +d.b, ask: +d.a }));
  }

  subscribeTickers(symbols, cb) {
    if (!this.live) return this.sim.on('ticker', { symbols, cb });
    return openStream(symbols.map(s => `${s.toLowerCase()}@miniTicker`), d => cb(d.s, {
      last: +d.c, open: +d.o, high: +d.h, low: +d.l, volume: +d.v, quoteVolume: +d.q,
    }));
  }
}

// ---------------- 模擬行情 ----------------
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Simulator {
  constructor() {
    this.price = {};
    this.day = {};
    this.subs = { kline: new Set(), book: new Set(), ticker: new Set() };
    this.timer = null;
  }

  _p(symbol) {
    if (!(symbol in this.price)) this.price[symbol] = symbolMeta(symbol).start;
    return this.price[symbol];
  }

  bars(symbol, interval, limit, endTime) {
    const step = intervalSec(interval);
    const nowBar = Math.floor((Date.now() / 1000) / step) * step + TZ_OFFSET;
    const last = endTime ? endTime - step : nowBar;
    const vol = 0.0025 * Math.sqrt(step / 60);
    // 從現價往回推，讓最後一根貼近目前模擬價格
    let p = this._p(symbol);
    const out = [];
    for (let i = 0; i < limit; i++) {
      const close = p;
      const open = close / (1 + gauss() * vol);
      const high = Math.max(open, close) * (1 + Math.abs(gauss()) * vol * 0.6);
      const low = Math.min(open, close) * (1 - Math.abs(gauss()) * vol * 0.6);
      out.push({ time: last - i * step, open, high, low, close, volume: Math.abs(gauss()) * 100 + 20 });
      p = open;
    }
    out.reverse();
    if (!endTime) this.day[symbol] = out[Math.max(0, out.length - Math.ceil(86400 / step))].open;
    return out;
  }

  ticker(symbol) {
    const last = this._p(symbol);
    const open = this.day[symbol] ?? last * (1 + gauss() * 0.02);
    this.day[symbol] = open;
    return { last, open, high: Math.max(open, last) * 1.01, low: Math.min(open, last) * 0.99, volume: 12345, quoteVolume: 12345 * last };
  }

  on(kind, sub) {
    if (kind === 'kline') sub.bar = null;
    this.subs[kind].add(sub);
    if (!this.timer) this.timer = setInterval(() => this._tick(), 400);
    return () => this.subs[kind].delete(sub);
  }

  _tick() {
    const active = new Set();
    this.subs.kline.forEach(s => active.add(s.symbol));
    this.subs.book.forEach(s => active.add(s.symbol));
    this.subs.ticker.forEach(s => s.symbols.forEach(x => active.add(x)));
    for (const sym of active) this.price[sym] = this._p(sym) * (1 + gauss() * 0.0006);

    const nowSec = Date.now() / 1000;
    for (const s of this.subs.kline) {
      const step = intervalSec(s.interval);
      const t = Math.floor(nowSec / step) * step + TZ_OFFSET;
      const p = this.price[s.symbol];
      if (!s.bar || s.bar.time !== t) s.bar = { time: t, open: s.bar ? s.bar.close : p, high: p, low: p, close: p, volume: 0 };
      s.bar.high = Math.max(s.bar.high, p);
      s.bar.low = Math.min(s.bar.low, p);
      s.bar.close = p;
      s.bar.volume += Math.random() * 3;
      s.cb({ ...s.bar });
    }
    for (const s of this.subs.book) {
      const p = this.price[s.symbol];
      const tick = 10 ** -symbolMeta(s.symbol).precision;
      s.cb({ bid: p - tick, ask: p + tick });
    }
    for (const s of this.subs.ticker) s.symbols.forEach(sym => s.cb(sym, this.ticker(sym)));
  }
}
