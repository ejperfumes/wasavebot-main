/**
 * NewChatModal.tsx
 * Modal para iniciar conversación nueva con uno o varios números/IDs.
 * - Acepta números (573001234567), IDs (@c.us, @g.us, @lid), uno por línea
 * - Envío secuencial e independiente por contacto
 * - Si un número falla, continúa con los demás y muestra resumen al final
 * - Reutiliza StepEditor igual que QuickRepliesTab
 *
 * FIX VISUAL: reemplaza ScrollArea de Radix por div overflow-y-auto con
 * altura calculada (flex-1 + min-h-0) para que el scroll funcione
 * correctamente con contenido dinámico (StepEditor de altura variable).
 */

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  X,
  Send,
  Plus,
  Loader2,
  MessageSquarePlus,
  CheckCircle2,
  XCircle,
  Users,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { getApiBase, uid, type Step, type StepType } from "@/lib/wa-api";
import { StepEditor } from "./StepEditor";
import { cn } from "@/lib/utils";

// ─── Fábrica de paso vacío ────────────────────────────────────────────────────
const newStep = (): Step => ({
  id: uid(),
  type: "text" as StepType,
  content: "",
  caption: "",
  delayMin: 0,
  delayMax: 0,
  simulateTyping: false,
  simulateRecording: false,
  title: "",
});

// ─── Tipos ────────────────────────────────────────────────────────────────────
type SendStatus = "pending" | "sending" | "ok" | "error";

interface RecipientResult {
  raw: string;
  cleaned: string;
  status: SendStatus;
  error?: string;
  chatId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onChatOpened: (chatId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanNumber(raw: string): string {
  return raw.trim().replace(/\s/g, "");
}

function isValidRecipient(cleaned: string): boolean {
  if (!cleaned) return false;
  return /^\d{6,}$/.test(cleaned) || /@(c\.us|g\.us|lid)$/.test(cleaned);
}

function parseNumbers(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\n,;]+/)
    .map((l) => cleanNumber(l))
    .filter((l) => l.length > 0)
    .filter((l) => {
      if (seen.has(l)) return false;
      seen.add(l);
      return true;
    });
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function NewChatModal({ open, onClose, onChatOpened }: Props) {
  const [numbersRaw, setNumbersRaw] = useState("");
  const [steps, setSteps]           = useState<Step[]>([newStep()]);
  const [sending, setSending]       = useState(false);
  const [error, setError]           = useState("");
  const [results, setResults]       = useState<RecipientResult[] | null>(null);
  const [showSteps, setShowSteps]   = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const multiStep = steps.length > 1;

  // Reset completo al abrir/cerrar
  useEffect(() => {
    if (!open) {
      setNumbersRaw("");
      setSteps([newStep()]);
      setError("");
      setResults(null);
      setSending(false);
      setShowSteps(true);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    if (sending) return;
    onClose();
  };

  // ─── Pasos ────────────────────────────────────────────────────────────────
  const updateStep = (i: number, s: Step) => {
    const next = [...steps]; next[i] = s; setSteps(next);
  };
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; setSteps(next);
  };
  const duplicateStep = (i: number) => {
    const next = [...steps];
    next.splice(i + 1, 0, { ...steps[i], id: uid() });
    setSteps(next);
  };
  const deleteStep = (i: number) => {
    if (steps.length === 1) return;
    setSteps(steps.filter((_, k) => k !== i));
  };
  const addStep = () => setSteps([...steps, newStep()]);

  // ─── Enviar ───────────────────────────────────────────────────────────────
  const handleSend = async () => {
    setError("");
    setResults(null);

    const lines = parseNumbers(numbersRaw);
    if (lines.length === 0) {
      setError("Ingresa al menos un número o ID de WhatsApp");
      return;
    }

    const invalids = lines.filter((l) => !isValidRecipient(l));
    if (invalids.length > 0) {
      setError(`Formato inválido: ${invalids.slice(0, 3).join(", ")}${invalids.length > 3 ? "…" : ""}`);
      return;
    }

    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].content.trim()) {
        setError(`El paso ${i + 1} está vacío`);
        return;
      }
    }

    const initial: RecipientResult[] = lines.map((l) => ({
      raw: l, cleaned: l, status: "pending" as SendStatus,
    }));
    setResults(initial);
    setSending(true);
    setShowSteps(false);

    const base = getApiBase();
    let lastSuccessChatId = "";
    const finalResults: RecipientResult[] = [...initial];

