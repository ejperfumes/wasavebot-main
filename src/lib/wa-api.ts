// ============================================================
// wa-api.ts — API del backend WaSaveBot
// PRODUCCIÓN: getApiBase() SIEMPRE usa la cuenta activa.
//   Sin fallback a localStorage legacy que causa cruces.
// ============================================================

import { getActiveApiBase } from "@/lib/accounts";

// ── getApiBase — fuente única de verdad ──────────────────────────────────────
export function getApiBase(): string {
  if (typeof window === "undefined") return "http://localhost:3000";
  return getActiveApiBase();
}

// setApiBase queda solo por compatibilidad con imports existentes
// pero YA NO modifica nada — la URL viene de la cuenta activa
export function setApiBase(_u: string) {
  // No-op intencional: la URL se gestiona en AccountSwitcher
  console.warn("[wa-api] setApiBase() ignorado — usa AccountSwitcher para cambiar la URL");
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
export type StepType  = "text" | "image" | "video" | "audio" | "document";

export interface Keyword    { value: string; match: MatchType; }
export interface FlowSchedule { id: string; hourStart: number; hourEnd: number; flowId: string; }
export interface Step {
  id: string; type: StepType; content: string; caption?: string;
  delayMin: number; delayMax: number; simulateTyping: boolean;
  simulateRecording: boolean; title?: string;
}
export interface Flow {
  id: string; name: string; keywords: Keyword[]; steps: Step[];
  initialDelayMin: number; initialDelayMax: number; schedules?: FlowSchedule[];
}
export interface QuickReply {
  id: string; name: string; color: string;
  editBeforeSend: boolean; steps: Step[];
}
export interface Config { flows: Flow[]; quickReplies: QuickReply[]; }

// ── WhatsApp ────────────────────────────────────────────────────────────────
export const waApi = {
  getStatus: ()    => fetch(url("/api/whatsapp/status"), { signal: AbortSignal.timeout(5000) }).then((r) => handle<{ status: string; qr: string | null; ready: boolean }>(r)),
  connect:   ()    => fetch(url("/api/whatsapp/connect"), { method: "POST", signal: AbortSignal.timeout(10000) }).then((r) => handle<{ ok: boolean; message?: string; error?: string }>(r)),
  disconnect:()    => fetch(url("/api/whatsapp/disconnect"), { method: "POST" }).then((r) => handle<{ ok: boolean }>(r)),
  logout:    ()    => fetch(url("/api/whatsapp/logout"), { method: "POST" }).then((r) => handle<{ ok: boolean }>(r)),
  getName:   ()    => fetch(url("/api/whatsapp/name"), { signal: AbortSignal.timeout(5000) }).then((r) => handle<{ name: string }>(r)),
  setName: (name: string) =>
    fetch(url("/api/whatsapp/name"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }), signal: AbortSignal.timeout(5000),
    }).then((r) => handle<{ ok: boolean }>(r)),
  // Devuelve accountId, sessionName, port del backend activo
  getAccountInfo: () =>
    fetch(url("/api/account-info"), { signal: AbortSignal.timeout(5000) })
      .then((r) => handle<{ accountId: string; sessionName: string; port: number }>(r)),
};

// ── Config ───────────────────────────────────────────────────────────────────
export const configApi = {
  get:  ()             => fetch(url("/api/config")).then((r) => handle<Config>(r)),
  save: (c: Config)    =>
    fetch(url("/api/config"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    }).then((r) => handle<{ ok: boolean }>(r)),
};

// ── Inbox ────────────────────────────────────────────────────────────────────
export interface InboxMessage {
  id: string; body: string; fromMe: boolean; timestamp: number;
  type: string; chatId: string; senderName?: string; read: boolean;
  mediaUrl?: string | null; fileName?: string; mimetype?: string;
  contextInfo?: { quotedMsg?: InboxMessage; mentionedJid?: string[] } | null;
  isForwarded?: boolean; forwardingScore?: number;
  latitude?: number; longitude?: number;
  vcardList?: { id: string; displayName: string }[];
  // Campos adicionales usados por MessageBubble, ContactSidebar, QuickSendTab
  hasMedia?: boolean;
  mediaMime?: string;
  locationDescription?: string;
}
export interface InboxChat {
  /** Identificador principal del chat — mismo valor que chatId */
  id: string;
  /** Alias de id — ambos apuntan al mismo valor */
  chatId: string;
  name: string;
  lastMessage?: InboxMessage | string;
  unreadCount: number;
  timestamp: number;
  labels?: string[];
  isGroup?: boolean;
  tags?: LabelDef[];
  profilePicUrl?: string | null;
  lastMessageType?: string;
}
export interface LabelDef { id: string; name: string; color: string; }
export interface ContactRecord {
  wa?: {
    name?: string; pushname?: string; phone?: string; avatarUrl?: string;
    isGroup?: boolean; about?: string;
    // Campos adicionales usados por ContactSidebar
    profilePicUrl?: string | null;
    syncedAt?: number;   // solo número — ContactSidebar lo pasa a funciones que esperan number
    isBusiness?: boolean;
    isEnterprise?: boolean;
    isMyContact?: boolean;
    status?: string;
  };
  crm?: {
    alias?: string;
    /** Nota del contacto */
    note?: string;
    /** Alias de note — algunos componentes usan 'notes' */
    notes?: string;
    /** Nombre CRM — usado en ContactSidebar */
    name?: string;
    tags?: string[];
    labelIds?: string[];
    phone?: string; email?: string; birthday?: string; company?: string;
  };
}

