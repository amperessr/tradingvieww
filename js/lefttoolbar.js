// 左側繪圖工具列（仿 TradingView）：每一組工具按鈕右側有小箭頭，點開是該組的工具清單；
// 按鈕本身會記住最近使用的工具。
import { TOOL_NAMES } from './drawings.js';

const S = 'fill="none" stroke="currentColor"';
const C = (x, y) => `<circle cx="${x}" cy="${y}" r="1.8" ${S}/>`;
export const ICONS = {
  cross: '<path fill="currentColor" d="M18 15h8v-1h-8zM14 18v8h1v-8zM14 3v8h1v-8zM3 15h8v-1h-8z"/>',
  dot: '<circle cx="14" cy="14" r="2.5" fill="currentColor"/>',
  arrow: `<path ${S} d="M10.5 6.5v14l3.6-3.6 2.8 6 2-.9-2.8-6h5.2z"/>`,
  eraser: `<path ${S} d="M11.5 21.5h10M6.5 16.5l9.5-9.5 6 6-8.5 8.5h-3.5zM11 12l6 6"/>`,
  trend: `<path ${S} d="M7.8 20.2L20.2 7.8"/>${C(6.5, 21.5)}${C(21.5, 6.5)}`,
  ray: `<path ${S} d="M7.8 20.2l4.9-4.9M15.3 12.7L24 4"/>${C(6.5, 21.5)}${C(14, 14)}`,
  extended: `<path ${S} d="M4 24l5.2-5.2M11.8 16.2l4.4-4.4M18.8 9.2L24 4"/>${C(10.5, 17.5)}${C(17.5, 10.5)}`,
  arrowline: `<path ${S} d="M6.5 21.5l14-14M13.5 7.5h7v7"/>`,
  hline: `<path ${S} d="M4 14h8.2M15.8 14H24"/>${C(14, 14)}`,
  hray: `<path ${S} d="M10.8 14H24"/>${C(9, 14)}`,
  vline: `<path ${S} d="M14 4v8.2M14 15.8V24"/>${C(14, 14)}`,
  crossline: `<path ${S} d="M4 14h8.2M15.8 14H24M14 4v8.2M14 15.8V24"/>${C(14, 14)}`,
  channel: `<path ${S} d="M7.8 16.2l8.4-8.4M4 18l1-1M11.8 22.2l8.4-8.4M23 11l1-1"/>${C(6.5, 17.5)}${C(17.5, 6.5)}${C(10.5, 21.5)}`,
  fib: `<path ${S} d="M7 6.5h17M4 11.5h20M4 16.5h20M4 21.5h17"/>${C(5, 6.5)}${C(23, 21.5)}`,
  fibtime: `<path ${S} d="M5.5 5v18M8.5 5v18M12.5 5v18M19.5 5v18"/>`,
  xabcd: `<path ${S} d="M5.5 20.5l3.5-13 5 9 5-8 3.5 12"/>${C(9, 7.5)}${C(14, 16.5)}${C(19, 8.5)}`,
  abcd: `<path ${S} d="M5.5 19.5l6-12 5 9 6-10"/>${C(11.5, 7.5)}${C(16.5, 16.5)}`,
  long: `<path ${S} d="M5.5 5.5h17v17h-17zM5.5 14h17"/><path fill="currentColor" opacity=".35" d="M6 6h16v8H6z"/><path ${S} d="M9 11.5l3-3 2.5 2.5 4-4"/>`,
  short: `<path ${S} d="M5.5 5.5h17v17h-17zM5.5 14h17"/><path fill="currentColor" opacity=".35" d="M6 14h16v8H6z"/><path ${S} d="M9 16.5l3 3 2.5-2.5 4 4"/>`,
  pricerange: `<path ${S} d="M6 6.5h16M6 21.5h16M14 9v10M11.5 11.5L14 9l2.5 2.5M11.5 16.5L14 19l2.5-2.5"/>`,
  daterange: `<path ${S} d="M6.5 6v16M21.5 6v16M9 14h10M11.5 11.5L9 14l2.5 2.5M16.5 11.5L19 14l-2.5 2.5"/>`,
  datepricerange: `<path ${S} d="M5.5 5.5h17v17h-17zM14 8v12M8 14h12"/>`,
  brush: `<path ${S} d="M20.5 5.5l2 2-9 9-2.5-.5-.5-2.5zM10.5 16c-2 0-3 1.5-3 3s-1 2.5-2 2.5c3 1 7 0 7-3.5"/>`,
  highlighter: `<path ${S} d="M17 5.5l5.5 5.5-8 8h-3l-2.5-2.5v-3zM9 16.5l-3.5 3.5 2.5 2.5 3.5-3.5"/>`,
  rect: `<path ${S} d="M7.8 6.5h12.4M7.8 21.5h12.4M6.5 7.8v12.4M21.5 7.8v12.4"/>${C(6.5, 6.5)}${C(21.5, 6.5)}${C(6.5, 21.5)}${C(21.5, 21.5)}`,
  circle: `<circle cx="14" cy="14" r="8.5" ${S}/>${C(14, 14)}`,
  text: '<path fill="currentColor" d="M8 6.5h12v3h-1v-2h-4.5v13H16v1h-4v-1h1.5v-13H9v2H8z"/>',
  pricelabel: `<path ${S} d="M6.5 7.5h15v9h-5l-2.5 3-2.5-3h-5z"/><path ${S} d="M10 12h8"/>`,
  emoji: `<circle cx="14" cy="14" r="8.5" ${S}/><path ${S} d="M10.5 16c1 1.5 2.2 2 3.5 2s2.5-.5 3.5-2"/><circle cx="11" cy="12" r="1" fill="currentColor"/><circle cx="17" cy="12" r="1" fill="currentColor"/>`,
  measure: `<path ${S} d="M4.5 18.5l14-14 5 5-14 14zM8 15l2 2M10.5 12.5l3 3M13 10l2 2M15.5 7.5l3 3"/>`,
  zoom: `<circle cx="12.5" cy="12.5" r="6.5" ${S}/><path ${S} d="M17.5 17.5l5 5M12.5 9.5v6M9.5 12.5h6"/>`,
  magnet: `<path ${S} d="M9 5.5v9a5 5 0 0 0 10 0v-9h-3.5v9a1.5 1.5 0 0 1-3 0v-9zM9 9.5h3.5M15.5 9.5H19"/>`,
  stay: `<path ${S} d="M17.5 5.5l3 3-9 9-4 1 1-4zM15.5 7.5l3 3"/><path ${S} d="M17.5 18.5h5v4h-5zM18.5 18.5v-1.5a1.5 1.5 0 0 1 3 0v1.5"/>`,
  lock: `<path ${S} d="M8.5 13.5h11v8h-11zM11 13.5v-3a3 3 0 0 1 6 0v.5"/>`,
  lockon: `<path ${S} d="M8.5 13.5h11v8h-11zM11 13.5v-3a3 3 0 0 1 6 0v3"/>`,
  eye: `<path ${S} d="M4.5 14S8 8.5 14 8.5 23.5 14 23.5 14 20 19.5 14 19.5 4.5 14 4.5 14Z"/><circle cx="14" cy="14" r="2.8" ${S}/><path ${S} d="M19 20.5l3.5-3.5M20 17h2.5v2.5"/>`,
  eyeoff: `<path ${S} d="M4.5 14S8 8.5 14 8.5 23.5 14 23.5 14 20 19.5 14 19.5 4.5 14 4.5 14ZM6 22L22 6"/>`,
  trash: `<path ${S} d="M17.5 9.5V7.5a1.5 1.5 0 0 0-1.5-1.5h-4a1.5 1.5 0 0 0-1.5 1.5v2M6.5 9.5h15M8.5 9.5l1 13h9l1-13M12 13v6.5M16 13v6.5"/>`,
};
ICONS.arrow_tool = ICONS.arrowline;

