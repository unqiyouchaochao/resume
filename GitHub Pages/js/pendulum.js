/* 倒立摆实时仿真：Three.js 渲染 + 120Hz 定步长积分 + 2D 示波器 */
(function () {
  var canvas = document.getElementById('sim-canvas');
  var scope = document.getElementById('scope');
  if (!canvas || !scope) return;

  /* ---------- 物理参数 ---------- */
  var M = 1.0;        // 小车质量 kg
  var m = 0.2;        // 摆杆质量 kg
  var l = 0.5;        // 摆杆半长 m
  var g = 9.81;
  var DT = 1 / 120;
  var FMAX = 40;      // 执行器力限 N
  var CLAMP = 0.12;   // 位置环给出的姿态参考饱和
  var FALL = 1.15;    // 判定倒下的角度 rad
  var XLIM = 2.1;     // 导轨行程 m

  var s = { x: 0, v: 0, th: 0.22, w: 0, t: 0, F: 0 };
  var DEFAULT = { kp: 120, kd: 15, kc: 0.03, kv: 0.10 };   // 与 index.html 里滑块的 value 保持一致
  var gains = { kp: DEFAULT.kp, kd: DEFAULT.kd, kc: DEFAULT.kc, kv: DEFAULT.kv };
  var running = true;
  var fallen = false;
  var buf = [];       // 示波器采样
  var BUF_MAX = 12 * 120;

  function reset() {
    s.x = 0; s.v = 0; s.th = 0.22; s.w = 0; s.t = 0; s.F = 0;
    fallen = false; buf.length = 0; buf.push({ th: s.th, x: s.x });
    kickT = 99;          /* 别让「扰动响应」那句留在解说条上 */
  }

  function step() {
    var thRef = Math.max(-CLAMP, Math.min(CLAMP, -gains.kc * s.x - gains.kv * s.v));
    var F = gains.kp * (s.th - thRef) + gains.kd * s.w;
    if (fallen) F = 0;
    F = Math.max(-FMAX, Math.min(FMAX, F));
    s.F = F;

    var pm = m * l, tot = M + m;
    var st = Math.sin(s.th), ct = Math.cos(s.th);
    var temp = (F + pm * s.w * s.w * st) / tot;
    var thacc = (g * st - ct * temp) / (l * (4 / 3 - m * ct * ct / tot));
    var xacc = temp - pm * thacc * ct / tot;

    s.v += xacc * DT; s.x += s.v * DT;
    s.w += thacc * DT; s.th += s.w * DT;
    s.t += DT;

    if (Math.abs(s.th) > FALL) {
      fallen = true;
      setState('已倒下 · 点「重新摆起」');
    } else if (Math.abs(s.x) > XLIM) {
      fallen = true;
      s.x = Math.sign(s.x) * XLIM;
      s.v = 0;
      setState('小车越界 · 点「重新摆起」');
    }
  }

  /* ---------- 3D ---------- */
  var renderer = null, scene, camera, cartGroup, poleGroup, forceBar, gridLines = [];
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var C_GOLD = dark ? 0xc9a86a : 0xa67c3d;
  var C_INK = dark ? 0xd8d2c6 : 0x2b2823;
  var C_LINE = dark ? 0x3b362c : 0xe2ddd2;

  function initGL() {
    if (!window.THREE) { canvas.dataset.glError = 'THREE 未加载'; return false; }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
      });
    } catch (e) {
      canvas.dataset.glError = (e && e.message) || String(e);
      return false;
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0.15, 0.98, 2.8);
    /* 视线压到 0.47：整机在画面里上移一点，给底部解说条让位（不然小车被压住一半） */
    camera.lookAt(0, 0.47, 0);

    /* 和三维场景同一条口径：深色底上光强反过来压一档，否则小车与摆杆的白色顶到纯白、看不出体积 */
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, dark ? 0.82 : 1.15));
    var dir = new THREE.DirectionalLight(0xffffff, dark ? 0.78 : 1.1);
    dir.position.set(2.2, 4, 3);
    scene.add(dir);

    /* 导轨 */
    var rail = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 0.02, 0.34),
      new THREE.MeshStandardMaterial({ color: C_LINE, roughness: 0.95, metalness: 0 })
    );
    rail.position.y = -0.012;
    scene.add(rail);

    /* 刻度线 */
    for (var i = -4; i <= 4; i++) {
      var geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i * 0.5, 0.012, -0.17),
        new THREE.Vector3(i * 0.5, 0.012, 0.17)
      ]);
      var mat = new THREE.LineBasicMaterial({
        color: C_GOLD, transparent: true, opacity: i === 0 ? 0.85 : 0.28
      });
      var line = new THREE.Line(geo, mat);
      scene.add(line);
      gridLines.push(line);
    }

    /* 小车 */
    cartGroup = new THREE.Group();
    var cart = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.16, 0.34),
      new THREE.MeshStandardMaterial({ color: C_INK, roughness: 0.55, metalness: 0.15 })
    );
    cart.position.y = 0.09;
    cartGroup.add(cart);

    var cartEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 0.16, 0.34)),
      new THREE.LineBasicMaterial({ color: C_GOLD, transparent: true, opacity: 0.55 })
    );
    cartEdge.position.y = 0.09;
    cartGroup.add(cartEdge);

    [-0.18, 0.18].forEach(function (dx) {
      var wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.05, 18),
        new THREE.MeshStandardMaterial({ color: C_GOLD, roughness: 0.4, metalness: 0.3 })
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(dx, 0, 0);
      cartGroup.add(wheel);
    });

    /* 摆杆 */
    poleGroup = new THREE.Group();
    poleGroup.position.y = 0.17;
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 1, 14),
      new THREE.MeshStandardMaterial({ color: C_GOLD, roughness: 0.35, metalness: 0.35 })
    );
    pole.position.y = 0.5;
    poleGroup.add(pole);
    var bob = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 18, 14),
      new THREE.MeshStandardMaterial({ color: C_GOLD, roughness: 0.25, metalness: 0.5 })
    );
    bob.position.y = 1;
    poleGroup.add(bob);
    cartGroup.add(poleGroup);

    scene.add(cartGroup);

    /* 推力指示条 */
    forceBar = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.028, 0.06),
      new THREE.MeshStandardMaterial({ color: C_GOLD, transparent: true, opacity: 0.45 })
    );
    forceBar.position.y = 0.005;
    scene.add(forceBar);

    resizeGL();
    if (window.ResizeObserver) new ResizeObserver(resizeGL).observe(canvas);
    return true;
  }

  function resizeGL() {
    if (!renderer) return;
    var w = canvas.clientWidth || 520;
    var h = canvas.clientHeight || 420;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function drawGL() {
    if (!renderer) return;
    cartGroup.position.x = s.x;
    poleGroup.rotation.z = -s.th;

    var fw = Math.min(Math.abs(s.F) / FMAX, 1) * 1.1;
    forceBar.visible = fw > 0.02 && !fallen;
    if (forceBar.visible) {
      forceBar.scale.x = Math.max(fw, 0.001);
      forceBar.position.x = s.x + (s.F > 0 ? fw / 2 : -fw / 2);
      forceBar.position.z = 0.24;
    }
    renderer.render(scene, camera);
  }

  /* ---------- 示波器 ---------- */
  var sctx = scope.getContext('2d');
  function resizeScope() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = scope.clientWidth || 480;
    var h = 150;
    scope.width = w * dpr;
    scope.height = h * dpr;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.__w = w; sctx.__h = h;
  }
  resizeScope();
  if (window.ResizeObserver) new ResizeObserver(resizeScope).observe(scope);

  function drawScope() {
    var w = sctx.__w || 480, h = sctx.__h || 150;
    sctx.clearRect(0, 0, w, h);

    sctx.strokeStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(26,26,26,.07)';
    sctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var y = (h / 4) * i;
      sctx.beginPath(); sctx.moveTo(0, y); sctx.lineTo(w, y); sctx.stroke();
    }
    sctx.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(26,26,26,.16)';
    sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();

    var n = buf.length;
    if (n < 2) return;

    function plot(getVal, scale, color) {
      sctx.beginPath();
      sctx.strokeStyle = color;
      sctx.lineWidth = 1.6;
      var stepX = w / (BUF_MAX - 1);
      for (var k = 0; k < n; k++) {
        var val = getVal(buf[k]);
        var yy = h / 2 - Math.max(-1.15, Math.min(1.15, val / scale)) * (h / 2 - 6);
        // 最新样本贴右边缘，历史向左延伸
        var xx = w - (n - 1 - k) * stepX;
        if (k === 0) sctx.moveTo(xx, yy); else sctx.lineTo(xx, yy);
      }
      sctx.stroke();
    }

    plot(function (p) { return p.th; }, 0.30, dark ? '#c9a86a' : '#a67c3d');
    plot(function (p) { return p.x; }, 0.80, dark ? 'rgba(216,210,198,.75)' : 'rgba(43,40,35,.55)');
  }

  /* ---------- HUD ---------- */
  var hudTheta = document.getElementById('hud-theta');
  var hudX = document.getElementById('hud-x');
  var hudF = document.getElementById('hud-f');
  var hudState = document.getElementById('hud-state');
  var narrEl = document.getElementById('demo-narr');
  var narrTxt = null, narrAcc = 1, kickT = 99;

  function setState(text) {
    if (hudState) hudState.textContent = text;
  }

  /* ---------- 解说条 ----------
   * 把「此刻控制器在干什么」写成一句话：起摆 → 收敛 → 位置环回中 → 稳态，
   * 以及倒下 / 越界 / 增益不合适时的判读。数字每 0.4 s 刷一次，不做逐帧跳动。 */
  function buildNarr() {
    var deg = s.th * 180 / Math.PI;
    var absDeg = Math.abs(deg);
    if (fallen) {
      if (Math.abs(s.x) >= XLIM - 0.01) {
        return '<b>小车撞到行程末端</b>' + XLIM + ' m：姿态守住了，但位置环追不上，车被一路推到边界。把 K<sub>p</sub> 拖到 60 以上，或减小 K<sub>c</sub>，再点「重新摆起」。';
      }
      return '<b>摆角超过 ' + (FALL * 180 / Math.PI).toFixed(0) + '°</b>，已按倒下处理、输出归零：说明这一组增益的回复力矩不够。先把 K<sub>p</sub> 调大，再点「重新摆起」。';
    }
    if (!running) {
      return '已暂停：θ = ' + deg.toFixed(1) + '°，x = ' + s.x.toFixed(2) + ' m，F = ' + s.F.toFixed(1) + ' N。点「继续」接着积分。';
    }
    if (kickT < 2.2) {
      return '<b>扰动响应</b>：注入 +1.5 rad/s 角速度冲击，θ 被推开后微分项立刻反向加力制动，' +
        '位移偏出 ' + s.x.toFixed(2) + ' m，再由位置环慢慢收回原点。';
    }
    if (gains.kp < 45) {
      return 'K<sub>p</sub> 偏小（' + gains.kp + '）：回复力矩不够，摆杆会先倒、小车再被拖着跑——这正是把 K<sub>p</sub> 拖到最低时看到的失效方式。';
    }
    if (gains.kd < 4) {
      return 'K<sub>d</sub> 偏小（' + gains.kd + '）：只有比例项在拉，回摆压不住，θ 会来回振荡越摆越大。补一点阻尼就收敛。';
    }
    if (s.t < 0.8) {
      return '<b>起摆</b>：初始偏角 12.6°，比例项先给反方向力把摆杆往竖直掰，微分项同时压住回摆速度。';
    }
    if (absDeg > 4) {
      return '<b>收敛中</b>：θ 还差 ' + absDeg.toFixed(1) + '°，F = ' + s.F.toFixed(1) +
        ' N，由 K<sub>p</sub>·θ + K<sub>d</sub>·θ̇ 实时算出来，不是查表。';
    }
    if (Math.abs(s.x) > 0.12) {
      return '<b>位置环介入</b>：姿态已守住，θ<sub>ref</sub> = −(K<sub>c</sub>·x + K<sub>v</sub>·v)。' +
        '用「先倾斜、再回位」的办法把小车从 ' + s.x.toFixed(2) + ' m 拉回 0。';
    }
    return '<b>稳态</b>：θ = ' + deg.toFixed(1) + '°，x = ' + s.x.toFixed(2) +
      ' m，F 在 ±2 N 内小幅修正。控制器每 1/120 s 算一次，整定值就是滑块上这四个。';
  }

  function narrate() {
    if (!narrEl) return;
    var t = buildNarr();
    if (t === narrTxt) return;
    narrTxt = t;
    narrEl.innerHTML = t;
    narrEl.classList.toggle('is-on', !!t);
  }

  function drawHUD() {
    if (hudTheta) hudTheta.textContent = (s.th * 180 / Math.PI).toFixed(1);
    if (hudX) hudX.textContent = s.x.toFixed(2);
    if (hudF) hudF.textContent = s.F.toFixed(1);
    if (!fallen) setState(running ? '运行中' : '已暂停');
  }

  /* ---------- 主循环 ---------- */
  var acc = 0, last = 0, hudAcc = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min((now - last) / 1000, 0.1) : 0.016;
    last = now;
    /* 视口外既不积分也不渲染：页面现在另有 3 个 WebGL 场景，别一起烧 */
    if (!visible) return;

    if (running) {
      kickT += dt;
      acc += dt;
      var guard = 0;
      while (acc >= DT && guard < 8) {
        step(); acc -= DT; guard++;
        buf.push({ th: s.th, x: s.x });
      }
      if (guard === 8) acc = 0;
      if (buf.length > BUF_MAX) buf.splice(0, buf.length - BUF_MAX);
      hudAcc += dt;
      if (hudAcc > 0.1) { hudAcc = 0; drawHUD(); }
    }

    /* 解说条跟着状态走，暂停时也要刷（所以放在 running 之外） */
    narrAcc += dt;
    if (narrAcc > 0.35) { narrAcc = 0; narrate(); }

    drawGL();
    drawScope();
  }

  /* ---------- 控件 ---------- */
  var controls = {};   // 供「一键复原」回写滑块用
  function bindSlider(id, outId, key, digits) {
    var input = document.getElementById(id);
    var out = document.getElementById(outId);
    if (!input) return;
    function sync() {
      var val = parseFloat(input.value);
      gains[key] = val;
      if (out) out.textContent = digits ? val.toFixed(digits) : String(Math.round(val));
    }
    input.addEventListener('input', sync);
    sync();
    controls[key] = { input: input, sync: sync };
  }

  bindSlider('g-kp', 'o-kp', 'kp', 0);
  bindSlider('g-kd', 'o-kd', 'kd', 0);
  bindSlider('g-kc', 'o-kc', 'kc', 2);
  bindSlider('g-kv', 'o-kv', 'kv', 2);

  var btnKick = document.getElementById('btn-kick');
  var btnReset = document.getElementById('btn-reset');
  var btnRestore = document.getElementById('btn-restore');
  var btnPause = document.getElementById('btn-pause');

  btnKick && btnKick.addEventListener('click', function () {
    if (fallen) { reset(); }
    s.w += 1.5;
    s.v += 0.35;
    kickT = 0;
    setState('扰动中');
  });

  btnReset && btnReset.addEventListener('click', function () {
    reset();
    running = true;
    if (btnPause) btnPause.textContent = '暂停';
    setState('运行中');
  });

  /* 一键复原：滑块回默认值 + 重新摆起 + 继续运行 */
  btnRestore && btnRestore.addEventListener('click', function () {
    Object.keys(DEFAULT).forEach(function (k) {
      var c = controls[k];
      if (!c) return;
      c.input.value = DEFAULT[k];
      c.sync();
    });
    reset();
    running = true;
    if (btnPause) btnPause.textContent = '暂停';
    setState('已复原 · 运行中');
  });

  btnPause && btnPause.addEventListener('click', function () {
    running = !running;
    btnPause.textContent = running ? '暂停' : '继续';
    setState(running ? '运行中' : '已暂停');
  });

  /* 视口外暂停渲染 */
  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0 }).observe(canvas);
  }

  /* ---------- 启动 ---------- */
  reset();
  var ok = initGL();
  if (!ok) {
    canvas.style.display = 'none';
    var fb = document.getElementById('sim-fallback');
    if (fb) fb.hidden = false;
    setState('2D 模式');
  }
  requestAnimationFrame(loop);

  /* 调试用：控制台可读当前状态与增益 */
  window.__pendulum = { state: s, gains: gains };
})();
