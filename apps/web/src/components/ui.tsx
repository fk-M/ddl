import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-[12px] font-semibold tracking-wide text-neutral-400 uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  /** 设置页分类跳转的锚点 */
  id?: string;
}) {
  return (
    <div id={id} className={clsx('rounded-xl border border-neutral-200/80 bg-white p-4', className)}>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium tracking-wide text-neutral-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-neutral-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] text-neutral-800 outline-none transition-colors focus:border-neutral-400 disabled:opacity-50';

export const selectClass = inputClass;

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-9 px-3 text-[13px]',
        variant === 'primary' && 'bg-neutral-900 text-white hover:bg-neutral-800',
        variant === 'default' &&
          'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
        variant === 'ghost' && 'text-neutral-600 hover:bg-neutral-100',
        variant === 'danger' && 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-[13px] text-neutral-800">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-400">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-neutral-900' : 'bg-neutral-200',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 size-4 rounded-full bg-white transition-transform',
            checked ? 'left-4.5' : 'left-0.5',
          )}
          style={checked ? { left: 18 } : { left: 2 }}
        />
      </button>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-start sm:px-4 sm:pt-24"
      onClick={onClose}
    >
      <div
        className={clsx(
          // 手机端从底部弹出并占满宽度，桌面端回到居中卡片
          'ddl-pop w-full rounded-t-2xl border border-neutral-200 bg-white shadow-xl sm:rounded-2xl',
          width,
        )}
        onClick={(event) => event.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-neutral-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto px-5 py-4 sm:max-h-[70vh]">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 px-6 py-14 text-center">
      <p className="text-[13.5px] font-medium text-neutral-700">{title}</p>
      {hint && <p className="mt-1.5 max-w-xs text-[12px] leading-relaxed text-neutral-400">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorBar({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
      {message}
    </div>
  );
}

export function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200/80 bg-white px-3 py-2.5">
      <p className="text-[11px] tracking-wide text-neutral-400">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-neutral-900">
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-normal text-neutral-400">{unit}</span>}
      </p>
    </div>
  );
}

/** 简单的柱状图，用于专注 / 打卡趋势 */
export function MiniBars({
  data,
  color,
  height = 56,
}: {
  data: { label: string; value: number }[];
  color: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((item, index) => (
        <div key={`${item.label}-${index}`} className="group relative flex flex-1 flex-col items-center">
          <div
            className="w-full rounded-sm transition-all"
            style={{
              height: Math.max(2, (item.value / max) * height),
              backgroundColor: item.value > 0 ? color : 'rgba(148,148,160,0.25)',
            }}
            title={`${item.label}：${item.value}`}
          />
        </div>
      ))}
    </div>
  );
}
