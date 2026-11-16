# 截止日（DDL）

一个本地优先的待办 / DDL 管理应用，同时打包成 Windows 桌面端与 Android App。核心数据留在你自己机器上，手机与电脑在同一局域网时可双向同步。

## 功能

- **四象限**：重要 / 紧急两个正交维度构成 2×2 网格，任务可在格间拖拽换象限
- **多视图**：收件箱、今天、最近 7 天、日历（月视图 + 农历 + 手势切月）、全部任务、看板
- **信息源采集**：RSS / JSON / HTML 列表页三种抓取方式，自动抽取截止时间，候选池人工确认后才建任务
- **剪藏**：粘贴一段文字或一个链接，直接识别出 DDL
- **番茄专注、习惯打卡、倒数纪念日、标签与过滤器、垃圾桶**
- **系统通知**：手机端把到点提醒交给系统闹钟，退出应用、锁屏也能收到；桌面/浏览器用 Web Notification
- **附件**（手机端存 IndexedDB，桌面端存本地目录）
- **设置分类化**、侧边栏顺序可拖拽、已完成区可折叠 / 清空；手机端设置全部存在本机，离线可改

## 技术栈

npm workspaces monorepo：

| 包 | 说明 |
|---|---|
| `apps/web` | Vite 6 + React 18 + TypeScript + Tailwind CSS v4 |
| `apps/server` | Fastify 5 + Zod + Drizzle ORM + PGlite（嵌入式 Postgres） |
| `packages/shared` | 前后端共享的 Zod schema 与类型 |
| `apps/desktop` | Electron 外壳，内嵌服务端，electron-builder 打包 |
| `apps/mobile` | Capacitor 6 Android 壳，前端走本地优先（IndexedDB） |

## 本地开发

```bash
npm install

npm run dev          # 同时起服务端(3001) 与前端(5173)
npm run dev:server    # 只起服务端
npm run dev:web       # 只起前端
```

## 打包

```bash
npm run build:desktop   # Windows 安装包 → apps/desktop/dist-win/
npm run build:android   # Android APK → apps/mobile/android/app/build/outputs/apk/
```

Windows 打包依赖根目录 `node_modules` 里的 `app-builder.exe`；`apps/desktop/node_modules/.keep` 这个占位目录不要删，删了 electron-builder 会走错分支把开发依赖剪掉。

## 局域网同步

```bash
npm run serve:lan     # 或双击 start-lan.bat，监听 0.0.0.0:3001
```

手机与电脑连同一 Wi-Fi，在手机端「设置 → 数据与同步 → 服务端地址」填 `http://<电脑局域网IP>:3001` 即可。数据冲突按「修改时间较晚者胜」。

> PGlite 不支持多进程并发写，同一个数据目录**不要**同时起两个服务；关闭服务请用 Ctrl+C，不要强杀进程。

## 应用内更新

推送 `v*` 标签会触发 GitHub Actions（`.github/workflows/release.yml`）：

- **Android**：构建签名 APK，手机上「设置 → 更新与关于」可直接下载并覆盖安装
- **Windows**：构建 NSIS 安装包 + `latest.yml`，electron-updater 自动检查并安装

覆盖安装要求签名一致，CI 从 Actions Secrets 还原签名证书（`DDL_KEYSTORE_BASE64` / `DDL_KEYSTORE_PASSWORD` / `DDL_KEY_ALIAS` / `DDL_KEY_PASSWORD`），仓库内不含私钥。

```bash
git tag v0.1.1 && git push origin v0.1.1
```

## 许可

个人项目，未附带开源许可协议，保留所有权利。
