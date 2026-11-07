/* 三维工艺视图 · 页面内嵌控制器
 * 场景由 js/viz-tanks.js、js/viz-inert.js 注册到 window.VIZ_SCENES
 * 场景接口：{ title, sub, partHint?, greeting?, camera:{theta,phi,radius,target:[x,y,z]}, build(ctx) -> api, extra(host, api) }
 *   partHint / greeting 可选：信息卡的初始标题与说明，不给就用惰气那套「沿装配方向抽出」的说法
 * api：{ parts:[Group], update(dt), hud() -> [{label,value}], setExplode(t), dispose() }
 *
 * 每个 [data-viz-scene] 块各持一份 renderer / rAF：
 *   滚动进入视野才初始化并开始渲染，离开视野立刻停帧 —— 页面同时有 5 个 WebGL 上下文
 *   （首屏、倒立摆、惰气、双水罐、变电站），不这么省低端机会掉帧。
 * 初始化时换一块新 canvas：同一 canvas 一旦 forceContextLoss 就再拿不到上下文。
 */
(function () {
  var scenes = window.VIZ_SCENES || {};
  var GREETING = '点部件看它的作用与信号，再点空白处收回。';

  /* 信息卡的初始文案可以由场景自己给（partHint / greeting），
   * 没给就用上面这套工艺术语。变电站没有拆解，必须换一套说法。 */
  function resetHint(inst) {
    var def = inst.def || {};
    if (inst.partEl) inst.partEl.textContent = def.partHint || '点击场景里的部件';
    if (inst.descEl) {
      if (def.greeting) inst.descEl.innerHTML = def.greeting;
      else inst.descEl.textContent = GREETING;
    }
  }
  /* 默认视角边界。真正的上下限按每个场景的包围盒现算（fitLimits）——
   * 惰气 8 米见方、变电站 50 米见方，用同一套半径限制必然一边进不去、一边退不出来。 */
  var DEFAULT_LIMIT = { phiMin: 0.16, phiMax: 1.58, rMin: 1.5, rMax: 24 };
  var instances = {};

  /* ---------- 材质小工具 ---------- */
  function matsOf(obj) {
    if (!obj.material) return [];
    return Array.isArray(obj.material) ? obj.material : [obj.material];
  }

  function dimPart(group, dim) {
    group.traverse(function (o) {
      matsOf(o).forEach(function (m) {
        /* 描边材质走自己的 uniform，改 opacity 不会生效 */
        if (m.userData.isOutline) {
          if (m.uniforms && m.uniforms.uOpacity) m.uniforms.uOpacity.value = dim ? 0.3 : 1;
          return;
        }
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = m.opacity;
          m.userData.baseTransparent = m.transparent;
        }
        m.transparent = m.userData.baseTransparent || dim;
        m.opacity = dim ? m.userData.baseOpacity * 0.34 : m.userData.baseOpacity;
      });
    });
  }

  function glowPart(group, on) {
    group.traverse(function (o) {
      matsOf(o).forEach(function (m) {
        if (!m.emissive || !m.emissive.getHex) return;
        if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
        m.emissive.setHex(on ? 0x3b2a11 : m.userData.baseEmissive);
      });
    });
  }

  function partFromObject(obj) {
    var guard = 0;
    while (obj && !obj.userData.part && guard < 10) { obj = obj.parent; guard++; }
    return obj && obj.userData.part ? obj : null;
  }

  /* ---------- 相机 / 拾取 ---------- */
  function applyCamera(inst) {
    if (!inst.active || !inst.orbitTarget) return;
    var cam = inst.cam;
    var sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    inst.active.camera.position.set(
      inst.orbitTarget.x + cam.radius * sp * Math.sin(cam.theta),
      inst.orbitTarget.y + cam.radius * cp,
      inst.orbitTarget.z + cam.radius * sp * Math.cos(cam.theta)
    );
    inst.active.camera.lookAt(inst.orbitTarget);
  }

  /* 按包围盒现算这块场景的缩放 / 俯仰范围。
   * 不这么做的话，惰气（8 米）和变电站（50 米）只能共用一套半径，两边都不对。 */
  function fitLimits(inst) {
    var lim = { phiMin: DEFAULT_LIMIT.phiMin, phiMax: DEFAULT_LIMIT.phiMax, rMin: 1.5, rMax: 24 };
    var api = inst.active && inst.active.api;
    if (window.THREE && api && api.parts && api.parts.length) {
      var bb = new window.THREE.Box3();
      api.parts.forEach(function (p) { bb.expandByObject(p); });
      if (!bb.isEmpty()) {
        var size = bb.getSize(new window.THREE.Vector3());
        var vHalf = BASE_FOV * Math.PI / 360;
        var hHalf = Math.atan(Math.tan(vHalf) * BASE_ASPECT);
        var fit = Math.max(size.x / (2 * Math.tan(hHalf)), size.y / (2 * Math.tan(vHalf))) * 1.12;
        lim.rMax = Math.max(inst.baseRadius * 1.5, fit * 1.5);
        /* 近端按场景尺度给：小场景能贴到 1.5 米，大场景最近也在 4.5 米外，免得钻进设备里 */
        lim.rMin = Math.min(Math.max(1.3, inst.baseRadius * 0.18), 4.5);
      }
    }
    inst.limits = lim;
    return lim;
  }

  /* 场景自己接管镜头（比如变电站巡游）后，用户一拖动就得把相机「交还」给轨道控制器。
   * 直接切会从巡游机位跳回默认半径，所以先按当前位姿反算 theta / phi / radius。 */
  function adoptCamera(inst, target) {
    if (!inst.active || !window.THREE) return;
    if (target) {
      if (target.isVector3) inst.orbitTarget.copy(target);
      else inst.orbitTarget.set(target[0], target[1], target[2]);
    }
    var lim = inst.limits || DEFAULT_LIMIT;
    var off = new window.THREE.Vector3().subVectors(inst.active.camera.position, inst.orbitTarget);
    var r = off.length() || inst.baseRadius;
    var phi = r > 0.001 ? Math.acos(Math.max(-1, Math.min(1, off.y / r))) : inst.cam.phi;
    var theta = Math.atan2(off.x, off.z);
    inst.camTarget.theta = inst.cam.theta = theta;
    inst.camTarget.phi = inst.cam.phi = Math.max(lim.phiMin, Math.min(lim.phiMax, phi));
    inst.camTarget.radius = inst.cam.radius = Math.max(lim.rMin, Math.min(lim.rMax, r));
    applyCamera(inst);
  }

  /* 回到场景定义的那个「全景」机位 */
  function resetView(inst) {
    if (!inst.active) return;
    var cfg = inst.def.camera || {};
    clearSelection(inst);
    if (inst.active.api && inst.active.api.resetView) inst.active.api.resetView();
    var t = cfg.target || [0, 1, 0];
    if (inst.orbitTarget) inst.orbitTarget.set(t[0], t[1], t[2]);
    inst.camTarget.theta = cfg.theta !== undefined ? cfg.theta : 0.62;
    inst.camTarget.phi = cfg.phi !== undefined ? cfg.phi : 1.02;
    inst.camTarget.radius = cfg.radius !== undefined ? cfg.radius : 7;
  }

  function pickAt(inst, clientX, clientY) {
    if (!inst.active || !inst.canvas || !inst.raycaster) return null;
    var r = inst.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var nx = ((clientX - r.left) / r.width) * 2 - 1;
    var ny = -((clientY - r.top) / r.height) * 2 + 1;
    inst.raycaster.setFromCamera({ x: nx, y: ny }, inst.active.camera);
    var hits = inst.raycaster.intersectObjects(inst.active.scene.children, true);
    for (var i = 0; i < hits.length; i++) {
      var p = partFromObject(hits[i].object);
      if (p) return p;
    }
    return null;
  }

  function showTip(inst, group, clientX, clientY) {
    if (!group || !inst.canvas) { inst.tip.hidden = true; return; }
    var r = inst.canvas.getBoundingClientRect();
    inst.tip.textContent = group.userData.name;
    inst.tip.style.left = (clientX - r.left) + 'px';
    inst.tip.style.top = (clientY - r.top) + 'px';
    inst.tip.hidden = false;
  }

  /* ---------- 信息卡 ---------- */
  function showInfo(inst, group) {
    var d = group.userData;
    inst.partEl.textContent = d.name;
    var html = d.desc || '';
    if (d.io) html += '<br><span class="viz-k">信号</span> · ' + d.io;
    if (d.note) html += '<br><span class="viz-k">注意</span> · ' + d.note;
    inst.descEl.innerHTML = html;
  }

  /* 把某个部件的描边换成金色加粗版；换回来时统一退回共享材质 */
  function markOutline(inst, group, on) {
    if (!group) return;
    group.traverse(function (o) {
      if (!o.userData.isOutline) return;
      o.material = on ? inst.outlineHi : inst.outlineMat;
    });
  }

  function selectPart(inst, group) {
    if (!inst.active) return;
    if (inst.currentPart && inst.currentPart !== group) {
      dimPart(inst.currentPart, false);
      glowPart(inst.currentPart, false);
      markOutline(inst, inst.currentPart, false);
    }
    inst.active.api.parts.forEach(function (p) { if (p !== group) dimPart(p, true); });
    dimPart(group, false);
    glowPart(group, true);
    inst.currentPart = group;
    markOutline(inst, group, true);
    showInfo(inst, group);
  }

  function clearSelection(inst) {
    if (!inst.active) return;
    inst.active.api.parts.forEach(function (p) { dimPart(p, false); glowPart(p, false); });
    if (inst.currentPart) markOutline(inst, inst.currentPart, false);
    inst.currentPart = null;
    resetHint(inst);
  }

  /* 解说条：场景用 api.narr() 返回一句话，说明「此刻在发生什么」。
   * 文本没变就不写 DOM，避免每帧 innerHTML。 */
  function updateNarr(inst) {
    var el = inst.narrEl;
    if (!el || !inst.active) return;
    var fn = inst.active.api && inst.active.api.narr;
    var txt = fn ? (fn() || '') : '';
    if (txt === inst.narrText) return;
    inst.narrText = txt;
    if (txt) {
      el.innerHTML = txt;
      el.classList.add('is-on');
    } else {
      el.classList.remove('is-on');
    }
  }

  /* ---------- 渲染循环 ---------- */
  function tick(inst, now) {
    if (!inst.active || !inst.running) { inst.raf = 0; return; }
    inst.raf = requestAnimationFrame(function (n) { tick(inst, n); });
    var dt = inst.lastT ? Math.min((now - inst.lastT) / 1000, 0.05) : 0.016;
    inst.lastT = now;

    var cam = inst.cam, tg = inst.camTarget;
    cam.theta += (tg.theta - cam.theta) * 0.16;
    cam.phi += (tg.phi - cam.phi) * 0.16;
    cam.radius += (tg.radius - cam.radius) * 0.16;
    applyCamera(inst);

    if (inst.active.api.update) inst.active.api.update(dt);
    adaptDpr(inst, dt);
    updateNarr(inst);
    if (inst.active.api.hud) {
      var items = inst.active.api.hud();
      if (items && items.length) {
        var html = '';
        for (var i = 0; i < items.length; i++) html += '<span>' + items[i].label + ' <b>' + items[i].value + '</b></span>';
        /* 比对上一次的字符串，不要读 innerHTML —— 那是 getter，每帧序列化一遍 DOM */
        if (inst.hudHtml !== html) { inst.hudHtml = html; inst.hud.innerHTML = html; }
      }
    }
    inst.active.renderer.render(inst.active.scene, inst.active.camera);
  }

  function startLoop(inst) {
    if (!inst.active || inst.raf) return;
    inst.running = true;
    inst.lastT = 0;
    inst.slow = 0;
    inst.warm = performance.now() + 900;
    inst.raf = requestAnimationFrame(function (n) { tick(inst, n); });
  }

  function stopLoop(inst) {
    inst.running = false;
    if (inst.raf) cancelAnimationFrame(inst.raf);
    inst.raf = 0;
  }

  var BASE_FOV = 38;        /* 宽屏下的垂直视角 */
  var BASE_ASPECT = 1.62;   /* 以此为基准保持「水平视野」不变 */

  /* 像素比按 GPU 分档：核显上 2x 等于四倍填充（描边还要再盖一遍），
   * 换来的只是边缘锐一点点，帧率却掉一半。独显才放开到 2。 */
  function detectDprMax(renderer) {
    try {
      var gl = renderer.getContext();
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/Intel|UHD|HD Graphics|Apple|Adreno|Mali|PowerVR|SwiftShader|Software/i.test(name)) return 1.5;
    } catch (e) {}
    return 2;
  }

  /* 自适应分辨率：同一份场景在不同机器上差一倍以上（这块核显 1.5x 只有 50 fps、
   * 1.25x 稳 60），所以不写死像素比 —— 连续掉帧就自己往下退一档。
   * 只降不升：回升会在边界反复横跳，每次 setSize 都要重建缓冲区，反而更卡。 */
  function adaptDpr(inst, dt) {
    if (!inst.active || inst.dprFloor) return;
    /* 刚进视野那一下必然有初始化抖动和合成卡顿，别把它算成「机器跑不动」 */
    if (inst.warm && performance.now() < inst.warm) return;
    if (dt > 0.023) inst.slow = (inst.slow || 0) + 1;
    else if (inst.slow) inst.slow--;
    if (inst.slow < 30) return;
    inst.slow = 0;
    var next = Math.max(0.85, Math.round(inst.dprCur * 0.82 * 100) / 100);
    if (next > inst.dprCur - 0.03) { inst.dprFloor = true; return; }
    inst.dprCur = next;
    resize(inst);
  }

  function resize(inst) {
    if (!inst.active || !inst.canvas) return;
    var w = inst.canvas.clientWidth, h = inst.canvas.clientHeight;
    if (!w || !h) return;
    inst.active.renderer.setPixelRatio(inst.dprCur || Math.min(window.devicePixelRatio || 1, inst.dprMax || 2));
    inst.active.renderer.setSize(w, h, false);

    var aspect = w / h;
    var fov = BASE_FOV;
    if (aspect < BASE_ASPECT) {
      /* 竖屏时按水平视野反推垂直视角，保证整条工艺线不被裁掉 */
      var hHalf = Math.atan(Math.tan(BASE_FOV * Math.PI / 360) * BASE_ASPECT);
      fov = 2 * Math.atan(Math.tan(hHalf) / aspect) * 180 / Math.PI;
    }
    inst.active.camera.aspect = aspect;
    inst.active.camera.fov = fov;
    inst.active.camera.updateProjectionMatrix();
  }

  /* ---------- 三渲二：色阶量化 + 反向外壳描边 ---------- */
  var OUTLINE_VS = [
    'uniform float uThick;',
    'void main() {',
    '  vec3 n = normalize(normalMatrix * normal);',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  mv.xyz += n * uThick;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var OUTLINE_FS = [
    'uniform vec3 uColor;',
    'uniform float uOpacity;',
    'void main() { gl_FragColor = vec4(uColor, uOpacity); }'
  ].join('\n');

  /* 单面片不能做反向外壳（正反面重合，会整块糊成黑），小件描边出来只剩噪点 */
  var FLAT_GEO = /Plane|Circle|Ring|Shape|Sprite|Line/;

  function stylize(inst, THREE, dark) {
    var scene = inst.active.scene;
    var grad = window.VIZ_TEX && window.VIZ_TEX.gradient ? window.VIZ_TEX.gradient(3, dark ? 0.7 : 0.6) : null;

    /* 1) Standard → Toon。toon 不认 metalness / roughness，所以逐个属性搬，不整包传 */
    scene.traverse(function (o) {
      if (!o.isMesh || o.userData.isOutline) return;
      var one = function (m) {
        if (!m || !m.isMeshStandardMaterial) return m;
        var t = new THREE.MeshToonMaterial({
          color: m.color ? m.color.getHex() : 0xffffff,
          gradientMap: grad
        });
        t.map = m.map || null;
        /* 合批后的件把零件颜色写进了顶点属性，转 toon 时这个开关必须带过去，
           否则色阶材质按白色算，整站会褪成一片灰白（踩过）。 */
        if (m.vertexColors) t.vertexColors = true;
        if (m.emissive) t.emissive.setHex(m.emissive.getHex());
        t.emissiveIntensity = m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity;
        t.transparent = m.transparent;
        t.opacity = m.opacity;
        t.alphaTest = m.alphaTest || 0;
        t.side = m.side;
        t.depthWrite = m.depthWrite;
        t.userData = m.userData;
        t.needsUpdate = true;
        m.dispose();
        return t;
      };
      if (Array.isArray(o.material)) o.material = o.material.map(one);
      else o.material = one(o.material);
    });

    /* 2) 描边：先收集再挂，避免边遍历边改树 */
    var outlineMat = new THREE.ShaderMaterial({
      uniforms: {
        uThick: { value: 0.032 },
        uColor: { value: new THREE.Color(dark ? 0x0b0908 : 0x2c2218) },
        uOpacity: { value: 1 }
      },
      vertexShader: OUTLINE_VS,
      fragmentShader: OUTLINE_FS,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: true
    });
    outlineMat.userData.isOutline = true;
    inst.outlineMat = outlineMat;

    /* 选中态：三渲二下 emissive 提亮几乎看不出来，改用金色加粗描边才认得出 */
    var hiMat = outlineMat.clone();   /* ShaderMaterial.clone() 已经深拷 uniforms */
    hiMat.uniforms.uThick.value = 0.04;
    hiMat.uniforms.uColor.value.setHex(dark ? 0xf0cd88 : 0xd4921f);
    hiMat.userData.isOutline = true;
    hiMat.userData.isHighlight = true;
    inst.outlineHi = hiMat;

    var targets = [];
    scene.traverse(function (o) {
      if (!o.isMesh || o.userData.isOutline || !o.geometry) return;
      var m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.transparent) return;
      if (FLAT_GEO.test(o.geometry.type || '')) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if ((o.geometry.boundingSphere.radius || 0) < 0.085) return;
      targets.push(o);
    });
    targets.forEach(function (o) {
      var ol = new THREE.Mesh(o.geometry, outlineMat);
      ol.userData.isOutline = true;
      ol.raycast = function () {};
      ol.matrixAutoUpdate = true;
      o.add(ol);
    });
    inst.outlineCount = targets.length;
  }

  /* ---------- 初始化 ---------- */
  function freshCanvas(inst) {
    var old = inst.stage.querySelector('canvas');
    var nc = document.createElement('canvas');
    nc.className = 'viz-canvas';
    nc.setAttribute('role', 'img');
    nc.setAttribute('aria-label', (inst.def.title || '三维视图') + '（三维）');
    if (old && old.parentNode) old.parentNode.replaceChild(nc, old);
    else inst.stage.insertBefore(nc, inst.stage.firstChild);
    inst.canvas = nc;
    return nc;
  }

  function fail(inst, head, text) {
    inst.failed = true;
    inst.partEl.textContent = head;
    inst.descEl.textContent = text;
    if (inst.stage) inst.stage.classList.add('is-failed');
  }

  function init(inst) {
    if (inst.inited || inst.failed) return inst;
    inst.inited = true;
    if (!window.THREE) { fail(inst, '三维库未加载', 'vendor/three.bundle.js 缺失，三维视图无法启动。其余内容不受影响。'); return inst; }

    var THREE = window.THREE;
    var cv = freshCanvas(inst);
    var renderer;
    try {
      /* low-power 会让双显卡机器强制走核显；三维是这页的主角，直接要高性能档 */
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      fail(inst, '当前浏览器未启用 WebGL', '三维视图无法呈现，换 Chrome / Edge 或开启硬件加速再试。');
      return inst;
    }
    /* 场景可以自带像素比上限：整站这种大场景宁可略软也要稳住帧率，
     * 惰气 / 双水罐这种小场景没必要降，锐一点更好看。 */
    inst.dprMax = Math.min(inst.def.dpr || 2, detectDprMax(renderer));
    inst.dprCur = Math.min(window.devicePixelRatio || 1, inst.dprMax);
    renderer.setPixelRatio(inst.dprCur);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    /* 三渲二的光要「一个主光 + 一点环境」：多光源会把色阶量化搅成一锅粥。
     * 深色主题下光强要**反过来压一档**，不能沿用（更不能加亮）：同一台白件在 #1a1815 的底上
     * 本来就比在 #f7f4ee 上显眼，光照再顶到 1.0 以上，三档色阶会一起饱和成纯白——看着像在发光，
     * 且暗部与高光分不出来。压到 0.44 / 1.12 后白件落在浅灰，三档才读得出。 */
    var LIGHT = {
      hemi: dark ? 0.56 : 0.5,
      key: dark ? 1.34 : 1.62,
      fill: dark ? 0.16 : 0.2
    };
    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x2a2419 : 0xd9d2c2, LIGHT.hemi));
    var key = new THREE.DirectionalLight(0xfff8ec, LIGHT.key);
    key.position.set(4.5, 7.5, 5.5);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xcfe2ee, LIGHT.fill);
    fill.position.set(-6, 3, -4.5);
    scene.add(fill);

    var cfg = inst.def.camera || {};
    inst.orbitTarget = new THREE.Vector3(
      (cfg.target && cfg.target[0]) || 0,
      (cfg.target && cfg.target[1]) || 1,
      (cfg.target && cfg.target[2]) || 0
    );
    inst.baseRadius = cfg.radius !== undefined ? cfg.radius : 7;
    inst.cam.theta = inst.camTarget.theta = cfg.theta !== undefined ? cfg.theta : 0.62;
    inst.cam.phi = inst.camTarget.phi = cfg.phi !== undefined ? cfg.phi : 1.02;
    inst.cam.radius = inst.camTarget.radius = cfg.radius !== undefined ? cfg.radius : 7;

    inst.raycaster = new THREE.Raycaster();
    inst.active = { scene: scene, camera: camera, renderer: renderer, api: null };

    var api = inst.def.build({
      THREE: THREE,
      scene: scene,
      camera: camera,
      stage: inst.stage,
      root: inst.root,
      dark: dark,
      gold: dark ? 0xc9a86a : 0xa67c3d,
      ink: dark ? 0xd8d2c6 : 0x2b2823,
      line: dark ? 0x3b362c : 0xe2ddd2,
      /* 场景若自己接管过镜头（巡游），拖动前先调它，免得视角跳回默认机位 */
      adopt: function (target) { adoptCamera(inst, target); }
    });
    inst.active.api = api;
    stylize(inst, THREE, dark);
    fitLimits(inst);
    /* 默认半径可能被 fitLimits 判定过近或过远，钳一次 */
    inst.cam.radius = inst.camTarget.radius =
      Math.max(inst.limits.rMin, Math.min(inst.limits.rMax, inst.camTarget.radius));

    if (inst.def.extra && inst.extraEl) {
      inst.extraEl.hidden = false;
      inst.extraEl.innerHTML = '<div class="viz-block-title">' + (inst.def.extraTitle || '运行控制') + '</div><div class="viz-btns"></div>';
      inst.def.extra(inst.extraEl.querySelector('.viz-btns'), api);
    }

    applyCamera(inst);
    resize(inst);

    if (window.ResizeObserver) {
      inst.ro = new ResizeObserver(function () { resize(inst); });
      inst.ro.observe(cv);
    }
    if (inst.visible) startLoop(inst);
    return inst;
  }

  function dispose(inst) {
    stopLoop(inst);
    if (inst.ro) { try { inst.ro.disconnect(); } catch (e) {} inst.ro = null; }
    if (!inst.active) return;
    try { if (inst.active.api && inst.active.api.dispose) inst.active.api.dispose(); } catch (e) {}
    inst.active.scene.traverse(function (o) {
      if (o.userData && o.userData.isOutline) return;   /* 描边与父级共用几何体，跟着父级一起释放 */
      if (o.geometry) o.geometry.dispose();
      matsOf(o).forEach(function (m) {
        if (m.map && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      });
    });
    if (inst.outlineMat) { inst.outlineMat.dispose(); inst.outlineMat = null; }
    if (inst.outlineHi) { inst.outlineHi.dispose(); inst.outlineHi = null; }
    try {
      inst.active.renderer.dispose();
      if (inst.active.renderer.forceContextLoss) inst.active.renderer.forceContextLoss();
    } catch (e) {}
    inst.active = null;
    inst.currentPart = null;
    inst.raycaster = null;
    inst.inited = false;
  }

  /* ---------- 事件（绑在 stage 容器上，canvas 被替换也不用重绑） ---------- */
  function bindEvents(inst) {
    var pointer = inst.pointer;

    function lim() { return inst.limits || DEFAULT_LIMIT; }

    function zoomTo(r) {
      var l = lim();
      inst.camTarget.radius = Math.max(l.rMin, Math.min(l.rMax, r));
    }

    /* 双指捏合：触屏上原本只有拖拽，根本没法缩放，这是「缩放不完善」的一半 */
    function pinchDist() {
      var ids = Object.keys(pointer.ids);
      if (ids.length < 2) return 0;
      var a = pointer.ids[ids[0]], b = pointer.ids[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    inst.stage.addEventListener('pointerdown', function (e) {
      if (!inst.canvas || !inst.canvas.getBoundingClientRect().width) return;
      if (e.target && e.target.closest && e.target.closest('.viz-home')) return;
      pointer.ids[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(pointer.ids).length;
      if (n === 2) {
        pointer.pinch = { d: pinchDist(), r: inst.camTarget.radius };
        pointer.down = false;
        pointer.moved = true;
      } else if (n === 1) {
        pointer.down = true; pointer.moved = false;
        pointer.x = e.clientX; pointer.y = e.clientY;
      }
    });

    inst.stage.addEventListener('pointermove', function (e) {
      if (!inst.active) return;
      if (pointer.ids[e.pointerId]) { pointer.ids[e.pointerId].x = e.clientX; pointer.ids[e.pointerId].y = e.clientY; }

      var n = Object.keys(pointer.ids).length;
      if (n >= 2) {
        var d = pinchDist();
        if (pointer.pinch && d > 4) zoomTo(pointer.pinch.r * pointer.pinch.d / d);
        inst.tip.hidden = true;
        return;
      }

      if (pointer.down) {
        var dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
        pointer.x = e.clientX; pointer.y = e.clientY;
        inst.camTarget.theta -= dx * 0.007;
        inst.camTarget.phi = Math.max(lim().phiMin, Math.min(lim().phiMax, inst.camTarget.phi - dy * 0.006));
        inst.tip.hidden = true;
        return;
      }
      var hover = pickAt(inst, e.clientX, e.clientY);
      inst.canvas.classList.toggle('is-picking', !!hover);
      showTip(inst, hover, e.clientX, e.clientY);
    });

    function release(e) {
      delete pointer.ids[e.pointerId];
      if (Object.keys(pointer.ids).length < 2) pointer.pinch = null;
      if (!pointer.down) return;
      pointer.down = false;
      if (pointer.moved) return;
      var hit = pickAt(inst, e.clientX, e.clientY);
      if (hit) selectPart(inst, hit); else clearSelection(inst);
    }
    inst.stage.addEventListener('pointerup', release);
    inst.stage.addEventListener('pointercancel', function (e) {
      delete pointer.ids[e.pointerId];
      if (Object.keys(pointer.ids).length < 2) pointer.pinch = null;
      pointer.down = false;
    });

    inst.stage.addEventListener('pointerleave', function () { inst.tip.hidden = true; });

    inst.stage.addEventListener('wheel', function (e) {
      if (!inst.active) return;
      e.preventDefault();
      zoomTo(inst.camTarget.radius * Math.exp(e.deltaY * 0.0016));
    }, { passive: false });

    /* 双击回到全景：手机上「捏合」不一定顺手，这是退路 */
    inst.stage.addEventListener('dblclick', function (e) {
      if (e.target && e.target.closest && e.target.closest('.viz-home')) return;
      resetView(inst);
    });

    inst.stage.addEventListener('keydown', function (e) {
      if (!inst.active) return;
      var k = e.key, l = lim();
      if (k === 'ArrowLeft') inst.camTarget.theta -= 0.12;
      else if (k === 'ArrowRight') inst.camTarget.theta += 0.12;
      else if (k === 'ArrowUp') inst.camTarget.phi = Math.max(l.phiMin, inst.camTarget.phi - 0.08);
      else if (k === 'ArrowDown') inst.camTarget.phi = Math.min(l.phiMax, inst.camTarget.phi + 0.08);
      else if (k === '+' || k === '=') zoomTo(inst.camTarget.radius * 0.86);
      else if (k === '-' || k === '_') zoomTo(inst.camTarget.radius * 1.16);
      else return;
      e.preventDefault();
    });

    if (inst.explodeInput) {
      inst.explodeInput.addEventListener('input', function () {
        var t = parseFloat(inst.explodeInput.value) / 100;
        if (inst.explodeOut) inst.explodeOut.textContent = inst.explodeInput.value + '%';
        if (inst.active && inst.active.api.setExplode) inst.active.api.setExplode(t);
        // 拆得越开，镜头退得越远，不然部件会被裁出画面
        if (inst.baseRadius) zoomTo(inst.baseRadius * (1 + 0.4 * t));
      });
    }
  }

  /* ---------- 建实例 ---------- */
  function build(root) {
    var key = root.getAttribute('data-viz-scene');
    var def = scenes[key];
    if (!def) return null;
    var inst = {
      key: key,
      def: def,
      root: root,
      stage: root.querySelector('.viz-stage'),
      hud: root.querySelector('.viz-hud'),
      tip: root.querySelector('.viz-tip'),
      partEl: root.querySelector('.viz-part'),
      descEl: root.querySelector('.viz-desc'),
      extraEl: root.querySelector('.viz-extra'),
      narrEl: root.querySelector('.viz-narr'),
      explodeInput: root.querySelector('.viz-explode'),
      explodeOut: root.querySelector('.viz-explode-out'),
      canvas: null,
      active: null,
      currentPart: null,
      raycaster: null,
      limits: DEFAULT_LIMIT,
      narrText: null,
      raf: 0,
      lastT: 0,
      running: false,
      inited: false,
      failed: false,
      visible: false,
      cam: { theta: 0.62, phi: 1.02, radius: 7 },
      camTarget: { theta: 0.62, phi: 1.02, radius: 7 },
      baseRadius: 7,
      orbitTarget: null,
      pointer: { down: false, moved: false, x: 0, y: 0, ids: {}, pinch: null }
    };
    resetHint(inst);
    bindEvents(inst);
    addHomeButton(inst);
    instances[key] = inst;
    return inst;
  }

  /* 「全景」按钮：每个场景一块，位置固定在上视窗右上角 */
  function addHomeButton(inst) {
    if (!inst.stage) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'viz-home';
    b.title = '回到初始全景视角（也可双击画面）';
    b.textContent = '全景';
    b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      resetView(inst);
    });
    inst.stage.appendChild(b);
  }

  var roots = [].slice.call(document.querySelectorAll('[data-viz-scene]'));
  roots.forEach(build);

  /* 进入视野才建场景；离开视野停帧 */
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var inst = instances[en.target.getAttribute('data-viz-scene')];
        if (!inst) return;
        inst.visible = en.isIntersecting;
        if (en.isIntersecting) {
          init(inst);
          if (inst.active) startLoop(inst);
        } else {
          stopLoop(inst);
        }
      });
    }, { rootMargin: '160px 0px', threshold: 0 });
    roots.forEach(function (r) { io.observe(r); });
  } else {
    roots.forEach(function (r) { init(instances[r.getAttribute('data-viz-scene')]); });
  }

  document.addEventListener('visibilitychange', function () {
    Object.keys(instances).forEach(function (k) {
      var inst = instances[k];
      if (!inst.active) return;
      if (document.hidden) stopLoop(inst);
      else if (inst.visible) startLoop(inst);
    });
  });

  /* ---------- 对外（自测 / 控制台调试） ---------- */
  window.VizPanel = {
    keys: Object.keys(instances),
    get: function (key) { return instances[key] || null; },
    init: function (key) { var i = instances[key]; if (i) init(i); return !!i; },
    open: function (key) {
      var i = instances[key];
      if (!i) return false;
      init(i);
      i.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    },
    dispose: function (key) { var i = instances[key]; if (i) dispose(i); },
    stop: function (key) { var i = instances[key]; if (i) stopLoop(i); },
    info: function (key) {
      var i = instances[key];
      if (!i || !i.active) return null;
      var names = i.active.api.parts.map(function (p) { return p.userData.name; });
      return {
        parts: names,
        names: names,
        selected: i.currentPart ? i.currentPart.userData.name : null,
        partText: i.partEl ? i.partEl.textContent : '',
        hud: i.hud ? i.hud.textContent : '',
        size: i.canvas ? [i.canvas.clientWidth, i.canvas.clientHeight] : null,
        explode: i.explodeInput ? i.explodeInput.value : null,
        running: i.running,
        narr: i.narrEl ? i.narrEl.textContent : '',
        limits: i.limits,
        radius: i.cam ? +i.cam.radius.toFixed(2) : null,
        ys: i.active.api.parts.map(function (p) { return +p.position.y.toFixed(2); })
      };
    },
    pickByName: function (key, name) {
      var i = instances[key];
      if (!i || !i.active) return false;
      var hit = null;
      i.active.api.parts.forEach(function (p) { if (p.userData.name === name) hit = p; });
      if (!hit) return false;
      selectPart(i, hit);
      return true;
    },
    clear: function (key) { var i = instances[key]; if (i) clearSelection(i); },
    home: function (key) { var i = instances[key]; if (i) resetView(i); }
  };
})();
