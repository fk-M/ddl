import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WidgetApp } from './components/WidgetApp';
import { WidgetSync } from './components/WidgetSync';
import { isNativeWidget } from './lib/widget';
import { startSyncEngine, SYNC_DATA_EVENT } from './lib/sync-engine';
import './index.css';

// 轻量错误收集：可视化检测页会读取 __ddlErrors，用来判断页面是否真的无运行时异常。
// 只记录消息文本，不拦截、不改变应用行为。
type DiagnosticsWindow = Window & { __ddlErrors?: string[] };
const diagnosticsWindow = window as DiagnosticsWindow;
diagnosticsWindow.__ddlErrors = [];
window.addEventListener('error', (event) => {
  diagnosticsWindow.__ddlErrors?.push(String(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  diagnosticsWindow.__ddlErrors?.push(`unhandledrejection: ${String(event.reason)}`);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      gcTime: 5 * 60_000,
    },
  },
});

// 手机端同步完成后本地 IndexedDB 内容变了，让所有视图重新取数
window.addEventListener(SYNC_DATA_EVENT, () => {
  void queryClient.invalidateQueries();
});

// 只在 Capacitor WebView 里真正启动；桌面端是空操作。
// 可视化检测页会用隐藏 iframe 加载各视图（?diag=1），这些探针不启动同步引擎，
// 避免检测过程本身读写服务端数据、污染用户真实数据。
const isDiagnosticsProbe = new URLSearchParams(window.location.search).get('diag') === '1';
if (!isDiagnosticsProbe) startSyncEngine();

// 桌面小部件是同一份前端资源里的另一屏。
// Electron 用独立无边框窗口加载 ?widget=<kind>&wid=<实例id>：kind 决定画哪一块
// （quadrant / today / inbox / next7），同一类型可以同时开多块，所以还要带实例 id。
// 共用 QueryClient 缓存，不额外增加打包体积。
const isWidget = new URLSearchParams(window.location.search).has('widget');
if (isWidget) document.documentElement.dataset.surface = 'widget';

// PWA 离线壳：只在生产构建里注册，避免 dev 的 HMR 被缓存住。
// 小部件窗口和检测用的 iframe 都不注册，省一次安装。
if (import.meta.env.PROD && !isWidget && !isDiagnosticsProbe && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('挂载节点 #root 不存在');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isWidget ? <WidgetApp /> : <App />}
      {/* 手机端的桌面小组件靠它把快照推给原生；桌面/浏览器里 isNativeWidget() 为 false，不挂 */}
      {!isWidget && isNativeWidget() && <WidgetSync />}
    </QueryClientProvider>
  </StrictMode>,
);
