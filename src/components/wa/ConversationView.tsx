/**
 * ConversationView.tsx
 * Panel central — historial de mensajes y área de input, estilo Chatwoot.
 *
 * CAMBIOS:
 *   - InlineLabeler ahora soporta crear y eliminar etiquetas del catálogo global
 *     (igual que LabelSelector en ContactSidebar) — notifica al padre vía
 *     onLabelCreated / onLabelDeleted para sincronizar availableLabels.
 */

import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Send,
  Users,
  Loader2,
  ChevronLeft,
  ChevronDown,
  Circle,
  CircleDot,
  Reply,
  X,
  PanelRight,
  Tag,
  Check,
  Plus,
  Trash2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InboxChat, InboxMessage, LabelDef, ContactRecord } from "@/lib/wa-api";
import { contactsApi, labelsApi } from "@/lib/wa-api";
import { LabelChip } from "./ContactSidebar";
import { MessageBubble, BubbleSystem } from "./MessageBubble";
import { QuickReplyBar } from "./QuickReplyBar";
import { VoiceRecorderButton } from "./VoiceRecorderButton";
import { AttachMenu } from "./AttachMenu";
import { StickerPicker } from "./StickerPicker";
import type { QuickReply } from "@/lib/wa-api";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ConversationViewProps {
  selectedChat: InboxChat;
  messages: InboxMessage[];
  loadingMessages: boolean;
  sseConnected: boolean;
  replyText: string;
  replyingTo: InboxMessage | null;
  sending: boolean;
  uploadingAudio: boolean;
  voiceRecordingActive: boolean;
  templateHighlight: boolean;
  quickReplies: QuickReply[];
  quickReplyProgressMap: Map<string, { quickReplyId: string; step: number; total: number; done: boolean; error: string | null }>;
  apiBase: string;
  showContactSidebar: boolean;
  onReplyTextChange: (text: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSetReplyingTo: (msg: InboxMessage | null) => void;
  onBack: () => void;
  onMarkUnread: (chat: InboxChat) => void;
  onSendVoiceNote: (blob: Blob) => Promise<void>;
  onVoiceRecordingModeChange: (active: boolean) => void;
  onSendSticker: (url: string) => void;
  onSelectEmoji: (emoji: string) => void;
  onLoadAttachment: (mediaPath: string, caption: string, type: "image" | "video" | "document") => void;
  onToggleContactSidebar: () => void;
  onMediaReady: (messageId: string, mediaUrl: string) => void;
  /** Etiquetas del contacto para mostrar en el header */
  contactRecord?: ContactRecord | null;
  allLabels?: LabelDef[];
  /** Callback para propagar cambios de etiquetas desde el header a la lista de chats */
  onLabelsChange?: (tagIds: string[]) => void;
  /** Notifica al padre que se creó una etiqueta nueva */
  onLabelCreated?: (label: LabelDef) => void;
  /** Notifica al padre que se eliminó una etiqueta */
  onLabelDeleted?: (labelId: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  hasNewMessages?: boolean;
  onScrollToBottom?: () => void;
}

// ─── Paleta de colores (igual que ContactSidebar) ─────────────────────────────
const PALETTE = [
  { hex: "#22c55e", label: "Verde"    },
  { hex: "#3b82f6", label: "Azul"     },
  { hex: "#8b5cf6", label: "Morado"   },
  { hex: "#f97316", label: "Naranja"  },
  { hex: "#ef4444", label: "Rojo"     },
  { hex: "#f59e0b", label: "Amarillo" },
  { hex: "#6b7280", label: "Gris"     },
  { hex: "#d1d5db", label: "Plata"    },
  { hex: "#ec4899", label: "Rosa"     },
  { hex: "#06b6d4", label: "Cyan"     },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-emerald-500", "bg-blue-500", "bg-violet-500", "bg-rose-500",
    "bg-amber-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatLastMsg(msg: string, type: string): string {
  const icons: Record<string, string> = {
    image: "📷", video: "🎥", audio: "🎤", document: "📄", sticker: "🎭", ptt: "🎤",
  };
  const icon = icons[type];
  if (icon) return msg ? `${icon} ${msg}` : `${icon} ${type}`;
  return msg || "";
}

const SYSTEM_TYPES = ["e2e_notification", "gp2", "revoked", "pinned_message", "automated_greeting_message"];

// ─── ColorPicker (igual que ContactSidebar) ───────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-muted/30 rounded-lg border border-border/30">
      {PALETTE.map((p) => (
        <button
          key={p.hex}
          title={p.label}
          onClick={() => onChange(p.hex)}
          className={cn(
            "size-5 rounded-full border-2 transition-transform hover:scale-110",
            value === p.hex ? "border-foreground scale-110 shadow-sm" : "border-transparent"
          )}
          style={{ backgroundColor: p.hex }}
        />
      ))}
      <label className="relative size-5 cursor-pointer" title="Color personalizado">
        <span className="flex size-5 items-center justify-center rounded-full border-2 border-dashed border-border/60 bg-muted/50 text-[8px] font-bold text-muted-foreground">+</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>
    </div>
  );
}

