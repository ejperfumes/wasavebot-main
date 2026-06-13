import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { api, uid, type BotConfig, type Flow, type MatchType, type StepType } from "@/lib/wa-api";
import { FlowEditor } from "./FlowEditor";
import { FlowListSidebar } from "./FlowListSidebar";
import { AllFlowsModal } from "./AllFlowsModal";

const newFlow = (): Flow => ({
  id: uid(),
  name: "Nuevo flujo",
  keywords: [],
  steps: [],
  initialDelayMin: 0,
  initialDelayMax: 0,
});

const FLOW_SEL_KEY = "wasave_selected_flow";
const FLOW_DRAFT_KEY = "wasave_flows_draft"; // ← clave para el borrador

// ─── Helpers de persistencia de borrador ─────────────────────────────────────
function saveDraft(flows: Flow[]) {
  try {
    sessionStorage.setItem(FLOW_DRAFT_KEY, JSON.stringify(flows));
  } catch {}
}

function loadDraft(): Flow[] | null {
  try {
    const raw = sessionStorage.getItem(FLOW_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Flow[]) : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(FLOW_DRAFT_KEY);
  } catch {}
}

export function FlowsTab() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [quickReplies, setQuickReplies] = useState<BotConfig["quickReplies"]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAllModal, setShowAllModal] = useState(false);

  const setAndPersistFlowId = (id: string | null) => {
    setSelectedFlowId(id);
    try {
      if (id) sessionStorage.setItem(FLOW_SEL_KEY, id);
      else sessionStorage.removeItem(FLOW_SEL_KEY);
    } catch {}
  };

  // ─── Al montar: preferir borrador sobre datos del servidor ────────────────
  useEffect(() => {
    const draft = loadDraft();

    api
      .getConfig()
      .then((cfg) => {
        const normalized = normalize(cfg);
        setQuickReplies(cfg.quickReplies || []);

        // Si hay borrador guardado, usarlo en lugar de los datos del servidor
        if (draft && draft.length > 0) {
          setFlows(draft);
          // No se pre-selecciona ninguno al entrar
        } else {
          setFlows(normalized);
          // No se pre-selecciona ninguno al entrar
        }
      })
      .catch((e) =>
        toast.error("No se pudo cargar la configuración", { description: e.message }),
      )
      .finally(() => setLoading(false));
  }, []);

  // ─── Persistir borrador automáticamente cada vez que cambian los flujos ───
  useEffect(() => {
    if (!loading && flows.length >= 0) {
      saveDraft(flows);
    }
  }, [flows, loading]);

  const saveAllFlows = async (flowsToSave?: Flow[]) => {
    const target = flowsToSave ?? flows;
    for (const f of target) {
      if (!f.name.trim()) {
        toast.error("Todos los flujos necesitan un nombre");
        return false;
      }
      for (const s of f.steps) {
        if (!s.content.trim()) {
          toast.error(`Flujo "${f.name}" tiene un paso vacío`);
          return false;
        }
        if (s.delayMax < s.delayMin) {
          toast.error(`Flujo "${f.name}": delay máximo debe ser ≥ mínimo`);
          return false;
        }
      }
    }
    setSaving(true);
    try {
      const cfg: BotConfig = { flows: target, quickReplies };
      await api.saveConfig(cfg);
      clearDraft(); // ← borrador ya no es necesario tras guardar exitosamente
      toast.success("Configuración guardada");
      return true;
    } catch (e) {
      toast.error("Error al guardar", { description: (e as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateFlow = (updatedFlow: Flow) => {
    setFlows(flows.map(f => f.id === updatedFlow.id ? updatedFlow : f));
  };

  const deleteFlow = (flowId: string) => {
    const newFlows = flows.filter(f => f.id !== flowId);
    setFlows(newFlows);
    if (selectedFlowId === flowId) {
      setAndPersistFlowId(newFlows.length > 0 ? newFlows[0].id : null);
    }
    saveAllFlows();
  };

  const duplicateFlow = (flowToDuplicate: Flow) => {
    const duplicated: Flow = {
      ...flowToDuplicate,
      id: uid(),
      name: `${flowToDuplicate.name} (copia)`,
      steps: flowToDuplicate.steps.map(s => ({ ...s, id: uid() })),
      keywords: flowToDuplicate.keywords.map(k => ({ ...k })),
    };
    const newFlows = [...flows, duplicated];
    setFlows(newFlows);
    setAndPersistFlowId(duplicated.id);
    saveAllFlows();
  };

  const addNewFlow = () => {
    const newF = newFlow();
    setFlows([...flows, newF]);
    setAndPersistFlowId(newF.id);
  };

  const selectedFlow = flows.find(f => f.id === selectedFlowId) || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-6">
      {/* Sidebar izquierdo */}
      <div className="w-72 shrink-0 border-r pr-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Mis flujos</h3>
          <Button size="sm" variant="outline" onClick={addNewFlow}>
            <Plus className="size-4 mr-1" /> Nuevo
          </Button>
        </div>
        <FlowListSidebar
          flows={flows}
          selectedId={selectedFlowId}
          onSelect={setAndPersistFlowId}
          onDuplicate={duplicateFlow}
          onDelete={deleteFlow}
          onReorder={(reordered) => {
            setFlows(reordered);
            saveAllFlows(reordered);
          }}
        />
        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => setShowAllModal(true)}
          >
            <Eye className="size-4 mr-2" />
            Ver todos
          </Button>
        </div>
      </div>

      {/* Área principal: editor del flujo seleccionado */}
      <div className="flex-1 overflow-auto">
        {selectedFlow ? (
          <FlowEditor
            key={selectedFlow.id}
            flow={selectedFlow}
            allFlows={flows}
            onChange={updateFlow}
            onDelete={() => deleteFlow(selectedFlow.id)}
            onSave={saveAllFlows}
            isSaving={saving}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/30 py-16 text-center text-sm text-muted-foreground">
            No hay flujos. Crea tu primer flujo usando el botón "Nuevo".
          </div>
        )}
      </div>

      {/* Modal "Ver todos" */}
      <AllFlowsModal
        open={showAllModal}
        onOpenChange={setShowAllModal}
        flows={flows}
        onEdit={(flow) => {
          setAndPersistFlowId(flow.id);
          setShowAllModal(false);
        }}
        onDuplicate={duplicateFlow}
        onDelete={deleteFlow}
      />
    </div>
  );
}

function normalize(cfg: unknown): Flow[] {
  const raw = (cfg as BotConfig)?.flows;
  if (!Array.isArray(raw)) return [];
  return raw.map((flow): Flow => {
    const keywords = Array.isArray(flow.keywords)
      ? flow.keywords.map((k: any) => ({
          value: k.value ?? "",
          match: (k.match ?? "contains") as MatchType,
        }))
      : [];

    const steps = Array.isArray(flow.steps)
      ? flow.steps.map((s: any) => ({
          id: s.id ?? uid(),
          type: (s.type ?? "text") as StepType,
          content: s.content ?? "",
          caption: s.caption ?? "",
          delayMin: Number(s.delayMin) || 8,
          delayMax: Number(s.delayMax) || 10,
          simulateTyping: !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
        }))
      : [];

    return {
      id: flow.id ?? uid(),
      name: flow.name ?? "",
      keywords,
      steps,
      initialDelayMin: Number(flow.initialDelayMin) || 0,
      initialDelayMax: Number(flow.initialDelayMax) || 0,
    };
  });
}