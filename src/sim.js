// Traffic, power and telemetry simulation on top of the logical model.
// NVLink routing follows the real topology: a flow from GPU a to GPU b can use
// any NVSwitch that both GPUs still have a live link to, one hop each way, and
// every link carries at most 400 Gb/s per direction.

import { LINK_GBPS, IB_GBPS, ETH_GBPS, SHELF_KW } from './config.js';
import { N_GPU, N_NVSW, N_LINK, gpuName, swName, slotName, gpuSlot, LEADER_SLOT } from './topology.js';

const GPU_GBPS = LINK_GBPS * N_NVSW; // 7,200 Gb/s per direction

export const PATTERNS = {
  idle: { label: '空闲', hint: '只有心跳与管理流量' },
  all2all: { label: 'All-to-all', hint: '72 块 GPU 两两互发，流量均摊到 18 颗 NVSwitch' },
  ring: { label: '环形', hint: '每块 GPU 发给下一块，单流占满 18 条并行路径' },
  incast: { label: '汇聚', hint: '所有 GPU 发往同一块 GPU，其下行口拥塞' },
  pair: { label: '点对点', hint: '两块 GPU 互发，18 条并行路径各经过 1 颗 NVSwitch' },
  partition: { label: '双分区', hint: '下部 8 托盘与上部 10 托盘各自 all-to-all，互不相通' },
};

export const SCENARIOS = {
  train: { label: '单柜训练', pattern: 'all2all', nv: 0.85, ib: 0.12, eth: 0.35, burst: true },
  multi: { label: '跨柜训练', pattern: 'all2all', nv: 0.55, ib: 0.85, eth: 0.35, burst: true },
  infer: { label: '推理服务', pattern: 'partition', nv: 0.3, ib: 0.08, eth: 0.6, burst: false },
  ckpt: { label: 'Checkpoint 落盘', pattern: 'idle', nv: 0.05, ib: 0.05, eth: 0.95, burst: false },
  idle: { label: '空闲', pattern: 'idle', nv: 0, ib: 0.02, eth: 0.03, burst: false },
};

