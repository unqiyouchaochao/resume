/* 页面交互：导航、卡片展开、复制、滚动入场 */
(function () {
  var nav = document.getElementById('nav');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- 导航吸顶阴影 + 顶部阅读进度 --- */
  var bar = document.getElementById('scroll-bar');
  var ticking = false;
  function onScroll() {
    if (nav) nav.classList.toggle('is-stuck', window.scrollY > 8);
    if (bar) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(100, window.scrollY / h * 100) : 0) + '%';
    }
    ticking = false;
  }
  function requestScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  }
  window.addEventListener('scroll', requestScroll, { passive: true });
  // 展开卡片 / 三维进视野后才建，都会改页面总高，进度条要跟着重算
  window.addEventListener('resize', requestScroll);
  if (window.ResizeObserver) new ResizeObserver(requestScroll).observe(document.body);
  onScroll();

  /* --- 导航高亮 --- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-links a'));
  var sections = links.map(function (a) {
    return document.querySelector(a.getAttribute('href'));
  }).filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { navIO.observe(s); });
  }

  /* --- 项目卡片展开 --- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-card]'), function (card) {
    var head = card.querySelector('.card-head');
    var toggle = card.querySelector('.card-toggle');
    if (!head) return;
    head.addEventListener('click', function () {
      var open = card.classList.toggle('is-open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (toggle) toggle.textContent = open ? '收起' : '展开';
    });
  });

  /* --- 页尾「更多」（项目 + 经历）：默认收起 --- */
  var moreBtn = document.getElementById('more-toggle');
  var moreBox = document.getElementById('more-panel');
  var moreLabel = document.getElementById('more-main');

  function setMore(open) {
    if (!moreBtn || !moreBox) return;
    moreBox.hidden = !open;
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (moreLabel) moreLabel.textContent = open ? '收起更多' : '展开更多';
  }

  if (moreBtn && moreBox) {
    // 容器 hidden 时不产生交叉观察，里面的卡片与时间线条目会停在 opacity:0；展开前先补上
    Array.prototype.forEach.call(moreBox.querySelectorAll('.card, .tl-item'), function (el) {
      el.classList.add('is-in');
    });
    moreBtn.addEventListener('click', function () { setMore(moreBox.hidden); });
  }

  /* --- 时间线「展开项目卡」：直达目标卡并把它打开 --- */
  function openCard(el) {
    if (!el || el.classList.contains('is-open')) return;
    el.classList.add('is-open');
    var head = el.querySelector('.card-head');
    var tg = el.querySelector('.card-toggle');
    if (head) head.setAttribute('aria-expanded', 'true');
    if (tg) tg.textContent = '收起';
  }

  /* 落点校正：页面里几个 3D 区域进视野后才建，会把上方高度改掉，落点会漂。
     必须用 instant —— CSS 的 scroll-behavior:smooth 会让 auto 也走平滑动画。
     用户一动滚轮就收手，别把人拽回去。 */
  function settleAnchor(el) {
    var userMoved = false;
    ['wheel', 'touchstart', 'keydown'].forEach(function (t) {
      window.addEventListener(t, function () { userMoved = true; }, { passive: true, once: true });
    });
    var anchorTop = function () {
      return parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    };
    var settle = function () {
      if (userMoved) return;
      if (Math.abs(el.getBoundingClientRect().top - anchorTop()) > 8) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    };
    // 点击走 smooth，要等动画停；带 hash 直接打开是瞬移，可以马上校
    setTimeout(settle, 700);
    setTimeout(settle, 1500);
  }

  function jumpToCard(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    // 目标卡在「更多」面板里且面板收起时，先展开面板，否则元素 display:none 滚不过去
    if (moreBox && moreBox.hidden && moreBox.contains(el)) setMore(true);
    openCard(el);
    // 滚过去之后闪一下金边，否则读者找不到落点在哪
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 1700);
    return el;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#card-"]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    var el = jumpToCard(href.slice(1));
    if (!el) return;
    e.preventDefault();
    if (history.replaceState) history.replaceState(null, '', href);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        settleAnchor(el);
      });
    });
  });

  // 带着 #card-xxx 直接打开页面（分享链接 / 刷新）时，同样展开并定位
  if (location.hash.indexOf('#card-') === 0) {
    var deepTarget = jumpToCard(location.hash.slice(1));
    if (deepTarget) settleAnchor(deepTarget);
  }

  /* --- 复制 --- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var old = btn.textContent;
      function ok() {
        btn.textContent = '已复制';
        btn.classList.add('is-ok');
        setTimeout(function () { btn.textContent = old; btn.classList.remove('is-ok'); }, 1600);
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(ok).catch(fallback);
      } else { fallback(); }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) { /* 忽略 */ }
        document.body.removeChild(ta);
      }
    });
  });

  /* --- 滚动入场 --- */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var targets = document.querySelectorAll('.sec-head, .sec-intro, .card, .demo-wrap, .skill, .edu-strip, .tl-item, .eval');
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          revealIO.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    Array.prototype.forEach.call(targets, function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min(i % 4, 3) * 60 + 'ms';
      revealIO.observe(el);
    });
  }

  /* --- 作品集二级入口：在本页内嵌运行另一个项目（独立 iframe，不污染本站状态） --- */
  var frame = document.getElementById('appframe');
  var frameIframe = document.getElementById('appframe-iframe');
  var frameFallback = document.getElementById('appframe-fallback');
  var frameOpen = document.getElementById('appframe-open');
  var frameRepo = document.getElementById('appframe-repo');
  var frameName = document.getElementById('appframe-name');
  var appCfg = (window.SITE_CONFIG && window.SITE_CONFIG.apps) || {};
  var fbTitle = frameFallback && frameFallback.querySelector('.appframe-fb-title');
  var fbText = frameFallback && frameFallback.querySelector('.appframe-fb-text');
  var fbTitleDefault = fbTitle ? fbTitle.textContent : '';
  var fbTextDefault = fbText ? fbText.innerHTML : '';

  /* live 是相对路径（本站内副本）时，file:// 下会被 CORS 拦（module / 相对目录），
     所以双击打开 index.html 时降级成提示，不显示一块白板。 */
  function relBlocked(live) {
    return !!live && live.indexOf('//') === -1 && location.protocol === 'file:';
  }

  function openApp(key) {
    if (!frame) return;
    var app = appCfg[key] || {};
    var live = app.live || '';
    var repo = app.repo || '';
    var blocked = relBlocked(live);
    if (frameName && app.name) frameName.textContent = app.name;
    if (frameRepo && repo) frameRepo.href = repo;
    if (frameOpen) {
      frameOpen.href = (live && !blocked) ? live : repo;
      frameOpen.textContent = (live && !blocked) ? '新窗口打开' : '去仓库';
    }
    if (fbTitle) fbTitle.textContent = blocked ? '本地双击打开时无法内嵌运行' : fbTitleDefault;
    if (fbText) {
      fbText.innerHTML = blocked
        ? '它是独立的 PWA，本站内嵌的副本需要经由 http 访问才能启动。用本地服务器打开（例如在本目录执行 <code>python -m http.server</code> 后访问 <code>http://localhost:8000</code>），或直接打开线上站点，这个入口就能正常运行。'
        : fbTextDefault;
    }
    if (live && frameIframe && !blocked) {
      frameIframe.src = live;
      frameIframe.hidden = false;
      if (frameFallback) frameFallback.hidden = true;
    } else {
      if (frameIframe) { frameIframe.removeAttribute('src'); frameIframe.hidden = true; }
      if (frameFallback) frameFallback.hidden = false;
    }
    frame.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  function closeApp() {
    if (!frame) return;
    frame.hidden = true;
    if (frameIframe) { frameIframe.removeAttribute('src'); frameIframe.hidden = false; }
    document.documentElement.style.overflow = '';
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-app-launch]'), function (btn) {
    btn.addEventListener('click', function () { openApp(btn.getAttribute('data-app-launch')); });
  });

  if (frame) {
    var frameClose = document.getElementById('appframe-close');
    if (frameClose) frameClose.addEventListener('click', closeApp);
    frame.addEventListener('click', function (e) {
      if (e.target === frame) closeApp();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !frame.hidden) closeApp();
    });
  }
})();
