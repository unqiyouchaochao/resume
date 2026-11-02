/* 站点配置 —— 需要改的只有这里 */

window.SITE_CONFIG = {
  version: '2026.10',

  /* 手机号 2026-10-31 起改为公开：直接写在 index.html 的联系区（两处 data-phone），
     不再做 XOR 分片，也不再靠「填机构名」才能看。改号码要同时改这两处：
     ① 联系区 .c-phone  ② 底部 .cta-phone-v
     登记机构名仍保留，但改成可选，记录逻辑见 js/logger.js。 */

  /* 访问记录：留空则进入「本地模式」，记录写进浏览器 localStorage，
     可在页面按 Ctrl + Shift + A 打开面板查看 / 导出 CSV。
     填上 Supabase 的 url 与 anon key 后自动切到「云端模式」，
     记录写入 contact_requests 表（建表 SQL 见 supabase-setup.sql）。 */
  supabase: {
    url: '',
    anonKey: '',
    table: 'contact_requests'
  }
};
