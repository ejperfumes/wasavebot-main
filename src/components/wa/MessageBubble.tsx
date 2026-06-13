/**
 * MessageBubble.tsx
 * Renderizado visual de burbujas de mensaje para la bandeja.
 * No contiene lógica de negocio ni manejo de estado global.
 */

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Download,
  Loader2,
  MapPin,
  FileText,
  FileSpreadsheet,
  FileArchive,
  File as FileIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, inboxApi, type InboxMessage } from "@/lib/wa-api";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./AudioPlayer";

// ─── Helpers internos ─────────────────────────────────────────────────────────

function formatMessageText(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withBold    = escaped.replace(/\*([^*\n]+?)\*/g, "<strong>$1</strong>");
  const withItalic  = withBold.replace(/_([^_\n]+?)_/g, "<em>$1</em>");
  const withStrike  = withItalic.replace(/~([^~\n]+?)~/g, "<del>$1</del>");
  const withMono    = withStrike.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  // Convertir URLs en enlaces clickeables
  const withLinks   = withMono.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;opacity:0.9;" onclick="event.stopPropagation()">$1</a>'
  );
  // whitespace-pre-wrap del contenedor ya renderiza los \n como saltos visuales.
  // NO convertir \n a <br> para evitar saltos dobles.
  return withLinks;
}

// ─── Tipos de archivo ─────────────────────────────────────────────────────────

interface FileTypeInfo {
  icon: "pdf" | "spreadsheet" | "archive" | "doc" | "generic";
  label: string;
  color: string;
}

function getFileTypeInfo(mime: string, filename: string): FileTypeInfo {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (
    mime.includes("zip") || mime.includes("rar") || mime.includes("7z") ||
    mime.includes("x-tar") || mime.includes("x-compressed") || mime.includes("x-zip") ||
    ["zip", "rar", "7z", "gz", "tar", "bz2"].includes(ext)
  ) return { icon: "archive", label: "Archivo comprimido", color: "text-amber-600" };
  if (mime === "application/pdf" || ext === "pdf")
    return { icon: "pdf", label: "PDF", color: "text-red-600" };
  if (
    mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv") ||
    ["xlsx", "xls", "ods", "csv"].includes(ext)
  ) return { icon: "spreadsheet", label: "Hoja de cálculo", color: "text-green-700" };
  if (
    mime.includes("word") || mime.includes("openxmlformats-officedocument.wordprocessing") ||
    mime.includes("msword") || ["doc", "docx", "odt", "rtf"].includes(ext)
  ) return { icon: "doc", label: "Documento Word", color: "text-blue-700" };
  if (mime.startsWith("text/") || ["txt", "md", "log"].includes(ext))
    return { icon: "doc", label: "Texto", color: "text-slate-600" };
  return { icon: "generic", label: "Archivo", color: "text-slate-500" };
}

function getCleanFilename(src: string, fileName?: string): string {
  if (fileName) return fileName;
  const raw = src.split("/").pop() ?? "archivo";
  return raw.replace(/^[a-zA-Z0-9_-]{10,}_/, "") || raw;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

// ─── Mensaje citado (reply preview) ──────────────────────────────────────────

/** Cajita de mensaje citado estilo WhatsApp, aparece encima del contenido */
function QuotedMessage({ quoted, fromMe }: { quoted: InboxMessage; fromMe: boolean }) {
  const isMedia = quoted.hasMedia || quoted.mediaUrl;
  const isAudio = quoted.type === "audio" || quoted.type === "ptt";
  const isImage = quoted.type === "image" || (quoted.mediaMime ?? "").startsWith("image/");
  const isVideo = quoted.type === "video" || (quoted.mediaMime ?? "").startsWith("video/");
  const isDoc   = quoted.type === "document";
  const isSticker = quoted.type === "sticker";

  let previewText = "";
  if (isAudio)       previewText = "🎤 Audio";
  else if (isVideo)  previewText = "🎥 Vídeo";
  else if (isDoc)    previewText = `📄 ${quoted.fileName || "Documento"}`;
  else if (isSticker) previewText = "🪄 Sticker";
  else if (isImage && !quoted.body) previewText = "📷 Foto";
  else previewText = quoted.body || "";

  const senderLabel = quoted.fromMe ? "Tú" : (quoted.senderName || "Contacto");

  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-md mb-1 cursor-default select-none",
        fromMe
          ? "bg-white/15 border-l-[3px] border-white/60"
          : "bg-black/8 dark:bg-white/10 border-l-[3px] border-emerald-500"
      )}
      style={{ borderLeftColor: fromMe ? "rgba(255,255,255,0.7)" : "#25d366" }}
    >
      {/* Miniatura si tiene imagen */}
      {isImage && quoted.mediaUrl && (
        <img
          src={`${quoted.mediaUrl}`}
          alt=""
          className="h-12 w-12 shrink-0 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="flex flex-col justify-center px-2 py-1 min-w-0">
        <span className={cn(
          "text-[11px] font-semibold truncate",
          fromMe ? "text-white/90" : "text-emerald-600 dark:text-emerald-400"
        )}>
          {senderLabel}
        </span>
        <span className={cn(
          "text-[11px] truncate leading-tight",
          fromMe ? "text-white/70" : "text-muted-foreground"
        )}>
          {previewText}
        </span>
      </div>
    </div>
  );
}

