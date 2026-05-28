import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Settings2, Wifi, WifiOff } from "lucide-react";
import { FlowsTab } from "@/components/wa/FlowsTab";
import { QuickSendTab } from "@/components/wa/QuickSendTab";
import { MediaLibraryTab } from "@/components/wa/MediaLibraryTab";
import { getApiBase, setApiBase } from "@/lib/wa-api";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WASAVE BOT" },
      {
        name: "description",
        content:
          "Administra flujos automáticos, envía mensajes manuales y gestiona la biblioteca de archivos de WASAVE BOT.",
      },
      { property: "og:title", content: "WASAVE BOT" },
      {
        property: "og:description",
        content: "Administra flujos automáticos y envía mensajes desde una sola interfaz.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [showConfig, setShowConfig] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  // true = proxy local (vacío), false = URL externa configurada
  const [usingProxy, setUsingProxy] = useState(true);

  useEffect(() => {
    const current = getApiBase(); // ya sanitizado — vacío si había URL inválida
    setApiUrl(current);
    setUsingProxy(!current);
    // No abrir el panel automáticamente: el proxy de Vite funciona sin configuración
  }, []);

  const saveBase = () => {
    setApiBase(apiUrl.trim());
    const saved = getApiBase(); // lee el valor ya sanitizado
    setUsingProxy(!saved);
    if (saved) {
      toast.success(`Backend apuntando a ${saved}`);
    } else {
      toast.success("Usando proxy local (http://localhost:3000)");
    }
    setShowConfig(false);
    setTimeout(() => window.location.reload(), 300);
  };

  const clearBase = () => {
    setApiBase("");
    setApiUrl("");
    setUsingProxy(true);
    toast.success("Usando proxy local (http://localhost:3000)");
    setShowConfig(false);
    setTimeout(() => window.location.reload(), 300);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <MessageCircle className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">WASAVE BOT</h1>
              <p className="text-xs text-muted-foreground">Panel de administración</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowConfig((s) => !s)}>
            <Settings2 className="mr-2 size-4" />
            {usingProxy ? (
              <span className="flex items-center gap-1">
                <Wifi className="size-3 text-green-500" /> Local
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <WifiOff className="size-3 text-yellow-500" /> Externo
              </span>
            )}
          </Button>
        </div>

        {showConfig && (
          <div className="border-t bg-muted/30">
            <div className="mx-auto max-w-6xl px-4 py-3">
              <p className="mb-2 text-xs text-muted-foreground">
                En desarrollo local déjalo <strong>vacío</strong> — Vite redirige{" "}
                <code>/api</code> a <code>localhost:3000</code> automáticamente.
                Solo escribe una URL si el backend corre en otro servidor.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    URL del backend (opcional)
                  </label>
                  <Input
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="http://localhost:3000  ← dejar vacío en desarrollo"
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={clearBase}>
                    Usar proxy local
                  </Button>
                  <Button onClick={saveBase}>Guardar URL</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs defaultValue="flows" className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:max-w-xl">
            <TabsTrigger value="flows">Flujos automáticos</TabsTrigger>
            <TabsTrigger value="send">Respuesta rápida</TabsTrigger>
            <TabsTrigger value="library">Biblioteca</TabsTrigger>
          </TabsList>
          <TabsContent value="flows" className="mt-6">
            <FlowsTab />
          </TabsContent>
          <TabsContent value="send" className="mt-6">
            <QuickSendTab />
          </TabsContent>
          <TabsContent value="library" className="mt-6">
            <MediaLibraryTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
