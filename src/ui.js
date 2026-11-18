// DOM side of the app: control panels, inspector, link matrix, alerts, KPIs,
// tooltip, toasts, scene annotations and the guided tour.

import { NET, LINK_GBPS, IB_GBPS, ETH_GBPS, SHELF_KW } from './config.js';
import { N_GPU, N_NVSW, N_LINK, COMPUTE_SLOTS, gpuName, swName, gpuSlot, gpuNN, swSlot, swK, linkGpu, linkSw, slotName, PORT_DIM, LEADER_SLOT } from './topology.js';
import { PATTERNS, SCENARIOS, GPU_GBPS } from './sim.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = new Intl.NumberFormat('en-US');
export const fmtRate = (gbps) => (gbps >= 999.5 ? `${(gbps / 1000).toFixed(gbps >= 99950 ? 0 : 1)} Tb/s` : gbps >= 1 ? `${gbps.toFixed(gbps >= 100 ? 0 : 1)} Gb/s` : `${(gbps * 1000).toFixed(0)} Mb/s`);
const fmtBytes = (b) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
  return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const pct = (x) => `${Math.round(x * 100)}%`;

// same ramp as the ribbon shader's heat mode, in display space
const RAMP = [[0, [22, 50, 66]], [0.5, [28, 140, 104]], [1, [150, 255, 205]]];
export function heatCss(x) {
  x = Math.max(0, Math.min(1, x));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [x0, a] = RAMP[i - 1], [x1, b] = RAMP[i];
      const t = (x - x0) / (x1 - x0);
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    }
  }
  return 'rgb(150,255,205)';
}

const NET_CSS = { nv: 'var(--nv)', ib: 'var(--ib)', eth: 'var(--eth)', oob: 'var(--oob)', pwr: 'var(--pwr)', liq: 'var(--liq)' };

function shapeIcon(kind) {
  // miniature of the 72 x 18 matrix with the fault's footprint in red
  const cols = 6, rows = 8, cw = 4, ch = 2.6, gx = 1, gy = 1;
  let s = '<svg viewBox="0 0 30 30" aria-hidden="true">';
  const hit = (r, c) => {
    switch (kind) {
      case 'link': return r === 3 && c === 2;
      case 'gpu': return r === 3;
      case 'tray': return r >= 2 && r <= 5;
      case 'nvsw': return c === 2;
      case 'swtray': return c === 2 || c === 3;
      case 'cart': return r % 4 === 1;
      default: return false;
    }
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let fill = hit(r, c) ? '#ff7a62' : '#2b4353';
    if (kind === 'telemetry') fill = (r + c) % 2 ? '#3a4652' : '#26323c';
    if (kind === 'ber' && r === 3 && c === 2) fill = '#f2b23e';
    s += `<rect x="${0.5 + c * (cw + gx)}" y="${0.9 + r * (ch + gy)}" width="${cw}" height="${ch}" rx="0.6" fill="${fill}"/>`;
  }
  return s + '</svg>';
}

const FAULTS = [
  { k: 'link', t: '单条链路', d: '背板线对 · 1 格' },
  { k: 'gpu', t: 'GPU 复位', d: '1 行 · 18 条' },
  { k: 'tray', t: '计算托盘离线', d: '4 行 · 72 条' },
  { k: 'nvsw', t: '单颗 NVSwitch', d: '1 列 · 72 条' },
  { k: 'swtray', t: '交换托盘', d: '2 列 · 144 条' },
  { k: 'cart', t: '线缆背板', d: '每托盘 1 行 · 324 条' },
  { k: 'ber', t: '链路误码', d: '质量劣化，不断链' },
  { k: 'telemetry', t: '采集中断', d: '矩阵整片无数据' },
];

const VIEWS = [['overview', '总览'], ['front', '正面'], ['rear', '后部'], ['side', '侧面'], ['inside', '内部']];
const TABS = [['traffic', '流量'], ['fault', '故障'], ['cabling', '接线'], ['inspect', '检视'], ['matrix', '矩阵'], ['alerts', '告警']];

