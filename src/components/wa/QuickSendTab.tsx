/**
 * QuickSendTab.tsx — Contenedor principal de la bandeja.
 *
 * REDISEÑO INTERFAZ: estructura de 3 columnas estilo Chatwoot.
 *   Columna 1: ConversationSidebar  (lista de chats)
 *   Columna 2: ConversationView     (historial + input)
 *   Columna 3: ContactSidebar       (info del contacto, toggle)
 *
 * FIX SSE DUPLICADOS: connectSSE ahora solo depende de apiBase.
 *   fetchMessages y fetchChats se acceden via refs estables para evitar
 *   que el useCallback se recree en cada render y reconecte el SSE,
 *   lo que causaba que el servidor reenviara eventos y llegaran duplicados.
 *
 * RESTRICCIONES:
 *   - NO modifica backend.
 *   - NO modifica WPPConnect.
 *   - NO modifica lógica de mensajes.
 *   - NO modifica base de datos.
 *   - NO modifica SSE.
 *   - NO modifica respuestas rápidas ni bot.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useChatScroll } from "@/hooks/useChatScroll";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MessageSquare,
  X,
  FileText,
  Send,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  getApiBase,
  uid,
  contactsApi,
  labelsApi,
  type BotConfig,
  type InboxChat,
  type InboxMessage,
  type QuickReply,
  type StepType,
  type ContactRecord,
  type LabelDef,
} from "@/lib/wa-api";

import { cn } from "@/lib/utils";

// ─── Componentes de interfaz ──────────────────────────────────────────────────
import { ConversationSidebar, type FilterTab } from "./ConversationSidebar";
import { ConversationView } from "./ConversationView";
import { ContactSidebar } from "./ContactSidebar";
import { NewChatModal } from "./NewChatModal";

// ─── resolveContactName ───────────────────────────────────────────────────────
const INVALID_NAMES = new Set(["yo", "you", "me", ""]);

function isLidId(chatId: string): boolean {
  return chatId.endsWith("@lid");
}

function resolveContactName(
  chatId: string,
  candidateName: string | null | undefined
): string {
  const trimmed = (candidateName ?? "").trim();

  const isInvalid =
    INVALID_NAMES.has(trimmed.toLowerCase()) ||
    trimmed === chatId ||
    trimmed === chatId.replace("@c.us", "") ||
    trimmed === chatId.replace("@lid", "") ||
    trimmed === chatId.replace("@g.us", "");

  if (!isInvalid && trimmed) return trimmed;

  if (isLidId(chatId)) {
    return "Contacto desconocido";
  }

  return formatPhoneFromChatId(chatId);
}

function formatPhoneFromChatId(chatId: string): string {
  if (chatId.endsWith("@g.us")) return chatId.replace("@g.us", "");
  if (isLidId(chatId)) return "Contacto desconocido";

  const digits = chatId
    .replace(/@c\.us$/, "")
    .replace(/\D/g, "");

  if (!digits) return chatId;

  if (digits.length >= 10) {
    const cc   = digits.slice(0, digits.length - 10);
    const sub  = digits.slice(digits.length - 10);
    const area = sub.slice(0, 3);
    const mid  = sub.slice(3, 6);
    const end  = sub.slice(6);
    return cc ? `+${cc} ${area} ${mid} ${end}` : `${area} ${mid} ${end}`;
  }

  return `+${digits}`;
}

// ─── normalizeQuickReplies ────────────────────────────────────────────────────

function normalizeQuickReplies(cfg: BotConfig): QuickReply[] {
  if (!Array.isArray(cfg.quickReplies)) return [];
  return cfg.quickReplies.map((qr) => ({
    id: qr.id ?? uid(),
    name: qr.name ?? "",
    color: qr.color ?? "#22c55e",
    editBeforeSend: !!qr.editBeforeSend,
    steps: Array.isArray(qr.steps)
      ? qr.steps.map((s) => ({
          id: s.id ?? uid(),
          type: (s.type ?? "text") as StepType,
          content: s.content ?? "",
          caption: s.caption ?? "",
          delayMin: Number(s.delayMin) || 8,
          delayMax: Number(s.delayMax) || 10,
          simulateTyping: !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
          title: s.title ?? "",
        }))
      : [],
  }));
}

// ─── Búsqueda robusta ─────────────────────────────────────────────────────────

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(str: string): string {
  return str.replace(/\D/g, "");
}

function matchScore(chat: InboxChat, rawQuery: string): number {
  const q       = normalizeText(rawQuery);
  const qDigits = digitsOnly(rawQuery);
  if (!q && !qDigits) return 0;

  const name     = normalizeText(chat.name);
  const lastMsg  = normalizeText(typeof chat.lastMessage === "string" ? chat.lastMessage : chat.lastMessage?.body ?? "");
  const idRaw    = chat.id ?? chat.chatId;
  const idDigits = digitsOnly(idRaw);
  const idClean  = normalizeText(idRaw.replace(/@c\.us|@g\.us|@lid/g, ""));

  const tokens = q.split(" ").filter(Boolean);
  const allInName    = tokens.every((t) => name.includes(t));
  const allInLastMsg = tokens.every((t) => lastMsg.includes(t));
  const allInId      = tokens.every((t) => idClean.includes(t));
  const phoneMatch   = qDigits.length >= 4 && idDigits.includes(qDigits);

  if (!allInName && !allInLastMsg && !allInId && !phoneMatch) return 0;

  let score = 0;
  if (allInName) {
    score = name === q ? 100 : name.startsWith(q) ? 90 : 80;
  } else if (phoneMatch) {
    score = 70;
  } else if (allInId) {
    score = 50;
  } else if (allInLastMsg) {
    score = 30;
  }
  return score;
}

// ─── Helpers de clipboard ─────────────────────────────────────────────────────

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function QuickSendTab() {
  // ── Estado de datos ────────────────────────────────────────────────────────
  const [chats, setChats] = useState<InboxChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<InboxChat | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<InboxMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [templateHighlight, setTemplateHighlight] = useState(false);
  const [pendingQrAttachment, setPendingQrAttachment] = useState<{
    mediaPath: string; caption: string; type: "image" | "video" | "document";
  } | null>(null);
  const [quickReplyProgressMap, setQuickReplyProgressMap] = useState<Map<string, {
    quickReplyId: string; step: number; total: number; done: boolean; error: string | null;
  }>>(new Map());

  // ── UI state ───────────────────────────────────────────────────────────────
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [voiceRecordingActive, setVoiceRecordingActive] = useState(false);
  const [showContactSidebar, setShowContactSidebar] = useState(true);
  const [contactRecord, setContactRecord] = useState<ContactRecord | null>(null);
  const [allLabels, setAllLabels]         = useState<LabelDef[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  // IDs de chats archivados — persisten en localStorage
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("wa_archived_chats");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // IDs de chats fijados — persisten en localStorage (orden preservado)
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("wa_pinned_chats");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // ── Refs ───────────────────────────────────────────────────────────────────
  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const sseRef           = useRef<EventSource | null>(null);
  const selectedChatRef  = useRef<InboxChat | null>(null);
  const recentMsgIdsRef  = useRef<Set<string>>(new Set());

  // ── Refs estables para callbacks — evitan recrear connectSSE ──────────────
  // Sin estos refs, fetchMessages y fetchChats como deps de connectSSE hacen
  // que el useCallback se recree en cada render, reconectando SSE y duplicando
  // eventos que el servidor reenvía durante el reestablecimiento.
  const fetchMessagesRef = useRef<(chatId: string) => Promise<void>>(async () => {});
  const fetchChatsRef    = useRef<() => Promise<void>>(async () => {});

  // ── Scroll estilo WhatsApp ─────────────────────────────────────────────────
  const {
    messagesEndRef,
    scrollContainerRef,
    hasNewMessages,
    scrollToBottom,
  } = useChatScroll({ messages, chatId: selectedChat?.id ?? null });

  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);

  const apiBase = getApiBase();

  // ── Tecla ESC ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!selectedChatRef.current) return;
      const active = document.activeElement;
      if (active) {
        const tag = (active as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if ((active as HTMLElement).isContentEditable) return;
      }
      if (document.querySelector("[role='dialog']")) return;
      setShowMobileChat(false);
      setSelectedChat(null);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // ── Fetch chats ────────────────────────────────────────────────────────────
  const fetchChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await fetch(`${apiBase || ""}/api/inbox/chats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all: InboxChat[] = await res.json();
      const enriched = await Promise.all(
        all
          .filter((c) => c.id !== "status@broadcast" && !c.id.includes("@newsletter"))
          .map(async (c) => {
            const needsName =
              !c.name ||
              INVALID_NAMES.has(c.name.toLowerCase()) ||
              c.name === c.id ||
              c.name === c.id.replace("@c.us", "") ||
              c.name === c.id.replace("@lid", "");

            if (needsName && c.id.endsWith("@lid")) {
              try {
                const msgRes = await fetch(`${apiBase || ""}/api/inbox/messages/${encodeURIComponent(c.id)}?limit=20`);
                if (msgRes.ok) {
                  const msgs: InboxMessage[] = await msgRes.json();
                  const validName = msgs
                    .filter((m) => !m.fromMe && m.senderName && !INVALID_NAMES.has(m.senderName.toLowerCase()))
                    .map((m) => m.senderName)[0];
                  if (validName) return { ...c, name: validName };
                }
              } catch { /* silencioso */ }
            }

            return { ...c, name: resolveContactName(c.id, c.name) };
          })
      );
      setChats(enriched);
    } catch { /* silencioso */ }
    finally { setLoadingChats(false); }
  }, [apiBase]);

  // ── Fetch messages ─────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`${apiBase || ""}/api/inbox/messages/${encodeURIComponent(chatId)}?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InboxMessage[] = await res.json();

      const realMessages = data.filter((m) => !m.id?.startsWith("outgoing_"));
      const deduplicated = data.filter((m) => {
        if (!m.id?.startsWith("outgoing_")) return true;
        const isMediaOrPtt = m.hasMedia ||
          m.type === "ptt" ||
          m.type === "audio" ||
          m.type === "voice";
        const tsWindow = isMediaOrPtt ? 60 : 45;
        const hasRealCounterpart = realMessages.some((r) => {
          if (r.fromMe !== m.fromMe) return false;
          if (r.type !== m.type) return false;
          if (Math.abs(r.timestamp - m.timestamp) > tsWindow) return false;
          if (isMediaOrPtt) return true;
          return r.body === m.body;
        });
        return !hasRealCounterpart;
      });

      setMessages(deduplicated);

      try {
        await fetch(`${apiBase || ""}/api/inbox/read/${encodeURIComponent(chatId)}`, { method: "POST" });
      } catch { /* silencioso */ }

      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));
    } catch (e) {
      toast.error("Error cargando mensajes", { description: (e as Error).message });
    } finally {
      setLoadingMessages(false);
    }
  }, [apiBase]);

  // ── Mantener refs de callbacks actualizados ────────────────────────────────
  useEffect(() => { fetchMessagesRef.current = fetchMessages; }, [fetchMessages]);
  useEffect(() => { fetchChatsRef.current    = fetchChats;    }, [fetchChats]);

  // ── SSE — solo depende de apiBase ──────────────────────────────────────────
  // fetchMessages y fetchChats se llaman via ref para evitar que connectSSE
  // se recree cada vez que esas funciones cambian, lo que reconectaba SSE y
  // causaba que los mismos eventos llegaran dos veces.
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`${apiBase || ""}/api/inbox/events`);
    es.onopen = () => setSseConnected(true);
    es.onerror = () => { setSseConnected(false); setTimeout(connectSSE, 5000); };

    es.addEventListener("new_message", (e: MessageEvent) => {
      try {
        const { chatId, message } = JSON.parse(e.data) as { chatId: string; message: InboxMessage };
        if (chatId === "status@broadcast" || chatId.includes("@newsletter")) return;

        // Guardia global contra eventos SSE duplicados
        if (recentMsgIdsRef.current.has(message.id)) return;
        recentMsgIdsRef.current.add(message.id);
        setTimeout(() => recentMsgIdsRef.current.delete(message.id), 10000);

        // Cruce automático @c.us ↔ @lid
        const currentChat = selectedChatRef.current;
        if (currentChat && currentChat.id !== chatId) {
          const currentDigits  = currentChat.id.replace(/\D/g, "");
          const incomingDigits = chatId.replace(/\D/g, "");
          const sameContact =
            currentDigits.length >= 7 &&
            incomingDigits.length >= 7 &&
            (currentDigits.endsWith(incomingDigits) || incomingDigits.endsWith(currentDigits));

          if (sameContact) {
            setChats((prevChats) => {
              const realChat = prevChats.find((c) => c.id === chatId);
              if (realChat) {
                selectedChatRef.current = realChat;
                setSelectedChat(realChat);
                fetchMessagesRef.current(chatId);
              } else {
                const updated = { ...currentChat, id: chatId };
                selectedChatRef.current = updated;
                setSelectedChat(updated);
                fetchMessagesRef.current(chatId);
              }
              return prevChats;
            });
          }
        }

        setChats((prev) => {
          const existing      = prev.find((c) => c.id === chatId);
          const isSelectedChat = selectedChatRef.current?.id === chatId;
          const updated: InboxChat = existing
            ? {
                ...existing,
                name: (
                  !message.fromMe &&
                  message.senderName &&
                  !INVALID_NAMES.has(message.senderName.toLowerCase()) &&
                  (INVALID_NAMES.has(existing.name.toLowerCase()) || existing.name === "Contacto desconocido")
                ) ? message.senderName : existing.name,
                lastMessage:     message.body,
                lastMessageType: message.type,
                timestamp:       message.timestamp,
                unreadCount:     isSelectedChat ? 0 : existing.unreadCount + (message.fromMe ? 0 : 1),
              }
            : {
                id:              chatId,
                chatId:          chatId,
                name:            resolveContactName(chatId, message.senderName),
                lastMessage:     message.body,
                lastMessageType: message.type,
                timestamp:       message.timestamp,
                unreadCount:     message.fromMe || isSelectedChat ? 0 : 1,
                isGroup:         chatId.endsWith("@g.us"),
                profilePicUrl:   null,
              };
          return [updated, ...prev.filter((c) => c.id !== chatId)];
        });

        if (selectedChatRef.current?.id === chatId) {
          setMessages((prev) => {
            const isDupById = prev.some((m) => m.id === message.id);
            const isDupByContent = message.fromMe && prev.some(
              (m) =>
                m.fromMe &&
                (m.id === message.id ||
                  (m.type === message.type &&
                   m.body === message.body &&
                   Math.abs(m.timestamp - message.timestamp) <= 5))
            );
            if (isDupById || isDupByContent) return prev;
            return [...prev, { ...message, read: true }];
          });
        }
      } catch {}
    });

    es.addEventListener("quick_reply_progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setQuickReplyProgressMap((prev) => {
          const next = new Map(prev);
          next.set(data.chatId, {
            quickReplyId: data.id,
            step:  data.step,
            total: data.total,
            done:  data.done,
            error: data.error,
          });
          return next;
        });
        if (data.done || data.error) {
          setTimeout(() => {
            setQuickReplyProgressMap((prev) => {
              const next = new Map(prev);
              next.delete(data.chatId);
              return next;
            });
          }, 2000);
        }
      } catch {}
    });

    es.addEventListener("media_downloaded", (e: MessageEvent) => {
      try {
        const { chatId, messageId, mediaUrl } = JSON.parse(e.data);
        if (chatId === selectedChatRef.current?.id) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId ? { ...msg, mediaUrl, mediaDownloaded: true } : msg
            )
          );
        }
      } catch {}
    });

    es.addEventListener("inbox_cleaned", () => {
      if (selectedChatRef.current) fetchMessagesRef.current(selectedChatRef.current.id);
      fetchChatsRef.current();
      toast.info("La bandeja ha sido limpiada");
    });

    es.addEventListener("chat_deleted", (e: MessageEvent) => {
      try {
        const { chatId } = JSON.parse(e.data);
        setChats((prev) => prev.filter((c) => c.id !== chatId));
        if (selectedChatRef.current?.id === chatId) {
          setSelectedChat(null);
          setMessages([]);
          setShowMobileChat(false);
          selectedChatRef.current = null;
        }
      } catch {}
    });

    sseRef.current = es;
  }, [apiBase]); // ← SOLO apiBase, nunca fetchMessages ni fetchChats

  // ── Efectos ────────────────────────────────────────────────────────────────

  // ── filteredChats como useMemo — no genera render extra al actualizar chats ──
  const filteredChats = useMemo(() => {
    let result = chats;
    if (searchQuery.trim()) {
      result = result
        .map((c) => ({ chat: c, score: matchScore(c, searchQuery) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ chat }) => chat);
    }
    if (filterTab === "archived") {
      result = result.filter((c) => archivedIds.has(c.id));
    } else {
      result = result.filter((c) => !archivedIds.has(c.id));
      if (filterTab === "unread") result = result.filter((c) => c.unreadCount > 0 && !c.isGroup);
      if (filterTab === "groups") result = result.filter((c) => c.isGroup);
      if (filterTab === "all")    result = result.filter((c) => !c.isGroup);
    }
    if (selectedLabel) result = result.filter((c) => c.tags?.some((t) => t.id === selectedLabel));

    if (!searchQuery.trim() && pinnedIds.length > 0) {
      const pinnedSet = new Set(pinnedIds);
      const pinned    = pinnedIds.map((id) => result.find((c) => c.id === id)).filter(Boolean) as typeof result;
      const rest      = result.filter((c) => !pinnedSet.has(c.id));
      result = [...pinned, ...rest];
    }
    return result;
  }, [chats, searchQuery, filterTab, selectedLabel, archivedIds, pinnedIds]);

  useEffect(() => {
    fetchChats();
    connectSSE();
    api.getConfig().then((cfg) => setQuickReplies(normalizeQuickReplies(cfg))).catch(() => {});
    labelsApi.getAll().then(setAllLabels).catch(() => {});
    return () => { sseRef.current?.close(); };
  }, [fetchChats, connectSSE]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectChat = (chat: InboxChat) => {
    setMessages([]);
    recentMsgIdsRef.current.clear();
    setSelectedChat(chat);
    setShowMobileChat(true);
    fetchMessages(chat.id);
    setReplyingTo(null);
    setContactRecord(null);
    // Marcar como leído al abrir el chat (sincroniza con el teléfono)
    if (chat.unreadCount > 0) {
      api.markChatRead(chat.id).catch(() => {});
      setChats((prev) =>
        prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c))
      );
    }
    Promise.all([
      contactsApi.get(chat.id).catch(() => null),
      labelsApi.getAll().catch(() => [] as LabelDef[]),
    ]).then(([record, labels]) => {
      setContactRecord(record);
      setAllLabels(labels);
    });
  };

  // ── Sincronización de etiquetas desde header (InlineLabeler) → lista de chats ─
  // Cuando el usuario agrega/quita etiquetas desde el botón "Etiquetar" del header,
  // este callback actualiza el array chat.tags del chat seleccionado en el estado
  // local, de modo que los dots de la columna izquierda se reflejan en tiempo real.
  const handleLabelsChange = useCallback((tagIds: string[]) => {
    if (!selectedChat) return;
    const tagDefs = tagIds
      .map((id) => allLabels.find((l) => l.id === id))
      .filter(Boolean) as LabelDef[];
    setChats((prev) =>
      prev.map((c) =>
        c.id === selectedChat.id ? { ...c, tags: tagDefs } : c
      )
    );
    // También actualizar contactRecord local para que el header refleje los chips
    setContactRecord((prev) => {
      if (!prev) return prev;
      return { ...prev, crm: { ...prev.crm, tags: tagIds } };
    });
  }, [selectedChat, allLabels]);

  // ── Archivar / desarchivar chat ──────────────────────────────────────────
  const handleArchiveChat = useCallback((chatId: string) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      try { localStorage.setItem("wa_archived_chats", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  // ── Eliminar chat individual ───────────────────────────────────────────────
  const handleDeleteChat = useCallback(async (chatId: string) => {
    // La confirmación la gestiona el diálogo propio del ConversationSidebar
    // Este handler se llama solo después de que el usuario confirmó
    try {
      await api.deleteChat(chatId);
      // El SSE "chat_deleted" actualiza el estado — pero si falla el SSE lo hacemos localmente
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (selectedChatRef.current?.id === chatId) {
        setSelectedChat(null);
        setMessages([]);
        setShowMobileChat(false);
        selectedChatRef.current = null;
      }
      // Limpiar de fijados y archivados por si estaba ahí
      setPinnedIds((prev) => {
        const next = prev.filter((id) => id !== chatId);
        try { localStorage.setItem("wa_pinned_chats", JSON.stringify(next)); } catch {}
        return next;
      });
      setArchivedIds((prev) => {
        const next = new Set(prev);
        next.delete(chatId);
        try { localStorage.setItem("wa_archived_chats", JSON.stringify([...next])); } catch {}
        return next;
      });
      toast.success("Conversación eliminada");
    } catch {
      toast.error("Error al eliminar la conversación");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fijar / desfijar chat ─────────────────────────────────────────────────
  // Usamos un ref como guardia para que el toast se dispare exactamente una vez,
  // incluso en React StrictMode donde los setters funcionales se invocan dos veces.
  const pinToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePinChat = useCallback((chatId: string) => {
    // Leer el valor actual del array ANTES del setState para saber la acción
    setPinnedIds((prev) => {
      const isPinned = prev.includes(chatId);
      const next = isPinned
        ? prev.filter((id) => id !== chatId)
        : [chatId, ...prev];
      try { localStorage.setItem("wa_pinned_chats", JSON.stringify(next)); } catch {}
      // Guardia de debounce: cancela el toast anterior si el setter se llama dos veces
      if (pinToastRef.current) clearTimeout(pinToastRef.current);
      pinToastRef.current = setTimeout(() => {
        toast.success(isPinned ? "Chat desfijado" : "Chat fijado");
        pinToastRef.current = null;
      }, 10);
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cuando se crea una etiqueta nueva en el catálogo global ─────────────
  const handleLabelCreated = useCallback((label: LabelDef) => {
    // Agregar al catálogo local para que aparezca de inmediato en el dropdown
    setAllLabels((prev) => {
      if (prev.some((l) => l.id === label.id)) return prev; // evitar duplicados
      return [...prev, label];
    });
  }, []);

  // ── Cuando se elimina una etiqueta del catálogo global ──────────────────
  const handleLabelDeleted = useCallback((labelId: string) => {
    // 1. Quitar la etiqueta del catálogo local
    setAllLabels((prev) => prev.filter((l) => l.id !== labelId));
    // 2. Quitar la etiqueta de todos los chats que la tenían
    setChats((prev) =>
      prev.map((c) =>
        c.tags?.some((t) => t.id === labelId)
          ? { ...c, tags: c.tags.filter((t) => t.id !== labelId) }
          : c
      )
    );
    // 3. Si el filtro activo era esa etiqueta, limpiar filtro
    setSelectedLabel((prev) => (prev === labelId ? null : prev));
  }, []);

  // ── Marcar como no leído desde el menú contextual del sidebar ─────────────
  const handleMarkUnreadFromSidebar = useCallback((chat: InboxChat) => {
    handleMarkUnread(chat);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Etiquetar chat desde el menú contextual del sidebar ───────────────────
  const handleLabelChatFromSidebar = useCallback((chat: InboxChat, tagIds: string[]) => {
    const tagDefs = tagIds
      .map((id) => allLabels.find((l) => l.id === id))
      .filter(Boolean) as LabelDef[];
    // Guardar en backend usando el mismo flujo que ContactSidebar
    import("@/lib/wa-api").then(({ contactsApi }) => {
      contactsApi.save(chat.id, { tags: tagIds }).catch(() => {});
    });
    setChats((prev) =>
      prev.map((c) => (c.id === chat.id ? { ...c, tags: tagDefs } : c))
    );
  }, [allLabels]);

  const handleSend = async () => {
    if (!selectedChat || !replyText.trim()) return;
    setSending(true);
    // Capturar el mensaje citado ANTES de limpiar el estado
    const quotedMsgId = replyingTo?.id;
    try {
      await api.sendMessage({
        number: selectedChat.id.replace("@c.us", "").replace("@g.us", ""),
        type: "text",
        content: replyText.trim(),
        // Si hay mensaje citado, enviarlo para que WPPConnect haga el reply
        ...(quotedMsgId ? { quotedMsgId } : {}),
      });
      setReplyText("");
      setReplyingTo(null);
      textareaRef.current?.focus();
    } catch (e) {
      toast.error("Error al enviar", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const sendQrAttachment = async (caption: string) => {
    if (!selectedChat || !pendingQrAttachment) return;
    setSending(true);
    try {
      const fullUrl = `${apiBase || "http://localhost:3000"}${pendingQrAttachment.mediaPath}`;
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const filename = pendingQrAttachment.mediaPath.split("/").pop() ?? "archivo";
      const file = new File([blob], filename, { type: blob.type });
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("phoneNumber", selectedChat.id.replace("@c.us", "").replace("@g.us", ""));
      formData.append("caption", caption);
      formData.append("asSticker", "false");
      const sendRes = await fetch(`${apiBase || "http://localhost:3000"}/api/send-attachment`, { method: "POST", body: formData });
      if (sendRes.ok) {
        toast.success(`✅ ${pendingQrAttachment.type === "image" ? "Imagen" : pendingQrAttachment.type === "video" ? "Video" : "Documento"} enviado`);
        setPendingQrAttachment(null);
      } else if (sendRes.status === 503) {
        toast.error("WhatsApp no está conectado");
      } else {
        const data = await sendRes.json().catch(() => ({}));
        toast.error("Error al enviar", { description: data?.error || `HTTP ${sendRes.status}` });
      }
    } catch (e) {
      toast.error("Error de conexión", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape") { setReplyingTo(null); }
  };

  const handleCopyPath = async () => {
    try {
      const res = await fetch(`${apiBase || "http://localhost:3000"}/api/inbox/path`);
      const data = await res.json();
      copyToClipboard(data.path);
      toast.success("Ruta de archivos copiada: " + data.path);
    } catch {
      toast.error("No se pudo obtener la ruta del servidor");
    }
  };

  const handleMarkUnread = async (chat: InboxChat) => {
    try {
      await fetch(`${apiBase || ""}/api/inbox/unread/${encodeURIComponent(chat.id)}`, { method: "POST" });
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: c.unreadCount + 1 } : c)));
      toast.success("Chat marcado como no leído");
    } catch {
      toast.error("Error al marcar como no leído");
    }
  };

  const handleMarkAllRead = async () => {
    const unreadChats = chats.filter((c) => c.unreadCount > 0);
    if (unreadChats.length === 0) return;
    try {
      await Promise.all(
        unreadChats.map((c) =>
          fetch(`${apiBase || ""}/api/inbox/read/${encodeURIComponent(c.id)}`, { method: "POST" })
        )
      );
      setChats((prev) =>
        prev.map((c) => (c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c))
      );
      toast.success(`${unreadChats.length} conversación${unreadChats.length !== 1 ? "es" : ""} marcada${unreadChats.length !== 1 ? "s" : ""} como leída${unreadChats.length !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Error al marcar como leídas");
    }
  };

  const handleNewChat = () => {
    setShowNewChatModal(true);
  };

  const handleChatOpenedFromModal = (chatId: string) => {
    const digits = chatId.replace(/\D/g, "");
    const existing = chats.find((c) => {
      if (c.id === chatId) return true;
      if (digits.length >= 7) {
        const cd = c.id.replace(/\D/g, "");
        return cd.endsWith(digits) || digits.endsWith(cd);
      }
      return false;
    });
    if (existing) handleSelectChat(existing);
  };

  const handleCleanInbox = async () => {
    if (!confirm("⚠️ Esta acción ELIMINARÁ TODOS LOS ARCHIVOS descargados de la bandeja y el historial de mensajes.\n¿Estás seguro?")) return;
    try {
      const res = await api.cleanInbox();
      if (res.ok) {
        toast.success("Archivos e historial eliminados");
        fetchChats();
        if (selectedChat) fetchMessages(selectedChat.id);
      } else {
        toast.error("Error al limpiar");
      }
    } catch {
      toast.error("Error de conexión");
    }
  };

  const handleSendVoiceNote = async (audioBlob: Blob) => {
    if (!selectedChat) { toast.info("Selecciona un chat para enviar audio"); return; }
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("phoneNumber", selectedChat.id.replace("@c.us", "").replace("@g.us", ""));
      // Si hay mensaje citado, incluirlo para que el backend haga el reply
      if (replyingTo?.id) formData.append("quotedMsgId", replyingTo.id);
      const response = await fetch(`${apiBase || "http://localhost:3000"}/api/send-voice-note`, { method: "POST", body: formData });
      if (response.ok) {
        toast.success("✅ Nota de voz enviada");
        setReplyingTo(null);
      } else if (response.status === 503) toast.error("WhatsApp no está conectado");
      else {
        const data = await response.json().catch(() => ({}));
        toast.error("Error al enviar la nota de voz", { description: data?.error || `Error ${response.status}` });
      }
    } catch (error) {
      console.error("Error sending voice note:", error);
      toast.error("Error de conexión");
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleSendSticker = async (stickerUrl: string) => {
    if (!selectedChat) { toast.info("Selecciona un chat primero"); return; }
    try {
      const fullUrl = `${apiBase || "http://localhost:3000"}${stickerUrl}`;
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const file = new File([blob], stickerUrl.split("/").pop() || "sticker.png", { type: blob.type });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("phoneNumber", selectedChat.id.replace("@c.us", "").replace("@g.us", ""));
      formData.append("asSticker", "true");
      // Si hay mensaje citado, incluirlo para que el backend haga el reply
      if (replyingTo?.id) formData.append("quotedMsgId", replyingTo.id);
      const response = await fetch(`${apiBase || "http://localhost:3000"}/api/send-attachment`, { method: "POST", body: formData });
      if (response.ok) { toast.success("Sticker enviado"); setReplyingTo(null); }
      else toast.error("Error al enviar sticker");
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    }
  };

  const handleSelectEmoji = (emoji: string) => {
    if (textareaRef.current) {
      const s = textareaRef.current.selectionStart;
      const e = textareaRef.current.selectionEnd;
      const newText = replyText.substring(0, s) + emoji + replyText.substring(e);
      setReplyText(newText);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = s + emoji.length;
          textareaRef.current.selectionEnd = s + emoji.length;
          textareaRef.current.focus();
        }
      }, 0);
    } else {
      setReplyText((prev) => prev + emoji);
    }
  };

  // ─── JSX ────────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className={cn(
        "flex w-full rounded-xl border border-border/50 bg-card overflow-hidden shadow-md",
        "h-full"
      )}>

        {/* ══ COLUMNA 1: Sidebar izquierda ══ */}
        <div className={cn(
          "flex-shrink-0 transition-all duration-200",
          "md:w-[300px] md:block",
          showMobileChat ? "hidden md:block" : "w-full block"
        )}>
          <ConversationSidebar
            chats={chats}
            filteredChats={filteredChats}
            selectedChat={selectedChat}
            searchQuery={searchQuery}
            filterTab={filterTab}
            loadingChats={loadingChats}
            sseConnected={sseConnected}
            onSelectChat={handleSelectChat}
            onSearchChange={setSearchQuery}
            onFilterTabChange={setFilterTab}
            onRefresh={fetchChats}
            onCopyPath={handleCopyPath}
            onCleanInbox={handleCleanInbox}
            onMarkAllRead={handleMarkAllRead}
            onNewChat={handleNewChat}
            selectedLabel={selectedLabel}
            onLabelChange={setSelectedLabel}
            availableLabels={allLabels}
            archivedIds={archivedIds}
            onArchiveChat={handleArchiveChat}
            pinnedIds={pinnedIds}
            onPinChat={handlePinChat}
            onDeleteChat={handleDeleteChat}
            onMarkUnread={handleMarkUnreadFromSidebar}
            onLabelChat={handleLabelChatFromSidebar}
            onLabelDeleted={handleLabelDeleted}
            onLabelCreated={handleLabelCreated}
          />
        </div>

        {/* ══ COLUMNA 2: Panel central ══ */}
        {selectedChat ? (
          <div className={cn(
            "flex-1 min-w-0 transition-all duration-200",
            !showMobileChat && "hidden md:flex"
          )}>
            <ConversationView
              selectedChat={selectedChat}
              messages={messages}
              loadingMessages={loadingMessages}
              sseConnected={sseConnected}
              replyText={replyText}
              replyingTo={replyingTo}
              sending={sending}
              uploadingAudio={uploadingAudio}
              voiceRecordingActive={voiceRecordingActive}
              templateHighlight={templateHighlight}
              quickReplies={quickReplies}
              quickReplyProgressMap={quickReplyProgressMap}
              apiBase={apiBase || ""}
              showContactSidebar={showContactSidebar}
              onReplyTextChange={setReplyText}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              onSetReplyingTo={setReplyingTo}
              onBack={() => { setShowMobileChat(false); setSelectedChat(null); }}
              onMarkUnread={handleMarkUnread}
              onSendVoiceNote={handleSendVoiceNote}
              onVoiceRecordingModeChange={setVoiceRecordingActive}
              onSendSticker={handleSendSticker}
              onSelectEmoji={handleSelectEmoji}
              onLoadAttachment={(mediaPath: string, caption: string, type: "image" | "video" | "document") => setPendingQrAttachment({ mediaPath, caption, type })}
              onToggleContactSidebar={() => setShowContactSidebar((v) => !v)}
              onMediaReady={(messageId, mediaUrl) =>
                setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, mediaUrl, mediaDownloaded: true } : m))
              }
              contactRecord={contactRecord}
              allLabels={allLabels}
              onLabelsChange={handleLabelsChange}
              textareaRef={textareaRef}
              messagesEndRef={messagesEndRef}
              scrollContainerRef={scrollContainerRef}
              hasNewMessages={hasNewMessages}
              onScrollToBottom={scrollToBottom}
            />
          </div>
        ) : (
          <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-5 text-center p-8 bg-muted/10">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-emerald-500/10 shadow-sm">
              <MessageSquare className="size-7 text-emerald-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Selecciona una conversación</p>
              <p className="mt-1.5 text-sm text-muted-foreground max-w-[260px] leading-relaxed">
                Elige un chat de la lista para ver los mensajes y responder
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60 bg-muted/40 rounded-full px-3 py-1.5">
              <span className={cn(
                "size-1.5 rounded-full",
                sseConnected ? "bg-emerald-500" : "bg-rose-400"
              )} />
              {sseConnected ? "Tiempo real activo" : "Sin conexión en tiempo real"}
            </div>
          </div>
        )}

        {/* ══ COLUMNA 3: Sidebar derecha ══ */}
        {selectedChat && showContactSidebar && (
          <div className="hidden lg:block flex-shrink-0 w-[260px] border-l border-border/50">
            <ContactSidebar
              chat={selectedChat}
              messages={messages}
              externalRecord={contactRecord}
              externalLabels={allLabels}
              onContactRecordChange={(updated) => {
                // Sincronizar contactRecord en QuickSendTab para que el header
                // (chips bajo el nombre) y el InlineLabeler del header se actualicen
                setContactRecord(updated);
                // También actualizar chat.tags en la lista izquierda
                const tagDefs = (updated.crm?.tags || [])
                  .map((id) => allLabels.find((l) => l.id === id))
                  .filter(Boolean) as LabelDef[];
                setChats((prev) => prev.map((c) =>
                  c.id === selectedChat.id ? { ...c, tags: tagDefs } : c
                ));
              }}
              onChatUpdate={(patch) => {
                setChats((prev) => prev.map((c) =>
                  c.id === selectedChat.id ? { ...c, ...patch } : c
                ));
                if (patch.tags) {
                  setContactRecord((prev) => {
                    if (!prev) return prev;
                    const tagIds = patch.tags!.map((t) => t.id);
                    return { ...prev, crm: { ...prev.crm, tags: tagIds } };
                  });
                }
              }}
            />
          </div>
        )}
      </div>

      {/* ── Modal adjunto de QR ── */}
      {pendingQrAttachment && (
        <QrAttachmentModal
          apiBase={apiBase || "http://localhost:3000"}
          mediaPath={pendingQrAttachment.mediaPath}
          caption={pendingQrAttachment.caption}
          type={pendingQrAttachment.type}
          sending={sending}
          onSend={(caption) => sendQrAttachment(caption)}
          onClose={() => setPendingQrAttachment(null)}
        />
      )}

      <NewChatModal
        open={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onChatOpened={handleChatOpenedFromModal}
      />

    </TooltipProvider>
  );
}

// ─── Modal QrAttachment ───────────────────────────────────────────────────────

function QrAttachmentModal({
  apiBase, mediaPath, caption: initialCaption, type, sending, onSend, onClose,
}: {
  apiBase: string; mediaPath: string; caption: string;
  type: "image" | "video" | "document"; sending: boolean;
  onSend: (caption: string) => void; onClose: () => void;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const src = `${apiBase}${mediaPath}`;
  const filename = mediaPath.split("/").pop() ?? "archivo";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border bg-card p-5 shadow-2xl">
        <div className="flex flex-col gap-3 w-full">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">
              {type === "image" ? "Imagen" : type === "video" ? "Video" : "Documento"}
            </span>
            <button onClick={onClose} className="rounded-full p-1 hover:bg-muted">
              <X className="size-4" />
            </button>
          </div>
          {type === "image" && (
            <img
              src={src}
              alt="preview"
              className="max-h-48 w-full rounded-xl object-contain bg-muted"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          {type === "video" && (
            <video src={src} className="max-h-48 w-full rounded-xl bg-black" controls muted />
          )}
          {type === "document" && (
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
              <FileText className="size-5 text-blue-500 flex-shrink-0" />
              <p className="truncate text-sm font-medium">{filename}</p>
            </div>
          )}
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(caption); } }}
            rows={3}
            placeholder={"Agregar descripción (opcional)…\nPuedes usar *negrita*, _cursiva_ o ~tachado~"}
            className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
            autoFocus
          />
          <p className="text-xs text-muted-foreground px-1">
            Formato: *negrita* · _cursiva_ · ~tachado~
          </p>
          <button
            onClick={() => onSend(caption)}
            disabled={sending}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
          >
            {sending ? <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}