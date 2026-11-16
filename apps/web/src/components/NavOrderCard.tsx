import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { GripVertical, RotateCcw } from 'lucide-react';
import { ALL_NAV_ITEMS, normalizeNavOrder } from '../lib/nav';

function SortableRow({ itemKey }: { itemKey: string }) {
  const item = ALL_NAV_ITEMS.find((entry) => entry.key === itemKey);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemKey,
  });
  const Icon = item?.icon;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5',
        isDragging && 'z-10 shadow-md',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none rounded p-0.5 text-neutral-300 hover:text-neutral-500 active:cursor-grabbing"
        aria-label="拖动排序"
      >
        <GripVertical className="size-4" />
      </button>
      {Icon && <Icon className="size-3.5 text-neutral-400" />}
      <span className="text-[12.5px] text-neutral-700">{item?.label ?? itemKey}</span>
    </div>
  );
}

export function NavOrderCard({
  order,
  onChange,
}: {
  order: string[];
  onChange: (next: string[]) => void;
}) {
  // 空数组代表使用内置顺序，这里补全成完整列表再渲染
  const items = normalizeNavOrder(order);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.indexOf(String(active.id));
    const to = items.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(items, from, to));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11.5px] text-neutral-400">拖动左侧把手调整顺序，改完立即生效</p>
        <button
          type="button"
          onClick={() => onChange([])}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-neutral-500 hover:bg-neutral-100"
        >
          <RotateCcw className="size-3" />
          恢复默认
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={rectSortingStrategy}>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {items.map((key) => (
              <SortableRow key={key} itemKey={key} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
