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
import { Plus, Trash2 } from "lucide-react";
import { StepEditor } from "./StepEditor";
import { uid, type Flow, type MatchType, type Step } from "@/lib/wa-api";

interface Props {
  flow: Flow;
  onChange: (f: Flow) => void;
  onDelete: () => void;
}

const newStep = (): Step => ({
  id: uid(),
  type: "text",
  content: "",
  caption: "",
  delayMin: 500,
  delayMax: 1500,
  simulateTyping: true,
  simulateRecording: false,
});

export function FlowEditor({ flow, onChange, onDelete }: Props) {
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
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