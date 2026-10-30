import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  ColorType, CrosshairMode, LineStyle, PriceScaleMode, createTextWatermark,
} from '../lib/lightweight-charts.standalone.production.mjs';
import { Datafeed, INTERVALS, FAVORITE_INTERVALS, intervalSec, SYMBOLS, symbolMeta, displaySymbol, EXCHANGE, TZ_OFFSET } from './datafeed.js';
import { Broker, sideText, typeText } from './broker.js';
import { IndicatorManager, INDICATORS } from './indicators.js';
import { Drawings, TOOL_NAMES } from './drawings.js';
import { TradeLines } from './tradelines.js';
import { buildLeftToolbar, ICONS } from './lefttoolbar.js';
import { Replay } from './replay.js';
import { Recorder } from './recorder.js';

const UP = '#089981', DOWN = '#f23645', BLUE = '#2962ff', GREEN = '#089981', RED = '#f23645';
const VOL_UP = 'rgba(38, 166, 154, 0.5)', VOL_DOWN = 'rgba(239, 83, 80, 0.5)';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT'];
const PREF_KEY = 'fake-tv-prefs-v2';
const PALETTE = ['#ffffff', '#d1d4dc', '#b2b5be', '#787b86', '#5d606b', '#434651', '#2a2e39', '#1e222d', '#131722', '#000000',
  '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'];

// ================= 狀態 =================
const prefs = loadPrefs();
const state = {
  symbol: prefs.symbol || 'BTCUSDT',
  interval: prefs.interval || '30m',
  favorites: prefs.favorites || [...FAVORITE_INTERVALS],
  chartType: prefs.chartType || 'candles',
  bars: [],
  precision: 1,
  book: { bid: null, ask: null },
  tickers: {},
  qty: null,
  hoverIndex: null,
  volumeVisible: prefs.volume !== false,
  cursorMode: 'cross',
  rightView: prefs.rightView || null,
  bottomOpen: !!prefs.bottomOpen,
  indicatorsHidden: false,
  watermark: prefs.watermark !== false,
};
const ticket = { side: 'buy', type: 'market', price: null, tpOn: false, slOn: false, tp: null, sl: null };
let toolbarState = prefs.toolbar || {};
// 錄影固定 30 fps、標準畫質（和畫面一樣大），只讓使用者選範圍
const recPrefs = { area: prefs.recArea || 'chart', fps: 30, scale: 1 };

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({
      symbol: state.symbol, interval: state.interval, chartType: state.chartType, favorites: state.favorites,
      indicators: indicators.list.map(i => ({ type: i.type, params: i.params })), volume: state.volumeVisible,
      rightView: state.rightView, bottomOpen: state.bottomOpen, toolbar: toolbarState, watermark: state.watermark,
      recArea: recPrefs.area,
    }));
  } catch { /* 忽略 */ }
}

// ================= 格式化 =================
const fmt = (p, prec = state.precision) =>
  p == null || isNaN(p) ? '—' : Number(p).toLocaleString('en-US', { minimumFractionDigits: prec, maximumFractionDigits: prec });
