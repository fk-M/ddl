// 把 apps/web/dist 同步到 android/app/src/main/assets/public
// 独立成模块：本地打包（build-apk.mjs）与 GitHub Actions 都要用
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(mobileDir, '..', '..');

/**
 * 不调用 `cap sync android`：本机 node_modules/.bin/cap 软链会被清理，
 * 且 Capacitor CLI 在部分 Node 版本下报 "(intermediate value).choices is not a function"。
 * 这里做的实质工作就是复制 webDir，直接同步更稳。
 * 注意：新增原生插件时仍需要跑一次 `npx cap sync android` 更新 capacitor.settings.gradle。
 */
export function syncWebAssets() {
  const androidDir = path.join(mobileDir, 'android');
  const webDist = path.join(repoRoot, 'apps', 'web', 'dist');
  const webAssets = path.join(webDist, 'assets');
  const publicDir = path.join(androidDir, 'app', 'src', 'main', 'assets', 'public');
  const assetsDir = path.join(publicDir, 'assets');

  if (!existsSync(path.join(webDist, 'index.html'))) {
    throw new Error(`找不到前端产物：${webDist}\n请先执行 npm run build -w @ddl/web。`);
  }
  mkdirSync(assetsDir, { recursive: true });

  // 整个 assets 目录都是构建产物（文件名带 hash），直接清空再拷：
  // 之前只清 index-*，结果 export-file-*、web-* 这些按需 chunk 每打一次包就多留一份。
  for (const name of readdirSync(assetsDir)) {
    if (name.startsWith('.')) continue;
    rmSync(path.join(assetsDir, name), { recursive: true, force: true });
  }
  // 根目录的静态页都要进 APK：index.html 是入口，diagnostics.html 是设置页检测入口
  const rootFiles = readdirSync(webDist).filter((name) =>
    statSync(path.join(webDist, name)).isFile(),
  );
  // 清掉 dist 里已经不存在、却还留在 assets/public 根目录的旧文件；
  // cordova*.js / native-bridge.js 是 Capacitor 注入的，不能删
  for (const name of readdirSync(publicDir)) {
    if (rootFiles.includes(name)) continue;
    if (/^(cordova|native-bridge)/.test(name)) continue;
    if (name === 'assets') continue;
    const full = path.join(publicDir, name);
    if (statSync(full).isFile()) rmSync(full, { force: true });
  }
  for (const name of rootFiles) {
    cpSync(path.join(webDist, name), path.join(publicDir, name));
  }
  for (const name of readdirSync(webAssets)) {
    cpSync(path.join(webAssets, name), path.join(assetsDir, name));
  }
  return { publicDir, rootFiles };
}

// 作为脚本直接运行时执行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { publicDir, rootFiles } = syncWebAssets();
  console.log(`[apk] 前端资源已同步：${publicDir}（根目录 ${rootFiles.join(', ')}）`);
}
