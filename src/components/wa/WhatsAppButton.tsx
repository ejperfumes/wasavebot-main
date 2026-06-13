// ============================================================
// WhatsAppButton.tsx — Botón de estado/conexión WhatsApp
// PRODUCCIÓN:
//   • Siempre consulta la cuenta activa (getApiBase dinámico)
//   • Escucha "wa:account-switching" para limpiar timers
//   • Muestra número real del backend conectado (account-info)
//   • Sincronización correcta entre panel y header
// ============================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import {
  Loader2, Wifi, WifiOff, LogOut, Trash2,
  Smartphone, CheckCircle2, Plug, ServerOff,
} from "lucide-react";
import { toast } from "sonner";
import { getApiBase, waApi } from "@/lib/wa-api";
import { getActiveAccount } from "@/lib/accounts";

export function WhatsAppButton() {
  const [open, setOpen]                   = useState(false);
  const [qrDialogOpen, setQrDialogOpen]   = useState(false);

  const [status, setStatus]               = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [qr, setQr]                       = useState<string | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const [tempName, setTempName]           = useState("");
  const [loading, setLoading]             = useState(false);
  const [connecting, setConnecting]       = useState(false);
  const [backendOk, setBackendOk]         = useState<"ok" | "error" | "checking">("checking");
  const [backendError, setBackendError]   = useState("");

  // Número real reportado por el backend (desde /api/account-info + /api/whatsapp/name)
  const [backendPhone, setBackendPhone]   = useState("");

  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen]         = useState(false);

  // Ref para poder limpiar el intervalo cuando se cambia de cuenta
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Abrir QR dialog automáticamente
  useEffect(() => {
    if (qr) { setQrDialogOpen(true); setOpen(false); }
    else     { setQrDialogOpen(false); }
  }, [qr]);

  // ── Fetch status — usa getApiBase() en cada llamada (dinámico) ─────────────
  const fetchStatus = useCallback(async () => {
    try {
      const data = await waApi.getStatus();
      setBackendOk("ok");
      setBackendError("");
      setStatus(data.status as any);
      setQr(data.qr || null);
      if (data.status === "connected" || data.qr) setConnecting(false);
    } catch (err: any) {
      setBackendOk("error");
      setBackendError(
        err?.name === "TimeoutError"
          ? "El backend no responde (timeout 5s)"
          : "No se puede conectar al backend"
      );
      setStatus("disconnected");
      setQr(null);
    }
  }, []);

  // ── Fetch nombre de conexión + número real del backend ────────────────────
  const fetchName = useCallback(async () => {
    try {
      const [nameData, infoData] = await Promise.all([
        waApi.getName(),
        waApi.getAccountInfo(),
      ]);
      const name = nameData?.name || "";
      setConnectionName(name);
      setTempName(name);
      // El número real viene del connection-name guardado en el backend
      setBackendPhone(name);
    } catch {}
  }, []);

  const saveNameSilent = async (name: string) => {
    if (!name.trim()) return;
    try {
      await waApi.setName(name.trim());
      setConnectionName(name.trim());
      setBackendPhone(name.trim());
    } catch {}
  };

  const handleConnect = async () => {
    if (backendOk === "error") {
      toast.error("El backend de esta cuenta no está corriendo. Inícialo primero.");
      return;
    }
    await saveNameSilent(tempName);
    setConnecting(true);
    setOpen(false);
    try {
      const data = await waApi.connect();
      if (data.ok) toast.success(data.message || "Conectando…");
      else { toast.error(data.error || "Error al conectar"); setConnecting(false); }
    } catch (err: any) {
      toast.error(err?.name === "TimeoutError"
        ? "El backend no responde. ¿Está corriendo el servidor?"
        : "No se puede conectar al backend");
      setConnecting(false);
    }
  };

  const handleDisconnectConfirmed = async () => {
    setLoading(true);
    try {
      const data = await waApi.disconnect();
      if (data.ok) { toast.success("Desconectado."); fetchStatus(); }
      else toast.error("Error al desconectar");
    } catch { toast.error("Error de conexión"); }
    finally { setLoading(false); }
  };

  const handleLogoutConfirmed = async () => {
    setLoading(true);
    try {
      const data = await waApi.logout();
      if (data.ok) {
        toast.success("Sesión eliminada.");
        fetchStatus();
        setConnectionName(""); setTempName(""); setBackendPhone("");
      } else toast.error("Error al eliminar sesión");
    } catch { toast.error("Error de conexión"); }
    finally { setLoading(false); }
  };

  // ── Ciclo de polling + limpieza al cambiar cuenta ─────────────────────────
  useEffect(() => {
    setBackendOk("checking");
    fetchStatus();
    fetchName();
    intervalRef.current = setInterval(fetchStatus, 4000);

    // Escuchar cambio de cuenta → limpiar intervalo antes del reload
    const onSwitch = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    window.addEventListener("wa:account-switching", onSwitch);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("wa:account-switching", onSwitch);
    };
  }, [fetchStatus, fetchName]);

  const isConnected    = status === "connected"    && backendOk === "ok";
  const isConnecting   = (status === "connecting" || connecting) && backendOk === "ok";
  const isDisconnected = status === "disconnected" || backendOk !== "ok";

  const activeAccount = getActiveAccount();
  const accountLabel  = activeAccount?.label || "Principal";
  const backendUrl    = getApiBase() || "http://localhost:3000";

  // Texto del badge en el header: número real si está conectado, si no el label de cuenta
  const headerText = isConnected && backendPhone
    ? backendPhone
    : accountLabel;

  return (
    <>
      {/* ── Confirmación: Desconectar ──────────────────────────────────── */}
      <AlertDialog open={confirmDisconnectOpen} onOpenChange={setConfirmDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              La sesión queda guardada. Podrás reconectar sin escanear el QR de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnectConfirmed}>Desconectar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirmación: Eliminar sesión ──────────────────────────────── */}
      <AlertDialog open={confirmLogoutOpen} onOpenChange={setConfirmLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar sesión y datos?</AlertDialogTitle>
            <AlertDialogDescription>
              ⚠️ Borrará todos los datos de autenticación. Tendrás que escanear un nuevo QR.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogoutConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Dialog QR ─────────────────────────────────────────────────── */}
      <Dialog open={qrDialogOpen} onOpenChange={(v) => { if (!v) setQrDialogOpen(false); }}>
        <DialogContent className="sm:max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="text-center">Escanea el código QR</DialogTitle>
            <DialogDescription className="text-center">
              Cuenta: <span className="font-medium text-foreground">{accountLabel}</span>
            </DialogDescription>
          </DialogHeader>
          {qr ? (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="rounded-2xl border-2 border-border bg-white p-3 shadow-lg">
                <img src={qr} alt="Código QR WhatsApp" style={{ width: 280, height: 280, display: "block" }} />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Abre <strong>WhatsApp</strong> → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>
              </p>
              <p className="text-xs text-muted-foreground">El QR expira en ~60 s. Se actualiza automáticamente.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-10 animate-spin text-yellow-500" />
              <p className="text-sm text-muted-foreground">Generando QR, espera…</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Popover de estado ──────────────────────────────────────────── */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Smartphone className="mr-2 size-4" />
            {backendOk === "error" ? (
              <span className="flex items-center gap-1 text-orange-500">
                <ServerOff className="size-3" /> Sin backend
              </span>
            ) : isConnected ? (
              <span className="flex items-center gap-1 text-green-600">
                <Wifi className="size-3" /> {headerText}
              </span>
            ) : isConnecting ? (
              <span className="flex items-center gap-1 text-yellow-600">
                <Loader2 className="size-3 animate-spin" /> Conectando
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-500">
                <WifiOff className="size-3" /> Desconectado
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-4">
          <div className="space-y-4">

            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">WhatsApp</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cuenta: <span className="font-medium">{accountLabel}</span>
                </p>
                {isConnected && backendPhone && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Número: <span className="font-mono font-medium text-green-600">{backendPhone}</span>
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">{backendUrl}</p>
              </div>
              <div>
                {backendOk === "error"    && <ServerOff  className="size-5 text-orange-500" />}
                {backendOk === "checking" && <Loader2    className="size-5 animate-spin text-muted-foreground" />}
                {backendOk === "ok" && isConnected    && <CheckCircle2 className="size-5 text-green-500" />}
                {backendOk === "ok" && isConnecting   && <Loader2      className="size-5 animate-spin text-yellow-500" />}
                {backendOk === "ok" && isDisconnected && !isConnecting && <WifiOff className="size-5 text-red-500" />}
              </div>
            </div>

            {/* Alerta: backend caído */}
            {backendOk === "error" && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 space-y-1.5">
                <p className="text-sm font-medium text-orange-400 flex items-center gap-1.5">
                  <ServerOff className="size-4" /> Backend no disponible
                </p>
                <p className="text-xs text-muted-foreground">{backendError}</p>
                <p className="text-xs text-muted-foreground">Inicia este backend en una terminal:</p>
                <code className="block text-[11px] font-mono bg-black/30 rounded px-2 py-1 text-orange-300 break-all">
                  {activeAccount?.id === "default"
                    ? "node server.js"
                    : `ACCOUNT_ID=${activeAccount?.id} PORT=${backendUrl.split(":").pop()} node server.js`
                  }
                </code>
              </div>
            )}

            {/* Nombre de la conexión */}
            {backendOk === "ok" && (
              <div className="space-y-1.5">
                <Label>Nombre de la conexión</Label>
                <Input
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onBlur={() => tempName !== connectionName && saveNameSilent(tempName)}
                  placeholder="Ej: Mi WhatsApp"
                />
                <p className="text-xs text-muted-foreground">Se guardará automáticamente al conectar.</p>
              </div>
            )}

            {/* Esperando QR */}
            {backendOk === "ok" && isConnecting && !qr && (
              <div className="flex flex-col items-center gap-2 py-3 rounded-lg bg-muted/50">
                <Loader2 className="size-6 animate-spin text-yellow-500" />
                <p className="text-sm text-muted-foreground text-center">Generando QR…</p>
              </div>
            )}

            {/* Reabrir QR */}
            {backendOk === "ok" && isConnecting && qr && !qrDialogOpen && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setQrDialogOpen(true)}>
                📱 Ver código QR
              </Button>
            )}

            {/* Botón conectar */}
            {backendOk === "ok" && isDisconnected && !isConnecting && (
              <div className="space-y-2">
                <Button onClick={handleConnect} disabled={connecting} className="w-full">
                  {connecting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Conectando...</>
                    : <><Plug className="mr-2 h-4 w-4" /> Conectar WhatsApp</>
                  }
                </Button>
              </div>
            )}

            {/* Acciones */}
            {backendOk === "ok" && (
              <div className="flex flex-col gap-2 pt-2 border-t">
                <Button
                  variant="outline" size="sm"
                  onClick={() => setConfirmDisconnectOpen(true)}
                  disabled={loading || isDisconnected}
                  className="w-full justify-start"
                >
                  <LogOut className="mr-2 size-4" /> Desconectar (mantener sesión)
                </Button>
                <Button
                  variant="destructive" size="sm"
                  onClick={() => setConfirmLogoutOpen(true)}
                  disabled={loading}
                  className="w-full justify-start"
                >
                  <Trash2 className="mr-2 size-4" /> Eliminar sesión y datos
                </Button>
              </div>
            )}

            <p className="text-xs text-center text-muted-foreground">
              {backendOk === "error"
                ? "⚠️ Inicia el backend de esta cuenta para continuar."
                : backendOk === "checking"
                ? "⏳ Verificando backend…"
                : isConnected
                ? "✅ Conectado. Sesión guardada automáticamente."
                : isConnecting
                ? "⏳ El QR aparecerá en pantalla al estar listo."
                : "❌ Desconectado. Presiona 'Conectar WhatsApp'."}
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
