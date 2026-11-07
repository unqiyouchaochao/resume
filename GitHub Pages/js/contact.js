/* 联系区：手机号复制 + 自愿登记机构名（号码已公开，登记不再拦人） */
(function () {
  var REG_KEY = 'hp_org_registered';
  var modal = document.getElementById('unlock-modal');
  var btnRegister = document.getElementById('btn-register');
  var form = document.getElementById('unlock-form');
  var orgInput = document.getElementById('f-org');
  var noteInput = document.getElementById('f-note');
  var errBox = document.getElementById('f-err');
  var doneBox = document.getElementById('modal-done');
  var doneNum = document.getElementById('done-num');
  var doneMode = document.getElementById('done-mode');
  var lastFocus = null;

  var phoneEl = document.querySelector('[data-phone]');
  function phoneDigits() {
    return phoneEl ? phoneEl.textContent.replace(/\D/g, '') : '';
  }

  function copyText(text, btn) {
    function done() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = '已复制';
      btn.classList.add('is-ok');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('is-ok'); }, 1600);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
      document.body.removeChild(ta);
    }
  }

  ['btn-copy-phone-inline', 'btn-copy-phone-cta'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', function () { copyText(phoneDigits(), b); });
  });

  /* --- 自愿登记 --- */
  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { orgInput && orgInput.focus(); }, 40);
  }

  function close() {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function validOrg(v) {
    var s = (v || '').trim();
    if (s.length < 2) return false;
    return /[\u4e00-\u9fa5A-Za-z]/.test(s);
  }

  function markRegistered(org) {
    if (btnRegister) {
      btnRegister.textContent = '已登记';
      btnRegister.classList.add('is-ok');
    }
    doneBox.hidden = false;
    doneNum.textContent = org;
    if (form) form.hidden = true;
  }

  if (!modal) return;

  if (btnRegister) {
    btnRegister.addEventListener('click', function () { open(); });
  }

  Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'), function (el) {
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var org = (orgInput.value || '').trim();
      var note = (noteInput.value || '').trim();
      if (!validOrg(org)) {
        errBox.hidden = false;
        orgInput.focus();
        return;
      }
      errBox.hidden = true;
      var submitBtn = form.querySelector('button[type=submit]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '记录中…'; }

      var go = window.SiteLog
        ? window.SiteLog.log({ org: org, note: note })
        : Promise.resolve({ mode: '未记录', ok: false });

      go.then(function (res) {
        sessionStorage.setItem(REG_KEY, '1');
        doneMode.textContent = res.mode;
        markRegistered(org);
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交登记'; }
      });
    });
  }

  if (sessionStorage.getItem(REG_KEY) === '1' && btnRegister) {
    btnRegister.textContent = '已登记';
    btnRegister.classList.add('is-ok');
  }
})();
