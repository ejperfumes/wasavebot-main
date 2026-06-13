import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { StepEditor } from "./StepEditor";
import { uid, type Flow, type FlowSchedule, type MatchType, type Step } from "@/lib/wa-api";

interface Props {
  flow: Flow;
  allFlows: Flow[]; // necesario para elegir flujo alternativo en schedules
  onChange: (f: Flow) => void;
  onDelete: () => void;
  onSave: () => Promise<boolean> | void;
  isSaving?: boolean;
}

const newStep = (): Step => ({
  id: uid(),
  type: "text",
  content: "",
  caption: "",
  delayMin: 8,
  delayMax: 10,
  simulateTyping: true,
  simulateRecording: false,
  title: "",
});

const newSchedule = (): FlowSchedule => ({
  id: uid(),
  hourStart: 8,
  hourEnd: 17,
  flowId: "",
});

// Genera etiqueta legible para un rango horario
function formatHourRange(start: number, end: number): string {
  const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${fmt(start)} – ${fmt(end)}`;
}

export function FlowEditor({ flow, allFlows, onChange, onDelete, onSave, isSaving = false }: Props) {
  const update = (patch: Partial<Flow>) => onChange({ ...flow, ...patch });

  const updateStep = (i: number, s: Step) => {
    const steps = [...flow.steps];
    steps[i] = s;
    update({ steps });
  };
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= flow.steps.length) return;
    const steps = [...flow.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    update({ steps });
  };
  const duplicateStep = (i: number) => {
    const steps = [...flow.steps];
    steps.splice(i + 1, 0, { ...flow.steps[i], id: uid() });
    update({ steps });
  };
  const deleteStep = (i: number) => update({ steps: flow.steps.filter((_, k) => k !== i) });

  // ── Schedules helpers ──────────────────────────────────────────────────────
  const schedules = flow.schedules ?? [];

  const updateSchedule = (i: number, patch: Partial<FlowSchedule>) => {
    const next = [...schedules];
    next[i] = { ...next[i], ...patch };
    update({ schedules: next });
  };

  const deleteSchedule = (i: number) =>
    update({ schedules: schedules.filter((_, k) => k !== i) });

  // Flujos disponibles para seleccionar como alternativo (excluye el flujo actual)
  const otherFlows = allFlows.filter((f) => f.id !== flow.id);

  const handleSave = async () => {
    if (onSave) await onSave();
  };

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="flex-1">
          <Input
            value={flow.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Nombre del flujo"
            className="text-base font-semibold"
          />
        </CardTitle>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Guardar flujo
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Palabras clave ─────────────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <Label>Palabras clave</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update({ keywords: [...flow.keywords, { value: "", match: "contains" }] })
              }
            >
              <Plus className="mr-1 size-4" /> Añadir
            </Button>
          </div>
          <div className="space-y-2">
            {flow.keywords.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin palabras clave configuradas.</p>
            )}
            {flow.keywords.map((kw, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={kw.value}
                  onChange={(e) => {
                    const keywords = [...flow.keywords];
                    keywords[i] = { ...kw, value: e.target.value };
                    update({ keywords });
                  }}
                  placeholder="Palabra o frase"
                />
                <Select
                  value={kw.match}
                  onValueChange={(v) => {
                    const keywords = [...flow.keywords];
                    keywords[i] = { ...kw, match: v as MatchType };
                    update({ keywords });
                  }}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contiene</SelectItem>
                    <SelectItem value="exact">Exacta</SelectItem>
                    <SelectItem value="startsWith">Empieza con</SelectItem>
                    <SelectItem value="endsWith">Termina con</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    update({ keywords: flow.keywords.filter((_, k) => k !== i) })
                  }
                  className="text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Retraso inicial ────────────────────────────────────────────── */}
        <section>
          <div className="mb-2">
            <Label>Retraso inicial del flujo</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Tiempo que espera el bot antes de empezar a responder la primera vez que este chat activa el flujo. Simula que una persona leyó el mensaje antes de responder. Pon 0 en ambos para responder de inmediato o entre 8-15 segundos para algo mas natural.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs">Retraso mínimo (s)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={flow.initialDelayMin}
                onChange={(e) => update({ initialDelayMin: Number(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Retraso máximo (s)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={flow.initialDelayMax}
                onChange={(e) => update({ initialDelayMax: Number(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>
          </div>
        </section>

        {/* ── Programación horaria ───────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <Label className="flex items-center gap-1.5">
                <Clock className="size-3.5" />
                Programación horaria
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Redirige a un flujo diferente según la hora en que se recibe el mensaje.
                Si la hora actual está dentro del rango, se ejecuta el flujo alternativo.
                Si hay varios rangos que coinciden, se usa el primero. Si ninguno coincide,
                se ejecuta este flujo normalmente.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update({ schedules: [...schedules, newSchedule()] })}
              disabled={otherFlows.length === 0}
              title={otherFlows.length === 0 ? "Crea otro flujo primero" : ""}
            >
              <Plus className="mr-1 size-4" /> Añadir rango
            </Button>
          </div>

          {otherFlows.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Para usar programación horaria necesitas al menos dos flujos. Crea otro flujo primero.
            </p>
          )}

          <div className="space-y-3">
            {schedules.length === 0 && otherFlows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Sin rangos horarios. El flujo responde igual a cualquier hora.
              </p>
            )}
            {schedules.map((sched, i) => (
              <div
                key={sched.id}
                className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 px-3 py-3"
              >
                {/* Hora inicio */}
                <div className="flex-1 min-w-[100px]">
                  <Label className="mb-1 block text-xs">Desde (hora)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={sched.hourStart}
                    onChange={(e) =>
                      updateSchedule(i, { hourStart: Math.min(23, Math.max(0, Number(e.target.value))) })
                    }
                    className="h-9"
                  />
                </div>
                {/* Hora fin */}
                <div className="flex-1 min-w-[100px]">
                  <Label className="mb-1 block text-xs">Hasta (hora)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={sched.hourEnd}
                    onChange={(e) =>
                      updateSchedule(i, { hourEnd: Math.min(23, Math.max(0, Number(e.target.value))) })
                    }
                    className="h-9"
                  />
                </div>
                {/* Flujo alternativo */}
                <div className="flex-[2] min-w-[160px]">
                  <Label className="mb-1 block text-xs">Flujo alternativo</Label>
                  <Select
                    value={sched.flowId}
                    onValueChange={(v) => updateSchedule(i, { flowId: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Seleccionar flujo…" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherFlows.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name || `Flujo sin nombre (${f.id.slice(0, 6)})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Etiqueta de rango */}
                <div className="flex items-center gap-2 pb-0.5">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatHourRange(sched.hourStart, sched.hourEnd)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive"
                    onClick={() => deleteSchedule(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pasos del flujo ────────────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <Label>Pasos del flujo</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update({ steps: [...flow.steps, newStep()] })}
            >
              <Plus className="mr-1 size-4" /> Añadir paso
            </Button>
          </div>
          <div className="space-y-3">
            {flow.steps.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin pasos. Agrega el primer paso.</p>
            )}
            {flow.steps.map((step, i) => (
              <StepEditor
                key={step.id}
                step={step}
                index={i}
                total={flow.steps.length}
                onChange={(s) => updateStep(i, s)}
                onMove={(dir) => moveStep(i, dir)}
                onDuplicate={() => duplicateStep(i)}
                onDelete={() => deleteStep(i)}
              />
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}