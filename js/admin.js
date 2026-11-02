/* 访问记录面板（开发用）：Ctrl + Shift + A，或地址加 ?admin=1 */
(function () {
  var panel = document.getElementById('admin');
  if (!panel) return;

  /* 公开部署后，别把「访问记录 · 本地开发面板」留给任何访客按 Ctrl+Shift+A 打开。
     只在本地双击（file://）或显式加 ?admin=1 时启用，上线后自然不可见。 */
  if (location.protocol !== 'file:' && !/[?&]admin=1/.test(location.search)) {
    panel.remove();
    return;
  }

  var btnClose = document.getElementById('admin-close');
  var btnExport = document.getElementById('admin-export');
  var btnClear = document.getElementById('admin-clear');
  var emptyEl = document.getElementById('admin-empty');
  var table = document.getElementById('admin-table');
  var tbody = table ? table.querySelector('tbody') : null;

  function fmt(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function render() {
    var rows = window.SiteLog ? window.SiteLog.read() : [];
    if (!rows.length) {
      emptyEl.hidden = false;
      table.hidden = true;
      emptyEl.textContent = window.SiteLog && window.SiteLog.cloudReady()
        ? '本地暂无记录（当前为云端模式，记录已写入 Supabase 表）。'
        : '暂无记录。点一次「申请查看」并提交，这里就会出现一条。';
      return;
    }
    emptyEl.hidden = true;
    table.hidden = false;
    tbody.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      [fmt(r.ts), r.org, r.note, r.page, r.ua, '—'].forEach(function (v) {
        var td = document.createElement('td');
        td.textContent = v || '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function toggle(force) {
    var show = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !show;
    if (show) render();
  }

  btnClose && btnClose.addEventListener('click', function () { toggle(false); });

  btnExport && btnExport.addEventListener('click', function () {
    if (!window.SiteLog) return;
    var blob = new Blob(['\uFEFF' + window.SiteLog.csv()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'access-log-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  btnClear && btnClear.addEventListener('click', function () {
    if (!window.confirm('清空本地记录？云端表不受影响。')) return;
    window.SiteLog && window.SiteLog.clear();
    render();
  });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      toggle();
    }
  });

  if (/[?&]admin=1/.test(location.search)) toggle(true);
})();
