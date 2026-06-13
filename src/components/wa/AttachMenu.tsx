// src/components/wa/AttachMenu.tsx
// Menú de adjuntos estilo WhatsApp: Imagen/Video, Documento, Ubicación
import { useRef, useState, useEffect } from "react";
import {
  Paperclip,
  ImageIcon,
  FileText,
  MapPin,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getApiBase } from "@/lib/wa-api";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AttachMenuProps {
  /** chatId destino, ej: "521234567890@c.us" */
  chatId: string;
  /** Número limpio para el backend, ej: "521234567890" */
  phoneNumber: string;
  disabled?: boolean;
  onSent?: () => void;
  /** ID del mensaje citado — para que el adjunto se envíe como respuesta */
  quotedMsgId?: string;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AttachMenu({ chatId, phoneNumber, disabled, onSent, quotedMsgId }: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // Refs para los inputs ocultos de archivo
  const imgVideoRef  = useRef<HTMLInputElement>(null);
  const docRef       = useRef<HTMLInputElement>(null);

  // Estado del modal de caption (imagen/video/doc)
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [caption, setCaption]         = useState("");
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);

  // Estado del modal de ubicación
  const [showLocation, setShowLocation] = useState(false);
  const [latInput, setLatInput]         = useState("");
  const [lngInput, setLngInput]         = useState("");
  const [locDesc, setLocDesc]           = useState("");
  const [detectingLoc, setDetectingLoc] = useState(false);

  // Refs del mapa Leaflet
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef  = useRef<any>(null);
  const markerRef       = useRef<any>(null);

  const apiBase = getApiBase();

  // ── Inicializar mapa Leaflet cuando se abre el modal ────────────────────────
  useEffect(() => {
    if (!showLocation) {
      // Limpiar mapa al cerrar modal
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
      return;
    }

    // Esperar un tick para que el div esté en el DOM
    const timer = setTimeout(async () => {
      if (!mapContainerRef.current || mapInstanceRef.current) return;

      const L = (await import("leaflet")).default;
      // Inyectar CSS de Leaflet dinámicamente si no está ya
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id   = "leaflet-css";
        link.rel  = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      // Coordenadas iniciales: las que ya haya en el input o Bogotá por defecto
      const initLat = parseFloat(latInput) || 4.7110;
      const initLng = parseFloat(lngInput) || -74.0721;

      const map = L.map(mapContainerRef.current).setView([initLat, initLng], 16);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      // Icono verde tipo pin — evita el bug de imagen rota de Leaflet en bundlers
      const icon = L.divIcon({
        html: `<div style="
          width:24px;height:24px;
          background:#22c55e;
          border:3px solid white;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          box-shadow:0 2px 8px rgba(0,0,0,0.35);
        "></div>`,
        iconSize:   [24, 24],
        iconAnchor: [12, 24],
        className:  "",
      });

      const marker = L.marker([initLat, initLng], { draggable: true, icon }).addTo(map);
      markerRef.current = marker;

      // Actualizar coordenadas al soltar el pin arrastrado
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        setLatInput(pos.lat.toFixed(7));
        setLngInput(pos.lng.toFixed(7));
      });

      // Clic en el mapa → mover el pin a ese punto
      map.on("click", (e: any) => {
        marker.setLatLng(e.latlng);
        setLatInput(e.latlng.lat.toFixed(7));
        setLngInput(e.latlng.lng.toFixed(7));
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [showLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cuando cambian las coordenadas (GPS), mover el mapa al nuevo punto ──────
  useEffect(() => {
    if (!mapInstanceRef.current || !markerRef.current || !latInput || !lngInput) return;
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (isNaN(lat) || isNaN(lng)) return;
    mapInstanceRef.current.setView([lat, lng], 17);
    markerRef.current.setLatLng([lat, lng]);
  }, [latInput, lngInput]);

  // ─── Handlers de archivo ───────────────────────────────────────────────────

  const openPicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    setOpen(false);
    ref.current?.click();
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setPendingFile(file);
    setCaption("");
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  // ─── Envío de archivo ──────────────────────────────────────────────────────

  const sendFile = async (file: File, cap: string) => {
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("phoneNumber", phoneNumber);
      formData.append("caption", cap);
      formData.append("asSticker", "false");
      // Si hay mensaje citado, incluirlo para que el backend haga el reply
      if (quotedMsgId) formData.append("quotedMsgId", quotedMsgId);

      const res = await fetch(`${apiBase || "http://localhost:3000"}/api/send-attachment`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const label = file.type.startsWith("image/") ? "Imagen" :
                      file.type.startsWith("video/") ? "Video" : "Documento";
        toast.success(`✅ ${label} enviado`);
        closeCaptionModal();
        onSent?.();
      } else if (res.status === 503) {
        toast.error("WhatsApp no está conectado", {
          description: "Conecta WhatsApp antes de enviar archivos.",
        });
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error("Error al enviar", { description: data?.error || `HTTP ${res.status}` });
      }
    } catch {
      toast.error("Error de conexión", { description: "No se pudo contactar al servidor." });
    } finally {
      setSending(false);
    }
  };

  const handleSendWithCaption = () => {
    if (!pendingFile) return;
    sendFile(pendingFile, caption);
  };

  const closeCaptionModal = () => {
    setPendingFile(null);
    setCaption("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  // ─── Ubicación ─────────────────────────────────────────────────────────────

  const detectLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización");
      return;
    }
    setDetectingLoc(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatInput(String(pos.coords.latitude));
        setLngInput(String(pos.coords.longitude));
        setDetectingLoc(false);
      },
      () => {
        toast.error("No se pudo obtener tu ubicación");
        setDetectingLoc(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const sendLocation = async () => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (isNaN(lat) || isNaN(lng)) {
      toast.error("Coordenadas inválidas");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${apiBase || "http://localhost:3000"}/api/send-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, latitude: lat, longitude: lng, description: locDesc }),
      });
      if (res.ok) {
        toast.success("✅ Ubicación enviada");
        setShowLocation(false);
        setLatInput(""); setLngInput(""); setLocDesc("");
        onSent?.();
      } else if (res.status === 503) {
        toast.error("WhatsApp no está conectado");
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error("Error al enviar ubicación", { description: data?.error });
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setSending(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Inputs ocultos ── */}
      <input
        ref={imgVideoRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChosen}
      />
      <input
        ref={docRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"
        className="hidden"
        onChange={handleFileChosen}
      />

      {/* ── Botón clip + menú popup ── */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          title="Adjuntar"
          className={cn(
            "flex size-9 items-center justify-center rounded-full transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "disabled:cursor-not-allowed disabled:opacity-40",
            open && "bg-muted text-foreground"
          )}
        >
          <Paperclip className="size-[18px]" />
        </button>

        {/* Menú flotante */}
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute bottom-11 left-0 z-50 flex flex-col gap-1 rounded-2xl border bg-popover p-2 shadow-xl min-w-[160px]">
              <MenuItem
                icon={<ImageIcon className="size-4 text-violet-500" />}
                label="Imagen / Video"
                onClick={() => openPicker(imgVideoRef)}
              />
              <MenuItem
                icon={<FileText className="size-4 text-blue-500" />}
                label="Documento"
                onClick={() => openPicker(docRef)}
              />
              <div className="my-1 h-px bg-border" />
              <MenuItem
                icon={<MapPin className="size-4 text-rose-500" />}
                label="Ubicación"
                onClick={() => { setOpen(false); setShowLocation(true); }}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Modal: caption para imagen/video/doc ── */}
      {pendingFile && (
        <ModalOverlay onClose={closeCaptionModal}>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">
                {pendingFile.type.startsWith("image/") ? "Imagen" :
                 pendingFile.type.startsWith("video/") ? "Video" : "Documento"}
              </span>
              <button onClick={closeCaptionModal} className="rounded-full p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>

            {previewUrl && pendingFile.type.startsWith("image/") && (
              <img
                src={previewUrl}
                alt="preview"
                className="max-h-48 w-full rounded-xl object-contain bg-muted"
              />
            )}
            {previewUrl && pendingFile.type.startsWith("video/") && (
              <video
                src={previewUrl}
                className="max-h-48 w-full rounded-xl bg-black"
                controls
                muted
              />
            )}
            {!previewUrl && (
              <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
                <FileText className="size-5 text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{pendingFile.name}</p>
                  <p className="text-xs text-muted-foreground">{humanSize(pendingFile.size)}</p>
                </div>
              </div>
            )}

            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendWithCaption();
                }
              }}
              rows={3}
              placeholder="Agregar descripción (opcional)…
Puedes usar *negrita*, _cursiva_ o ~tachado~"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
            />
            <p className="text-xs text-muted-foreground px-1">
              Formato: *negrita* · _cursiva_ · ~tachado~
            </p>

            <button
              onClick={handleSendWithCaption}
              disabled={sending}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
            >
              {sending ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              Enviar
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Modal: ubicación con mapa interactivo ── */}
      {showLocation && (
        <ModalOverlay onClose={() => setShowLocation(false)} wide>
          <div className="flex flex-col gap-3 w-full">

            {/* Cabecera */}
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm flex items-center gap-2">
                <MapPin className="size-4 text-rose-500" /> Enviar ubicación
              </span>
              <button onClick={() => setShowLocation(false)} className="rounded-full p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>

            {/* Mapa interactivo */}
            <div
              ref={mapContainerRef}
              style={{ height: "260px", borderRadius: "12px", overflow: "hidden", zIndex: 0 }}
              className="border w-full bg-muted"
            />

            <p className="text-xs text-muted-foreground text-center -mt-1">
              📍 Haz clic en el mapa o arrastra el pin verde para ajustar la ubicación exacta
            </p>

            {/* Botón GPS */}
            <button
              type="button"
              onClick={detectLocation}
              disabled={detectingLoc}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-2 text-sm text-muted-foreground hover:border-emerald-500 hover:text-emerald-600 transition-colors disabled:opacity-50"
            >
              {detectingLoc
                ? <><span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> Detectando ubicación GPS…</>
                : <><MapPin className="size-3.5" /> Usar mi ubicación GPS actual</>
              }
            </button>

            {/* Coordenadas en tiempo real (solo lectura visual) */}
            {latInput && lngInput && (
              <div className="flex gap-2">
                <span className="flex-1 rounded-lg border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
                  Lat: {parseFloat(latInput).toFixed(6)}
                </span>
                <span className="flex-1 rounded-lg border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
                  Lng: {parseFloat(lngInput).toFixed(6)}
                </span>
              </div>
            )}

            {/* Descripción opcional */}
            <input
              type="text"
              value={locDesc}
              onChange={(e) => setLocDesc(e.target.value)}
              placeholder="Descripción (ej: Nuestra tienda — opcional)"
              className="rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />

            {/* Botón enviar */}
            <button
              onClick={sendLocation}
              disabled={sending || !latInput || !lngInput}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
            >
              {sending ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              Enviar ubicación
            </button>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted text-left"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ModalOverlay({
  children,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className={cn(
        "relative z-10 w-full rounded-2xl border bg-card p-5 shadow-2xl",
        wide ? "max-w-lg" : "max-w-sm"
      )}>
        {children}
      </div>
    </div>
  );
}