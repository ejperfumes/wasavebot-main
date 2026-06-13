/**
 * useChatScroll.ts
 *
 * Scroll estilo WhatsApp Desktop:
 *   - Al abrir chat → scroll instantáneo al final.
 *   - Al llegar mensaje nuevo → scroll solo si el usuario está cerca del fondo.
 *   - Si el usuario está leyendo arriba → NO mover scroll, mostrar indicador.
 *
 * Usado por: QuickSendTab + ConversationView
 */

import { useRef, useState, useEffect, useCallback } from "react";

const NEAR_BOTTOM_THRESHOLD = 120; // px — margen para considerar "cerca del fondo"

interface UseChatScrollOptions {
  /** Array de mensajes — el hook reacciona a sus cambios */
  messages: unknown[];
  /** ID del chat activo — cambia al seleccionar una conversación */
  chatId: string | null;
}

interface UseChatScrollReturn {
  /** Ref para el div invisible al final de la lista de mensajes */
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /** Ref para el contenedor scrollable (el viewport del ScrollArea) */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** true si hay mensajes nuevos que el usuario no ha visto */
  hasNewMessages: boolean;
  /** Desplaza al final y limpia el indicador */
  scrollToBottom: () => void;
}

export function useChatScroll({
  messages,
  chatId,
}: UseChatScrollOptions): UseChatScrollReturn {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /** true mientras se está cargando un chat nuevo — fuerza scroll instantáneo */
  const isInitialLoadRef = useRef(false);
  /** Cantidad de mensajes en el render previo */
  const prevMessageCountRef = useRef(0);
  /** ID del chat en el render previo */
  const prevChatIdRef = useRef<string | null>(null);

  const [hasNewMessages, setHasNewMessages] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const getScrollContainer = useCallback((): HTMLDivElement | null => {
    // ScrollArea de shadcn/ui envuelve el contenido en un div con overflow:auto/scroll.
    // El ref apunta a ese div directamente (lo conectamos en ConversationView).
    return scrollContainerRef.current;
  }, []);

  const isNearBottom = useCallback((): boolean => {
    const el = getScrollContainer();
    if (!el) return true; // si no hay referencia, asumir que está abajo
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
  }, [getScrollContainer]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = getScrollContainer();
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      // Fallback al ref del elemento final
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
    setHasNewMessages(false);
  }, [getScrollContainer]);

  // ── Efecto: reaccionar a cambios de chatId y messages ─────────────────────

  useEffect(() => {
  const messageCount = messages.length;
  const chatChanged = chatId !== prevChatIdRef.current;

  if (chatChanged) {
    // Chat nuevo seleccionado — marcar como carga inicial y resetear
    isInitialLoadRef.current = true;
    prevChatIdRef.current = chatId;
    prevMessageCountRef.current = 0;
    setHasNewMessages(false);
  }

  if (messageCount === 0) {
    prevMessageCountRef.current = 0;
    return;
  }

  // Si isInitialLoadRef está activo Y llegaron mensajes → scroll instantáneo
  // (no importa si chatChanged fue true en este render o en uno anterior)
  if (isInitialLoadRef.current && messageCount > 0) {
    const timer = setTimeout(() => {
      scrollToBottom("instant" as ScrollBehavior);
      isInitialLoadRef.current = false;
      prevMessageCountRef.current = messageCount;
    }, 50);  // 50ms en vez de 0 para dar tiempo al DOM de renderizar imágenes/media
    return () => clearTimeout(timer);
  }

    // Mensaje nuevo llegado (SSE)
    if (messageCount > prevMessageCountRef.current) {
      prevMessageCountRef.current = messageCount;

      if (isNearBottom()) {
        // Usuario cerca del fondo → hacer scroll automático
        scrollToBottom("smooth");
      } else {
        // Usuario leyendo mensajes antiguos → mostrar indicador
        setHasNewMessages(true);
      }
    }
  }, [messages, chatId, isNearBottom, scrollToBottom]);

  return {
    messagesEndRef,
    scrollContainerRef,
    hasNewMessages,
    scrollToBottom: () => scrollToBottom("smooth"),
  };
}
