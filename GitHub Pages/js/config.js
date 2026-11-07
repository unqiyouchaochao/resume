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
  },

  /* 作品集二级入口：点项目卡里的「在浏览器中运行」，在本页内嵌打开另一个项目。
     live 用**相对路径**指向本站内的副本（weather/ 目录），同源、跟主站一起部署，
     不依赖第二个域名，也不受 workers.dev 被污染的影响。
     更新副本：把 weather-cn 仓库的 weather-app/ 整个覆盖到 weather/ 即可。
     SW 是 cache-first，上游发新版时 CACHE 号一般已升过；只有自己改过 weather/
     里的文件才需要手升，见 更新方法.md 第六节。 */
  apps: {
    weather: {
      name: '天气应用 Weather Studio',
      repo: 'https://github.com/unqiyouchaochao/weather-cn',
      live: 'weather/'
    }
  }
};
