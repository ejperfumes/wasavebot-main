/**
 * QuickRepliesTab
 * Pestaña de gestión de Respuestas Rápidas.
 *
 * Internamente cada respuesta rápida es idéntica a un Flow sin keywords,
 * por lo que reutiliza los mismos tipos (Step, StepType) y el mismo
 * componente StepEditor ya existente. El motor de ejecución en el backend
 * también es exactamente el mismo (enviarMensajeConDelay).
 *
 * Funcionalidades:
 *  - Crear / Editar / Eliminar / Duplicar respuestas rápidas
 *  - Asignar color diferenciador a cada una
 *  - Organizar y reordenar pasos con StepEditor (el mismo de FlowEditor)
 *  - Guardar en config.json vía POST /api/config
 *  - Exportar todas las respuestas rápidas a un archivo JSON
 *  - Importar respuestas rápidas desde un archivo JSON
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Copy,
  Download,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api, uid, type BotConfig, type QuickReply, type Step, type StepType } from "@/lib/wa-api";
import { StepEditor } from "./StepEditor";
import { cn } from "@/lib/utils";

// ─── Colores predefinidos para asignar a las respuestas rápidas ───────────────
const PALETTE = [
  "#22c55e", // verde
  "#3b82f6", // azul
  "#f59e0b", // ámbar
  "#ef4444", // rojo
  "#8b5cf6", // violeta
  "#ec4899", // rosa
  "#06b6d4", // cyan
  "#f97316", // naranja
  "#14b8a6", // teal
  "#6366f1", // índigo
];

// ─── Helper: verifica si la QR puede usar "editar antes de enviar" ───────────
function canEditBeforeSend(steps: ReturnType<typeof newStep>[]): boolean {
  if (steps.length !== 1) return false;
  const s = steps[0];
  if (s.type === "text") return true;
  if (["image", "video", "document"].includes(s.type) && s.caption?.trim()) return true;
  return false;
}

// ─── Fábrica de paso vacío (igual que en FlowEditor) ─────────────────────────
const newStep = (): Step => ({
  id: uid(),
  type: "text" as StepType,
  content: "",
  caption: "",
  delayMin: 8,
  delayMax: 10,
  simulateTyping: true,
  simulateRecording: false,
  title: "",
});

// ─── Fábrica de respuesta rápida vacía ───────────────────────────────────────
const newQuickReply = (): QuickReply => ({
  id: uid(),
  name: "Nueva respuesta",
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  editBeforeSend: false,
  steps: [],
});

// ─── Claves de sessionStorage ─────────────────────────────────────────────────
const QR_SEL_KEY = "wasave_selected_qr";
const QR_DRAFT_KEY = "wasave_qr_draft"; // ← clave para el borrador

// ─── Helpers de persistencia de borrador ─────────────────────────────────────
function saveDraft(quickReplies: QuickReply[]) {
  try {
    sessionStorage.setItem(QR_DRAFT_KEY, JSON.stringify(quickReplies));
  } catch {}
}

function loadDraft(): QuickReply[] | null {
  try {
    const raw = sessionStorage.getItem(QR_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as QuickReply[]) : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(QR_DRAFT_KEY);
  } catch {}
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function QuickRepliesTab() {
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [flows, setFlows] = useState<BotConfig["flows"]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // ─── Ref para el input oculto de importar ────────────────────────────────
  const importInputRef = useRef<HTMLInputElement>(null);

  const setAndPersistId = (id: string | null) => {
    setSelectedId(id);
    try {
      if (id) sessionStorage.setItem(QR_SEL_KEY, id);
      else sessionStorage.removeItem(QR_SEL_KEY);
    } catch {}
  };

  // ─── Cargar config — preferir borrador si existe ──────────────────────────
  useEffect(() => {
    const draft = loadDraft();

    api
      .getConfig()
      .then((cfg) => {
        setFlows(cfg.flows || []);

        // Si hay borrador guardado, usarlo en lugar de los datos del servidor
        if (draft && draft.length > 0) {
          setQuickReplies(draft);
          // Asegurarse de que el id seleccionado existe en el borrador
          const selId = sessionStorage.getItem(QR_SEL_KEY);
          const exists = draft.some((q) => q.id === selId);
          if (!exists && draft.length > 0) {
            setAndPersistId(draft[0].id);
          }
        } else {
          const qrs = normalizeQuickReplies(cfg);
          setQuickReplies(qrs);
          // No se pre-selecciona ninguna al entrar
        }
      })
      .catch((e) =>
        toast.error("No se pudo cargar la configuración", { description: e.message })
      )
      .finally(() => setLoading(false));
  }, []);

  // ─── Persistir borrador automáticamente cada vez que cambian las QR ───────
  useEffect(() => {
    if (!loading) {
      saveDraft(quickReplies);
    }
  }, [quickReplies, loading]);

  // ─── Guardar — preserva flows existentes, solo actualiza quickReplies ─────
  const save = async (qrs: QuickReply[]) => {
    // Validar antes de guardar
    for (const qr of qrs) {
      if (!qr.name.trim()) {
        toast.error("Todas las respuestas rápidas necesitan un nombre");
        return false;
      }
      for (const s of qr.steps) {
        if (!s.content.trim()) {
          toast.error(`"${qr.name}" tiene un paso vacío`);
          return false;
        }
        if (s.delayMax < s.delayMin) {
          toast.error(`"${qr.name}": delay máximo debe ser ≥ mínimo`);
          return false;
        }
      }
    }
    setSaving(true);
    try {
      const cfg: BotConfig = { flows, quickReplies: qrs };
      await api.saveConfig(cfg);
      clearDraft(); // ← borrador ya no es necesario tras guardar exitosamente
      toast.success("Respuestas rápidas guardadas");
      return true;
    } catch (e) {
      toast.error("Error al guardar", { description: (e as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  const handleAdd = () => {
    const qr = newQuickReply();
    const updated = [...quickReplies, qr];
    setQuickReplies(updated);
    setAndPersistId(qr.id);
  };

  const handleUpdate = (updated: QuickReply) => {
    setQuickReplies((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
  };

  const handleDuplicate = (qr: QuickReply) => {
    const copy: QuickReply = {
      ...qr,
      id: uid(),
      name: `${qr.name} (copia)`,
      steps: qr.steps.map((s) => ({ ...s, id: uid() })),
    };
    const updated = [...quickReplies, copy];
    setQuickReplies(updated);
    setAndPersistId(copy.id);
    save(updated);
  };

  const handleDelete = (id: string) => {
    const updated = quickReplies.filter((q) => q.id !== id);
    setQuickReplies(updated);
    if (selectedId === id) setAndPersistId(updated[0]?.id ?? null);
    save(updated);
    setDeleteTarget(null);
  };

  const handleSave = async () => {
    await save(quickReplies);
  };

  // ─── Exportar ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (quickReplies.length === 0) {
      toast.error("No hay respuestas rápidas para exportar");
      return;
    }
    const json = JSON.stringify(quickReplies, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `respuestas-rapidas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${quickReplies.length} respuesta${quickReplies.length !== 1 ? "s" : ""} exportada${quickReplies.length !== 1 ? "s" : ""}`);
  };

  // ─── Importar ─────────────────────────────────────────────────────────────
  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Limpiar el input para permitir importar el mismo archivo de nuevo
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);

        // Validar que sea un array
        if (!Array.isArray(parsed)) {
          toast.error("Archivo inválido", { description: "El JSON debe ser un array de respuestas rápidas." });
          return;
        }

        // Normalizar e importar — asignamos nuevos IDs para evitar colisiones
        const imported: QuickReply[] = parsed.map((qr: Partial<QuickReply>) => ({
          id: uid(),
          name: typeof qr.name === "string" && qr.name.trim() ? qr.name.trim() : "Sin nombre",
          color: typeof qr.color === "string" ? qr.color : "#22c55e",
          editBeforeSend: !!qr.editBeforeSend,
          steps: Array.isArray(qr.steps)
            ? qr.steps.map((s: Partial<Step>) => ({
                id: uid(),
                type: (s.type ?? "text") as StepType,
                content: s.content ?? "",
                caption: s.caption ?? "",
                delayMin: Number(s.delayMin) || 8,
                delayMax: Number(s.delayMax) || 10,
                simulateTyping: !!s.simulateTyping,
                simulateRecording: !!s.simulateRecording,
                title: s.title ?? "",
              }))
            : [],
        }));

        const updated = [...quickReplies, ...imported];
        setQuickReplies(updated);
        setAndPersistId(imported[0]?.id ?? selectedId);
        toast.success(
          `${imported.length} respuesta${imported.length !== 1 ? "s" : ""} importada${imported.length !== 1 ? "s" : ""}`,
          { description: "Revisa y pulsa Guardar para confirmar." }
        );
      } catch {
        toast.error("No se pudo leer el archivo", { description: "Asegúrate de que sea un JSON válido." });
      }
    };
    reader.readAsText(file);
  };

  const selected = quickReplies.find((q) => q.id === selectedId) ?? null;

  // ─── Drag & drop para reordenar la lista ─────────────────────────────────
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
    const arr = [...quickReplies];
    const [moved] = arr.splice(from, 1);
    arr.splice(i, 0, moved);
    setQuickReplies(arr);
    save(arr);
    dragIndex.current = null;
    setDragOverIndex(null);
  }, [quickReplies, flows]);

  const handleDragEnd = useCallback(() => {
    dragIndex.current = null;
    setDragOverIndex(null);
  }, []);

  // ─── Manipulación de pasos del editor ────────────────────────────────────
  const updateStep = (i: number, s: Step) => {
    if (!selected) return;
    const steps = [...selected.steps];
    steps[i] = s;
    handleUpdate({ ...selected, steps });
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    if (!selected) return;
    const j = i + dir;
    if (j < 0 || j >= selected.steps.length) return;
    const steps = [...selected.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    handleUpdate({ ...selected, steps });
  };

  const duplicateStep = (i: number) => {
    if (!selected) return;
    const steps = [...selected.steps];
    steps.splice(i + 1, 0, { ...steps[i], id: uid() });
    handleUpdate({ ...selected, steps });
  };

  const deleteStep = (i: number) => {
    if (!selected) return;
    handleUpdate({ ...selected, steps: selected.steps.filter((_, k) => k !== i) });
  };

  const addStep = () => {
    if (!selected) return;
    handleUpdate({ ...selected, steps: [...selected.steps, newStep()] });
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-6">
      {/* ── Sidebar izquierdo ── */}
      <div className="w-72 shrink-0 border-r pr-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-1.5">
            <Zap className="size-4 text-amber-500" />
            Respuestas rápidas
          </h3>
          <Button size="sm" variant="outline" onClick={handleAdd}>
            <Plus className="size-4 mr-1" /> Nueva
          </Button>
        </div>

        {/* Explicación breve */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          Cada respuesta rápida es una secuencia de mensajes que puedes ejecutar
          manualmente desde cualquier chat con un solo clic.
        </p>

        {/* ── Botones Exportar / Importar ── */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={handleExport}
            title="Exportar todas las respuestas rápidas a un archivo JSON"
          >
            <Download className="size-3.5 mr-1.5" />
            Exportar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={handleImportClick}
            title="Importar respuestas rápidas desde un archivo JSON"
          >
            <Upload className="size-3.5 mr-1.5" />
            Importar
          </Button>
          {/* Input oculto para seleccionar el archivo JSON */}
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>

        {/* Lista */}
        <ScrollArea className="flex-1">
          {quickReplies.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No hay respuestas rápidas.<br />Crea tu primera con el botón "Nueva".
            </div>
          ) : (
            <div className="space-y-1.5 pr-1">
              {quickReplies.map((qr, i) => (
                <div
                  key={qr.id}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setAndPersistId(qr.id)}
                  className={cn(
                    "group relative flex cursor-pointer items-center gap-2 rounded-md border p-2.5 transition-all hover:shadow-sm",
                    selectedId === qr.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-primary/40",
                    dragOverIndex === i && dragIndex.current !== i
                      ? "border-primary/70 bg-primary/10 scale-[1.01]"
                      : ""
                  )}
                >
                  {/* Handle de arrastre */}
                  <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40 cursor-grab active:cursor-grabbing" />
                  {/* Dot de color */}
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: qr.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{qr.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {qr.steps.length} paso{qr.steps.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {/* Acciones rápidas (hover) */}
                  <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(qr); }}
                      title="Duplicar"
                    >
                      <Copy className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(qr.id); }}
                      title="Eliminar"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Editor de la respuesta seleccionada ── */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <div className="space-y-6">
            {/* Cabecera del editor */}
            <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4 shadow-sm">
              {/* Nombre */}
              <div className="flex-1 min-w-[200px]">
                <Label className="mb-1.5 block text-xs">Nombre de la respuesta rápida</Label>
                <div className="flex gap-2">
                  {/* Color picker */}
                  <div className="relative shrink-0">
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(e) => handleUpdate({ ...selected, color: e.target.value })}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      title="Elegir color"
                    />
                    <div
                      className="flex size-10 items-center justify-center rounded-md border cursor-pointer"
                      style={{ backgroundColor: selected.color }}
                      title="Elegir color"
                    >
                      <Pencil className="size-3.5 text-white drop-shadow" />
                    </div>
                  </div>
                  <Input
                    value={selected.name}
                    onChange={(e) => handleUpdate({ ...selected, name: e.target.value })}
                    placeholder="Ej: Bienvenida, Precio, Catálogo..."
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Paleta de colores rápidos */}
              <div>
                <Label className="mb-1.5 block text-xs">Color</Label>
                <div className="flex gap-1">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleUpdate({ ...selected, color: c })}
                      className={cn(
                        "size-6 rounded-full border-2 transition-transform hover:scale-110",
                        selected.color === c ? "border-foreground scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>

              {/* Checkbox editar antes de enviar — solo si la QR lo permite */}
              {canEditBeforeSend(selected.steps) && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={!!selected.editBeforeSend}
                    onChange={(e) => handleUpdate({ ...selected, editBeforeSend: e.target.checked })}
                    className="size-3.5 accent-emerald-500"
                  />
                  <span className="select-none font-medium">Editar antes de enviar</span>
                </label>
              )}

              {/* Botón guardar */}
              <Button onClick={handleSave} disabled={saving} className="ml-auto">
                {saving ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Save className="mr-2 size-4" />
                )}
                Guardar
              </Button>
            </div>

            {/* Preview de cómo se verá en el chat */}
            <div className="rounded-md border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
              <Zap className="size-3 shrink-0" />
              Así aparecerá en la barra del chat:&nbsp;
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ backgroundColor: `${selected.color}22`, color: selected.color, border: `1px solid ${selected.color}` }}
              >
                ● {selected.name || "Sin nombre"}
              </span>
            </div>

            {/* Pasos */}
            <div className="space-y-3">
              {selected.steps.length === 0 && (
                <div className="rounded-lg border border-dashed bg-muted/30 py-10 text-center text-sm text-muted-foreground">
                  Sin pasos aún. Agrega al menos un mensaje.
                </div>
              )}
              {selected.steps.map((step, i) => (
                <StepEditor
                  key={step.id}
                  step={step}
                  index={i}
                  total={selected.steps.length}
                  onChange={(s) => updateStep(i, s)}
                  onMove={(dir) => moveStep(i, dir)}
                  onDuplicate={() => duplicateStep(i)}
                  onDelete={() => deleteStep(i)}
                />
              ))}

              <Button variant="outline" className="w-full" onClick={addStep}>
                <Plus className="mr-2 size-4" /> Agregar paso
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 py-20 text-center text-sm text-muted-foreground">
            <Zap className="size-8 opacity-30" />
            <p>Selecciona o crea una respuesta rápida para editarla.</p>
          </div>
        )}
      </div>

      {/* ── Diálogo de confirmación de eliminación ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta respuesta rápida?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La respuesta rápida desaparecerá
              de todos los chats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Normalizar quickReplies desde la respuesta del backend ──────────────────
function normalizeQuickReplies(cfg: BotConfig): QuickReply[] {
  if (!Array.isArray(cfg.quickReplies)) return [];
  return cfg.quickReplies.map((qr) => ({
    id: qr.id ?? uid(),
    name: qr.name ?? "",
    color: qr.color ?? "#22c55e",
    editBeforeSend: !!qr.editBeforeSend,
    steps: Array.isArray(qr.steps)
      ? qr.steps.map((s) => ({
          id: s.id ?? uid(),
          type: (s.type ?? "text") as StepType,
          content: s.content ?? "",
          caption: s.caption ?? "",
          delayMin: Number(s.delayMin) || 8,
          delayMax: Number(s.delayMax) || 10,
          simulateTyping: !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
          title: s.title ?? "",
        }))
      : [],
  }));
}