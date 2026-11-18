// Guided tour: eight steps that walk through the rack the way the deck does —
// front, rear blind-mate, one GPU's fan-out, one NVSwitch, the four networks,
// traffic, fault shapes, hands-on.

import { slotName } from './topology.js';

export function createTour(app) {
  let timers = [];
  const later = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
  const reset = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    app._quiet = true;
    app.clearFaults(true);
    for (const u of app.model.units) if (app.canPull(u) && u.pullTarget > 0.02) app.setPull(u, 0);
    app.cabling.autoWire(0.01);
    later(1.2, () => { app._quiet = false; });
  };

  const steps = [
    {
      title: '机柜正面：27 个托盘',
      body: '自上而下是管理交换机、电源架、10 个计算托盘、9 个 NVLink 交换托盘、8 个计算托盘、电源架。正面可见的线缆只有三类：蓝色 InfiniBand、橙色以太网、灰色管理网，都是人工布线。',
      enter() {
        app.setXray(false);
        app.setLabels(true);
        app.select(null);
        app.sim.applyScenario('train');
        app.setView('front');
      },
    },
    {
      title: '机柜后部：NVLink、供电、液冷全部盲插',
      body: '4 个线缆背板分列居中的汇流排两侧，两根液冷歧管在最外侧。注意 slot 22：托盘拉出时后部连接器一起脱开，推回到位即对接，72 条链路自动重新训练。',
      enter() {
        app.setXray(false);
        app.setLabels(true);
        app.select(null);
        app.setView('rear');
        const u = app.model.unitById.get(slotName(22));
        later(1.6, () => app.togglePull(u));
        later(5.2, () => { app.setPull(u, 0); later(1.2, () => app.cabling.replugUnit(u)); });
      },
    },
    {
      title: '一块 GPU 的 18 条 NVLink',
      body: '每块 GPU 有 18 个端口，到 18 颗 NVSwitch 各 1 条：端口 p 去往 slot 9 + ⌊(p − 1) / 2⌋，奇数口到 swt-01，偶数口到 swt-02。所以任意两块 GPU 之间有 18 条并行路径，每条只经过 1 颗 NVSwitch。',
      enter() {
        app.setLabels(false);
        app.setXray(true);
        app.sim.applyScenario('train');
        app.select({ type: 'gpu', id: 61 });
        app.frameView([-0.55, 0.4, -0.73], [0.0, 1.3, -0.2], 1.15, 1.45, 1.4);
      },
    },
    {
      title: '一颗 NVSwitch 的 72 个端口',
      body: '反过来看，每颗 NVSwitch 的 72 个端口各接 1 块 GPU，端口号 = 4 × tray_index + NN。18 颗 NVSwitch 的分配完全相同，所以一块 GPU 在 18 颗交换芯片上占用的是同一个端口号。',
      enter() {
        app.setLabels(false);
        app.setXray(true);
        app.select({ type: 'nvsw', id: 8 });
        app.frameView([-0.55, 0.36, -0.75], [0.0, 1.1, -0.2], 1.15, 1.75, 1.4);
      },
    },
    {
      title: '四类连接，四条路径',
      body: 'Scale-up 走后部背板到交换托盘；Scale-out 从 ConnectX-7 经光纤到 IB Leaf；Scale-in 从 BlueField-3 到前端以太网交换机；带外管理从 BMC 与 NVOS 管理口到柜内管理交换机。四条路径的采集点都在交换机或 BMC 一侧。',
      enter() {
        app.setXray(false);
        app.select(null);
        app.setLabels(true);
        app.sim.applyScenario('multi');
        app.ui.syncTraffic();
        app.setView('overview');
      },
    },
    {
      title: '数据流量：报文密度就是利用率',
      body: '每条 NVLink 每方向 400 Gb/s，一块 GPU 合计 7.2 Tb/s。现在是“汇聚”：71 块 GPU 同时发往一块 GPU，它的 18 个下行口先跑满，发送端开始排队等待，对应 XmitWait 增长。',
      enter() {
        app.setLabels(false);
        app.setXray(true);
        app.sim.applyScenario('train');
        app.sim.incastTarget = 38;
        app.setPattern('incast');
        app.sim.set('intensity', 0.9);
        app.setHeat(true);
        app.ui.syncTraffic();
        app.select({ type: 'gpu', id: 38 });
        app.frameView([-0.55, 0.36, -0.75], [0.0, 1.1, -0.2], 1.15, 1.75, 1.4);
      },
      leave() {
        app.setHeat(false);
      },
    },
    {
      title: '断链的形状对应故障部件',
      body: 'slot 27 离线：矩阵里出现 4 整行，1,296 − 72 = 1,224 条。读法是固定的：单格是背板线对，1 行是 GPU，4 行是计算托盘，1 列是单颗 NVSwitch，相邻 2 列是交换托盘，整片无数据是采集中断。',
      enter() {
        app.setLabels(false);
        app.setXray(true);
        app.sim.applyScenario('train');
        app.ui.syncTraffic();
        app.setView('rear');
        later(1.0, () => {
          app.select({ type: 'unit', id: slotName(27) });
          app.inject('tray');
          if (app.ui.isNarrow()) app.ui.setTab('matrix');
        });
      },
    },
    {
      title: '动手试试',
      body: '按住前面板上的插头拖动即可拔出，线缆会下垂摆动；拖到同型空端口附近松手插入。拖动托盘两侧的把手可以把托盘拉出机柜。左侧面板可以切换流量形态、注入故障。',
      enter() {
        app.setXray(false);
        app.setLabels(false);
        app.select(null);
        app.sim.applyScenario('train');
        app.ui.syncTraffic();
        app.frameView([0.36, 0.2, 0.91], [0.06, 1.53, 0.5], 0.8, 0.52, 1.4);
        const c = app.model.cables.find((x) => x.home.unit.id === slotName(24) && x.home.key === 'ib3');
        later(1.8, () => app.cabling.unplug(c));
        later(4.4, () => app.cabling.rehome(c));
      },
    },
  ];

  const tour = {
    active: false,
    i: 0,
    steps,
    start(i = 0) {
      tour.active = true;
      tour.go(i);
    },
    go(i) {
      const prev = steps[tour.i];
      if (tour.active && prev && prev.leave) prev.leave();
      tour.i = Math.max(0, Math.min(steps.length - 1, i));
      reset();
      app.ui.tour(steps[tour.i], tour.i, steps.length);
      app.onLayout(); // the card's height changes the free area before the step frames its shot
      steps[tour.i].enter();
      app.ui.syncToggles();
      app.ui.syncTraffic();
    },
    next() {
      if (tour.i >= steps.length - 1) tour.stop();
      else tour.go(tour.i + 1);
    },
    prev() {
      tour.go(tour.i - 1);
    },
    stop() {
      const cur = steps[tour.i];
      if (cur && cur.leave) cur.leave();
      for (const t of timers) clearTimeout(t);
      timers = [];
      tour.active = false;
      app._quiet = false;
      app.ui.tour(null);
      app.onLayout();
    },
  };
  return tour;
}
