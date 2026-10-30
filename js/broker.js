// 模擬交易（Paper Trading）券商：淨額持倉、市價/限價/停損單、止盈止損（括號單）

const START_BALANCE = 100000;
const STORE_KEY = 'fake-tv-broker-v1';

export class Broker extends EventTarget {
  // storeKey 為 null 時不存進瀏覽器（重播模式用的臨時帳戶）
  constructor({ storeKey = STORE_KEY } = {}) {
    super();
    this.storeKey = storeKey;
    this.prices = {};
    this.formatPrice = (symbol, p) => String(p);
    this.reset(false);
    this._load();
  }

  reset(emit = true) {
    this.balance = START_BALANCE;
    this.realized = 0;
    this.positions = {};   // symbol -> { symbol, side, qty, avg, tp, sl, openTime }
    this.orders = [];      // 工作中的訂單
    this.history = [];     // 已成交 / 已取消的訂單
    this.journal = [];
    this.seq = 1;
    if (emit) { this._log('帳戶已重置'); this._changed(); }
  }

  snapshot() {
    return structuredClone({
      balance: this.balance, realized: this.realized, positions: this.positions,
      orders: this.orders, history: this.history.slice(0, 200), journal: this.journal.slice(0, 200), seq: this.seq,
    });
  }

  restore(snap) {
    Object.assign(this, structuredClone(snap));
    this._changed();
  }

  _save() {
    if (!this.storeKey) return;
    try { localStorage.setItem(this.storeKey, JSON.stringify(this.snapshot())); } catch { /* 隱私模式等情況 */ }
  }

  _load() {
    if (!this.storeKey) return;
    try {
      const s = JSON.parse(localStorage.getItem(this.storeKey));
      if (s) Object.assign(this, s);
    } catch { /* 忽略 */ }
  }

  _changed() {
    this._save();
    this.dispatchEvent(new Event('change'));
  }

  _notify(title, text, kind = 'ok') {
    this.dispatchEvent(new CustomEvent('notify', { detail: { title, text, kind } }));
  }

  _log(text) {
    this.journal.unshift({ time: Date.now(), text });
  }

  price(symbol) { return this.prices[symbol]; }

  // ---------- 下單 ----------
  placeOrder({ symbol, side, type, qty, price, tp, sl }) {
    qty = +qty;
    if (!(qty > 0)) return this._reject('數量無效');
    const last = this.prices[symbol];
    if (last == null) return this._reject('尚未取得報價');
    const ref = type === 'market' ? last : price;
    const err = validateBracket(side, ref, tp, sl, p => this.formatPrice(symbol, p));
    if (err) return this._reject(err);

    const order = {
      id: this.seq++, symbol, side, type, qty, price: type === 'market' ? null : +price,
      tp: tp ?? null, sl: sl ?? null, status: '工作中', created: Date.now(),
    };
    if (type === 'market') {
      this._fill(order, last);
    } else {
      // 限價單已優於市價、或停損單已觸發，就以現價直接成交
      if (shouldTrigger(order, last)) {
        this._fill(order, last);
      } else {
        this.orders.push(order);
        const px = this.formatPrice(symbol, order.price);
        this._log(`${sideText(side)} ${qty} ${symbol} @ ${px} ${typeText(type)} 已送出`);
        this._notify('訂單已送出', `${sideText(side)} ${qty} ${symbol} @ ${px} ${typeText(type)}`, 'info');
      }
    }
    this._changed();
    return order;
  }

  _reject(msg) {
    this._notify('訂單被拒絕', msg, 'err');
    return null;
  }

  cancelOrder(id) {
    const i = this.orders.findIndex(o => o.id === id);
    if (i < 0) return;
    const [o] = this.orders.splice(i, 1);
    o.status = '已取消';
    o.closed = Date.now();
    this.history.unshift(o);
    this._log(`訂單 #${o.id} 已取消`);
    this._notify('訂單已取消', `${sideText(o.side)} ${o.qty} ${o.symbol} @ ${this.formatPrice(o.symbol, o.price)} ${typeText(o.type)}`, 'info');
    this._changed();
  }

  modifyOrder(id, patch) {
    const o = this.orders.find(x => x.id === id);
    if (!o) return false;
    const next = { ...o, ...patch };
    const err = validateBracket(next.side, next.price, next.tp, next.sl, p => this.formatPrice(o.symbol, p));
    if (err) { this._reject(err); this._changed(); return false; }
    Object.assign(o, patch);
    this._log(`訂單 #${o.id} 已修改`);
    this._changed();
    if (shouldTrigger(o, this.prices[o.symbol])) this.onPrice(o.symbol, this.prices[o.symbol]);
    return true;
  }

  modifyPosition(symbol, patch) {
    const p = this.positions[symbol];
    if (!p) return false;
    const next = { ...p, ...patch };
    const err = validateBracket(p.side, this.prices[symbol], next.tp, next.sl, p2 => this.formatPrice(symbol, p2));
    if (err) { this._reject(err); this._changed(); return false; }
    Object.assign(p, patch);
    this._log(`${symbol} 持倉止盈/止損已修改`);
    this._changed();
    return true;
  }

