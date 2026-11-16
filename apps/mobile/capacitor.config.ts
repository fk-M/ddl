import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ddl.app',
  appName: '截止日',
  // 复用桌面端同一份前端产物，手机端只是换了外壳
  webDir: '../web/dist',
  android: {
    // 服务端在内网走明文 http，需要放开混合内容限制
    allowMixedContent: true,
  },
  server: {
    // 用 http://localhost 作为 WebView 源，避免 https 页面请求内网 http 被拦截
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
