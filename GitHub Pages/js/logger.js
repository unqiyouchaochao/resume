/* 访问记录：云端（Supabase）优先，未配置时落本地 localStorage */
(function () {
  var CFG = window.SITE_CONFIG || {};
  var LS_KEY = 'hp_access_log_v1';
  var MAX_LOCAL = 300;

  function uaClass() {
    var ua = navigator.userAgent || '';
    var browser = '其他';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    else if (/MicroMessenger/.test(ua)) browser = '微信内置';
    var form = /Mobi|Android|iPhone|iPad/i.test(ua) ? '移动端' : '桌面端';
    return browser + ' / ' + form;
  }

  function read() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_LOCAL))); }
    catch (e) { /* 隐私模式下写不进去，忽略 */ }
  }

  function pushLocal(rec) {
    var list = read();
    list.unshift(rec);
    save(list);
  }

  function cloudReady() {
    var s = CFG.supabase || {};
    return !!(s.url && s.anonKey && s.table);
  }

  function log(entry) {
    var rec = {
      org: String(entry.org || '').slice(0, 60),
      note: String(entry.note || '').slice(0, 80),
      page: (location.pathname.split('/').pop() || 'index.html'),
      ua: uaClass(),
      ts: new Date().toISOString()
    };

    if (!cloudReady()) {
      pushLocal(rec);
      return Promise.resolve({ mode: '本地', ok: true });
    }

    var s = CFG.supabase;
    var url = s.url.replace(/\/$/, '') + '/rest/v1/' + s.table;
    return fetch(url, {
      method: 'POST',
      headers: {
        'apikey': s.anonKey,
        'Authorization': 'Bearer ' + s.anonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ org: rec.org, note: rec.note, page: rec.page, ua: rec.ua })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      pushLocal(rec);
      return { mode: '云端', ok: true };
    }).catch(function () {
      pushLocal(rec);
      return { mode: '本地（云端失败已回退）', ok: false };
    });
  }

  function csv() {
    var rows = [['时间', '机构', '备注', '来源页', '浏览器', '']];
    read().forEach(function (r) {
      rows.push([r.ts || '', r.org || '', r.note || '', r.page || '', r.ua || '', '']);
    });
    return rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
  }

  window.SiteLog = {
    log: log,
    read: read,
    clear: function () { save([]); },
    csv: csv,
    cloudReady: cloudReady
  };
})();
