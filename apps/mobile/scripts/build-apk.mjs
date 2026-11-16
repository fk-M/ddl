// 安卓打包入口：自动补齐 JAVA_HOME / ANDROID_HOME，避免依赖系统环境变量
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncWebAssets } from './sync-web.mjs';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(mobileDir, 'android');
const repoRoot = path.resolve(mobileDir, '..', '..');

// 按项目约定，工具链都装在 D:\software 下，这里给默认值（可用环境变量覆盖）
const JAVA_HOME = process.env.JAVA_HOME ?? 'D:\\software\\jdk21\\jdk-21.0.13+9';
const ANDROID_HOME = process.env.ANDROID_HOME ?? 'D:\\software\\android-sdk';

for (const [name, dir] of [
  ['JAVA_HOME', JAVA_HOME],
  ['ANDROID_HOME', ANDROID_HOME],
]) {
  if (!existsSync(dir)) {
    console.error(`找不到 ${name}：${dir}\n可在环境变量里指定，或按约定把工具装到 D:\\software 下。`);
    process.exit(1);
  }
}

const env = { ...process.env, JAVA_HOME, ANDROID_HOME };

const run = (command, args, cwd) => {
  console.log(`\n> ${command} ${args.join(' ')}  (${cwd})`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`命令失败，退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }
};

const wantsRelease = process.argv.includes('--release');

run('npm', ['run', 'build', '-w', '@ddl/web'], repoRoot);
const { publicDir, rootFiles } = syncWebAssets();
console.log(`[apk] 前端资源已同步：${publicDir}（根目录 ${rootFiles.join(', ')}）`);

run('gradlew.bat', [wantsRelease ? 'assembleRelease' : 'assembleDebug'], androidDir);

const apk = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  wantsRelease ? 'release' : 'debug',
  wantsRelease ? 'app-release.apk' : 'app-debug.apk',
);

if (existsSync(apk)) {
  console.log(`\nAPK 已生成：${apk}`);
} else {
  console.error('\n未找到 APK 输出，请检查上面的编译日志。');
  process.exit(1);
}
