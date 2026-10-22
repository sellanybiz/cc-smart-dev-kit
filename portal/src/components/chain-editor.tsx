"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import type { ModelRow } from "@/api/types";
import { Sparkline } from "@/components/sparkline";
import { useMounted } from "@/components/status";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { duration, percent, seconds, targetBackend, targetModel } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ChainItem {
  target: string;
  restingFor: null | number;
}

/** A target's last day, from the request history: its success rate and its latency. */
export interface TargetStats {
  requests: number;
  success: number;
  p50Ms: number;
  /** The median per bucket, oldest first, for the small line. */
  line: number[];
}

/** A model row as a target, the way `gateway.json` spells it. */
export function targetOf(model: ModelRow): string {
  return model.plan ? model.id : `${model.backend}:${model.id}`;
}

function ItemBody({
  item,
  index,
  answering,
  count,
  onMove,
  onRemove,
  handle,
  stats,
}: {
  item: ChainItem;
  index: number;
  answering: boolean;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  handle: React.ReactNode;
  stats: TargetStats | undefined;
}) {
  const model = targetModel(item.target);
  return (
    <>
      {handle}
      <span
        className="w-5 text-right text-xs text-muted-foreground tabular-nums"
        aria-hidden="true"
      >
        {index + 1}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-sm">{model}</span>
        <span className="text-xs text-muted-foreground">{targetBackend(item.target)}</span>
      </span>
      {answering && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          answers now
        </span>
      )}
      {stats !== undefined && stats.requests > 0 && (
        <span className="hidden items-center gap-3 text-xs text-muted-foreground tabular-nums @xl/main:flex">
          <span className={cn(stats.success < 0.95 && "text-warn")}>
            {percent(stats.success)} ok
          </span>
          <span>{duration(stats.p50Ms)}</span>
          <Sparkline
            values={stats.line}
            label={`${targetModel(item.target)}: median time over the last day, now ${duration(stats.p50Ms)}`}
            width={56}
            height={18}
          />
        </span>
      )}
      {item.restingFor !== null && (
        <span className="text-xs text-warn">
          <span aria-hidden="true">! </span>rests {seconds(item.restingFor)}
        </span>
      )}
      <span className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move ${model} up`}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move ${model} down`}
        >
          <ArrowDownIcon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onRemove(index)}
          aria-label={`Remove ${model}`}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </span>
    </>
  );
}

const ROW = "flex items-center gap-2 rounded-md border bg-background px-2 py-1.5";

/** A row that drags. Its transform goes through the CSSOM after mount: never a style attribute. */
function SortableItem(props: Omit<React.ComponentProps<typeof ItemBody>, "handle">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.target });
  return (
    <li
      ref={setNodeRef}
      className={cn(ROW, isDragging && "relative z-10 shadow-md")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <ItemBody
        {...props}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="flex size-7 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
            aria-label={`Drag ${targetModel(props.item.target)} to reorder`}
          >
            <GripVerticalIcon className="size-4" aria-hidden="true" />
          </button>
        }
      />
    </li>
  );
}

/**
 * A slot's chain: its targets in order, the first that is not resting answers. Drag a row, or
 * use its arrows; add a target from the live model list. The chain is a draft in the page.
 */
export function ChainEditor({
  items,
  models,
  onChange,
  label,
  stats,
}: {
  items: ChainItem[];
  models: ModelRow[];
  onChange: (items: ChainItem[]) => void;
  label: string;
  stats: Map<string, TargetStats>;
}) {
  const mounted = useMounted();
  const selectId = useId();
  const [adding, setAdding] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const answering = items.findIndex((item) => item.restingFor === null);
  const move = (from: number, to: number) => onChange(arrayMove(items, from, to));
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = items.findIndex((item) => item.target === active.id);
    const to = items.findIndex((item) => item.target === over.id);
    if (from !== -1 && to !== -1) move(from, to);
  };
  const inChain = new Set(items.map((item) => item.target));
  const free = models.filter((model) => !inChain.has(targetOf(model)));
  const backends = [...new Set(free.map((model) => model.backend))];

  const common = (item: ChainItem, index: number) => ({
    item,
    index,
    answering: index === answering,
    count: items.length,
    onMove: move,
    onRemove: remove,
    stats: stats.get(item.target),
  });

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
          No chain: Claude answers this slot on your own login.
        </p>
      ) : mounted ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "To move a target, press space or enter, then the arrow keys, then space or enter again to drop it.",
            },
          }}
        >
          <SortableContext
            items={items.map((item) => item.target)}
            strategy={verticalListSortingStrategy}
          >
            <ol aria-label={label} className="flex flex-col gap-1.5">
              {items.map((item, index) => (
                <SortableItem key={item.target} {...common(item, index)} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <ol aria-label={label} className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <li key={item.target} className={ROW}>
              <ItemBody
                {...common(item, index)}
                handle={
                  <span className="flex size-7 items-center justify-center text-muted-foreground">
                    <GripVerticalIcon className="size-4" aria-hidden="true" />
                  </span>
                }
              />
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Add a target to {label}
        </label>
        <NativeSelect
          id={selectId}
          size="sm"
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          className="min-w-56"
        >
          <NativeSelectOption value="">Choose a model…</NativeSelectOption>
          {backends.map((backend) => (
            <NativeSelectOptGroup key={backend} label={backend}>
              {free
                .filter((model) => model.backend === backend)
                .map((model) => (
                  <NativeSelectOption key={targetOf(model)} value={targetOf(model)}>
                    {model.id}
                    {model.context === "—" ? "" : ` (${model.context})`}
                  </NativeSelectOption>
                ))}
            </NativeSelectOptGroup>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          disabled={adding === ""}
          onClick={() => {
            onChange([...items, { target: adding, restingFor: null }]);
            setAdding("");
          }}
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add to the end
        </Button>
      </div>
    </div>
  );
}