const fmtUsd = v => `${v > -0.005 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const roundP = p => { const k = 10 ** state.precision; return Math.round(p * k) / k; };
const signed = (v, f = fmt) => `${v >= 0 ? '+' : '−'}${f(Math.abs(v))}`;
function fmtVol(v) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return a >= 10 ? String(Math.round(v)) : String(+v.toFixed(2));
}
function niceQty(price) {
  const raw = 10000 / price;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return +(Math.round(raw / mag) * mag).toPrecision(6);
}
const qtyStep = q => 10 ** Math.floor(Math.log10(q || 1));
const pad = n => String(n).padStart(2, '0');
const WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
// 圖表時間已平移成本地時區，所以用 UTC 方法讀
function fmtTime(t) {
  const d = new Date(t * 1000);
  const day = `${WEEK[d.getUTCDay()]} ${d.getUTCDate()} ${d.getUTCMonth() + 1}月 '${String(d.getUTCFullYear()).slice(2)}`;
  return intervalSec(state.interval) >= 86400 ? day : `${day}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function tickMark(t, type) {
  const d = new Date(t * 1000);
  if (type === 0) return String(d.getUTCFullYear());
  if (type === 1) return `${d.getUTCMonth() + 1}月`;
  if (type === 2) return String(d.getUTCDate());
  if (type === 4) return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// ================= 圖表 =================
const wrap = $('#chartwrap');
const chart = createChart($('#chart'), {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: '#0f0f0f' },
    textColor: '#b8b8b8',
    fontSize: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
    panes: { separatorColor: '#2e2e2e', separatorHoverColor: 'rgba(41, 98, 255, 0.2)', enableResize: true },
  },
  grid: { vertLines: { color: '#1c1c1c' }, horzLines: { color: '#1c1c1c' } },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: '#9c9c9c', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: '#3d3d3d' },
    horzLine: { color: '#9c9c9c', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: '#3d3d3d' },
  },
  rightPriceScale: { borderVisible: false, minimumWidth: 66, entireTextOnly: true },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 40, barSpacing: 6, tickMarkFormatter: tickMark },
  localization: { locale: 'zh-TW', timeFormatter: fmtTime },
});

let mainSeries = null;
const volumeSeries = chart.addSeries(HistogramSeries, {
  priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
});
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

// 價格軸上的額外標籤：K 棒收盤倒數（接在最新價下方）＋ 成交量
class AxisExtras {
  constructor() { this.price = null; this.text = ''; this.color = UP; this.vol = null; }
  attached(p) { this.requestUpdate = p.requestUpdate; }
  detached() { this.requestUpdate = null; }
  updateAllViews() {}
  priceAxisViews() {
    const views = [];
    if (this.price != null) views.push({
      coordinate: () => (mainSeries.priceToCoordinate(this.price) ?? -100) + 15,
      text: () => this.text, textColor: () => '#ffffff', backColor: () => this.color, visible: () => true, tickVisible: () => false,
    });
    if (this.vol && state.volumeVisible && volumeSeries.options().visible) views.push({
      coordinate: () => volumeSeries.priceToCoordinate(this.vol.value) ?? -100,
      text: () => fmtVol(this.vol.value), textColor: () => '#ffffff', backColor: () => this.vol.color, visible: () => true, tickVisible: () => false,
    });
    return views;
  }
}
const axisExtras = new AxisExtras();

const CHART_TYPES = [
  { id: 'bars', name: '美國線', icon: '<path fill="none" stroke="currentColor" d="M9.5 6v16M7 9h2.5M9.5 18H12M18.5 8v14M16 11h2.5M18.5 19H21"/>' },
  { id: 'candles', name: 'K線', icon: '<path fill="currentColor" d="M17 11v6h3v-6h-3zm-.5-1h4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5z"/><path fill="currentColor" d="M18 7h1v3.5h-1zm0 10.5h1V21h-1z"/><path fill="currentColor" d="M9 8v12h3V8H9zm-.5-1h4a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z"/><path fill="currentColor" d="M10 4h1v3.5h-1zm0 16.5h1V24h-1z"/>' },
  { id: 'hollow', name: '空心K線', icon: '<path fill="none" stroke="currentColor" d="M16.5 10.5h4v7h-4zM9 7.5h3v13H9zM18.5 7v3.5M18.5 17.5V21M10.5 4v3.5M10.5 20.5V24"/>' },
  { id: 'ha', name: '平均K線', icon: '<path fill="currentColor" d="M9 8h3v12H9zM10 4h1v4h-1zm0 16h1v4h-1zM16.5 10.5h4v7h-4zM18 7h1v3.5h-1zm0 10.5h1V21h-1z"/>' },
  { id: 'line', name: '線條', icon: '<path fill="none" stroke="currentColor" d="M5 20l6-7 5 4 7-10"/>' },
  { id: 'area', name: '面積', icon: '<path fill="currentColor" opacity=".35" d="M5 21l6-7 5 4 7-10v13z"/><path fill="none" stroke="currentColor" d="M5 21l6-7 5 4 7-10"/>' },
];

function heikinAshi(bars) {
  const out = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i ? (out[i - 1].open + out[i - 1].close) / 2 : (b.open + b.close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  });
  return out;
}
function seriesData() {
  const t = state.chartType;
  if (t === 'line' || t === 'area') return state.bars.map(b => ({ time: b.time, value: b.close }));
  if (t === 'ha') return heikinAshi(state.bars);
  return state.bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
}
function lastSeriesPoint() {
  const bars = state.bars, n = bars.length - 1, b = bars[n];
  const t = state.chartType;
  if (t === 'line' || t === 'area') return { time: b.time, value: b.close };
  if (t === 'ha') return heikinAshi(bars.slice(Math.max(0, n - 300)))[Math.min(n, 300)];
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
}
const volPoint = b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? VOL_UP : VOL_DOWN });
const priceFormat = () => ({ type: 'custom', formatter: p => fmt(p), minMove: 10 ** -state.precision });

function createMainSeries() {
  const t = state.chartType;
  const common = { priceFormat: priceFormat(), lastValueVisible: true, priceLineVisible: true, priceLineStyle: LineStyle.Dotted, priceLineWidth: 1 };
  let s;
  if (t === 'candles' || t === 'ha') s = chart.addSeries(CandlestickSeries, { ...common, upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN }, 0);
  else if (t === 'hollow') s = chart.addSeries(CandlestickSeries, { ...common, upColor: 'rgba(0,0,0,0)', downColor: DOWN, borderVisible: true, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN }, 0);
  else if (t === 'bars') s = chart.addSeries(BarSeries, { ...common, upColor: UP, downColor: DOWN, thinBars: false }, 0);
  else if (t === 'line') s = chart.addSeries(LineSeries, { ...common, color: BLUE, lineWidth: 2 }, 0);
  else s = chart.addSeries(AreaSeries, { ...common, lineColor: BLUE, lineWidth: 2, topColor: 'rgba(41, 98, 255, 0.28)', bottomColor: 'rgba(41, 98, 255, 0.02)' }, 0);
  s.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.08 } });
  s.attachPrimitive(axisExtras);
  return s;
}

function setChartType(type) {
  state.chartType = type;
  const old = mainSeries;
  old.detachPrimitive(axisExtras);
  mainSeries = createMainSeries();
  mainSeries.setData(seriesData());
  drawings.setSeries(mainSeries);
  tradeLines.setSeries(mainSeries);
  chart.removeSeries(old);
  renderChartTypeBtn();
  savePrefs();
}

mainSeries = createMainSeries();

// 背景浮水印：目前的幣種（跟著商品/週期切換）
const watermark = createTextWatermark(chart.panes()[0], { horzAlign: 'center', vertAlign: 'center', lines: [] });
function updateWatermark() {
  const text = displaySymbol(state.symbol || 'BTCUSDT');
  const w = chart.timeScale().width() || 800;
  const big = Math.round(Math.max(40, Math.min(110, (w * 0.45) / (text.length * 0.62))));
  const iv = INTERVALS.find(i => i.id === state.interval);
  watermark.applyOptions({
    visible: state.watermark,
    lines: [
      { text, color: 'rgba(219, 219, 219, 0.09)', fontSize: big, fontStyle: 'bold', lineHeight: Math.round(big * 1.1) },
      { text: `${symbolMeta(state.symbol || 'BTCUSDT').desc} · ${iv?.legend ?? ''}`, color: 'rgba(219, 219, 219, 0.09)', fontSize: Math.round(big * 0.2) },
    ],
  });
}

// ================= 模組 =================
const feed = new Datafeed();
// 平常用的模擬帳戶（存在瀏覽器）＋ 重播模式用的臨時帳戶（不存檔，進入重播時重置）
const realBroker = new Broker();
const replayBroker = new Broker({ storeKey: null });
let broker = realBroker;
for (const b of [realBroker, replayBroker]) b.formatPrice = (sym, p) => fmt(p, sym === state.symbol ? state.precision : symbolMeta(sym).precision);
const indicators = new IndicatorManager(chart, () => state.bars, () => state.precision, () => { renderLegend(); renderTree(); savePrefs(); });
const drawings = new Drawings({
  chart, series: mainSeries, wrap,
  getBars: () => state.bars, getStep: () => intervalSec(state.interval), getPrecision: () => state.precision,
  fmt: p => fmt(p), fmtTime, fmtVol,
  onToolDone: () => toolbar.cursorReset(),
  onChange: () => { renderTree(); toolbar?.render(); checkPositionHits(false); },
  onSelect: d => { renderFloatTb(d); renderTree(); },
});
const tradeLines = new TradeLines({ chart, series: mainSeries, wrap, overlay: $('#tradeOverlay'), round: roundP });

function setCursorMode(m) {
  state.cursorMode = m;
  chart.applyOptions({ crosshair: { vertLine: { visible: m === 'cross' }, horzLine: { visible: m === 'cross' } } });
  wrap.classList.toggle('cursor-dot', m === 'dot');
  wrap.classList.toggle('cursor-arrow', m === 'arrow');
}
const toolbar = buildLeftToolbar({
  root: $('#lefttools'), flyout: $('#flyout'), drawings, saved: toolbarState,
  onCursorMode: setCursorMode,
  onHide: mode => {
    drawings.hidden = mode === 'drawings' || mode === 'all';
    drawings.update();
    setIndicatorsHidden(mode === 'indicators' || mode === 'all');
  },
  onRemove: what => {
    if (what !== 'indicators') drawings.clear();
    if (what !== 'drawings') { [...indicators.list].forEach(i => indicators.remove(i.id)); }
    toast('已移除', { drawings: '所有繪圖', indicators: '所有指標', all: '所有繪圖和指標' }[what], 'info');
  },
  onSaveState: s => { toolbarState = s; savePrefs(); },
});
function setIndicatorsHidden(h) {
  state.indicatorsHidden = h;
  indicators.list.forEach(i => Object.values(i.series).forEach(s => s.applyOptions({ visible: !h && i.visible })));
  volumeSeries.applyOptions({ visible: !h && state.volumeVisible });
  renderLegend();
}

// ================= 載入商品 / 週期 =================
let unsubKline = null, unsubBook = null, loadToken = 0, olderLoading = false, noMoreOlder = false;

async function load(symbol, interval, { keepView = false } = {}) {
  if (replay.active || replay.picking) { replay.reset(); leaveReplayBroker(); }
  const token = ++loadToken;
  const symbolChanged = symbol !== state.symbol || !state.bars.length;
  unsubKline?.(); unsubBook?.();
  state.symbol = symbol;
  state.interval = interval;
  if (symbolChanged) {
    state.book = { bid: null, ask: null };
    ticket.price = ticket.tp = ticket.sl = null;
  }
  renderHeader();

  const info = await feed.getSymbolInfo(symbol);
  const bars = await feed.getBars(symbol, interval);
  if (token !== loadToken) return;
  if (!bars.length) { toast('無法載入資料', `${displaySymbol(symbol)} 沒有可用的K線資料`, 'err'); return; }

  state.bars = bars;
  state.precision = info.precision;
  noMoreOlder = false;
  mainSeries.applyOptions({ priceFormat: priceFormat() });
  mainSeries.setData(seriesData());
  volumeSeries.setData(bars.map(volPoint));
  indicators.list.forEach(ind => Object.values(ind.series).forEach(s => {
    if (!ind.def.precision) s.applyOptions({ priceFormat: { type: 'price', precision: info.precision, minMove: info.minMove } });
  }));
  indicators.recalcAll();
  if (!keepView) chart.timeScale().resetTimeScale();
  if (symbolChanged) {
    drawings.setSymbol(symbol);
    state.qty = niceQty(bars[bars.length - 1].close);
    $('#qtQty').value = state.qty;
  }
  broker.onPrice(symbol, bars[bars.length - 1].close);
  $('#lgStatus').classList.toggle('sim', !feed.live);
  $('#lgStatus').title = feed.live ? `即時資料（${EXCHANGE} USDⓈ-M 永續合約）` : '模擬行情（無法連線至 Binance）';

  unsubKline = feed.subscribeKline(symbol, interval, onBar);
  unsubBook = feed.subscribeBook(symbol, b => { if (replay.active) return; state.book = b; scheduleQuote(); });
  renderLegend();
  renderHeader();
  renderTicket();
  syncTradeLines();
  renderBottom();
  renderWatchlist();
  renderTree();
  updateTitle();
  savePrefs();
}

function onBar(bar) {
  if (replay.active) return;
  const bars = state.bars;
  const last = bars[bars.length - 1];
  if (!last || bar.time < last.time) return;
  const isNew = bar.time > last.time;
  if (isNew) bars.push(bar); else bars[bars.length - 1] = bar;
  mainSeries.update(lastSeriesPoint());
  volumeSeries.update(volPoint(bar));
  if (isNew) indicators.recalcAll(); else indicators.updateLast();
  broker.onPrice(state.symbol, bar.close);
  if (!feed.live || !state.book.bid) state.book = { bid: bar.close, ask: bar.close };
  if (state.hoverIndex == null) renderLegendValues();
  drawings.update();
  scheduleQuote();
  checkPositionHits(true);
}

chart.timeScale().subscribeVisibleLogicalRangeChange(async range => {
  if (!range || replay.active || replay.picking || range.from > 30 || olderLoading || noMoreOlder || !feed.live || !state.bars.length) return;
  olderLoading = true;
  const token = loadToken;
  const older = await feed.getBars(state.symbol, state.interval, { limit: 1000, endTime: state.bars[0].time });
  olderLoading = false;
  if (token !== loadToken) return;
  const fresh = older.filter(b => b.time < state.bars[0].time);
  if (!fresh.length) { noMoreOlder = true; return; }
  state.bars = fresh.concat(state.bars);
  mainSeries.setData(seriesData());
  volumeSeries.setData(state.bars.map(volPoint));
  indicators.recalcAll();
  drawings.update();
});

// ================= 圖例 =================
function renderHeader() {
  const meta = symbolMeta(state.symbol);
  const iv = INTERVALS.find(i => i.id === state.interval);
  $('#symbolText').textContent = displaySymbol(state.symbol);
  $('#lgName').textContent = meta.desc;
  $('#lgInterval').textContent = iv.legend;
  $('#lgExch').textContent = EXCHANGE;
  $('#lgLogo').textContent = meta.icon;
  $('#lgLogo').style.background = meta.color;
  renderIntervals();
  updateWatermark();
}

function updateTitle() {
  const t = state.tickers[state.symbol];
  const last = state.bars[state.bars.length - 1]?.close;
  if (last == null) return;
  const open = t?.open ?? state.bars[0].open;
  const pct = ((last - open) / open) * 100;
  document.title = `${displaySymbol(state.symbol)} ${fmt(last)} ${pct >= 0 ? '▲' : '▼'} ${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}% 未命名`;
}

const EYE_OFF = '<svg class="lg-eye-off" viewBox="0 0 18 18" width="18" height="18"><path fill="none" stroke="currentColor" d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5ZM3 15L15 3"/></svg>';
function indRow(id, name, hidden, pane = false) {
  return `<div class="lg-ind ${hidden ? 'hidden-ind' : ''}" data-id="${id}" ${pane ? `data-pane="${id}"` : ''}>
    <span class="lg-ind-name">${name}</span><span class="lg-ind-vals" ${id === 'vol' ? 'id="lgVol"' : `data-vals="${id}"`}></span>${EYE_OFF}
    <span class="lg-ind-acts">
      <button data-act="toggle" data-id="${id}" title="${hidden ? '顯示' : '隱藏'}"><svg viewBox="0 0 18 18" width="18" height="18"><path fill="none" stroke="currentColor" d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="9" cy="9" r="2" fill="none" stroke="currentColor"/></svg></button>
      <button data-act="settings" data-id="${id}" title="設定" class="soon-ind"><svg viewBox="0 0 18 18" width="18" height="18"><path fill="none" stroke="currentColor" d="M6.3 3.5h5.4L14.5 9l-2.8 5.5H6.3L3.5 9z"/><circle cx="9" cy="9" r="2" fill="none" stroke="currentColor"/></svg></button>
      <button data-act="remove" data-id="${id}" title="移除"><svg viewBox="0 0 18 18" width="18" height="18"><path fill="none" stroke="currentColor" d="M5 5l8 8M13 5l-8 8"/></svg></button>
    </span></div>`;
}

function renderLegend() {
  const rows = [];
  const H = state.indicatorsHidden;
  if (state.volumeVisible) rows.push(indRow('vol', `成交量 · ${symbolMeta(state.symbol).base}`, H || !volumeSeries.options().visible));
  for (const ind of indicators.list.filter(i => i.def.overlay)) rows.push(indRow(ind.id, ind.def.title(ind.params), H || !ind.visible));
  $('#lgIndicators').innerHTML = rows.join('');
  $('#lgCollapse').hidden = !rows.length;
  $('#paneLegends').innerHTML = indicators.list.filter(i => !i.def.overlay).map(ind => indRow(ind.id, ind.def.title(ind.params), H || !ind.visible, true)).join('');
  requestAnimationFrame(positionPaneLegends);
  renderLegendValues();
}

function positionPaneLegends() {
  const wrapTop = wrap.getBoundingClientRect().top;
  for (const el of $$('#paneLegends .lg-ind')) {
    const ind = indicators.list.find(i => i.id === +el.dataset.pane);
    const paneEl = ind?.series[ind.def.lines[0].key].getPane().getHTMLElement();
    if (paneEl) el.style.top = `${paneEl.getBoundingClientRect().top - wrapTop + 4}px`;
  }
}
new ResizeObserver(() => { positionPaneLegends(); positionScaleWidgets(); updateWatermark(); }).observe(wrap);

function renderLegendValues() {
  const bars = state.bars;
  if (!bars.length) return;
  const i = Math.max(0, Math.min(state.hoverIndex ?? bars.length - 1, bars.length - 1));
  const b = bars[i];
  const prev = bars[Math.max(0, i - 1)];
  const chg = b.close - prev.close;
  const c = b.close >= b.open ? 'up' : 'down';
  const v = (k, val) => `<span>${k}<b class="${c}" style="font-weight:400">=${fmt(val)}</b></span>`;
  $('#lgOhlc').innerHTML = v('開', b.open) + v('高', b.high) + v('低', b.low) + v('收', b.close) +
    `<span class="${chg >= 0 ? 'up' : 'down'}">${signed(chg)} (${chg >= 0 ? '+' : '−'}${Math.abs((chg / prev.close) * 100).toFixed(2)}%)</span>`;
  const vol = $('#lgVol');
  if (vol) vol.innerHTML = `<span class="${c}">${fmtVol(b.volume)}</span>`;
  axisExtras.vol = { value: bars[bars.length - 1].volume, color: bars[bars.length - 1].close >= bars[bars.length - 1].open ? UP : DOWN };
  for (const ind of indicators.list) {
    const el = document.querySelector(`[data-vals="${ind.id}"]`);
    if (!el) continue;
    const prec = ind.def.precision ?? state.precision;
    el.innerHTML = indicators.valuesAt(ind, i).map(x => `<span style="color:${x.color}">${x.v == null ? '∅' : fmt(x.v, prec)}</span>`).join(' ');
  }
}

chart.subscribeCrosshairMove(param => {
  state.hoverIndex = param.logical == null || !state.bars.length || param.logical < 0 || param.logical >= state.bars.length ? null : Math.round(param.logical);
  renderLegendValues();
  positionPaneLegends();
});

wrap.addEventListener('click', e => {
  const btn = e.target.closest('.lg-ind-acts button');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  if (act === 'settings') { toast('示範版', '指標設定尚未實作', 'info'); return; }
  if (id === 'vol') {
    if (act === 'remove') { state.volumeVisible = false; volumeSeries.applyOptions({ visible: false }); }
    else volumeSeries.applyOptions({ visible: !volumeSeries.options().visible });
    renderLegend(); renderTree(); savePrefs();
    return;
  }
  if (act === 'remove') indicators.remove(+id); else indicators.toggle(+id);
});
$('#lgCollapse').onclick = () => {
  const c = $('#lgIndicators').classList.toggle('collapsed');
  $('#lgCollapse').classList.toggle('collapsed', c);
};

// ================= 報價更新 =================
let quoteQueued = false;
function scheduleQuote() {
  if (quoteQueued) return;
  quoteQueued = true;
  requestAnimationFrame(() => {
    quoteQueued = false;
    const { bid, ask } = bidAsk();
    $('#qtSellPrice').textContent = fmt(bid);
    $('#qtBuyPrice').textContent = fmt(ask);
    updateTicketDynamic();
    syncTradeLines();
    updateTitle();
  });
}
const bidAsk = () => {
  const last = state.bars[state.bars.length - 1]?.close;
  return { bid: state.book.bid ?? last, ask: state.book.ask ?? last };
};

// ================= 下單 =================
function marketOrder(side) {
  broker.placeOrder({ symbol: state.symbol, side, type: 'market', qty: parseFloat($('#qtQty').value) });
}
$('#qtBuy').addEventListener('click', () => marketOrder('buy'));
$('#qtSell').addEventListener('click', () => marketOrder('sell'));
$('#qtQty').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  if (v > 0) state.qty = v;
  e.target.value = state.qty;
  renderTicket();
});
$('#qtQty').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });

function ticketRef() {
  const { bid, ask } = bidAsk();
  return ticket.type === 'market' ? (ticket.side === 'buy' ? ask : bid) : ticket.price;
}
function defaultBracket() {
  const ref = ticketRef();
  const dir = ticket.side === 'buy' ? 1 : -1;
  if (ticket.tpOn && ticket.tp == null) ticket.tp = roundP(ref * (1 + dir * 0.01));
  if (ticket.slOn && ticket.sl == null) ticket.sl = roundP(ref * (1 - dir * 0.005));
}
const orderPanelOpen = () => state.rightView === 'viewOrder';

function renderTicket() {
  const el = $('#viewOrder');
  if (!orderPanelOpen()) return;
  const meta = symbolMeta(state.symbol);
  if (ticket.type !== 'market' && ticket.price == null) ticket.price = roundP(ticketRef() ?? bidAsk().bid);
  defaultBracket();
  el.innerHTML = `
  <div class="op">
    <div class="op-head">
      <span class="lg-logo" style="background:${meta.color};width:24px;height:24px;font-size:13px">${meta.icon}</span>
      <div><div class="op-sym">${displaySymbol(state.symbol)}</div><div class="op-broker">模擬交易 · ${meta.desc}</div></div>
      <div class="tb-spacer"></div>
      <button class="rp-ico" id="opClose" title="關閉">×</button>
    </div>
    <div class="op-side">
      <button class="op-sell ${ticket.side === 'sell' ? 'sel' : ''}" data-side="sell"><span>賣出</span><b id="opBid">—</b></button>
      <span class="op-spread" id="opSpread"></span>
      <button class="op-buy ${ticket.side === 'buy' ? 'sel' : ''}" data-side="buy"><span>買入</span><b id="opAsk">—</b></button>
    </div>
    <div class="op-types">${['market', 'limit', 'stop'].map(t => `<button data-type="${t}" class="${ticket.type === t ? 'active' : ''}">${typeText(t)}</button>`).join('')}</div>
    <div class="op-field" ${ticket.type === 'market' ? 'hidden' : ''}>
      <div class="op-label"><span>${ticket.type === 'limit' ? '限價' : '停損價'}</span><span>USDT</span></div>
      <div class="op-input"><input id="opPrice" value="${ticket.price ?? ''}"><button class="op-step" data-step="price:-1">−</button><button class="op-step" data-step="price:1">+</button></div>
    </div>
    <div class="op-field">
      <div class="op-label"><span>數量</span><span>${meta.base}</span></div>
      <div class="op-input"><input id="opQty" value="${state.qty}"><button class="op-step" data-step="qty:-1">−</button><button class="op-step" data-step="qty:1">+</button></div>
    </div>
    <div class="op-bracket">
      <label class="op-check"><input type="checkbox" id="opTpOn" ${ticket.tpOn ? 'checked' : ''}>止盈<span class="op-est up" id="opTpEst"></span></label>
      <div class="op-input" ${ticket.tpOn ? '' : 'hidden'}><input id="opTp" value="${ticket.tp ?? ''}"><span class="op-unit">USDT</span></div>
      <label class="op-check"><input type="checkbox" id="opSlOn" ${ticket.slOn ? 'checked' : ''}>止損<span class="op-est down" id="opSlEst"></span></label>
      <div class="op-input" ${ticket.slOn ? '' : 'hidden'}><input id="opSl" value="${ticket.sl ?? ''}"><span class="op-unit">USDT</span></div>
    </div>
    <div class="op-info">
      <div><span>交易價值</span><b id="opValue">—</b></div>
      <div><span>風險報酬比</span><b id="opRR">—</b></div>
      <div><span>可用資金</span><b id="opAvail">—</b></div>
    </div>
    <button class="op-submit ${ticket.side}" id="opSubmit"></button>
  </div>`;

  $('#opClose').onclick = () => showView(null);
  el.querySelectorAll('.op-side button').forEach(b => b.onclick = () => { ticket.side = b.dataset.side; ticket.tp = ticket.sl = null; renderTicket(); syncTradeLines(); });
  el.querySelectorAll('.op-types button').forEach(b => b.onclick = () => { ticket.type = b.dataset.type; ticket.price = null; ticket.tp = ticket.sl = null; renderTicket(); syncTradeLines(); });
  const num = (id, fn) => $(id)?.addEventListener('change', e => { const v = parseFloat(e.target.value.replace(/,/g, '')); fn(isNaN(v) ? null : v); renderTicket(); syncTradeLines(); });
  num('#opPrice', v => (ticket.price = v));
  num('#opQty', v => { if (v > 0) { state.qty = v; $('#qtQty').value = v; } });
  num('#opTp', v => (ticket.tp = v));
  num('#opSl', v => (ticket.sl = v));
  $('#opTpOn').onchange = e => { ticket.tpOn = e.target.checked; ticket.tp = null; renderTicket(); syncTradeLines(); };
  $('#opSlOn').onchange = e => { ticket.slOn = e.target.checked; ticket.sl = null; renderTicket(); syncTradeLines(); };
  el.querySelectorAll('.op-step').forEach(b => b.onclick = () => {
    const [field, dir] = b.dataset.step.split(':');
    if (field === 'price') ticket.price = roundP((ticket.price ?? ticketRef()) + +dir * 10 ** -state.precision * 10);
    else { state.qty = Math.max(qtyStep(state.qty), +(state.qty + +dir * qtyStep(state.qty)).toPrecision(8)); $('#qtQty').value = state.qty; }
    renderTicket(); syncTradeLines();
  });
  $('#opSubmit').onclick = () => {
    const o = broker.placeOrder({
      symbol: state.symbol, side: ticket.side, type: ticket.type, qty: state.qty, price: ticket.price,
      tp: ticket.tpOn ? ticket.tp : null, sl: ticket.slOn ? ticket.sl : null,
    });
    if (o) { ticket.price = null; ticket.tp = ticket.sl = null; renderTicket(); syncTradeLines(); }
  };
  updateTicketDynamic();
}

function updateTicketDynamic() {
  if (!orderPanelOpen() || !$('#opSubmit')) return;
  const { bid, ask } = bidAsk();
  $('#opBid').textContent = fmt(bid);
  $('#opAsk').textContent = fmt(ask);
  $('#opSpread').textContent = bid != null ? fmt(ask - bid) : '';
  const ref = ticketRef();
  const dir = ticket.side === 'buy' ? 1 : -1;
  const q = state.qty;
  const tpPnl = ticket.tpOn && ticket.tp != null ? (ticket.tp - ref) * q * dir : null;
  const slPnl = ticket.slOn && ticket.sl != null ? (ticket.sl - ref) * q * dir : null;
  $('#opTpEst').textContent = tpPnl != null ? `${fmtUsd(tpPnl)} USD` : '';
  $('#opSlEst').textContent = slPnl != null ? `${fmtUsd(slPnl)} USD` : '';
  $('#opValue').textContent = ref ? `${money(ref * q)} USD` : '—';
  $('#opRR').textContent = tpPnl != null && slPnl ? Math.abs(tpPnl / slPnl).toFixed(2) : '—';
  $('#opAvail').textContent = `${money(broker.summary().available)} USD`;
  const priceTxt = ticket.type === 'market' ? '市價' : `@ ${fmt(ticket.price)} ${typeText(ticket.type)}`;
  $('#opSubmit').innerHTML = `${sideText(ticket.side)} ${q} ${displaySymbol(state.symbol)}<small>${priceTxt}</small>`;
}

// ================= 圖表上的交易線 =================
function syncTradeLines() {
  const sym = state.symbol;
  const descs = [];
  const pos = broker.positions[sym];
  const last = broker.price(sym);
  const pnlText = (label, pnl) => ({ text: `${label} ${fmtUsd(pnl)} USD`, cls: pnl >= 0 ? 'pos' : 'neg' });

  if (pos) {
    const dir = pos.side === 'buy' ? 1 : -1;
    const est = (p, kind) => pnlText(kind, (p - pos.avg) * pos.qty * dir);
    const upnl = broker.unrealized(sym);
    descs.push({
      key: 'pos', price: pos.avg, color: dir > 0 ? BLUE : RED,
      text: () => ({ text: `${fmtUsd(upnl)} USD`, cls: upnl >= 0 ? 'pos' : 'neg' }),
      qty: `${dir > 0 ? '' : '−'}${pos.qty}`, onClose: () => broker.closePosition(sym), closeTitle: '平倉',
      addTP: pos.tp == null ? { text: p => est(p, '止盈'), onCommit: p => broker.modifyPosition(sym, { tp: p }) } : null,
      addSL: pos.sl == null ? { text: p => est(p, '止損'), onCommit: p => broker.modifyPosition(sym, { sl: p }) } : null,
    });
    if (pos.tp != null) descs.push({ key: 'pos-tp', price: pos.tp, color: GREEN, text: p => est(p, '止盈'), qty: pos.qty,
      onClose: () => broker.modifyPosition(sym, { tp: null }), closeTitle: '移除止盈', onCommit: p => broker.modifyPosition(sym, { tp: p }) });
    if (pos.sl != null) descs.push({ key: 'pos-sl', price: pos.sl, color: RED, text: p => est(p, '止損'), qty: pos.qty,
      onClose: () => broker.modifyPosition(sym, { sl: null }), closeTitle: '移除止損', onCommit: p => broker.modifyPosition(sym, { sl: p }) });
  }

  for (const o of broker.orders.filter(x => x.symbol === sym)) {
    const dir = o.side === 'buy' ? 1 : -1;
    const est = (p, kind) => pnlText(kind, (p - o.price) * o.qty * dir);
    descs.push({
      key: `ord-${o.id}`, price: o.price, color: dir > 0 ? BLUE : RED, dashed: true,
      text: () => ({ text: `${sideText(o.side)} ${typeText(o.type)}` }), qty: o.qty,
      onClose: () => broker.cancelOrder(o.id), closeTitle: '取消訂單', onCommit: p => broker.modifyOrder(o.id, { price: p }),
      addTP: o.tp == null ? { text: p => est(p, '止盈'), onCommit: p => broker.modifyOrder(o.id, { tp: p }) } : null,
      addSL: o.sl == null ? { text: p => est(p, '止損'), onCommit: p => broker.modifyOrder(o.id, { sl: p }) } : null,
    });
    if (o.tp != null) descs.push({ key: `ord-${o.id}-tp`, price: o.tp, color: GREEN, dashed: true, text: p => est(p, '止盈'), qty: o.qty,
      onClose: () => broker.modifyOrder(o.id, { tp: null }), onCommit: p => broker.modifyOrder(o.id, { tp: p }) });
    if (o.sl != null) descs.push({ key: `ord-${o.id}-sl`, price: o.sl, color: RED, dashed: true, text: p => est(p, '止損'), qty: o.qty,
      onClose: () => broker.modifyOrder(o.id, { sl: null }), onCommit: p => broker.modifyOrder(o.id, { sl: p }) });
  }

  if (orderPanelOpen() && last != null) {
    const dir = ticket.side === 'buy' ? 1 : -1;
    const est = (p, kind) => pnlText(kind, (p - ticketRef()) * state.qty * dir);
    const setInput = (id, v) => { const i = $(id); if (i) i.value = v; };
    if (ticket.type !== 'market' && ticket.price != null) descs.push({
      key: 'pv-entry', price: ticket.price, color: dir > 0 ? BLUE : RED, preview: true,
      text: () => ({ text: `${sideText(ticket.side)} ${typeText(ticket.type)}` }), qty: state.qty,
      onDrag: p => { ticket.price = p; setInput('#opPrice', p); updateTicketDynamic(); },
      onCommit: p => { ticket.price = p; renderTicket(); syncTradeLines(); },
    });
    if (ticket.tpOn && ticket.tp != null) descs.push({
      key: 'pv-tp', price: ticket.tp, color: GREEN, preview: true, text: p => est(p, '止盈'), qty: state.qty,
      onDrag: p => { ticket.tp = p; setInput('#opTp', p); updateTicketDynamic(); },
      onCommit: p => { ticket.tp = p; renderTicket(); syncTradeLines(); },
    });
    if (ticket.slOn && ticket.sl != null) descs.push({
      key: 'pv-sl', price: ticket.sl, color: RED, preview: true, text: p => est(p, '止損'), qty: state.qty,
      onDrag: p => { ticket.sl = p; setInput('#opSl', p); updateTicketDynamic(); },
      onCommit: p => { ticket.sl = p; renderTicket(); syncTradeLines(); },
    });
  }
  tradeLines.set(descs);
}

for (const b of [realBroker, replayBroker]) {
  b.addEventListener('change', () => { if (b !== broker) return; syncTradeLines(); scheduleBottom(); updateTicketDynamic(); });
  b.addEventListener('notify', e => { if (b === broker) toast(e.detail.title, e.detail.text, e.detail.kind); });
}

// ================= 繪圖浮動工具列 =================
const ftb = $('#floatTb');
let ftbPos = null, ftbPop = null;
function renderFloatTb(d) {
  if (!d) { ftb.hidden = true; ftbPop = null; return; }
  const hasColor = d.color != null;
  const hasWidth = d.width != null && d.type !== 'highlighter';
  const lineStyle = ['trend', 'ray', 'extended', 'arrow', 'hline', 'hray', 'vline', 'crossline', 'channel', 'rect', 'circle'].includes(d.type);
  const swatch = c => `<span class="ft-swatch" style="background:${c}"></span>`;
  const styleIcon = s => `<svg viewBox="0 0 28 28" width="28" height="28"><path stroke="currentColor" stroke-width="2" ${s === 'dashed' ? 'stroke-dasharray="5 3"' : s === 'dotted' ? 'stroke-dasharray="1.5 3" stroke-linecap="round"' : ''} d="M5 14h18"/></svg>`;
  ftb.innerHTML = `
    <span class="ft-grip" title="拖曳"><svg viewBox="0 0 8 18" width="8" height="18"><g fill="currentColor"><circle cx="2" cy="4" r="1"/><circle cx="6" cy="4" r="1"/><circle cx="2" cy="9" r="1"/><circle cx="6" cy="9" r="1"/><circle cx="2" cy="14" r="1"/><circle cx="6" cy="14" r="1"/></g></svg></span>
    ${hasColor ? `<button class="ft-btn ${ftbPop === 'color' ? 'open' : ''}" data-pop="color" title="顏色">${swatch(d.color)}</button>` : ''}
    ${d.type === 'text' ? `<button class="ft-btn ${ftbPop === 'size' ? 'open' : ''}" data-pop="size" title="字體大小">${d.size}</button>` : ''}
    ${d.type === 'long' || d.type === 'short' ? `<button class="ft-btn ${ftbPop === 'lsize' ? 'open' : ''}" data-pop="lsize" title="標籤字體大小"><svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M8 8.5h9v2h-1v-1h-2.5v9H15v1h-5v-1h1.5v-9H9v1H8zM17.5 13.5h5v1h-2v5h1v1h-3v-1h1v-5h-2z"/></svg><span>${d.labelSize ?? 11}</span></button>` : ''}
    ${hasWidth ? `<button class="ft-btn ${ftbPop === 'width' ? 'open' : ''}" data-pop="width" title="線寬"><svg viewBox="0 0 28 28" width="28" height="28"><path stroke="currentColor" stroke-width="${d.width}" d="M6 14h16"/></svg><span>${d.width}px</span></button>` : ''}
    ${lineStyle ? `<button class="ft-btn ${ftbPop === 'style' ? 'open' : ''}" data-pop="style" title="線條樣式">${styleIcon(d.style)}</button>` : ''}
    ${d.type === 'long' || d.type === 'short' ? `<button class="ft-btn ${d.hideStats ? '' : 'on'}" data-act="stats" title="${d.hideStats ? '一直顯示數據標籤' : '只在選取時顯示數據標籤'}"><svg viewBox="0 0 28 28" width="28" height="28"><path fill="none" stroke="currentColor" d="M6.5 8.5h15v8h-6l-3 3v-3h-6zM10 12.5h8"/></svg><span>數據</span></button>` : ''}
    <div class="ft-sep"></div>
    <button class="ft-btn soon-ft" data-act="settings" title="設定"><svg viewBox="0 0 28 28" width="28" height="28"><path fill="none" stroke="currentColor" d="M10.3 6.5h7.4L21.5 14l-3.8 7.5h-7.4L6.5 14z"/><circle cx="14" cy="14" r="2.8" fill="none" stroke="currentColor"/></svg></button>
    <button class="ft-btn ${d.locked ? 'on' : ''}" data-act="lock" title="${d.locked ? '解鎖' : '鎖定'}"><svg viewBox="0 0 28 28" width="28" height="28">${d.locked ? ICONS.lockon : ICONS.lock}</svg></button>
    <button class="ft-btn" data-act="delete" title="移除"><svg viewBox="0 0 28 28" width="28" height="28">${ICONS.trash}</svg></button>
    ${ftbPop ? popHtml(d) : ''}`;
  ftb.hidden = false;
  const w = ftb.offsetWidth;
  const pos = ftbPos ?? { x: Math.max(8, (chart.timeScale().width() - w) / 2), y: 10 };
  ftb.style.left = `${pos.x}px`;
  ftb.style.top = `${pos.y}px`;
  const pop = ftb.querySelector('.ft-pop');
  const anchor = ftb.querySelector(`[data-pop="${ftbPop}"]`);
  if (pop && anchor) pop.style.left = `${anchor.offsetLeft}px`;
}
function popHtml(d) {
  if (ftbPop === 'color') return `<div class="ft-pop"><div class="ft-colors">${PALETTE.map(c => `<button data-color="${c}" class="${c === d.color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>`;
  if (ftbPop === 'width') return `<div class="ft-pop ft-list">${[1, 2, 3, 4].map(w => `<button data-width="${w}" class="${w === d.width ? 'on' : ''}"><svg viewBox="0 0 40 10" width="40" height="10"><path stroke="currentColor" stroke-width="${w}" d="M2 5h36"/></svg>${w}px</button>`).join('')}</div>`;
  if (ftbPop === 'lsize') return `<div class="ft-pop ft-list">${[9, 10, 11, 12, 13, 14].map(s => `<button data-lsize="${s}" class="${s === (d.labelSize ?? 11) ? 'on' : ''}">${s}${s === 11 ? '（預設）' : ''}</button>`).join('')}</div>`;
  if (ftbPop === 'size') return `<div class="ft-pop ft-list">${[10, 12, 14, 16, 20, 24, 28, 40].map(s => `<button data-size="${s}" class="${s === d.size ? 'on' : ''}">${s}</button>`).join('')}</div>`;
  if (ftbPop === 'style') return `<div class="ft-pop ft-list">${[['solid', '實線'], ['dashed', '虛線'], ['dotted', '點線']].map(([s, n]) => `<button data-style="${s}" class="${(d.style || 'solid') === s ? 'on' : ''}"><svg viewBox="0 0 40 10" width="40" height="10"><path stroke="currentColor" stroke-width="2" ${s === 'dashed' ? 'stroke-dasharray="5 3"' : s === 'dotted' ? 'stroke-dasharray="1.5 3" stroke-linecap="round"' : ''} d="M2 5h36"/></svg>${n}</button>`).join('')}</div>`;
  return '';
}
ftb.addEventListener('pointerdown', e => {
  e.stopPropagation();
  const grip = e.target.closest('.ft-grip');
  if (!grip) return;
  const r = wrap.getBoundingClientRect(), x0 = e.clientX - ftb.offsetLeft, y0 = e.clientY - ftb.offsetTop;
  const move = ev => { ftbPos = { x: Math.max(0, Math.min(r.width - ftb.offsetWidth, ev.clientX - x0)), y: Math.max(0, Math.min(r.height - 40, ev.clientY - y0)) }; ftb.style.left = `${ftbPos.x}px`; ftb.style.top = `${ftbPos.y}px`; };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
});
ftb.addEventListener('click', e => {
  const d = drawings.selected;
  if (!d) return;
  const t = e.target.closest('[data-pop],[data-act],[data-color],[data-width],[data-style],[data-size],[data-lsize]');
  if (!t) return;
  if (t.dataset.pop) { ftbPop = ftbPop === t.dataset.pop ? null : t.dataset.pop; renderFloatTb(d); return; }
  if (t.dataset.act === 'delete') { drawings.deleteSelected(); return; }
  if (t.dataset.act === 'lock') { drawings.setStyle({ locked: !d.locked }); return; }
  if (t.dataset.act === 'stats') { drawings.setStyle({ hideStats: !d.hideStats }); return; }
  if (t.dataset.act === 'settings') { toast('示範版', '繪圖設定對話框尚未實作，可用左邊的顏色/線寬調整', 'info'); return; }
  ftbPop = null;
  if (t.dataset.color) drawings.setStyle({ color: t.dataset.color });
  if (t.dataset.width) drawings.setStyle({ width: +t.dataset.width });
  if (t.dataset.style) drawings.setStyle({ style: t.dataset.style });
  if (t.dataset.size) drawings.setStyle({ size: +t.dataset.size });
  if (t.dataset.lsize) drawings.setStyle({ labelSize: +t.dataset.lsize });
});

// ================= 右鍵選單 =================
const ctx = $('#ctxMenu');
// 在指定價位下單的選單（右鍵、價格軸旁的「＋」共用）
function openOrderMenu(x, y, price, { compact = false } = {}) {
  const r = wrap.getBoundingClientRect();
  const { bid, ask } = bidAsk();
  const q = parseFloat($('#qtQty').value) || state.qty;
  const items = [];
  const sym = displaySymbol(state.symbol);
  if (price != null && ask != null) {
    const buyType = price < ask ? 'limit' : 'stop';
    const sellType = price > bid ? 'limit' : 'stop';
    items.push(
      { html: `<span class="ctx-ic buy">▲</span><span>買入 ${q} ${sym} @ <span class="buy">${fmt(price)}</span> ${typeText(buyType)}</span>`, fn: () => broker.placeOrder({ symbol: state.symbol, side: 'buy', type: buyType, qty: q, price }) },
      { html: `<span class="ctx-ic sell">▼</span><span>賣出 ${q} ${sym} @ <span class="sell">${fmt(price)}</span> ${typeText(sellType)}</span>`, fn: () => broker.placeOrder({ symbol: state.symbol, side: 'sell', type: sellType, qty: q, price }) },
      { html: '<span class="ctx-ic">＋</span><span>建立新訂單…</span>', fn: () => { ticket.side = price < ask ? 'buy' : 'sell'; ticket.type = ticket.side === 'buy' ? buyType : sellType; ticket.price = price; ticket.tp = ticket.sl = null; showView('viewOrder'); } },
      { html: `<span class="ctx-ic">—</span><span>在 ${fmt(price)} 繪製水平線</span>`, fn: () => { drawings.list.push({ type: 'hline', color: BLUE, width: 1, p: [{ t: 0, price }] }); drawings._commit(); } },
    );
  }
  if (!compact) {
    if (items.length) items.push('sep');
    items.push(
      { html: '<span class="ctx-ic">⟲</span><span>重設圖表視圖</span>', fn: resetView },
      { html: `<span class="ctx-ic">🗑</span><span>移除 ${drawings.list.length} 個繪圖</span>`, fn: () => drawings.clear() },
    );
  }
  ctx.innerHTML = items.map((it, i) => it === 'sep' ? '<div class="ctx-sep"></div>' : `<button class="ctx-item" data-i="${i}">${it.html}</button>`).join('');
  ctx.querySelectorAll('.ctx-item').forEach(b => b.onclick = () => { ctx.classList.remove('open'); items[+b.dataset.i].fn(); });
  ctx.classList.add('open');
  ctx.style.left = `${Math.max(4, Math.min(x, r.width - ctx.offsetWidth - 4))}px`;
  ctx.style.top = `${Math.max(4, Math.min(y, r.height - ctx.offsetHeight - 4))}px`;
}
wrap.addEventListener('contextmenu', e => {
  e.preventDefault();
  const r = wrap.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const inPane = x <= chart.timeScale().width() && y <= chart.panes()[0].getHeight();
  openOrderMenu(x, y, inPane ? roundP(mainSeries.coordinateToPrice(y)) : null);
});

// 價格軸旁的「＋」：滑鼠指到哪個價位，就能在那裡掛單（仿 TradingView）
const plusBtn = document.createElement('button');
plusBtn.className = 'ps-plus';
plusBtn.title = '在這個價位下單';
plusBtn.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M9 4v10M4 9h10"/></svg>';
plusBtn.hidden = true;
wrap.appendChild(plusBtn);
let plusY = 0, plusPrice = null;
chart.subscribeCrosshairMove(param => {
  const p = param.point;
  const ok = p && p.y <= chart.panes()[0].getHeight() && drawings.tool === 'cursor' && !replay.picking && !drawings.drag && !drawings.creating;
  if (!ok) { if (!plusBtn.matches(':hover')) plusBtn.hidden = true; return; }
  plusY = p.y;
  plusPrice = roundP(mainSeries.coordinateToPrice(p.y));
  plusBtn.hidden = false;
  plusBtn.style.top = `${p.y - 10}px`;
  plusBtn.style.left = `${chart.timeScale().width() - 24}px`;
});
plusBtn.addEventListener('pointerdown', e => e.stopPropagation());
plusBtn.addEventListener('mouseleave', () => { plusBtn.hidden = true; });
plusBtn.addEventListener('click', e => {
  e.stopPropagation();
  openOrderMenu(chart.timeScale().width() - 4 - 300, plusY + 14, plusPrice, { compact: true });
});
function resetView() {
  chart.timeScale().resetTimeScale();
  mainSeries.priceScale().applyOptions({ autoScale: true });
}

// 點擊其他地方時關閉所有下拉選單
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.ctx-menu')) ctx.classList.remove('open');
  if (!e.target.closest('.tb-dropdown, .ps-menu, .ps-gear')) $$('.dd-menu.open').forEach(m => m.classList.remove('open'));
  if (ftbPop && !e.target.closest('.float-tb')) { ftbPop = null; renderFloatTb(drawings.selected); }
});

