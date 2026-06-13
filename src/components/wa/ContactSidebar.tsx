/**
 * ContactSidebar.tsx
 * Panel derecho — información del contacto con CRM editable.
 * Cambios en esta versión:
 *   - OBJETIVO 1: displayPhone nunca muestra "+" vacío — usa "Número no disponible"
 *     o "Pendiente de sincronización" cuando WhatsApp no entrega el teléfono.
 *   - OBJETIVO 2-4: TagEditor reemplazado por LabelSelector (dropdown multi-select
 *     con catálogo global, paleta de colores, sin duplicados case-insensitive).
 * Props idénticas: { chat, messages }
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Users, Phone, Hash, Clock, MessageSquare,
  ChevronDown, ChevronUp, RefreshCw, Pencil, Check,
  X, Plus, Mail, Building2, StickyNote, Tag,
  Loader2, BadgeCheck, Briefcase, Wifi, Search, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InboxChat, InboxMessage, ContactRecord, ContactCrmData, LabelDef } from "@/lib/wa-api";
import { contactsApi, labelsApi } from "@/lib/wa-api";
import { toast } from "sonner";

// ─── Props ────────────────────────────────────────────────────────────────────
interface ContactSidebarProps {
  chat: InboxChat;
  messages: InboxMessage[];
  onChatUpdate?: (patch: Partial<InboxChat>) => void;
  /** Record ya cargado por el padre — evita una llamada extra y mantiene sincronía */
  externalRecord?: ContactRecord | null;
  /** Catálogo de etiquetas ya cargado por el padre */
  externalLabels?: LabelDef[];
  /** Notifica al padre cuando el record cambia (tags, nombre, etc.) */
  onContactRecordChange?: (record: ContactRecord) => void;
}

// ─── Paleta de colores (igual que QuickRepliesTab) ────────────────────────────
const PALETTE = [
  { hex: "#22c55e", label: "Verde"   },
  { hex: "#3b82f6", label: "Azul"    },
  { hex: "#8b5cf6", label: "Morado"  },
  { hex: "#f97316", label: "Naranja" },
  { hex: "#ef4444", label: "Rojo"    },
  { hex: "#f59e0b", label: "Amarillo"},
  { hex: "#6b7280", label: "Gris"    },
  { hex: "#d1d5db", label: "Plata"   },
  { hex: "#ec4899", label: "Rosa"    },
  { hex: "#06b6d4", label: "Cyan"    },
];

