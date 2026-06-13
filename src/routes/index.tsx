import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageCircle,
  Settings2,
  Wifi,
  WifiOff,
  GitBranch,
  Zap,
  Inbox,
  Image,
  X,
} from "lucide-react";
import { FlowsTab } from "@/components/wa/FlowsTab";
import { QuickSendTab } from "@/components/wa/QuickSendTab";
import { QuickRepliesTab } from "@/components/wa/QuickRepliesTab";
import { MediaLibraryTab } from "@/components/wa/MediaLibraryTab";
import { WhatsAppButton } from "@/components/wa/WhatsAppButton";
import { AccountSwitcher } from "@/components/wa/AccountSwitcher";
import { getApiBase, setApiBase } from "@/lib/wa-api";
import {
  getActiveAccount,
  loadAccounts,
  getActiveAccountId,
  setActiveAccountId,
  AccountConfig,
} from "@/lib/accounts";
import { useMultiAccountNotifications } from "@/hooks/useMultiAccountNotifications";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/wa/ThemeToggle";

const TAB_KEY = "wasave_active_tab";
const VALID_TABS = ["send", "flows", "quick-replies", "library"] as const;
type TabValue = (typeof VALID_TABS)[number];

function getSavedTab(): TabValue {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved && VALID_TABS.includes(saved as TabValue)) return saved as TabValue;
  } catch {}
  return "send";
}

const NAV_ITEMS: { value: TabValue; icon: React.ReactNode; label: string }[] = [
  { value: "send",          icon: <Inbox className="size-5" />,     label: "Bandeja"            },
  { value: "flows",         icon: <GitBranch className="size-5" />, label: "Flujos automáticos" },
  { value: "quick-replies", icon: <Zap className="size-5" />,       label: "Respuestas rápidas" },
  { value: "library",       icon: <Image className="size-5" />,     label: "Biblioteca"         },
];

export const Route = createFileRoute("/")((({
  head: () => ({
    meta: [
      { title: "WASAVE BOT" },
      {
        name: "description",
        content:
          "Administra flujos automáticos, envía mensajes manuales y gestiona la biblioteca de archivos de WASAVE BOT.",
      },
      { property: "og:title", content: "WASAVE BOT" },
      {
        property: "og:description",
        content: "Administra flujos automáticos y envía mensajes desde una sola interfaz.",
      },
    ],
  }),
  component: Index,
}) as any));

