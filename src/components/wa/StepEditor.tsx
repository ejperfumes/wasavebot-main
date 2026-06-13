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
import { ArrowDown, ArrowUp, Copy, FolderOpen, Trash2, ChevronDown, ChevronRight } from "lucide-react";
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
  const [collapsed, setCollapsed] = useState(true);
  const isMedia = step.type !== "text";
  const isAudio = step.type === "audio";

  // 🔁 CORRECCIÓN: Para tipo "image", permitir mostrar imágenes y vídeos
  const filter = (() => {
    if (step.type === "text") return undefined;
    if (step.type === "image") return "image,video";
    return step.type as "image" | "video" | "audio" | "document";
  })();

  const displayTitle = step.title?.trim() || `Paso ${index + 1}`;

  const handleTypeChange = (newType: StepType) => {
    onChange({
      ...step,
      type: newType,
      simulateTyping: newType === "audio" ? false : step.simulateTyping,
      simulateRecording: newType !== "audio" ? false : step.simulateRecording,
    });
  };

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expandir paso" : "Colapsar paso"}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>

          <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shrink-0">
            {index + 1}
          </div>

          <Input
            value={step.title || ""}
            onChange={(e) => onChange({ ...step, title: e.target.value })}
            placeholder={`Título del paso ${index + 1} (opcional)`}
            className="h-8 text-sm font-medium"
          />
        </div>

        <div className="flex flex-wrap gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Subir paso"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Bajar paso"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDuplicate} title="Duplicar paso">
            <Copy className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            title="Eliminar paso"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <Label className="mb-1.5 block text-xs">Tipo</Label>
              <Select
                value={step.type}
                onValueChange={(v) => handleTypeChange(v as StepType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="image">Imagen/Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                  <SelectItem value="document">Documento</SelectItem>
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

          {/* Caption solo para imagen/video/documento, NO para audio */}
          {isMedia && !isAudio && (
            <div className="mt-3">
              <Label className="mb-1.5 block text-xs">
                Caption{" "}
                <span className="text-muted-foreground font-normal">
                  — soporta *negrita*, _cursiva_, ~tachado~ y saltos de línea
                </span>
              </Label>
              <Textarea
                value={step.caption ?? ""}
                onChange={(e) => onChange({ ...step, caption: e.target.value })}
                placeholder={"Texto opcional debajo del archivo\n*negrita* _cursiva_ ~tachado~"}
                rows={3}
                className="resize-y min-h-[72px] font-mono text-sm"
              />
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs">Delay mínimo (s)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={step.delayMin}
                onChange={(e) => onChange({ ...step, delayMin: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Delay máximo (s)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={step.delayMax}
                onChange={(e) => onChange({ ...step, delayMax: Number(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-4">
            {!isAudio && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={step.simulateTyping}
                  onCheckedChange={(v) => onChange({ ...step, simulateTyping: !!v })}
                />
                Simular escritura
              </label>
            )}
            {isAudio && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!step.simulateRecording}
                  onCheckedChange={(v) => onChange({ ...step, simulateRecording: !!v })}
                />
                Simular grabando audio 🎙️
              </label>
            )}
          </div>
        </div>
      )}

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        filter={filter}
        onPick={(item) => onChange({ ...step, content: item.path })}
      />
    </div>
  );
}