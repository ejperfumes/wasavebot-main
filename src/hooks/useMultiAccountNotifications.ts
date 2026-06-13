// ============================================================
// useMultiAccountNotifications.ts
// Escucha SSE de TODAS las cuentas en paralelo.
// Cuando llega un new_message en una cuenta que NO es la activa,
// dispara una Notification del navegador estilo WhatsApp Web.
// Al hacer clic → cambia de cuenta automáticamente.
// ============================================================

import { useEffect, useRef } from "react";
import { AccountConfig } from "@/lib/accounts";

interface Options {
  /** Lista completa de cuentas (activa + inactivas) */
  accounts: AccountConfig[];
  /** ID de la cuenta que el usuario tiene abierta ahora mismo */
  activeAccountId: string;
  /**
   * Callback que se llama cuando el usuario hace clic en la notificación.
   * Debe cambiar la cuenta activa al id recibido.
   */
  onSwitchAccount: (accountId: string) => void;
}

export function useMultiAccountNotifications({
  accounts,
  activeAccountId,
  onSwitchAccount,
}: Options) {
  // Guardamos ref del activeAccountId para leerlo dentro de los
  // event listeners sin necesidad de recrearlos cada vez que cambia.
  const activeIdRef = useRef(activeAccountId);
  useEffect(() => {
    activeIdRef.current = activeAccountId;
  }, [activeAccountId]);

  // Ref del callback por la misma razón
  const onSwitchRef = useRef(onSwitchAccount);
  useEffect(() => {
    onSwitchRef.current = onSwitchAccount;
  }, [onSwitchAccount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (accounts.length === 0) return;

    // Pedir permiso de notificaciones (silencioso si ya está concedido/denegado)
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Abrimos un EventSource por cada cuenta
    const sources: EventSource[] = [];

    accounts.forEach((account) => {
      const sseUrl = `${account.apiUrl}/api/inbox/events`;

      let es: EventSource;
      try {
        es = new EventSource(sseUrl);
      } catch {
        // Si el navegador no puede crear el EventSource (URL inválida, etc.)
        return;
      }

      es.addEventListener("new_message", (raw: MessageEvent) => {
        try {
          // Solo notificar si el mensaje NO es de la cuenta activa
          if (account.id === activeIdRef.current) return;

          const { message } = JSON.parse(raw.data) as {
            chatId: string;
            message: {
              body: string;
              senderName: string;
              fromMe: boolean;
              type: string;
            };
          };

          // No notificar mensajes propios
          if (message.fromMe) return;

          // Texto preview (máx 80 chars)
          const preview = buildPreview(message);
          if (!preview) return;

          // Si el permiso fue denegado, no intentamos más
          if (Notification.permission !== "granted") return;

          const title = `${account.label} — ${message.senderName}`;

          const notif = new Notification(title, {
            body: preview,
            icon: "/favicon.ico",
            // badge muestra un ícono pequeño en Android/escritorio
            // si no existe el archivo simplemente se ignora
            badge: "/favicon.ico",
            tag: `wa-${account.id}`, // agrupa notifs de la misma cuenta
          } as NotificationOptions);

          notif.onclick = () => {
            window.focus();
            onSwitchRef.current(account.id);
            notif.close();
          };
        } catch {
          // JSON malformado u otro error — ignorar silenciosamente
        }
      });

      // Si el SSE falla (cuenta apagada, etc.) no hace nada ruidoso
      es.onerror = () => {
        // EventSource reintenta solo automáticamente; no necesitamos hacer nada
      };

      sources.push(es);
    });

    // Cleanup: cerrar todas las conexiones SSE al desmontar o cuando
    // cambie la lista de cuentas
    return () => {
      sources.forEach((s) => s.close());
    };
  }, [accounts]); // solo se re-ejecuta si cambia la lista de cuentas
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Construye el texto de preview según el tipo de mensaje */
function buildPreview(message: {
  body: string;
  type: string;
}): string {
  const body = (message.body || "").trim();

  switch (message.type) {
    case "chat":
      return truncate(body, 80);
    case "image":
      return body ? `📷 ${truncate(body, 70)}` : "📷 Imagen";
    case "video":
      return body ? `🎥 ${truncate(body, 70)}` : "🎥 Video";
    case "audio":
    case "ptt":
      return "🎙️ Mensaje de voz";
    case "document":
      return body ? `📄 ${truncate(body, 70)}` : "📄 Documento";
    case "sticker":
      return "😄 Sticker";
    case "location":
      return "📍 Ubicación";
    default:
      return truncate(body, 80) || "Nuevo mensaje";
  }
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}