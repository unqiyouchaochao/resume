/* 站点配置 —— 需要改的只有这里 */

window.SITE_CONFIG = {
  version: '2026.11',

  /* 完整号码写在页尾联系区 #phone-plain（全站唯一一处 `data-phone`），
     不在本配置里，也不再做 XOR 分片；改号码请改 index.html 那一处。
     公开版会把它替换成占位文案，别把本地完整版 index.html 直接上传。
     「留个机构名」仍是自愿登记，记录逻辑见 js/logger.js。 */

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