  closePosition(symbol) {
    const p = this.positions[symbol];
    if (!p) return;
    this.placeOrder({ symbol, side: p.side === 'buy' ? 'sell' : 'buy', type: 'market', qty: p.qty });
  }

  reversePosition(symbol) {
    const p = this.positions[symbol];
    if (!p) return;
    this.placeOrder({ symbol, side: p.side === 'buy' ? 'sell' : 'buy', type: 'market', qty: p.qty * 2 });
  }

  // ---------- 報價驅動 ----------
  onPrice(symbol, last) {
    this.prices[symbol] = last;
    let changed = false;
    for (const o of [...this.orders]) {
      if (o.symbol !== symbol || !shouldTrigger(o, last)) continue;
      this.orders.splice(this.orders.indexOf(o), 1);
      this._fill(o, o.type === 'limit' ? o.price : last);
      changed = true;
    }
    const p = this.positions[symbol];
    if (p) {
      const long = p.side === 'buy';
      let exit = null, why = '';
      if (p.tp != null && (long ? last >= p.tp : last <= p.tp)) { exit = p.tp; why = '止盈'; }
      else if (p.sl != null && (long ? last <= p.sl : last >= p.sl)) { exit = p.sl; why = '止損'; }
      if (exit != null) {
        const o = { id: this.seq++, symbol, side: long ? 'sell' : 'buy', type: why === '止盈' ? 'limit' : 'stop', qty: p.qty, price: exit, tp: null, sl: null, created: Date.now(), reason: why };
        this._fill(o, exit);
        changed = true;
      }
    }
    if (changed) this._changed();
  }

  _fill(order, fillPrice) {
    order.status = '已成交';
    order.fillPrice = fillPrice;
    order.closed = Date.now();
    this.history.unshift(order);

    const { symbol, side, qty } = order;
    const p = this.positions[symbol];
    let pnl = 0;
    if (!p) {
      this.positions[symbol] = { symbol, side, qty, avg: fillPrice, tp: order.tp, sl: order.sl, openTime: Date.now() };
    } else if (p.side === side) {
      p.avg = (p.avg * p.qty + fillPrice * qty) / (p.qty + qty);
      p.qty = round8(p.qty + qty);
      if (order.tp != null) p.tp = order.tp;
      if (order.sl != null) p.sl = order.sl;
    } else {
      const closeQty = Math.min(p.qty, qty);
      pnl = (fillPrice - p.avg) * closeQty * (p.side === 'buy' ? 1 : -1);
      const rest = round8(qty - closeQty);
      p.qty = round8(p.qty - closeQty);
      if (p.qty <= 0) delete this.positions[symbol];
      if (rest > 0) this.positions[symbol] = { symbol, side, qty: rest, avg: fillPrice, tp: order.tp, sl: order.sl, openTime: Date.now() };
    }
    order.pnl = pnl;
    this.realized += pnl;
    this.balance += pnl;

    const what = order.reason ? `${order.reason}觸發：` : '';
    const pnlText = pnl ? `，損益 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD` : '';
    const px = this.formatPrice(symbol, fillPrice);
    this._log(`${what}${sideText(side)} ${qty} ${symbol} 成交於 ${px}${pnlText}`);
    this._notify(order.reason ? `${order.reason}已觸發` : '訂單已成交',
      `${sideText(side)} ${qty} ${symbol} @ ${px}${pnlText}`, pnl < 0 ? 'err' : 'ok');
    if (order.reason) this.dispatchEvent(new CustomEvent('hit', { detail: { symbol, reason: order.reason, price: fillPrice, pnl } }));
  }

  // ---------- 帳戶統計 ----------
  unrealized(symbol) {
    const p = this.positions[symbol];
    const last = this.prices[symbol];
    if (!p || last == null) return 0;
    return (last - p.avg) * p.qty * (p.side === 'buy' ? 1 : -1);
  }

  summary() {
    let unrealized = 0, margin = 0;
    for (const s in this.positions) {
      unrealized += this.unrealized(s);
      margin += this.positions[s].qty * (this.prices[s] ?? this.positions[s].avg);
    }
    const equity = this.balance + unrealized;
    return { balance: this.balance, equity, realized: this.realized, unrealized, margin, available: equity - margin };
  }
}

export function validateBracket(side, ref, tp, sl, f = String) {
  if (ref == null) return null;
  const long = side === 'buy';
  if (tp != null && (long ? tp <= ref : tp >= ref)) return `止盈價格必須${long ? '高於' : '低於'} ${f(ref)}`;
  if (sl != null && (long ? sl >= ref : sl <= ref)) return `止損價格必須${long ? '低於' : '高於'} ${f(ref)}`;
  return null;
}

function shouldTrigger(o, last) {
  if (last == null) return false;
  if (o.type === 'limit') return o.side === 'buy' ? last <= o.price : last >= o.price;
  if (o.type === 'stop') return o.side === 'buy' ? last >= o.price : last <= o.price;
  return false;
}

const round8 = x => Math.round(x * 1e8) / 1e8;
export const sideText = s => (s === 'buy' ? '買入' : '賣出');
export const typeText = t => ({ market: '市價', limit: '限價', stop: '停損' }[t]);
