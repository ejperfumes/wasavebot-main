// ============================================================
// AccountSwitcher.tsx — Selector y creador de cuentas
// PRODUCCIÓN COMPLETA:
//   • Crear cuentas desde el frontend SIN tocar código
//   • El backend lanza el proceso hijo automáticamente
//   • Dialogs de la app (no window.confirm/alert)
//   • Polling del estado de cada proceso
//   • Cuentas ilimitadas e independientes
// ============================================================

import { useState, useEffect, useCallback } from "react";
import {
  Plus, Pencil, Trash2, Check, X, HelpCircle,
  Loader2, CheckCircle2, AlertCircle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { toast }    from "sonner";
import {
  AccountConfig,
  loadAccounts,
  saveAccounts,
  getActiveAccountId,
  setActiveAccountId,
  getActiveAccount,
} from "@/lib/accounts";

// URL base siempre explícita (la cuenta principal siempre es :3000)
const MANAGER_BASE = "http://localhost:3000";

interface RemoteAccount {
  id:     string;
  label:  string;
  port:   number;
  apiUrl: string;
  status: "running" | "starting" | "stopped" | "crashed" | "error";
}

interface Props {
  onAccountChange: (account: AccountConfig) => void;
}

// Paleta de colores para cuentas nuevas
const COLORS = [
  "#22c55e","#3b82f6","#f59e0b","#ec4899",
  "#8b5cf6","#06b6d4","#f97316","#84cc16","#14b8a6",
];

export function AccountSwitcher({ onAccountChange }: Props) {
  const [accounts, setAccounts]     = useState<AccountConfig[]>([]);
  const [remoteStatus, setRemoteStatus] = useState<Record<string, RemoteAccount["status"]>>({});
  const [activeId, setActiveId]     = useState<string>("default");
  const [showPanel, setShowPanel]   = useState(false);
  const [showHelp, setShowHelp]     = useState(false);

  // Estados para editar cuenta existente
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editLabel, setEditLabel]   = useState("");
  const [editUrl, setEditUrl]       = useState("");

  // Dialog: agregar cuenta nueva
  const [addDialogOpen, setAddDialogOpen]   = useState(false);
  const [newLabel, setNewLabel]             = useState("");
  const [adding, setAdding]                 = useState(false);
  const [addError, setAddError]             = useState("");

  // Dialog: confirmación de eliminar
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId]             = useState<string | null>(null);
  const [deletingLabel, setDeletingLabel]       = useState("");
  const [deleting, setDeleting]                 = useState(false);

  // ── Cargar cuentas locales ─────────────────────────────────────────────────
  const refreshLocal = useCallback(() => {
    const accs = loadAccounts();
    setAccounts(accs);
    setActiveId(getActiveAccountId());
  }, []);

  // ── Sincronizar con el backend principal ──────────────────────────────────
  const syncWithBackend = useCallback(async () => {
    try {
      const res = await fetch(`${MANAGER_BASE}/api/accounts`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return;
      const remote: RemoteAccount[] = await res.json();

      // Actualizar estados de procesos
      const statusMap: Record<string, RemoteAccount["status"]> = {};
      remote.forEach((r) => { statusMap[r.id] = r.status; });
      setRemoteStatus(statusMap);

      // Sincronizar cuentas locales: agregar las que falten
      const local = loadAccounts();
      const localIds = new Set(local.map((a) => a.id));
      let changed = false;

      remote.forEach((r, idx) => {
        if (!localIds.has(r.id)) {
          local.push({
            id:     r.id,
            label:  r.label,
            apiUrl: r.apiUrl,
            color:  COLORS[local.length % COLORS.length],
          });
          changed = true;
        }
      });

      if (changed) {
        saveAccounts(local);
        setAccounts([...local]);
      }
    } catch {
      // Backend no responde — no bloquear la UI
    }
  }, []);

  useEffect(() => {
    refreshLocal();
    syncWithBackend();
    // Polling del estado de procesos cada 5s
    const interval = setInterval(syncWithBackend, 5000);
    const onSwitch = () => clearInterval(interval);
    window.addEventListener("wa:account-switching", onSwitch);
    return () => {
      clearInterval(interval);
      window.removeEventListener("wa:account-switching", onSwitch);
    };
  }, [refreshLocal, syncWithBackend]);

  // ── Cambiar cuenta activa ──────────────────────────────────────────────────
  function switchAccount(acc: AccountConfig) {
    // Limpiar borradores de la cuenta anterior — evita cruce de datos entre cuentas
    const DRAFT_KEYS = [
      "wasave_qr_draft",
      "wasave_selected_qr",
      "wasave_flows_draft",
      "wasave_selected_flow",
    ];
    DRAFT_KEYS.forEach((k) => sessionStorage.removeItem(k));

    setActiveId(acc.id);
    setActiveAccountId(acc.id);
    onAccountChange(acc);
    setShowPanel(false);
    window.dispatchEvent(new CustomEvent("wa:account-switching", { detail: { accountId: acc.id } }));
    setTimeout(() => window.location.reload(), 300);
  }

  // ── Guardar edición ────────────────────────────────────────────────────────
  function saveEdit() {
    if (!editingId) return;
    let url = editUrl.trim().replace(/\/$/, "");
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = `http://${url}`;
    const updated = accounts.map((a) =>
      a.id === editingId ? { ...a, label: editLabel, apiUrl: url } : a
    );
    saveAccounts(updated);
    setAccounts(updated);
    setEditingId(null);
    toast.success("Cuenta actualizada");
  }

  // ── Crear cuenta nueva (llama al backend para lanzar el proceso) ───────────
  async function handleAdd() {
    if (!newLabel.trim()) { setAddError("Escribe un nombre para la cuenta."); return; }
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch(`${MANAGER_BASE}/api/accounts`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ label: newLabel.trim() }),
        signal:  AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAddError(data.error || "Error al crear la cuenta.");
        setAdding(false);
        return;
      }

      // Agregar a la lista local
      const newAcc: AccountConfig = {
        id:     data.account.id,
        label:  data.account.label,
        apiUrl: data.account.apiUrl,
        color:  COLORS[accounts.length % COLORS.length],
      };
      const updated = [...accounts, newAcc];
      saveAccounts(updated);
      setAccounts(updated);

      toast.success(`✅ "${data.account.label}" creada en ${data.account.apiUrl}. El proceso tardará ~5s.`);
      setAddDialogOpen(false);
      setNewLabel("");
      setAdding(false);
    } catch (err: any) {
      setAddError(
        err?.name === "TimeoutError"
          ? "El backend principal no responde. ¿Está corriendo node server.js?"
          : "No se pudo conectar al backend principal."
      );
      setAdding(false);
    }
  }

  // ── Confirmar eliminación ──────────────────────────────────────────────────
  function openDeleteDialog(id: string, label: string) {
    setDeletingId(id);
    setDeletingLabel(label);
    setDeleteDialogOpen(true);
  }

  async function handleDeleteConfirmed() {
    if (!deletingId) return;
    setDeleting(true);
    try {
      const res = await fetch(`${MANAGER_BASE}/api/accounts/${deletingId}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (data.ok) {
        const updated = accounts.filter((a) => a.id !== deletingId);
        saveAccounts(updated);
        setAccounts(updated);
        if (getActiveAccountId() === deletingId) setActiveAccountId("default");
        toast.success(`Cuenta "${deletingLabel}" eliminada.`);
      } else {
        toast.error(data.error || "Error al eliminar.");
      }
    } catch {
      toast.error("No se pudo conectar al backend.");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingId(null);
    }
  }

  const active = accounts.find((a) => a.id === activeId) || accounts[0];

  // ── Indicador de estado del proceso ───────────────────────────────────────
  function StatusDot({ id }: { id: string }) {
    if (id === "default") return <span className="size-2 rounded-full bg-green-500 inline-block" title="Corriendo" />;
    const s = remoteStatus[id];
    if (s === "running")  return <span className="size-2 rounded-full bg-green-500 inline-block" title="Corriendo" />;
    if (s === "starting") return <span className="size-2 rounded-full bg-yellow-400 animate-pulse inline-block" title="Iniciando…" />;
    if (s === "crashed" || s === "error") return <span className="size-2 rounded-full bg-red-500 inline-block" title="Error" />;
    return <span className="size-2 rounded-full bg-slate-500 inline-block" title="Detenido" />;
  }

  return (
    <>
      {/* ── Dialog: agregar cuenta nueva ──────────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={(v) => { if (!v && !adding) { setAddDialogOpen(false); setNewLabel(""); setAddError(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva cuenta WhatsApp</DialogTitle>
            <DialogDescription>
              El backend lanzará automáticamente un proceso independiente para esta cuenta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-account-label">Nombre para identificarla</Label>
              <Input
                id="new-account-label"
                autoFocus
                value={newLabel}
                onChange={(e) => { setNewLabel(e.target.value); setAddError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="Ej: Ventas, Soporte, Personal…"
                disabled={adding}
              />
            </div>

            {addError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-300">{addError}</p>
              </div>
            )}

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-200 space-y-1">
              <p className="font-medium text-blue-300">¿Qué pasa al crear?</p>
              <p>• El backend asigna automáticamente un puerto libre (ej: 3002)</p>
              <p>• Lanza un proceso Node.js independiente para esta cuenta</p>
              <p>• Puedes conectar WhatsApp desde esa cuenta inmediatamente</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialogOpen(false); setNewLabel(""); setAddError(""); }} disabled={adding}>
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
              {adding ? <><Loader2 className="mr-2 size-4 animate-spin" /> Creando…</> : "Crear cuenta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: confirmar eliminación ─────────────────────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={(v) => { if (!deleting) setDeleteDialogOpen(v); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar cuenta?</DialogTitle>
            <DialogDescription>
              Esto detendrá el proceso de <span className="font-semibold text-foreground">"{deletingLabel}"</span> y la eliminará de la lista.
              Los datos del backend (historial, contactos) quedan en disco.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-2 size-4 animate-spin" /> Eliminando…</> : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Botón compacto ──────────────────────────────────────────────────── */}
      <div className="relative">
        <button
          onClick={() => setShowPanel((s) => !s)}
          title={`Cuenta activa: ${active?.label || "..."}`}
          className={cn(
            "group relative flex size-11 items-center justify-center rounded-xl transition-all duration-150",
            showPanel ? "bg-white/15 text-white" : "text-slate-400 hover:bg-white/10 hover:text-white"
          )}
        >
          <span
            className="flex size-7 items-center justify-center rounded-full text-[11px] font-bold text-white shadow"
            style={{ backgroundColor: active?.color || "#22c55e" }}
          >
            {(active?.label || "?")[0].toUpperCase()}
          </span>

          {accounts.length > 1 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white">
              {accounts.length}
            </span>
          )}

          <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap rounded-md bg-[#1a1a2e] px-2.5 py-1.5 text-xs font-medium text-white shadow-xl group-hover:flex border border-white/10">
            Cuentas WhatsApp
          </span>
        </button>

        {/* ── Panel de cuentas ──────────────────────────────────────────────── */}
        {showPanel && (
          <div className="absolute left-[56px] bottom-0 z-50 rounded-xl border border-white/10 bg-[#12122a] shadow-2xl" style={{ width: 390 }}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="text-base font-semibold text-white">Cuentas WhatsApp</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={syncWithBackend}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                  title="Sincronizar estado"
                >
                  <RefreshCw className="size-4" />
                </button>
                <button
                  onClick={() => setShowHelp((s) => !s)}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                  title="Ayuda"
                >
                  <HelpCircle className="size-4" />
                </button>
                <button
                  onClick={() => setShowPanel(false)}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Ayuda */}
            {showHelp && (
              <div className="border-b border-white/10 bg-blue-500/10 px-4 py-3 text-xs text-slate-300 space-y-1">
                <p className="font-semibold text-blue-300">¿Cómo funciona?</p>
                <p>• Presiona <strong>+ Agregar cuenta</strong>, escribe el nombre y confirma.</p>
                <p>• El backend lanza automáticamente un proceso independiente.</p>
                <p>• Cambia a la nueva cuenta y presiona <strong>Conectar WhatsApp</strong>.</p>
                <p>• Cada cuenta tiene su propio WhatsApp, flujos, bandeja y contactos.</p>
                <p className="text-slate-400 mt-1">Solo necesitas tener corriendo <code className="bg-black/30 px-1 rounded">node server.js</code> (el principal).</p>
              </div>
            )}

            {/* Lista */}
            <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors",
                    acc.id === activeId ? "bg-white/8" : "hover:bg-white/5"
                  )}
                >
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white shadow"
                    style={{ backgroundColor: acc.color }}
                  >
                    {acc.label[0].toUpperCase()}
                  </span>

                  {editingId === acc.id ? (
                    <div className="flex flex-1 flex-col gap-1.5">
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder="Nombre"
                        className="w-full rounded bg-white/10 px-2 py-1 text-sm text-white placeholder-slate-500 focus:outline-none"
                      />
                      <input
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        placeholder="http://localhost:3001"
                        className="w-full rounded bg-white/10 px-2 py-1 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                      />
                      <div className="flex gap-1">
                        <button onClick={saveEdit} className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-500">
                          <Check className="size-3" /> Guardar
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300 hover:bg-white/20">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className="flex flex-1 flex-col cursor-pointer"
                        onClick={() => acc.id !== activeId && switchAccount(acc)}
                      >
                        <div className="flex items-center gap-2">
                          <StatusDot id={acc.id} />
                          <span className="text-sm font-medium text-white">{acc.label}</span>
                          {acc.id === activeId && (
                            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                              activa
                            </span>
                          )}
                          {remoteStatus[acc.id] === "starting" && (
                            <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-300">
                              iniciando…
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">{acc.apiUrl}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingId(acc.id); setEditLabel(acc.label); setEditUrl(acc.apiUrl); }}
                          className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"
                          title="Editar"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        {acc.id !== "default" && (
                          <button
                            onClick={() => openDeleteDialog(acc.id, acc.label)}
                            className="rounded p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
                            title="Eliminar"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Botón agregar */}
            <div className="border-t border-white/10 px-4 py-3">
              <button
                onClick={() => { setAddDialogOpen(true); setShowPanel(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-emerald-400 hover:bg-white/10 hover:text-emerald-300 transition-colors font-medium"
              >
                <Plus className="size-4" />
                Agregar cuenta
              </button>
            </div>

            <div className="border-t border-white/10 px-4 py-2.5">
              <p className="text-[10px] text-slate-500">
                📚 Biblioteca de medios compartida · Flujos y bandeja son independientes por cuenta.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}