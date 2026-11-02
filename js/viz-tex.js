/* 三维场景的「彩绘」素材 · 程序化贴图
 * 全部用 canvas 现画，不加载任何外部图片（file:// 下不能 fetch）
 * 贴图都是灰白底，靠材质 color 上色 —— 一张噪声图能给所有漆面复用
 *
 * 用法：window.VIZ_TEX.noise() / brushed() / hazard() / plate(text) / dial() / screen() / grille() / ticks()
 */
(function () {
  if (!window.THREE) return;
  var cache = {};

  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toTex(c, rx, ry) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (rx || ry) t.repeat.set(rx || 1, ry || 1);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    t.userData.shared = true;   /* 缓存的贴图被多个材质共用，dispose 时不能释放 */
    return t;
  }

  function once(key, fn) {
    if (!cache[key]) cache[key] = fn();
    return cache[key];
  }

  /* 三渲二的色阶：把连续光照切成 n 档，喂给 MeshToonMaterial 的 gradientMap。
     必须是 NearestFilter + 无 mipmap，否则渐变会被插值糊回写实效果。
     lo 是暗档基数（默认 0.6）：深色主题下要抬到 0.7，否则深灰设备在暗底上整块糊黑 */
  function gradient(steps, lo) {
    var n = steps || 3;
    var low = lo === undefined ? 0.6 : lo;
    return once('grad' + n + '_' + Math.round(low * 100), function () {
      var data = new Uint8Array(n);
      for (var i = 0; i < n; i++) {
        /* 线性 low → 1.0：三渲二的暗部是「固有色压一档」，不是压到近乎黑 */
        data[i] = Math.round(255 * (low + (1 - low) * (n === 1 ? 1 : i / (n - 1))));
      }
      var t = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      t.userData.shared = true;
      return t;
    });
  }

  /* 漆面：白底 + 细噪点，材质 color 乘上去就是「喷过漆的金属」 */
  function noise() {
    return once('noise', function () {
      var c = cv(96, 96), g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 96, 96);
      for (var i = 0; i < 2600; i++) {
        var a = 0.02 + Math.random() * 0.07;
        g.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
        g.fillRect(Math.random() * 96 | 0, Math.random() * 96 | 0, 1 + (Math.random() * 2 | 0), 1);
      }
      /* 几道极浅的划痕 */
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 0.6;
      for (var k = 0; k < 6; k++) {
        g.beginPath();
        var y = Math.random() * 96;
        g.moveTo(0, y);
        g.lineTo(96, y + (Math.random() - 0.5) * 6);
        g.stroke();
      }
      return toTex(c, 2, 2);
    });
  }

  /* 拉丝不锈钢：横向细纹 */
  function brushed() {
    return once('brushed', function () {
      var c = cv(128, 128), g = c.getContext('2d');
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, 128, 128);
      for (var i = 0; i < 340; i++) {
        g.strokeStyle = 'rgba(0,0,0,' + (0.02 + Math.random() * 0.06).toFixed(3) + ')';
        g.lineWidth = 1;
        g.beginPath();
        var y = Math.random() * 128;
        g.moveTo(0, y);
        g.lineTo(128, y);
        g.stroke();
      }
      return toTex(c, 2, 1);
    });
  }

  /* 警示斜纹（黄黑） */
  function hazard() {
    return once('hazard', function () {
      var c = cv(128, 64), g = c.getContext('2d');
      g.fillStyle = '#e8c14a';
      g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#2b2723';
      g.lineWidth = 13;
      for (var x = -64; x < 160; x += 26) {
        g.beginPath();
        g.moveTo(x, 64);
        g.lineTo(x + 64, 0);
        g.stroke();
      }
      return toTex(c, 1, 1);
    });
  }

  /* 铭牌：深底浅字，带边框 */
  function plate(text, sub) {
    var key = 'plate:' + text + '|' + (sub || '');
    return once(key, function () {
      var c = cv(256, 96), g = c.getContext('2d');
      g.fillStyle = '#2c3036';
      g.fillRect(0, 0, 256, 96);
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 3;
      g.strokeRect(4, 4, 248, 88);
      g.fillStyle = '#f4f1ea';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '600 34px "Microsoft YaHei","PingFang SC",sans-serif';
      g.fillText(text, 128, sub ? 38 : 48);
      if (sub) {
        g.fillStyle = '#b9c2cc';
        g.font = '500 22px "Microsoft YaHei","PingFang SC",sans-serif';
        g.fillText(sub, 128, 70);
      }
      return toTex(c, 1, 1);
    });
  }

  /* 压力表表盘 */
  function dial() {
    return once('dial', function () {
      var c = cv(128, 128), g = c.getContext('2d');
      g.fillStyle = '#f7f4ec';
      g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3a3733'; g.lineWidth = 3;
      g.beginPath(); g.arc(64, 64, 61, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#3a3733';
      for (var i = 0; i <= 20; i++) {
        var a = Math.PI * 0.75 + (Math.PI * 1.5) * (i / 20);
        var r1 = i % 5 === 0 ? 44 : 51;
        g.lineWidth = i % 5 === 0 ? 3 : 1.5;
        g.beginPath();
        g.moveTo(64 + Math.cos(a) * 55, 64 + Math.sin(a) * 55);
        g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1);
        g.stroke();
      }
      /* 红色指针 */
      var na = Math.PI * 0.75 + Math.PI * 1.5 * 0.62;
      g.strokeStyle = '#b03a2e';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(64, 64);
      g.lineTo(64 + Math.cos(na) * 46, 64 + Math.sin(na) * 46);
      g.stroke();
      g.fillStyle = '#3a3733';
      g.beginPath(); g.arc(64, 64, 5, 0, Math.PI * 2); g.fill();
      return toTex(c, 1, 1);
    });
  }

  /* 上位机 / 变频器屏幕：深色底 + 模拟量柱 + 趋势线 */
  function screen(kind) {
    return once('screen:' + kind, function () {
      var c = cv(240, 160), g = c.getContext('2d');
      g.fillStyle = '#0f2430';
      g.fillRect(0, 0, 240, 160);
      g.fillStyle = 'rgba(90,190,220,.13)';
      g.fillRect(0, 0, 240, 20);
      g.fillStyle = '#8fd4e8';
      g.font = '600 13px "Microsoft YaHei",sans-serif';
      g.fillText(kind === 'vfd' ? 'ACS355  25.0 Hz' : '液位监控 · 运行', 10, 14);

      g.strokeStyle = 'rgba(140,210,235,.22)';
      g.lineWidth = 1;
      for (var x = 12; x < 240; x += 24) {
        g.beginPath(); g.moveTo(x, 26); g.lineTo(x, 152); g.stroke();
      }
      for (var y = 30; y < 156; y += 24) {
        g.beginPath(); g.moveTo(8, y); g.lineTo(232, y); g.stroke();
      }

      if (kind === 'vfd') {
        for (var i = 0; i < 3; i++) {
          g.fillStyle = ['#5fd0e8', '#8fd4e8', '#3fa9c8'][i];
          var h = [56, 38, 22][i];
          g.fillRect(28 + i * 62, 140 - h, 26, h);
        }
        g.fillStyle = '#cfe9f2';
        g.font = '600 15px "Microsoft YaHei",sans-serif';
        g.fillText('RUN', 150, 132);
      } else {
        g.fillStyle = 'rgba(95,208,232,.55)';
        g.fillRect(30, 60, 48, 80);
        g.fillRect(100, 92, 48, 48);
        g.strokeStyle = '#5fd0e8';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(150, 138);
        for (var k = 1; k <= 8; k++) g.lineTo(150 + k * 10, 138 - Math.sin(k * 0.7) * 18 - k * 3);
        g.stroke();
      }
      return toTex(c, 1, 1);
    });
  }

  /* 风机进风格栅 */
  function grille() {
    return once('grille', function () {
      var c = cv(128, 128), g = c.getContext('2d');
      g.fillStyle = '#1e2328';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(220,225,230,.5)';
      for (var r = 10; r < 64; r += 9) {
        g.lineWidth = 2.4;
        g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.stroke();
      }
      g.lineWidth = 3;
      for (var a = 0; a < 4; a++) {
        g.beginPath();
        g.moveTo(64, 64);
        g.lineTo(64 + Math.cos(a * Math.PI / 4) * 60, 64 + Math.sin(a * Math.PI / 4) * 60);
        g.moveTo(64, 64);
        g.lineTo(64 - Math.cos(a * Math.PI / 4) * 60, 64 - Math.sin(a * Math.PI / 4) * 60);
        g.stroke();
      }
      return toTex(c, 1, 1);
    });
  }

  /* 罐体侧面的液位刻度条（透明底 + 刻度 + 数字） */
  function ticks() {
    return once('ticks', function () {
      var c = cv(64, 256), g = c.getContext('2d');
      g.clearRect(0, 0, 64, 256);
      g.strokeStyle = 'rgba(52,60,68,.92)';
      g.fillStyle = 'rgba(46,54,62,.95)';
      g.font = '600 15px "Microsoft YaHei",sans-serif';
      g.textBaseline = 'middle';
      for (var i = 0; i <= 10; i++) {
        var y = 250 - i * 23.6;
        g.lineWidth = i % 5 === 0 ? 2.4 : 1.4;
        var w = i % 5 === 0 ? 22 : 13;
        g.beginPath(); g.moveTo(2, y); g.lineTo(2 + w, y); g.stroke();
        if (i % 5 === 0) g.fillText(String(i * 10), 30, y);
      }
      return toTex(c, 1, 1);
    });
  }

  window.VIZ_TEX = {
    noise: noise,
    brushed: brushed,
    hazard: hazard,
    plate: plate,
    dial: dial,
    screen: screen,
    grille: grille,
    ticks: ticks
  };
})();
