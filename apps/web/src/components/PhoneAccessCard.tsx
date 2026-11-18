import { Check, Copy, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Card, SectionTitle, Toggle } from './ui';

/**
 * 桌面端的「手机 / 平板连接」设置。
 *
 * 背景：桌面 App 的内嵌服务默认只监听 127.0.0.1，手机永远连不上；
 * 而 start-lan.bat 用的是另一份数据库目录。结果是「桌面 App 记的任务」
 * 和「手机同步到的任务」是两份数据。这里把 App 自己变成同步枢纽，
 * 用户就不需要再开那个黑窗口了。
 */

type ServerInfo = {
  port: number;
  host: string;
  lanEnabled: boolean;
  addresses: { name: string; address: string; kind: 'lan' | 'tailscale'; url: string }[];
};

type Prefs = { lanAccess: boolean; preferredPort: number };

type DesktopBridge = {
  serverInfo: () => Promise<ServerInfo>;
  getPrefs: () => Promise<Prefs>;
  setPrefs: (
    patch: Partial<Prefs>,
  ) => Promise<{ ok: boolean; prefs: Prefs; needRestart: boolean }>;
};

function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as { ddlDesktop?: Partial<DesktopBridge> }).ddlDesktop;
  return typeof bridge?.serverInfo === 'function' ? (bridge as DesktopBridge) : null;
}

export function PhoneAccessCard() {
  const bridge = desktopBridge();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [needRestart, setNeedRestart] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bridge) return;
    try {
      const [nextInfo, nextPrefs] = await Promise.all([bridge.serverInfo(), bridge.getPrefs()]);
      setInfo(nextInfo);
      setPrefs(nextPrefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bridge]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!bridge) return null;

  const handleToggle = async (next: boolean) => {
    try {
      const result = await bridge.setPrefs({ lanAccess: next });
      setPrefs(result.prefs);
      setNeedRestart(result.needRestart);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('复制失败，请手动选中地址');
    }
  };

  const lanEnabled = info?.lanEnabled ?? false;
  const addresses = info?.addresses ?? [];

  return (
    <Card id="settings-phone-access">
      <SectionTitle>手机 / 平板连接</SectionTitle>
      <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
        这个软件自己就是同步枢纽，手机和平板连上之后，
        <strong className="font-medium text-neutral-700">三端共用这一份数据</strong>
        —— 不需要再另外开 <code className="rounded bg-neutral-100 px-1">start-lan.bat</code>。
      </p>

      <Toggle
        label="允许手机 / 平板连进来"
        hint="关掉后只允许本机访问；在公司、学校等公共 Wi-Fi 下建议关闭"
        checked={prefs?.lanAccess ?? false}
        onChange={(next) => void handleToggle(next)}
      />

      {needRestart && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
          设置已保存，<strong className="font-medium">需要完全退出软件再重新打开</strong>才会生效。
        </p>
      )}

      <div className="mt-3 border-t border-neutral-100 pt-3">
        {lanEnabled ? (
          addresses.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[12px] text-neutral-500">
                在手机 / 平板的「设置 → 数据与同步 → 服务端地址」里填下面任意一条：
              </p>
              {addresses.map((item) => (
                <div
                  key={item.url}
                  className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12.5px] text-neutral-800">{item.url}</p>
                    <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                      {item.kind === 'tailscale' ? 'Tailscale 虚拟局域网' : '同一 Wi-Fi'} · {item.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-blue-600 hover:bg-blue-50"
                    onClick={() => void handleCopy(item.url)}
                  >
                    {copied === item.url ? <Check size={12} /> : <Copy size={12} />}
                    {copied === item.url ? '已复制' : '复制'}
                  </button>
                </div>
              ))}
              <p className="text-[11.5px] leading-relaxed text-neutral-400">
                出门在外也想同步的话，让电脑和手机都登录同一个 Tailscale 账号，
                上面就会出现一条 <code className="rounded bg-neutral-100 px-1">100.x.x.x</code> 的地址，
                在任何网络下都能用。
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-500">
              <Smartphone size={14} className="mt-0.5 shrink-0 text-neutral-400" />
              没有检测到可用的网络地址，请确认电脑已连接 Wi-Fi 或网线。
            </p>
          )
        ) : (
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-500">
            <Smartphone size={14} className="mt-0.5 shrink-0 text-neutral-400" />
            当前只允许本机访问。打开上面的开关并重启软件后，这里会列出手机能连的地址。
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>
      )}
    </Card>
  );
}
