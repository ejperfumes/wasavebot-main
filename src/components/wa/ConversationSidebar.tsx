/**
 * ConversationSidebar.tsx
 * Panel izquierdo — lista de conversaciones estilo Chatwoot.
 * Solo presentación + interacción con la lista de chats.
 * Sin lógica de backend, sin modificación de mensajes.
 *
 * CAMBIOS:
 *   - LabelDropdown ahora soporta crear y eliminar etiquetas del catálogo global
 *     (igual que LabelSelector en ContactSidebar) — se notifica al padre vía
 *     onLabelCreated / onLabelDeleted para que sincronice availableLabels.
 */

import { useRef, useState, useEffect, useCallback, useMemo, memo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  MessageSquare,
  Users,
  RefreshCw,
  Loader2,
  Search,
  FolderOpen,
  Trash2,
  InboxIcon,
  Hash,
  Circle,
  CheckCheck,
  SquarePen,
  Tag,
  ChevronDown,
  X,
  Archive,
  ArchiveRestore,
  MoreVertical,
  Pin,
  PinOff,
  BellOff,
  CircleDot,
  Trash,
  Plus,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InboxChat, LabelDef } from "@/lib/wa-api";
import { getProfilePic, labelsApi } from "@/lib/wa-api";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type FilterTab = "all" | "unread" | "groups" | "archived";

interface ConversationSidebarProps {
  chats: InboxChat[];
  filteredChats: InboxChat[];
  selectedChat: InboxChat | null;
  searchQuery: string;
  filterTab: FilterTab;
  loadingChats: boolean;
  sseConnected: boolean;
  onSelectChat: (chat: InboxChat) => void;
  onSearchChange: (query: string) => void;
  onFilterTabChange: (tab: FilterTab) => void;
  onRefresh: () => void;
  onCopyPath: () => void;
  onCleanInbox: () => void;
  onMarkAllRead: () => void;
  onNewChat: () => void;
  // ── Filtro por etiqueta ──
  selectedLabel: string | null;
  onLabelChange: (labelId: string | null) => void;
  availableLabels: LabelDef[];
  /** Notifica al padre que se creó una etiqueta nueva para que sincronice el catálogo */
  onLabelCreated?: (label: LabelDef) => void;
  /** Notifica al padre que se eliminó una etiqueta para que sincronice el catálogo */
  onLabelDeleted?: (labelId: string) => void;
  // ── Archivados ──
  archivedIds: Set<string>;
  onArchiveChat: (chatId: string) => void;
  // ── Fijados ──
  pinnedIds: string[];
  onPinChat: (chatId: string) => void;
  // ── Acciones individuales ──
  onDeleteChat: (chatId: string) => void;
  onMarkUnread: (chat: InboxChat) => void;
  onLabelChat: (chat: InboxChat, tagIds: string[]) => void;
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

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isYesterday) return "Ayer";
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function formatLastMsg(msg: import("@/lib/wa-api").InboxMessage | string | undefined, type: string | undefined): string {
  const msgStr = typeof msg === "string" ? msg : msg?.body ?? "";
  const typeStr = type ?? "";
  const icons: Record<string, string> = {
    image: "📷", video: "🎥", audio: "🎤", document: "📄", sticker: "🎭", ptt: "🎤",
  };
  const icon = icons[typeStr];
  if (icon) {
    return msgStr
      ? `${icon} ${msgStr}`
      : `${icon} ${
          typeStr === "image" ? "Imagen"
          : typeStr === "video" ? "Video"
          : typeStr === "audio" || typeStr === "ptt" ? "Audio"
          : typeStr === "document" ? "Documento"
          : typeStr === "sticker" ? "Sticker"
          : "Archivo"
        }`;
  }
  return msgStr || "";
}

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

// ─── FILTER TABS config ───────────────────────────────────────────────────────