export const inboxApi = {
  getChats: () =>
    fetch(url("/api/inbox/chats")).then((r) => handle<InboxChat[]>(r)),
  getMessages: (chatId: string) =>
    fetch(url(`/api/inbox/messages/${encodeURIComponent(chatId)}`)).then((r) => handle<InboxMessage[]>(r)),
  markRead: (chatId: string) =>
    // Backend: POST /api/inbox/read/:chatId
    fetch(url(`/api/inbox/read/${encodeURIComponent(chatId)}`), { method: "POST" }).then((r) => handle<{ ok: boolean }>(r)),
  sendMessage: (chatId: string, type: string, content: string, caption?: string) =>
    // Backend: POST /api/send-message con campo 'number'
    fetch(url("/api/send-message"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: chatId, type, content, caption }),
    }).then((r) => handle<{ ok: boolean }>(r)),
  sendQuickReply: (chatId: string, quickReplyId: string) =>
    // Backend: POST /api/execute-quick-reply
    fetch(url("/api/execute-quick-reply"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, quickReplyId }),
    }).then((r) => handle<{ ok: boolean; message: string; total: number }>(r)),
  cancelQuickReply: (chatId: string) =>
    // Backend: POST /api/cancel-quick-reply con body
    fetch(url("/api/cancel-quick-reply"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).then((r) => handle<{ ok: boolean }>(r)),
  fetchMedia: (_chatId: string, msgId: string) =>
    // Backend: GET /api/inbox/media/:messageId
    fetch(url(`/api/inbox/media/${encodeURIComponent(msgId)}`))
      .then((r) => handle<{ url: string }>(r))
      .then((d) => ({ ok: true, url: d.url })),
  deleteMessage: (_chatId: string, msgId: string) =>
    // Backend no tiene DELETE por mensaje individual — usamos clean como fallback no-op
    // Si el backend agrega este endpoint, cambiar a: /api/inbox/messages/:chatId/:msgId
    Promise.resolve({ ok: false }),
  newChat: (number: string) =>
    // Backend: GET /api/resolve-chat?number=...
    fetch(url(`/api/resolve-chat?number=${encodeURIComponent(number)}`))
      .then((r) => handle<{ chatId: string }>(r))
      .then((d) => ({ ok: true, chatId: d.chatId })),
  linkPreview: (targetUrl: string) =>
    // Backend: GET /api/link-preview?url=...
    fetch(url(`/api/link-preview?url=${encodeURIComponent(targetUrl)}`), {
      signal: AbortSignal.timeout(6000),
    })
      .then((r) => handle<{ ok: boolean; title?: string; description?: string; image?: string; siteName?: string; url?: string }>(r))
      .catch(() => ({ ok: false as const })),
};

export const contactsApi = {
  get: (chatId: string) =>
    fetch(url(`/api/contacts/${encodeURIComponent(chatId)}`)).then((r) => handle<ContactRecord>(r)),
  save: (chatId: string, crm: ContactRecord["crm"]) =>
    fetch(url(`/api/contacts/${encodeURIComponent(chatId)}`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(crm),
    }).then((r) => handle<ContactRecord>(r)),
  syncWa: (chatId: string) =>
    fetch(url(`/api/contacts/${encodeURIComponent(chatId)}/sync-wa`), { method: "POST" }).then((r) => handle<ContactRecord>(r)),
};

export const labelsApi = {
  getAll: () =>
    fetch(url("/api/labels")).then((r) => handle<LabelDef[]>(r)),
  create: (name: string, color: string) =>
    fetch(url("/api/labels"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    }).then((r) => handle<LabelDef>(r)),
  update: (id: string, name: string, color: string) =>
    fetch(url(`/api/labels/${id}`), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    }).then((r) => handle<LabelDef>(r)),
  delete: (id: string) =>
    fetch(url(`/api/labels/${id}`), { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),
  assign: (chatId: string, labelIds: string[]) =>
    fetch(url(`/api/contacts/${encodeURIComponent(chatId)}`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelIds }),
    }).then((r) => handle<ContactRecord>(r)),
  removeContactTag: (chatId: string, tag: string) =>
    fetch(url(`/api/contacts/${encodeURIComponent(chatId)}/tags/${encodeURIComponent(tag)}`), {
      method: "DELETE",
    }).then((r) => handle<{ ok: boolean }>(r)),
};