// ─── InlineLabeler — selector multi-etiqueta con crear/eliminar ───────────────

function InlineLabeler({
  chatId,
  contactRecord,
  allLabels,
  onLabelsChange,
  onLabelCreated,
  onLabelDeleted,
}: {
  chatId: string;
  contactRecord: ContactRecord | null | undefined;
  allLabels: LabelDef[];
  onLabelsChange?: (tagIds: string[]) => void;
  onLabelCreated?: (label: LabelDef) => void;
  onLabelDeleted?: (labelId: string) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [saving, setSaving]     = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0].hex);
  const [savingNew, setSavingNew] = useState(false);
  const ref       = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cargar etiquetas del chat desde el servidor al abrir
  const loadCurrentTags = async () => {
    setLoadingTags(true);
    try {
      const record = await contactsApi.get(chatId);
      const tags = record?.crm?.tags ?? [];
      setSelected(tags);
    } catch {
      setSelected(contactRecord?.crm?.tags ?? []);
    } finally {
      setLoadingTags(false);
    }
  };

  const handleOpen = () => {
    if (!open) {
      setOpen(true);
      setSearchQuery("");
      setCreating(false);
      setNewName("");
      loadCurrentTags();
    } else {
      setOpen(false);
    }
  };

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Resetear al cambiar chat
  useEffect(() => {
    setSelected([]);
    setCreating(false);
    setNewName("");
  }, [chatId]);

  useEffect(() => {
    const tags = contactRecord?.crm?.tags ?? [];
    setSelected(tags);
  }, [contactRecord]);

  // Focus en el buscador al abrir
  useEffect(() => {
    if (open && !creating) setTimeout(() => searchRef.current?.focus(), 80);
  }, [open, creating]);

  const toggle = async (labelId: string) => {
    const prev = selected;
    const next = selected.includes(labelId)
      ? selected.filter((id) => id !== labelId)
      : [...selected, labelId];
    setSelected(next);
    setSaving(true);
    try {
      await contactsApi.save(chatId, { tags: next });
      onLabelsChange?.(next);
    } catch {
      setSelected(prev);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    // Evitar duplicado case-insensitive
    const dup = allLabels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      if (!selected.includes(dup.id)) await toggle(dup.id);
      setCreating(false);
      setNewName("");
      return;
    }
    setSavingNew(true);
    try {
      const created = await labelsApi.create(name, newColor);
      onLabelCreated?.(created);
      // Seleccionar automáticamente la nueva etiqueta
      const next = [...selected, created.id];
      setSelected(next);
      await contactsApi.save(chatId, { tags: next });
      onLabelsChange?.(next);
      setCreating(false);
      setNewName("");
      setNewColor(PALETTE[0].hex);
      toast.success(`Etiqueta "${name}" creada`);
    } catch {
      toast.error("No se pudo crear la etiqueta");
    } finally {
      setSavingNew(false);
    }
  };

  const handleDeleteLabel = async (e: React.MouseEvent, label: LabelDef) => {
    e.stopPropagation();
    try {
      await labelsApi.delete(label.id);
      onLabelDeleted?.(label.id);
      // Si el contacto la tenía asignada, quitarla
      if (selected.includes(label.id)) {
        const next = selected.filter((id) => id !== label.id);
        setSelected(next);
        await contactsApi.save(chatId, { tags: next });
        onLabelsChange?.(next);
      }
      toast.success(`Etiqueta "${label.name}" eliminada`);
    } catch {
      toast.error("No se pudo eliminar la etiqueta");
    }
  };

  const activeLabels = allLabels.filter((l) => selected.includes(l.id));
  const filteredLabels = allLabels.filter((l) =>
    l.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Botón trigger */}
      <button
        onClick={handleOpen}
        className={cn(
          "flex items-center gap-1 h-6 px-2 rounded-full border text-[10px] font-medium transition-all duration-150",
          open || selected.length > 0
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-border/50 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/60"
        )}
        title="Etiquetar chat"
      >
        {saving ? (
          <span className="size-3 rounded-full border border-current border-t-transparent animate-spin flex-shrink-0" />
        ) : (
          <Tag className="size-3 flex-shrink-0" />
        )}
        {activeLabels.length > 0 ? (
          <span className="flex items-center gap-0.5">
            {activeLabels.slice(0, 2).map((l) => (
              <span
                key={l.id}
                className="size-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: l.color }}
                title={l.name}
              />
            ))}
            {activeLabels.length > 2 && (
              <span className="text-[9px] leading-none">+{activeLabels.length - 2}</span>
            )}
          </span>
        ) : (
          <span>Etiquetar</span>
        )}
        <ChevronDown
          className={cn("size-2.5 transition-transform flex-shrink-0", open && "rotate-180")}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[240px] rounded-xl border border-border/60 bg-popover shadow-2xl overflow-hidden">

          {!creating ? (
            <>
              {/* Buscador */}
              <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border/30 bg-muted/20">
                <Search className="size-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar etiqueta..."
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                  onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); } }}
                />
              </div>

              {/* Lista de etiquetas */}
              {loadingTags ? (
                <div className="flex items-center justify-center py-5 gap-2">
                  <Loader2 className="size-3.5 text-muted-foreground animate-spin" />
                  <span className="text-[11px] text-muted-foreground">Cargando...</span>
                </div>
              ) : filteredLabels.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-muted-foreground/60 text-center italic">
                  {searchQuery ? "Sin resultados" : "No hay etiquetas creadas"}
                </p>
              ) : (
                <div className="py-1 max-h-52 overflow-y-auto">
                  {filteredLabels.map((label) => {
                    const isChecked = selected.includes(label.id);
                    return (
                      <div key={label.id} className="flex items-center group/row hover:bg-muted/40 transition-colors">
                        <button
                          onClick={() => toggle(label.id)}
                          className="flex flex-1 items-center gap-2.5 px-3 py-2 text-xs group"
                        >
                          {/* Checkbox visual */}
                          <span className={cn(
                            "flex-shrink-0 size-4 rounded border transition-all duration-100 flex items-center justify-center",
                            isChecked
                              ? "bg-emerald-500 border-emerald-500"
                              : "border-border/60 bg-background group-hover:border-emerald-400"
                          )}>
                            {isChecked && <Check className="size-2.5 text-white" strokeWidth={3} />}
                          </span>
                          {/* Dot de color */}
                          <span
                            className="size-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: label.color }}
                          />
                          {/* Nombre */}
                          <span className={cn(
                            "flex-1 text-left truncate",
                            isChecked ? "text-foreground font-medium" : "text-foreground/80"
                          )}>
                            {label.name}
                          </span>
                        </button>
                        {/* Botón eliminar del catálogo — visible en hover */}
                        <button
                          onClick={(e) => handleDeleteLabel(e, label)}
                          className="mr-2 p-1 rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-rose-100 dark:hover:bg-rose-950/40 text-muted-foreground hover:text-rose-500"
                          title={`Eliminar etiqueta "${label.name}"`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Crear nueva etiqueta */}
              <div className="border-t border-border/40">
                <button
                  onClick={() => { setCreating(true); setNewName(searchQuery); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/5 transition-colors"
                >
                  <Plus className="size-3.5" />
                  {searchQuery ? `Crear "${searchQuery}"` : "Crear nueva etiqueta"}
                </button>
              </div>

              {/* Footer: etiquetas activas */}
              {selected.length > 0 && !loadingTags && (
                <div className="px-3 py-2 border-t border-border/30 bg-muted/20">
                  <p className="text-[10px] text-muted-foreground/70 leading-tight">
                    {selected.length} etiqueta{selected.length !== 1 ? "s" : ""} aplicada{selected.length !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </>
          ) : (
            /* Formulario crear etiqueta */
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <button
                  onClick={() => { setCreating(false); setNewName(""); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className="size-3.5 rotate-90" />
                </button>
                <span className="text-[11px] font-semibold text-foreground">Nueva etiqueta</span>
              </div>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                placeholder="Nombre de la etiqueta..."
                className="w-full rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-[11px] outline-none focus:ring-1 focus:ring-emerald-500/40"
              />
              <ColorPicker value={newColor} onChange={setNewColor} />
              <div className="flex gap-1.5">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || savingNew}
                  className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {savingNew ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  Crear
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName(""); }}
                  className="flex items-center justify-center rounded-lg border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ConversationView({
  selectedChat,
  messages,
  loadingMessages,
  sseConnected,
  replyText,
  replyingTo,
  sending,
  uploadingAudio,
  voiceRecordingActive,
  templateHighlight,
  quickReplies,
  quickReplyProgressMap,
  apiBase,
  showContactSidebar,
  onReplyTextChange,
  onSend,
  onKeyDown,
  onSetReplyingTo,
  onBack,
  onMarkUnread,
  onSendVoiceNote,
  onVoiceRecordingModeChange,
  onSendSticker,
  onSelectEmoji,
  onLoadAttachment,
  onToggleContactSidebar,
  onMediaReady,
  contactRecord,
  allLabels = [],
  onLabelsChange,
  onLabelCreated,
  onLabelDeleted,
  textareaRef,
  messagesEndRef,
  scrollContainerRef,
  hasNewMessages = false,
  onScrollToBottom,
}: ConversationViewProps) {
  const rawId = selectedChat.id;
  const resolvedPhone = contactRecord?.wa?.phone;
  const phoneNumber = (() => {
    if (resolvedPhone && resolvedPhone !== "Número no disponible" && resolvedPhone !== "Pendiente de sincronización") {
      return resolvedPhone;
    }
    if (rawId.endsWith("@c.us")) return rawId.replace("@c.us", "");
    if (rawId.endsWith("@g.us")) return rawId.replace("@g.us", "");
    return resolvedPhone || "Número no disponible";
  })();

  return (
    <div className="flex flex-col h-full min-w-0 bg-background">

      {/* ── Header del chat ── */}
      <header className="flex-shrink-0 flex items-center gap-3 border-b border-border/50 bg-background px-4 py-3 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">

        {/* Botón volver (mobile) */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 md:hidden rounded-lg flex-shrink-0"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
        </Button>

        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className={cn(
            "flex size-9 items-center justify-center rounded-xl text-white text-xs font-bold shadow-sm",
            getAvatarColor(selectedChat.name)
          )}>
            {selectedChat.isGroup ? <Users className="size-4" /> : getInitials(selectedChat.name)}
          </div>
          {sseConnected && !selectedChat.isGroup && (
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 border-2 border-background shadow-sm" />
          )}
        </div>

        {/* Nombre + número + etiquetas */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-sm leading-tight text-foreground">{selectedChat.name}</p>
          <p className="text-[11px] text-muted-foreground truncate leading-tight">
            {selectedChat.isGroup ? `Grupo · ${phoneNumber}` : phoneNumber}
          </p>
          {/* Etiquetas del contacto bajo el nombre */}
          {(() => {
            const tags = contactRecord?.crm?.tags || [];
            const chips = tags
              .map((id) => allLabels.find((l) => l.id === id))
              .filter(Boolean) as LabelDef[];
            if (chips.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1 mt-1">
                {chips.map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))}
              </div>
            );
          })()}
        </div>

        {/* Acciones del header */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Badge Activo */}
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Activo
          </span>

          {/* Botón de etiquetas inline — ahora con crear/eliminar */}
          <InlineLabeler
            chatId={selectedChat.id}
            contactRecord={contactRecord}
            allLabels={allLabels}
            onLabelsChange={onLabelsChange}
            onLabelCreated={onLabelCreated}
            onLabelDeleted={onLabelDeleted}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => onMarkUnread(selectedChat)}
              >
                <CircleDot className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Marcar como no leído</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-8 rounded-lg transition-colors",
                  showContactSidebar
                    ? "text-emerald-600 bg-emerald-500/10"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={onToggleContactSidebar}
              >
                <PanelRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showContactSidebar ? "Ocultar panel" : "Info del contacto"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ── Área de mensajes ── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          className="h-full overflow-y-auto"
        >
          <div
            className="chat-messages-bg flex flex-col gap-0.5 px-4 py-4"
          >
          {loadingMessages ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="size-6 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Cargando mensajes...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60">
                <Circle className="size-6 text-muted-foreground/30" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Sin mensajes aún</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Comienza la conversación enviando un mensaje</p>
              </div>
            </div>
          ) : (
            messages.map((msg, i) => {
              const prevMsg = messages[i - 1];
              const nextMsg = messages[i + 1];
              const showDate = !prevMsg || new Date(prevMsg.timestamp * 1000).toDateString() !== new Date(msg.timestamp * 1000).toDateString();
              const isFirstInGroup = !prevMsg || prevMsg.fromMe !== msg.fromMe;
              const isLastInGroup = !nextMsg || nextMsg.fromMe !== msg.fromMe;

              if (SYSTEM_TYPES.includes(msg.type)) {
                return (
                  <div key={msg.id || i}>
                    {showDate && <DateDivider timestamp={msg.timestamp} />}
                    <BubbleSystem msg={msg} />
                  </div>
                );
              }

              return (
                <div key={msg.id || i}>
                  {showDate && <DateDivider timestamp={msg.timestamp} />}

                  <div className={cn(
                    "flex items-end gap-1.5 group/msg",
                    msg.fromMe ? "justify-end" : "justify-start",
                    isLastInGroup ? "mb-2" : "mb-0.5"
                  )}>
                    {!msg.fromMe && (
                      <div className="flex-shrink-0 w-6">
                        {isLastInGroup ? (
                          <div className={cn(
                            "flex size-6 items-center justify-center rounded-full text-white text-[9px] font-bold mb-0.5 shadow-sm",
                            getAvatarColor(selectedChat.name)
                          )}>
                            {getInitials(selectedChat.name)}
                          </div>
                        ) : null}
                      </div>
                    )}

                    <div className={cn(
                      "flex flex-col min-w-0 relative w-fit",
                      (msg.type === "image" || msg.type === "video")
                        ? "max-w-[330px]"
                        : "max-w-[72%]"
                    )}>
                      {/* Botón reply en hover */}
                      <div className={cn(
                        "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10",
                        msg.fromMe ? "-left-8" : "-right-8"
                      )}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => { onSetReplyingTo(msg); setTimeout(() => textareaRef.current?.focus(), 50); }}
                              className="flex size-6 items-center justify-center rounded-full bg-background border border-border/60 shadow-sm hover:bg-muted transition-colors"
                            >
                              <Reply className="size-3 text-muted-foreground" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Responder</TooltipContent>
                        </Tooltip>
                      </div>

                      {selectedChat.isGroup && !msg.fromMe && isFirstInGroup && (
                        <p className="text-[10px] font-semibold text-emerald-600 mb-0.5 ml-1">{msg.senderName}</p>
                      )}

                      <div className={cn(
                        "overflow-hidden text-sm shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                        msg.fromMe
                          ? "bg-emerald-500 text-white dark:bg-[#005c4b] dark:text-white"
                          : "bg-card border border-border/50 text-foreground dark:bg-[#202c33] dark:border-0 dark:text-white",
                        msg.fromMe
                          ? cn("rounded-2xl", isFirstInGroup && "rounded-tr-md", isLastInGroup && "rounded-br-md")
                          : cn("rounded-2xl", isFirstInGroup && "rounded-tl-md", isLastInGroup && "rounded-bl-md"),
                        msg.type === "sticker" && "bg-transparent border-0 shadow-none"
                      )}>
                        {msg.type !== "sticker" ? (
                          <div className={cn(
                            (msg.type === "image" || msg.type === "video") ? "pt-0" : "px-3 pt-2"
                          )}>
                            <MessageBubble msg={msg} apiBase={apiBase} fromMe={msg.fromMe} onMediaReady={onMediaReady} />
                          </div>
                        ) : (
                          <MessageBubble msg={msg} apiBase={apiBase} fromMe={msg.fromMe} onMediaReady={onMediaReady} />
                        )}

                        {msg.type !== "sticker" && (
                          <div className={cn(
                            "flex items-center justify-end gap-1 px-3 pb-1.5",
                            msg.fromMe ? "pt-0" : "pt-0.5"
                          )}>
                            <span className={cn(
                              "text-[10px] leading-none",
                              msg.fromMe ? "text-white/70" : "text-muted-foreground"
                            )}>
                              {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {msg.fromMe && (
                              <span className={cn(
                                "text-[10px] leading-none",
                                msg.read ? "text-white" : "text-white/60"
                              )}>
                                {msg.read ? "✓✓" : "✓"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ── Indicador de mensajes nuevos ── */}
        {hasNewMessages && onScrollToBottom && (
          <button
            onClick={onScrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-emerald-600 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <ChevronDown className="size-3.5" />
            Nuevos mensajes
          </button>
        )}
      </div>

      {/* ── Quick Reply Bar ── */}
      {selectedChat && (
        <QuickReplyBar
          chatId={selectedChat.id}
          quickReplies={quickReplies}
          progress={quickReplyProgressMap.get(selectedChat.id) ?? null}
          onLoadTemplate={(text: string) => onReplyTextChange(text)}
          onLoadAttachment={onLoadAttachment}
        />
      )}

      {/* ── Input area ── */}
      <div className="flex-shrink-0 border-t border-border/50 bg-background">

        {replyingTo && (
          <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 border-b border-border/30">
            <div className="w-0.5 h-8 rounded-full bg-emerald-500 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-emerald-600 mb-0.5">
                {replyingTo.fromMe ? "Tú" : selectedChat.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {replyingTo.type !== "text"
                  ? formatLastMsg(replyingTo.body, replyingTo.type)
                  : replyingTo.body.slice(0, 80)}
              </p>
            </div>
            <button
              onClick={() => onSetReplyingTo(null)}
              className="flex-shrink-0 size-6 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
            >
              <X className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        )}

        <div className="px-3 py-2.5">
          <div className="flex items-end gap-2">
            <VoiceRecorderButton
              onSend={onSendVoiceNote}
              disabled={!selectedChat || sending || uploadingAudio}
              onRecordingModeChange={onVoiceRecordingModeChange}
            />

            {!voiceRecordingActive && (
              <>
                <StickerPicker
                  onSelectSticker={onSendSticker}
                  onSelectEmoji={onSelectEmoji}
                  disabled={sending}
                />

                <AttachMenu
                  chatId={selectedChat.id}
                  phoneNumber={selectedChat.id}
                  disabled={sending || uploadingAudio}
                  quotedMsgId={replyingTo?.id}
                />

                <Textarea
                  ref={textareaRef}
                  value={replyText}
                  onChange={(e) => onReplyTextChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Escribe un mensaje…"
                  className={cn(
                    "min-h-[40px] max-h-28 flex-1 resize-none rounded-2xl text-sm border-border/50 bg-muted/30 py-2.5 px-3.5 overflow-y-auto transition-all duration-200",
                    "focus-visible:ring-1 focus-visible:ring-emerald-500/60 focus-visible:border-emerald-500/40",
                    templateHighlight && "ring-2 ring-emerald-400 border-emerald-400"
                  )}
                  rows={2}
                />

                {replyText.trim() && (
                  <Button
                    onClick={onSend}
                    disabled={sending}
                    size="icon"
                    className="size-10 flex-shrink-0 rounded-full bg-emerald-500 hover:bg-emerald-600 shadow-md transition-all hover:scale-105 active:scale-95"
                  >
                    {sending
                      ? <Loader2 className="size-4 animate-spin" />
                      : <Send className="size-4" />}
                  </Button>
                )}
              </>
            )}
          </div>

          {!voiceRecordingActive && (
            <p className="mt-1.5 text-[10px] text-muted-foreground/50">
              Enter para enviar · Shift+Enter nueva línea · Esc cancelar respuesta
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DateDivider ──────────────────────────────────────────────────────────────

function DateDivider({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex items-center justify-center my-4 gap-3">
      <div className="flex-1 h-px bg-border/40" />
      <span className="flex-shrink-0 rounded-full bg-background border border-border/50 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
        {new Date(timestamp * 1000).toLocaleDateString("es-CO", {
          weekday: "long", day: "numeric", month: "long",
        })}
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}