const KEYS = { trend: 'Alt + T', hline: 'Alt + H', hray: 'Alt + J', vline: 'Alt + V', crossline: 'Alt + C', fib: 'Alt + F', rect: 'Alt + Shift + R', text: 'Alt + Shift + T' };
const EMOJIS = ['😀', '😂', '😍', '🤔', '😱', '😭', '😎', '🤑', '👍', '👎', '👏', '🙏', '💪', '👀', '🔥', '🚀', '💰', '💎', '📈', '📉', '🎯', '⚠️', '❌', '✅', '⭐', '❤️', '💡', '🐂', '🐻', '🌙', '⏰', '🔔'];

// tool id -> 繪圖類型（大部分相同，箭頭線另外命名避免和游標的「箭頭」衝突）
const TOOL_TYPE = { arrow_tool: 'arrow' };
const nameOf = id => ({ cross: '十字線', dot: '點', arrow: '箭頭', eraser: '橡皮擦' }[id] || TOOL_NAMES[TOOL_TYPE[id] || id]);

export const GROUPS = [
  { id: 'cursors', title: '游標', sections: [['游標', ['cross', 'dot', 'arrow']], ['', ['eraser']]] },
  { id: 'lines', title: '趨勢線工具', sections: [['線條', ['trend', 'ray', 'extended', 'arrow_tool']], ['水平 / 垂直', ['hline', 'hray', 'vline', 'crossline']], ['通道', ['channel']]] },
  { id: 'fibs', title: '江恩與斐波那契工具', sections: [['斐波那契', ['fib', 'fibtime']]] },
  { id: 'patterns', title: '型態', sections: [['諧波型態', ['xabcd', 'abcd']]] },
  { id: 'forecast', title: '預測和測量工具', sections: [['預測', ['long', 'short']], ['測量工具', ['pricerange', 'daterange', 'datepricerange']]] },
  { id: 'shapes', title: '幾何形狀', sections: [['筆刷', ['brush', 'highlighter']], ['形狀', ['rect', 'circle']]] },
  { id: 'annot', title: '註解工具', sections: [['文字與註解', ['text', 'pricelabel']]] },
  { id: 'icons', title: '圖示', emoji: true },
  'sep',
  { id: 'measure', title: '測量', single: true },
  { id: 'zoom', title: '放大', single: true },
  'sep',
  { id: 'magnet', title: '磁鐵模式', toggle: true, menu: [['weak', '弱磁鐵'], ['strong', '強磁鐵']] },
  { id: 'stay', title: '保持繪圖模式', toggle: true },
  { id: 'lock', title: '鎖定所有繪圖', toggle: true },
  { id: 'hide', title: '隱藏所有繪圖', toggle: true, menu: [['drawings', '隱藏所有繪圖'], ['indicators', '隱藏所有指標'], ['all', '隱藏全部']] },
  'sep',
  { id: 'trash', title: '移除物件', menuOnly: true, menu: [['drawings', '移除繪圖'], ['indicators', '移除指標'], ['all', '移除繪圖和指標']] },
];