/** BubbleText: texto con formato WhatsApp + saltos de línea exactos */
function BubbleText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      className="whitespace-pre-wrap break-words text-sm"
      dangerouslySetInnerHTML={{ __html: formatMessageText(text) }}
    />
  );
}

// ─── Link preview ─────────────────────────────────────────────────────────────

/** Extrae la primera URL http/https de un texto */
function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/);
  return match ? match[0].replace(/[.,;!?)]+$/, "") : null;
}

interface PreviewData {
  ok: boolean;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  url?: string;
}

/** Hook: pide el preview al backend una vez y lo cachea en memoria de sesión */
const _previewMemCache = new Map<string, PreviewData>();

function useLinkPreview(url: string | null): PreviewData | null {
  const [data, setData] = useState<PreviewData | null>(null);

  useEffect(() => {
    if (!url) return;
    // Si ya está en caché de sesión, usar directo
    if (_previewMemCache.has(url)) {
      setData(_previewMemCache.get(url)!);
      return;
    }
    let cancelled = false;
    inboxApi.linkPreview(url).then((result) => {
      if (cancelled) return;
      _previewMemCache.set(url, result);
      setData(result);
    });
    return () => { cancelled = true; };
  }, [url]);

  return data;
}

/** Tarjeta de preview de link estilo WhatsApp */
function LinkPreviewCard({
  previewUrl,
  fromMe,
}: {
  previewUrl: string;
  fromMe: boolean;
}) {
  const preview = useLinkPreview(previewUrl);

  // Mientras carga o si falló, no mostrar nada
  if (!preview || !preview.ok) return null;

  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        block rounded-lg overflow-hidden border no-underline
        transition-opacity hover:opacity-90
        ${fromMe
          ? "border-white/20 bg-white/10"
          : "border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5"}
      `}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Imagen OG */}
      {preview.image && (
        <img
          src={preview.image}
          alt={preview.title ?? "preview"}
          className="block w-full max-h-36 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      {/* Texto */}
      <div className="px-3 py-2 space-y-0.5">
        {preview.siteName && (
          <p className={`text-[10px] font-medium uppercase tracking-wide truncate
            ${fromMe ? "text-white/60" : "text-black/40 dark:text-white/40"}`}>
            {preview.siteName}
          </p>
        )}
        {preview.title && (
          <p className={`text-xs font-semibold leading-tight line-clamp-2
            ${fromMe ? "text-white" : "text-foreground"}`}>
            {preview.title}
          </p>
        )}
        {preview.description && (
          <p className={`text-[11px] leading-snug line-clamp-2
            ${fromMe ? "text-white/75" : "text-muted-foreground"}`}>
            {preview.description}
          </p>
        )}
      </div>
    </a>
  );
}

/** DocumentCard */
function DocumentCard({
  src, mime, fileName, fileSize, fromMe,
}: {
  src: string; mime: string; fileName?: string; fileSize?: number; fromMe: boolean;
}) {
  const info = getFileTypeInfo(mime, fileName ?? src);
  const displayName = getCleanFilename(src, fileName);
  const IconComponent =
    info.icon === "pdf" ? FileText :
    info.icon === "spreadsheet" ? FileSpreadsheet :
    info.icon === "archive" ? FileArchive :
    info.icon === "doc" ? FileText : FileIcon;

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-opacity hover:opacity-80 no-underline",
        fromMe
          ? "border-white/30 bg-white/10 text-white dark:border-white/20 dark:bg-white/10"
          : "border-border bg-muted/40 text-foreground dark:border-white/10 dark:bg-white/5 dark:text-white"
      )}
    >
      <div className={cn(
        "flex size-10 flex-shrink-0 items-center justify-center rounded-lg",
        fromMe ? "bg-white/20" : "bg-background dark:bg-white/10"
      )}>
        <IconComponent className={cn("size-5", fromMe ? "text-white" : info.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(
          "truncate text-sm font-medium leading-tight overflow-hidden",
          fromMe ? "text-white" : "text-foreground"
        )}>
          {displayName}
        </p>
        <p className={cn("text-xs mt-0.5", fromMe ? "text-white/70" : "text-muted-foreground")}>
          {info.label}{fileSize ? ` · ${formatFileSize(fileSize)}` : ""}
        </p>
      </div>
      <Download className={cn("size-4 flex-shrink-0", fromMe ? "text-white/70" : "text-muted-foreground")} />
    </a>
  );
}

/** BubbleLocation — preview de mapa estilo WhatsApp con tile de OpenStreetMap */
function BubbleLocation({ msg }: { msg: InboxMessage }) {
  const lat      = msg.latitude!;
  const lng      = msg.longitude!;
  const zoom     = 15;
  const mapsUrl  = `https://www.google.com/maps?q=${lat},${lng}`;

  // Convertir lat/lng a coordenadas de tile OSM (sin API key)
  const tileX = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const tileY = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
  // Usar 3×3 tiles para cubrir el área visible (256px × 256px por tile)
  const tileSize = 256;
  const cols = 3, rows = 3;
  const offsetX = Math.floor(tileSize / 2); // offset del centro dentro del tile
  const offsetY = Math.floor(tileSize / 2);

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl overflow-hidden cursor-pointer group"
      style={{ width: 260, maxWidth: "100%" }}
    >
      {/* ── Mapa con tiles OSM ── */}
      <div
        className="relative overflow-hidden"
        style={{ width: 260, height: 160 }}
      >
        {/* Grid de tiles */}
        <div
          style={{
            position: "absolute",
            top:  -(offsetY),
            left: -(offsetX),
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${tileSize}px)`,
          }}
        >
          {Array.from({ length: rows }).flatMap((_, row) =>
            Array.from({ length: cols }).map((_, col) => (
              <img
                key={`${row}-${col}`}
                src={`https://tile.openstreetmap.org/${zoom}/${tileX + col - 1}/${tileY + row - 1}.png`}
                width={tileSize}
                height={tileSize}
                alt=""
                style={{ display: "block", imageRendering: "auto" }}
                // OSM requiere User-Agent — en browser lo pone automático
              />
            ))
          )}
        </div>

        {/* Pin centrado */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center drop-shadow-lg" style={{ marginTop: -20 }}>
            <div className="bg-red-500 rounded-full p-1.5 shadow-md border-2 border-white">
              <MapPin className="size-4 text-white fill-white" />
            </div>
            <div className="w-0.5 h-3 bg-red-500 shadow" />
            <div className="w-2 h-1 bg-black/20 rounded-full blur-sm" />
          </div>
        </div>

        {/* Overlay hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>

      {/* ── Footer estilo WhatsApp ── */}
      <div className="bg-white dark:bg-zinc-800 px-3 py-2 border-t border-black/5 dark:border-white/10">
        <div className="flex items-center gap-2">
          <MapPin className="size-3.5 text-emerald-500 shrink-0" />
          <div className="min-w-0">
            {msg.locationDescription ? (
              <p className="text-xs font-medium truncate text-foreground">{msg.locationDescription}</p>
            ) : (
              <p className="text-xs font-medium text-foreground">Ubicación</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </p>
          </div>
        </div>
      </div>
    </a>
  );
}

/** BubbleSystem: mensajes de sistema, centrados, discretos */
export function BubbleSystem({ msg }: { msg: InboxMessage }) {
  const label = msg.body?.trim() || "Mensaje del sistema";
  return (
    <div className="flex justify-center my-2">
      <span className="rounded-full bg-muted/60 border border-border/40 px-3 py-1 text-[11px] text-muted-foreground italic shadow-sm max-w-xs text-center">
        {label}
      </span>
    </div>
  );
}

/** BubbleAd: notification_template */
function BubbleAd({ msg }: { msg: InboxMessage }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium opacity-70">📢 Mensaje de anuncio</p>
      {msg.body?.trim() && <BubbleText text={msg.body} />}
    </div>
  );
}