// ================= 價格座標設定 =================
const psMenu = $('#psMenu');
function positionScaleWidgets() {
  const w = chart.priceScale('right').width();
  if (!w) return;
  $('#psCur').style.width = `${w - 10}px`;
  $('#psCur').style.justifyContent = 'space-between';
  $('#psGear').style.right = `${Math.max(4, w / 2 - 12)}px`;
}
function renderPsMenu() {
  const o = mainSeries.priceScale().options();
  const item = (k, label, on) => `<button class="dd-item" data-ps="${k}">${label}${on ? '<span class="dd-check">✓</span>' : ''}</button>`;
  psMenu.innerHTML = item('auto', '自動（使價格符合圖表）', o.autoScale) +
    item('pct', '百分比座標', o.mode === PriceScaleMode.Percentage) +
    item('log', '對數座標', o.mode === PriceScaleMode.Logarithmic) +
    item('idx', '指數化至 100', o.mode === PriceScaleMode.IndexedTo100) +
    '<div class="ctx-sep"></div>' + item('wm', '顯示幣種浮水印', state.watermark) +
    '<div class="ctx-sep"></div>' + item('reset', '重設價格座標', false);
}
$('#psGear').onclick = e => { e.stopPropagation(); renderPsMenu(); psMenu.classList.toggle('open'); };
psMenu.addEventListener('click', e => {
  const k = e.target.closest('[data-ps]')?.dataset.ps;
  if (!k) return;
  const ps = mainSeries.priceScale(), o = ps.options();
  const toggle = mode => ps.applyOptions({ mode: o.mode === mode ? PriceScaleMode.Normal : mode });
  if (k === 'auto') ps.applyOptions({ autoScale: !o.autoScale });
  if (k === 'pct') toggle(PriceScaleMode.Percentage);
  if (k === 'log') toggle(PriceScaleMode.Logarithmic);
  if (k === 'idx') toggle(PriceScaleMode.IndexedTo100);
  if (k === 'reset') ps.applyOptions({ autoScale: true, mode: PriceScaleMode.Normal });
  if (k === 'wm') { state.watermark = !state.watermark; updateWatermark(); savePrefs(); }
  renderPsMenu();
});
$('#psCur').onclick = () => toast('示範版', '貨幣轉換尚未實作', 'info');

