// ============================================================
// humanizer.js — delays · typing · recording · throttle
// Funciones puras de temporización. Sin dependencias del cliente WA.
// Recibe getClient() como parámetro para no crear acoplamiento circular.
// ============================================================

'use strict';

let lastMessageSentTime = 0;
const MIN_INTERVAL_MS   = 1500;

// ── Utilidad base ────────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Distribución natural de tiempos ──────────────────────────────────────────
// Promedio de dos randoms elimina el sesgo al mínimo — más natural que un random plano
function getRandomDelayMs(minSeg, maxSeg) {
  const minMs = minSeg * 1000;
  const maxMs = maxSeg * 1000;
  if (minMs >= maxMs) return minMs;
  const r1 = Math.random();
  const r2 = Math.random();
  const r  = (r1 + r2) / 2;
  return Math.round(minMs + r * (maxMs - minMs));
}

// Pausa de "lectura" antes de responder — simula que el bot leyó el mensaje (1.2s–3.5s)
function getReadingPauseMs() {
  const min = 1200;
  const max = 3500;
  return Math.round(min + Math.random() * (max - min));
}

// Pausa de continuidad entre mensajes consecutivos propios (1.5s–4s+ según largo del anterior)
function getContinuationPauseMs(prevStep = null) {
  const base = Math.round(1500 + Math.random() * 2500);

  let lengthBonus = 0;
  if (prevStep) {
    const text  = Array.isArray(prevStep.content) ? prevStep.content.join(' ') : (prevStep.content || '');
    const chars = text.length;
    if (chars > 200) lengthBonus = Math.round(500 + Math.random() * 1000);
    else if (chars > 80) lengthBonus = Math.round(200 + Math.random() * 600);
  }

  // 20% de probabilidad de micro-pausa de "pensamiento" extra (400–1200ms)
  const thinkingPause = Math.random() < 0.20 ? Math.round(400 + Math.random() * 800) : 0;
  if (thinkingPause > 0) {
    console.log(`💭 Micro-pausa de pensamiento: +${(thinkingPause / 1000).toFixed(1)}s`);
  }

  return base + lengthBonus + thinkingPause;
}

// ── Simulación de typing/recording ───────────────────────────────────────────
// pauseType: 'reading' | 'continuation' | 'none'
// getClient: función que devuelve el cliente WA activo (evita acoplamiento circular)
async function esperarConTyping(
  chatId,
  minSeg,
  maxSeg,
  simulateTyping,
  simulateRecording = false,
  pauseType         = 'reading',
  prevStep          = null,
  getClient         = () => null,
) {
  const delayMs      = getRandomDelayMs(minSeg, maxSeg);
  const STOP_BEFORE  = 700;

  let prePauseMs = 0;
  if (pauseType === 'reading')       prePauseMs = getReadingPauseMs();
  else if (pauseType === 'continuation') prePauseMs = getContinuationPauseMs(prevStep);

  if (simulateTyping || simulateRecording) {
    const activeMs = Math.max(delayMs - STOP_BEFORE, 500);
    console.log(
      `⏳ [${chatId.split('@')[0]}] pre=${(prePauseMs / 1000).toFixed(1)}s ` +
      `activo=${(activeMs / 1000).toFixed(1)}s stop=${(STOP_BEFORE / 1000).toFixed(1)}s ` +
      `[${pauseType}] (config:${minSeg}-${maxSeg}s)`
    );

    let interval = null;
    try {
      if (prePauseMs > 0) await delay(prePauseMs);

      const client = getClient();
      if (client) {
        if (simulateRecording) await client.startRecording(chatId);
        else                   await client.startTyping(chatId);

        // Refrescar cada 3 s para que WhatsApp no cancele el estado
        interval = setInterval(async () => {
          try {
            const c = getClient();
            if (!c) return;
            if (simulateRecording) await c.startRecording(chatId);
            else                   await c.startTyping(chatId);
          } catch (_) {}
        }, 3000);
      }

      await delay(activeMs);

      clearInterval(interval);
      interval = null;

      try {
        const c = getClient();
        if (c) {
          if (simulateRecording) await c.stopRecording(chatId);
          else                   await c.stopTyping(chatId);
        }
      } catch (_) {}

      await delay(STOP_BEFORE);

    } catch (err) {
      console.error('Error simulando estado:', err.message);
      if (interval) clearInterval(interval);
      await delay(delayMs);
    }
  } else {
    await delay(prePauseMs + delayMs);
  }
}

// ── Throttle entre mensajes ───────────────────────────────────────────────────
async function throttleMessages() {
  const now          = Date.now();
  const timeSinceLast = now - lastMessageSentTime;
  if (timeSinceLast < MIN_INTERVAL_MS) {
    await delay(MIN_INTERVAL_MS - timeSinceLast);
  }
  lastMessageSentTime = Date.now();
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  delay,
  getRandomDelayMs,
  getReadingPauseMs,
  getContinuationPauseMs,
  esperarConTyping,
  throttleMessages,
};
