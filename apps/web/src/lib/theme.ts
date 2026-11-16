import type { AppSettings } from '@ddl/shared';

/** 主题色预设，覆盖滴答清单的常用配色 */
export const ACCENT_PRESETS = [
  { id: '#3b82f6', label: '天蓝' },
  { id: '#6366f1', label: '靛蓝' },
  { id: '#8b5cf6', label: '紫罗兰' },
  { id: '#ec4899', label: '玫红' },
  { id: '#ef4444', label: '朱红' },
  { id: '#f97316', label: '橙' },
  { id: '#eab308', label: '明黄' },
  { id: '#22c55e', label: '翠绿' },
  { id: '#14b8a6', label: '青碧' },
  { id: '#64748b', label: '石墨' },
] as const;

/** 应用图标皮肤（对齐滴答清单的 32 套图标包命名） */
export const ICON_PACKS = [
  'Default',
  'Ai',
  'CClassic',
  'Christmas',
  'Dark_Linear',
  'Emotion',
  'GBluePro',
  'GRedPro',
  'GSiriPro',
  'GYellowPro',
  'LGreenPro',
  'LRedPro',
  'LYellowPro',
  'Macintosh',
  'Mechanical',
  'Neon',
  'Planet',
  'PlanetPro',
  'Plump3d',
  'SBlackPro',
  'SClassic',
  'SClassicPro',
  'SGreenPro',
  'SOrangePro',
  'SPinkPro',
  'SYellowPro',
  'ScratchBluePro',
  'SetIcons',
  'Spaceship',
  'SpringFestival',
  'WGreenPro',
] as const;

export function resolveDark(mode: AppSettings['themeMode']): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把设置应用到 document，返回解绑函数（跟随系统时需要监听变化） */
export function applyTheme(settings: Pick<AppSettings, 'themeMode' | 'accentColor'>): () => void {
  const root = document.documentElement;

  const sync = () => {
    root.classList.toggle('dark', resolveDark(settings.themeMode));
    root.style.setProperty('--accent', settings.accentColor);
  };
  sync();

  if (settings.themeMode !== 'system') return () => undefined;

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => sync();
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}