const FILTER_TABS: { id: FilterTab; label: string; icon: React.ElementType }[] = [
  { id: "all",      label: "Todos",      icon: InboxIcon  },
  { id: "unread",   label: "No leídos",  icon: Circle     },
  { id: "groups",   label: "Grupos",     icon: Hash       },
  { id: "archived", label: "Archivados", icon: Archive    },
];

// ─── ChatAvatar ───────────────────────────────────────────────────────────────

function extractPicUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  const obj = raw as any;
  return obj.img || obj.eurl || obj.imgFull || obj.url || null;
}

function ChatAvatar({ chat }: { chat: InboxChat }) {
  const [picUrl, setPicUrl]       = useState<string | null>(extractPicUrl(chat.profilePicUrl));
  const [imgFailed, setImgFailed] = useState(false);
  const [fetched, setFetched]     = useState(!!chat.profilePicUrl);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const incoming = extractPicUrl(chat.profilePicUrl);
    if (incoming && incoming !== picUrl) {
      setPicUrl(incoming);
      setImgFailed(false);
      setFetched(true);
    }
  }, [chat.profilePicUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPic = useCallback(() => {
    if (fetched || chat.isGroup) return;
    setFetched(true);
    getProfilePic(chat.id)
      .then(({ url }) => { if (url) { setPicUrl(url); setImgFailed(false); } })
      .catch(() => {});
  }, [chat.id, chat.isGroup, fetched]);

  useEffect(() => {
    const el = ref.current;
    if (!el || chat.isGroup || fetched) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { fetchPic(); obs.disconnect(); } },
      { rootMargin: "100px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetchPic, chat.isGroup, fetched]);

  const showImg = !!picUrl && !imgFailed && !chat.isGroup;

  return (
    <div ref={ref} className="flex-shrink-0">
      {showImg ? (
        <img
          src={picUrl!}
          alt={chat.name}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="size-10 rounded-full object-cover shadow-sm transition-transform group-hover:scale-105"
        />
      ) : (
        <div className={cn(
          "flex size-10 items-center justify-center rounded-full text-white text-sm font-semibold shadow-sm transition-transform group-hover:scale-105",
          getAvatarColor(chat.name)
        )}>
          {chat.isGroup ? <Users className="size-4.5" /> : getInitials(chat.name)}
        </div>
      )}
    </div>
  );
}

// ─── LabelDots ────────────────────────────────────────────────────────────────

function LabelDots({ tags }: { tags?: LabelDef[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5 ml-1 flex-shrink-0">
      {tags.slice(0, 4).map((tag) => (
        <span
          key={tag.id}
          className="size-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: tag.color }}
          title={tag.name}
        />
      ))}
      {tags.length > 4 && (
        <span className="text-[9px] text-muted-foreground leading-none">+{tags.length - 4}</span>
      )}
    </span>
  );
}

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

// ─── LabelDropdown — selector con crear y eliminar ────────────────────────────
function LabelDropdown({
  labels,
  selectedLabel,
  onLabelChange,
  onLabelCreated,
  onLabelDeleted,
}: {
  labels: LabelDef[];
  selectedLabel: string | null;
  onLabelChange: (id: string | null) => void;
  onLabelCreated?: (label: LabelDef) => void;
  onLabelDeleted?: (labelId: string) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [search, setSearch]     = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0].hex);
  const [saving, setSaving]     = useState(false);
  const ref                     = useRef<HTMLDivElement>(null);
  const searchRef               = useRef<HTMLInputElement>(null);

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus en búsqueda al abrir
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const filtered = labels.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  const active = labels.find((l) => l.id === selectedLabel);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    // Evitar duplicado case-insensitive
    const dup = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      onLabelChange(dup.id);
      setCreating(false);
      setNewName("");
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const created = await labelsApi.create(name, newColor);
      onLabelCreated?.(created);
      setCreating(false);
      setNewName("");
      setNewColor(PALETTE[0].hex);
      setSearch("");
      // NO seleccionar como filtro — solo agregarla al catálogo y cerrar
      setOpen(false);
      toast.success(`Etiqueta "${name}" creada`);
    } catch {
      toast.error("No se pudo crear la etiqueta");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, label: LabelDef) => {
    e.stopPropagation();
    try {
      await labelsApi.delete(label.id);
      onLabelDeleted?.(label.id);
      // Si era la etiqueta activa, limpiar filtro
      if (selectedLabel === label.id) onLabelChange(null);
      toast.success(`Etiqueta "${label.name}" eliminada`);
    } catch {
      toast.error("No se pudo eliminar la etiqueta");
    }
  };

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium border transition-all duration-150",
          selectedLabel
            ? "border-transparent text-white shadow-sm"
            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border bg-muted/30 hover:bg-muted/60"
        )}
        style={active ? { backgroundColor: active.color, borderColor: active.color } : {}}
        title="Filtrar por etiqueta"
      >
        {active ? (
          <>
            <span className="size-2 rounded-full bg-white/80 flex-shrink-0" />
            <span className="max-w-[80px] truncate">{active.name}</span>
            <span
              className="ml-0.5 opacity-70 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onLabelChange(null); }}
            >
              <X className="size-3" />
            </span>
          </>
        ) : (
          <>
            <Tag className="size-3 flex-shrink-0" />
            <span>Etiqueta</span>
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[220px] rounded-xl border border-border/60 bg-popover shadow-2xl overflow-hidden">

          {/* Búsqueda */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
            <Search className="size-3.5 text-muted-foreground flex-shrink-0" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar etiqueta..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
              onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setSearch(""); } }}
            />
          </div>

          {/* Opción "Todas" */}
          {!creating && (
            <button
              onClick={() => { onLabelChange(null); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/60",
                !selectedLabel ? "font-semibold text-foreground bg-muted/40" : "text-muted-foreground"
              )}
            >
              <InboxIcon className="size-3.5 flex-shrink-0" />
              Todas las etiquetas
            </button>
          )}

          {/* Lista de etiquetas */}
          {!creating && (
            <div className="max-h-44 overflow-y-auto border-t border-border/30">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-foreground/60 text-center italic">
                  {search ? "No encontrado" : "Sin etiquetas creadas"}
                </p>
              ) : (
                filtered.map((label) => (
                  <div key={label.id} className="flex items-center group/row hover:bg-muted/40 transition-colors">
                    <button
                      onClick={() => { onLabelChange(label.id); setOpen(false); setSearch(""); }}
                      className={cn(
                        "flex flex-1 items-center gap-2.5 px-3 py-2 text-left text-xs",
                        selectedLabel === label.id && "bg-muted/20"
                      )}
                    >
                      {/* Dot de color */}
                      <span
                        className="size-2.5 rounded-full flex-shrink-0 shadow-sm"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="truncate flex-1 font-medium text-foreground">{label.name}</span>
                      {selectedLabel === label.id && (
                        <Check className="size-3 text-emerald-600 flex-shrink-0" />
                      )}
                    </button>
                    {/* Botón eliminar — visible en hover */}
                    <button
                      onClick={(e) => handleDelete(e, label)}
                      className="mr-2 p-1 rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-rose-100 dark:hover:bg-rose-950/40 text-muted-foreground hover:text-rose-500"
                      title={`Eliminar etiqueta "${label.name}"`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Crear nueva etiqueta */}
          {!creating ? (
            <div className="border-t border-border/40">
              <button
                onClick={() => { setCreating(true); setNewName(search); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/5 transition-colors"
              >
                <Plus className="size-3.5" />
                {search ? `Crear "${search}"` : "Crear nueva etiqueta"}
              </button>
            </div>
          ) : (
            <div className="border-t border-border/40 p-3 space-y-2">
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
                  disabled={!newName.trim() || saving}
                  className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
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

// ─── ChatContextMenu — menú contextual por chat ───────────────────────────────

interface ChatContextMenuProps {
  chat: InboxChat;
  isArchived: boolean;
  isPinned: boolean;
  availableLabels: LabelDef[];
  onLabelCreated?: (label: LabelDef) => void;
  onLabelDeleted?: (labelId: string) => void;
  onArchive: () => void;
  onPin: () => void;
  onMarkUnread: () => void;
  onLabelChat: (tagIds: string[]) => void;
  onDelete: () => void;
  onClose: () => void;
}

function ChatContextMenu({
  chat,
  isArchived,
  isPinned,
  availableLabels,
  onLabelCreated,
  onLabelDeleted,
  onArchive,
  onPin,
  onMarkUnread,
  onLabelChat,
  onDelete,
  onClose,
}: ChatContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [creating, setCreating]               = useState(false);
  const [newName, setNewName]                 = useState("");
  const [newColor, setNewColor]               = useState(PALETTE[0].hex);
  const [saving, setSaving]                   = useState(false);
  const currentTagIds = (chat.tags || []).map((t) => t.id);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(currentTagIds);

  // Cerrar al click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleTagToggle = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const handleSaveLabels = () => {
    onLabelChat(selectedTagIds);
    setShowLabelPicker(false);
    onClose();
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const dup = availableLabels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      if (!selectedTagIds.includes(dup.id)) {
        setSelectedTagIds((prev) => [...prev, dup.id]);
      }
      setCreating(false);
      setNewName("");
      return;
    }
    setSaving(true);
    try {
      const created = await labelsApi.create(name, newColor);
      onLabelCreated?.(created);
      setSelectedTagIds((prev) => [...prev, created.id]);
      setCreating(false);
      setNewName("");
      setNewColor(PALETTE[0].hex);
      toast.success(`Etiqueta "${name}" creada`);
    } catch {
      toast.error("No se pudo crear la etiqueta");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLabel = async (e: React.MouseEvent, label: LabelDef) => {
    e.stopPropagation();
    try {
      await labelsApi.delete(label.id);
      onLabelDeleted?.(label.id);
      setSelectedTagIds((prev) => prev.filter((id) => id !== label.id));
      toast.success(`Etiqueta "${label.name}" eliminada`);
    } catch {
      toast.error("No se pudo eliminar la etiqueta");
    }
  };

  return (
    <div
      ref={ref}
      className="absolute right-1 top-8 z-50 min-w-[200px] rounded-xl border border-border/60 bg-popover shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {!showLabelPicker ? (
        <div className="py-1">
          {/* Archivar / Desarchivar */}
          <button
            onClick={() => { onArchive(); onClose(); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-xs text-foreground/90 hover:bg-muted/60 transition-colors"
          >
            {isArchived
              ? <ArchiveRestore className="size-3.5 text-amber-500 flex-shrink-0" />
              : <Archive className="size-3.5 text-muted-foreground flex-shrink-0" />}
            {isArchived ? "Desarchivar chat" : "Archivar chat"}
          </button>

          {/* Fijar / Desfijar */}
          <button
            onClick={() => { onPin(); onClose(); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-xs text-foreground/90 hover:bg-muted/60 transition-colors"
          >
            {isPinned
              ? <PinOff className="size-3.5 text-emerald-500 flex-shrink-0" />
              : <Pin className="size-3.5 text-muted-foreground flex-shrink-0" />}
            {isPinned ? "Desfijar chat" : "Fijar chat"}
          </button>

          {/* Marcar como no leído */}
          <button
            onClick={() => { onMarkUnread(); onClose(); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-xs text-foreground/90 hover:bg-muted/60 transition-colors"
          >
            <CircleDot className="size-3.5 text-muted-foreground flex-shrink-0" />
            Marcar como no leído
          </button>

          {/* Etiquetar chat */}
          <button
            onClick={() => setShowLabelPicker(true)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-xs text-foreground/90 hover:bg-muted/60 transition-colors"
          >
            <Tag className="size-3.5 text-muted-foreground flex-shrink-0" />
            Etiquetar chat
            <ChevronDown className="size-3 ml-auto -rotate-90 text-muted-foreground" />
          </button>

          {/* Separador */}
          <div className="my-1 border-t border-border/40" />

          {/* Eliminar chat */}
          <button
            onClick={() => { onClose(); onDelete(); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <Trash className="size-3.5 flex-shrink-0" />
            Eliminar chat
          </button>
        </div>
      ) : (
        /* Sub-panel de etiquetas con crear/eliminar */
        <div className="py-1">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40">
            <button
              onClick={() => { setShowLabelPicker(false); setCreating(false); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3.5 rotate-90" />
            </button>
            <span className="text-[11px] font-semibold text-foreground">Etiquetar chat</span>
          </div>

          {!creating ? (
            <>
              <div className="max-h-[200px] overflow-y-auto">
                {availableLabels.length === 0 ? (
                  <p className="px-3 py-3 text-[11px] text-muted-foreground/60 text-center italic">
                    Sin etiquetas creadas
                  </p>
                ) : (
                  availableLabels.map((label) => {
                    const isSelected = selectedTagIds.includes(label.id);
                    return (
                      <div key={label.id} className="flex items-center group/row hover:bg-muted/40 transition-colors">
                        <button
                          onClick={() => handleTagToggle(label.id)}
                          className={cn(
                            "flex flex-1 items-center gap-2.5 px-4 py-2 text-xs transition-colors",
                            isSelected ? "bg-muted/20" : "text-foreground/80"
                          )}
                        >
                          {/* Checkbox visual */}
                          <span className={cn(
                            "flex-shrink-0 size-4 rounded border transition-all flex items-center justify-center",
                            isSelected ? "border-emerald-500 bg-emerald-500" : "border-border/60 bg-background"
                          )}>
                            {isSelected && <Check className="size-2.5 text-white" strokeWidth={3} />}
                          </span>
                          <span
                            className="size-2.5 rounded-full flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: label.color }}
                          />
                          <span className="truncate flex-1 text-left">{label.name}</span>
                        </button>
                        {/* Botón eliminar */}
                        <button
                          onClick={(e) => handleDeleteLabel(e, label)}
                          className="mr-2 p-1 rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-rose-100 dark:hover:bg-rose-950/40 text-muted-foreground hover:text-rose-500"
                          title={`Eliminar etiqueta "${label.name}"`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Crear nueva etiqueta */}
              <div className="border-t border-border/40">
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/5 transition-colors"
                >
                  <Plus className="size-3.5" />
                  Crear nueva etiqueta
                </button>
              </div>

              <div className="border-t border-border/40 px-3 py-2">
                <button
                  onClick={handleSaveLabels}
                  className="w-full rounded-lg bg-emerald-500 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-600 transition-colors"
                >
                  Guardar etiquetas
                </button>
              </div>
            </>
          ) : (
            /* Formulario crear etiqueta */
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <button
                  onClick={() => { setCreating(false); setNewName(""); }}
                  className="text-muted-foreground hover:text-foreground"
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
                  disabled={!newName.trim() || saving}
                  className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
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


// ── ChatRow: ítem de chat memoizado — solo re-renderiza si sus props cambian ──
// Esto evita que los 493+ chats se vuelvan a pintar cuando llega un nuevo
// mensaje SSE y solo cambia 1 chat.
const ChatRow = memo(function ChatRow({
  chat, isSelected, hasUnread, isArchived, isPinned, isMenuOpen,
  filterTab, availableLabels,
  onSelectChat, onArchiveChat, onPinChat, onMarkUnread, onLabelChat,
  onLabelCreated, onLabelDeleted,
  setOpenMenuId, setDeletingChatId,
}: {
  chat: InboxChat;
  isSelected: boolean;
  hasUnread: boolean;
  isArchived: boolean;
  isPinned: boolean;
  isMenuOpen: boolean;
  filterTab: FilterTab;
  availableLabels: LabelDef[];
  onSelectChat: (c: InboxChat) => void;
  onArchiveChat: (id: string) => void;
  onPinChat: (id: string) => void;
  onMarkUnread: (c: InboxChat) => void;
  onLabelChat: (c: InboxChat, ids: string[]) => void;
  onLabelCreated?: (l: LabelDef) => void;
  onLabelDeleted?: (id: string) => void;
  setOpenMenuId: (id: string | null) => void;
  setDeletingChatId: (id: string | null) => void;
}) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center gap-3 px-4 py-3 text-left transition-all duration-100 group",
        isSelected
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-l-[3px] border-l-emerald-500"
          : "border-l-[3px] border-l-transparent hover:bg-muted/40",
        hasUnread && !isSelected && "bg-blue-50/40 dark:bg-blue-950/10",
        isArchived && filterTab !== "archived" && "opacity-60"
      )}
    >
      <button
        onClick={() => onSelectChat(chat)}
        className="flex flex-1 items-center gap-3 min-w-0 text-left"
      >
        <div className="relative flex-shrink-0">
          <ChatAvatar chat={chat} />
          {hasUnread && (
            <span className="absolute -right-1 -top-1 flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white shadow px-1 border-2 border-background">
              {chat.unreadCount > 9 ? "9+" : chat.unreadCount}
            </span>
          )}
          {isArchived && (
            <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-amber-500 border-2 border-background">
              <Archive className="size-2 text-white" />
            </span>
          )}
          {isPinned && !isArchived && (
            <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 border-2 border-background">
              <Pin className="size-2 text-white" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-baseline justify-between gap-1 mb-0.5">
            <div className="flex items-center min-w-0 gap-0">
              <span className={cn(
                "truncate text-sm leading-tight",
                hasUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90"
              )}>
                {chat.name}
              </span>
              <LabelDots tags={chat.tags} />
            </div>
            <span className={cn(
              "flex-shrink-0 text-[10px] leading-none",
              hasUnread ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"
            )}>
              {formatTime(chat.timestamp)}
            </span>
          </div>
          <p className={cn(
            "truncate text-xs leading-tight",
            hasUnread ? "text-foreground/80 font-medium" : "text-muted-foreground"
          )}>
            {formatLastMsg(chat.lastMessage, chat.lastMessageType)}
          </p>
        </div>
      </button>

      <div className="relative flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenuId(isMenuOpen ? null : chat.id);
          }}
          className={cn(
            "transition-all duration-150 size-6 flex items-center justify-center rounded-md",
            isMenuOpen
              ? "opacity-100 bg-muted text-foreground"
              : "opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Opciones"
        >
          <MoreVertical className="size-3.5" />
        </button>

        {isMenuOpen && (
          <ChatContextMenu
            chat={chat}
            isArchived={isArchived}
            isPinned={isPinned}
            availableLabels={availableLabels}
            onLabelCreated={onLabelCreated}
            onLabelDeleted={onLabelDeleted}
            onArchive={() => onArchiveChat(chat.id)}
            onPin={() => onPinChat(chat.id)}
            onMarkUnread={() => onMarkUnread(chat)}
            onLabelChat={(tagIds) => onLabelChat(chat, tagIds)}
            onDelete={() => { setOpenMenuId(null); setDeletingChatId(chat.id); }}
            onClose={() => setOpenMenuId(null)}
          />
        )}
      </div>
    </div>
  );
});

export function ConversationSidebar({
  chats,
  filteredChats,
  selectedChat,
  searchQuery,
  filterTab,
  loadingChats,
  sseConnected,
  onSelectChat,
  onSearchChange,
  onFilterTabChange,
  onRefresh,
  onCopyPath,
  onCleanInbox,
  onMarkAllRead,
  onNewChat,
  selectedLabel,
  onLabelChange,
  availableLabels,
  onLabelCreated,
  onLabelDeleted,
  archivedIds,
  onArchiveChat,
  pinnedIds,
  onPinChat,
  onDeleteChat,
  onMarkUnread,
  onLabelChat,
}: ConversationSidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalUnread = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const deletingChat = deletingChatId
    ? filteredChats.find((c) => c.id === deletingChatId) ?? chats.find((c) => c.id === deletingChatId)
    : null;

  return (
    <aside className="relative flex flex-col h-full w-full bg-background border-r border-border/50">

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border/50 bg-background">
        <div className="flex items-center justify-between mb-0">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <MessageSquare className="size-3.5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground leading-tight">Bandeja</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn(
                  "size-1.5 rounded-full transition-all duration-300",
                  sseConnected
                    ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(34,197,94,0.2)]"
                    : "bg-rose-400"
                )} />
                <span className="text-[10px] text-muted-foreground leading-none">
                  {sseConnected ? "En línea" : "Desconectado"}
                </span>
              </div>
            </div>
            {totalUnread > 0 && (
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white shadow-sm">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10"
                  onClick={() => onNewChat()}
                >
                  <SquarePen className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Nuevo chat</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 rounded-md text-muted-foreground hover:text-foreground" onClick={onCopyPath}>
                  <FolderOpen className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Copiar ruta de archivos</TooltipContent>
            </Tooltip>

            {totalUnread > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-md text-muted-foreground hover:text-emerald-600"
                    onClick={onMarkAllRead}
                  >
                    <CheckCheck className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Marcar todos como leídos</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-md text-muted-foreground hover:text-destructive"
                  onClick={onCleanInbox}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Limpiar bandeja</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-md text-muted-foreground hover:text-foreground"
                  onClick={onRefresh}
                  disabled={loadingChats}
                >
                  <RefreshCw className={cn("size-3.5", loadingChats && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Actualizar</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Búsqueda ── */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-border/30">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-xs rounded-lg bg-muted/40 border-border/40 focus-visible:ring-1 focus-visible:ring-emerald-500/60 focus-visible:border-emerald-500/40 placeholder:text-muted-foreground/60"
            placeholder="Buscar conversación..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* ── Tabs de filtro ── */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        {/* Fila 1: Todos · No leídos · Grupos */}
        <div className="flex items-center gap-1 mb-1">
          {FILTER_TABS.filter((t) => t.id !== "archived").map(({ id, label, icon: Icon }) => {
            const count =
              id === "unread"
                ? chats.filter((c) => c.unreadCount > 0 && !c.isGroup && !archivedIds.has(c.id)).length
                : id === "groups"
                ? chats.filter((c) => c.isGroup && !archivedIds.has(c.id)).length
                : chats.filter((c) => !c.isGroup && !archivedIds.has(c.id)).length;

            return (
              <button
                key={id}
                onClick={() => onFilterTabChange(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 py-1.5 px-1 text-[11px] font-medium rounded-md transition-all duration-150",
                  filterTab === id
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.2)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                <Icon className="size-3 flex-shrink-0" />
                <span className="truncate">{label}</span>
                {count > 0 && (
                  <span className={cn(
                    "text-[9px] px-1 py-0.5 rounded-full font-semibold leading-none flex-shrink-0",
                    filterTab === id
                      ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Fila 2: Archivados */}
        {(() => {
          const archivedCount = chats.filter((c) => archivedIds.has(c.id)).length;
          const isActive = filterTab === "archived";
          return (
            <button
              onClick={() => onFilterTabChange("archived")}
              className={cn(
                "flex w-full items-center gap-1.5 py-1.5 px-2.5 text-[11px] font-medium rounded-md transition-all duration-150",
                isActive
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Archive className={cn("size-3 flex-shrink-0", isActive && "text-amber-600 dark:text-amber-400")} />
              <span className="font-medium">Archivados</span>
              {archivedCount > 0 && (
                <span className={cn(
                  "ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold leading-none",
                  isActive
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
                )}>
                  {archivedCount}
                </span>
              )}
              {archivedCount === 0 && !isActive && (
                <span className="ml-1 text-[10px] text-muted-foreground/50 italic">vacío</span>
              )}
              <span className="ml-auto text-[9px] text-muted-foreground/40 font-normal">
                {isActive ? "← viendo" : "ver →"}
              </span>
            </button>
          );
        })()}
      </div>

      {/* ── Fila de etiquetas ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 pb-2 border-b border-border/30">
        <LabelDropdown
          labels={availableLabels}
          selectedLabel={selectedLabel}
          onLabelChange={onLabelChange}
          onLabelCreated={onLabelCreated}
          onLabelDeleted={onLabelDeleted}
        />
      </div>

      {/* ── Lista de conversaciones ── */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        {loadingChats && chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted/60">
              <Loader2 className="size-5 text-muted-foreground animate-spin" />
            </div>
            <p className="text-xs text-muted-foreground">Cargando chats...</p>
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 px-4 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted/60">
              <MessageSquare className="size-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              {searchQuery
                ? "Sin resultados"
                : selectedLabel
                ? "No hay chats con esta etiqueta"
                : filterTab === "archived"
                ? "No hay chats archivados"
                : filterTab === "groups"
                ? "No hay grupos"
                : filterTab !== "all"
                ? "No hay chats en este filtro"
                : "Sin mensajes aún"}
            </p>
            {!searchQuery && filterTab === "all" && !selectedLabel && (
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Los chats aparecerán cuando recibas o envíes mensajes
              </p>
            )}
            {filterTab === "archived" && (
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Archiva chats pasando el cursor sobre ellos
              </p>
            )}
          </div>
        ) : (
          <div>
            {/* Banner informativo cuando se está viendo archivados */}
            {filterTab === "archived" && (
              <div className="flex items-center gap-2 mx-3 mt-2 mb-1 px-2.5 py-1.5 rounded-md bg-amber-500/8 border border-amber-500/20">
                <Archive className="size-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-tight">
                  Mostrando chats archivados · Hover para desarchivar
                </p>
              </div>
            )}

            {filteredChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                isSelected={selectedChat?.id === chat.id}
                hasUnread={chat.unreadCount > 0}
                isArchived={archivedIds.has(chat.id)}
                isPinned={pinnedIds.includes(chat.id)}
                isMenuOpen={openMenuId === chat.id}
                filterTab={filterTab}
                availableLabels={availableLabels}
                onSelectChat={onSelectChat}
                onArchiveChat={onArchiveChat}
                onPinChat={onPinChat}
                onMarkUnread={onMarkUnread}
                onLabelChat={onLabelChat}
                onLabelCreated={onLabelCreated}
                onLabelDeleted={onLabelDeleted}
                setOpenMenuId={setOpenMenuId}
                setDeletingChatId={setDeletingChatId}
              />
            ))}


            <div className="px-4 py-3 border-t border-border/30 bg-muted/20">
              <p className="text-[10px] text-muted-foreground/60 text-center">
                {filteredChats.length} conversación{filteredChats.length !== 1 ? "es" : ""}
                {chats.length !== filteredChats.length && ` de ${chats.length}`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Diálogo de confirmación de eliminación ── */}
      <AlertDialog
        open={!!deletingChatId}
        onOpenChange={(open) => { if (!open) setDeletingChatId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar conversación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el historial de mensajes guardado de{" "}
              <span className="font-semibold text-foreground">
                {deletingChat?.name ?? "este chat"}
              </span>
              . Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingChatId(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => {
                if (deletingChatId) {
                  onDeleteChat(deletingChatId);
                  setDeletingChatId(null);
                }
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}