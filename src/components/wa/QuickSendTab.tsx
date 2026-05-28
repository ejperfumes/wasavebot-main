import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api, type StepType } from "@/lib/wa-api";
import { MediaPickerDialog } from "./MediaPickerDialog";

export function QuickSendTab() {
  const [number, setNumber] = useState("");
  const [type, setType] = useState<StepType>("text");
  const [content, setContent] = useState("");
  const [caption, setCaption] = useState("");
  const [delayMs, setDelayMs] = useState(0);
  const [simulateTyping, setSimulateTyping] = useState(true);
  const [simulateRecording, setSimulateRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isMedia = type !== "text";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim()) return toast.error("Ingresa el número de destino");
    if (!/^\+?\d{6,20}$/.test(number.trim()))
      return toast.error("Número inválido. Usa solo dígitos (con + opcional).");
    if (!content.trim()) return toast.error("El contenido es obligatorio");
    setSending(true);
    try {
      await api.sendMessage({
        number: number.trim(),
        type,
        content: content.trim(),
        caption: isMedia ? caption : undefined,
        simulateTyping,
        simulateRecording: type === "audio" ? simulateRecording : false,
        delayMs,
      });
      toast.success("Mensaje enviado");
      setContent("");
      setCaption("");
    } catch (e) {
      toast.error("Error al enviar", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Envío manual</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="qs-number" className="mb-1.5 block">
              Número de WhatsApp *
            </Label>
            <Input
              id="qs-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+5491123456789"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <Label className="mb-1.5 block">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as StepType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="image">Texto Imagen/Video</SelectItem>
                  <SelectItem value="video">Texto Video</SelectItem>
                  <SelectItem value="audio">Texto Audio</SelectItem>
                  <SelectItem value="document">Texto Documento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">
                {type === "text" ? "Mensaje *" : "Ruta del archivo *"}
              </Label>
              {type === "text" ? (
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                  placeholder="Escribe el mensaje..."
                />
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="/uploads/archivo.jpg"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPickerOpen(true)}
                    className="shrink-0"
                  >
                    <FolderOpen className="mr-2 size-4" />
                    Biblioteca
                  </Button>
                </div>
              )}
            </div>
          </div>

          {isMedia && (
            <div>
              <Label className="mb-1.5 block">Caption</Label>
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Texto opcional"
              />
            </div>
          )}

          <div>
            <Label className="mb-1.5 block">Delay (ms)</Label>
            <Input
              type="number"
              min={0}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={simulateTyping}
                onCheckedChange={(v) => setSimulateTyping(!!v)}
              />
              Simular escritura
            </label>
            {type === "audio" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={simulateRecording}
                  onCheckedChange={(v) => setSimulateRecording(!!v)}
                />
                Simular grabación
              </label>
            )}
          </div>

          <Button type="submit" disabled={sending} className="w-full sm:w-auto">
            {sending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            Enviar mensaje
          </Button>
        </form>

        <MediaPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          filter={type === "text" ? undefined : (type as "image" | "video" | "audio" | "document")}
          onPick={(item) => setContent(item.path)}
        />
      </CardContent>
    </Card>
  );
}