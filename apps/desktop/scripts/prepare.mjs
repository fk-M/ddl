// 桌面端资源准备：构建前端 → 打包服务端 → 归拢运行时依赖到 resources/
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const serverDir = path.join(repoRoot, 'apps', 'server');
const webDir = path.join(repoRoot, 'apps', 'web');
const resDir = path.join(desktopDir, 'resources');

const log = (msg) => console.log(`\x1b[36m[prepare]\x1b[0m ${msg}`);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += statSync(full).size;
  }
  return total;
}

/** 1. 前端构建 */
log('构建前端产物 ...');
execSync('npm run build -w @ddl/web', { cwd: repoRoot, stdio: 'inherit' });

/** 2. 准备目录（不整目录删除，改为增量覆盖 + 精准清理过期文件） */
mkdirSync(path.join(resDir, 'server'), { recursive: true });
mkdirSync(path.join(resDir, 'renderer'), { recursive: true });

/** 3. 服务端打单文件（保留 pglite 为外部依赖，它需要按路径读取 wasm 资源） */
log('打包服务端为单文件 ESM ...');
await build({
  entryPoints: [path.join(serverDir, 'src', 'index.ts')],
  outfile: path.join(resDir, 'server', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  sourcemap: false,
  external: ['@electric-sql/pglite'],
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  // 打包进来的 CJS 依赖仍会调用 require()，ESM 下没有该全局，这里补一层桥接
  banner: {
    js: [
      "import { createRequire as __ddlCreateRequire } from 'node:module';",
      'const require = __ddlCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});

/** 4. 复制前端产物 */
log('复制前端产物到 resources/renderer ...');
const distDir = path.join(webDir, 'dist');
cpSync(distDir, path.join(resDir, 'renderer'), { recursive: true, force: true });

// 打包产物文件名带 hash，旧版本会残留，逐次精准删除（通常只有一两个）
const freshAssets = new Set(readdirSync(path.join(distDir, 'assets')));
const assetsOut = path.join(resDir, 'renderer', 'assets');
let pruned = 0;
for (const name of readdirSync(assetsOut)) {
  if (!freshAssets.has(name)) {
    unlinkSync(path.join(assetsOut, name));
    pruned += 1;
  }
}
if (pruned > 0) log(`清理过期前端产物 ${pruned} 个`);

/** 5. 复制 SQL 迁移 */
log('复制 SQL 迁移文件 ...');
cpSync(path.join(serverDir, 'drizzle'), path.join(resDir, 'server', 'drizzle'), {
  recursive: true,
  force: true,
});

/** 6. 复制运行时无法内联的依赖（源码用 createRequire 动态加载，esbuild 无法静态分析） */
const RUNTIME_EXTERNALS = ['@electric-sql/pglite', 'rrule', 'chrono-node', 'rss-parser'];

/** 定位包目录：优先按 workspace 提升后的 node_modules 路径，再退回 exports 解析 */
function resolvePkgDir(name) {
  const direct = path.join(repoRoot, 'node_modules', name);
  if (existsSync(path.join(direct, 'package.json'))) return direct;
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [repoRoot, serverDir] }));
  } catch {
    // 有些包的 exports 不含 ./package.json，改从入口文件向上找
  }
  let dir = path.dirname(require.resolve(name, { paths: [repoRoot, serverDir] }));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`无法解析依赖 ${name}，请先在仓库根目录执行 npm install`);
}

/** 递归收集依赖闭包，避免手写依赖清单漏项 */
function collectDependencyClosure(roots) {
  const found = new Map();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (found.has(name)) continue;
    const pkgDir = resolvePkgDir(name);
    const pkgJson = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    found.set(name, pkgDir);
    for (const dep of Object.keys(pkgJson.dependencies ?? {})) queue.push(dep);
    for (const dep of Object.keys(pkgJson.peerDependencies ?? {})) {
      try {
        resolvePkgDir(dep);
        queue.push(dep);
      } catch {
        // 未安装的 peer 依赖跳过
      }
    }
  }
  return found;
}

log('复制服务端运行时依赖 ...');
const closure = collectDependencyClosure(RUNTIME_EXTERNALS);
const runtimeTarget = path.join(resDir, 'server', 'node_modules');
for (const [name, srcDir] of closure) {
  cpSync(srcDir, path.join(runtimeTarget, name), { recursive: true, dereference: true, force: true });
}
log(`  共 ${closure.size} 个包：${[...closure.keys()].join(', ')}`);

log('资源准备完成：');
log(`  server/server.mjs        ${mb(statSync(path.join(resDir, 'server', 'server.mjs')).size)}`);
log(`  server/drizzle/          ${mb(dirSize(path.join(resDir, 'server', 'drizzle')))}`);
log(`  server/node_modules/     ${mb(dirSize(path.join(resDir, 'server', 'node_modules')))}`);
log(`  renderer/                ${mb(dirSize(path.join(resDir, 'renderer')))}`);