    for (let ri = 0; ri < lines.length; ri++) {
      const cleaned = lines[ri];

      finalResults[ri] = { ...finalResults[ri], status: "sending" };
      setResults([...finalResults]);

      let recipientChatId = "";
      let recipientError  = "";
      let success         = true;

      try {
        for (let si = 0; si < steps.length; si++) {
          const step = steps[si];
          const delaySec = multiStep ? step.delayMin : 0;

          const res = await fetch(`${base}/api/send-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              number:         cleaned,
              type:           step.type,
              content:        step.content,
              caption:        step.caption || "",
              simulateTyping: multiStep ? step.simulateTyping : false,
              delaySec,
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            recipientError = data.error || `Error HTTP ${res.status} en paso ${si + 1}`;
            success = false;
            break;
          }
          if (data.chatId) recipientChatId = data.chatId;
        }
      } catch {
        recipientError = "Error de conexión";
        success = false;
      }

      finalResults[ri] = {
        ...finalResults[ri],
        status: success ? "ok" : "error",
        error:  recipientError || undefined,
        chatId: recipientChatId || undefined,
      };
      setResults([...finalResults]);

      if (success && recipientChatId) lastSuccessChatId = recipientChatId;
    }

    const okCount  = finalResults.filter((r) => r.status === "ok").length;
    const errCount = finalResults.filter((r) => r.status === "error").length;

    if (errCount === 0) {
      toast.success(
        lines.length === 1
          ? "Mensaje enviado correctamente"
          : `${okCount} mensaje${okCount !== 1 ? "s" : ""} enviado${okCount !== 1 ? "s" : ""} correctamente`
      );
    } else {
      toast.warning(`${okCount} enviado${okCount !== 1 ? "s" : ""}, ${errCount} con error`);
    }

    setSending(false);

    if (errCount === 0) {
      onClose();
      if (lastSuccessChatId) onChatOpened(lastSuccessChatId);
    }
  };

  // ─── Derivados ────────────────────────────────────────────────────────────
  const okCount    = results?.filter((r) => r.status === "ok").length    ?? 0;
  const errCount   = results?.filter((r) => r.status === "error").length ?? 0;
  const hasResults = results !== null;
  const parsedCount = parseNumbers(numbersRaw).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/*
        ── Panel principal ──
        Usamos un flex-col con altura fija calculada.
        - h-[calc(100vh-2rem)] en móvil
        - sm:h-auto sm:max-h-[92vh] en desktop
        El área de contenido es flex-1 min-h-0 overflow-y-auto,
        lo que permite scroll nativo sin depender de ScrollArea de Radix.
      */}
      <div className={cn(
        "relative z-10 flex flex-col w-full max-w-2xl rounded-2xl border border-border/60 bg-background shadow-2xl",
        // Altura: en móvil casi toda la pantalla, en desktop máximo 92vh
        "h-[calc(100vh-2rem)] sm:h-auto sm:max-h-[92vh]"
      )}>

        {/* ── Header (fijo, no hace scroll) ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 bg-muted/20 shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
              <MessageSquarePlus className="size-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Nuevo chat</h2>
              <p className="text-[11px] text-muted-foreground">
                {hasResults
                  ? sending
                    ? `Enviando… ${okCount + errCount} de ${results!.length}`
                    : `${okCount} enviado${okCount !== 1 ? "s" : ""} · ${errCount} error${errCount !== 1 ? "es" : ""}`
                  : multiStep
                  ? `${steps.length} pasos · con delays`
                  : "Envío directo sin delays"}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={sending}
            className="flex size-7 items-center justify-center rounded-full hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/*
          ── Área de scroll ──
          flex-1 + min-h-0 es la combinación clave:
          flex-1 ocupa todo el espacio disponible entre header y footer,
          min-h-0 evita que flexbox ignore overflow y no genere scroll.
        */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── Textarea de números ── */}
          {!hasResults && (
            <div>
              <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Users className="size-3" />
                Números / IDs de WhatsApp
                {parsedCount > 0 && (
                  <span className="ml-auto text-emerald-600 font-semibold">
                    {parsedCount} destinatario{parsedCount !== 1 ? "s" : ""}
                  </span>
                )}
              </Label>
              <textarea
                ref={textareaRef}
                value={numbersRaw}
                onChange={(e) => { setNumbersRaw(e.target.value); setError(""); }}
                placeholder={
`573001234567
573009876543
216423553048625@lid
65506891538684@lid
573001111111@c.us`}
                disabled={sending}
                rows={5}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-y disabled:opacity-50"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Un número o ID por línea. Acepta:{" "}
                <span className="font-mono">573001234567</span>,{" "}
                <span className="font-mono">@c.us</span>,{" "}
                <span className="font-mono">@g.us</span>,{" "}
                <span className="font-mono">@lid</span>
              </p>
            </div>
          )}

          {/* ── Resultados del envío ── */}
          {hasResults && (
            <div className="space-y-2">
              {/* Barra de progreso */}
              {sending && (
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${((okCount + errCount) / results!.length) * 100}%` }}
                  />
                </div>
              )}

