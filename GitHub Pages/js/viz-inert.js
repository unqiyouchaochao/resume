/* 惰气控制系统 · 三维拆解
 * ABB AC500 PM556 + 力控组态：空气引入 → 点火降氧 → 冷却过滤 → 惰气收集
 * 每个部件挂真实踩过的故障项（来自简历里的 5 类典型故障）
 */
(function () {
  if (!window.VIZ_SCENES) window.VIZ_SCENES = {};

  var C = {
    steel: 0xa9b4bd,      /* 不锈钢 */
    steelDark: 0x6d767e,
    dark: 0x39424b,       /* 铸铁深灰 */
    body: 0x7f8a94,       /* 设备灰 */
    burner: 0x97928d,     /* 燃烧室外壳（中性暖灰，toon 暗阶下不发棕） */
    pump: 0x2a6da8,       /* 泵 / 电机蓝 */
    valve: 0x4a5b66,
    wheel: 0xb03a2e,      /* 手轮红 */
    filter: 0x2f7896,
    tank: 0xd2d8db,       /* 储罐银白 */
    cab: 0x8c8e90,        /* 控制柜米灰（toon 暗阶下要能跟变频器分开） */
    brass: 0xb08d4f,
    warn: 0xe8c14a,
    flame: 0xff8a3d,
    gas: 0xa8c8d8
  };

  function makeMat(THREE, color, opts) {
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.2 });
    if (opts) {
      for (var k in opts) {
        if (!opts.hasOwnProperty(k)) continue;
        if (k === 'emissive') m.emissive.setHex(opts[k]);
        else if (k === 'color') m.color.setHex(opts[k]);
        else m[k] = opts[k];
      }
    }
    return m;
  }

  /* 上漆：不透明材质统一贴一张灰白噪声图，颜色仍由 color 决定 */
  function paintMat(THREE, color, opts) {
    var m = makeMat(THREE, color, opts);
    if (window.VIZ_TEX && !m.transparent && !m.map) {
      m.map = window.VIZ_TEX.noise();
      m.needsUpdate = true;
    }
    return m;
  }

  window.VIZ_SCENES.inert = {
    title: '惰气控制系统 · 三维拆解',
    greeting: '点部件，看它的作用、对应信号，以及现场坏过的那一次。',
    sub: 'ABB AC500 PM556 + 力控组态 · 2026.07 · 点部件看它当年怎么坏过',
    camera: { theta: 0.4, phi: 1.14, radius: 8.8, target: [0.0, 0.9, 0] },
    build: function (ctx) {
      var THREE = ctx.THREE, scene = ctx.scene, gold = ctx.gold, ink = ctx.ink, line = ctx.line;
      var parts = [];
      var st = { phase: 'idle', t: 0, fan: false, oil: false, flame: 0, pressure: 0, freq: 0, link: null };
      var pipeTint = {};   /* 管路染色登记表：id -> { mesh, on } */
      var acc = 0;
      var fanBlades, flameMesh, flameCore, glowLamp, flowPts = [];

      function reg(group, id, name, desc, io, dir, dist) {
        group.userData.part = id;
        group.userData.name = name;
        group.userData.desc = desc;
        group.userData.io = io || '';
        group.userData.base = group.position.clone();
        group.userData.dir = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
        group.userData.dist = dist;
        parts.push(group);
        scene.add(group);
      }

      /* ---------- 彩绘小件 ---------- */
      var TEX = window.VIZ_TEX;

      function plateMesh(text, sub, w, h) {
        var m = new THREE.MeshStandardMaterial({ map: TEX.plate(text, sub), roughness: 0.72, metalness: 0.06 });
        return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      }

      function ringMesh(r, tube, color, seg) {
        return new THREE.Mesh(
          new THREE.TorusGeometry(r, tube, 8, seg || 20),
          makeMat(THREE, color === undefined ? gold : color, { metalness: 0.45, roughness: 0.42 })
        );
      }

      /* 竖直法兰上的螺栓（绕 X 轴排一圈） */
      function boltsX(parent, x, r, count, len) {
        for (var i = 0; i < count; i++) {
          var a = (Math.PI * 2 / count) * i;
          var b = new THREE.Mesh(
            new THREE.CylinderGeometry(0.016, 0.016, len, 6),
            makeMat(THREE, 0x5f6357, { metalness: 0.65, roughness: 0.38 })
          );
          b.rotation.z = Math.PI / 2;
          b.position.set(x, Math.cos(a) * r, Math.sin(a) * r);
          parent.add(b);
        }
      }

      /* 顶部手轮（轴沿 Y） */
      function handwheel(r) {
        var g = new THREE.Group();
        var rim = ringMesh(r, 0.026, C.wheel, 22);
        rim.rotation.x = Math.PI / 2;
        g.add(rim);
        for (var i = 0; i < 3; i++) {
          var sp = new THREE.Mesh(
            new THREE.BoxGeometry(r * 1.9, 0.022, 0.022),
            makeMat(THREE, C.wheel, { metalness: 0.3 })
          );
          sp.rotation.y = (Math.PI / 3) * i;
          g.add(sp);
        }
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), makeMat(THREE, C.wheel, { metalness: 0.4 }));
        g.add(hub);
        return g;
      }

      /* 接地阴影：一张径向渐变的透明贴片，比开 shadowMap 便宜得多 */
      function blob(x, z, rx, rz, a) {
        var cv = document.createElement('canvas');
        cv.width = cv.height = 128;
        var g2 = cv.getContext('2d');
        var grad = g2.createRadialGradient(64, 64, 4, 64, 64, 62);
        grad.addColorStop(0, 'rgba(30,25,18,' + (a || 0.26) + ')');
        grad.addColorStop(0.65, 'rgba(30,25,18,' + (a || 0.26) * 0.35 + ')');
        grad.addColorStop(1, 'rgba(30,25,18,0)');
        g2.fillStyle = grad;
        g2.beginPath(); g2.arc(64, 64, 62, 0, Math.PI * 2); g2.fill();
        var m = new THREE.Mesh(
          new THREE.PlaneGeometry(rx * 2, rz * 2),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.004, z);
        m.renderOrder = 1;
        scene.add(m);
      }

      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120),
        makeMat(THREE, line, { roughness: 1, metalness: 0, transparent: true, opacity: 0.16 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.01;
      scene.add(floor);

      /* ---------- 风机 ---------- */
      var fanG = new THREE.Group();
      fanG.position.set(-4.3, 0.5, 0.15);
      var fanCase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 20), paintMat(THREE, C.body, { metalness: 0.4, roughness: 0.5 }));
      fanCase.rotation.z = Math.PI / 2;
      fanG.add(fanCase);
      fanBlades = new THREE.Group();
      for (var i = 0; i < 6; i++) {
        var blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.1), makeMat(THREE, gold, { metalness: 0.5 }));
        blade.position.y = 0.15;
        blade.rotation.x = (Math.PI / 3) * i;
        blade.position.set(0, 0, 0);
        var holder = new THREE.Group();
        holder.rotation.x = (Math.PI / 3) * i;
        var bl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.1), makeMat(THREE, gold, { metalness: 0.5 }));
        bl.position.set(0.18, 0, 0);
        bl.rotation.x = 0.5;
        holder.add(bl);
        fanBlades.add(holder);
      }
      fanBlades.position.x = 0.02;
      fanG.add(fanBlades);
      var fanStand = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.5, 0.5), paintMat(THREE, ink, { metalness: 0.35 }));
      fanStand.position.set(-0.05, -0.25, 0);
      fanG.add(fanStand);
      /* 进风格栅 + 机壳铭牌 */
      var grille = new THREE.Mesh(
        new THREE.CircleGeometry(0.4, 26),
        new THREE.MeshStandardMaterial({ map: TEX.grille(), roughness: 0.58, metalness: 0.35 })
      );
      grille.rotation.y = -Math.PI / 2;
      grille.position.x = -0.175;
      fanG.add(grille);
      var fanPlate = plateMesh('送风机', 'FAN-01', 0.26, 0.098);
      fanPlate.position.set(0.02, 0.02, 0.421);
      fanG.add(fanPlate);
      [-0.26, 0.26].forEach(function (bx) {
        var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), makeMat(THREE, C.dark, { metalness: 0.4 }));
        foot.position.set(bx, -0.485, 0.2);
        fanG.add(foot);
      });
      reg(fanG, 'fan', '送风机',
        '为燃烧提供空气。频率经 Modbus 写变频器寄存器给定，三档约 7.5 / 25 / 45 Hz；给完要回读实际频率核对跟随。',
        'DO 启动 · Modbus 频率给定 / 回读', [-1, 0, 0], 1.2);

      /* ---------- 变频器 ---------- */
      var vfdG = new THREE.Group();
      vfdG.position.set(-3.9, 0, -2.1);
      var vfdBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), paintMat(THREE, C.dark, { metalness: 0.32, roughness: 0.5 }));
      vfdBox.position.y = 0.55;
      vfdG.add(vfdBox);
      var vfdScr = new THREE.Mesh(
        new THREE.PlaneGeometry(0.32, 0.2),
        new THREE.MeshBasicMaterial({ map: TEX.screen('vfd') })
      );
      vfdScr.position.set(0, 0.86, 0.203);
      vfdG.add(vfdScr);
      for (var vf = 0; vf < 5; vf++) {
        var louver = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.018, 0.02), makeMat(THREE, 0x24292e, { metalness: 0.4 }));
        louver.position.set(0, 0.52 - vf * 0.05, 0.2);
        vfdG.add(louver);
      }
      var vfdPlate = plateMesh('ACS355', 'ABB', 0.22, 0.083);
      vfdPlate.position.set(0, 0.3, 0.203);
      vfdG.add(vfdPlate);
      var vfdKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14), makeMat(THREE, 0xd9d3c6, { metalness: 0.2 }));
      vfdKnob.rotation.x = Math.PI / 2;
      vfdKnob.position.set(0, 0.16, 0.21);
      vfdG.add(vfdKnob);
      reg(vfdG, 'vfd', 'ACS355 变频器',
        '分档调速的执行端。通讯超时多半是 PLC 扫描周期太短（需 ≥20 ms），报文没发完下一帧就来了。',
        'Modbus TCP 写 WR 区 · 频率回读', [1, 0, -0.8], 1.3);

      /* ---------- 燃油泵 ---------- */
      var fpG = new THREE.Group();
      fpG.position.set(-2.7, 0, 1.5);
      var fpBase = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.1, 0.42), paintMat(THREE, ink, { metalness: 0.4 }));
      fpBase.position.set(0.12, 0.05, 0);
      fpG.add(fpBase);
      var fpBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 18), paintMat(THREE, C.pump, { metalness: 0.45, roughness: 0.42 }));
      fpBody.rotation.z = Math.PI / 2;
      fpBody.position.set(-0.1, 0.35, 0);
      fpG.add(fpBody);
      var fpMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 16), paintMat(THREE, C.pump, { metalness: 0.4 }));
      fpMotor.rotation.z = Math.PI / 2;
      fpMotor.position.set(0.42, 0.35, 0);
      fpG.add(fpMotor);
      for (var mf = 0; mf < 6; mf++) {
        var mfin = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 6, 16), makeMat(THREE, C.steelDark, { metalness: 0.5 }));
        mfin.rotation.y = Math.PI / 2;
        mfin.position.set(0.3 + mf * 0.06, 0.35, 0);
        fpG.add(mfin);
      }
      var coupling = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), makeMat(THREE, C.warn, { metalness: 0.25, roughness: 0.6 }));
      coupling.position.set(0.2, 0.35, 0);
      fpG.add(coupling);
      var fpPlate = plateMesh('燃油泵', 'P-101', 0.26, 0.095);
      fpPlate.position.set(-0.06, 0.14, 0.212);
      fpG.add(fpPlate);
      reg(fpG, 'fuel-pump', '燃油泵',
        '这一台最容易出事：程序一启动就跟着启，炉膛先积油再点火就是爆燃风险。后来补了 TON 延时 + 点火前置联锁才压住。',
        'DO 启泵 · DI 运行反馈', [0, 0, 1], 1.2);

      /* ---------- 油路电磁阀 ---------- */
      var ovG = new THREE.Group();
      ovG.position.set(-2.0, 0.5, 1.5);
      ovG.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), paintMat(THREE, C.valve, { metalness: 0.45 })));
      [-0.13, 0.13].forEach(function (fx) {
        var fl = ringMesh(0.115, 0.022, C.steelDark, 18);
        fl.rotation.y = Math.PI / 2;
        fl.position.x = fx;
        ovG.add(fl);
      });
      var ovStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), makeMat(THREE, gold, { metalness: 0.6 }));
      ovStem.position.y = 0.24;
      ovG.add(ovStem);
      var ovWheel = handwheel(0.13);
      ovWheel.position.y = 0.44;
      ovG.add(ovWheel);
      reg(ovG, 'fuel-valve', '油路电磁阀',
        '曾经装反过方向——阀体箭头和实际流向不一致，油进不去。排故时先看阀体上的流向标识，别急着怀疑程序。',
        'DO 开阀 · DI 到位', [0, 0, 1], 1.0);

      /* ---------- 燃烧室 ---------- */
      var chG = new THREE.Group();
      chG.position.set(-2.7, 0.95, 0);
      var chShell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 24), paintMat(THREE, C.burner, { metalness: 0.35, roughness: 0.62 }));
      chShell.rotation.z = Math.PI / 2;
      chG.add(chShell);
      var chRingA = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 28), makeMat(THREE, gold, { metalness: 0.5 }));
      chRingA.rotation.y = Math.PI / 2; chRingA.position.x = -0.8;
      chG.add(chRingA);
      var chRingB = chRingA.clone(); chRingB.position.x = 0.8;
      chG.add(chRingB);
      boltsX(chG, -0.8, 0.4, 8, 0.07);
      boltsX(chG, 0.8, 0.4, 8, 0.07);
      var chPlate = plateMesh('燃烧室', 'BURNER', 0.34, 0.128);
      chPlate.rotation.x = -Math.PI / 2;
      chPlate.position.set(-0.05, 0.505, 0);
      chG.add(chPlate);
      var chPort = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), makeMat(THREE, C.dark, { metalness: 0.5 }));
      chPort.position.set(-0.3, 0.48, 0);
      chG.add(chPort);
      [-0.45, 0.45].forEach(function (sx) {
        var sad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.5), makeMat(THREE, C.steelDark, { metalness: 0.45 }));
        sad.position.set(sx, -0.72, 0);
        chG.add(sad);
      });
      reg(chG, 'chamber', '燃烧室',
        '降氧发生在这里：燃油在贫氧条件下燃烧，把空气中的氧耗掉。课设只做了软件联锁，真实设备还要火焰检测器串在油阀回路里。',
        '温度 / 火焰状态（课设未接）', [0, 1, 0], 1.6);

      /* ---------- 点火电极 ---------- */
      var igG = new THREE.Group();
      igG.position.set(-3.1, 1.5, 0);
      var igIns = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.16, 12), makeMat(THREE, 0xe6e0d4, { metalness: 0.05, roughness: 0.8 }));
      igIns.rotation.z = 0.5;
      igIns.position.set(0.06, 0.1, 0);
      igG.add(igIns);
      var igRod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.36, 8), makeMat(THREE, C.steel, { metalness: 0.7 }));
      igRod.rotation.z = 0.5;
      igG.add(igRod);
      var igTerm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), makeMat(THREE, C.brass, { metalness: 0.6 }));
      igTerm.position.set(0.19, 0.26, 0);
      igG.add(igTerm);
      var igTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), makeMat(THREE, 0x222222, { emissive: 0x000000 }));
      igTip.position.set(-0.09, -0.16, 0);
      igG.add(igTip);
      reg(igG, 'igniter', '点火电极',
        '顺序是「先点火、后喷油」：TON 延时强制点火先到位，油阀才允许开。反过来就是炉膛积油，一点就炸。',
        'DO 点火 · 反馈（课设用定时器模拟）', [0, 1, 0], 1.2);

      /* ---------- 喷嘴 ---------- */
      var nzG = new THREE.Group();
      nzG.position.set(-1.85, 0.95, 0);
      var nz = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.3, 14), makeMat(THREE, C.brass, { metalness: 0.62, roughness: 0.35 }));
      nz.rotation.z = Math.PI / 2;
      nzG.add(nz);
      var nzNut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 6), makeMat(THREE, C.brass, { metalness: 0.65, roughness: 0.3 }));
      nzNut.rotation.z = Math.PI / 2;
      nzNut.position.x = 0.12;
      nzG.add(nzNut);
      reg(nzG, 'nozzle', '燃油喷嘴',
        '油从这里雾化进炉膛。停机的正确顺序是先断油、再停风，让残余油气被吹走，不能反着来。',
        '—（随油阀通断）', [0, -1, 0], 1.1);

      /* ---------- 冷却器 ---------- */
      var clG = new THREE.Group();
      clG.position.set(-0.4, 0.6, 0);
      var clBody = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.2, 20), paintMat(THREE, C.steel, { metalness: 0.45, roughness: 0.42 }));
      clG.add(clBody);
      [-0.62, 0.62].forEach(function (cy) {
        var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 20), makeMat(THREE, C.steelDark, { metalness: 0.5 }));
        cap.position.y = cy;
        clG.add(cap);
      });
      var clNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12), makeMat(THREE, C.steel, { metalness: 0.5 }));
      clNozzle.rotation.z = Math.PI / 2;
      clNozzle.position.set(-0.4, -0.4, 0);
      clG.add(clNozzle);
      var clPlate = plateMesh('冷却器', 'E-201', 0.26, 0.095);
      clPlate.position.set(0, 0.1, 0.362);
      clG.add(clPlate);
      for (var f = 0; f < 5; f++) {
        var fin = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 24), makeMat(THREE, C.brass, { metalness: 0.5 }));
        fin.rotation.x = Math.PI / 2;
        fin.position.y = -0.4 + f * 0.2;
        clG.add(fin);
      }
      reg(clG, 'cooler', '冷却器',
        '把燃烧后的高温气体降到可用温度。翅片是为了增大换热面积，实物上积灰会明显掉效率。',
        '出口温度（课设未接模拟量）', [0, 1, 0], 1.4);

      /* ---------- 过滤器 ---------- */
      var flG = new THREE.Group();
      flG.position.set(0.8, 0.45, 0);
      var flBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.9, 18), paintMat(THREE, C.filter, { metalness: 0.4, roughness: 0.5 }));
      flG.add(flBody);
      var flCap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 18), makeMat(THREE, gold, { metalness: 0.6 }));
      flCap.position.y = 0.48;
      flG.add(flCap);
      var flg = new THREE.Group();
      var flgBody = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 16), makeMat(THREE, C.steelDark, { metalness: 0.6 }));
      flgBody.rotation.x = Math.PI / 2;
      flg.add(flgBody);
      var flgFace = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshStandardMaterial({ map: TEX.dial(), roughness: 0.7 }));
      flgFace.position.z = 0.017;
      flg.add(flgFace);
      flg.position.set(0.19, 0.52, 0.1);
      flg.rotation.y = -0.5;
      flG.add(flg);
      var flgStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), makeMat(THREE, C.steelDark, { metalness: 0.6 }));
      flgStem.position.set(0.19, 0.47, 0.04);
      flG.add(flgStem);
      reg(flG, 'filter', '过滤器',
        '拦截燃烧残渣与颗粒。压差大到一定程度就该换芯，靠压差报警而不是按时间拍。',
        '—（可选压差开关）', [0, 1, 0], 1.2);

      /* ---------- 储气罐 ---------- */
      var rcG = new THREE.Group();
      rcG.position.set(2.4, 0, 0);
      var rcBody = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.7, 22), paintMat(THREE, C.tank, { metalness: 0.42, roughness: 0.45 }));
      rcBody.position.y = 1.0;
      rcG.add(rcBody);
      var rcTop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), paintMat(THREE, C.tank, { metalness: 0.42, roughness: 0.45 }));
      rcTop.position.y = 1.85; rcTop.scale.y = 0.55;
      rcG.add(rcTop);
      var rcBot = rcTop.clone(); rcBot.position.y = 0.18; rcBot.scale.y = 0.4;
      rcG.add(rcBot);
      var rcLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), makeMat(THREE, ink, { metalness: 0.4 }));
      rcLeg.position.y = 0.1;
      rcG.add(rcLeg);
      /* 底部裙座 + 安全阀 + 爬梯 */
      var rcSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.22, 20, 1, true), makeMat(THREE, C.steelDark, { metalness: 0.45 }));
      rcSkirt.position.y = 0.14;
      rcG.add(rcSkirt);
      var rcValve = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12), makeMat(THREE, C.wheel, { metalness: 0.4 }));
      rcValve.position.y = 2.16;
      rcG.add(rcValve);
      var rcValveCap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12), makeMat(THREE, C.steel, { metalness: 0.5 }));
      rcValveCap.position.y = 2.25;
      rcG.add(rcValveCap);
      [-0.13, 0.13].forEach(function (lx) {
        var rail = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.5, 6), makeMat(THREE, C.steelDark, { metalness: 0.5 }));
        rail.position.set(lx, 1.0, -0.56);
        rcG.add(rail);
      });
      for (var rr = 0; rr < 5; rr++) {
        var rung = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.022, 0.022), makeMat(THREE, C.steelDark, { metalness: 0.5 }));
        rung.position.set(0, 0.36 + rr * 0.32, -0.56);
        rcG.add(rung);
      }
      var rcPlate = plateMesh('惰气储罐', 'V-301', 0.3, 0.11);
      rcPlate.position.set(0, 1.28, 0.503);
      rcG.add(rcPlate);
      reg(rcG, 'receiver', '惰气储罐',
        '收集成品惰气并稳压。罐体本身没什么可编程的，但压力信号要进模拟量模块，才能做「压力低就补气」的闭环。',
        '压力 AI（课设未接）', [0, 1, 0], 1.8);

      /* ---------- 压力表 ---------- */
      var gaG = new THREE.Group();
      gaG.position.set(2.3, 1.62, 0.5);
      gaG.rotation.set(-0.52, -0.32, 0);
      var gaBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 20), makeMat(THREE, gold, { metalness: 0.6 }));
      gaBody.rotation.x = Math.PI / 2;
      gaG.add(gaBody);
      var gaStem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 8), makeMat(THREE, C.steelDark, { metalness: 0.55 }));
      gaStem.rotation.x = Math.PI / 2;
      gaStem.position.z = -0.1;
      gaG.add(gaStem);
      var gaFace = new THREE.Mesh(new THREE.CircleGeometry(0.135, 22), new THREE.MeshStandardMaterial({ map: TEX.dial(), roughness: 0.72, metalness: 0.05 }));
      gaFace.position.z = 0.032;
      gaG.add(gaFace);
      reg(gaG, 'gauge', '压力表',
        '就地显示，不参与控制。做监控时它是「人看的」，变送器才是「PLC 看的」，两回事。',
        '就地指示', [0, 0, 1], 1.2);

      /* ---------- 出口阀 ---------- */
      var evG = new THREE.Group();
      evG.position.set(3.6, 0.45, 0);
      evG.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), makeMat(THREE, C.steel, { metalness: 0.5 })));
      var evStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8), makeMat(THREE, gold, { metalness: 0.6 }));
      evStem.position.y = 0.24;
      evG.add(evStem);
      reg(evG, 'outlet', '出口阀',
        '向用气点供气。真实系统这里应该有压力联锁：下游超压就切断，别只靠人工关。',
        'DO 开阀', [0, 1, 0], 1.0);

      /* ---------- 控制柜 ---------- */
      var cabG = new THREE.Group();
      cabG.position.set(-1.5, 0, -2.5);
      var cabShell = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.6), paintMat(THREE, C.cab, { metalness: 0.32, roughness: 0.55 }));
      cabShell.position.y = 0.9;
      cabG.add(cabShell);
      /* 柜门缝、把手、百叶、铭牌 */
      var seam = new THREE.Mesh(new THREE.BoxGeometry(0.014, 1.6, 0.012), makeMat(THREE, 0x3f4348, { metalness: 0.4 }));
      seam.position.set(0.02, 0.9, 0.302);
      cabG.add(seam);
      var handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), makeMat(THREE, 0xc9c4b8, { metalness: 0.55, roughness: 0.3 }));
      handle.position.set(-0.1, 0.95, 0.33);
      cabG.add(handle);
      for (var cb = 0; cb < 6; cb++) {
        var vent = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.016, 0.02), makeMat(THREE, 0x33383d, { metalness: 0.4 }));
        vent.position.set(-0.24, 0.5 - cb * 0.05, 0.303);
        cabG.add(vent);
      }
      var cabPlate = plateMesh('AC500', 'PM556-TP-ETH', 0.34, 0.128);
      cabPlate.position.set(0.24, 1.52, 0.303);
      cabG.add(cabPlate);
      for (var ld = 0; ld < 3; ld++) {
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), makeMat(THREE, [0x3fbf6a, 0xe8c14a, 0xc0392b][ld], { emissive: [0x1d5c33, 0x5c4a1d, 0x5c1d1d][ld], emissiveIntensity: 0.8 }));
        lamp.position.set(0.24 + ld * 0.08, 1.34, 0.305);
        cabG.add(lamp);
      }
      var conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), makeMat(THREE, 0x2f3338, { metalness: 0.3, roughness: 0.7 }));
      conduit.position.set(-0.45, 0.25, 0.32);
      cabG.add(conduit);
      var cabScr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), makeMat(THREE, 0x1c333d, { emissive: 0x1b4a5a, emissiveIntensity: 0.85 }));
      cabScr.position.set(0, 1.25, 0.305);
      cabG.add(cabScr);
      glowLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), makeMat(THREE, 0x3fbf6a, { emissive: 0x1d5c33, emissiveIntensity: 1 }));
      glowLamp.position.set(0.36, 1.65, 0.3);
      cabG.add(glowLamp);
      reg(cabG, 'cabinet', '控制柜 · AC500 PM556',
        '8DI / 6DO，扩展 AX561 模拟量与 DC562 数字量；LD 单 POU 循环扫描。下载失败的坑是 IP 网段不对，不是程序错。',
        'Modbus TCP · 8DI / 6DO', [0, 0, -1], 1.5);

      /* ---------- 管路 ---------- */
      function pipe(points, id, name, desc, io, bandColor) {
        var curve = new THREE.CatmullRomCurve3(points);
        var mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.082, 8, false), paintMat(THREE, C.steel, { metalness: 0.5, roughness: 0.42 }));
        reg(mesh, id, name, desc, io, [0, 0, 1], 1.0);
        /* 介质色带：一眼区分风 / 油 / 高温气 / 惰气 */
        if (bandColor) {
          [0.3, 0.62].forEach(function (t) {
            var pt = curve.getPoint(t), tan = curve.getTangent(t);
            var band = ringMesh(0.094, 0.022, bandColor, 16);
            band.position.copy(pt);
            band.lookAt(pt.clone().add(tan));
            band.userData.isBand = true;
            mesh.add(band);
          });
        }
        pipeTint[id] = { mesh: mesh, on: false };
        return curve;
      }

      var airDuct = pipe([
        new THREE.Vector3(-4.0, 0.5, 0.15),
        new THREE.Vector3(-3.7, 0.6, 0),
        new THREE.Vector3(-3.5, 0.95, 0)
      ], 'duct-air', '进风管', '风机到燃烧室。风量决定燃烧强度，频率档位就是给这里的。', '风量随频率', 0x8fd0e0);

      var fuelLine = pipe([
        new THREE.Vector3(-2.7, 0.35, 1.5),
        new THREE.Vector3(-2.35, 0.4, 1.5),
        new THREE.Vector3(-2.0, 0.5, 1.5),
        new THREE.Vector3(-1.9, 0.75, 0.8),
        new THREE.Vector3(-1.85, 0.9, 0.2)
      ], 'pipe-fuel', '油路', '泵 → 电磁阀 → 喷嘴。这条线上任何一处堵或反接，表现都是「点火没反应」。', '压力（无检测）', 0xd8a24a);

      var gasLine = pipe([
        new THREE.Vector3(-1.95, 0.95, 0),
        new THREE.Vector3(-1.4, 0.95, 0),
        new THREE.Vector3(-0.95, 0.85, 0),
        new THREE.Vector3(-0.78, 0.7, 0)
      ], 'pipe-out', '高温气管', '燃烧室 → 冷却器。这一段是高温区，实物要考虑热膨胀与保温。', '温度', 0xd97a4a);

      var gasLine2 = pipe([
        new THREE.Vector3(-0.4, 0.02, 0),
        new THREE.Vector3(0.2, 0.04, 0),
        new THREE.Vector3(0.8, 0.3, 0),
        new THREE.Vector3(0.8, 0.45, 0)
      ], 'pipe-cool', '冷却后管路', '冷却器 → 过滤器 → 储罐。到这里的才是能用的惰气。', '温度 / 氧含量', 0x7fbf9a);

      var gasLine3 = pipe([
        new THREE.Vector3(0.8, 0.45, 0),
        new THREE.Vector3(1.5, 0.55, 0),
        new THREE.Vector3(2.05, 0.8, 0),
        new THREE.Vector3(2.35, 0.95, 0)
      ], 'pipe-tank', '进气支管', '进储罐。罐前一般还要装止回阀，防止停气时倒流。', '—', 0x7fbf9a);

      var outletLine = pipe([
        new THREE.Vector3(2.4, 1.05, 0.3),
        new THREE.Vector3(3.0, 0.75, 0),
        new THREE.Vector3(3.6, 0.57, 0),
        new THREE.Vector3(4.2, 0.57, 0)
      ], 'pipe-use', '供气管', '储罐 → 出口阀 → 用气点。压力低时应当自动补气，课设没做到这一层。', '压力 AI（未接）', 0x7fbf9a);

      /* ---------- 接地阴影 ---------- */
      blob(-4.3, 0.15, 0.62, 0.5);
      blob(-3.9, -2.1, 0.45, 0.38);
      blob(-2.7, 1.5, 0.5, 0.4);
      blob(-2.7, 0, 1.05, 0.6);
      blob(-0.4, 0, 0.55, 0.5);
      blob(0.8, 0, 0.42, 0.42);
      blob(2.4, 0, 0.72, 0.7);
      blob(-1.5, -2.5, 0.8, 0.55);
      blob(3.6, 0, 0.34, 0.34);

      /* ---------- 火焰 ---------- */
      var flameG = new THREE.Group();
      flameG.position.set(1.18, 0.17, 0);  /* 抬高一点：进气管从出口下方穿过，不然火被挡住 */
      flameMesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 1.02, 14),
        new THREE.MeshBasicMaterial({ color: 0xff7e2a, transparent: true, opacity: 0.42 })
      );
      flameMesh.rotation.z = -Math.PI / 2 + 0.2;
      flameG.add(flameMesh);
      /* 内焰：细一圈、亮一档，平涂色块就是三渲二的画法 */
      flameCore = new THREE.Mesh(
        new THREE.ConeGeometry(0.11, 0.62, 12),
        new THREE.MeshBasicMaterial({ color: 0xffe066 })
      );
      flameCore.rotation.z = -Math.PI / 2 + 0.2;
      flameCore.position.set(0.1, 0, 0);
      flameG.add(flameCore);
      flameG.visible = false;
      chG.add(flameG);

      /* ---------- 气体流动点 ---------- */
      function dots(curve, n) {
        var g = new THREE.Group();
        var m = makeMat(THREE, C.gas, { emissive: 0x2e5c72, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 });
        for (var i = 0; i < n; i++) {
          var d = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), m);
          d.userData.t = i / n;
          g.add(d);
        }
        g.visible = false;
        scene.add(g);
        return { group: g, curve: curve };
      }
      flowPts.push(dots(gasLine, 3), dots(gasLine2, 3), dots(gasLine3, 2), dots(outletLine, 2));

      /* ---------- 管路染色 ----------
         运行时把通流的管子换成介质色 + 一点自发光，停流回原色。
         只在状态翻转时写一次材质，不在每帧 setHex。 */
      var TINT_HEX = {
        'duct-air': 0x9fdcf0,
        'pipe-fuel': 0xe6b45e,
        'pipe-out': 0xe88246,
        'pipe-cool': 0x74c79a,
        'pipe-tank': 0x74c79a,
        'pipe-use': 0x74c79a
      };
      function tintPipe(id, on) {
        var t = pipeTint[id];
        if (!t || t.on === on) return;
        t.on = on;
        var hex = TINT_HEX[id];
        t.mesh.traverse(function (o) {
          if (!o.isMesh || o.userData.isBand || !o.material) return;
          var list = Array.isArray(o.material) ? o.material : [o.material];
          list.forEach(function (m) {
            if (!m.color) return;
            if (m.userData.baseColor === undefined) m.userData.baseColor = m.color.getHex();
            m.color.setHex(on ? hex : m.userData.baseColor);
            if (m.emissive) m.emissive.setHex(on ? 0x160e04 : 0x000000);
          });
        });
      }

      /* ---------- 流程状态机 ---------- */
      function start() {
        if (st.phase !== 'idle') return;
        st.phase = 'starting'; st.t = 0; st.fan = false; st.oil = false;
      }
      function stop() {
        st.oil = false;
        st.phase = 'stopping'; st.t = 0;
      }

      var api = {
        parts: parts,
        state: st,
        start: start,
        stop: stop,
        setFreq: function (hz) { st.freq = hz; },
        /* 左侧上位机推动：传 null 交回本地控制 */
        setLink: function (l) { st.link = l; },
        update: function (dt) {
          st.t += dt;

          if (st.link) {
            /* 由左侧上位机驱动：直接映射，不跑本地启动/停止状态机 */
            st.fan = !!st.link.fan;
            st.freq = st.link.freq || 0;
            st.oil = !!st.link.oil;
            st.phase = st.link.running ? 'running' : 'idle';
            if (st.link.running) {
              st.pressure = Math.min(100, st.pressure + dt * (st.freq > 30 ? 3.2 : st.freq > 15 ? 2 : 1));
            } else {
              st.pressure = Math.max(0, st.pressure - dt * 2);
            }
          } else if (st.phase === 'starting') {
            if (st.t > 1.2 && !st.fan) { st.fan = true; st.freq = st.freq || 8; }
            if (st.t > 3.4) { st.oil = true; }
            if (st.t > 5.6) { st.phase = 'running'; }
          } else if (st.phase === 'stopping') {
            if (st.t > 1.6 && st.fan) { st.fan = false; }
            if (st.t > 3.2) { st.phase = 'idle'; st.pressure = Math.max(0, st.pressure - 2); }
          } else if (st.phase === 'running') {
            st.pressure = Math.min(96, st.pressure + dt * (st.freq > 30 ? 3.2 : st.freq > 15 ? 2 : 1));
          }

          var targetFlame = st.oil ? 1 : 0;
          st.flame += (targetFlame - st.flame) * Math.min(1, dt * 3);
          flameG.visible = st.flame > 0.06;
          if (flameG.visible) {
            var s = 0.75 + 0.35 * st.flame + Math.sin(st.t * 18) * 0.06;
            var wob = 0.9 + Math.sin(st.t * 26) * 0.12;
            flameMesh.scale.set(s, s * wob, s);
            flameMesh.material.opacity = 0.55 + 0.32 * st.flame;
            flameCore.scale.set(s * 0.96, s * wob * 0.96, s * 0.96);
            flameCore.material.opacity = 0.62 + 0.32 * st.flame;
          }

          if (st.fan) fanBlades.rotation.x += dt * 9;
          if (glowLamp) {
            glowLamp.material.emissive.setHex(st.phase === 'running' ? 0x1d5c33 : st.phase === 'idle' ? 0x5c4a1d : 0x5c1d1d);
          }

          flowPts.forEach(function (f) {
            var on = st.flame > 0.3;
            f.group.visible = on;
            if (!on) return;
            f.group.children.forEach(function (d) {
              d.userData.t = (d.userData.t + dt * 0.2) % 1;
              d.position.copy(f.curve.getPoint(d.userData.t));
            });
          });

          /* 管路按通流状态染色：通流的段上介质色，停流回钢灰 */
          tintPipe('duct-air', st.fan);
          tintPipe('pipe-fuel', st.oil);
          tintPipe('pipe-out', st.flame > 0.2);
          var downstream = st.phase === 'running' && st.pressure > 6;
          tintPipe('pipe-cool', downstream);
          tintPipe('pipe-tank', downstream);
          tintPipe('pipe-use', downstream);
        },
        hud: function () {
          var phase = st.phase === 'idle' ? '待机' : st.phase === 'starting' ? '启动中' : st.phase === 'stopping' ? '停机中' : '运行';
          var out = [
            { label: '流程', value: phase },
            { label: '风机', value: st.fan ? (st.freq || 8) + ' Hz' : '停' },
            { label: '油阀', value: st.oil ? '开' : '关' }
          ];
          /* 联调时直接显示上位机那边的氧含量，比自算的压力更能看出两边是同一套系统 */
          if (st.link && st.link.o2 !== undefined) out.push({ label: '氧含量', value: st.link.o2.toFixed(1) + '%' });
          else out.push({ label: '储罐压力', value: st.pressure.toFixed(0) + '%' });
          return out;
        },
        /* 解说条：现场此刻在做什么，跟左侧上位机的状态走 */
        narr: function () {
          var L = st.link;
          if (!L || !L.running) {
            var o2 = L && L.o2 !== undefined ? L.o2.toFixed(1) : '20.9';
            return '<b>待机</b>：风机停、YV1 / YV2 全关，炉膛无火，氧含量 ' + o2 + '%。点左侧「启动 S0」按顺序起风机、点火、投油。';
          }
          if (!L.fan) return '<b>已启动但风机未转</b>：按联锁，未送风不允许点火，YV1 保持关闭。';
          var stage = L.stage;
          if (stage === 'ignite') {
            return '<b>点火 · 等 TON1</b>：炉膛已点火，燃油泵要等延时到才允许投入——先喷油后点火会在炉膛积油，爆燃就是这时候发生的。';
          }
          if (stage === 'press') {
            return '<b>油压建立 · TON2</b>：燃油泵 M2 已投入，油压没建立之前开阀等于空放，压力到了才允许 YV1 得电。';
          }
          if (stage === 'valve') {
            return '<b>阀位反馈 · TON3</b>：YV1 已得电，等阀杆走完行程、开到位信号回读。得电不等于已开，没反馈就不算导通。';
          }
          if (stage === 'cooling') {
            return '<b>冷却建立 · TON4</b>：氧含量已达标，先起冷却泵；出口没建立就开收集阀，等于把热烟气直接灌进储罐。';
          }
          if (!L.oil) {
            return '<b>送风</b>：风机 ' + (L.freq || 7.5) + ' Hz 送空气进炉膛，油路还没确认导通，炉膛无火。';
          }
          if (L.o2 > 15) {
            return '<b>燃烧降氧</b>：YV1 开到位、风机 ' + L.freq + ' Hz，燃油在炉膛燃烧消耗氧气，氧含量 ' + L.o2.toFixed(1) + '% 在往 12% 压。';
          }
          if (!L.collect) {
            return '<b>最大流速</b>：氧含量 ' + L.o2.toFixed(1) + '% 已到 15% 以下，YV2 开到位，双阀双泵把氧含量继续压到 12%。';
          }
          return '<b>冷却收集</b>：氧含量 ' + L.o2.toFixed(1) + '% 达标，冷却泵 M3 与收集阀都已建立，烟气经冷却器进储罐，液位 ' + L.level.toFixed(0) + '%。';
        },
        setExplode: function (t) {
          parts.forEach(function (p) {
            var b = p.userData.base, d = p.userData.dir, k = p.userData.dist * t;
            p.position.set(b.x + d.x * k, b.y + d.y * k, b.z + d.z * k);
          });
        },
        dispose: function () {}
      };
      /* 交给左侧上位机：process.js 每帧把状态推过来 */
      window.PROC_FIELD = { api: api };
      return api;
    },
    /* 没有 extra：控制按钮都在左侧上位机，这里只做现场反馈 */
  };
})();