export function createUI(app) {
  const { model, sim } = app;
  const ui = {};

  // ---- top bar ---------------------------------------------------------------
  $('views').innerHTML = VIEWS.map(([k, t], i) => `<button data-view="${k}" title="视角 ${i + 1}">${t}</button>`).join('');
  $('views').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) app.setView(b.dataset.view);
  });
  $('t-xray').onclick = () => app.setXray(!app.xray);
  $('t-labels').onclick = () => app.setLabels(!app.labelsOn);
  $('t-pause').onclick = () => app.setPaused(!app.paused);
  $('t-tour').onclick = () => (app.tour.active ? app.tour.stop() : app.tour.start());
  $('t-help').onclick = () => $('about').showModal();
  $('about-close').onclick = () => $('about').close();
  $('about').addEventListener('click', (e) => { if (e.target === $('about')) $('about').close(); });

  ui.syncToggles = () => {
    $('t-xray').setAttribute('aria-pressed', app.xray);
    $('t-labels').setAttribute('aria-pressed', app.labelsOn);
    $('t-pause').setAttribute('aria-pressed', app.paused);
    $('t-pause').textContent = app.paused ? '▶' : '❙❙';
    for (const b of $('views').children) b.setAttribute('aria-pressed', b.dataset.view === app.view);
  };

  // ---- traffic ---------------------------------------------------------------
  $('traffic').innerHTML = `
    <div><div class="lbl" style="margin-bottom:5px"><span>场景</span></div>
      <div class="chips" id="scen">${Object.entries(SCENARIOS).map(([k, s]) => `<button class="chip" data-scen="${k}">${s.label}</button>`).join('')}</div></div>
    <div><div class="lbl" style="margin-bottom:5px"><span>NVLink 流量形态</span></div>
      <div class="seg wrap" id="pat">${Object.entries(PATTERNS).map(([k, p]) => `<button data-pat="${k}" title="${esc(p.hint)}">${p.label}</button>`).join('')}</div>
      <p class="hint" id="pat-hint" style="margin-top:6px"></p></div>
    <div><div class="lbl"><span>Scale-up · NVLink 强度</span><b id="v-nv"></b></div><input type="range" id="s-nv" min="0" max="100" step="1" style="--c:var(--nv)" aria-label="NVLink 强度"></div>
    <div><div class="lbl"><span>Scale-out · InfiniBand</span><b id="v-ib"></b></div><input type="range" id="s-ib" min="0" max="100" step="1" style="--c:var(--ib)" aria-label="InfiniBand 强度"></div>
    <div><div class="lbl"><span>Scale-in · 以太网</span><b id="v-eth"></b></div><input type="range" id="s-eth" min="0" max="100" step="1" style="--c:var(--eth)" aria-label="以太网强度"></div>
    <label class="check"><input type="checkbox" id="c-burst">训练步进：梯度同步时成簇发送</label>
    <label class="check"><input type="checkbox" id="c-heat">按利用率给线缆着色</label>
    <div><div class="lbl"><span>报文动画速度</span><b id="v-speed"></b></div><input type="range" id="s-speed" min="10" max="250" step="5" style="--c:#8fa0ad" aria-label="动画速度"></div>`;
  const bindRange = (id, get, set, fmt) => {
    const el = $(id);
    const sync = () => {
      el.value = get();
      el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
      $(id.replace('s-', 'v-')).textContent = fmt(+el.value);
    };
    el.addEventListener('input', () => { set(+el.value); sync(); });
    return sync;
  };
  const syncNv = bindRange('s-nv', () => Math.round(sim.intensity * 100), (v) => { sim.set('intensity', v / 100); sim.scenario = null; ui.syncTraffic(); }, (v) => `${v}%`);
  const syncIb = bindRange('s-ib', () => Math.round(sim.scaleOut * 100), (v) => { sim.scaleOut = v / 100; sim.scenario = null; ui.syncTraffic(); }, (v) => `${v}%`);
  const syncEth = bindRange('s-eth', () => Math.round(sim.scaleIn * 100), (v) => { sim.scaleIn = v / 100; sim.scenario = null; ui.syncTraffic(); }, (v) => `${v}%`);
  const syncSpeed = bindRange('s-speed', () => Math.round(app.speed * 100), (v) => { app.speed = v / 100; }, (v) => `${(v / 100).toFixed(2)}×`);
  $('scen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scen]');
    if (!b) return;
    sim.applyScenario(b.dataset.scen);
    ui.syncTraffic();
  });
  $('pat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pat]');
    if (!b) return;
    app.setPattern(b.dataset.pat);
  });
  $('c-burst').onchange = (e) => { sim.burst = e.target.checked; sim.dirty = true; };
  $('c-heat').onchange = (e) => app.setHeat(e.target.checked);
  ui.syncTraffic = () => {
    syncNv(); syncIb(); syncEth(); syncSpeed();
    for (const b of $('scen').children) b.setAttribute('aria-pressed', b.dataset.scen === sim.scenario);
    for (const b of $('pat').children) b.setAttribute('aria-pressed', b.dataset.pat === sim.pattern);
    let hint = PATTERNS[sim.pattern].hint;
    if (sim.pattern === 'pair') hint += `：${gpuName(sim.pairA)} ⇄ ${gpuName(sim.pairB)}。选中 GPU 后可在检视面板里改端点`;
    if (sim.pattern === 'incast') hint += `：目标 ${gpuName(sim.incastTarget)}`;
    $('pat-hint').textContent = hint;
    $('c-burst').checked = sim.burst;
    $('c-heat').checked = app.heat;
  };

  // ---- faults ----------------------------------------------------------------
  $('fault').innerHTML = `
    <p class="hint">每块 GPU 到每颗 NVSwitch 恰好 1 条链路，所以断链在矩阵里的形状直接指向故障部件。先选中一个部件再点，故障就落在它上面。</p>
    <div class="faults">${FAULTS.map((f) => `<button class="fault" data-fault="${f.k}">${shapeIcon(f.k)}<div><b>${f.t}</b><span>${f.d}</span></div></button>`).join('')}</div>
    <button class="btn ok" id="f-clear">全部恢复</button>`;
  $('fault').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fault]');
    if (b) app.inject(b.dataset.fault);
  });
  $('f-clear').onclick = () => app.clearFaults();

  // ---- cabling ---------------------------------------------------------------
  $('cabling').innerHTML = `
    <div class="kv" id="cab-kv"></div>
    <div class="row"><button class="btn warn" id="cab-unplug">全部拔掉</button><button class="btn ok" id="cab-auto">自动接线</button></div>
    <button class="btn" id="cab-asm">重放装配动画</button>
    <p class="hint">按住插头拖动即可拔出，拖到同型空端口附近松手插入。线缆长度有限，够不着的端口插不上；插错端口链路能起来，但会被判为与规划不符。</p>`;
  $('cab-unplug').onclick = () => app.unplugAll();
  $('cab-auto').onclick = () => app.autoWire();
  $('cab-asm').onclick = () => app.assemble();
  ui.syncCabling = () => {
    const s = app.cabling.summary();
    const by = { ib: [0, 0], eth: [0, 0], oob: [0, 0] };
    for (const c of model.cables) {
      by[c.net][1]++;
      if (app.cabling.linkState(c) === 2) by[c.net][0]++;
    }
    $('cab-n').textContent = `${s.ok}/${s.total}`;
    $('cab-kv').innerHTML = [['ib', 'InfiniBand · OSFP 400G'], ['eth', '以太网 · QSFP112'], ['oob', '带外 · RJ45 1GbE']].map(([k, t]) => `<dt><span style="color:${NET_CSS[k]}">●</span> ${t}</dt><dd class="mono">${by[k][0]} / ${by[k][1]}</dd>`).join('') +
      `<dt>与规划不符</dt><dd><span class="st ${s.wrong.length ? 'warn' : 'ok'}">${s.wrong.length} 根</span></dd><dt>悬空未接</dt><dd><span class="st ${s.open.length ? 'bad' : 'ok'}">${s.open.length} 根</span></dd>`;
  };

  // ---- layers ----------------------------------------------------------------
  $('layers').innerHTML = `<div class="chips">${Object.values(NET).map((n) => `<button class="chip layer" data-layer="${n.key}" aria-pressed="true" style="--c:${n.css}" title="${n.sub}"><i></i>${n.label}</button>`).join('')}</div>`;
  $('layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on);
    app.setLayer(b.dataset.layer, on);
  });
  ui.syncLayers = () => {
    for (const b of $('layers').querySelectorAll('[data-layer]')) b.setAttribute('aria-pressed', !!app.layers[b.dataset.layer]);
  };

  // ---- KPIs ------------------------------------------------------------------
  const KP = [
    ['nv', 'NVLink 吞吐', NET_CSS.nv, true, ''],
    ['links', 'NVLink 链路', '#6fd3a3', false, ''],
    ['gpus', 'GPU 在域', '#6fd3a3', false, 'opt'],
    ['ib', 'InfiniBand', NET_CSS.ib, false, 'opt'],
    ['eth', '以太网', NET_CSS.eth, false, 'opt'],
    ['pwr', '整柜功耗', NET_CSS.pwr, true, ''],
    ['liq', '液冷 供 → 回', NET_CSS.liq, false, 'opt'],
  ];
  $('kpis').innerHTML = KP.map(([k, t, c, m, cls]) => `<div class="kpi ${cls}" style="--c:${c}"><div class="k"><i></i>${t}</div><div class="v" id="k-${k}"></div>${m ? `<div class="meter"><i id="m-${k}"></i></div>` : ''}</div>`).join('');
  ui.syncKpis = () => {
    const st = sim.stats;
    $('k-nv').innerHTML = `${(st.nvGbps / 1000).toFixed(1)}<small>/ ${(N_LINK * LINK_GBPS / 1000).toFixed(1)} Tb/s</small>`;
    $('m-nv').style.width = `${Math.min(100, (st.nvGbps / (N_LINK * LINK_GBPS)) * 100)}%`;
    $('k-links').innerHTML = `${nf.format(st.linksUp)}<small>/ 1,296</small>`;
    $('k-links').style.color = st.linksUp < N_LINK ? 'var(--bad)' : '';
    $('k-gpus').innerHTML = `${st.gpus}<small>/ 72</small>`;
    $('k-gpus').style.color = st.gpus < N_GPU ? 'var(--bad)' : '';
    $('k-ib').innerHTML = `${(st.ibGbps / 1000).toFixed(1)}<small>Tb/s</small>`;
    $('k-eth').innerHTML = `${(st.ethGbps / 1000).toFixed(1)}<small>Tb/s</small>`;
    $('k-pwr').innerHTML = `${st.powerKW.toFixed(0)}<small>/ ${st.capKW} kW</small>`;
    $('m-pwr').style.width = `${st.capKW ? Math.min(100, (st.powerKW / st.capKW) * 100) : 100}%`;
    $('m-pwr').style.background = st.cap < 0.999 ? 'var(--bad)' : '';
    $('k-liq').innerHTML = `${st.supplyC.toFixed(0)} → ${st.returnC.toFixed(0)}<small>°C</small>`;
  };

  // ---- tabs (narrow screens) -------------------------------------------------
  $('tabs').innerHTML = TABS.map(([k, t]) => `<button data-tab="${k}" aria-pressed="false">${t}</button>`).join('');
  ui.setTab = (k) => {
    document.body.dataset.tab = k || '';
    for (const b of $('tabs').children) b.setAttribute('aria-pressed', b.dataset.tab === k);
    app.onLayout(true);
  };
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) ui.setTab(document.body.dataset.tab === b.dataset.tab ? '' : b.dataset.tab);
  });
  ui.isNarrow = () => window.matchMedia('(max-width: 860px)').matches;

  // ---- tooltip ---------------------------------------------------------------
  const tip = $('tooltip');
  ui.tooltip = (h, x, y) => {
    if (!h) { tip.classList.remove('on'); return; }
    const d = brief(app, h);
    if (!d) { tip.classList.remove('on'); return; }
    tip.style.setProperty('--c', d.color || 'var(--acc)');
    tip.innerHTML = `<em>${esc(d.kick)}</em><b class="${d.zh ? 'zh' : ''}">${esc(d.title)}</b>${d.lines.map((l) => `<span>${l}</span>`).join('')}`;
    tip.classList.add('on');
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    let tx = x + 16, ty = y + 18;
    if (tx + w > window.innerWidth - 8) tx = x - w - 14;
    if (ty + hh > window.innerHeight - 8) ty = y - hh - 12;
    tip.style.left = `${Math.max(8, tx)}px`;
    tip.style.top = `${Math.max(8, ty)}px`;
  };

  // ---- toasts ----------------------------------------------------------------
  ui.toast = (title, text, cls = 'crit') => {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.innerHTML = `<b>${esc(title)}</b>${esc(text || '')}`;
    $('log').appendChild(el);
    while ($('log').children.length > 3) $('log').firstChild.remove();
    setTimeout(() => el.remove(), 4300);
  };

  // ---- alerts ----------------------------------------------------------------
  let alertSig = '';
  ui.syncAlerts = () => {
    const a = sim.alerts;
    const sig = a.map((x) => x.key + x.title + x.detail).join('|');
    if (sig === alertSig) return;
    alertSig = sig;
    $('al-n').textContent = a.length ? String(a.length) : '';
    $('al-n').style.color = a.some((x) => x.sev === 'crit') ? 'var(--bad)' : a.length ? 'var(--warn)' : '';
    $('alerts').innerHTML = a.length ? a.map((x, i) => `<button class="alert ${x.sev}" data-al="${i}"><i></i><div><b>${esc(x.title)}</b><span>${esc(x.detail)}</span></div></button>`).join('') : '<div class="empty">四张网均无异常。</div>';
    const tb = $('tabs').querySelector('[data-tab="alerts"]');
    tb.innerHTML = `告警${a.length ? `<em>${a.length}</em>` : ''}`;
  };
  $('alerts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-al]');
    if (!b) return;
    const a = sim.alerts[+b.dataset.al];
    if (a && a.focus) app.select(a.focus, { focus: true });
  });

  // ---- inspector -------------------------------------------------------------
  const insp = $('inspect');
  let live = null;
  ui.renderInspector = () => {
    const m = inspector(app, app.selection);
    $('insp-n').textContent = m.tag || '';
    insp.style.setProperty('--c', m.color || 'var(--acc)');
    insp.innerHTML = `<div><div class="kick">${esc(m.kick)}</div><h2 class="${m.zh ? 'zh' : ''}">${esc(m.title)}</h2></div>${m.html}`;
    live = m.live || null;
    ui.syncInspector();
  };
  ui.syncInspector = () => {
    if (!live) return;
    const v = live();
    for (const el of insp.querySelectorAll('[data-live]')) {
      const val = v[el.dataset.live];
      if (val !== undefined && el.innerHTML !== val) el.innerHTML = val;
    }
    if (v.strip) {
      const cells = insp.querySelectorAll('.ports button');
      for (let i = 0; i < cells.length; i++) cells[i].style.background = v.strip(i);
    }
    if (v.meters) for (const [k, w] of Object.entries(v.meters)) {
      const el = insp.querySelector(`[data-meter="${k}"]`);
      if (el) el.style.width = `${Math.max(0, Math.min(100, w * 100))}%`;
    }
  };
  insp.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sel]');
    if (s) {
      const [type, id] = s.dataset.sel.split(':');
      app.select({ type, id: isNaN(+id) ? id : +id }, { focus: s.dataset.focus === '1' });
      return;
    }
    const a = e.target.closest('[data-act]');
    if (a) app.act(a.dataset.act, a.dataset.arg);
  });

  // ---- link matrix -----------------------------------------------------------
  const cv = $('matrix');
  const ctx = cv.getContext('2d');
  const MX = { left: 58, top: 46, cw: 29.5, ch: 8.6, gapTray: 2.4, gapGroup: 12 };
  const rowOrder = []; // display row -> gpu
  const rowY = [];
  {
    const slots = [...COMPUTE_SLOTS].sort((a, b) => b - a);
    let y = MX.top;
    slots.forEach((slot, i) => {
      if (slot === 8) y += MX.gapGroup;
      const t = COMPUTE_SLOTS.indexOf(slot);
      for (let nn = 0; nn < 4; nn++) {
        rowOrder.push(t * 4 + nn);
        rowY.push(y);
        y += MX.ch;
      }
      y += MX.gapTray;
      void i;
    });
    MX.bottom = y;
  }
  const colX = (s) => MX.left + s * MX.cw + (s >> 1) * 1.2;
  let mxHover = null;
  ui.drawMatrix = () => {
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    // column heads
    ctx.textAlign = 'center';
    for (let j = 0; j < 9; j++) {
      const x = colX(j * 2) + MX.cw;
      const sw = model.switches[j];
      ctx.fillStyle = !sw.seated || sw.fault ? '#ff7a62' : '#6fd3a3';
      ctx.fillText(String(9 + j), x, 14);
      ctx.fillStyle = '#5d7080';
      ctx.fillRect(colX(j * 2) + 2, 26, MX.cw * 2 - 4, 1.5);
    }
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8fa0ad';
    for (let s = 0; s < N_NVSW; s++) ctx.fillText(s & 1 ? '02' : '01', colX(s) + MX.cw / 2, 36);
    // row heads
    ctx.textAlign = 'right';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    for (let r = 0; r < 72; r += 4) {
      const g = rowOrder[r];
      const tray = model.compute[g >> 2];
      ctx.fillStyle = !tray.seated || tray.fault ? '#ff7a62' : '#c9d4dc';
      ctx.fillText(String(tray.slot).padStart(2, '0'), MX.left - 12, rowY[r] + MX.ch * 2);
      ctx.fillStyle = '#5d7080';
      ctx.fillRect(MX.left - 7, rowY[r] + 1, 1.5, MX.ch * 4 - 2);
    }
    const nodata = !sim.telemetryOk;
    const sel = app.selection;
    for (let r = 0; r < 72; r++) {
      const g = rowOrder[r];
      for (let s = 0; s < N_NVSW; s++) {
        const l = g * N_NVSW + s;
        const st = model.linkState[l];
        let col;
        if (nodata) col = (r + s) % 2 ? '#3a4652' : '#303b46';
        else if (st === 0) col = '#e5533a';
        else if (st === 1) col = '#f2b23e';
        else col = heatCss(Math.max(sim.tx[l], sim.rx[l]));
        ctx.fillStyle = col;
        ctx.fillRect(colX(s), rowY[r], MX.cw - 1.6, MX.ch - 1.4);
        if (!nodata && st === 2 && model.linkFault[l] === 2) {
          ctx.fillStyle = '#f2b23e';
          ctx.fillRect(colX(s) + MX.cw / 2 - 3, rowY[r] + 1.2, 5, MX.ch - 3.8);
        }
      }
    }
    // selection outlines
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f2f5f3';
    const outlineRow = (g, n = 1) => {
      const r = rowOrder.indexOf(g);
      ctx.strokeRect(colX(0) - 2, rowY[r] - 1.5, colX(17) + MX.cw - colX(0) + 2.4, MX.ch * n + (n > 1 ? 0 : 0) + 1.6);
    };
    const outlineCol = (s, n = 1) => ctx.strokeRect(colX(s) - 1.5, MX.top - 2, MX.cw * n + (n > 1 ? 1.2 : 0) + 1.4, MX.bottom - MX.top + 1);
    if (sel) {
      if (sel.type === 'gpu') outlineRow(sel.id);
      else if (sel.type === 'nvsw') outlineCol(sel.id);
      else if (sel.type === 'link') {
        const r = rowOrder.indexOf(linkGpu(sel.id));
        ctx.strokeRect(colX(linkSw(sel.id)) - 1.5, rowY[r] - 1.5, MX.cw + 1.4, MX.ch + 1.6);
      } else if (sel.type === 'unit') {
        const u = model.unitById.get(sel.id);
        if (u && u.kind === 'compute') outlineRow(u.trayIndex * 4, 4);
        if (u && u.kind === 'switch') outlineCol(u.swTray * 2, 2);
      }
    }
    if (mxHover) {
      ctx.strokeStyle = 'rgba(242,245,243,0.75)';
      ctx.lineWidth = 1.5;
      const r = rowOrder.indexOf(mxHover.g);
      ctx.strokeRect(colX(mxHover.s) - 1, rowY[r] - 1, MX.cw + 0.4, MX.ch + 0.6);
    }
    // shape read-out
    const sh = sim.shape();
    $('mx-n').textContent = sh.down ? `${nf.format(N_LINK - sh.down)} / 1,296` : '';
    $('mx-n').style.color = sh.down ? 'var(--bad)' : '';
    let txt;
    if (nodata) txt = '整片无数据：采集中断，不代表链路故障。先恢复 NMX-T / exporter，再对链路下结论。';
    else if (!sh.down) txt = '行是 72 块 GPU（按计算托盘 slot 分组），列是 18 颗 NVSwitch（按交换托盘 slot 分组）。全部 1,296 条链路在线。';
    else {
      const parts = [];
      if (sh.swTrays.length) parts.push(`${sh.swTrays.length * 2} 列 → 交换托盘 ${sh.swTrays.map((j) => slotName(9 + j)).join('、')}`);
      const lone = sh.cols.filter((s) => !sh.swTrays.includes(s >> 1));
      if (lone.length) parts.push(`${lone.length} 列 → NVSwitch ${lone.map(swName).join('、')}`);
      if (sh.trays.length) parts.push(`${sh.trays.length * 4} 行 → 计算托盘 ${sh.trays.map((t) => slotName(COMPUTE_SLOTS[t])).join('、')}`);
      const loneR = sh.rows.filter((g) => !sh.trays.includes(g >> 2));
      if (loneR.length) parts.push(loneR.length > 4 ? `${loneR.length} 行 → 各托盘同号 GPU（线缆背板）` : `${loneR.length} 行 → GPU ${loneR.map(gpuName).join('、')}`);
      if (sh.cells) parts.push(`${sh.cells} 个单格 → 背板线对或连接器`);
      txt = `断开 ${nf.format(sh.down)} 条。形状：${parts.join('；')}。`;
    }
    if ($('mx-shape').textContent !== txt) $('mx-shape').textContent = txt;
  };
  const mxAt = (e) => {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * cv.width, y = ((e.clientY - r.top) / r.height) * cv.height;
    let row = -1;
    for (let i = 0; i < 72; i++) if (y >= rowY[i] - 1 && y < rowY[i] + MX.ch) { row = i; break; }
    let s = -1;
    for (let i = 0; i < N_NVSW; i++) if (x >= colX(i) - 1 && x < colX(i) + MX.cw) { s = i; break; }
    if (row >= 0 && s >= 0) return { type: 'link', id: rowOrder[row] * N_NVSW + s, g: rowOrder[row], s };
    if (row >= 0 && x < MX.left) return { type: 'unit', id: model.compute[rowOrder[row] >> 2].id };
    if (s >= 0 && y < MX.top) return { type: 'unit', id: model.switches[s >> 1].id };
    return null;
  };
  cv.addEventListener('pointermove', (e) => {
    const h = mxAt(e);
    mxHover = h && h.type === 'link' ? h : null;
    app.onHover(h && h.type === 'link' ? { type: 'link', id: h.id } : null);
    ui.tooltip(h ? (h.type === 'link' ? { type: 'link', id: h.id } : { type: 'unit', unit: model.unitById.get(h.id) }) : null, e.clientX, e.clientY);
    ui.drawMatrix();
  });
  cv.addEventListener('pointerleave', () => { mxHover = null; app.onHover(null); ui.tooltip(null); ui.drawMatrix(); });
  cv.addEventListener('click', (e) => {
    const h = mxAt(e);
    if (h) app.select({ type: h.type, id: h.id }, { reveal: true });
  });

  // ---- scene annotations -----------------------------------------------------
  const labelEls = [];
  ui.setLabelDefs = (defs) => {
    $('labels').innerHTML = '';
    labelEls.length = 0;
    for (const d of defs) {
      const el = document.createElement('div');
      el.className = `tag${d.right ? ' r' : ''}`;
      el.style.setProperty('--c', d.color || 'var(--acc)');
      el.innerHTML = `<b>${esc(d.text)}</b>${d.sub ? `<span>${esc(d.sub)}</span>` : ''}`;
      el.style.opacity = 0;
      $('labels').appendChild(el);
      labelEls.push({ el, d });
    }
  };
  ui.placeLabels = (project, camZ, on) => {
    for (const { el, d } of labelEls) {
      let vis = on;
      if (vis && d.face === 'front' && camZ < 0.25) vis = false;
      if (vis && d.face === 'rear' && camZ > -0.25) vis = false;
      const p = vis ? project(d.pos) : null;
      if (!p) { if (el.style.opacity !== '0') el.style.opacity = 0; continue; }
      el.style.opacity = 1;
      el.style.transform = d.right ? `translate(${(p.x - 12).toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-100%, -50%)` : `translate(${(p.x + 12).toFixed(1)}px, ${p.y.toFixed(1)}px) translate(0, -50%)`;
    }
  };

  // ---- tour ------------------------------------------------------------------
  ui.tour = (step, i, n) => {
    if (!step) { $('tour').hidden = true; $('t-tour').textContent = '导览'; return; }
    $('tour').hidden = false;
    $('t-tour').textContent = '结束导览';
    $('tour-step').textContent = `导览 ${i + 1} / ${n}`;
    $('tour-title').textContent = step.title;
    $('tour-body').textContent = step.body;
    $('tour-dots').innerHTML = Array.from({ length: n }, (_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    $('tour-prev').disabled = i === 0;
    $('tour-next').textContent = i === n - 1 ? '自由探索' : '下一步';
  };
  $('tour-prev').onclick = () => app.tour.prev();
  $('tour-next').onclick = () => app.tour.next();
  $('tour-close').onclick = () => app.tour.stop();

  ui.boot = () => $('boot').classList.add('done');
  return ui;
}

// ---- short description for the hover tooltip --------------------------------
function linkTitle(l) {
  return `${gpuName(linkGpu(l))} p${linkSw(l) + 1} ⇄ ${swName(linkSw(l))} #${linkGpu(l) + 1}`;
}
function linkStateText(app, l) {
  const st = app.model.linkState[l];
  return st === 2 ? '<span class="st ok">Active</span>' : st === 1 ? '<span class="st warn">Training</span>' : '<span class="st bad">Down</span>';
}
function unitState(u) {
  if (!u.seated) return '<span class="st bad">已拉出</span>';
  if (u.fault === 'offline') return '<span class="st bad">离线</span>';
  if (u.fault === 'failed') return '<span class="st bad">故障</span>';
  if (u.leak) return '<span class="st bad">漏液</span>';
  return '<span class="st ok">在位</span>';
}
const cableKind = (c) => (c.type === 'osfp' ? 'OSFP · 400 Gb/s InfiniBand' : c.type === 'qsfp' ? 'QSFP112 · 以太网' : 'RJ45 · 1GbE');
const cableState = (app, c) => {
  const s = app.cabling.linkState(c);
  if (c.state !== 'plugged' && c.state !== 'inserting') return '<span class="st bad">悬空</span>';
  return s === 2 ? '<span class="st ok">Up</span>' : s === 1 ? '<span class="st warn">错接</span>' : '<span class="st bad">Down</span>';
};
const farName = (app, c) => {
  const f = c.far;
  if (f.dev.startsWith('mgmt')) return `管理交换机 ${f.dev.slice(-1)} · swp${f.port}`;
  const d = app.cabling.netDevs.get(f.dev);
  return `${d.name} · 端口 ${f.port}`;
};

function brief(app, h) {
  const { model, sim } = app;
  switch (h.type) {
    case 'unit': {
      const u = h.unit;
      if (u.kind === 'blank') return u.hcm ? { kick: '理线架', title: '水平理线架', zh: true, color: 'var(--oob)', lines: ['带外线缆经此进入管理交换机'] } : null;
      const kick = { compute: '计算托盘 · 1RU', switch: 'NVLink 交换托盘 · 1RU', power: '电源架 · 33 kW', mgmt: '管理交换机' }[u.kind];
      const lines = [];
      if (u.kind === 'compute') lines.push(`4 块 GPU · NVLink ${[0, 1, 2, 3].reduce((a, k) => a + model.gpuLinksUp(u.trayIndex * 4 + k), 0)}/72 · ${(u.kw || 0).toFixed(1)} kW`);
      if (u.kind === 'switch') lines.push(`2 颗 NVSwitch · 端口 ${model.swLinksUp(u.swTray * 2) + model.swLinksUp(u.swTray * 2 + 1)}/144${u.leader ? ' · NMX leader' : ''}`);
      if (u.kind === 'power') lines.push('6 × 5.5 kW，输出约 50 V 直流到汇流排');
      if (u.kind === 'mgmt') lines.push('SN2201 · 48 × 1GbE，承载 BMC 与 NVOS 管理口');
      if (h.latch && app.canPull(u)) lines.push('<kbd>拖动把手</kbd>拉出托盘，后部盲插随之脱开');
      else if (app.canPull(u)) lines.push('单击检视 · 双击拉出 / 推回');
      return { kick, title: u.kind === 'mgmt' ? u.name.split(' · ')[0] : u.id, zh: u.kind === 'mgmt', color: u.kind === 'switch' ? 'var(--nv)' : u.kind === 'power' ? 'var(--pwr)' : 'var(--oob)', lines };
    }
    case 'port': {
      const p = h.port, c = p.cable;
      const lines = [`${h.unit.id} · ${PORT_DIM[p.type].name}`];
      if (c) lines.push(`${cableState(app, c)} ${esc(c.label)}`);
      else if (p.farCable) lines.push(`对端：${esc(p.farCable.label)}`);
      else lines.push(p.net === 'none' ? '参考设计中不接线' : '空端口：可把同型插头拖到这里');
      return { kick: '端口', title: p.label, zh: true, color: NET_CSS[p.net] || 'var(--oob)', lines };
    }
    case 'cable': {
      const c = h.cable;
      const i = c.id;
      const lines = [cableKind(c), `${cableState(app, c)} 对端 ${esc(farName(app, c))}`];
      if (app.cabling.linkState(c) === 2) lines.push(`入 ${pct(sim.cableIn[i])} · 出 ${pct(sim.cableOut[i])}`);
      if (h.plug) lines.push(c.state === 'plugged' ? '<kbd>按住拖动</kbd>拔出插头' : '<kbd>按住拖动</kbd>到同型空端口');
      return { kick: NET[c.net].sub + ' · ' + NET[c.net].label, title: c.label, zh: true, color: NET_CSS[c.net], lines };
    }
    case 'gpu': {
      const g = h.id;
      return { kick: 'GPU', title: gpuName(g), color: 'var(--nv)', lines: [`NVLink ${model.gpuLinksUp(g)}/18 · 发 ${fmtRate(sim.gpuTx[g])} · 收 ${fmtRate(sim.gpuRx[g])}`, `负载 ${pct(sim.gpuLoad[g])} · ${sim.gpuTemp[g].toFixed(0)} °C`] };
    }
    case 'nvsw': {
      const s = h.id;
      return { kick: 'NVSwitch', title: swName(s), color: 'var(--nv)', lines: [`端口 ${model.swLinksUp(s)}/72 · 吞吐 ${fmtRate(sim.swThrough[s] / 2)}`, `${sim.swTemp[s].toFixed(0)} °C`] };
    }
    case 'link': {
      const l = h.id;
      return { kick: 'NVLink 链路 · 400 Gb/s', title: linkTitle(l), color: 'var(--nv)', lines: [`${linkStateText(app, l)} 线缆背板 ${(linkGpu(l) & 3) + 1}`, `发 ${pct(sim.tx[l])} · 收 ${pct(sim.rx[l])}`] };
    }
    case 'cart':
      return { kick: 'NVLink 线缆背板', title: `线缆背板 ${h.id + 1}`, zh: true, color: 'var(--nv)', lines: ['324 条链路 · 1,296 对无源铜缆', model.cart[h.id].seated ? '双击拔出整个背板' : '双击插回'] };
    case 'busbar':
      return { kick: '供电', title: '汇流排', zh: true, color: 'var(--pwr)', lines: ['约 50 V 直流 · 1,400 A', `当前 ${sim.stats.powerKW.toFixed(0)} kW`] };
    case 'manifold':
      return { kick: '液冷', title: h.which === 'supply' ? '供液歧管' : '回液歧管', zh: true, color: h.which === 'supply' ? 'var(--liq)' : '#ff9d8f', lines: [`${(h.which === 'supply' ? sim.stats.supplyC : sim.stats.returnC).toFixed(0)} °C`, '托盘推入即与快接头对接'] };
    case 'netdev': {
      const d = h.dev;
      return { kick: d.net === 'ib' ? 'Scale-out · InfiniBand' : 'Scale-in · 以太网', title: d.name, zh: true, color: NET_CSS[d.net], lines: [d.net === 'ib' ? '每个计算托盘的 ConnectX-7 各接 1 口到 4 台 Leaf' : '每块 BlueField-3 双归到 A、B 两台交换机'] };
    }
    default:
      return null;
  }
}

// ---- inspector content -------------------------------------------------------
function kv(rows) {
  return `<dl class="kv">${rows.map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`).join('')}</dl>`;
}
const L = (k, cls = 'mono') => `<span class="${cls}" data-live="${k}"></span>`;
const btn = (act, label, cls = '', arg = '') => `<button class="btn ${cls}" data-act="${act}" data-arg="${arg}">${label}</button>`;

function inspector(app, sel) {
  const { model, sim, cabling } = app;
  if (!sel) {
    return {
      kick: 'GB200 · 一个机柜即一个 72-GPU 的 NVLink 域', title: 'NVL72 机柜', zh: true,
      html: `<div class="tiles">
        <div class="tile"><b>18</b><span>计算托盘</span></div><div class="tile"><b>9</b><span>NVLink 交换托盘</span></div><div class="tile"><b>72</b><span>GPU</span></div>
        <div class="tile"><b>18</b><span>NVSwitch</span></div><div class="tile"><b>1,296</b><span>NVLink 链路</span></div><div class="tile"><b>120 kW</b><span>整柜功耗</span></div></div>
        ${kv([['每块 GPU', '18 条 × 400 Gb/s = 7.2 Tb/s'], ['每颗 NVSwitch', '72 口，每块 GPU 占 1 口'], ['GPU 之间', '18 条并行路径，各经 1 颗 NVSwitch'], ['线缆背板', '4 个 · 5,184 对无源铜缆']])}
        <p class="note">单击任意部件查看详情。按住前面板的插头拖动可以拔插线缆，拖动托盘两侧的把手可以把托盘拉出机柜。</p>`,
    };
  }
  switch (sel.type) {
    case 'unit': {
      const u = model.unitById.get(sel.id);
      const cs = model.cables.filter((c) => c.home.unit === u);
      const cabRow = () => `${cs.filter((c) => cabling.linkState(c) === 2).length} / ${cs.length}`;
      const pullBtn = app.canPull(u) ? btn('pull', u.pullTarget > 0.02 ? '推回机柜' : '拉出托盘', u.pullTarget > 0.02 ? 'ok' : '') : '';
      const cabBtn = cs.length ? btn('cables', cs.some((c) => c.port !== c.home || c.state !== 'plugged') ? '接回线缆' : '拔掉线缆') : '';
      if (u.kind === 'compute') {
        const gs = [0, 1, 2, 3].map((k) => u.trayIndex * 4 + k);
        return {
          kick: '计算托盘 · 1RU · 2 × Grace CPU + 4 × GPU', title: u.id, tag: `U${u.u}`,
          html: kv([['状态', L('state', '')], ['NVLink 在线', L('links')], ['NVLink 发 / 收', L('rate')], ['功耗', L('kw')], ['前面板线缆', L('cab')]]) +
            `<div class="list">${gs.map((g) => `<button data-sel="gpu:${g}" data-focus="1"><span class="mono">${gpuName(g)}</span><span class="r" data-live="g${g}"></span></button>`).join('')}</div>
            <div class="row">${pullBtn}${cabBtn}${btn('offline', u.fault ? '恢复上电' : '下电离线', u.fault ? 'ok' : 'warn')}</div>
            <p class="note">前面板人工布线：4 × ConnectX-7（InfiniBand）、2 × BlueField-3（以太网，每块双口）、3 个 RJ45 管理口。后部全部盲插：4 个 NVLink 连接器（每块 GPU 18 口）、汇流排、液冷快接头。</p>`,
          live: () => ({
            state: unitState(u), links: `${gs.reduce((a, g) => a + model.gpuLinksUp(g), 0)} / 72`,
            rate: `${fmtRate(gs.reduce((a, g) => a + sim.gpuTx[g], 0))} / ${fmtRate(gs.reduce((a, g) => a + sim.gpuRx[g], 0))}`,
            kw: `${(u.kw || 0).toFixed(1)} kW`, cab: cabRow(),
            ...Object.fromEntries(gs.map((g) => [`g${g}`, `${model.gpuLinksUp(g)}/18 · ${pct(sim.gpuLoad[g])} · ${sim.gpuTemp[g].toFixed(0)} °C`])),
          }),
        };
      }
      if (u.kind === 'switch') {
        const ss = [u.swTray * 2, u.swTray * 2 + 1];
        return {
          kick: `NVLink 交换托盘 · 1RU · 2 × NVSwitch${u.leader ? ' · NMX leader' : ''}`, title: u.id, tag: `U${u.u}`, color: 'var(--nv)',
          html: kv([['状态', L('state', '')], ['端口在线', L('links')], ['吞吐（每方向）', L('rate')], ['功耗', L('kw')], ['管理口线缆', L('cab')]]) +
            `<div class="meter"><i data-meter="thr"></i></div>
            <div class="list">${ss.map((s) => `<button data-sel="nvsw:${s}" data-focus="1"><span class="mono">${swName(s)}</span><span class="r" data-live="s${s}"></span></button>`).join('')}</div>
            <div class="row">${pullBtn}${cabBtn}${btn('swfail', u.fault ? '恢复' : '整托盘故障', u.fault ? 'ok' : 'warn')}</div>
            <p class="note">144 个 NVLink 端口 × 400 Gb/s，合计 57.6 Tb/s。前面板只有管理口：2 个 NVOS 管理口、1 个 BMC、1 个串口。${u.leader ? 'NMX-C 与 NMX-T 只在这个 leader 托盘上运行，全域的拓扑与遥测经它的管理口读出。' : '托盘上没有租户系统，数据全部属于平台侧。'}</p>`,
          live: () => {
            const thr = (sim.swThrough[ss[0]] + sim.swThrough[ss[1]]) / 2;
            return {
              state: unitState(u), links: `${model.swLinksUp(ss[0]) + model.swLinksUp(ss[1])} / 144`, rate: `${fmtRate(thr)} / 57.6 Tb/s`, kw: `${(u.kw || 0).toFixed(2)} kW`, cab: cabRow(),
              ...Object.fromEntries(ss.map((s) => [`s${s}`, `${model.swLinksUp(s)}/72 · ${sim.swTemp[s].toFixed(0)} °C`])),
              meters: { thr: thr / (144 * LINK_GBPS) },
            };
          },
        };
      }
      if (u.kind === 'power') {
        return {
          kick: '电源架 · 6 × 5.5 kW', title: u.name, zh: true, tag: `U${u.u}`, color: 'var(--pwr)',
          html: kv([['状态', L('state', '')], ['额定输出', `${SHELF_KW} kW`], ['当前分担', L('share')], ['全柜可用', L('cap')]]) + `<div class="row">${pullBtn}</div>
            <p class="note">电源架把交流转换成约 50 V 直流，经机柜后部的汇流排送到每个托盘。8 架共 264 kW，对 120 kW 的整柜负载构成 N+N 冗余；拉出超过 4 架后可用功率不足，GPU 会被限功率。</p>`,
          live: () => ({ state: unitState(u), share: u.seated && sim.stats.shelves ? `${(sim.stats.powerKW / sim.stats.shelves).toFixed(1)} kW` : '0 kW', cap: `${sim.stats.capKW} kW（${sim.stats.shelves}/8 架）` }),
        };
      }
      if (u.kind === 'mgmt') {
        const used = model.cables.filter((c) => c.far.dev === u.id);
        return {
          kick: '柜内管理交换机 · 带外 1GbE', title: u.name, zh: true, tag: `U${u.u}`, color: 'var(--oob)',
          html: kv([['端口', '48 × RJ45 1GbE + 4 × QSFP28 上联'], ['已用', `${used.length} / 48`], ['链路 Up', L('up')]]) +
            `<p class="note">托盘的 BMC、BlueField-3 BMC、交换托盘的 NVOS 管理口和电源架控制器都接到这里。Redfish、NMX 的接口与遥测全部走这张网，所以它决定了“带外数据”是否可采。</p>`,
          live: () => ({ up: `${used.filter((c) => cabling.linkState(c) === 2).length} / ${used.length}` }),
        };
      }
      return { kick: '盲板', title: u.hcm ? '水平理线架' : '盲板', zh: true, html: '' };
    }
    case 'gpu': {
      const g = sel.id;
      const tray = model.compute[g >> 2];
      return {
        kick: 'GPU · 18 个 NVLink 端口', title: gpuName(g), color: 'var(--nv)',
        html: kv([['状态', L('state', '')], ['NVLink 在线', L('links')], ['发送 / 接收', L('rate')], ['负载 / 温度', L('load')], ['线缆背板', `背板 ${gpuNN(g)}`], ['NVSwitch 侧端口号', `<span class="mono">#${g + 1}</span> = 4 × ${g >> 2} + ${gpuNN(g)}`]]) +
          `<div><div class="lbl" style="margin-bottom:4px"><span>端口 p1 – p18（每格 1 条链路，去往 18 颗 NVSwitch）</span></div><div class="ports p18">${Array.from({ length: 18 }, (_, s) => `<button data-sel="link:${g * 18 + s}" title="p${s + 1} → ${swName(s)}" aria-label="端口 ${s + 1}"></button>`).join('')}</div></div>
          <div class="list"><button data-sel="unit:${tray.id}"><span class="mono">${tray.id}</span><span class="r">所在计算托盘</span></button></div>
          <div class="row">${btn('gpureset', model.gpuFault[g] ? '恢复 GPU' : '复位 GPU', model.gpuFault[g] ? 'ok' : 'warn')}${btn('pairA', '设为点对点 A')}${btn('pairB', '设为点对点 B')}${btn('incast', '设为汇聚目标')}</div>
          <p class="note">端口 <code>p</code> 去往 <code>slot = 9 + ⌊(p − 1) / 2⌋</code>；奇数口到 <code>swt-01</code>，偶数口到 <code>swt-02</code>。每断开 1 条，这块 GPU 的 NVLink 带宽减少 1/18。</p>`,
        live: () => ({
          state: model.gpuFault[g] ? '<span class="st bad">复位中</span>' : !tray.seated || tray.fault ? '<span class="st bad">托盘离线</span>' : model.gpuLinksUp(g) < 18 ? '<span class="st warn">降级</span>' : '<span class="st ok">Healthy</span>',
          links: `${model.gpuLinksUp(g)} / 18`, rate: `${fmtRate(sim.gpuTx[g])} / ${fmtRate(sim.gpuRx[g])}`, load: `${pct(sim.gpuLoad[g])} · ${sim.gpuTemp[g].toFixed(0)} °C`,
          strip: (i) => cellColor(app, g * 18 + i),
        }),
      };
    }
    case 'nvsw': {
      const s = sel.id;
      const tray = model.switches[s >> 1];
      return {
        kick: 'NVSwitch ASIC · 72 个 NVLink 端口', title: swName(s), color: 'var(--nv)',
        html: kv([['状态', L('state', '')], ['端口在线', L('links')], ['吞吐（每方向）', L('rate')], ['温度', L('temp')], ['对应 GPU 端口', `<span class="mono">p${s + 1}</span>（每块 GPU 的第 ${s + 1} 口）`]]) +
          `<div><div class="lbl" style="margin-bottom:4px"><span>端口 #1 – #72（每 4 口对应 1 个计算托盘）</span></div><div class="ports p72">${Array.from({ length: 72 }, (_, g) => `<button data-sel="link:${g * 18 + s}" title="#${g + 1} → ${gpuName(g)}" aria-label="端口 ${g + 1}" style="${g % 4 === 3 ? 'margin-right:2px' : ''}"></button>`).join('')}</div></div>
          <div class="list"><button data-sel="unit:${tray.id}"><span class="mono">${tray.id}</span><span class="r">所在交换托盘</span></button></div>
          <div class="row">${btn('nvswfail', model.swFault[s] ? '恢复' : '注入故障', model.swFault[s] ? 'ok' : 'warn')}</div>
          <p class="note">端口号 <code>= 4 × tray_index + NN</code>：slot 1–8 对应 tray_index 0–7，slot 18–27 对应 8–17。18 颗 NVSwitch 的端口分配完全相同。</p>`,
        live: () => ({
          state: model.swFault[s] || tray.fault ? '<span class="st bad">故障</span>' : !tray.seated ? '<span class="st bad">托盘已拉出</span>' : '<span class="st ok">Healthy</span>',
          links: `${model.swLinksUp(s)} / 72`, rate: `${fmtRate(sim.swThrough[s] / 2)} / 28.8 Tb/s`, temp: `${sim.swTemp[s].toFixed(0)} °C`,
          strip: (i) => cellColor(app, i * 18 + s),
        }),
      };
    }
    case 'link': {
      const l = sel.id, g = linkGpu(l), s = linkSw(l);
      return {
        kick: 'NVLink 链路 · 400 Gb/s · 4 对差分线', title: linkTitle(l), color: 'var(--nv)',
        html: kv([['状态', L('state', '')], ['发送利用率（GPU → NVSwitch）', L('tx')], ['接收利用率（NVSwitch → GPU）', L('rx')], ['线缆背板', `背板 ${gpuNN(g)}`]]) +
          `<div class="meter"><i data-meter="tx"></i></div><div class="meter" style="--c:#d9ff86"><i data-meter="rx"></i></div>` +
          kv([['PortXmitDataExtended', L('xd')], ['PortRcvDataExtended', L('rd')], ['PortXmitWaitExtended', L('xw')], ['LinkDownedCounterExtended', L('ld')], ['SymbolErrorCounterExtended', L('se')]]) +
          `<div class="list"><button data-sel="gpu:${g}" data-focus="1"><span class="mono">${gpuName(g)}</span><span class="r">GPU 端口 p${s + 1}</span></button><button data-sel="nvsw:${s}" data-focus="1"><span class="mono">${swName(s)}</span><span class="r">NVSwitch 端口 #${g + 1}</span></button></div>
          <div class="row">${btn('linkcut', model.linkFault[l] === 1 ? '恢复链路' : '断开此链路', model.linkFault[l] === 1 ? 'ok' : 'warn')}${btn('linkber', model.linkFault[l] === 2 ? '清除误码' : '注入误码', model.linkFault[l] === 2 ? 'ok' : '')}</div>
          <p class="note">计数器名称与 NMX-T 一致。方向取值：GPU 到 NVSwitch 用 GPU 端口的发送计数。单条断开时优先怀疑背板线对或某一端的连接器。</p>`,
        live: () => ({
          state: linkStateText(app, l) + (model.linkFault[l] === 2 ? ' <span class="st warn">误码</span>' : ''),
          tx: `${pct(sim.tx[l])} · ${fmtRate(sim.tx[l] * LINK_GBPS)}`, rx: `${pct(sim.rx[l])} · ${fmtRate(sim.rx[l] * LINK_GBPS)}`,
          xd: fmtBytes(sim.xmitData[l]), rd: fmtBytes(sim.rcvData[l]), xw: nf.format(Math.round(sim.xmitWait[l])), ld: String(model.linkDowned[l]), se: nf.format(Math.round(sim.symErr[l])),
          meters: { tx: sim.tx[l], rx: sim.rx[l] },
        }),
      };
    }
    case 'cable': {
      const c = model.cables[sel.id];
      const cap = c.net === 'ib' ? IB_GBPS : c.net === 'eth' ? ETH_GBPS : 1;
      return {
        kick: `${NET[c.net].sub} · ${NET[c.net].label}`, title: c.label, zh: true, color: NET_CSS[c.net],
        html: kv([['状态', L('state', '')], ['接口', cableKind(c)], ['规划端口', `<span class="mono">${c.home.unit.id}</span> ${esc(c.home.label)}`], ['当前位置', L('pos', '')], ['对端', esc(farName(app, c))], ['入向 / 出向', L('util')]]) +
          `<div class="row">${btn('cable', c.state === 'plugged' && c.port === c.home ? '拔出' : '插回规划端口', c.state === 'plugged' && c.port === c.home ? 'warn' : 'ok')}</div>
          <p class="note">${c.net === 'ib' ? '后端网络：跨机柜的 GPU 集群通信。每个托盘的 4 个 ConnectX-7 分别接到 4 台 IB Leaf，由 UFM 管理与采集。' : c.net === 'eth' ? '前端网络：存储、带内管理与业务访问。每块 BlueField-3 的两个口分别接到 A、B 两台前端交换机，连线由 LLDP 发现。' : '带外管理网：BMC 与 NVOS 管理口，承载 Redfish 与 NMX 的控制和遥测。采集点都在交换机或 BMC 一侧，不在租户主机内。'}</p>`,
        live: () => ({
          state: cableState(app, c),
          pos: c.port ? `<span class="mono">${c.port.unit.id}</span> ${esc(c.port.label)}` : '悬空',
          util: cabling.linkState(c) === 2 ? `${fmtRate(sim.cableIn[c.id] * cap)} / ${fmtRate(sim.cableOut[c.id] * cap)}` : '—',
        }),
      };
    }
    case 'port': {
      const p = model.ports[sel.id];
      const c = p.cable || p.farCable;
      return {
        kick: `端口 · ${PORT_DIM[p.type].name}`, title: `${p.unit.id} · ${p.label}`, zh: true, color: NET_CSS[p.net] || 'var(--oob)',
        html: kv([['所在设备', `<span class="mono">${p.unit.id}</span>`], ['网络', p.net === 'none' ? '未接线' : `${NET[p.net].sub} · ${NET[p.net].label}`], ['线缆', c ? esc(c.label) : '空']]) +
          (c ? `<div class="list"><button data-sel="cable:${c.id}"><span>${esc(c.label)}</span><span class="r">查看线缆</span></button></div>` : '<p class="note">空端口。把同型插头拖到这里松手即可插入。</p>'),
      };
    }
    case 'cart': {
      const k = sel.id, c = model.cart[k];
      return {
        kick: 'NVLink 线缆背板 · 无源铜缆', title: c.name, zh: true, color: 'var(--nv)',
        html: kv([['状态', L('state', '')], ['承载链路', '324 条 · 1,296 对差分线'], ['在线', L('links')], ['计算托盘侧', `18 个托盘的 gpu-0${k + 1}，各 18 口`], ['交换托盘侧', '9 个托盘，各 36 口']]) +
          `<div class="row">${btn('cart', c.pullTarget > 0.01 ? '插回背板' : '拔出背板', c.pullTarget > 0.01 ? 'ok' : 'warn')}</div>
          <p class="note">4 个背板内共 5,184 对铜缆，现场没有逐根插拔的 NVLink 线缆，可更换单元是背板整体。背板与 GPU 编号的对应是本模型的假设，公开资料没有给出。</p>`,
        live: () => {
          let up = 0;
          for (let g = k; g < N_GPU; g += 4) up += model.gpuLinksUp(g);
          return { state: c.seated ? '<span class="st ok">已对接</span>' : '<span class="st bad">已拔出</span>', links: `${up} / 324` };
        },
      };
    }
    case 'busbar':
      return {
        kick: '供电 · 汇流排', title: '约 50 V 直流汇流排', zh: true, color: 'var(--pwr)',
        html: kv([['额定电流', '1,400 A'], ['整柜负载', L('kw')], ['估算电流', L('amp')], ['电源架', L('sh')]]) +
          `<p class="note">位于机柜后部正中。上下各 4 个电源架从两端向汇流排供电，托盘推入时后部的取电夹直接夹在汇流排上，没有需要人工插拔的电源线。</p>`,
        live: () => ({ kw: `${sim.stats.powerKW.toFixed(1)} kW`, amp: `${nf.format(Math.round((sim.stats.powerKW * 1000) / 50))} A（上下两段各约一半）`, sh: `${sim.stats.shelves} / 8 在位 · ${sim.stats.capKW} kW` }),
      };
    case 'manifold':
      return {
        kick: '液冷 · 歧管', title: sel.id === 'supply' ? '供液歧管' : '回液歧管', zh: true, color: sel.id === 'supply' ? 'var(--liq)' : '#ff9d8f',
        html: kv([['供液温度', L('s')], ['回液温度', L('r')], ['带走热量', L('q')]]) +
          `<p class="note">CPU、GPU、NVSwitch 由冷板液冷，其余部件风冷。两根歧管分立机柜后部两侧，托盘推入即与快接头盲插对接；托盘内与歧管处各有漏液传感器，由 BMC 上报。</p>`,
        live: () => ({ s: `${sim.stats.supplyC.toFixed(0)} °C`, r: `${sim.stats.returnC.toFixed(1)} °C`, q: `约 ${(sim.stats.powerKW * 0.87).toFixed(0)} kW` }),
      };
    case 'netdev': {
      const d = cabling.netDevs.get(sel.id);
      const cs = model.cables.filter((c) => c.far.dev === d.id);
      const cap = d.net === 'ib' ? IB_GBPS : ETH_GBPS;
      return {
        kick: d.net === 'ib' ? 'Scale-out · InfiniBand Leaf' : 'Scale-in · 前端以太网交换机', title: d.name, zh: true, color: NET_CSS[d.net],
        html: kv([['来自本柜的链路', L('up')], ['本柜流量', L('rate')]]) +
          `<p class="note">${d.net === 'ib' ? '示意的网络柜。每个计算托盘的 4 个 ConnectX-7 分别接到 4 台 Leaf（rail-optimized），介质为光模块与光纤，由 UFM 管理。' : '示意的网络柜。每块 BlueField-3 的两个口分别接到 A、B 两台交换机，介质为光模块或 DAC，连线由 LLDP 发现。'}</p>`,
        live: () => ({
          up: `${cs.filter((c) => cabling.linkState(c) === 2).length} / ${cs.length}`,
          rate: fmtRate(cs.reduce((a, c) => a + (sim.cableIn[c.id] + sim.cableOut[c.id]) * cap, 0)),
        }),
      };
    }
    default:
      return inspector(app, null);
  }
}

function cellColor(app, l) {
  const st = app.model.linkState[l];
  if (st === 0) return '#e5533a';
  if (st === 1) return '#f2b23e';
  return heatCss(Math.max(app.sim.tx[l], app.sim.rx[l]));
}

export { linkTitle, FAULTS, GPU_GBPS, gpuSlot, swSlot, swK, LEADER_SLOT };