              {/* Lista de resultados */}
              <div className="space-y-1.5">
                {results!.map((r, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs border",
                      r.status === "ok"      && "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                      r.status === "error"   && "bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-400",
                      r.status === "sending" && "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-400",
                      r.status === "pending" && "bg-muted/40 border-border/30 text-muted-foreground",
                    )}
                  >
                    {r.status === "ok"      && <CheckCircle2 className="size-3.5 shrink-0" />}
                    {r.status === "error"   && <XCircle className="size-3.5 shrink-0" />}
                    {r.status === "sending" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                    {r.status === "pending" && <div className="size-3.5 shrink-0 rounded-full border-2 border-current" />}

                    <span className="font-mono truncate flex-1">{r.raw}</span>

                    {r.status === "ok"      && <span className="shrink-0 opacity-70">Enviado</span>}
                    {r.status === "sending" && <span className="shrink-0 opacity-70">Enviando…</span>}
                    {r.status === "pending" && <span className="shrink-0 opacity-70">En espera</span>}
                    {r.status === "error"   && (
                      <span className="shrink-0 truncate max-w-[140px]" title={r.error}>{r.error}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Resumen final */}
              {!sending && (
                <div className={cn(
                  "rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2",
                  errCount === 0
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                )}>
                  {errCount === 0
                    ? <CheckCircle2 className="size-3.5" />
                    : <XCircle className="size-3.5" />
                  }
                  {errCount === 0
                    ? "Todos los mensajes se enviaron correctamente"
                    : `${okCount} enviado${okCount !== 1 ? "s" : ""} · ${errCount} fallido${errCount !== 1 ? "s" : ""} — puedes cerrar o reintentar`
                  }
                </div>
              )}
            </div>
          )}

          {/* ── Sección de pasos ── */}
          {!hasResults && (
            <div>
              {/* Cabecera colapsable */}
              <button
                onClick={() => setShowSteps((v) => !v)}
                className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground mb-3 hover:text-foreground transition-colors py-1"
              >
                <span className="flex items-center gap-1.5">
                  Mensajes a enviar
                  <span className="bg-muted rounded-full px-1.5 py-0.5 text-[10px]">
                    {steps.length} paso{steps.length !== 1 ? "s" : ""}
                  </span>
                </span>
                {showSteps
                  ? <ChevronUp className="size-3.5" />
                  : <ChevronDown className="size-3.5" />
                }
              </button>

              {showSteps && (
                <div className="space-y-3">
                  {multiStep && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      Con múltiples pasos se respetan los delays y simulación de escritura de cada paso.
                    </div>
                  )}

                  {steps.map((step, i) => (
                    <StepEditor
                      key={step.id}
                      step={step}
                      index={i}
                      total={steps.length}
                      onChange={(s) => updateStep(i, s)}
                      onMove={(dir) => moveStep(i, dir)}
                      onDuplicate={() => duplicateStep(i)}
                      onDelete={() => deleteStep(i)}
                    />
                  ))}

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={addStep}
                    disabled={sending}
                  >
                    <Plus className="mr-2 size-4" />
                    Agregar paso
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer (fijo, no hace scroll) ── */}
        <div className="px-5 py-4 border-t border-border/30 bg-muted/10 shrink-0 flex flex-col gap-2 rounded-b-2xl">
          {error && (
            <p className="text-xs text-rose-500">{error}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleClose}
              disabled={sending}
            >
              {hasResults && !sending ? "Cerrar" : "Cancelar"}
            </Button>

            {(!hasResults || (!sending && errCount > 0)) && (
              <Button
                className={cn(
                  "flex-1 gap-2",
                  sending
                    ? "bg-emerald-500/70 cursor-not-allowed"
                    : "bg-emerald-500 hover:bg-emerald-600"
                )}
                onClick={hasResults
                  ? () => {
                      // Reintentar solo los fallidos
                      const failed = results!
                        .filter((r) => r.status === "error")
                        .map((r) => r.raw);
                      setResults(null);
                      setShowSteps(true);
                      setNumbersRaw(failed.join("\n"));
                    }
                  : handleSend
                }
                disabled={sending}
              >
                {sending ? (
                  <><Loader2 className="size-4 animate-spin" />Enviando…</>
                ) : hasResults ? (
                  <><Send className="size-4" />Reintentar {errCount} fallido{errCount !== 1 ? "s" : ""}</>
                ) : (
                  <><Send className="size-4" />
                    {parsedCount <= 1
                      ? "Enviar mensaje"
                      : `Enviar a ${parsedCount} contacto${parsedCount !== 1 ? "s" : ""}`}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}