function popcount(x) {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

export class Sim {
  constructor(model, cabling) {
    this.model = model;
    this.cabling = cabling;
    this.pattern = 'all2all';
    this.intensity = 0.85;
    this.scaleOut = 0.12;
    this.scaleIn = 0.35;
    this.burst = true;
    this.pairA = 0;
    this.pairB = 71;
    this.incastTarget = 38;
    this.time = 0;
    this.dirty = true;

    this.tx = new Float32Array(N_LINK); // GPU -> NVSwitch utilisation
    this.rx = new Float32Array(N_LINK); // NVSwitch -> GPU utilisation
    this.offUp = new Float32Array(N_LINK); // offered load, Gb/s
    this.offDn = new Float32Array(N_LINK);
    this.actUp = new Float32Array(N_LINK);
    this.actDn = new Float32Array(N_LINK);
    this.mask = new Int32Array(N_GPU);
    this.xmitData = new Float64Array(N_LINK); // bytes sent by the GPU port
    this.rcvData = new Float64Array(N_LINK);
    this.xmitWait = new Float64Array(N_LINK); // ticks the sender spent waiting for credits
    this.symErr = new Float64Array(N_LINK);
    this.gpuTx = new Float32Array(N_GPU);
    this.gpuRx = new Float32Array(N_GPU);
    this.gpuLoad = new Float32Array(N_GPU);
    this.swThrough = new Float32Array(N_NVSW);
    this.swTemp = new Float32Array(N_NVSW).fill(48);
    this.gpuTemp = new Float32Array(N_GPU).fill(46);
    this.cableIn = new Float32Array(model.cables.length); // utilisation towards the tray
    this.cableOut = new Float32Array(model.cables.length);
    this.stats = { nvGbps: 0, nvOffered: 0, nvBlocked: 0, nvCap: 0, linksUp: N_LINK, gpus: N_GPU, ibGbps: 0, ethGbps: 0, powerKW: 0, capKW: 8 * SHELF_KW, shelves: 8, supplyC: 32, returnC: 45, burstK: 1, congested: 0, cap: 1 };
    this.alerts = [];
    this.telemetryOk = true;
    this.pollPhase = 0;
    this._alertT = 0;
    this._alertSeen = new Map();
    this.onAlert = () => {};
    model.on('links', () => (this.dirty = true));
  }

  set(k, v) {
    if (this[k] === v) return;
    this[k] = v;
    this.dirty = true;
  }

  applyScenario(key) {
    const s = SCENARIOS[key];
    this.pattern = s.pattern;
    this.intensity = s.nv;
    this.scaleOut = s.ib;
    this.scaleIn = s.eth;
    this.burst = s.burst;
    this.scenario = key;
    this.dirty = true;
  }

  // effective NVLink intensity: training traffic arrives in step-synchronised bursts
  _burstK() {
    if (!this.burst || this.pattern === 'idle') return 1;
    const ph = (this.time % 2.6) / 2.6;
    // gradient exchange for ~60% of the step, quieter while GPUs compute
    const k = ph < 0.6 ? 1 : 0.28 + 0.72 * Math.max(0, 1 - (ph - 0.6) / 0.08);
    return Math.max(0.28, Math.min(1, k));
  }

  _forEachFlow(fn, I) {
    const mask = this.mask;
    const act = this._active;
    const n = act.length;
    if (n < 2 || I <= 0) return;
    switch (this.pattern) {
      case 'all2all': {
        const d = (I * GPU_GBPS) / (n - 1);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) fn(act[i], act[j], d);
        break;
      }
      case 'ring':
        for (let i = 0; i < n; i++) fn(act[i], act[(i + 1) % n], I * GPU_GBPS);
        break;
      case 'incast': {
        const t = mask[this.incastTarget] ? this.incastTarget : act[0];
        for (let i = 0; i < n; i++) if (act[i] !== t) fn(act[i], t, I * GPU_GBPS);
        break;
      }
      case 'pair':
        if (mask[this.pairA] && mask[this.pairB] && this.pairA !== this.pairB) {
          fn(this.pairA, this.pairB, I * GPU_GBPS);
          fn(this.pairB, this.pairA, I * GPU_GBPS);
        }
        break;
      case 'partition': {
        for (const part of [act.filter((g) => g < 32), act.filter((g) => g >= 32)]) {
          const m = part.length;
          if (m < 2) continue;
          const d = (I * GPU_GBPS) / (m - 1);
          for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) fn(part[i], part[j], d);
        }
        break;
      }
      default:
    }
  }

  recompute() {
    const { model, mask, offUp, offDn, actUp, actDn } = this;
    const st = model.linkState;
    let linksUp = 0;
    this._active = [];
    for (let g = 0; g < N_GPU; g++) {
      let m = 0;
      for (let s = 0; s < N_NVSW; s++) if (st[g * N_NVSW + s] === 2) m |= 1 << s;
      mask[g] = m;
      const c = popcount(m);
      linksUp += c;
      if (c) this._active.push(g);
    }
    offUp.fill(0);
    offDn.fill(0);
    actUp.fill(0);
    actDn.fill(0);
    let offered = 0, blocked = 0, total = 0;
    const I = this.intensity * this.stats.cap;
    this._forEachFlow((a, b, d) => {
      offered += d;
      const m = mask[a] & mask[b];
      const n = popcount(m);
      if (!n) {
        blocked += d;
        return;
      }
      const share = d / n;
      for (let s = 0; s < N_NVSW; s++) if (m & (1 << s)) {
        offUp[a * N_NVSW + s] += share;
        offDn[b * N_NVSW + s] += share;
      }
    }, I);
    this._forEachFlow((a, b, d) => {
      const m = mask[a] & mask[b];
      const n = popcount(m);
      if (!n) return;
      const share = d / n;
      for (let s = 0; s < N_NVSW; s++) if (m & (1 << s)) {
        const u = offUp[a * N_NVSW + s], v = offDn[b * N_NVSW + s];
        const r = share * Math.min(1, LINK_GBPS / u, LINK_GBPS / v);
        actUp[a * N_NVSW + s] += r;
        actDn[b * N_NVSW + s] += r;
        total += r;
      }
    }, I);
    this.base = { offered, blocked, total, linksUp };
    this.dirty = false;
  }

  step(dt, now) {
    const { model } = this;
    this.time += dt;
    if (model.stepLinks(now)) this.dirty = true;

    // ---- power budget first: capping feeds back into the traffic intensity ----
    const shelves = model.shelves.filter((s) => s.seated && !s.fault).length;
    const capKW = shelves * SHELF_KW;
    const st = this.stats;
    if (st.shelves !== shelves) this.dirty = true;
    st.shelves = shelves;
    st.capKW = capKW;
    // no shelf seated: nothing feeds the busbar, every tray goes dark
    const off = shelves === 0;
    if (model.powerOff !== off) {
      model.powerOff = off;
      model.recomputePhys(now);
      this.dirty = true;
    }

    if (this.dirty) this.recompute();
    const k = this._burstK();
    st.burstK = k;
    const b = this.base;

    // ---- per-link utilisation + counters ----
    const { tx, rx, actUp, actDn, offUp, offDn, xmitData, rcvData, xmitWait, symErr, gpuTx, gpuRx, swThrough } = this;
    gpuTx.fill(0);
    gpuRx.fill(0);
    swThrough.fill(0);
    let congested = 0;
    const idle = this.pattern === 'idle' || this.intensity <= 0;
    for (let l = 0; l < N_LINK; l++) {
      const up = model.linkState[l] === 2;
      let u = 0, v = 0;
      if (up) {
        u = (actUp[l] / LINK_GBPS) * k;
        v = (actDn[l] / LINK_GBPS) * k;
        if (idle || (u < 0.004 && v < 0.004)) {
          // keep-alives / flow control only
          u = Math.max(u, 0.004);
          v = Math.max(v, 0.004);
        }
        const g = (l / N_NVSW) | 0, s = l % N_NVSW;
        gpuTx[g] += u * LINK_GBPS;
        gpuRx[g] += v * LINK_GBPS;
        swThrough[s] += (u + v) * LINK_GBPS;
        xmitData[l] += ((u * LINK_GBPS * 1e9) / 8) * dt;
        rcvData[l] += ((v * LINK_GBPS * 1e9) / 8) * dt;
        const over = Math.max(offUp[l], offDn[l]) * k;
        if (over > LINK_GBPS * 1.01) {
          congested++;
          xmitWait[l] += (over / LINK_GBPS - 1) * 4e5 * dt;
        }
        if (model.linkFault[l] === 2) symErr[l] += (40 + Math.random() * 60) * dt;
      }
      tx[l] = u;
      rx[l] = v;
    }
    st.congested = congested;
    st.nvGbps = b.total * k;
    st.nvOffered = b.offered * k;
    st.nvBlocked = b.blocked * k;
    st.linksUp = b.linksUp;
    st.nvCap = b.linksUp * LINK_GBPS;
    st.gpus = this._active.length;

    // ---- GPU load, temperatures, power ----
    const I = this.intensity * st.cap * k;
    let pKW = off ? 0 : 0.6; // management switches, losses
    st.supplyC = 32;
    for (const tray of model.compute) {
      let load = 0;
      const on = tray.seated && !tray.fault && !off;
      for (let nn = 0; nn < 4; nn++) {
        const g = tray.trayIndex * 4 + nn;
        const alive = on && !model.gpuFault[g];
        const util = Math.max(gpuTx[g], gpuRx[g]) / GPU_GBPS;
        const target = alive ? Math.max(0.06, Math.min(1, 0.25 * I + 0.75 * Math.max(util, idle ? 0 : I * 0.5))) : 0;
        this.gpuLoad[g] += (target - this.gpuLoad[g]) * Math.min(1, dt * 2.5);
        load += this.gpuLoad[g];
        const tT = alive ? st.supplyC + 11 + 36 * this.gpuLoad[g] : 26;
        this.gpuTemp[g] += (tT - this.gpuTemp[g]) * Math.min(1, dt * 0.6);
      }
      tray.kw = on ? 1.55 + 4.25 * (load / 4) : 0;
      pKW += tray.kw;
    }
    for (const sw of model.switches) {
      const on = sw.seated && !sw.fault && !off;
      let thr = 0;
      for (let c = 0; c < 2; c++) {
        const s = sw.swTray * 2 + c;
        const frac = swThrough[s] / (72 * 2 * LINK_GBPS);
        thr += frac;
        const tT = on && !model.swFault[s] ? st.supplyC + 14 + 26 * frac : 26;
        this.swTemp[s] += (tT - this.swTemp[s]) * Math.min(1, dt * 0.6);
      }
      sw.kw = on ? 0.95 + 0.4 * (thr / 2) : 0;
      pKW += sw.kw;
    }
    st.powerKW = pKW;
    // power capping: demand above what the seated shelves can deliver throttles the GPUs.
    // The controller runs on a continuous value so that its behaviour does not depend on the step size.
    let raw = this._capRaw ?? 1;
    if (capKW <= 0) raw = 0;
    else {
      const ratio = pKW / capKW;
      if (ratio > 1) raw = Math.max(0.05, raw - (ratio - 1) * raw * Math.min(1, dt * 1.5));
      else if (ratio < 0.97) raw = Math.min(1, Math.max(raw, 0.05) + dt * 0.25);
    }
    this._capRaw = raw;
    if (Math.abs(raw - st.cap) > 0.004 || (raw !== st.cap && (raw === 1 || raw === 0))) {
      st.cap = raw;
      this.dirty = true;
    }
    st.returnC = st.supplyC + 13.3 * (pKW / 120);

    // ---- front cables ----
    const cables = model.cables;
    const ck = 0.5 + 0.5 * Math.sin(this.time * 0.45); // slow drift
    const ckpt = this.scenario === 'ckpt' ? 1 : (this.time % 16) < 3.2 ? 1 : 0; // periodic checkpoint flush
    this.pollPhase = (this.time % 6) / 6;
    let ib = 0, eth = 0;
    const lead = model.unitById.get(slotName(LEADER_SLOT));
    let leaderLink = false;
    for (let i = 0; i < cables.length; i++) {
      const c = cables[i];
      const ls = this.cabling.linkState(c);
      let a = 0, o = 0;
      if (ls === 2) {
        const h = ((i * 2654435761) >>> 0) / 4294967296; // stable per-cable variation
        if (c.net === 'ib') {
          a = this.scaleOut * (0.7 + 0.3 * h) * (0.85 + 0.15 * ck) * (this.burst ? 0.55 + 0.45 * k : 1);
          o = this.scaleOut * (0.7 + 0.3 * (1 - h)) * (0.85 + 0.15 * (1 - ck)) * (this.burst ? 0.55 + 0.45 * k : 1);
          ib += (a + o) * IB_GBPS;
        } else if (c.net === 'eth') {
          a = this.scaleIn * (0.35 + 0.25 * h);
          o = this.scaleIn * (0.06 + 0.9 * ckpt * (0.7 + 0.3 * h));
          eth += (a + o) * ETH_GBPS;
        } else {
          // out-of-band: a telemetry sweep climbs the rack every few seconds
          const y = (c.home.unit.u - 6) / 38;
          const dph = (this.pollPhase - y * 0.7 + 1) % 1;
          const sweep = dph < 0.07 ? 1 : 0;
          const isLeader = c.home.unit === lead && (c.home.key === 'mgmt0' || c.home.key === 'mgmt1');
          if (isLeader) leaderLink = true;
          a = 0.03 + 0.25 * sweep;
          o = 0.03 + (isLeader && !model.telemetryDown ? 0.55 : 0.5 * sweep);
        }
      }
      this.cableIn[i] = a;
      this.cableOut[i] = o;
    }
    st.ibGbps = ib;
    st.ethGbps = eth;
    this.telemetryOk = !model.telemetryDown && lead.seated && !lead.fault && leaderLink;

    this._alertT -= dt;
    if (this._alertT <= 0) {
      this._alertT = 0.4;
      this._evalAlerts();
    }
  }

  // ---- alert rules (mirrors the deck's rule table) ---------------------------
  _evalAlerts() {
    const { model } = this;
    const out = [];
    const add = (key, sev, title, detail, focus) => out.push({ key, sev, title, detail, focus });
    if (!this.telemetryOk) add('telemetry', 'crit', '采集中断', 'NMX-T / exporter 不可达：链路矩阵为“无数据”，不对链路下结论', { type: 'unit', id: slotName(LEADER_SLOT) });

    const trayDown = new Set();
    for (const sw of model.switches) {
      if (!sw.seated || sw.fault || (model.swFault[sw.swTray * 2] && model.swFault[sw.swTray * 2 + 1])) {
        trayDown.add(sw.swTray);
        add(`sw-${sw.id}`, 'crit', `交换托盘故障 · ${sw.id}`, `相邻 2 列共 144 条断开，全域每块 GPU 少 2 条；波及全部租户`, { type: 'unit', id: sw.id });
      } else {
        for (let c = 0; c < 2; c++) {
          const s = sw.swTray * 2 + c;
          if (model.swFault[s]) add(`nvsw-${s}`, 'crit', `NVSwitch 故障 · ${swName(s)}`, `1 列 72 条断开，每块 GPU 剩 17/18`, { type: 'nvsw', id: s });
        }
      }
    }
    for (const tray of model.compute) {
      if (!tray.seated || tray.fault) {
        add(`tray-${tray.id}`, 'crit', `计算托盘离线 · ${tray.id}`, `4 行共 72 条断开：1 台主机的 4 块 GPU 退出 NVLink 域`, { type: 'unit', id: tray.id });
        continue;
      }
      for (let nn = 0; nn < 4; nn++) {
        const g = tray.trayIndex * 4 + nn;
        if (model.gpuFault[g]) add(`gpu-${g}`, 'crit', `单 GPU 断链 · ${gpuName(g)}`, `1 行 18 条同时断开：GPU 被复位或故障`, { type: 'gpu', id: g });
      }
    }
    for (const c of model.cart) if (!c.seated) add(`cart-${c.id}`, 'crit', `线缆背板脱开 · ${c.name}`, `每个计算托盘的 gpu-0${c.id + 1} 共 18 块 GPU、324 条链路断开`, { type: 'cart', id: c.id });
    // degraded GPUs that are not explained by a larger failure above
    let degraded = 0, worst = 18, firstG = -1;
    for (let g = 0; g < N_GPU; g++) {
      if (!model.gpuAlive(g) || !model.cart[g & 3].seated) continue;
      let up = 0, expected = 0;
      for (let s = 0; s < N_NVSW; s++) {
        if (trayDown.has(s >> 1) || model.swFault[s]) continue;
        expected++;
        if (model.linkState[g * N_NVSW + s] !== 0) up++;
      }
      if (up < expected) {
        degraded++;
        if (firstG < 0) firstG = g;
        worst = Math.min(worst, up);
      }
    }
    if (degraded) add('degraded', 'warn', `链路降级 · ${degraded} 块 GPU`, degraded === 1 ? `${gpuName(firstG)} 在线链路少于 18，带宽按比例下降；优先怀疑背板线对或连接器` : `在线链路数持续小于 18，带宽按比例下降`, { type: 'gpu', id: firstG });
    let q = 0, firstL = -1;
    for (let l = 0; l < N_LINK; l++) if (model.linkFault[l] === 2 && model.linkState[l] === 2) { q++; if (firstL < 0) firstL = l; }
    if (q) add('quality', 'warn', `链路质量劣化 · ${q} 条`, 'SymbolError、LinkErrorRecovery 持续增长，BER 上升', { type: 'link', id: firstL });
    if (this.stats.congested > 0) add('congestion', 'info', `拥塞 · ${this.stats.congested} 个端口`, 'XmitWait 与 XmitData 的比值超过 1%：属于作业的流量形态，平台侧没有硬件动作', null);
    if (this.stats.nvBlocked > 1) add('blocked', 'warn', '部分 GPU 之间不可达', `约 ${(this.stats.nvBlocked / 1000).toFixed(1)} Tb/s 的需求没有可用路径`, null);
    const st = this.stats;
    if (st.shelves === 0) add('poweroff', 'crit', '整柜失电', '8 个电源架全部脱开，汇流排无电，所有托盘下电', { type: 'busbar', id: 0 });
    else if (st.cap < 0.999) add('cap', 'crit', `功率封顶 · 可用 ${st.capKW} kW`, `电源架不足以承载整柜负载，GPU 被限功率到 ${(st.cap * 100).toFixed(0)}%`, { type: 'busbar', id: 0 });
    else if (st.shelves < 8) add('psu', 'warn', `电源冗余下降 · ${st.shelves}/8 架`, st.shelves >= 4 ? `可用 ${st.capKW} kW，当前 ${st.powerKW.toFixed(0)} kW；N+N 冗余已不完整` : `可用 ${st.capKW} kW，当前 ${st.powerKW.toFixed(0)} kW；已无冗余，负载再升就会被限功率`, { type: 'busbar', id: 0 });
    const cs = this.cabling.summary();
    if (cs.open.length) add('cable-open', 'warn', `前面板线缆未接 · ${cs.open.length} 根`, '对应的 IB、以太网或带外链路为 down', { type: 'cable', id: cs.open[0].id });
    if (cs.wrong.length) add('cable-wrong', 'warn', `接线与规划不符 · ${cs.wrong.length} 根`, 'LLDP / UFM 发现的对端与接线表不一致', { type: 'cable', id: cs.wrong[0].id });
    for (const u of model.units) if (u.leak) add(`leak-${u.id}`, 'crit', `漏液告警 · ${u.id}`, '托盘内漏液传感器触发，由 BMC Redfish 上报', { type: 'unit', id: u.id });

    // announce an alert only once it has held for three evaluations (~1.2 s), so the
    // brief states while links retrain do not raise notifications
    const keys = new Set(out.map((a) => a.key));
    const seen = this._alertSeen;
    for (const a of out) {
      const n = (seen.get(a.key) || 0) + 1;
      seen.set(a.key, n);
      if (n === 3) this.onAlert(a, true);
    }
    for (const k of [...seen.keys()]) {
      if (keys.has(k)) continue;
      if (seen.get(k) >= 3) this.onAlert({ key: k }, false);
      seen.delete(k);
    }
    this.alerts = out;
  }

  // summary of the current "shape" of dead links in the 72 x 18 matrix
  shape() {
    const { model } = this;
    const st = model.linkState;
    let down = 0;
    const rows = [], cols = [];
    for (let g = 0; g < N_GPU; g++) {
      let d = 0;
      for (let s = 0; s < N_NVSW; s++) if (st[g * N_NVSW + s] !== 2) d++;
      down += d;
      if (d === N_NVSW) rows.push(g);
    }
    for (let s = 0; s < N_NVSW; s++) {
      let d = 0;
      for (let g = 0; g < N_GPU; g++) if (st[g * N_NVSW + s] !== 2) d++;
      if (d === N_GPU) cols.push(s);
    }
    let cells = 0;
    const rowSet = new Set(rows), colSet = new Set(cols);
    for (let g = 0; g < N_GPU; g++) if (!rowSet.has(g)) for (let s = 0; s < N_NVSW; s++) if (!colSet.has(s) && st[g * N_NVSW + s] !== 2) cells++;
    const trays = [];
    for (let t = 0; t < 18; t++) if ([0, 1, 2, 3].every((k) => rowSet.has(t * 4 + k))) trays.push(t);
    const swTrays = [];
    for (let j = 0; j < 9; j++) if (colSet.has(j * 2) && colSet.has(j * 2 + 1)) swTrays.push(j);
    return { down, rows, cols, cells, trays, swTrays };
  }
}

export { GPU_GBPS, gpuSlot };