// ================= 底部交易面板 =================
let bottomTab = 'positions', bottomQueued = false;
function scheduleBottom() {
  if (bottomQueued) return;
  bottomQueued = true;
  setTimeout(() => { bottomQueued = false; renderBottom(); }, 250);
}

function renderBottom() {
  if (!state.bottomOpen) return;
  const s = broker.summary();
  const colored = (el, v) => { el.textContent = money(v); el.className = `acct-v ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`; };
  $('#acBalance').textContent = money(s.balance);
  $('#acEquity').textContent = money(s.equity);
  colored($('#acRealized'), s.realized);
  colored($('#acUnrealized'), s.unrealized);
  $('#acMargin').textContent = money(s.margin);
  $('#acAvail').textContent = money(s.available);
  const positions = Object.values(broker.positions);
  $('#cntPos').textContent = positions.length;
  $('#cntOrd').textContent = broker.orders.length;

  const prec = sym => (sym === state.symbol ? state.precision : symbolMeta(sym).precision);
  const time = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const side = sd => `<span class="side-${sd}">${sideText(sd)}</span>`;
  const sym = sy => `<span class="sym" data-sym="${sy}">${displaySymbol(sy)}</span>`;
  let html;
  if (bottomTab === 'positions') {
    html = !positions.length ? '<div class="pt-empty">目前沒有持倉</div>' : table(
      ['商品', '方向', '數量', '平均成交價', '止盈', '止損', '最新價', '未實現損益', '未實現損益 %', '交易價值', ''],
      positions.map(p => {
        const last = broker.price(p.symbol), u = broker.unrealized(p.symbol);
        const pct = (u / (p.avg * p.qty)) * 100;
        return [sym(p.symbol), side(p.side), p.qty, fmt(p.avg, prec(p.symbol)), p.tp != null ? fmt(p.tp, prec(p.symbol)) : '—', p.sl != null ? fmt(p.sl, prec(p.symbol)) : '—',
          fmt(last, prec(p.symbol)), `<span class="${u >= 0 ? 'up' : 'down'}">${fmtUsd(u)}</span>`, `<span class="${u >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`,
          money(last * p.qty), `<span class="act"><button data-rev="${p.symbol}">反向</button><button data-close="${p.symbol}">平倉 ✕</button></span>`];
      }));
  } else if (bottomTab === 'orders') {
    html = !broker.orders.length ? '<div class="pt-empty">目前沒有工作中的訂單</div>' : table(
      ['商品', '方向', '類型', '數量', '限價', '停損價', '止盈', '止損', '狀態', '下單時間', '訂單 ID', ''],
      broker.orders.map(o => [sym(o.symbol), side(o.side), typeText(o.type), o.qty,
        o.type === 'limit' ? fmt(o.price, prec(o.symbol)) : '—', o.type === 'stop' ? fmt(o.price, prec(o.symbol)) : '—',
        o.tp != null ? fmt(o.tp, prec(o.symbol)) : '—', o.sl != null ? fmt(o.sl, prec(o.symbol)) : '—',
        o.status, time(o.created), o.id, `<span class="act"><button data-cancel="${o.id}">取消 ✕</button></span>`]));
  } else if (bottomTab === 'history') {
    html = !broker.history.length ? '<div class="pt-empty">尚無歷史訂單</div>' : table(
      ['商品', '方向', '類型', '數量', '價格', '成交價', '已實現損益', '狀態', '時間', '訂單 ID'],
      broker.history.slice(0, 200).map(o => [sym(o.symbol), side(o.side), (o.reason ? `${o.reason} · ` : '') + typeText(o.type), o.qty,
        o.price != null ? fmt(o.price, prec(o.symbol)) : '市價', o.fillPrice != null ? fmt(o.fillPrice, prec(o.symbol)) : '—',
        o.pnl ? `<span class="${o.pnl >= 0 ? 'up' : 'down'}">${fmtUsd(o.pnl)}</span>` : '—', o.status, time(o.closed ?? o.created), o.id]));
  } else {
    html = !broker.journal.length ? '<div class="pt-empty">尚無紀錄</div>' : table(['時間', '訊息'], broker.journal.slice(0, 200).map(j => [time(j.time), j.text]));
  }
  $('#ptTable').innerHTML = html;
}
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

