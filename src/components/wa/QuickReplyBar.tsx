import { useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Zap, CheckCircle2, XCircle, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/wa-api";
import type { QuickReply } from "@/lib/wa-api";
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

interface ProgressState {
  quickReplyId: string;
  step: number;
  total: number;
  done: boolean;
  error: string | null;
}

interface Props {
  chatId: string;
  quickReplies: QuickReply[];
  progress: ProgressState | null;
  onLoadTemplate?: (text: string) => void; // carga texto en el textarea
  onLoadAttachment?: (mediaPath: string, caption: string, type: "image" | "video" | "document") => void; // carga archivo con caption
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Determina si una QR aplica para "editar antes de enviar":
 *  - exactamente 1 paso
 *  - ese paso tiene contenido de texto (type text, o media CON caption)
 */
function canEditBeforeSend(qr: QuickReply): boolean {
  if (qr.steps.length !== 1) return false;
  const step = qr.steps[0];
  if (step.type === "text") return true;
  // imagen/video/documento con caption
  if (["image", "video", "document"].includes(step.type) && step.caption?.trim()) return true;
  return false;
}

/** Extrae el texto editable del paso */
function getEditableText(qr: QuickReply): string {
  const step = qr.steps[0];
  if (step.type === "text") return typeof step.content === "string" ? step.content : "";
  return step.caption ?? "";
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function QuickReplyBar({ chatId, quickReplies, progress, onLoadTemplate, onLoadAttachment }: Props) {
  const isRunning = progress !== null && !progress.done && !progress.error;
  const runningId = progress?.quickReplyId ?? null;

  // Diálogo de cancelación
  const [cancelDialog, setCancelDialog] = useState(false);

  // Ejecutar o cargar plantilla
  const handleExecute = async (qr: QuickReply) => {
    if (isRunning) return;

    // Modo "editar antes de enviar"
    if (qr.editBeforeSend && canEditBeforeSend(qr)) {
      const step = qr.steps[0];
      // Archivo con caption → abrir modal de adjunto
      if (["image", "video", "document"].includes(step.type) && onLoadAttachment) {
        onLoadAttachment(
          typeof step.content === "string" ? step.content : "",
          step.caption ?? "",
          step.type as "image" | "video" | "document"
        );
        toast.info(`"${qr.name}" cargado — edita el caption y pulsa Enviar`);
        return;
      }
      // Texto → cargar en textarea
      if (step.type === "text" && onLoadTemplate) {
        onLoadTemplate(getEditableText(qr));
        toast.info(`"${qr.name}" cargado — edita y pulsa Enviar`);
        return;
      }
      // Fallback: si no hay handler disponible, ejecutar normalmente
    }

    try {
      await api.executeQuickReply(chatId, qr.id);
    } catch (e) {
      toast.error(`Error al ejecutar "${qr.name}"`, { description: (e as Error).message });
    }
  };

  // Confirmar cancelación
  const handleCancelConfirm = async () => {
    setCancelDialog(false);
    try {
      await api.cancelQuickReply(chatId);
      toast.info("Cancelando… el paso en curso terminará antes de parar.");
    } catch (e) {
      toast.error("No se pudo cancelar", { description: (e as Error).message });
    }
  };

  if (quickReplies.length === 0) return null;

  return (
    <>
      <div className="border-t bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Zap className="size-3" />
            <span className="hidden sm:inline">Rápidas:</span>
          </div>

          <div className="flex gap-1.5 flex-nowrap">
            {quickReplies.map((qr) => {
              const isThisOne = runningId === qr.id;
              const isDone = isThisOne && progress?.done;
              const isError = isThisOne && !!progress?.error;
              const isCancelled = isThisOne && progress?.error === "Cancelado";
              const step = isThisOne ? progress!.step : 0;
              const total = isThisOne ? progress!.total : qr.steps.length;
              const isTemplate = qr.editBeforeSend && canEditBeforeSend(qr);

              return (
                <button
                  key={qr.id}
                  onClick={() => handleExecute(qr)}
                  disabled={isRunning && !isThisOne}
                  title={
                    isTemplate
                      ? `${qr.name} · Cargar como plantilla`
                      : `${qr.name} · ${qr.steps.length} paso${qr.steps.length !== 1 ? "s" : ""}`
                  }
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all select-none",
                    "disabled:cursor-not-allowed",
                    isRunning && !isThisOne && "opacity-40",
                    isThisOne && !isDone && !isError && "opacity-90",
                    isDone && "opacity-100",
                    !isRunning && "hover:shadow-sm active:scale-95",
                    // plantilla: borde punteado para diferenciar
                    isTemplate && !isThisOne && "border-dashed"
                  )}
                  style={{
                    borderColor: isCancelled ? "#f59e0b" : isError ? "#ef4444" : qr.color,
                    color: isThisOne ? "#fff" : qr.color,
                    backgroundColor: isCancelled
                      ? "#f59e0b22"
                      : isError
                      ? "#ef444422"
                      : isThisOne
                      ? qr.color
                      : `${qr.color}18`,
                  }}
                >
                  {isThisOne ? (
                    isDone ? (
                      <CheckCircle2 className="size-3 shrink-0" />
                    ) : isError ? (
                      <XCircle className="size-3 shrink-0" style={{ color: isCancelled ? "#f59e0b" : "#ef4444" }} />
                    ) : (
                      <Loader2 className="size-3 animate-spin shrink-0" />
                    )
                  ) : isTemplate ? (
                    // ícono de plantilla: lápiz pequeño
                    <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14H2v-3L11.5 1.5z"/>
                    </svg>
                  ) : (
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: qr.color }}
                    />
                  )}
                  <span className="max-w-[130px] truncate">
                    {isThisOne && !isDone && !isError && step > 0
                      ? `${step}/${total}`
                      : isThisOne && isDone
                      ? "✓ Enviado"
                      : isCancelled
                      ? "Cancelado"
                      : isThisOne && isError
                      ? "Error"
                      : qr.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Botón cancelar — solo visible cuando hay envío en curso */}
          {isRunning && (
            <button
              onClick={() => setCancelDialog(true)}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-rose-400 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600 transition-all hover:bg-rose-100 active:scale-95 dark:bg-rose-950/30 dark:hover:bg-rose-950/50"
              title="Cancelar envío"
            >
              <X className="size-3" />
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Diálogo de confirmación de cancelación */}
      <AlertDialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar el envío?</AlertDialogTitle>
            <AlertDialogDescription>
              El paso que está enviándose en este momento terminará, pero los siguientes
              pasos se detendrán de inmediato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, continuar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-500 text-white hover:bg-rose-600"
              onClick={handleCancelConfirm}
            >
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}