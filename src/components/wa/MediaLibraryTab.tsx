import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Copy,
  FileAudio,
  FileText,
  FileVideo,
  ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { api, getApiBase, type MediaItem } from "@/lib/wa-api";

const ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
};

const CATEGORIES: { key: MediaItem["type"]; label: string; folder: string }[] = [
  { key: "image",    label: "Imágenes",   folder: "imagenes"   },
  { key: "video",    label: "Videos",     folder: "videos"     },
  { key: "audio",    label: "Audios",     folder: "audios"     },
  { key: "document", label: "Documentos", folder: "documentos" },
];

export function MediaLibraryTab() {
  const [items, setItems]        = useState<MediaItem[]>([]);
  const [loading, setLoading]    = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting]  = useState<string | null>(null);
  const [query, setQuery]        = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    api
      .mediaList()
      .then(setItems)
      .catch((e) => toast.error("Error al cargar archivos", { description: e.message }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await api.upload(file);
      }
      toast.success(`${files.length} archivo(s) subido(s)`);
      load();
    } catch (e) {
      toast.error("Error al subir", { description: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDelete = async (item: MediaItem) => {
    if (!confirm(`¿Eliminar "${item.name}"?`)) return;
    setDeleting(item.path);
    try {
      const parts = item.path.replace(/^\/media\//, "").split("/");
      const folder = parts[0];
      const filename = parts.slice(1).join("/");
      const base = getApiBase();
      const res = await fetch(`${base}/api/media/${folder}/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(err.error);
      }
      toast.success(`"${item.name}" eliminado`);
      setItems((prev) => prev.filter((i) => i.path !== item.path));
    } catch (e) {
      toast.error("No se pudo eliminar", { description: (e as Error).message });
    } finally {
      setDeleting(null);
    }
  };

  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Ruta copiada al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const q = query.toLowerCase();
  const filtered = items.filter((i) => i.name.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar archivo..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="ml-auto">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            Subir archivos
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        CATEGORIES.map(({ key, label }) => {
          const group = filtered.filter((i) => i.type === key);
          return (
            <section key={key}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal normal-case">
                  {group.length}
                </span>
              </h2>

              {group.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 py-8 text-center text-sm text-muted-foreground">
                  Sin archivos
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {group.map((item) => {
                    const Icon = ICONS[item.type];
                    const src = item.url ?? `${getApiBase()}${item.path}`;
                    const isDeleting = deleting === item.path;
                    return (
                      <Card key={item.path} className="overflow-hidden">
                        <div className="flex aspect-video items-center justify-center bg-muted">
                          {item.type === "image" ? (
                            <img src={src} alt={item.name} className="size-full object-cover" />
                          ) : (
                            <Icon className="size-10 text-muted-foreground" />
                          )}
                        </div>
                        <CardContent className="space-y-2 p-3">
                          <p className="truncate text-sm font-medium" title={item.name}>
                            {item.name}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground" title={item.path}>
                            {item.path}
                          </p>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => copy(item.path)}
                            >
                              <Copy className="mr-1 size-3" />
                              Copiar ruta
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                              onClick={() => onDelete(item)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Trash2 className="size-3" />
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}