$('#ptTabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  bottomTab = b.dataset.tab;
  $$('#ptTabs button').forEach(x => x.classList.toggle('active', x === b));
  renderBottom();
});
$('#ptTable').addEventListener('click', e => {
  const t = e.target.closest('[data-close],[data-rev],[data-cancel],[data-sym]');
  if (!t) return;
  if (t.dataset.close) broker.closePosition(t.dataset.close);
  else if (t.dataset.rev) broker.reversePosition(t.dataset.rev);
  else if (t.dataset.cancel) broker.cancelOrder(+t.dataset.cancel);
  else if (t.dataset.sym && t.dataset.sym !== state.symbol) load(t.dataset.sym, state.interval);
});
$('#acReset').onclick = () => { if (confirm('確定要重置模擬交易帳戶？所有持倉與訂單都會清除。')) broker.reset(); };
setInterval(renderBottom, 1000);

function setBottom(open) {
  state.bottomOpen = open;
  $('#bottom').hidden = !open;
  $('#bottomResizer').hidden = !open;
  $('#tradeBtn').classList.toggle('on', open);
  renderBottom();
  savePrefs();
}
$('#bottomToggle').onclick = () => $('#bottom').classList.toggle('collapsed');
$('#bottomClose').onclick = () => setBottom(false);
$('#tradeBtn').onclick = () => {
  const open = !(state.bottomOpen || orderPanelOpen());
  setBottom(open);
  showView(open ? 'viewOrder' : null);
};
(() => {
  const res = $('#bottomResizer'), bottom = $('#bottom');
  res.addEventListener('pointerdown', e => {
    const y0 = e.clientY, h0 = bottom.offsetHeight;
    res.setPointerCapture(e.pointerId);
    const move = ev => { bottom.classList.remove('collapsed'); bottom.style.height = `${Math.max(38, Math.min(window.innerHeight - 250, h0 - (ev.clientY - y0)))}px`; };
    res.addEventListener('pointermove', move);
    res.addEventListener('pointerup', () => res.removeEventListener('pointermove', move), { once: true });
  });
})();

