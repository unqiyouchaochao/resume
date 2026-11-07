/* 惰气工艺流程演示：把课设里的 LD 顺序控制 + TON 延时联锁搬进浏览器
   事实来源：惰气控制系统设计报告（第四章 4.2）、PLC_PRG (PRG-LD)
   - 风机 M1 走 ACS355 变频，分档 7.5 / 25 / 45 Hz
   - 点火 JIDENG 自锁后启动 My_TON，延时到才允许燃油泵 M2
   - YV1 / YV2 两路供油：单开正常流速、双开最大流速
   - 氧含量低于阈值（15%）才允许开冷却泵 M3，低于 12% 视为达标
   数值是演示用的量级，不是现场实测数据。 */
(function () {
  var host = document.getElementById('proc');
  if (!host) return;

  var stage = document.getElementById('proc-stage');
  var elPhase = document.getElementById('proc-phase');
  var elO2 = document.getElementById('proc-o2');
  var elLevel = document.getElementById('proc-level');
  var elHz = document.getElementById('proc-hz');
  var elLog = document.getElementById('proc-log');
  var devicesBox = document.getElementById('proc-devices');
  var delayInput = document.getElementById('proc-delay');
  var pInput = document.getElementById('proc-ptime');
  var vInput = document.getElementById('proc-vtime');
  var cInput = document.getElementById('proc-ctime');

  /* 四个 TON 的进度条与状态字 */
  var TON_VIEW = [
    { bar: 'proc-ton-bar', state: 'proc-ton-state' },
    { bar: 'proc-p-bar', state: 'proc-p-state' },
    { bar: 'proc-v-bar', state: 'proc-v-state' },
    { bar: 'proc-c-bar', state: 'proc-c-state' }
  ].map(function (v) {
    return { bar: document.getElementById(v.bar), state: document.getElementById(v.state), txt: '' };
  });

  /* ---------- 常量 ---------- */
  var O2_FRESH = 20.9;     // 空气氧含量
  var O2_YV2 = 17;         // 第二路供油（最大流速）投入点
  var O2_FAN3 = 14;        // 切三档
  var O2_COOL = 15;        // 冷却泵允许阈值
  var O2_DONE = 12;        // 惰气达标
  var FAN_HZ = { 1: 7.5, 2: 25, 3: 45 };
  var LEVEL_DONE = 85;

  /* 四个定时器：报告里只写了一个「点火→投油」，实际顺序控制里每一步都要等信号到位。
     TON1 点火→允许投油（防炉膛积油）
     TON2 燃油泵投入→油压建立（没油压就开阀等于空放）
     TON3 阀得电→开到位反馈（阀有行程，得电≠已开）
     TON4 冷却泵启动→出口建立（泵转≠烟气已经过冷却器）
     单位秒，都是演示量级，可现场改。 */
  var TON_DEF = { ton1: 5, ton2: 2, ton3: 1.5, ton4: 2.5 };

  var st = {
    mode: 'auto',
    running: false,
    fan: 0,            // 0 停 / 1·2·3 档
    ignite: false,
    oil: false,
    yv1: false,
    yv2: false,
    cool: false,
    collect: false,
    ton: 0,            // TON1 累计：点火后秒数
    delay: TON_DEF.ton1,
    ton2: 0, pDelay: TON_DEF.ton2,   // TON2：油压
    ton3: 0, vDelay: TON_DEF.ton3,   // TON3：阀行程
    ton4: 0, cDelay: TON_DEF.ton4,   // TON4：冷却建立
    yv1T: 0, yv2T: 0,                // 各阀自己的行程计时
    oilPress: false,
    yv1Fb: false, yv2Fb: false,      // 阀位反馈（开到位）
    coolReady: false,                // 冷却出口已建立
    gap: 0,            // 自动流程步间停留，避免一步接一步瞬跳
    o2: O2_FRESH,
    level: 0,
    phase: 'idle',
    step: 0,           // 自动流程步号
    esTop: false
  };

  /* ---------- SVG 工艺图 ---------- */

  /* 每条管道画三层叠在一起：管壁（粗、浅底）→ 介质流（短划跑动）→ 高光（细亮线）。
     介质按颜色区分：空气青 / 烟气橙 / 燃油金 / 冷却水蓝绿 / 成品橄榄金。
     med 是介质类型，dly 是动画相位（负延迟，让几条管道不同步跑，避免整张图一起闪）。 */
  function pipe(id, med, d, dly) {
    var style = ' style="--dly:' + (dly || 0) + 's"';
    return '<g class="proc-line" id="' + id + '" data-med="' + med + '"' + style + '>'
      + '<path class="proc-pipe is-wall" d="' + d + '"/>'
      + '<path class="proc-pipe is-core" d="' + d + '"/>'
      + '<path class="proc-pipe is-hi" d="' + d + '"/>'
      + '</g>';
  }

  var SVG = ''
    + '<svg class="proc-svg" viewBox="0 0 780 420" preserveAspectRatio="xMidYMid meet" role="img" aria-label="惰气工艺流程示意：风机、反应罐、冷却过滤与收集罐">'
    /* 管道：先画线，设备压在上面 */
    + '<g class="proc-pipes">'
    +   pipe('p-air',   'air', 'M120 150 H230', -0.00)
    +   pipe('p-gas',   'gas', 'M360 120 H430', -0.22)
    +   pipe('p-cool',  'gas', 'M525 145 H590', -0.44)
    +   pipe('p-out',   'out', 'M660 145 H700', -0.66)
    +   pipe('p-fuel0', 'oil', 'M116 340 H150', -0.10)
    +   pipe('p-fuel1', 'oil', 'M150 340 V312 H202 M218 312 H250 V368', -0.32)
    +   pipe('p-fuel2', 'oil', 'M150 340 V368 H202 M218 368 H250 V270', -0.54)
    +   pipe('p-cw',    'cw',  'M478 276 V220', -0.76)
    + '</g>'
    /* 风机 */
    + '<g id="p-fan">'
    +   '<circle class="proc-dev" cx="90" cy="150" r="30"/>'
    +   '<g id="p-fan-blades" class="proc-fan-blades">'
    +     '<path class="proc-blade" d="M90 150 L90 126 A24 24 0 0 1 111 138 Z"/>'
    +     '<path class="proc-blade" d="M90 150 L111 162 A24 24 0 0 1 90 174 Z"/>'
    +     '<path class="proc-blade" d="M90 150 L69 162 A24 24 0 0 1 69 138 Z"/>'
    +   '</g>'
    +   '<text class="proc-label" x="90" y="212" text-anchor="middle">风机 M1</text>'
    + '</g>'
    /* 反应罐 */
    + '<g id="p-reactor">'
    +   '<rect class="proc-dev" x="230" y="100" width="130" height="170" rx="18"/>'
    +   '<text class="proc-o2" id="p-o2" x="295" y="122" text-anchor="middle">O₂ 20.9%</text>'
    +   '<g id="p-flame" class="proc-flame">'
    +     '<path d="M295 250 C 283 236, 281 224, 295 212 C 309 224, 307 236, 295 250 Z"/>'
    +     '<path class="proc-flame-core" d="M295 248 C 289 240, 288 232, 295 226 C 302 232, 301 240, 295 248 Z"/>'
    +   '</g>'
    +   '<text class="proc-label" x="295" y="88" text-anchor="middle">反应罐 · 点火 L</text>'
    + '</g>'
    /* 燃油侧 */
    + '<g id="p-fuel">'
    +   '<circle class="proc-dev" cx="90" cy="340" r="26"/>'
    +   '<path class="proc-mark" d="M90 328 V352 M84 334 L90 328 L96 334"/>'
    +   '<text class="proc-label" x="90" y="392" text-anchor="middle">燃油泵 M2</text>'
    +   '<g id="p-yv1"><rect class="proc-valve" x="202" y="304" width="16" height="16" rx="3"/>'
    +     '<path class="proc-valve-mark" d="M204 316 L216 308"/></g>'
    +   '<g id="p-yv2"><rect class="proc-valve" x="202" y="360" width="16" height="16" rx="3"/>'
    +     '<path class="proc-valve-mark" d="M204 372 L216 364"/></g>'
    +   '<text class="proc-label" x="186" y="300" text-anchor="end">YV1</text>'
    +   '<text class="proc-label" x="186" y="376" text-anchor="end">YV2</text>'
    + '</g>'
    /* 冷却 + 过滤 */
    + '<g id="p-cooler">'
    +   '<rect class="proc-dev" x="430" y="70" width="95" height="150" rx="14"/>'
    +   '<path class="proc-coil" d="M445 92 H510 M445 112 H510 M445 132 H510 M445 152 H510 M445 172 H510"/>'
    +   '<text class="proc-label" x="524" y="240" text-anchor="end">冷却器</text>'
    + '</g>'
    + '<g id="p-pumpcool">'
    +   '<circle class="proc-dev" cx="478" cy="300" r="24"/>'
    +   '<path class="proc-mark" d="M478 289 V311 M472 295 L478 289 L484 295"/>'
    +   '<text class="proc-label" x="478" y="344" text-anchor="middle">冷却泵 M3</text>'
    + '</g>'
    + '<g id="p-filter">'
    +   '<rect class="proc-dev" x="590" y="100" width="70" height="90" rx="12"/>'
    +   '<path class="proc-coil" d="M600 118 H650 M600 134 H650 M600 150 H650 M600 166 H650"/>'
    +   '<text class="proc-label" x="625" y="208" text-anchor="middle">过滤器</text>'
    + '</g>'
    /* 收集 */
    + '<g id="p-collect">'
    +   '<rect class="proc-dev" x="700" y="60" width="70" height="200" rx="16"/>'
    +   '<rect id="p-level" class="proc-level" x="704" y="254" width="62" height="0" rx="10"/>'
    +   '<text class="proc-label" x="735" y="284" text-anchor="middle">收集罐</text>'
    + '</g>'
    + '<g id="p-cvalve"><rect class="proc-valve" x="672" y="137" width="16" height="16" rx="3"/>'
    +   '<path class="proc-valve-mark" d="M674 149 L686 141"/></g>'
    + '<text class="proc-label" x="680" y="128" text-anchor="middle">收集阀</text>'
    /* 图例：色块颜色与管道介质一一对应 */
    + '<g class="proc-legend" aria-hidden="true">'
    +   '<g data-med="air"><rect class="lg-chip" x="556" y="330" width="10" height="10" rx="3"/><text x="571" y="339">空气</text></g>'
    +   '<g data-med="gas"><rect class="lg-chip" x="606" y="330" width="10" height="10" rx="3"/><text x="621" y="339">烟气</text></g>'
    +   '<g data-med="oil"><rect class="lg-chip" x="656" y="330" width="10" height="10" rx="3"/><text x="671" y="339">燃油</text></g>'
    +   '<g data-med="cw"><rect class="lg-chip" x="706" y="330" width="10" height="10" rx="3"/><text x="721" y="339">冷却水</text></g>'
    + '</g>'
    + '</svg>';

  stage.insertAdjacentHTML('afterbegin', SVG);

  var q = function (sel) { return stage.querySelector(sel); };
  var svgEl = {
    air: q('#p-air'), gas: q('#p-gas'), cool: q('#p-cool'), out: q('#p-out'),
    fuel0: q('#p-fuel0'), fuel1: q('#p-fuel1'), fuel2: q('#p-fuel2'), cw: q('#p-cw'),
    fan: q('#p-fan'), blades: q('#p-fan-blades'), flame: q('#p-flame'),
    yv1: q('#p-yv1'), yv2: q('#p-yv2'), pumpCool: q('#p-pumpcool'),
    cooler: q('#p-cooler'), collector: q('#p-collect'), level: q('#p-level'),
    cvalve: q('#p-cvalve'), o2: q('#p-o2')
  };

  /* ---------- 事件日志 ---------- */
  var logs = [];
  function log(text, kind) {
    logs.unshift({ text: text, kind: kind || 'info', t: new Date() });
    if (logs.length > 8) logs.pop();
    renderLog();
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function renderLog() {
    elLog.innerHTML = '';
    logs.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'proc-log-item is-' + item.kind;
      var tm = document.createElement('time');
      tm.className = 'proc-log-time';
      tm.textContent = pad2(item.t.getHours()) + ':' + pad2(item.t.getMinutes()) + ':' + pad2(item.t.getSeconds());
      var tx = document.createElement('span');
      tx.textContent = item.text;
      li.appendChild(tm);
      li.appendChild(tx);
      elLog.appendChild(li);
    });
  }

  function say(text, kind) {
    log(text, kind);
    host.classList.add('is-pulse');
    setTimeout(function () { host.classList.remove('is-pulse'); }, 400);
  }

  /* ---------- 联锁 ---------- */
  function fanHz() { return st.fan ? FAN_HZ[st.fan] : 0; }

  function canIgnite() {
    if (!st.running) return '系统未启动：先按「启动 S0」';
    if (!st.fan) return '联锁：先送风再点火（空气引入是燃烧前提）';
    return '';
  }
  function canOil() {
    if (!st.ignite) return '联锁：先点火后喷油，否则炉膛先积油';
    if (st.ton < st.delay) return 'TON1 未到：点火后还剩 ' + (st.delay - st.ton).toFixed(1) + ' s 才允许投油';
    return '';
  }
  function canValve(key) {
    if (!st.oil) return '联锁：燃油泵未运行，阀门不宜单独开';
    if (!st.oilPress) return '联锁：油压未建立（TON2 还剩 ' + Math.max(0, st.pDelay - st.ton2).toFixed(1) + ' s），先开阀等于空放';
    if (key === 'yv2' && !st.yv1Fb) return '联锁：先确认 YV1 开到位，再开 YV2 冲最大流速';
    return '';
  }
  function canCool() {
    if (st.o2 > O2_COOL) return '氧含量未达标（' + st.o2.toFixed(1) + '% > 15%），冷却无意义';
    return '';
  }
  function canCollect() {
    if (!st.cool) return '联锁：先开冷却泵再收集';
    if (!st.coolReady) return '联锁：冷却泵已起，出口还没建立（TON4 还剩 ' + Math.max(0, st.cDelay - st.ton4).toFixed(1) + ' s），现在抽等于把热烟气直接灌进罐';
    return '';
  }

  /* ---------- 设备动作 ---------- */
  function setDevice(key, on, silent) {
    if (st.esTop) return false;

    if (on) {
      if (!st.running) { if (!silent) say('系统未启动：先按「启动 S0」', 'warn'); return false; }
      var msg = '';
      if (key === 'ignite') msg = canIgnite();
      else if (key === 'oil') msg = canOil();
      else if (key === 'cool') msg = canCool();
      else if (key === 'collect') msg = canCollect();
      else if (key === 'yv1' || key === 'yv2') msg = canValve(key);
      if (msg) { if (!silent) say(msg, 'warn'); return false; }
    }

    st[key] = on;
    if (key === 'ignite') {
      st.ton = 0;
      if (!on) { st.oil = false; st.yv1 = false; st.yv2 = false; }
    }
    if (key === 'oil') {
      st.ton2 = 0; st.oilPress = false;
      if (!on) { st.yv1 = false; st.yv2 = false; }
    }
    if (key === 'cool') { st.ton4 = 0; st.coolReady = false; if (!on) st.collect = false; }

    var names = { ignite: '点火 L', oil: '燃油泵 M2', yv1: '阀 YV1', yv2: '阀 YV2', cool: '冷却泵 M3', collect: '收集阀' };
    if (!silent) say(names[key] + (on ? ' 得电' : ' 失电') + (key === 'yv1' || key === 'yv2' ? '（等阀位反馈）' : ''), on ? 'ok' : 'info');
    return true;
  }

  function start() {
    if (st.esTop) { say('急停状态：先复位再启动', 'warn'); return; }
    if (st.running) return;
    st.running = true;
    st.step = 1;
    st.gap = 0;
    /* 手动模式没有自动流程，阶段固定显示「手动操作」而不是卡在「启动中」 */
    st.phase = st.mode === 'manual' ? 'manual' : 'start';
    log('系统启动 S0：进入' + (st.mode === 'auto' ? '自动' : '手动') + '模式', 'ok');
  }

  function stop() {
    if (!st.running) return;
    st.running = false;
    st.fan = 0; st.ignite = false; st.oil = false; st.yv1 = false;
    st.yv2 = false; st.cool = false; st.collect = false;
    st.ton = 0; st.ton2 = 0; st.ton3 = 0; st.ton4 = 0;
    st.yv1T = 0; st.yv2T = 0;
    st.oilPress = false; st.yv1Fb = false; st.yv2Fb = false; st.coolReady = false;
    st.gap = 0; st.step = 0; st.phase = 'idle';
    log('系统停止：风机、油泵、冷却泵全部断开，油压与阀位随之复位', 'info');
  }

  /* 一键重置：所有输出断开、物理量回初值、日志清空。模式保留，免得手滑退回自动。 */
  function reset() {
    st.running = false;
    st.fan = 0; st.ignite = false; st.oil = false;
    st.yv1 = false; st.yv2 = false; st.cool = false; st.collect = false;
    st.ton = 0; st.ton2 = 0; st.ton3 = 0; st.ton4 = 0;
    st.yv1T = 0; st.yv2T = 0;
    st.oilPress = false; st.yv1Fb = false; st.yv2Fb = false; st.coolReady = false;
    st.gap = 0; st.step = 0; st.phase = 'idle'; st.esTop = false;
    st.o2 = O2_FRESH; st.level = 0;
    st.delay = TON_DEF.ton1; st.pDelay = TON_DEF.ton2;
    st.vDelay = TON_DEF.ton3; st.cDelay = TON_DEF.ton4;
    [delayInput, pInput, vInput, cInput].forEach(function (el, i) {
      if (el) el.value = [st.delay, st.pDelay, st.vDelay, st.cDelay][i];
    });
    logs.length = 0;
    log('已重置：输出全部断开，氧含量回 ' + O2_FRESH + '%，液位清零', 'info');
    render();
  }

  function eStop() {
    st.esTop = !st.esTop;
    if (st.esTop) {
      st.running = false; st.fan = 0; st.ignite = false; st.oil = false;
      st.yv1 = false; st.yv2 = false; st.cool = false; st.collect = false;
      st.ton = 0; st.ton2 = 0; st.ton3 = 0; st.ton4 = 0;
      st.yv1T = 0; st.yv2T = 0;
      st.oilPress = false; st.yv1Fb = false; st.yv2Fb = false; st.coolReady = false;
      st.gap = 0; st.step = 0; st.phase = 'estop';
      say('急停 S1 拍下（常闭断开）：全部输出复位', 'warn');
    } else {
      st.phase = 'idle';
      say('急停复位：可以重新启动', 'info');
    }
    syncButtons();
  }

  /* ---------- 自动流程：按报告里的工艺顺序推进 ----------
     每一步都等「上一个动作的信号真的到位」才走下一步：
     延时到 → 泵起来 → 油压建立 → 阀得电 → 阀位反馈 → 才进入燃烧。
     st.gap 是纯节奏用的停留，让画面有喘息，不至于一步接一步瞬跳。 */
  function autoTick(dt) {
    if (st.mode !== 'auto' || !st.running) return;
    if (st.gap > 0) { st.gap = Math.max(0, st.gap - dt); return; }
    switch (st.step) {
      case 1:
        st.fan = 1; st.phase = 'air';
        log('① 空气引入：风机 M1 一档 7.5 Hz', 'ok');
        st.step = 2; st.gap = 0.9; break;
      case 2:
        if (!st.fan) break;
        st.ignite = true; st.ton = 0; st.phase = 'ignite';
        log('② 点火：JIDENG 自锁，TON1 起算（' + st.delay + ' s）', 'ok');
        st.step = 3; st.gap = 0.5; break;
      case 3:
        if (st.ton < st.delay) break;
        st.oil = true; st.ton2 = 0; st.phase = 'press';
        log('③ TON1 到位：燃油泵 M2 投入，等油压建立（TON2 ' + st.pDelay + ' s）', 'ok');
        st.step = 4; st.gap = 0.5; break;
      case 4:
        if (!st.oilPress) break;
        st.yv1 = true; st.yv1T = 0; st.phase = 'valve';
        log('④ 油压建立：YV1 得电，等阀位开到位（TON3 ' + st.vDelay + ' s）', 'ok');
        st.step = 5; break;
      case 5:
        if (!st.yv1Fb) break;
        st.phase = 'burn';
        log('⑤ YV1 开到位（反馈正常）：点火成功，进入正常燃烧', 'ok');
        st.step = 6; st.gap = 0.7; break;
      case 6:
        if (st.o2 > O2_YV2) break;
        st.yv2 = true; st.yv2T = 0; st.fan = 2;
        log('⑥ 氧含量 ' + st.o2.toFixed(1) + '%：YV2 得电（最大流速），风机二档 25 Hz', 'ok');
        st.step = 7; break;
      case 7:
        if (st.o2 > O2_FAN3 || !st.yv2Fb) break;
        st.fan = 3;
        log('⑦ 氧含量 ' + st.o2.toFixed(1) + '% 且 YV2 已开到位：风机三档 45 Hz', 'info');
        st.step = 8; break;
      case 8:
        if (st.o2 > O2_DONE) break;
        st.cool = true; st.ton4 = 0; st.phase = 'cooling';
        log('⑧ 氧含量 ' + st.o2.toFixed(1) + '% 达标：先起冷却泵 M3，等出口建立（TON4 ' + st.cDelay + ' s）', 'ok');
        st.step = 9; break;
      case 9:
        if (!st.coolReady) break;
        st.collect = true; st.phase = 'cool';
        log('⑨ 冷却出口建立：收集阀开，烟气经冷却器进储罐', 'ok');
        st.step = 10; break;
      case 10:
        if (st.level < LEVEL_DONE) break;
        st.phase = 'done';
        log('⑩ 收集罐液位 ' + st.level.toFixed(0) + '%：惰气收集完成，可停止', 'ok');
        st.step = 0; break;
    }
  }

  /* ---------- 物理量：演示量级，不是实测 ----------
     节奏按「看得清」调：氧含量越接近 12% 掉得越慢（实际也是逼近平衡值），
     所以后半段不会一两秒就冲线，油压 / 阀位 / 冷却三个等待才看得见。 */
  function physics(dt) {
    // 油压：泵运行后按 TON2 建立；泵一停立刻掉
    if (st.oil) {
      if (st.ton2 < st.pDelay) st.ton2 = Math.min(st.pDelay, st.ton2 + dt);
      st.oilPress = st.ton2 >= st.pDelay;
    } else {
      st.ton2 = 0; st.oilPress = false;
    }

    // 阀位反馈：得电后要走完行程才算「开到位」
    valveFb('yv1', dt);
    valveFb('yv2', dt);

    // 冷却出口：冷却泵启动后按 TON4 建立
    if (st.cool) {
      if (st.ton4 < st.cDelay) st.ton4 = Math.min(st.cDelay, st.ton4 + dt);
      st.coolReady = st.ton4 >= st.cDelay;
    } else {
      st.ton4 = 0; st.coolReady = false;
    }

    // 真要喷油燃烧：泵在转、油压建立、至少一路阀已开、风机在送风
    var burning = st.ignite && st.oil && st.oilPress && st.fan > 0 && (st.yv1Fb || st.yv2Fb);
    if (burning && st.o2 > O2_DONE) {
      // 演示量级：一档单阀约 0.42 %/s，三档双阀最快约 0.9 %/s，且越接近终点越慢
      var rate = (0.46 + 0.18 * (st.fan - 1)) * (1 + 0.4 * (st.yv2 ? 1 : 0));
      rate *= Math.max(0.2, Math.min(1, (st.o2 - 6) / 13));
      st.o2 = Math.max(O2_DONE, st.o2 - rate * dt);
    } else if (burning) {
      // 到 12% 就进收集段：炉膛维持燃烧、氧含量稳住，不再往 4% 一路烧穿
    } else if (st.fan > 0 && st.o2 < O2_FRESH) {
      st.o2 = Math.min(O2_FRESH, st.o2 + 0.22 * dt);   // 只送风不燃烧，氧含量回升
    } else if (!st.fan && st.o2 < O2_FRESH) {
      st.o2 = Math.min(O2_FRESH, st.o2 + 0.05 * dt);
    }

    // 收集罐进液要等冷却出口真建立
    if (st.cool && st.collect && st.coolReady && st.o2 <= O2_COOL) {
      st.level = Math.min(100, st.level + 5.8 * dt);
    } else if (!st.collect && st.level > 0) {
      st.level = Math.max(0, st.level - 2 * dt);
    }

    if (st.running && st.ignite && !st.oil) st.ton = Math.min(st.delay + 1, st.ton + dt);
  }

  function valveFb(name, dt) {
    var tKey = name + 'T', fbKey = name + 'Fb';
    if (!st[name]) { st[tKey] = 0; st[fbKey] = false; return; }
    if (st[tKey] < st.vDelay) st[tKey] = Math.min(st.vDelay, st[tKey] + dt);
    var now = st[tKey] >= st.vDelay;
    if (now && !st[fbKey]) log((name === 'yv1' ? 'YV1' : 'YV2') + ' 阀位反馈到位（开到位信号回读）', 'ok');
    st[fbKey] = now;
  }

  /* ---------- 软硬件联调：上位机 → 现场 ----------
     右侧 3D 惰气场景在 build 时会把自己挂到 window.PROC_FIELD 上。
     这里每帧推一次状态，两边共用一个对象，不新建垃圾。 */
  var LINK = { running: false, fan: 0, freq: 0, oil: false, cool: false, collect: false, o2: O2_FRESH, level: 0, press: false, coolReady: false };

  function syncToField() {
    var f = window.PROC_FIELD;
    if (!f || !f.api || !f.api.setLink) return;
    LINK.running = st.running;
    LINK.fan = st.fan;
    LINK.freq = fanHz();
    /* 现场只认「真的有油在烧」：泵在转、油压建立、阀位确认，缺一样都不算 */
    LINK.oil = !!(st.ignite && st.oil && st.oilPress && (st.yv1Fb || st.yv2Fb));
    LINK.cool = st.cool;
    LINK.coolReady = st.coolReady;
    LINK.collect = st.collect;
    LINK.press = st.oilPress;
    LINK.stage = st.phase;
    LINK.o2 = st.o2;
    LINK.level = st.level;
    f.api.setLink(LINK);
  }

  /* ---------- 渲染 ---------- */
  function setText(el, v) {
    if (!el) return;
    if (el.textContent !== v) el.textContent = v;
  }

  var PHASE_TEXT = {
    idle: '待机', start: '启动中', air: '空气引入', ignite: '点火 / TON1',
    press: '油压建立 / TON2', valve: '阀位反馈 / TON3',
    burn: '燃烧降氧', 'burn-max': '最大流速降氧',
    manual: '手动操作',
    cooling: '冷却建立 / TON4', cool: '冷却过滤 · 收集',
    done: '收集完成', estop: '急停'
  };

  /* 流动速度 = 一个虚线周期（12px）走完的时间。
     虚线周期固定，所以不同长度的管子给同一个时长就是同一流速，不需要按长度换算。 */
  function flow(el, on, dur) {
    if (!el) return;
    el.classList.toggle('is-flow', !!on);
    if (on && dur) el.style.setProperty('--sp', dur + 's');
  }

  /* 四个 TON 的进度与状态字。状态字只在这四行里变，HUD 不跟着抖。 */
  function renderTons() {
    var list = [
      {
        pct: st.delay > 0 ? st.ton / st.delay : 1,
        ok: st.ignite && st.ton >= st.delay,
        txt: !st.ignite ? '待机' : st.ton >= st.delay ? '到位' : '计时 ' + st.ton.toFixed(1) + ' s'
      },
      {
        pct: st.oil && st.pDelay > 0 ? st.ton2 / st.pDelay : st.oilPress ? 1 : 0,
        ok: st.oilPress,
        txt: !st.oil ? '未建压' : st.oilPress ? '油压 OK' : '建压 ' + st.ton2.toFixed(1) + ' s'
      },
      {
        pct: st.vDelay > 0 ? Math.max(st.yv1 ? st.yv1T / st.vDelay : 0, st.yv2 ? st.yv2T / st.vDelay : 0) : (st.yv1 ? 1 : 0),
        ok: st.yv1Fb || st.yv2Fb,
        txt: st.yv1Fb && st.yv2Fb ? 'YV1+YV2 到位'
          : st.yv1Fb ? 'YV1 到位'
            : st.yv1 ? '行程 ' + st.yv1T.toFixed(1) + ' s'
              : st.yv2 ? '行程 ' + st.yv2T.toFixed(1) + ' s' : '全关'
      },
      {
        pct: st.cool && st.cDelay > 0 ? st.ton4 / st.cDelay : st.coolReady ? 1 : 0,
        ok: st.coolReady,
        txt: !st.cool ? '未建立' : st.coolReady ? '出口 OK' : '建立 ' + st.ton4.toFixed(1) + ' s'
      }
    ];
    TON_VIEW.forEach(function (v, i) {
      var it = list[i];
      if (!it) return;
      var p = Math.max(0, Math.min(1, it.pct)) * 100;
      if (v.bar) v.bar.style.width = p.toFixed(1) + '%';
      if (v.state) {
        if (v.txt !== it.txt) { v.state.textContent = it.txt; v.txt = it.txt; }
        v.state.classList.toggle('is-ok', !!it.ok);
      }
    });
  }

  function render() {
    setText(elPhase, PHASE_TEXT[st.phase] || '待机');
    setText(elO2, st.o2.toFixed(1) + '%');
    setText(elLevel, st.level.toFixed(0) + '%');
    setText(elHz, st.fan ? FAN_HZ[st.fan] + ' Hz' : '停');

    if (svgEl.o2) setText(svgEl.o2, 'O₂ ' + st.o2.toFixed(1) + '%');

    // 真正在烧：泵在转、油压建立、阀已开到位（反馈）、风机在送风
    var burning = st.ignite && st.oil && st.oilPress && st.fan > 0 && (st.yv1Fb || st.yv2Fb);

    // 风机与火焰
    svgEl.blades.classList.toggle('is-on', st.fan > 0);
    svgEl.blades.style.animationDuration = st.fan === 3 ? '0.5s' : st.fan === 2 ? '0.8s' : '1.3s';
    svgEl.flame.classList.toggle('is-on', burning);

    // 管道流动（时长越短流得越快；风机档位直接反映在风速上）
    var wind = st.fan === 3 ? 0.13 : st.fan === 2 ? 0.18 : 0.27;
    flow(svgEl.air, st.fan > 0, wind);
    flow(svgEl.gas, burning, 0.2);
    flow(svgEl.cool, st.cool, 0.19);
    flow(svgEl.out, st.collect && st.coolReady, 0.19);
    flow(svgEl.fuel0, st.oil && st.oilPress, 0.22);
    flow(svgEl.fuel1, st.oil && st.oilPress && st.yv1Fb, 0.22);
    flow(svgEl.fuel2, st.oil && st.oilPress && st.yv2Fb, 0.22);
    flow(svgEl.cw, st.cool, 0.2);

    // 阀门
    [['yv1', svgEl.yv1], ['yv2', svgEl.yv2], ['collect', svgEl.cvalve]].forEach(function (p) {
      var node = p[1];
      if (!node) return;
      node.classList.toggle('is-on', !!st[p[0]]);
    });
    svgEl.pumpCool.classList.toggle('is-on', st.cool);
    svgEl.cooler.classList.toggle('is-on', st.cool);
    svgEl.collector.classList.toggle('is-on', st.collect);

    // 液位
    var h = 190 * st.level / 100;
    svgEl.level.setAttribute('y', (254 - h).toFixed(1));
    svgEl.level.setAttribute('height', h.toFixed(1));

    renderTons();
    syncButtons();
    syncToField();
  }

  /* ---------- 按钮状态 ---------- */
  var DEVICES = [
    { key: 'fan', label: '风机 M1' },
    { key: 'ignite', label: '点火 L' },
    { key: 'oil', label: '燃油泵 M2' },
    { key: 'yv1', label: '阀 YV1' },
    { key: 'yv2', label: '阀 YV2' },
    { key: 'cool', label: '冷却泵 M3' },
    { key: 'collect', label: '收集阀' }
  ];
  var deviceBtns = {};

  DEVICES.forEach(function (d) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'proc-dev-btn';
    b.innerHTML = '<i></i><span>' + d.label + '</span>';
    b.addEventListener('click', function () {
      if (st.mode !== 'manual') { say('自动模式下设备由程序驱动，切到手动才能单独操作', 'warn'); return; }
      if (d.key === 'fan') {
        if (!st.running && st.fan === 0) { say('系统未启动：先按「启动 S0」', 'warn'); return; }
        // 手动没有单独的档位按钮：点一次升一档，到三档再点就停
        st.fan = (st.fan + 1) % 4;
        var name = ['停', '一档', '二档', '三档'];
        say('风机 M1：' + name[st.fan] + (st.fan ? ' ' + FAN_HZ[st.fan] + ' Hz' : ''), st.fan ? 'ok' : 'info');
        render();
        return;
      }
      setDevice(d.key, !st[d.key]);
    });
    devicesBox.appendChild(b);
    deviceBtns[d.key] = b;
  });

  function syncButtons() {
    var manual = st.mode === 'manual';
    DEVICES.forEach(function (d) {
      var b = deviceBtns[d.key];
      if (!b) return;
      var on = d.key === 'fan' ? st.fan > 0 : !!st[d.key];
      b.classList.toggle('is-on', on);
      if (d.key === 'fan') {
        var span = b.querySelector('span');
        var txt = st.fan ? '风机 M1 · ' + ['', '一档', '二档', '三档'][st.fan] : '风机 M1';
        setText(span, txt);
      }
      if (b.disabled !== !manual) b.disabled = !manual;
    });
    var startBtn = document.getElementById('proc-start');
    var stopBtn = document.getElementById('proc-stop');
    var estopBtn = document.getElementById('proc-estop');
    if (startBtn && startBtn.disabled !== st.running) startBtn.disabled = st.running;
    if (stopBtn && stopBtn.disabled !== !st.running) stopBtn.disabled = !st.running;
    if (estopBtn) {
      setText(estopBtn, st.esTop ? '急停已拍 · 复位' : '急停 S1');
      estopBtn.classList.toggle('is-on', st.esTop);
    }
    // 四个延时的预设值两种模式都能改，跟真实 HMI 一样
    [delayInput, pInput, vInput, cInput].forEach(function (el) {
      if (el && el.disabled) el.disabled = false;
    });
  }

  /* ---------- 模式与主控按钮 ---------- */
  var modeBtns = host.querySelectorAll('[data-mode]');
  Array.prototype.forEach.call(modeBtns, function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-mode');
      if (m === st.mode) return;
      st.mode = m;
      Array.prototype.forEach.call(modeBtns, function (x) {
        x.classList.toggle('is-on', x.getAttribute('data-mode') === m);
      });
      if (m === 'manual') {
        st.step = 0;
        if (st.running) st.phase = 'manual';
        say('切到手动：设备逐个操作，联锁仍生效', 'info');
      } else {
        st.step = st.running ? 1 : 0;
        say('切到自动：重新按流程推进', 'info');
      }
      render();
    });
  });

  document.getElementById('proc-start').addEventListener('click', function () { start(); render(); });
  document.getElementById('proc-stop').addEventListener('click', function () { stop(); render(); });
  document.getElementById('proc-estop').addEventListener('click', eStop);
  var resetBtn = document.getElementById('proc-reset');
  if (resetBtn) resetBtn.addEventListener("click", function () { reset(); });

  /* 四个延时都能在运行中改：跟真实 HMI 一样，改完下一个周期按新值计时 */
  [
    { el: delayInput, key: 'delay', def: TON_DEF.ton1, max: 20 },
    { el: pInput, key: 'pDelay', def: TON_DEF.ton2, max: 10 },
    { el: vInput, key: 'vDelay', def: TON_DEF.ton3, max: 8 },
    { el: cInput, key: 'cDelay', def: TON_DEF.ton4, max: 12 }
  ].forEach(function (c) {
    if (!c.el) return;
    c.el.addEventListener('change', function () {
      var v = parseFloat(c.el.value);
      st[c.key] = isNaN(v) ? c.def : Math.max(0, Math.min(c.max, v));
      c.el.value = st[c.key];
      say('延时预设改为 ' + st[c.key] + ' s', 'info');
    });
  });

  /* ---------- 主循环：进视野才跑 ---------- */
  var last = 0, active = false;

  function frame(t) {
    if (!active) return;
    if (!last) last = t;
    var dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (dt > 0) {
      physics(dt);
      autoTick(dt);
      render();
    }
    requestAnimationFrame(frame);
  }

  if ('IntersectionObserver' in window) {
    /* 观察整个联调区（左上位机 + 右现场）：设备按钮已经挪到右边，
       只盯 #proc 的话，单独看现场时流程会停住。 */
    var watch = document.getElementById('link') || host;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        active = en.isIntersecting;
        if (active) { last = 0; requestAnimationFrame(frame); }
      });
    }, { threshold: 0.08 }).observe(watch);
  } else {
    active = true;
    requestAnimationFrame(frame);
  }

  log('待机：设备全部停止，氧含量 ' + O2_FRESH + '%', 'info');
  render();
})();
