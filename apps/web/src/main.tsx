import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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

const container = document.getElementById('root');
if (!container) throw new Error('挂载节点 #root 不存在');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
