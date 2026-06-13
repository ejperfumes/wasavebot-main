// src/components/wa/VoiceRecorderButton.tsx
import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Send, Trash2, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import useAudioRecorder from "@/hooks/useAudioRecorder";

interface VoiceRecorderButtonProps {
  onSend: (audioBlob: Blob) => Promise<void>;
  disabled?: boolean;
  // Callback para que QuickSendTab sepa si estamos en modo grabación
  // y oculte el textarea + botón enviar
  onRecordingModeChange?: (active: boolean) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function RecordingWaves({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-emerald-500"
          style={
            active
              ? {
                  height: `${[6, 12, 16, 10, 6][i]}px`,
                  animation: `waBar 0.7s ease-in-out ${i * 0.1}s infinite alternate`,
                }
              : { height: "4px", opacity: 0.35 }
          }
        />
      ))}
      <style>{`
        @keyframes waBar {
          from { transform: scaleY(0.35); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

export function VoiceRecorderButton({
  onSend,
  disabled,
  onRecordingModeChange,
}: VoiceRecorderButtonProps) {
  // panel visible = grabando, pausado o audio listo para enviar
  const [panelOpen, setPanelOpen] = useState(false);
  const [readyBlob, setReadyBlob] = useState<Blob | null>(null);
  const [uploadSending, setUploadSending] = useState(false);

  const {
    isRecording,
    isPaused,
    recordingTime,
    audioBlob,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    reset,
  } = useAudioRecorder();

  // Cuando el hook produce el blob tras stopRecording → modo listo
  useEffect(() => {
    if (audioBlob && !isRecording && !isPaused) {
      setReadyBlob(audioBlob);
    }
  }, [audioBlob, isRecording, isPaused]);

  // Error de micrófono → cerrar panel
  useEffect(() => {
    if (error) {
      setPanelOpen(false);
      setReadyBlob(null);
      onRecordingModeChange?.(false);
    }
  }, [error]);

  // Notificar al padre cada vez que cambia si estamos en modo grabación
  useEffect(() => {
    onRecordingModeChange?.(panelOpen);
  }, [panelOpen]);

  /* ── Handlers ── */

  const handleStart = () => {
    if (disabled) return;
    reset();
    setReadyBlob(null);
    setPanelOpen(true);
    startRecording();
  };

  const handlePause = () => pauseRecording();
  const handleResume = () => resumeRecording();

  const handleStop = () => {
    stopRecording();
    // readyBlob se setea via useEffect cuando el hook termina
  };

  const handleCancel = () => {
    cancelRecording();
    reset();
    setReadyBlob(null);
    setPanelOpen(false);
    onRecordingModeChange?.(false);
  };

  const handleSend = async () => {
    if (!readyBlob || uploadSending) return;
    setUploadSending(true);
    try {
      await onSend(readyBlob);
      setReadyBlob(null);
      setPanelOpen(false);
      reset();
      onRecordingModeChange?.(false);
    } catch (err) {
      console.error("Error enviando nota de voz", err);
    } finally {
      setUploadSending(false);
    }
  };

  /* ── Estados derivados ── */
  const isActive   = isRecording && !isPaused;   // grabando activamente
  const isStopped  = isPaused && isRecording;     // pausado (aún no detenido)
  const isReady    = !!readyBlob && !isRecording; // audio listo para enviar

  /* ── PANEL de grabación (siempre montado pero hidden cuando cerrado) ── */
  return (
    <>
      {/* ─── Panel (visible cuando panelOpen) ─────────────────────────── */}
      {panelOpen && (
        <div className="flex flex-1 items-center gap-2 rounded-2xl border bg-background px-3 py-2 shadow-sm min-h-[44px]">

          {/* Izquierda: papelera */}
          <button
            type="button"
            onClick={handleCancel}
            title="Cancelar"
            className="flex size-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>

          {/* Tiempo */}
          <span
            className={cn(
              "min-w-[3rem] flex-shrink-0 font-mono text-sm tabular-nums select-none",
              isActive && "text-rose-500"
            )}
          >
            {formatTime(recordingTime)}
          </span>

          {/* Indicador rojo pulsante */}
          {isActive && (
            <span className="size-2 flex-shrink-0 animate-pulse rounded-full bg-rose-500" />
          )}

          {/* Ondas / indicador centro */}
          <div className="flex flex-1 items-center justify-center">
            {isReady ? (
              <span className="text-xs font-medium text-emerald-600 select-none">
                ✓ Listo para enviar
              </span>
            ) : (
              <RecordingWaves active={isActive} />
            )}
          </div>

          {/* Etiqueta Pausado */}
          {isStopped && !isReady && (
            <span className="flex-shrink-0 text-xs text-muted-foreground select-none">
              Pausado
            </span>
          )}

          {/* Controles derecha */}
          <div className="flex flex-shrink-0 items-center gap-1">

            {/* Pausar (solo grabando) */}
            {isActive && (
              <button
                type="button"
                onClick={handlePause}
                title="Pausar"
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
              >
                <Pause className="size-4" />
              </button>
            )}

            {/* Reanudar (solo pausado) */}
            {isStopped && (
              <button
                type="button"
                onClick={handleResume}
                title="Reanudar"
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
              >
                <Play className="size-4" />
              </button>
            )}

            {/* Detener → convierte a listo (grabando o pausado) */}
            {(isActive || isStopped) && (
              <button
                type="button"
                onClick={handleStop}
                title="Detener grabación"
                className="flex size-8 items-center justify-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600"
              >
                <Square className="size-3.5 fill-white" />
              </button>
            )}

            {/* Enviar (solo cuando está listo) */}
            {isReady && (
              <button
                type="button"
                onClick={handleSend}
                disabled={uploadSending}
                title="Enviar nota de voz"
                className="flex size-8 items-center justify-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
              >
                {uploadSending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Botón micrófono idle (solo visible cuando panel cerrado) ─── */}
      {!panelOpen && (
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled}
          title="Grabar nota de voz"
          className={cn(
            "flex size-10 flex-shrink-0 items-center justify-center rounded-full",
            "bg-emerald-500 text-white shadow transition-colors hover:bg-emerald-600",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <Mic className="size-5" />
        </button>
      )}
    </>
  );
}