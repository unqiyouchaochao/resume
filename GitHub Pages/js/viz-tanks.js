/* 双水罐液位监控 · 三维拆解
 * 复刻力控组态画面：两罐填充、泵/阀状态、管道流动、联锁脚本、越限报警、实时趋势
 * 液位为脚本步进模拟（每周期 ±1.x%），不是模拟量闭环——与简历复盘口径一致
 */
(function () {
  if (!window.VIZ_SCENES) window.VIZ_SCENES = {};

  var STEP = 0.22;          // 每个逻辑周期秒数
  var C = {
    tank: 0xcfdbe2,
    liquid: 0x2f7cb8,
    liquidTop: 0x22649a,
    pipe: 0xa3adb5,
    pump: 0x2a6da8,
    motor: 0x2f7fa8,
    valve: 0x556069,
    wheel: 0xb03a2e,
    cabinet: 0x8c8e90,
    screen: 0x2b3a46,
    brass: 0xb08d4f,
    steelDark: 0x6d767e
  };

  function makeMat(THREE, color, opts) {
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.58, metalness: 0.18 });
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

  /* 上漆：不透明材质统一贴一张灰白噪声图 */
  function paintMat(THREE, color, opts) {
    var m = makeMat(THREE, color, opts);
    if (window.VIZ_TEX && !m.transparent && !m.map) {
      m.map = window.VIZ_TEX.noise();
      m.needsUpdate = true;
    }
    return m;
  }

  window.VIZ_SCENES.tanks = {
    title: '双水罐液位监控 · 三维拆解',
    sub: '力控组态画面复刻 · S7-1500 / PLCSIM · 2026.04–05 · 液位为脚本步进模拟',
    camera: { theta: 0.5, phi: 0.99, radius: 8.9, target: [0.05, 1.02, 0] },
    build: function (ctx) {
      var THREE = ctx.THREE, scene = ctx.scene, gold = ctx.gold, ink = ctx.ink, line = ctx.line;
      var parts = [];
      var st = { lv1: 26, lv2: 18, pump: true, mid: false, out: false, running: true, speed: 1 };
      var acc = 0;
      var history = [];
      var liquid1, liquid2, flowA, flowB, flowC;

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

      function handwheel(r) {
        var g = new THREE.Group();
        var rim = ringMesh(r, 0.024, C.wheel, 22);
        rim.rotation.x = Math.PI / 2;
        g.add(rim);
        for (var i = 0; i < 3; i++) {
          var sp = new THREE.Mesh(new THREE.BoxGeometry(r * 1.9, 0.02, 0.02), makeMat(THREE, C.wheel, { metalness: 0.3 }));
          sp.rotation.y = (Math.PI / 3) * i;
          g.add(sp);
        }
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.055, 10), makeMat(THREE, C.wheel, { metalness: 0.4 }));
        g.add(hub);
        return g;
      }

      /* ---------- 地面 ---------- */
      function blob(x, z, rx, rz, a) {
        var cv = document.createElement('canvas');
        cv.width = cv.height = 128;
        var g2 = cv.getContext('2d');
        var grad = g2.createRadialGradient(64, 64, 4, 64, 64, 62);
        grad.addColorStop(0, 'rgba(30,25,18,' + (a || 0.24) + ')');
        grad.addColorStop(0.65, 'rgba(30,25,18,' + (a || 0.24) * 0.35 + ')');
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
        new THREE.PlaneGeometry(40, 40),
        makeMat(THREE, line, { roughness: 1, metalness: 0, transparent: true, opacity: 0.16 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.01;
      scene.add(floor);

      /* ---------- 罐体 ---------- */
      function buildTank(x, label) {
        var g = new THREE.Group();
        g.position.x = x;

        var bodyMat = makeMat(THREE, C.tank, { transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, metalness: 0.3 });
        var body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.2, 28, 1, true), bodyMat);
        body.position.y = 1.45;
        g.add(body);

        var rimMat = makeMat(THREE, gold, { metalness: 0.45, roughness: 0.4 });
        var lid = new THREE.Mesh(
          new THREE.CircleGeometry(0.62, 28),
          makeMat(THREE, 0xf2f7fa, { transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
        );
        lid.rotation.x = -Math.PI / 2;
        lid.position.y = 2.55;
        g.add(lid);
        /* 竖向高光条：三渲二的玻璃靠这两道死白才立得住 */
        [[-0.24, 0.1, 0.45, 0.06], [-0.02, 0.032, 0.34, 0.02]].forEach(function (gp) {
          var gl = new THREE.Mesh(
            new THREE.PlaneGeometry(gp[1], 1.86),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: gp[2], depthWrite: false })
          );
          gl.position.set(gp[0], 1.45, Math.sqrt(0.62 * 0.62 - gp[0] * gp[0]) + 0.006);
          gl.rotation.z = gp[3];
          gl.renderOrder = 4;
          g.add(gl);
        });

        var top = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.028, 8, 32), rimMat);
        top.rotation.x = Math.PI / 2; top.position.y = 2.55;
        g.add(top);
        var bottom = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.028, 8, 32), rimMat);
        bottom.rotation.x = Math.PI / 2; bottom.position.y = 0.35;
        g.add(bottom);
        var baseDisc = new THREE.Mesh(
          new THREE.CircleGeometry(0.62, 28),
          makeMat(THREE, C.tank, { transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
        );
        baseDisc.rotation.x = -Math.PI / 2;
        baseDisc.position.y = 0.36;
        g.add(baseDisc);

        var legMat = makeMat(THREE, ink, { metalness: 0.4 });
        [0, 1, 2].forEach(function (i) {
          var a = (Math.PI * 2 / 3) * i + Math.PI / 3;
          var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), legMat);
          leg.position.set(Math.cos(a) * 0.58, 0.17, Math.sin(a) * 0.58);
          g.add(leg);
        });

        var liquid = new THREE.Mesh(
          new THREE.CylinderGeometry(0.588, 0.588, 1, 26),
          makeMat(THREE, C.liquid, { transparent: true, opacity: 0.86, roughness: 0.22, metalness: 0.12 })
        );
        liquid.renderOrder = 2;
        g.add(liquid);
        /* 液面：颜色略深的一层，让「液位」有明确的高度线 */
        var liquidTop = new THREE.Mesh(
          new THREE.CircleGeometry(0.588, 26),
          makeMat(THREE, C.liquidTop, { transparent: true, opacity: 0.9, roughness: 0.3, metalness: 0.1 })
        );
        liquidTop.rotation.x = -Math.PI / 2;
        liquidTop.renderOrder = 3;
        g.add(liquidTop);

        var tkPlate = plateMesh('水罐 ' + label, 'TK-10' + label, 0.26, 0.095);
        tkPlate.position.set(0.44, 0.66, 0.5);
        tkPlate.rotation.y = Math.atan2(0.44, 0.5);
        g.add(tkPlate);

        reg(g, 'tank' + label,
          '水罐 ' + label,
          '按液位驱动填充；页面上的百分比就是组态里的 PV 值，报警上下限分开设定形成回差。',
          'level' + label + '.PV · 0–100%',
          [0, 1, 0], 1.2);
        return { group: g, liquid: liquid, liquidTop: liquidTop };
      }

      var t1 = buildTank(-1.7, '1');
      var t2 = buildTank(1.7, '2');
      liquid1 = t1;
      liquid2 = t2;

      /* ---------- 接地阴影 ---------- */
      blob(-1.7, 0, 0.82, 0.78, 0.2);
      blob(1.7, 0, 0.82, 0.78, 0.2);
      blob(-3.5, 0, 0.6, 0.45);
      blob(3.55, -1.35, 0.72, 0.5);

      /* ---------- 水泵 ---------- */
      var pumpG = new THREE.Group();
      pumpG.position.set(-3.5, 0, 0);
      var base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.5), makeMat(THREE, ink, { metalness: 0.4 }));
      base.position.y = 0.05;
      pumpG.add(base);
      var volute = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 20), paintMat(THREE, C.pump, { metalness: 0.5, roughness: 0.42 }));
      volute.rotation.z = Math.PI / 2;
      volute.position.set(-0.18, 0.36, 0);
      pumpG.add(volute);
      var motor = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.52, 18), paintMat(THREE, C.motor, { metalness: 0.45, roughness: 0.45 }));
      motor.rotation.z = Math.PI / 2;
      motor.position.set(0.28, 0.36, 0);
      pumpG.add(motor);
      var fan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 18), makeMat(THREE, gold, { metalness: 0.6, roughness: 0.3 }));
      fan.rotation.z = Math.PI / 2;
      fan.position.set(0.58, 0.36, 0);
      pumpG.add(fan);
      var cpGuard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.22), makeMat(THREE, 0xe8c14a, { metalness: 0.25, roughness: 0.6 }));
      cpGuard.position.set(-0.02, 0.36, 0);
      pumpG.add(cpGuard);
      var pmpPlate = plateMesh('给水泵', 'P-101', 0.26, 0.095);
      pmpPlate.position.set(-0.16, 0.2, 0.235);
      pumpG.add(pmpPlate);
      reg(pumpG, 'pump',
        '水泵',
        '给水罐 1 供水。液位到高限先停泵，掉到低限再启——高低限分开是回差，避免在阈值附近反复启停。',
        'DO 启泵 / DI 运行反馈',
        [-1, 0, 0], 1.0);

      /* ---------- 阀门 ---------- */
      function buildValve(x, y, id, name, desc, io, dir) {
        var g = new THREE.Group();
        g.position.set(x, y, 0);
        var body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), paintMat(THREE, C.valve, { metalness: 0.45 }));
        g.add(body);
        [-0.14, 0.14].forEach(function (fx) {
          var fl = ringMesh(0.11, 0.02, C.steelDark, 18);
          fl.rotation.y = Math.PI / 2;
          fl.position.x = fx;
          g.add(fl);
        });
        var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 10), makeMat(THREE, gold, { metalness: 0.6 }));
        stem.position.y = 0.3;
        g.add(stem);
        var wheel = handwheel(0.12);
        wheel.position.y = 0.52;
        g.add(wheel);
        reg(g, id, name, desc, io, dir, 1.1);
        return g;
      }

      buildValve(0, 0.62, 'valve-mid', '调节阀',
        '罐 1 与罐 2 之间的连通阀。要求「罐 1 达高位且罐 2 低于低位」两个条件同时成立才允许打开，任一条件消失立即关断——既防罐 1 溢流，也防罐 2 抽空。',
        'DO 开阀 / DI 到位反馈', [0, 1, 0]);

      buildValve(3.1, 0.5, 'valve-out', '出水阀',
        '罐 2 的排出阀。罐 2 到高位开、到低位关，同样带回差。',
        'DO 开阀 / DI 到位反馈', [0, 1, 0]);

      /* ---------- 管道 ---------- */
      function pipe(points, id, name, desc, io, dir) {
        var curve = new THREE.CatmullRomCurve3(points);
        var mesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 48, 0.066, 8, false),
          paintMat(THREE, C.pipe, { metalness: 0.45, roughness: 0.42 })
        );
        reg(mesh, id, name, desc, io, dir, 0.9);
        /* 水蓝色带 + 端部法兰 */
        [0.34, 0.66].forEach(function (t) {
          var pt = curve.getPoint(t), tan = curve.getTangent(t);
          var band = ringMesh(0.076, 0.018, 0x4f93c4, 16);
          band.position.copy(pt);
          band.lookAt(pt.clone().add(tan));
          mesh.add(band);
        });
        [0.02, 0.98].forEach(function (t) {
          var pt = curve.getPoint(t), tan = curve.getTangent(t);
          var fl = ringMesh(0.088, 0.02, C.steelDark, 16);
          fl.position.copy(pt);
          fl.lookAt(pt.clone().add(tan));
          mesh.add(fl);
        });
        return curve;
      }

      var cIn = pipe([
        new THREE.Vector3(-3.5, 0.42, 0),
        new THREE.Vector3(-3.5, 2.5, 0),
        new THREE.Vector3(-2.6, 2.5, 0),
        new THREE.Vector3(-1.95, 2.45, 0)
      ], 'pipe-in', '进水管道',
        '泵出口到罐 1 顶部。组态里给了「流动」属性，水流一动光点就跟着走，阀门一关就停。',
        '动画属性 · 流动', [0, 0, 1]);

      var cMid = pipe([
        new THREE.Vector3(-1.7, 0.32, 0),
        new THREE.Vector3(-0.9, 0.28, 0),
        new THREE.Vector3(-0.2, 0.42, 0),
        new THREE.Vector3(0, 0.62, 0),
        new THREE.Vector3(0.2, 0.42, 0),
        new THREE.Vector3(1.0, 0.28, 0),
        new THREE.Vector3(1.7, 0.3, 0)
      ], 'pipe-mid', '连通管道',
        '罐 1 底部经调节阀接罐 2。这段最容易看出联锁：阀一关，流动光点立刻停。',
        '动画属性 · 流动', [0, 0, 1]);

      var cOut = pipe([
        new THREE.Vector3(1.7, 0.3, 0),
        new THREE.Vector3(2.5, 0.28, 0),
        new THREE.Vector3(3.1, 0.34, 0),
        new THREE.Vector3(3.1, 0.5, 0),
        new THREE.Vector3(3.85, 0.55, 0)
      ], 'pipe-out', '出水管道',
        '罐 2 底部到排出点。水量最终从这里离开系统，不回流。',
        '动画属性 · 流动', [0, 0, 1]);

      /* ---------- 控制柜 ---------- */
      var cab = new THREE.Group();
      cab.position.set(3.55, 0, -1.35);
      var shell = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.65, 0.55), paintMat(THREE, C.cabinet, { metalness: 0.32, roughness: 0.55 }));
      shell.position.y = 0.83;
      cab.add(shell);
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.5, 0.02), paintMat(THREE, C.cabinet, { metalness: 0.38, roughness: 0.45 }));
      door.position.set(0, 0.83, 0.29);
      cab.add(door);
      var scr = new THREE.Mesh(
        new THREE.PlaneGeometry(0.58, 0.38),
        new THREE.MeshBasicMaterial({ map: TEX.screen('scada') })
      );
      scr.position.set(0, 1.15, 0.305);
      cab.add(scr);
      var seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.44, 0.01), makeMat(THREE, 0x3f4348, { metalness: 0.4 }));
      seam.position.set(-0.2, 0.83, 0.301);
      cab.add(seam);
      var handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.045), makeMat(THREE, 0xc9c4b8, { metalness: 0.55, roughness: 0.3 }));
      handle.position.set(0.3, 0.86, 0.315);
      cab.add(handle);
      for (var cv2 = 0; cv2 < 5; cv2++) {
        var vent2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.016), makeMat(THREE, 0x33383d, { metalness: 0.4 }));
        vent2.position.set(-0.02, 0.52 - cv2 * 0.045, 0.301);
        cab.add(vent2);
      }
      var cabPlate = plateMesh('PLC 控制柜', 'S7-1500', 0.34, 0.128);
      cabPlate.position.set(0, 1.5, 0.302);
      cab.add(cabPlate);
      var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), makeMat(THREE, 0x3fbf6a, { emissive: 0x1d5c33, emissiveIntensity: 1 }));
      lamp.position.set(0.3, 1.52, 0.3);
      cab.add(lamp);
      reg(cab, 'cabinet', '控制柜',
        'S7-1500 与力控上位所在。变量地址与数据类型必须和 PLC 侧一致，否则数值不刷新；通信没连上时整屏都是 0。',
        'PROFINET / PLCSIM · 变量同址映射', [0.9, 0, -0.6], 1.4);

      /* ---------- 流动光点 ---------- */
      function flowDots(curve) {
        var g = new THREE.Group();
        var mat = makeMat(THREE, gold, { emissive: 0x6b4a16, emissiveIntensity: 0.8, roughness: 0.3 });
        for (var i = 0; i < 3; i++) {
          var d = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), mat);
          d.userData.t = i / 3;
          g.add(d);
        }
        scene.add(g);
        return { group: g, curve: curve };
      }
      flowA = flowDots(cIn);
      flowB = flowDots(cMid);
      flowC = flowDots(cOut);

      /* ---------- 趋势小图 ---------- */
      var stage = ctx.stage || null;
      var spark = document.createElement('canvas');
      spark.width = 440; spark.height = 110;
      spark.className = 'viz-spark';
      spark.style.cssText = 'border:1px solid ' +
        (ctx.dark ? '#2e2a23' : '#e2ddd2') + ';border-radius:8px;background:' + (ctx.dark ? 'rgba(26,24,21,.78)' : 'rgba(255,255,255,.78)');
      if (stage) stage.appendChild(spark);
      var sctx = spark.getContext('2d');

      function drawSpark() {
        var w = spark.width, h = spark.height;
        sctx.clearRect(0, 0, w, h);
        sctx.strokeStyle = ctx.dark ? 'rgba(255,255,255,.09)' : 'rgba(26,26,26,.08)';
        sctx.lineWidth = 1;
        [0.25, 0.5, 0.75].forEach(function (p) {
          sctx.beginPath(); sctx.moveTo(0, h * p); sctx.lineTo(w, h * p); sctx.stroke();
        });
        if (history.length < 2) return;
        function plot(key, color) {
          sctx.beginPath(); sctx.strokeStyle = color; sctx.lineWidth = 2;
          for (var i = 0; i < history.length; i++) {
            var x = (i / (150 - 1)) * w;
            var y = h - (history[i][key] / 100) * (h - 6) - 3;
            if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
          }
          sctx.stroke();
        }
        plot('lv1', ctx.dark ? '#7fb0d8' : '#4a86b8');
        plot('lv2', ctx.gold ? (ctx.dark ? '#c9a86a' : '#a67c3d') : '#a67c3d');
      }

      /* ---------- 联锁逻辑 ---------- */
      function logic() {
        if (st.pump) st.lv1 += 1.15;
        if (st.mid) { st.lv1 -= 1.35; st.lv2 += 1.2; }
        if (st.out) st.lv2 -= 1.35;

        if (st.lv1 >= 90) st.pump = false;
        if (st.lv1 <= 25) st.pump = true;

        var allowMid = st.lv1 >= 80 && st.lv2 <= 55;
        st.mid = allowMid;

        if (st.lv2 >= 78) st.out = true;
        if (st.lv2 <= 22) st.out = false;

        st.lv1 = Math.max(0, Math.min(100, st.lv1));
        st.lv2 = Math.max(0, Math.min(100, st.lv2));

        history.push({ lv1: st.lv1, lv2: st.lv2 });
        if (history.length > 150) history.shift();
      }

      function setLiquid(tk, lv) {
        var h = Math.max(0.02, 1.95 * lv / 100);
        var mesh = tk.liquid;
        mesh.scale.y = h;
        mesh.position.y = 0.4 + h / 2;
        if (tk.liquidTop) tk.liquidTop.position.y = 0.4 + h + 0.002;
      }

      function moveFlow(flow, on, dt) {
        flow.group.visible = on;
        if (!on) return;
        flow.group.children.forEach(function (d) {
          d.userData.t = (d.userData.t + dt * 0.22) % 1;
          var p = flow.curve.getPoint(d.userData.t);
          d.position.copy(p);
        });
      }

      var alarm = false;

      return {
        parts: parts,
        update: function (dt) {
          if (st.running) {
            acc += dt * st.speed;
            var guard = 0;
            while (acc >= STEP && guard++ < 6) { logic(); acc -= STEP; }
          }
          setLiquid(liquid1, st.lv1);
          setLiquid(liquid2, st.lv2);
          moveFlow(flowA, st.pump, dt);
          moveFlow(flowB, st.mid, dt);
          moveFlow(flowC, st.out, dt);
          alarm = st.lv1 > 95 || st.lv1 < 8 || st.lv2 > 95 || st.lv2 < 8;
          drawSpark();
        },
        hud: function () {
          return [
            { label: '罐1', value: st.lv1.toFixed(0) + '%' },
            { label: '罐2', value: st.lv2.toFixed(0) + '%' },
            { label: '泵', value: st.pump ? '开' : '关' },
            { label: '调节阀', value: st.mid ? '开' : '关' },
            { label: '出水阀', value: st.out ? '开' : '关' },
            { label: '报警', value: alarm ? '<span style="color:#c0392b">越限</span>' : '正常' }
          ];
        },
        /* 解说条：说清此刻是哪一步、依据什么判据（位式控制，不是 PID） */
        narr: function () {
          var l1 = st.lv1.toFixed(0), l2 = st.lv2.toFixed(0);
          if (!st.running) return '已停止：脚本不再步进，液位停在 罐1 ' + l1 + '% / 罐2 ' + l2 + '%。点「启动」继续。';
          if (st.out) return '<b>排水</b>：罐2 液位 ' + l2 + '% ≥78%，出水阀打开向外部管网排水，降到 22% 自动关阀。';
          if (st.mid) return '<b>转水</b>：罐1 已到 ' + l1 + '%、罐2 只有 ' + l2 + '%，调节阀打开，1 号罐向 2 号罐转水。';
          if (st.pump) return '<b>补水</b>：泵在运行，罐1 液位 ' + l1 + '%。到 90% 停泵、跌到 25% 自动启泵——这是脚本里的位式判据，不是 PID 连续调节。';
          return '<b>等待</b>：罐1 已满（' + l1 + '%）但罐2 还在 ' + l2 + '%，要等罐2 降到 55% 以下才开调节阀，避免两罐同时高位。';
        },
        setExplode: function (t) {
          parts.forEach(function (p) {
            var b = p.userData.base, d = p.userData.dir, k = p.userData.dist * t;
            p.position.set(b.x + d.x * k, b.y + d.y * k, b.z + d.z * k);
          });
        },
        state: st,
        dispose: function () {
          if (spark && spark.parentNode) spark.parentNode.removeChild(spark);
        }
      };
    },
    extra: function (host, api) {
      var st = api.state;
      function btn(text, fn, ghost) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm' + (ghost ? ' btn-ghost' : '');
        b.textContent = text;
        b.addEventListener('click', fn);
        host.appendChild(b);
        return b;
      }
      var runBtn = btn('停止', function () {
        st.running = !st.running;
        runBtn.textContent = st.running ? '停止' : '启动';
      });
      btn('1×', function () { st.speed = 1; }, true);
      btn('2×', function () { st.speed = 2; }, true);
      btn('复位', function () {
        st.lv1 = 26; st.lv2 = 18; st.pump = true; st.mid = false; st.out = false; st.running = true;
        runBtn.textContent = '停止';
      }, true);
    },
    extraTitle: '运行控制'
  };
})();
