import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ArrowUp, Copy, FolderOpen, Trash2 } from "lucide-react";
import { MediaPickerDialog } from "./MediaPickerDialog";
import type { Step, StepType } from "@/lib/wa-api";

interface Props {
  step: Step;
  index: number;
  total: number;
  onChange: (s: Step) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function StepEditor({ step, index, total, onChange, onMove, onDuplicate, onDelete }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isMedia = step.type !== "text";
  const filter =
    step.type === "text" ? undefined : (step.type as "image" | "video" | "audio" | "document");

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Subir"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Bajar"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDuplicate} title="Duplicar">
            <Copy className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            title="Eliminar"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div>
          <Label className="mb-1.5 block text-xs">Tipo</Label>
          <Select
            value={step.type}
            onValueChange={(v) =>
              onChange({ ...step, type: v as StepType, simulateRecording: v === "audio" ? step.simulateRecording : false })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Texto</SelectItem>
              <SelectItem value="image">Texto Imagen/Video</SelectItem>
              <SelectItem value="audio">Texto Audio</SelectItem>
              <SelectItem value="document">Texto Documento</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1.5 block text-xs">
            {step.type === "text" ? "Mensaje" : "Ruta del archivo"}
          </Label>
          {step.type === "text" ? (
            <Textarea
              value={step.content}
              onChange={(e) => onChange({ ...step, content: e.target.value })}
              placeholder="Escribe el mensaje..."
              rows={3}
            />
          ) : (
            <div className="flex gap-2">
              <Input
                value={step.content}
                onChange={(e) => onChange({ ...step, content: e.target.value })}
                placeholder="/uploads/archivo.jpg"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                className="shrink-0"
              >
                <FolderOpen className="mr-2 size-4" />
                Biblioteca
              </Button>
            </div>
          )}
        </div>
      </div>

      {isMedia && (
        <div className="mt-3">
          <Label className="mb-1.5 block text-xs">Caption</Label>
          <Input
            value={step.caption ?? ""}
            onChange={(e) => onChange({ ...step, caption: e.target.value })}
            placeholder="Texto opcional debajo del archivo"
          />
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1.5 block text-xs">Delay mínimo (ms)</Label>
          <Input
            type="number"
            min={0}
            value={step.delayMin}
            onChange={(e) => onChange({ ...step, delayMin: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Delay máximo (ms)</Label>
          <Input
            type="number"
            min={0}
            value={step.delayMax}
            onChange={(e) => onChange({ ...step, delayMax: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={step.simulateTyping}
            onCheckedChange={(v) => onChange({ ...step, simulateTyping: !!v })}
          />
          Simular escritura
        </label>
        {step.type === "audio" && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={step.simulateRecording}
              onCheckedChange={(v) => onChange({ ...step, simulateRecording: !!v })}
            />
            Simular grabación
          </label>
        )}
      </div>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        filter={filter}
        onPick={(item) => onChange({ ...step, content: item.path })}
      />
    </div>
  );
}