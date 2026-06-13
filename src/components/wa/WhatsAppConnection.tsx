import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Wifi, WifiOff, LogOut } from "lucide-react";
import { toast } from "sonner";
import { getApiBase } from "@/lib/wa-api";

const API_BASE = getApiBase();

export function WhatsAppConnection() {
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/status`);
      const data = await res.json();
      setStatus(data.status);
      setQr(data.qr || null);
    } catch (err) {
      console.error("Error fetching status", err);
    }
  };

  const handleLogout = async () => {
    if (!confirm("¿Cerrar sesión de WhatsApp? Se perderá la conexión actual y tendrás que escanear un nuevo QR.")) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/logout`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast.success("Sesión cerrada. Espera el nuevo QR para conectar.");
        fetchStatus();
      } else {
        toast.error("Error al cerrar sesión");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="max-w-md mx-auto mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status === "connected" && <Wifi className="text-green-500" />}
          {status === "connecting" && <Loader2 className="animate-spin text-yellow-500" />}
          {status === "disconnected" && <WifiOff className="text-red-500" />}
          Conexión WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          {status === "connected" && (
            <p className="text-green-600 font-semibold">✅ Conectado</p>
          )}
          {status === "connecting" && (
            <div className="space-y-2">
              <p className="text-yellow-600">📲 Escanea el código QR con WhatsApp</p>
              {qr && (
                <img src={qr} alt="QR Code" className="mx-auto border p-2 rounded-lg w-64 h-64" />
              )}
            </div>
          )}
          {status === "disconnected" && (
            <p className="text-red-600">⚠️ Desconectado. El bot se reconectará automáticamente al escanear el QR.</p>
          )}
        </div>

        {status === "connected" && (
          <Button variant="destructive" onClick={handleLogout} disabled={loading} className="w-full">
            <LogOut className="mr-2 h-4 w-4" />
            {loading ? "Cerrando..." : "Desconectar / Cerrar sesión"}
          </Button>
        )}
        {status === "disconnected" && (
          <p className="text-center text-sm text-muted-foreground">
            Si ves el QR arriba, escanéalo. Si no, reinicia el backend.
          </p>
        )}
        <p className="text-xs text-muted-foreground text-center">
          La sesión se guarda automáticamente. Si cierras sesión, tendrás que volver a escanear el QR.
        </p>
      </CardContent>
    </Card>
  );
}