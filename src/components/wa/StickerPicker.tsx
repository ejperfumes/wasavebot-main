import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Smile, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import EmojiPicker from 'emoji-picker-react';
import { api, getApiBase } from '@/lib/wa-api';

// @ts-ignore
import type { EmojiClickData } from 'emoji-picker-react';

interface StickerPickerProps {
  onSelectSticker: (url: string) => void;
  onSelectEmoji: (emoji: string) => void;
  disabled?: boolean;
}

export function StickerPicker({ onSelectSticker, onSelectEmoji, disabled }: StickerPickerProps) {
  const [stickers, setStickers] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const apiBase = getApiBase();
  const [activeTab, setActiveTab] = useState('stickers');

  const loadStickers = async () => {
    try {
      const data = await api.listStickers();
      setStickers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const uploadSticker = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Solo se permiten imágenes');
      return;
    }
    setUploading(true);
    try {
      await api.uploadSticker(file);
      toast.success('Sticker agregado');
      loadStickers();
    } catch {
      toast.error('Error al subir sticker');
    } finally {
      setUploading(false);
    }
  };

  const deleteSticker = async (filename: string) => {
    if (!confirm('¿Eliminar este sticker?')) return;
    try {
      await api.deleteSticker(filename);
      loadStickers();
      toast.success('Sticker eliminado');
    } catch {
      toast.error('Error');
    }
  };

  const handleEmojiClick = (emojiData: EmojiClickData, event: MouseEvent) => {
    // Llamamos al callback con el emoji (el carácter Unicode)
    onSelectEmoji(emojiData.emoji);
    // Opcional: cerrar el popover automáticamente después de seleccionar
    // document.getElementById('emoji-popover-trigger')?.click();
  };

  useEffect(() => {
    loadStickers();
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" disabled={disabled}>
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Tabs defaultValue="stickers" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="border-b px-2 pt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="stickers">Stickers</TabsTrigger>
              <TabsTrigger value="emojis">Emojis</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="stickers" className="p-2 mt-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Tus stickers</span>
              <label className="cursor-pointer text-xs text-emerald-600 hover:underline flex items-center gap-1">
                <Plus className="size-3" /> Subir
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) uploadSticker(e.target.files[0]);
                    e.target.value = '';
                  }}
                  disabled={uploading}
                />
              </label>
            </div>
            <ScrollArea className="h-64">
              {stickers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                  <Smile className="size-8 mb-2 opacity-30" />
                  No hay stickers
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {stickers.map((s) => (
                    <div key={s.name} className="relative group">
                      <img
                        src={`${apiBase}${s.url}`}
                        alt="sticker"
                        className="w-full aspect-square object-cover rounded-lg cursor-pointer border hover:border-emerald-500"
                        onClick={() => onSelectSticker(s.url)}
                      />
                      <button
                        className="absolute top-0 right-0 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                        onClick={(e) => { e.stopPropagation(); deleteSticker(s.name); }}
                      >
                        <Trash2 className="size-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="emojis" className="p-2 mt-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Todos los emojis</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setActiveTab('stickers')}>
                Volver a stickers
              </Button>
            </div>
            <ScrollArea className="h-64">
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                autoFocusSearch={false}
                skinTonesDisabled
                searchPlaceholder="Buscar emoji..."
                width="100%"
                height="auto"
                previewConfig={{ showPreview: false }}
              />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}