// ================= 觀察清單 / 詳情 =================
function renderWatchlist() {
  if (state.rightView !== 'viewWatchlist') return;
  $('#watchlist').innerHTML = WATCHLIST.map(s => {
    const m = symbolMeta(s);
    return `<div class="wl-row ${s === state.symbol ? 'active' : ''}" data-sym="${s}">
      <span class="wl-sym"><span class="wl-ic" style="background:${m.color}">${m.icon}</span>${displaySymbol(s)}</span>
      <span data-f="last">—</span><span data-f="chg">—</span><span data-f="pct">—</span></div>`;
  }).join('');
  WATCHLIST.forEach(s => state.tickers[s] && updateTickerRow(s, state.tickers[s], false));
  renderDetails();
}
function updateTickerRow(sym, t, flash = true) {
  const row = document.querySelector(`.wl-row[data-sym="${sym}"]`);
  if (!row) return;
  const p = sym === state.symbol ? state.precision : symbolMeta(sym).precision;
  const chg = t.last - t.open, pct = (chg / t.open) * 100;
  const cls = chg >= 0 ? 'up' : 'down';
  const lastEl = row.querySelector('[data-f="last"]');
  const prev = parseFloat(lastEl.dataset.v);
  lastEl.textContent = fmt(t.last, p);
  lastEl.dataset.v = t.last;
  if (flash && !isNaN(prev) && prev !== t.last) {
    lastEl.classList.remove('flash-up', 'flash-down');
    void lastEl.offsetWidth;
    lastEl.classList.add(t.last > prev ? 'flash-up' : 'flash-down');
  }
  row.querySelector('[data-f="chg"]').innerHTML = `<span class="${cls}">${signed(chg, v => fmt(v, p))}</span>`;
  row.querySelector('[data-f="pct"]').innerHTML = `<span class="${cls}">${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%</span>`;
}
function renderDetails() {
  if (state.rightView !== 'viewWatchlist') return;
  const s = state.symbol, m = symbolMeta(s), t = state.tickers[s];
  const last = state.bars[state.bars.length - 1]?.close ?? t?.last;
  const open = t?.open ?? state.bars[0]?.open;
  const chg = last - open, pct = (chg / open) * 100, cls = chg >= 0 ? 'up' : 'down';
  const lo = t?.low ?? last, hi = t?.high ?? last;
  const pos = hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50;
  $('#details').innerHTML = `
    <div class="dt-head"><span class="wl-ic" style="background:${m.color};width:24px;height:24px;font-size:13px">${m.icon}</span>${displaySymbol(s)}</div>
    <div class="dt-sub">${m.desc} · ${EXCHANGE} · 加密貨幣</div>
    <div class="dt-price">${fmt(last)}<small>USDT</small></div>
    <div class="dt-chg ${cls}">${signed(chg)} &nbsp;${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%</div>
    <div class="dt-range">當日範圍
      <div class="dt-bar"><i style="left:calc(${Math.max(0, Math.min(100, pos))}% - 1px)"></i></div>
      <div class="dt-bar-lab"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div>
    </div>
    <div class="dt-grid">
      <div><span>24h 成交量</span><b>${fmtVol(t?.volume)} ${m.base}</b></div>
      <div><span>24h 成交額</span><b>${fmtVol(t?.quoteVolume)} USDT</b></div>
      <div><span>24h 最高</span><b>${fmt(hi)}</b></div>
      <div><span>24h 最低</span><b>${fmt(lo)}</b></div>
    </div>`;
}
$('#watchlist').addEventListener('click', e => {
  const row = e.target.closest('.wl-row');
  if (row && row.dataset.sym !== state.symbol) load(row.dataset.sym, state.interval);
});
$('#wlAdd').onclick = () => openSymbolSearch();
let detailsQueued = false;
async function startTickers() {
  Object.assign(state.tickers, await feed.get24h(WATCHLIST));
  renderWatchlist();
  updateTitle();
  WATCHLIST.forEach(s => broker.prices[s] ??= state.tickers[s]?.last);
  feed.subscribeTickers(WATCHLIST, (sym, t) => {
    state.tickers[sym] = t;
    updateTickerRow(sym, t);
    if (sym !== state.symbol) broker.onPrice(sym, t.last);
    if (!detailsQueued) { detailsQueued = true; setTimeout(() => { detailsQueued = false; renderDetails(); }, 1000); }
  });
}

// ================= 物件樹 =================
function renderTree() {
  if (state.rightView !== 'viewTree') return;
  const el = $('#viewTree');
  const drawRows = drawings.list.map((d, i) => `
    <div class="tree-row ${d === drawings.selected ? 'sel' : ''}" data-d="${i}">
      <span class="tree-sw" style="background:${d.color || (d.type === 'long' ? GREEN : d.type === 'short' ? RED : '#787b86')}"></span>
      ${TOOL_NAMES[d.type] || d.type}${d.type === 'text' ? `：${(d.text || '').slice(0, 12)}` : d.type === 'emoji' ? ` ${d.char}` : ''}
      <span class="tree-acts">
        <button data-dlock="${i}" title="${d.locked ? '解鎖' : '鎖定'}"><svg viewBox="0 0 28 28" width="22" height="22">${d.locked ? ICONS.lockon : ICONS.lock}</svg></button>
        <button data-ddel="${i}" title="移除"><svg viewBox="0 0 28 28" width="22" height="22">${ICONS.trash}</svg></button>
      </span>
    </div>`).join('');
  const indRows = [
    ...(state.volumeVisible ? [{ id: 'vol', name: '成交量' }] : []),
    ...indicators.list.map(i => ({ id: i.id, name: i.def.title(i.params) })),
  ].map(r => `<div class="tree-row" data-i="${r.id}"><span class="tree-sw" style="background:#2962ff"></span>${r.name}
      <span class="tree-acts"><button data-idel="${r.id}" title="移除"><svg viewBox="0 0 28 28" width="22" height="22">${ICONS.trash}</svg></button></span></div>`).join('');
  el.innerHTML = `<div class="rp-head"><span class="rp-title">物件樹</span></div>
    <div class="tree-sec">${displaySymbol(state.symbol)} · ${INTERVALS.find(i => i.id === state.interval).legend}</div>
    <div class="tree-sec">指標</div>${indRows || '<div class="tree-empty">沒有指標</div>'}
    <div class="tree-sec">繪圖（${drawings.list.length}）</div>${drawRows || '<div class="tree-empty">沒有繪圖</div>'}`;
}
$('#viewTree').addEventListener('click', e => {
  const t = e.target.closest('[data-dlock],[data-ddel],[data-idel],[data-d]');
  if (!t) return;
  if (t.dataset.ddel) { drawings.select(drawings.list[+t.dataset.ddel]); drawings.deleteSelected(); }
  else if (t.dataset.dlock) { drawings.select(drawings.list[+t.dataset.dlock]); drawings.setStyle({ locked: !drawings.selected.locked }); }
  else if (t.dataset.idel) {
    if (t.dataset.idel === 'vol') { state.volumeVisible = false; volumeSeries.applyOptions({ visible: false }); renderLegend(); renderTree(); savePrefs(); }
    else indicators.remove(+t.dataset.idel);
  } else if (t.dataset.d) drawings.select(drawings.list[+t.dataset.d]);
});

