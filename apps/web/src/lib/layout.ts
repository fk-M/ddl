/**
 * 三档布局：手机 < 768px / 平板 768–1279px / 桌面 ≥ 1280px。
 * 与 Tailwind 的 md(768) / xl(1280) 断点保持一致，方便样式与检测页共用同一套定义。
 */
import { useEffect, useState } from 'react';

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

export const LAYOUT_BREAKPOINTS = { tablet: 768, desktop: 1280 } as const;

export function layoutModeOf(width: number): LayoutMode {
  if (width < LAYOUT_BREAKPOINTS.tablet) return 'phone';
  if (width < LAYOUT_BREAKPOINTS.desktop) return 'tablet';
  return 'desktop';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() =>
    layoutModeOf(typeof window === 'undefined' ? 1280 : window.innerWidth),
  );
  useEffect(() => {
    const update = () => setMode(layoutModeOf(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return mode;
}

/** 供检测页和样式共同使用的宽度类名，避免在多个组件里散落断点 */
export const CONTENT_WIDTH =
  'mx-auto w-full max-w-3xl md:max-w-4xl xl:max-w-3xl';
export const WIDE_CONTENT_WIDTH = 'mx-auto w-full max-w-5xl md:max-w-full lg:max-w-5xl';
