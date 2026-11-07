/* Hero 线框倒立摆：轻量 Three.js 场景，不做重度渲染 */
(function () {
  var canvas = document.getElementById('hero-canvas');
  if (!canvas || !window.THREE) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var C_GOLD = dark ? 0xc9a86a : 0xa67c3d;
  var C_GRAY = dark ? 0x4a4436 : 0xd9d3c6;
  var C_INK = dark ? 0x8d8577 : 0x7a7264;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
  } catch (e) {
    canvas.style.display = 'none';
    return;
  }

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(2.3, 1.55, 3.1);
  camera.lookAt(0, 0.52, 0);

  /* 线框之外再垫一层极淡的实面：纯线条在浅色底下太飘，车与摆杆要有体量 */
  function solid(geo, color, opacity) {
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity, depthWrite: false
    }));
  }

  function edges(geo, color, opacity) {
    var g = new THREE.EdgesGeometry(geo);
    var m = new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: opacity === undefined ? 0.95 : opacity
    });
    return new THREE.LineSegments(g, m);
  }

  /* 地面网格 */
  var grid = new THREE.GridHelper(6, 12, C_GOLD, C_GRAY);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.position.y = 0;
  scene.add(grid);

  /* 轨道 */
  var railGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.8, 0.01, 0),
    new THREE.Vector3(1.8, 0.01, 0)
  ]);
  scene.add(new THREE.Line(railGeo, new THREE.LineBasicMaterial({
    color: C_GOLD, transparent: true, opacity: 0.55
  })));

  /* 小车 + 摆杆 */
  var cartGroup = new THREE.Group();
  var cartGeo = new THREE.BoxGeometry(0.9, 0.18, 0.46);
  var cart = edges(cartGeo, C_INK, 0.9);
  cart.position.y = 0.12;
  var cartFill = solid(cartGeo, C_INK, dark ? 0.16 : 0.07);
  cartFill.position.y = 0.12;
  cartGroup.add(cartFill);
  cartGroup.add(cart);

  [-0.3, 0.3].forEach(function (dx) {
    [-0.235, 0.235].forEach(function (dz) {
      var wheel = edges(new THREE.CircleGeometry(0.075, 20), C_GOLD, 0.8);
      wheel.position.set(dx, 0.075, dz);
      cartGroup.add(wheel);
    });
  });

  var poleGroup = new THREE.Group();
  poleGroup.position.y = 0.21;
  var poleGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  var pole = edges(poleGeo, C_GOLD, 1);
  pole.position.y = 0.5;
  var poleFill = solid(poleGeo, C_GOLD, dark ? 0.22 : 0.12);
  poleFill.position.y = 0.5;
  poleGroup.add(poleFill);
  poleGroup.add(pole);
  var bobGeo = new THREE.SphereGeometry(0.055, 10, 8);
  var bob = edges(bobGeo, C_GOLD, 1);
  bob.position.y = 1;
  var bobFill = solid(bobGeo, C_GOLD, dark ? 0.5 : 0.3);
  bobFill.position.y = 1;
  poleGroup.add(bobFill);
  poleGroup.add(bob);
  cartGroup.add(poleGroup);

  scene.add(cartGroup);

  /* 尺寸 */
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var camZ = 3.1, lookY = 0.52;
  function resize() {
    var w = canvas.clientWidth || 480;
    var h = canvas.clientHeight || 400;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 窄屏（手机）把镜头拉近一点，避免主体缩得太小
    var narrow = camera.aspect < 1.15;
    camZ = narrow ? 2.5 : 2.85;
    lookY = narrow ? 0.62 : 0.52;
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  /* 交互：指针视差 */
  var px = 0, py = 0, tx = 0, ty = 0;
  canvas.addEventListener('pointermove', function (e) {
    var r = canvas.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });
  canvas.addEventListener('pointerleave', function () { tx = 0; ty = 0; });

  /* 动画 */
  var t = 0, last = 0, running = true, raf = 0;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    t += dt;

    var theta = reduce ? 0.16 : 0.14 * Math.sin(t * 0.7);
    var x = reduce ? 0.18 : 0.28 * Math.sin(t * 0.41);
    cartGroup.position.x = x;
    poleGroup.rotation.z = -theta;

    px += (tx - px) * 0.06;
    py += (ty - py) * 0.06;
    camera.position.x = 2.3 + px * 0.34;
    camera.position.y = 1.55 - py * 0.2;
    camera.position.z = camZ;
    camera.lookAt(0, lookY, 0);

    renderer.render(scene, camera);
  }

  if (reduce) {
    cartGroup.position.x = 0.18;
    poleGroup.rotation.z = -0.16;
    camera.position.z = camZ;
    camera.lookAt(0, lookY, 0);
    renderer.render(scene, camera);
  } else {
    raf = requestAnimationFrame(frame);
  }

  /* 离开视口就停，省电 */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !running && !reduce) {
          running = true;
          last = 0;
          raf = requestAnimationFrame(frame);
        } else if (!en.isIntersecting && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      });
    }, { threshold: 0 }).observe(canvas);
  }
})();