// ─── Tipos de sistema ─────────────────────────────────────────────────────────

const SYSTEM_TYPES = new Set([
  "e2e_notification",
  "gp2",
  "notification_template",
  "revoked",
  "pinned_message",
  "automated_greeting_message",
]);

// ─── Componente principal exportado ──────────────────────────────────────────

export interface MessageBubbleProps {
  msg: InboxMessage;
  apiBase: string;
  fromMe: boolean;
  onMediaReady?: (messageId: string, mediaUrl: string) => void;
}

/**
 * MessageBubble — renderiza el contenido visual de una burbuja.
 * Maneja descarga automática por IntersectionObserver.
 * No modifica estado global ni lógica de negocio.
 */
// Detecta base64 crudo que WPPConnect a veces mete en msg.body
function isBase64Body(body: string): boolean {
  if (!body) return false;
  if (body.startsWith("/9j/") || body.startsWith("AAAA")) return true;
  if (body.length > 200 && !body.includes(" ") && !body.includes("\n") && /^[A-Za-z0-9+/=]{100,}/.test(body)) return true;
  return false;
}

export function MessageBubble({ msg, apiBase, fromMe, onMediaReady }: MessageBubbleProps) {
  const [downloading, setDownloading]     = useState(false);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const [localMediaUrl, setLocalMediaUrl] = useState<string | null>(null);
  const [mediaFailed, setMediaFailed]     = useState(false);
  const observerRef = useRef<HTMLDivElement>(null);
  const base = apiBase || "http://localhost:3000";

  // Normalizar: body con base64 crudo → vacío; hasMedia como string → boolean
  const cleanBody   = isBase64Body(msg.body) ? "" : (msg.body || "");
  const hasMediaBool = typeof msg.hasMedia === "string"
    ? (msg.hasMedia as string).toLowerCase() === "true"
    : Boolean(msg.hasMedia);
  // Usar localMediaUrl si ya descargamos en esta sesión, o el que viene del store
  const resolvedMediaUrl = localMediaUrl || msg.mediaUrl || null;
  msg = { ...msg, body: cleanBody, hasMedia: hasMediaBool, mediaUrl: resolvedMediaUrl };

  // Mensaje citado (reply)
  const quotedMsg = msg.contextInfo?.quotedMsg ?? null;
  const QuotedPreview = quotedMsg
    ? <QuotedMessage quoted={quotedMsg} fromMe={fromMe} />
    : null;

  const handleDownload = async () => {
    if (downloading || mediaFailed) return;
    setDownloading(true);
    try {
      const result = await api.downloadMedia(msg.id);
      if (result?.url) {
        setLocalMediaUrl(result.url);
        onMediaReady?.(msg.id, result.url);
      } else {
        setMediaFailed(true);
      }
    } catch {
      setMediaFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!msg.hasMedia || msg.mediaUrl || autoTriggered || msg.type === "sticker") return;
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setAutoTriggered(true);
        handleDownload();
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [msg.hasMedia, msg.mediaUrl, autoTriggered]);

  // ── Mensajes de sistema ───────────────────────────────────────────────────
  if (SYSTEM_TYPES.has(msg.type)) {
    if (msg.type === "notification_template") return <BubbleAd msg={msg} />;
    return <BubbleSystem msg={msg} />;
  }

  // ── Ubicación ─────────────────────────────────────────────────────────────
  if (msg.type === "location" && msg.latitude != null && msg.longitude != null) {
    return <BubbleLocation msg={msg} />;
  }

  // ── Sticker con URL ───────────────────────────────────────────────────────
  if (msg.type === "sticker" && msg.mediaUrl) {
    return (
      <img
        src={`${base}${msg.mediaUrl}`}
        alt="sticker"
        className="max-w-[150px] max-h-[150px] object-contain select-none"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  // ── Sticker pendiente de descarga ─────────────────────────────────────────
  if (msg.type === "sticker" && msg.hasMedia && !msg.mediaUrl) {
    return (
      <Button size="sm" variant="ghost" onClick={handleDownload} disabled={downloading} className="h-8 text-xs">
        {downloading
          ? <Loader2 className="size-3 animate-spin mr-1" />
          : <Download className="size-3 mr-1" />}
        Ver sticker
      </Button>
    );
  }

  // ── Media ya descargada ───────────────────────────────────────────────────
  if (msg.mediaUrl) {
    const src      = `${base}${msg.mediaUrl}`;
    const mime     = msg.mediaMime || "";
    const filename = msg.fileName ?? src.split("/").pop() ?? "";
    const isImage  = (mime.startsWith("image/") || msg.type === "image") && msg.type !== "sticker";
    const isVideo  = mime.startsWith("video/") || msg.type === "video";
    const isAudio  = mime.startsWith("audio/") || msg.type === "audio" || msg.type === "ptt";

    if (isImage) return (
      <div className="inline-flex flex-col w-full">
        {QuotedPreview && <div className="px-1 pt-1">{QuotedPreview}</div>}
        <img
          src={src}
          alt="Imagen"
          className="block w-full rounded-t-[inherit] object-contain cursor-pointer"
          onClick={() => window.open(src, "_blank")}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        {msg.body && (
          <div className="px-3 pt-1 pb-0 w-full">
            <BubbleText text={msg.body} />
          </div>
        )}
      </div>
    );

    if (isVideo) return (
      <div className="inline-flex flex-col w-full">
        {QuotedPreview && <div className="px-1 pt-1">{QuotedPreview}</div>}
        <video
          src={src}
          controls
          className="block w-full rounded-t-[inherit]"
          preload="metadata"
        />
        {msg.body && (
          <div className="px-3 pt-1 pb-0 w-full">
            <BubbleText text={msg.body} />
          </div>
        )}
      </div>
    );

    if (isAudio) return (
      <div className="flex flex-col w-64">
        {QuotedPreview && <div className="pt-1">{QuotedPreview}</div>}
        <div className="py-1"><AudioPlayer src={src} /></div>
        {msg.body && (
          <div className="pb-0">
            <BubbleText text={msg.body} />
          </div>
        )}
      </div>
    );

    return (
      <div className="flex flex-col w-64">
        {QuotedPreview && <div className="pt-1">{QuotedPreview}</div>}
        <DocumentCard src={src} mime={mime} fileName={filename} fromMe={fromMe} />
        {msg.body && (
          <div className="pt-1 pb-0">
            <BubbleText text={msg.body} />
          </div>
        )}
      </div>
    );
  }

  // ── Media pendiente de descarga ───────────────────────────────────────────
  if (msg.hasMedia && !msg.mediaUrl) {
    if (msg.type === "sticker") {
      return (
        <div ref={observerRef}>
          {QuotedPreview}
          <Button size="sm" variant="ghost" onClick={handleDownload} disabled={downloading || mediaFailed} className="h-8 text-xs">
            {downloading
              ? <Loader2 className="size-3 animate-spin mr-1" />
              : <Download className="size-3 mr-1" />}
            {mediaFailed ? "No disponible" : "Ver sticker"}
          </Button>
        </div>
      );
    }
    const mime   = msg.mediaMime ?? "";
    const isImg  = mime.startsWith("image/") || msg.type === "image";
    const isVid  = mime.startsWith("video/") || msg.type === "video";
    const isAud  = mime.startsWith("audio/") || msg.type === "audio" || msg.type === "ptt";
    const icon   = isImg ? "📷" : isVid ? "🎥" : isAud ? "🎤" : "📄";
    const label  = isImg ? "imagen" : isVid ? "video" : isAud ? "audio" : "archivo";

    return (
      <div ref={observerRef} className="flex flex-col w-64">
        {QuotedPreview && <div className="pt-1">{QuotedPreview}</div>}
        {mediaFailed ? (
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2",
            fromMe ? "bg-white/10" : "bg-muted/50"
          )}>
            <span className="text-lg opacity-40">{icon}</span>
            <span className="text-xs opacity-50">{label} no disponible</span>
          </div>
        ) : downloading ? (
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2",
            fromMe ? "bg-white/10" : "bg-muted/50"
          )}>
            <Loader2 className="size-4 animate-spin opacity-70" />
            <span className="text-xs opacity-70">Cargando {label}...</span>
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer",
              fromMe ? "bg-white/10 hover:bg-white/20" : "bg-muted/50 hover:bg-muted"
            )}
            onClick={handleDownload}
          >
            <span className="text-lg">{icon}</span>
            <span className="text-xs opacity-70">{label}</span>
          </div>
        )}
        {msg.body && (
          <div className="pt-1 pb-0">
            <BubbleText text={msg.body} />
          </div>
        )}
      </div>
    );
  }

  // ── Texto puro ────────────────────────────────────────────────────────────
  const previewUrl = extractFirstUrl(msg.body);
  if (previewUrl) {
    return (
      <div className="w-[300px]">
        {QuotedPreview}
        <LinkPreviewCard previewUrl={previewUrl} fromMe={fromMe} />
        <div className="mt-1">
          <BubbleText text={msg.body} />
        </div>
      </div>
    );
  }
  if (QuotedPreview) {
    return (
      <div>
        {QuotedPreview}
        <BubbleText text={msg.body} />
      </div>
    );
  }
  return <BubbleText text={msg.body} />;
}