// ─── Helpers visuales ─────────────────────────────────────────────────────────
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
function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("es-CO", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Sección colapsable ───────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        {open ? <ChevronUp className="size-3.5 text-muted-foreground/50" /> : <ChevronDown className="size-3.5 text-muted-foreground/50" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ─── Fila de detalle (read-only) ──────────────────────────────────────────────
function DetailRow({ icon: Icon, label, value, mono = false }: {
  icon: React.ElementType; label: string; value: string; mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 mt-0.5">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">{label}</p>
        <p className={cn("text-xs font-medium text-foreground break-all leading-tight", mono && "font-mono text-[11px]")}>{value}</p>
      </div>
    </div>
  );
}

// ─── Campo editable inline (sin cambios) ──────────────────────────────────────
function EditableField({ icon: Icon, label, value, placeholder, multiline = false, onSave }: {
  icon: React.ElementType; label: string; value: string; placeholder: string;
  multiline?: boolean; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  return (
    <div className="flex items-start gap-2.5 py-1.5 group/field">
      <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 mt-0.5">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">{label}</p>
        {editing ? (
          <div className="flex items-start gap-1">
            {multiline ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); }}
                rows={3}
                className="flex-1 text-xs rounded-md border border-emerald-500/50 bg-muted/30 px-2 py-1 outline-none resize-none focus:ring-1 focus:ring-emerald-500/40"
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
                className="flex-1 text-xs rounded-md border border-emerald-500/50 bg-muted/30 px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500/40"
              />
            )}
            <button onClick={commit} className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors flex-shrink-0">
              <Check className="size-3" />
            </button>
            <button onClick={cancel} className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-muted hover:bg-muted/70 transition-colors flex-shrink-0">
              <X className="size-3 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 min-h-[20px]">
            <p
              onClick={() => setEditing(true)}
              className="flex-1 text-xs font-medium text-foreground cursor-pointer hover:text-emerald-600 transition-colors leading-tight"
            >
              {value || <span className="text-muted-foreground/50 font-normal italic">{placeholder}</span>}
            </p>
            <button
              onClick={() => setEditing(true)}
              className="opacity-0 group-hover/field:opacity-100 flex size-5 items-center justify-center rounded-full hover:bg-muted transition-all flex-shrink-0"
            >
              <Pencil className="size-2.5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chip de etiqueta ─────────────────────────────────────────────────────────
function LabelChip({ label, onRemove }: { label: LabelDef; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={{
        backgroundColor: label.color + "22",
        color:           label.color,
        borderColor:     label.color + "44",
      }}
    >
      <Tag className="size-2.5" />
      {label.name}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 hover:opacity-70 transition-opacity">
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Selector de color inline (inspirado en QuickRepliesTab) ─────────────────
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
      {/* Opción custom por si quieren un hex específico */}
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

// ─── Selector de etiquetas moderno (Objetivo 4) ───────────────────────────────
function LabelSelector({
  selectedIds,
  allLabels,
  onToggle,
  onCreateLabel,
  onRemoveLegacy,
  onDeleteLabel,
}: {
  selectedIds: string[];
  allLabels: LabelDef[];
  onToggle: (label: LabelDef) => void;
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onRemoveLegacy: (tag: string) => Promise<void>;
  onDeleteLabel: (label: LabelDef) => Promise<void>;
}) {
  const [open, setOpen]           = useState(false);
  const [search, setSearch]       = useState("");
  const [creating, setCreating]   = useState(false);
  const [newName, setNewName]     = useState("");
  const [newColor, setNewColor]   = useState(PALETTE[0].hex);
  const [saving, setSaving]       = useState(false);
  const dropdownRef               = useRef<HTMLDivElement>(null);
  const searchRef                 = useRef<HTMLInputElement>(null);

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  const filtered = allLabels.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedLabels = allLabels.filter((l) => selectedIds.includes(l.id));
  // Legacy: tags que son strings planos (no IDs) — compatibilidad
  const legacyTags = selectedIds.filter((id) => !allLabels.find((l) => l.id === id));

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    // Evitar duplicado case-insensitive
    const dup = allLabels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      // Si ya existe, simplemente seleccionarla
      if (!selectedIds.includes(dup.id)) onToggle(dup);
      setCreating(false);
      setNewName("");
      return;
    }
    setSaving(true);
    try {
      await onCreateLabel(name, newColor);
      setCreating(false);
      setNewName("");
      setNewColor(PALETTE[0].hex);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 py-1">
      {/* Chips de etiquetas seleccionadas */}
      <div className="flex flex-wrap gap-1.5 min-h-[24px]">
        {selectedLabels.map((l) => (
          <LabelChip key={l.id} label={l} onRemove={() => onToggle(l)} />
        ))}
        {/* Compatibilidad: strings legacy que no son IDs del catálogo */}
        {legacyTags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-muted px-2 py-0.5 text-[10px] font-semibold bg-muted/30 text-muted-foreground">
            <Tag className="size-2.5" />{t}
            <button
              onClick={() => onRemoveLegacy(t)}
              className="ml-0.5 hover:opacity-70 transition-opacity"
              title={`Eliminar etiqueta "${t}"`}
            >
              <X className="size-2.5" />
            </button>
          </span>
        ))}
        {selectedIds.length === 0 && (
          <span className="text-[11px] text-muted-foreground/50 italic">Sin etiquetas</span>
        )}
      </div>

      {/* Trigger del dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all w-full"
        >
          <Plus className="size-3" />
          Agregar etiqueta
          <ChevronDown className={cn("size-3 ml-auto transition-transform", open && "rotate-180")} />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute bottom-full mb-1.5 left-0 right-0 z-50 rounded-xl border border-border/60 bg-background shadow-xl overflow-hidden">

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

            {/* Lista de etiquetas */}
            <div className="max-h-44 overflow-y-auto">
              {filtered.length === 0 && !creating && (
                <p className="px-3 py-3 text-[11px] text-muted-foreground/60 text-center italic">
                  {search ? "No encontrado" : "Sin etiquetas creadas"}
                </p>
              )}
              {filtered.map((label) => {
                const selected = selectedIds.includes(label.id);
                return (
                  <div key={label.id} className="flex items-center group/row hover:bg-muted/40 transition-colors">
                    <button
                      onClick={() => onToggle(label)}
                      className={cn(
                        "flex flex-1 items-center gap-2.5 px-3 py-2 text-left text-xs",
                        selected && "bg-muted/20"
                      )}
                    >
                      {/* Check */}
                      <div className={cn(
                        "flex size-4 flex-shrink-0 items-center justify-center rounded border transition-colors",
                        selected ? "border-transparent" : "border-border/60 bg-transparent"
                      )}
                      style={selected ? { backgroundColor: label.color, borderColor: label.color } : {}}
                      >
                        {selected && <Check className="size-2.5 text-white" />}
                      </div>
                      {/* Dot de color */}
                      <span className="size-2 rounded-full flex-shrink-0" style={{ backgroundColor: label.color }} />
                      <span className="flex-1 font-medium text-foreground">{label.name}</span>
                    </button>
                    {/* Botón eliminar del catálogo — solo visible en hover */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteLabel(label); }}
                      className="mr-2 p-1 rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-rose-100 dark:hover:bg-rose-950/40 text-muted-foreground hover:text-rose-500"
                      title={`Eliminar etiqueta "${label.name}" del catálogo`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>

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
    </div>
  );
}

// ─── ContactAvatarLarge — avatar 56px con fallback a iniciales (nunca imagen rota) ──
// Se usa SOLO en el encabezado del ContactSidebar.
// Si la URL falla (expirada, red, CORS), activa estado imgError y muestra iniciales.
// Al cambiar de chat (url diferente), el estado se resetea automáticamente.
function ContactAvatarLarge({
  url, name, isGroup,
}: { url: string | null; name: string; isGroup: boolean }) {
  const [imgError, setImgError] = useState(false);
  // Resetear error si cambia la URL (nueva sincronización o cambio de chat)
  useEffect(() => { setImgError(false); }, [url]);
  const showImg = !!url && !imgError && !isGroup;
  if (showImg) {
    return (
      <img
        src={url}
        alt={name}
        className="size-14 rounded-2xl object-cover shadow-md"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={cn("flex size-14 items-center justify-center rounded-2xl text-white text-xl font-bold shadow-md", getAvatarColor(name))}>
      {isGroup ? <Users className="size-7" /> : getInitials(name)}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ContactSidebar({ chat, messages, onChatUpdate, externalRecord, externalLabels, onContactRecordChange }: ContactSidebarProps) {
  const [record, setRecord]       = useState<ContactRecord | null>(null);
  const [syncing, setSyncing]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [allLabels, setAllLabels] = useState<LabelDef[]>([]);

  // Estadísticas
  const totalMessages    = messages.length;
  const sentMessages     = messages.filter((m) => m.fromMe).length;
  const receivedMessages = messages.filter((m) => !m.fromMe).length;
  const mediaMessages    = messages.filter((m) => m.hasMedia).length;
  const firstMessage     = messages[0] ?? null;
  const lastMessage      = messages[messages.length - 1] ?? null;
  const mediaTypes       = messages.reduce((acc, m) => { if (m.hasMedia && m.type) acc.add(m.type); return acc; }, new Set<string>());

  // Si el padre ya tiene el record cargado, sincronizarlo aquí directamente
  useEffect(() => {
    if (externalRecord !== undefined) {
      setRecord(externalRecord);
      if (externalRecord) setLoading(false);
    }
  }, [externalRecord]);

  // Si el padre ya tiene el catálogo, usarlo directamente
  useEffect(() => {
    if (externalLabels && externalLabels.length > 0) {
      setAllLabels(externalLabels);
    }
  }, [externalLabels]);

  // Cargar contacto + catálogo de etiquetas al montar — solo si el padre no los provee
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecord(null);
    Promise.all([
      externalRecord !== undefined ? Promise.resolve(externalRecord) : contactsApi.get(chat.id),
      (externalLabels && externalLabels.length > 0) ? Promise.resolve(externalLabels) : labelsApi.getAll().catch(() => [] as LabelDef[]),
    ]).then(([r, labels]) => {
      if (!cancelled) { setRecord(r); setAllLabels(labels); }
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Propagar cambios de foto y etiquetas a la lista de conversaciones
  // Usamos ref para onChatUpdate para evitar que sea dependencia del efecto
  const onChatUpdateRef = useRef(onChatUpdate);
  useEffect(() => { onChatUpdateRef.current = onChatUpdate; });

  const lastPatchRef = useRef<string>("");
  useEffect(() => {
    if (!record || !onChatUpdateRef.current) return;
    const labelDefs = (record.crm?.tags || [])
      .map((t) => allLabels.find((l) => l.id === t))
      .filter(Boolean) as LabelDef[];
    // WPPConnect puede devolver objeto {img, eurl} — extraer string
    const rawPic = record.wa?.profilePicUrl;
    const picUrl: string | null = !rawPic ? null
      : typeof rawPic === "string" ? rawPic
      : (rawPic as any).img || (rawPic as any).eurl || (rawPic as any).url || null;
    // Serializar para comparar y evitar llamadas redundantes
    const key = picUrl + "|" + labelDefs.map((l) => l.id).join(",");
    if (key === lastPatchRef.current) return;
    lastPatchRef.current = key;
    onChatUpdateRef.current({ profilePicUrl: picUrl, tags: labelDefs });
  }, [record, allLabels]);

  const saveCrm = useCallback(async (patch: Partial<ContactCrmData>) => {
    try {
      const updated = await contactsApi.save(chat.id, patch);
      setRecord(updated);
      // Notificar al padre para que sincronice contactRecord y el header
      onContactRecordChange?.(updated);
    } catch {
      toast.error("No se pudo guardar el contacto");
    }
  }, [chat.id, onContactRecordChange]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const updated = await contactsApi.syncWa(chat.id);
      setRecord(updated);
      toast.success("Datos de WhatsApp sincronizados");
    } catch {
      toast.error("No se pudo sincronizar con WhatsApp");
    } finally {
      setSyncing(false);
    }
  };

  // Toggle etiqueta — agrega/quita ID del array tags del contacto
  const handleToggleLabel = useCallback(async (label: LabelDef) => {
    const current = record?.crm?.tags || [];
    const has = current.includes(label.id);
    await saveCrm({ tags: has ? current.filter((t) => t !== label.id) : [...current, label.id] });
  }, [record, saveCrm]);

  // Eliminar etiqueta legacy (string plano, no ID del catálogo)
  const handleRemoveLegacy = useCallback(async (tag: string) => {
    try {
      await labelsApi.removeContactTag(chat.id, tag);
      setRecord((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          crm: { ...(prev.crm ?? {}), tags: (prev.crm?.tags || []).filter((t) => t !== tag) },
        };
      });
      toast.success(`Etiqueta "${tag}" eliminada`);
    } catch {
      toast.error("No se pudo eliminar la etiqueta");
    }
  }, [chat.id]);

  // Eliminar etiqueta del catálogo global (la borra para todos los contactos)
  const handleDeleteLabel = useCallback(async (label: LabelDef) => {
    try {
      await labelsApi.delete(label.id);
      // Quitar del catálogo local
      setAllLabels((prev) => prev.filter((l) => l.id !== label.id));
      // Si el contacto la tenía asignada, quitarla también del CRM local
      setRecord((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          crm: { ...(prev.crm ?? {}), tags: (prev.crm?.tags || []).filter((t) => t !== label.id) },
        };
      });
      toast.success(`Etiqueta "${label.name}" eliminada del catálogo`);
    } catch {
      toast.error("No se pudo eliminar la etiqueta");
    }
  }, []);

  // Crear etiqueta nueva en catálogo global, luego añadirla al contacto
  const handleCreateLabel = useCallback(async (name: string, color: string) => {
    try {
      const newLabel = await labelsApi.create(name, color);
      setAllLabels((prev) => {
        // Si ya existe en catálogo local (race condition), no duplicar
        if (prev.find((l) => l.id === newLabel.id)) return prev;
        return [...prev, newLabel];
      });
      // Seleccionar automáticamente la nueva etiqueta para este contacto
      const current = record?.crm?.tags || [];
      if (!current.includes(newLabel.id)) {
        await saveCrm({ tags: [...current, newLabel.id] });
      }
    } catch {
      toast.error("No se pudo crear la etiqueta");
    }
  }, [record, saveCrm]);

  const wa  = record?.wa;
  const crm = record?.crm;
  const displayName = crm?.name || wa?.pushname || chat.name;

  // OBJETIVO 1: nunca mostrar "+" vacío
  const displayPhone = (() => {
    // Si el backend ya sincronizó y guardó un teléfono real/placeholder
    if (wa?.phone) {
      // Si el backend guardó un placeholder especial — mostrarlo tal cual
      if (wa.phone === "Número no disponible" || wa.phone === "Pendiente de sincronización") {
        return wa.phone;
      }
      // Si es un número que tiene más que solo "+" (el viejo bug era "+")
      const digits = wa.phone.replace(/\D/g, "");
      if (digits.length >= 7) return wa.phone;
      // Número insuficiente — mostrar placeholder
      return "Pendiente de sincronización";
    }
    // Sin dato wa.phone — intentar extraer del chatId
    if (chat.id.endsWith("@c.us")) {
      const d = chat.id.replace("@c.us", "");
      if (d.length >= 10) {
        const cc = d.slice(0, d.length - 10);
        const sub = d.slice(d.length - 10);
        return cc ? `+${cc} ${sub.slice(0,3)} ${sub.slice(3,6)} ${sub.slice(6)}` : sub;
      }
      return d.length >= 7 ? `+${d}` : "Número no disponible";
    }
    // @lid sin teléfono resuelto
    if (chat.id.endsWith("@lid")) return "Número no disponible";
    return null;
  })();

  // Extraer URL de foto como string limpio (WPPConnect puede devolver objeto {img,eurl,...})
  const profilePicStr: string | null = !wa?.profilePicUrl ? null
    : typeof wa.profilePicUrl === "string" ? wa.profilePicUrl
    : (wa.profilePicUrl as any).img || (wa.profilePicUrl as any).eurl
      || (wa.profilePicUrl as any).imgFull || (wa.profilePicUrl as any).url || null;

  return (
    <aside className="flex flex-col h-full bg-background border-l border-border/50 overflow-y-auto">

      {/* ── Encabezado ── */}
      <div className="flex-shrink-0 px-4 pt-6 pb-4 border-b border-border/40 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex flex-col items-center text-center gap-2">

          <div className="relative">
            {/* Avatar: foto si existe y cargó OK, iniciales como fallback — nunca imagen rota */}
            <ContactAvatarLarge
              url={profilePicStr}
              name={displayName}
              isGroup={!!chat.isGroup}
            />
            {wa?.isBusiness && (
              <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-blue-500 shadow">
                <Briefcase className="size-3 text-white" />
              </div>
            )}
          </div>

          <div>
            <h3 className="font-semibold text-sm text-foreground leading-tight break-words max-w-full flex items-center gap-1 justify-center">
              {displayName}
              {wa?.isEnterprise && <BadgeCheck className="size-3.5 text-blue-500 flex-shrink-0" />}
            </h3>
            {displayPhone && (
              <p className={cn(
                "text-xs mt-0.5",
                displayPhone === "Número no disponible" || displayPhone === "Pendiente de sincronización"
                  ? "text-muted-foreground/50 italic text-[10px]"
                  : "text-muted-foreground"
              )}>
                {displayPhone}
              </p>
            )}
            {wa?.status && (
              <p className="text-[11px] text-muted-foreground/70 mt-1 italic max-w-[180px] line-clamp-2">"{wa.status}"</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
              chat.isGroup ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}>
              {chat.isGroup ? <Users className="size-2.5" /> : <Phone className="size-2.5" />}
              {chat.isGroup ? "Grupo" : wa?.isBusiness ? "Business" : "Contacto"}
            </span>
            {wa?.isMyContact && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <Check className="size-2.5" /> En agenda
              </span>
            )}
            {chat.unreadCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
                {chat.unreadCount} no leído{chat.unreadCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <button
            onClick={handleSync}
            disabled={syncing || loading}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {syncing ? <Loader2 className="size-3 animate-spin" /> : <Wifi className="size-3" />}
            {syncing ? "Sincronizando..." : "Sincronizar con WhatsApp"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground/50" />
        </div>
      ) : (
        <>
          <Section title="WhatsApp">
            <div className="space-y-0.5">
              <DetailRow icon={Hash}  label="ID de WhatsApp" value={chat.id} mono />
              {displayPhone && displayPhone !== "Número no disponible" && displayPhone !== "Pendiente de sincronización" && (
                <DetailRow icon={Phone} label="Teléfono" value={displayPhone} />
              )}
              {wa?.pushname  && <DetailRow icon={MessageSquare} label="Nombre en WhatsApp" value={wa.pushname} />}
              {firstMessage  && <DetailRow icon={Clock}         label="Primer mensaje" value={`${formatDate(firstMessage.timestamp)} · ${formatTime(firstMessage.timestamp)}`} />}
              {lastMessage   && <DetailRow icon={Clock}         label="Último mensaje"  value={`${formatDate(lastMessage.timestamp)} · ${formatTime(lastMessage.timestamp)}`} />}
              {wa?.syncedAt  && <DetailRow icon={RefreshCw}     label="Última sincronización" value={`${formatDate(wa.syncedAt)} · ${formatTime(wa.syncedAt)}`} />}
            </div>
          </Section>

          <Section title="Información del contacto">
            <EditableField icon={Pencil}   label="Nombre personalizado" value={crm?.name || ""} placeholder="Agregar nombre..." onSave={(v) => saveCrm({ name: v })} />
            <EditableField icon={Mail}     label="Correo electrónico"   value={crm?.email || ""} placeholder="correo@ejemplo.com" onSave={(v) => saveCrm({ email: v })} />
            <EditableField icon={Building2} label="Empresa"              value={crm?.company || ""} placeholder="Nombre de la empresa..." onSave={(v) => saveCrm({ company: v })} />
          </Section>

          <Section title="Notas" defaultOpen={false}>
            <EditableField icon={StickyNote} label="Notas internas" value={crm?.notes || ""} placeholder="Agregar nota sobre este contacto..." multiline onSave={(v) => saveCrm({ notes: v })} />
          </Section>

          {/* OBJETIVO 2-4: Selector de etiquetas moderno */}
          <Section title="Etiquetas" defaultOpen={true}>
            <LabelSelector
              selectedIds={crm?.tags || []}
              allLabels={allLabels}
              onToggle={handleToggleLabel}
              onCreateLabel={handleCreateLabel}
              onRemoveLegacy={handleRemoveLegacy}
              onDeleteLabel={handleDeleteLabel}
            />
          </Section>

          <Section title="Estadísticas">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Total",     value: totalMessages,    color: "text-foreground" },
                { label: "Enviados",  value: sentMessages,     color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Recibidos", value: receivedMessages, color: "text-blue-600 dark:text-blue-400" },
                { label: "Con media", value: mediaMessages,    color: "text-violet-600 dark:text-violet-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex flex-col items-center justify-center rounded-xl bg-muted/40 py-2.5 px-2 gap-0.5">
                  <span className={cn("text-lg font-bold leading-none", color)}>{value}</span>
                  <span className="text-[10px] text-muted-foreground leading-none">{label}</span>
                </div>
              ))}
            </div>
          </Section>

          {mediaTypes.size > 0 && (
            <Section title="Tipos de contenido" defaultOpen={false}>
              <div className="flex flex-wrap gap-1.5">
                {Array.from(mediaTypes).map((type) => {
                  const icons:  Record<string, string> = { image:"📷", video:"🎥", audio:"🎤", document:"📄", sticker:"🎭", ptt:"🎙️" };
                  const labels: Record<string, string> = { image:"Imágenes", video:"Videos", audio:"Audios", document:"Docs", sticker:"Stickers", ptt:"Notas de voz" };
                  return (
                    <span key={type} className="inline-flex items-center gap-1 rounded-lg bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground border border-border/30">
                      <span>{icons[type] ?? "📎"}</span>
                      {labels[type] ?? type}
                    </span>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </aside>
  );
}

// ── Exportar LabelChip para uso en ConversationView ──────────────────────────
export { LabelChip };