export function buildLeftToolbar({ root, flyout, drawings, saved = {}, onCursorMode, onHide, onRemove, onSaveState }) {
  const current = { cursors: 'cross', lines: 'trend', fibs: 'fib', patterns: 'xabcd', forecast: 'long', shapes: 'brush', annot: 'text', ...saved.current };
  const st = { magnet: 'weak', hide: 'drawings', emoji: saved.emoji || '😀', hideOn: null };
  drawings.emoji = st.emoji;
  let openGroup = null;

  root.innerHTML = GROUPS.map(g => g === 'sep' ? '<div class="lt-sep"></div>' : `
    <div class="lt-item" data-g="${g.id}">
      <button class="lt-btn" data-main="${g.id}" title="${g.title}"></button>
      ${g.single || (g.toggle && !g.menu) ? '' : `<button class="lt-arrow" data-arrow="${g.id}"><svg viewBox="0 0 6 10" width="6" height="10"><path fill="none" stroke="currentColor" d="M1 1l4 4-4 4"/></svg></button>`}
    </div>`).join('');

  const groupOf = tool => GROUPS.find(g => g !== 'sep' && g.id !== 'cursors' && g.sections?.some(([, ids]) => ids.some(id => (TOOL_TYPE[id] || id) === tool)));

  function iconFor(g) {
    if (g.emoji) return `<span style="font-size:18px;font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif">${st.emoji}</span>`;
    if (g.id === 'lock') return svg(drawings.lockAll ? ICONS.lockon : ICONS.lock);
    if (g.id === 'hide') return svg(st.hideOn ? ICONS.eyeoff : ICONS.eye);
    if (g.sections) return svg(ICONS[current[g.id]]);
    return svg(ICONS[g.id]);
  }

  function render() {
    const tool = drawings.tool;
    for (const g of GROUPS) {
      if (g === 'sep') continue;
      const btn = root.querySelector(`[data-main="${g.id}"]`);
      btn.innerHTML = iconFor(g);
      let active = false;
      if (g.id === 'cursors') active = tool === 'cursor' || tool === 'eraser';
      else if (g.sections) active = groupOf(tool) === g;
      else if (g.emoji) active = tool === 'emoji';
      else if (g.single) active = tool === g.id;
      btn.classList.toggle('active', active);
      const on = g.id === 'magnet' ? drawings.magnet !== 'off' : g.id === 'stay' ? drawings.stayInDrawing : g.id === 'lock' ? drawings.lockAll : g.id === 'hide' ? !!st.hideOn : false;
      btn.classList.toggle('toggled', on);
      if (g.sections) btn.title = nameOf(current[g.id]);
    }
    root.querySelectorAll('.lt-arrow').forEach(a => a.classList.toggle('open', a.dataset.arrow === openGroup));
    onSaveState?.({ current, emoji: st.emoji });
  }

  function activate(id) {
    const type = TOOL_TYPE[id] || id;
    if (['cross', 'dot', 'arrow'].includes(id)) { onCursorMode(id); drawings.setTool('cursor'); }
    else drawings.setTool(type);
    render();
  }

  function closeFlyout() { flyout.classList.remove('open'); openGroup = null; render(); }

  function openFlyout(g, anchor) {
    openGroup = g.id;
    let html = '';
    if (g.sections) {
      for (const [sec, ids] of g.sections) {
        if (sec) html += `<div class="fo-sec">${sec}</div>`;
        for (const id of ids) {
          const activeTool = (id === 'cross' || id === 'dot' || id === 'arrow') ? false : (TOOL_TYPE[id] || id) === drawings.tool;
          html += `<button class="fo-item ${current[g.id] === id || activeTool ? 'active' : ''}" data-tool="${id}"><span class="fo-ic">${svg(ICONS[id])}</span>${nameOf(id)}${KEYS[id] ? `<span class="fo-key">${KEYS[id]}</span>` : ''}</button>`;
        }
      }
    } else if (g.emoji) {
      html = `<div class="fo-sec">表情符號</div><div class="emoji-grid">${EMOJIS.map(e => `<button data-emoji="${e}">${e}</button>`).join('')}</div>`;
    } else if (g.menu) {
      const count = g.id === 'trash' ? { drawings: drawings.list.length } : {};
      html = g.menu.map(([k, label]) => {
        const on = g.id === 'magnet' ? drawings.magnet === k : g.id === 'hide' ? st.hideOn === k : false;
        const extra = g.id === 'trash' && k === 'drawings' ? ` (${count.drawings})` : '';
        return `<button class="fo-item ${on ? 'active' : ''}" data-menu="${k}"><span class="fo-ic">${svg(ICONS[g.id === 'hide' ? 'eyeoff' : g.id])}</span>${label}${extra}</button>`;
      }).join('');
    }
    flyout.innerHTML = html;
    const r = anchor.getBoundingClientRect();
    flyout.classList.add('open');
    flyout.style.left = `${r.right + 6}px`;
    flyout.style.top = `${Math.min(r.top, window.innerHeight - flyout.offsetHeight - 8)}px`;
    flyout.onclick = e => {
      const t = e.target.closest('[data-tool],[data-emoji],[data-menu]');
      if (!t) return;
      if (t.dataset.tool) { current[g.id] = t.dataset.tool; activate(t.dataset.tool); }
      else if (t.dataset.emoji) { st.emoji = drawings.emoji = t.dataset.emoji; activate('emoji'); }
      else if (g.id === 'magnet') { st.magnet = t.dataset.menu; drawings.magnet = drawings.magnet === st.magnet ? 'off' : st.magnet; }
      else if (g.id === 'hide') { st.hideOn = st.hideOn === t.dataset.menu ? null : t.dataset.menu; onHide(st.hideOn); }
      else if (g.id === 'trash') onRemove(t.dataset.menu);
      closeFlyout();
    };
    render();
  }

  root.addEventListener('click', e => {
    const arrow = e.target.closest('[data-arrow]');
    const main = e.target.closest('[data-main]');
    const g = GROUPS.find(x => x !== 'sep' && x.id === (arrow?.dataset.arrow || main?.dataset.main));
    if (!g) return;
    e.stopPropagation();
    if (arrow || g.menuOnly) {
      if (openGroup === g.id) closeFlyout(); else openFlyout(g, root.querySelector(`[data-g="${g.id}"]`));
      return;
    }
    closeFlyout();
    if (g.sections) activate(current[g.id]);
    else if (g.emoji) activate('emoji');
    else if (g.single) activate(drawings.tool === g.id ? 'cross' : g.id);
    else if (g.id === 'magnet') drawings.magnet = drawings.magnet === 'off' ? st.magnet : 'off';
    else if (g.id === 'stay') drawings.stayInDrawing = !drawings.stayInDrawing;
    else if (g.id === 'lock') drawings.lockAll = !drawings.lockAll;
    else if (g.id === 'hide') { st.hideOn = st.hideOn ? null : st.hide; onHide(st.hideOn); }
    render();
  });
  document.addEventListener('pointerdown', e => {
    if (openGroup && !flyout.contains(e.target) && !e.target.closest('#lefttools')) closeFlyout();
  });

  // 快捷鍵
  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    const map = e.shiftKey ? { r: 'rect', t: 'text' } : { t: 'trend', h: 'hline', j: 'hray', v: 'vline', c: 'crossline', f: 'fib' };
    const id = map[k];
    if (!id) return;
    e.preventDefault();
    const g = groupOf(TOOL_TYPE[id] || id);
    if (g) current[g.id] = id;
    activate(id);
  });

  render();
  return { render, activate, cursorReset: () => activate(current.cursors === 'eraser' ? 'cross' : current.cursors) };
}

const svg = inner => `<svg viewBox="0 0 28 28" width="28" height="28">${inner}</svg>`;
