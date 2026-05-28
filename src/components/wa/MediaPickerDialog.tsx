import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileAudio, FileText, FileVideo, ImageIcon, Loader2 } from "lucide-react";
import { api, getApiBase, type MediaItem } from "@/lib/wa-api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (item: MediaItem) => void;
  filter?: MediaItem["type"];
}

const ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
};

export function MediaPickerDialog({ open, onOpenChange, onPick, filter }: Props) {
  const [items, setItems]     = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState<MediaItem["type"]>(filter ?? "image");
  const [query, setQuery]     = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .mediaList()
      .then(setItems)
      .catch((e) => toast.error("No se pudo cargar la biblioteca", { description: e.message }))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (filter) setTab(filter);
  }, [filter, open]);

  const grouped = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = items.filter((i) => i.name.toLowerCase().includes(q));
    return {
      image:    filtered.filter((i) => i.type === "image"),
      video:    filtered.filter((i) => i.type === "video"),
      audio:    filtered.filter((i) => i.type === "audio"),
      document: filtered.filter((i) => i.type === "document"),
    };
  }, [items, query]);

  const renderGrid = (list: MediaItem[]) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No hay archivos en esta categoría.
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {list.map((item) => {
          const Icon = ICONS[item.type];
          const src  = item.url ?? `${getApiBase()}${item.path}`;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                onPick(item);
                onOpenChange(false);
              }}
              className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition hover:border-primary hover:shadow-md"
            >
              <div className="flex aspect-square items-center justify-center bg-muted">
                {item.type === "image" ? (
                  <img src={src} alt={item.name} className="size-full object-cover" />
                ) : (
                  <Icon className="size-10 text-muted-foreground group-hover:text-primary" />
                )}
              </div>
              <div className="truncate p-2 text-xs font-medium" title={item.name}>
                {item.name}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Biblioteca de archivos</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Buscar archivo..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-2"
        />
        <Tabs value={tab} onValueChange={(v) => setTab(v as MediaItem["type"])}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="image">Imágenes ({grouped.image.length})</TabsTrigger>
            <TabsTrigger value="video">Videos ({grouped.video.length})</TabsTrigger>
            <TabsTrigger value="audio">Audios ({grouped.audio.length})</TabsTrigger>
            <TabsTrigger value="document">Docs ({grouped.document.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="image"    className="mt-4 max-h-[55vh] overflow-y-auto">{renderGrid(grouped.image)}</TabsContent>
          <TabsContent value="video"    className="mt-4 max-h-[55vh] overflow-y-auto">{renderGrid(grouped.video)}</TabsContent>
          <TabsContent value="audio"    className="mt-4 max-h-[55vh] overflow-y-auto">{renderGrid(grouped.audio)}</TabsContent>
          <TabsContent value="document" className="mt-4 max-h-[55vh] overflow-y-auto">{renderGrid(grouped.document)}</TabsContent>
        </Tabs>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}