function Index() {
  const [showConfig, setShowConfig] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [usingProxy, setUsingProxy] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>("send");
  const [hydrated, setHydrated] = useState(false);
  // Label de la cuenta activa para mostrar en el topbar
  const [activeAccountLabel, setActiveAccountLabel] = useState<string>("");

  // ── Estado para notificaciones multi-cuenta ────────────────────────────────
  const [allAccounts, setAllAccounts] = useState<AccountConfig[]>([]);
  const [activeAccountId, setActiveAccountIdState] = useState<string>("default");

  // Callback estable que cambia de cuenta al hacer clic en una notificación
  const handleSwitchFromNotification = useCallback((accountId: string) => {
    setActiveAccountId(accountId);   // persiste en localStorage
    setActiveAccountIdState(accountId);
    // Disparar el mismo evento que usa AccountSwitcher internamente
    window.dispatchEvent(
      new CustomEvent("wa:account-switching", { detail: { accountId } })
    );
    setTimeout(() => window.location.reload(), 150);
  }, []);

  // Montar el hook — escucha SSE de todas las cuentas en paralelo
  useMultiAccountNotifications({
    accounts: allAccounts,
    activeAccountId,
    onSwitchAccount: handleSwitchFromNotification,
  });

  useEffect(() => {
    const saved = getSavedTab();
    setActiveTab(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    const current = getApiBase();
    setApiUrl(current);
    setUsingProxy(!current);
    // Mostrar nombre de cuenta activa
    const acc = getActiveAccount();
    setActiveAccountLabel(acc?.label || "");
    // Cargar todas las cuentas para el hook de notificaciones
    setAllAccounts(loadAccounts());
    setActiveAccountIdState(getActiveAccountId());
  }, []);

  const handleTabChange = (value: TabValue) => {
    setActiveTab(value);
    try { sessionStorage.setItem(TAB_KEY, value); } catch {}
  };

  const saveBase = () => {
    setApiBase(apiUrl.trim());
    const saved = getApiBase();
    setUsingProxy(!saved);
    if (saved) {
      toast.success(`Backend apuntando a ${saved}`);
    } else {
      toast.success("Usando proxy local (http://localhost:3000)");
    }
    setShowConfig(false);
    setTimeout(() => window.location.reload(), 300);
  };

  const clearBase = () => {
    setApiBase("");
    setApiUrl("");
    setUsingProxy(true);
    toast.success("Usando proxy local (http://localhost:3000)");
    setShowConfig(false);
    setTimeout(() => window.location.reload(), 300);
  };

  const activeItem = NAV_ITEMS.find((n) => n.value === activeTab);

  const isFullBleed = activeTab === "send";

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* ══ SIDEBAR IZQUIERDO OSCURO ══ */}
      <aside className="flex w-[60px] flex-col items-center gap-1 bg-[#1a1a2e] py-3 shrink-0">

        {/* Logo */}
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
          <MessageCircle className="size-5" />
        </div>

        {/* Nav items */}
        <nav className="flex flex-col items-center gap-1 flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.value;
            return (
              <button
                key={item.value}
                onClick={() => handleTabChange(item.value)}
                className={cn(
                  "group relative flex size-11 items-center justify-center rounded-xl transition-all duration-150",
                  isActive
                    ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                    : "text-slate-400 hover:bg-white/10 hover:text-white"
                )}
              >
                {item.icon}
                {isActive && (
                  <span className="absolute -left-[3px] h-5 w-[3px] rounded-r-full bg-emerald-300" />
                )}
                {/* Tooltip */}
                <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap rounded-md bg-[#1a1a2e] px-2.5 py-1.5 text-xs font-medium text-white shadow-xl group-hover:flex border border-white/10">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* ══ SELECTOR DE CUENTAS ══ */}
        {/* Aparece justo antes del botón de settings, en la parte inferior del sidebar */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <AccountSwitcher
            onAccountChange={(acc) => {
              setActiveAccountLabel(acc.label);
              const current = getApiBase();
              setApiUrl(current);
              setUsingProxy(!current);
              // Mantener sincronizado el estado para el hook de notificaciones
              setAllAccounts(loadAccounts());
              setActiveAccountIdState(acc.id);
            }}
          />

          {/* Settings abajo */}
          <button
            onClick={() => setShowConfig((s) => !s)}
            className={cn(
              "group relative flex size-11 items-center justify-center rounded-xl transition-all duration-150",
              showConfig
                ? "bg-white/15 text-white"
                : "text-slate-400 hover:bg-white/10 hover:text-white"
            )}
          >
            <Settings2 className="size-5" />
            <span className={cn(
              "absolute bottom-[9px] right-[9px] size-[7px] rounded-full border border-[#1a1a2e]",
              usingProxy ? "bg-emerald-400" : "bg-yellow-400"
            )} />
            <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap rounded-md bg-[#1a1a2e] px-2.5 py-1.5 text-xs font-medium text-white shadow-xl group-hover:flex border border-white/10">
              {usingProxy ? "Configuración · Local" : "Configuración · Externo"}
            </span>
          </button>
        </div>
      </aside>

      {/* ══ ÁREA DE CONTENIDO ══ */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* Topbar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-foreground">{activeItem?.label}</span>
            {/* Badge de cuenta activa */}
            {activeAccountLabel && (
              <span className="hidden sm:inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {activeAccountLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <WhatsAppButton />
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {usingProxy ? (
                <><Wifi className="size-3 text-emerald-500" /> Local</>
              ) : (
                <><WifiOff className="size-3 text-yellow-500" /> Externo</>
              )}
            </span>
          </div>
        </header>

        {/* Panel de configuración */}
        {showConfig && (
          <div className="border-b bg-muted/30 px-5 py-3 shrink-0">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground max-w-lg">
                En desarrollo local déjalo <strong>vacío</strong> — Vite redirige{" "}
                <code>/api</code> a <code>localhost:3000</code> automáticamente.
                Solo escribe una URL si el backend corre en otro servidor.
                Para multi-cuenta usa el selector de cuentas (ícono de letra en el sidebar).
              </p>
              <button onClick={() => setShowConfig(false)} className="ml-4 rounded p-1 hover:bg-muted">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end max-w-xl">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  URL del backend (opcional)
                </label>
                <Input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:3000  ← dejar vacío en desarrollo"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={clearBase}>
                  Usar proxy local
                </Button>
                <Button size="sm" onClick={saveBase}>Guardar URL</Button>
              </div>
            </div>
          </div>
        )}

        {/* Contenido — Bandeja sin padding para pantalla completa, resto con padding */}
        <main className={cn("flex-1 overflow-auto min-h-0", isFullBleed ? "" : "p-5")}>
          {hydrated && (
            <>
              {activeTab === "send"          && <QuickSendTab />}
              {activeTab === "flows"         && <FlowsTab />}
              {activeTab === "quick-replies" && <QuickRepliesTab />}
              {activeTab === "library"       && <MediaLibraryTab />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}