import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { api, uid, type BotConfig, type Flow } from "@/lib/wa-api";
import { FlowEditor } from "./FlowEditor";

const newFlow = (): Flow => ({
  id: uid(),
  name: "Nuevo flujo",
  keywords: [],
  steps: [],
});

export function FlowsTab() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => setFlows(normalize(cfg)))
      .catch((e) =>
        toast.error("No se pudo cargar la configuración", { description: e.message }),
      )
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    for (const f of flows) {
      if (!f.name.trim()) {
        toast.error("Todos los flujos necesitan un nombre");
        return;
      }
      for (const s of f.steps) {
        if (!s.content.trim()) {
          toast.error(`Flujo "${f.name}" tiene un paso vacío`);
          return;
        }
        if (s.delayMax < s.delayMin) {
          toast.error(`Flujo "${f.name}": delay máximo debe ser ≥ mínimo`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const cfg: BotConfig = { flows };
      await api.saveConfig(cfg);
      toast.success("Configuración guardada");
    } catch (e) {
      toast.error("Error al guardar", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {flows.length} flujo{flows.length === 1 ? "" : "s"} configurado
          {flows.length === 1 ? "" : "s"}.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setFlows([...flows, newFlow()])}>
            <Plus className="mr-2 size-4" />
            Nuevo flujo
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Guardar todo
          </Button>
        </div>
      </div>

      {flows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 py-16 text-center text-sm text-muted-foreground">
          No hay flujos. Crea tu primer flujo para empezar.
        </div>
      ) : (
        <div className="space-y-4">
          {flows.map((flow, i) => (
            <FlowEditor
              key={flow.id}
              flow={flow}
              onChange={(f) => {
                const next = [...flows];
                next[i] = f;
                setFlows(next);
              }}
              onDelete={() => setFlows(flows.filter((_, k) => k !== i))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function normalize(cfg: unknown): Flow[] {
  const raw = (cfg as BotConfig)?.flows;
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => ({
    id: f.id ?? uid(),
    name: f.name ?? "",
    keywords: Array.isArray(f.keywords)
      ? f.keywords.map((k) => ({ value: k.value ?? "", match: k.match ?? "contains" }))
      : [],
    steps: Array.isArray(f.steps)
      ? f.steps.map((s) => ({
          id: s.id ?? uid(),
          type: s.type ?? "text",
          content: s.content ?? "",
          caption: s.caption ?? "",
          delayMin: Number(s.delayMin) || 0,
          delayMax: Number(s.delayMax) || 0,
          simulateTyping: !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
        }))
      : [],
  }));
}