// ── Exports faltantes — agregados para compatibilidad con componentes ─────────

// uid — generador de IDs únicos usado en FlowsTab, QuickRepliesTab, NewChatModal, FlowEditor
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// BotConfig — alias de Config usado en FlowsTab, QuickRepliesTab, QuickSendTab
export type BotConfig = Config;

// ContactCrmData — alias del campo crm de ContactRecord, usado en ContactSidebar
export type ContactCrmData = NonNullable<ContactRecord["crm"]>;

// MediaItem — tipo para la biblioteca de medios (MediaPickerDialog, MediaLibraryTab)
export interface MediaItem {
  path: string;
  name: string;
  type: "image" | "video" | "audio" | "document";
  url?: string;
  size?: number;
  mimetype?: string;
}

// getProfilePic — usado en ConversationSidebar
// Retorna { url: string | null } — el código hace .then(({ url }) => ...)
export function getProfilePic(chatId: string): Promise<{ url: string | null }> {
  return fetch(url(`/api/contacts/${encodeURIComponent(chatId)}/profile-pic`), {
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => (r.ok ? r.json() : { url: null }))
    .then((d: { url?: string | null } | null) => ({ url: d?.url ?? null }))
    .catch(() => ({ url: null }));
}

// api — objeto unificado usado en FlowsTab, QuickRepliesTab, QuickReplyBar,
//        MediaLibraryTab, MediaPickerDialog, MessageBubble, QuickSendTab
export const api = {
  // Config / flows / quickReplies
  getConfig: () =>
    fetch(url("/api/config")).then((r) => handle<Config>(r)),
  saveConfig: (c: Config) =>
    fetch(url("/api/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    }).then((r) => handle<{ ok: boolean }>(r)),

  // Quick replies — backend usa /api/execute-quick-reply y /api/cancel-quick-reply (body)
  executeQuickReply: (chatId: string, quickReplyId: string) =>
    fetch(url("/api/execute-quick-reply"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, quickReplyId }),
    }).then((r) => handle<{ ok: boolean; message: string; total: number }>(r)),
  cancelQuickReply: (chatId: string) =>
    fetch(url("/api/cancel-quick-reply"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).then((r) => handle<{ ok: boolean }>(r)),

  // Media — backend usa /api/media-list y /api/upload
  mediaList: () =>
    fetch(url("/api/media-list")).then((r) => handle<MediaItem[]>(r)),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(url("/api/upload"), { method: "POST", body: form }).then(
      (r) => handle<MediaItem>(r)
    );
  },
  // downloadMedia — backend usa GET /api/inbox/media/:messageId
  downloadMedia: (msgId: string) =>
    fetch(url(`/api/inbox/media/${encodeURIComponent(msgId)}`))
      .then((r) => handle<{ url: string }>(r)),

  // Stickers — backend no tiene endpoint dedicado, usa media-list filtrando
  listStickers: () =>
    fetch(url("/api/media-list"))
      .then((r) => handle<MediaItem[]>(r))
      .then((items) => items.filter((i) => i.type === "image" && i.name.endsWith(".webp"))
        .map((i) => ({ name: i.name, url: i.url ?? i.path }))),

  // Inbox helpers — URLs corregidas al backend real
  markChatRead: (chatId: string) =>
    fetch(url(`/api/inbox/read/${encodeURIComponent(chatId)}`), {
      method: "POST",
    }).then((r) => handle<{ ok: boolean }>(r)),
  deleteChat: (chatId: string) =>
    fetch(url(`/api/inbox/chat/${encodeURIComponent(chatId)}`), {
      method: "DELETE",
    }).then((r) => handle<{ ok: boolean }>(r)),
  // sendMessage — backend usa /api/send-message con campo 'number' (no chatId)
  sendMessage: (payload: {
    chatId?: string;
    type: string;
    content: string;
    caption?: string;
    number?: string;
    /** ID del mensaje al que se responde (WPPConnect: quotedMessageId) */
    quotedMsgId?: string;
  }) =>
    fetch(url("/api/send-message"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // El backend espera 'number', no 'chatId' — normalizar aquí
      body: JSON.stringify({ ...payload, number: payload.number ?? payload.chatId }),
    }).then((r) => handle<{ ok: boolean }>(r)),
  cleanInbox: () =>
    fetch(url("/api/inbox/clean"), { method: "DELETE" }).then((r) =>
      handle<{ ok: boolean; deleted: number }>(r)
    ),
};