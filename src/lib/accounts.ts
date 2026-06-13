// ============================================================
// accounts.ts — Gestión de múltiples cuentas WhatsApp
// PRODUCCIÓN: URLs siempre explícitas, nunca vacías.
// Cuentas ilimitadas: cada una = un puerto diferente.
// ============================================================

const ACCOUNTS_KEY        = "wasave_accounts";
const ACTIVE_ACCOUNT_KEY  = "wasave_active_account";

export interface AccountConfig {
  id:     string;   // identificador único ("default", "cuenta2", "cuenta3"…)
  label:  string;   // nombre para mostrar
  apiUrl: string;   // URL SIEMPRE EXPLÍCITA: "http://localhost:3000"
  color:  string;
}

const ACCOUNT_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b",
  "#ec4899", "#8b5cf6", "#06b6d4",
  "#f97316", "#84cc16", "#14b8a6",
];

// ── SIEMPRE con URL explícita — nunca vacía ──────────────────────────────────
function getDefaultAccounts(): AccountConfig[] {
  return [
    {
      id:     "default",
      label:  "Cuenta Principal",
      apiUrl: "http://localhost:3000",  // ← URL siempre explícita
      color:  "#22c55e",
    },
  ];
}

// ── Migración: si hay una cuenta con apiUrl vacío, asignarle 3000 ─────────────
function migrateAccounts(accounts: AccountConfig[]): AccountConfig[] {
  return accounts.map((a) => {
    if (!a.apiUrl || a.apiUrl.trim() === "") {
      return { ...a, apiUrl: "http://localhost:3000" };
    }
    // Asegurar protocolo
    if (!a.apiUrl.startsWith("http://") && !a.apiUrl.startsWith("https://")) {
      return { ...a, apiUrl: `http://${a.apiUrl}` };
    }
    return a;
  });
}

export function loadAccounts(): AccountConfig[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AccountConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const migrated = migrateAccounts(parsed);
        // Re-guardar si hubo migración
        const changed = migrated.some((a, i) => a.apiUrl !== parsed[i].apiUrl);
        if (changed) saveAccounts(migrated);
        return migrated;
      }
    }
  } catch {}
  return getDefaultAccounts();
}

export function saveAccounts(accounts: AccountConfig[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {}
}

export function getActiveAccountId(): string {
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || "default";
  } catch {
    return "default";
  }
}

export function setActiveAccountId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
  } catch {}
}

export function getActiveAccount(): AccountConfig {
  const accounts = loadAccounts();
  const activeId = getActiveAccountId();
  return accounts.find((a) => a.id === activeId) || accounts[0];
}

// ── Siguiente puerto disponible ───────────────────────────────────────────────
function nextAvailablePort(accounts: AccountConfig[]): number {
  const ports = accounts.map((a) => {
    const m = a.apiUrl.match(/:(\d+)/);
    return m ? parseInt(m[1]) : 3000;
  });
  return Math.max(3000, ...ports) + 1;
}

export function addAccount(label: string, apiUrl: string): AccountConfig {
  const accounts = loadAccounts();
  const id       = `cuenta_${Date.now()}`;
  const color    = ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length];
  // Asegurar protocolo
  let url = apiUrl.trim().replace(/\/$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `http://${url}`;
  }
  const newAccount: AccountConfig = { id, label, apiUrl: url, color };
  saveAccounts([...accounts, newAccount]);
  return newAccount;
}

export function updateAccount(id: string, patch: Partial<AccountConfig>): void {
  const accounts = loadAccounts();
  const updated  = accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
  saveAccounts(updated);
}

export function removeAccount(id: string): void {
  if (id === "default") return;
  const accounts = loadAccounts().filter((a) => a.id !== id);
  saveAccounts(accounts);
  if (getActiveAccountId() === id) {
    setActiveAccountId("default");
  }
}

/** URL base de la cuenta activa — SIEMPRE retorna string con http://… */
export function getActiveApiBase(): string {
  const account = getActiveAccount();
  return account.apiUrl || "http://localhost:3000";
}

/** Puerto sugerido para la próxima cuenta nueva */
export function suggestNextPort(): number {
  return nextAvailablePort(loadAccounts());
}