// ================= 右側欄切換 =================
function showView(id) {
  state.rightView = id;
  $('#rightpanel').hidden = !id;
  $$('.rp-view').forEach(v => (v.hidden = v.id !== id));
  $$('#rightbar .rb-tool[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'viewOrder') renderTicket();
  if (id === 'viewWatchlist') renderWatchlist();
  if (id === 'viewTree') renderTree();
  syncTradeLines();
  savePrefs();
}
$$('#rightbar .rb-tool[data-view]').forEach(b => b.onclick = () => showView(state.rightView === b.dataset.view ? null : b.dataset.view));

// ================= 頂部工具列 =================
function renderIntervals() {
  const shown = INTERVALS.filter(i => state.favorites.includes(i.id) || i.id === state.interval);
  $('#intervalGroup').innerHTML = shown.map(i => `<button class="tb-btn tb-interval ${i.id === state.interval ? 'active' : ''}" data-id="${i.id}">${i.label}</button>`).join('');
  let html = '', group = '';
  for (const i of INTERVALS) {
    if (i.group !== group) { group = i.group; html += `<div class="dd-sec">${group}</div>`; }
    const fav = state.favorites.includes(i.id);
    html += `<button class="dd-item ${i.id === state.interval ? 'active' : ''}" data-id="${i.id}">${i.label}<span class="star ${fav ? 'on' : ''}" data-star="${i.id}" title="${fav ? '從我的最愛移除' : '加入我的最愛'}">${fav ? '★' : '☆'}</span></button>`;
  }
  $('#intervalMenu').innerHTML = html;
}
$('#intervalGroup').addEventListener('click', e => {
  const b = e.target.closest('.tb-interval');
  if (b && b.dataset.id !== state.interval) load(state.symbol, b.dataset.id);
});
$('#intervalCaret').onclick = e => { e.stopPropagation(); $('#intervalMenu').classList.toggle('open'); };
$('#intervalMenu').addEventListener('click', e => {
  const star = e.target.closest('[data-star]');
  if (star) {
    const id = star.dataset.star;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
    renderIntervals();
    $('#intervalMenu').classList.add('open');
    savePrefs();
    return;
  }
  const b = e.target.closest('.dd-item');
  if (!b) return;
  $('#intervalMenu').classList.remove('open');
  if (b.dataset.id !== state.interval) load(state.symbol, b.dataset.id);
});

function renderChartTypeBtn() {
  const t = CHART_TYPES.find(c => c.id === state.chartType);
  $('#chartTypeBtn').innerHTML = `<svg viewBox="0 0 28 28" width="28" height="28">${t.icon}</svg>`;
  $('#chartTypeMenu').innerHTML = CHART_TYPES.map(c =>
    `<button class="dd-item ${c.id === state.chartType ? 'active' : ''}" data-type="${c.id}"><svg viewBox="0 0 28 28" width="28" height="28">${c.icon}</svg>${c.name}</button>`).join('');
}
$('#chartTypeBtn').onclick = e => { e.stopPropagation(); $('#chartTypeMenu').classList.toggle('open'); };
$('#chartTypeMenu').addEventListener('click', e => {
  const b = e.target.closest('.dd-item');
  if (!b) return;
  $('#chartTypeMenu').classList.remove('open');
  if (b.dataset.type !== state.chartType) setChartType(b.dataset.type);
});

$('#undoBtn').onclick = () => drawings.undo();
$('#redoBtn').onclick = () => drawings.redo();
$('#saveBtn').onclick = () => { savePrefs(); toast('已儲存', '圖表版面已儲存在這台電腦的瀏覽器中', 'ok'); };
$('#fullscreenBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
$('#screenshotBtn').onclick = () => {
  const canvas = chart.takeScreenshot();
  const a = document.createElement('a');
  const d = new Date();
  a.download = `${displaySymbol(state.symbol)}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  toast('已拍攝快照', a.download, 'ok');
};
$$('.soon').forEach(b => b.addEventListener('click', () => toast('示範版', '這個功能在假TradingView中尚未實作', 'info')));

// ---------- 對話框 ----------
function openModal(html, onOpen) {
  $('#modal').innerHTML = html;
  $('#modalBack').hidden = false;
  $('#modal .md-close')?.addEventListener('click', closeModal);
  onOpen?.();
}
function closeModal() { $('#modalBack').hidden = true; }
$('#modalBack').addEventListener('pointerdown', e => { if (e.target.id === 'modalBack') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modalBack').hidden) closeModal(); });

const SEARCH_ICON = '<svg viewBox="0 0 18 18" width="18" height="18"><path fill="currentColor" d="M3.5 8a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM8 2a6 6 0 1 0 3.65 10.76l3.58 3.58 1.06-1.06-3.58-3.58A6 6 0 0 0 8 2Z"/></svg>';
function openSymbolSearch(initial = '') {
  openModal(`
    <div class="md-head">商品代碼搜尋<div class="tb-spacer"></div><button class="md-close">×</button></div>
    <div class="md-search">${SEARCH_ICON}<input id="symQ" placeholder="商品代碼，例如 BTCUSDT.P" spellcheck="false"></div>
    <div class="md-list" id="symList"></div>`, () => {
    const q = $('#symQ');
    q.value = initial;
    let kbd = 0, results = [];
    const render = () => {
      const v = q.value.trim().toUpperCase().replace(/\.P$/, '');
      results = Object.keys(SYMBOLS).filter(s => s.includes(v) || SYMBOLS[s].desc.toUpperCase().includes(v));
      if (v && !results.includes(v) && /^[A-Z0-9]{4,20}$/.test(v)) results.push(v);
      kbd = Math.min(kbd, Math.max(0, results.length - 1));
      $('#symList').innerHTML = results.map((s, i) => {
        const m = symbolMeta(s);
        return `<div class="md-item ${i === kbd ? 'kbd' : ''}" data-sym="${s}"><span class="wl-ic" style="background:${m.color};width:24px;height:24px;font-size:12px">${m.icon}</span>
          <span class="md-sym">${displaySymbol(s)}</span><span class="md-desc">${m.desc}</span><span class="md-ex">永續合約 · ${EXCHANGE}</span></div>`;
      }).join('') || '<div class="pt-empty">找不到符合的商品</div>';
    };
    const pick = async s => {
      closeModal();
      if (!(await feed.hasSymbol(s))) { toast('找不到商品', `${displaySymbol(s)} 不是 ${EXCHANGE} 的永續合約`, 'err'); return; }
      load(s, state.interval);
    };
    q.oninput = () => { kbd = 0; render(); };
    q.onkeydown = e => {
      if (e.key === 'ArrowDown') { kbd = Math.min(results.length - 1, kbd + 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { kbd = Math.max(0, kbd - 1); render(); e.preventDefault(); }
      if (e.key === 'Enter' && results[kbd]) pick(results[kbd]);
    };
    $('#symList').onclick = e => { const it = e.target.closest('.md-item'); if (it) pick(it.dataset.sym); };
    render();
    q.focus();
  });
}
$('#symbolBtn').onclick = () => openSymbolSearch();
document.addEventListener('keydown', e => {
  if (!$('#modalBack').hidden || e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); openSymbolSearch(e.key.toUpperCase()); }
});

function openIndicators() {
  const items = [{ type: 'VOL', name: '成交量', short: 'Volume' }, ...Object.entries(INDICATORS).map(([type, d]) => ({ type, name: d.name, short: d.short }))];
  openModal(`
    <div class="md-head">技術指標、指標和策略<div class="tb-spacer"></div><button class="md-close">×</button></div>
    <div class="md-search">${SEARCH_ICON}<input id="indQ" class="nocase" placeholder="搜尋" spellcheck="false"></div>
    <div class="md-sec">技術指標</div>
    <div class="md-list" id="indList"></div>`, () => {
    const render = () => {
      const v = $('#indQ').value.trim().toLowerCase();
      $('#indList').innerHTML = items.filter(i => !v || i.name.includes(v) || i.short.toLowerCase().includes(v))
        .map(i => `<div class="md-item" data-type="${i.type}"><span class="md-desc" style="color:var(--text)">${i.name}</span><span class="md-ex">${i.short}</span></div>`).join('');
    };
    $('#indQ').oninput = render;
    $('#indList').onclick = e => {
      const it = e.target.closest('.md-item');
      if (!it) return;
      if (it.dataset.type === 'VOL') {
        state.volumeVisible = true;
        volumeSeries.applyOptions({ visible: true });
        renderLegend(); renderTree(); savePrefs();
      } else indicators.add(it.dataset.type);
      toast('已新增指標', it.querySelector('.md-desc').textContent, 'ok');
    };
    render();
    $('#indQ').focus();
  });
}
$('#indicatorsBtn').onclick = openIndicators;
$('#indicatorsCaret').onclick = openIndicators;

// ================= 時間範圍列 / 時鐘 =================
const RANGES = [
  { label: '1天', iv: '1m', span: 86400 }, { label: '5天', iv: '5m', span: 5 * 86400 }, { label: '1月', iv: '30m', span: 30 * 86400 },
  { label: '3月', iv: '1h', span: 90 * 86400 }, { label: '6月', iv: '2h', span: 182 * 86400 }, { label: 'YTD', iv: '1d', span: 'ytd' },
  { label: '1年', iv: '1d', span: 365 * 86400 }, { label: '5年', iv: '1w', span: 5 * 365 * 86400 }, { label: '全部', iv: '1w', span: 'all' },
];
$('#rangeGroup').innerHTML = RANGES.map((r, i) => `<button class="rb-btn" data-i="${i}">${r.label}</button>`).join('');
$('#rangeGroup').addEventListener('click', async e => {
  const b = e.target.closest('.rb-btn');
  if (!b) return;
  const r = RANGES[+b.dataset.i];
  if (r.iv !== state.interval) await load(state.symbol, r.iv);
  const last = state.bars[state.bars.length - 1].time;
  if (r.span === 'all') { chart.timeScale().fitContent(); return; }
  const from = r.span === 'ytd' ? Date.UTC(new Date().getFullYear(), 0, 1) / 1000 + TZ_OFFSET : last - r.span;
  chart.timeScale().setVisibleRange({ from: Math.max(from, state.bars[0].time), to: last });
});
$('#gotoBtn').onclick = e => { e.stopPropagation(); $('#gotoMenu').classList.toggle('open'); };
$('#gotoGo').onclick = () => {
  const v = $('#gotoInput').value;
  if (!v) return;
  const t = Date.parse(v) / 1000 + TZ_OFFSET;
  const bars = state.bars;
  if (t < bars[0].time) { toast('超出範圍', '目前載入的資料沒有這麼早，請先往左捲動載入更多', 'err'); return; }
  const r = chart.timeScale().getVisibleLogicalRange();
  const width = r ? r.to - r.from : 100;
  const idx = (t - bars[0].time) / intervalSec(state.interval);
  chart.timeScale().setVisibleLogicalRange({ from: idx - width / 2, to: idx + width / 2 });
  $('#gotoMenu').classList.remove('open');
};

const tzLabel = (() => { const h = TZ_OFFSET / 3600; return `UTC${h >= 0 ? '+' : '−'}${Math.abs(h)}`; })();
function tick() {
  const d = new Date();
  $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tzLabel}`;
  const bars = state.bars;
  if (replay.active) { axisExtras.price = null; axisExtras.requestUpdate?.(); }
  else if (bars.length) {
    const b = bars[bars.length - 1];
    const left = Math.max(0, b.time - TZ_OFFSET + intervalSec(state.interval) - Math.floor(Date.now() / 1000));
    const dd = Math.floor(left / 86400), hh = Math.floor((left % 86400) / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
    axisExtras.text = dd ? `${dd}d ${pad(hh)}h` : hh ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    axisExtras.price = b.close;
    axisExtras.color = state.chartType === 'line' || state.chartType === 'area' ? BLUE : b.close >= b.open ? UP : DOWN;
    axisExtras.requestUpdate?.();
  }
}

// ================= 止盈 / 止損 觸發特效 =================
function hitFx({ reason, price, time, sub }) {
  // 等這一幀的 K 線和標籤畫上去之後再定位
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const H = chart.panes()[0].getHeight(), W = chart.timeScale().width();
    const t = time ?? state.bars[state.bars.length - 1]?.time;
    let x = t != null ? drawings.toX(t) : null;
    let y = mainSeries.priceToCoordinate(price);
    if (x == null || y == null) return;
    x = Math.max(10, Math.min(W - 10, x));
    y = Math.max(10, Math.min(H - 10, y));
    const tp = reason === '止盈';
    const el = document.createElement('div');
    el.className = `hit-fx ${tp ? 'tp' : 'sl'}`;
    el.dataset.born = performance.now();
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = 'hidden';
    const dots = Array.from({ length: 14 }, (_, i) =>
      `<i class="hf-dot" style="--a:${i * (360 / 14) + Math.random() * 16 - 8}deg;--d:${45 + Math.random() * 45}px"></i>`).join('');
    el.innerHTML = `<i class="hf-ring"></i><i class="hf-ring r2"></i>${dots}
      <div class="hf-label"><b>${tp ? '止盈' : '止損'}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    wrap.appendChild(el);
    placeHitLabel(el.querySelector('.hf-label'), x, y, W, H);
    el.style.visibility = '';
    // 特效黏在觸發的那根 K 線與價位上，圖表捲動（例如加速播放）時跟著移動
    const follow = () => {
      if (!el.isConnected) return;
      const fx = drawings.toX(t), fy = mainSeries.priceToCoordinate(price);
      if (fx != null && fy != null) {
        el.style.left = `${fx}px`;
        el.style.top = `${fy}px`;
        el.style.display = fx < -150 || fx > chart.timeScale().width() + 150 ? 'none' : '';
      }
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
    setTimeout(() => el.remove(), 2200);
  }));
}

// 圖上已經有字的地方（部位框標籤、交易線標籤、圖例、其他特效、重播控制列）
function occupiedRects(except) {
  const wr = wrap.getBoundingClientRect();
  const rel = el => { const r = el.getBoundingClientRect(); return { x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height }; };
  const rects = [...(drawings.labelRects || [])];
  $$('#tradeOverlay .tl, #legend .lg-row, #lgIndicators:not(.collapsed) .lg-ind, #lgCollapse, #paneLegends .lg-ind').forEach(el => {
    if (el.offsetParent) rects.push(rel(el));
  });
  // 還看得到的特效（快淡出的就不算）
  $$('.hit-fx').forEach(fx => {
    const label = fx.querySelector('.hf-label');
    if (label !== except && performance.now() - +fx.dataset.born < 1500) rects.push(rel(label));
  });
  if (!replay.bar.hidden && replay.bar.parentElement === wrap) rects.push(rel(replay.bar));
  return rects;
}

// 在觸發點周圍挑一個不會蓋到其他字、也不會超出圖表的位置放「止盈／止損」字樣
function placeHitLabel(label, x, y, W, H) {
  const w = label.offsetWidth, h = label.offsetHeight;
  const FLOAT = 20, PAD = 6;        // 字淡出時會往上飄，上方多留一點空間
  const rects = occupiedRects(label);
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  // 先找觸發點旁邊，再往外找（右、上、下、左…）
  const cands = [[1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [-1, -1], [-1, 1]];
  for (const k of [2, 3]) cands.push([k, 0], [-k, 0], [0, -k], [0, k], [k, -k], [-k, -k], [k, k], [-k, k]);
  let best = null;
  for (const [sx, sy] of cands) {
    const cx = sx * (w / 2 + 26), cy = sy * (h / 2 + 24);
    const r = { x: x + cx - w / 2 - PAD, y: y + cy - h / 2 - FLOAT - PAD, w: w + PAD * 2, h: h + FLOAT + PAD * 2 };
    let cost = rects.reduce((sum, o) => sum + overlap(r, o), 0);
    const out = Math.max(0, -r.x) + Math.max(0, r.x + r.w - W) + Math.max(0, -r.y) + Math.max(0, r.y + r.h - H);
    cost += out * 1000;
    if (!best || cost < best.cost) best = { cx, cy, cost };
    if (cost === 0) break;
  }
  label.style.left = `${best.cx}px`;
  label.style.top = `${best.cy}px`;
}

// 部位框（多頭/空頭部位）在 K 線更新後剛好碰到止盈或止損時跳特效
const posSeen = new WeakMap();
function checkPositionHits(fire) {
  if (drawings.drag) fire = false;
  for (const d of drawings.list) {
    if (d.type !== 'long' && d.type !== 'short') continue;
    const st = drawings.positionState(d);
    const key = st.close ? `${st.close.t}:${st.close.price}` : '';
    const prev = posSeen.get(d);
    posSeen.set(d, key);
    if (!fire || prev === undefined || prev === key || !key) continue;
    const pts = (st.close.price - d.entry) * (d.type === 'long' ? 1 : -1);
    const pct = (pts / d.entry) * 100;
    hitFx({
      reason: st.close.price === d.tp ? '止盈' : '止損', price: st.close.price, time: st.close.t,
      sub: `${pts >= 0 ? '+' : '−'}${fmt(Math.abs(pts))} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%)`,
    });
  }
}
for (const b of [realBroker, replayBroker]) {
  b.addEventListener('hit', e => {
    const h = e.detail;
    if (b !== broker || h.symbol !== state.symbol) return;
    hitFx({ reason: h.reason, price: h.price, sub: `${fmtUsd(h.pnl)} USD` });
  });
}

// ================= K 線重播 =================
function leaveReplayBroker() {
  broker = realBroker;
  $('#replayBtn').classList.remove('active');
  $('.broker span:last-child').textContent = '模擬交易';
}
const replay = new Replay({
  chart, wrap, captureRoot: $('#center'),
  hooks: {
    getBars: () => state.bars,
    applyBars(bars, mode) {
      state.bars = bars;
      if (mode === 'full') {
        mainSeries.setData(seriesData());
        volumeSeries.setData(bars.map(volPoint));
        indicators.recalcAll();
      } else {
        mainSeries.update(lastSeriesPoint());
        volumeSeries.update(volPoint(bars[bars.length - 1]));
        if (mode === 'new') indicators.recalcAll(); else indicators.updateLast();
      }
      if (state.hoverIndex == null) renderLegendValues();
      drawings.update();
      scheduleQuote();
      checkPositionHits(mode !== 'full');
    },
    feedPrice(prices) {
      for (const p of prices) broker.onPrice(state.symbol, p);
      const p = prices[prices.length - 1];
      state.book = { bid: p, ask: p };
    },
    enter() {
      unsubKline?.(); unsubBook?.();
      unsubKline = unsubBook = null;
      replayBroker.reset(false);
      replayBroker.prices = { ...realBroker.prices };
      broker = replayBroker;
      $('#replayBtn').classList.add('active');
      $('.broker span:last-child').textContent = '模擬交易（重播）';
      syncTradeLines(); renderBottom(); renderTicket();
    },
    exit() {
      leaveReplayBroker();
      load(state.symbol, state.interval);
      toast('重播', '已退出重播，回到即時行情', 'info');
    },
    snapshot: () => broker.snapshot(),
    restore: snap => broker.restore(snap),
    fmtTime,
    toast,
    onPickChange: on => $('#replayBtn').classList.toggle('active', on || replay.active),
  },
});
$('#replayBtn').onclick = () => {
  if (replay.picking && !replay.active) replay.cancelPick();
  else if (replay.active) replay.exit();
  else replay.startPick();
};

// ================= 錄影 =================
function renderRecMenu() {
  $$('#recMenu [data-area]').forEach(b => b.classList.toggle('on', b.dataset.area === recPrefs.area));
}
// 只錄圖表區時，把重播控制列暫時移到圖表外面，這樣按播放/暫停時控制列不會被錄進影片
function placeReplayBar(detach) {
  const bar = replay.bar;
  if (detach) {
    const r = wrap.getBoundingClientRect();
    document.body.appendChild(bar);
    bar.classList.add('detached');
    bar.style.left = `${r.left + r.width / 2}px`;
    bar.style.top = `${r.bottom - 44 - 44}px`;
  } else if (bar.parentElement !== wrap) {
    wrap.appendChild(bar);
    bar.classList.remove('detached');
    bar.style.left = bar.style.top = '';
  }
}
const recorder = new Recorder({
  getTarget: () => wrap,
  fileName: () => {
    const d = new Date();
    return `${displaySymbol(state.symbol)}_${INTERVALS.find(i => i.id === state.interval).legend}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  },
  toast,
  onState: st => {
    const btn = $('#recBtn');
    btn.classList.toggle('on', st.recording);
    document.body.classList.toggle('recording', st.recording);
    if (st.recording) {
      const t = Math.floor(st.elapsed || 0);
      $('#recText').textContent = `${pad(Math.floor(t / 60))}:${pad(t % 60)} 停止`;
      btn.title = '停止錄影並下載影片';
      if (st.areaMode === 'element' && !replay.bar.classList.contains('detached')) placeReplayBar(true);
    } else {
      $('#recText').textContent = '錄影';
      btn.title = '錄影（錄下圖表畫面，停止後自動下載影片）';
      placeReplayBar(false);
    }
  },
});
$('#recBtn').onclick = e => {
  e.stopPropagation();
  if (recorder.recording) { recorder.stop(); return; }
  renderRecMenu();
  $('#recMenu').classList.toggle('open');
};
$('#recMenu').addEventListener('click', e => {
  const a = e.target.closest('[data-area]');
  if (a) { recPrefs.area = a.dataset.area; renderRecMenu(); savePrefs(); }
});
$('#recStart').onclick = () => {
  $('#recMenu').classList.remove('open');
  recorder.start({ area: recPrefs.area, fps: recPrefs.fps, scale: recPrefs.scale });
};
window.addEventListener('resize', () => { if (replay.bar.classList.contains('detached')) placeReplayBar(true); });

// ================= 提示 =================
function toast(title, text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${title}</b>${text || ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3500);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
}

// ================= 啟動 =================
setInterval(tick, 1000);
tick();
renderChartTypeBtn();
if (!state.volumeVisible) volumeSeries.applyOptions({ visible: false });
showView(state.rightView);
setBottom(state.bottomOpen);
const startSymbol = state.symbol, startInterval = state.interval;
state.symbol = null;
await load(startSymbol, startInterval);
(prefs.indicators || []).forEach(i => INDICATORS[i.type] && indicators.add(i.type, i.params));
renderLegend();
positionScaleWidgets();
startTickers();
// 除錯用（瀏覽器主控台可以操作）
window.__tv = { chart, replay, state, drawings, recorder, get broker() { return broker; } };
