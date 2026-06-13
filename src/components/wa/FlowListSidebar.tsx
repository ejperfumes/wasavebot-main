import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import type { Flow } from "@/lib/wa-api";

interface Props {
  flows: Flow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDuplicate: (flow: Flow) => void;
  onDelete: (id: string) => void;
  onReorder?: (flows: Flow[]) => void;
}

export function FlowListSidebar({ flows, selectedId, onSelect, onDuplicate, onDelete, onReorder }: Props) {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((i: number) => {
    dragIndex.current = i;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIndex(i);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === i) { setDragOverIndex(null); return; }
    const arr = [...flows];
    const [moved] = arr.splice(from, 1);
    arr.splice(i, 0, moved);
    onReorder?.(arr);
    dragIndex.current = null;
    setDragOverIndex(null);
  }, [flows, onReorder]);

  const handleDragEnd = useCallback(() => {
    dragIndex.current = null;
    setDragOverIndex(null);
  }, []);

  if (flows.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        No hay flujos guardados
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {flows.map((flow, i) => (
        <div
          key={flow.id}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          className={cn(
            "group relative rounded-md border p-2 transition-all hover:shadow-sm cursor-pointer",
            selectedId === flow.id
              ? "border-primary bg-primary/5 ring-1 ring-primary"
              : "border-border hover:border-primary/50",
            dragOverIndex === i && dragIndex.current !== i
              ? "border-primary/70 bg-primary/10 scale-[1.01]"
              : ""
          )}
          onClick={() => onSelect(flow.id)}
        >
          <div className="flex items-center gap-2">
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40 cursor-grab active:cursor-grabbing" />
            <div className="min-w-0 flex-1 pr-14">
              <div className="text-sm font-medium truncate">{flow.name}</div>
              <div className="text-xs text-muted-foreground">
                {flow.steps.length} paso{flow.steps.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(flow);
              }}
              title="Duplicar"
            >
              <Copy className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(flow.id);
              }}
              title="Eliminar"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}