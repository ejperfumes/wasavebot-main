const STORAGE_KEY = "wa_api_base";

// Limpia y valida la URL guardada.
// Si no tiene protocolo http:// o https://, la descarta para usar el proxy de Vite.
function sanitizeBase(raw: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/\/$/, "");
  // Solo aceptar URLs con protocolo explícito
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  // URL inválida guardada (ej: "localhost:3000" sin protocolo) → limpiar y usar proxy
  localStorage.removeItem(STORAGE_KEY);
  return "";
}

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  return sanitizeBase(localStorage.getItem(STORAGE_KEY));
}

export function setApiBase(u: string) {
  const trimmed = u.trim().replace(/\/$/, "");
  if (!trimmed) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  // Agregar http:// si el usuario olvidó el protocolo
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `http://${trimmed}`;
  localStorage.setItem(STORAGE_KEY, withProtocol);
}

function url(path: string) {
  const base = getApiBase();
  return `${base}${path}`;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? res.json() : (res.text() as unknown)) as Promise<T>;
}

export type MatchType = "contains" | "exact" | "startsWith" | "endsWith";
export type StepType = "text" | "image" | "video" | "audio" | "document";

export interface Keyword {
  value: string;
  match: MatchType;
}

export interface Step {
  id: string;
  type: StepType;
  content: string;
  caption?: string;
  delayMin: number;
  delayMax: number;
  simulateTyping: boolean;
  simulateRecording: boolean;
}

export interface Flow {
  id: string;
  name: string;
  keywords: Keyword[];
  steps: Step[];
}

export interface BotConfig {
  flows: Flow[];
}

export interface MediaItem {
  name: string;
  path: string;
  type: "image" | "video" | "audio" | "document";
  url?: string;
  size?: number;
}

export const api = {
  getConfig: () => fetch(url("/api/config")).then((r) => handle<BotConfig>(r)),
  saveConfig: (cfg: BotConfig) =>
    fetch(url("/api/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).then((r) => handle<{ ok: boolean }>(r)),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(url("/api/upload"), { method: "POST", body: fd }).then((r) =>
      handle<MediaItem>(r),
    );
  },
  mediaList: () => fetch(url("/api/media-list")).then((r) => handle<MediaItem[]>(r)),
  sendMessage: (payload: {
    number: string;
    type: StepType;
    content: string;
    caption?: string;
    simulateTyping?: boolean;
    simulateRecording?: boolean;
    delayMs?: number;
  }) =>
    fetch(url("/api/send-message"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => handle<{ ok: boolean }>(r)),
};

export function inferMediaType(name: string): MediaItem["type"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "ogg", "wav", "m4a", "opus"].includes(ext)) return "audio";
  return "document";
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
