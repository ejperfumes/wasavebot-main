// ============================================================
// flows.js — keywords · cola · envío con delay · flujos automáticos
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { getClient, isClientReady, getMessageQueue, isProcessing, setProcessing, sendUbicacion } = require('./whatsapp');
const { esperarConTyping, throttleMessages, delay, getRandomDelayMs }            = require('./humanizer');
const { addInboxMessage, pushSseEvent, saveOutgoingMedia, recentOutgoingChats, recentOutgoingMedia, recentOutgoingKeys, recentOutgoingIds } = require('./inbox');
const { getConfig }                                                               = require('./storage');

// ── Estado interno ────────────────────────────────────────────────────────────
const chatFirstResponseTime = new Map();

// ── Normalización y matching de keywords ─────────────────────────────────────
function normalizeText(text) {
  return text
    .replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()\[\]{}<>]/g, '')
    .trim();
}

function matchesKeyword(message, keyword) {
  const msgNorm = normalizeText(message);
  const kwNorm  = normalizeText(keyword.text);
  switch (keyword.matchType) {
    case 'exact':      return msgNorm === kwNorm;
    case 'startsWith': return msgNorm.startsWith(kwNorm);
    case 'endsWith':   return msgNorm.endsWith(kwNorm);
    case 'contains':
    default:           return msgNorm.includes(kwNorm);
  }
}

// ── Helper: leer archivo como base64 ─────────────────────────────────────────
function fileToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext    = (filePath.split('.').pop() || '').toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4',  mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:  'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:  'application/msword',
    zip:  'application/x-zip-compressed', rar: 'application/x-rar-compressed',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  return { base64: buffer.toString('base64'), mime, buffer, filename: path.basename(filePath) };
}

// ── Envío de un paso con delay ────────────────────────────────────────────────
async function enviarMensajeConDelay(chatId, step, replyToMsgId = null, pauseType = 'reading', prevStep = null) {
  const minSeg      = (step.delayMin  && step.delayMin  > 0) ? step.delayMin  : 8;
  const maxSeg      = (step.delayMax  && step.delayMax  > 0) ? step.delayMax  : 10;
  const shouldType  = (step.type === 'audio') ? false : !!step.simulateTyping;
  const shouldRecord= (step.type === 'audio') ? !!step.simulateRecording : false;

  await esperarConTyping(chatId, minSeg, maxSeg, shouldType, shouldRecord, pauseType, prevStep, getClient);
  await throttleMessages();

  const client = getClient();

  const sendText = async (text) => {
    const opts = replyToMsgId ? { quotedMsg: replyToMsgId } : {};
    await client.sendText(chatId, text, opts);
  };

  const sendFile = async (base64, mime, filename, caption = '') => {
    const dataUri = `data:${mime};base64,${base64}`;
    const opts    = replyToMsgId ? { quotedMsg: replyToMsgId } : {};
    await client.sendFile(chatId, dataUri, filename, caption, null, opts);
  };

  switch (step.type) {
    case 'text': {
      let textToSend = step.content;
      if (Array.isArray(step.content) && step.content.length > 0) {
        textToSend = step.content[Math.floor(Math.random() * step.content.length)];
      }
      recentOutgoingChats.set(chatId, Date.now());
      setTimeout(() => recentOutgoingChats.delete(chatId), 15000);

      await sendText(textToSend);

      const nowText  = Math.floor(Date.now() / 1000);
      const msgObjText = {
        id:                  'outgoing_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        from:                chatId,
        fromMe:              true,
        body:                typeof textToSend === 'string' ? textToSend : String(textToSend),
        type:                'chat', // WPPConnect usa 'chat' para texto, no 'text'
        timestamp:           nowText,
        senderName:          'Yo',
        hasMedia:            false,
        mediaUrl:            null,
        mediaMime:           null,
        mediaDownloaded:     false,
        mediaId:             null,
        fileName:            null,
        latitude:            null,
        longitude:           null,
        locationDescription: null,
      };
      addInboxMessage(chatId, msgObjText);
      pushSseEvent('new_message', { chatId, message: msgObjText });
      recentOutgoingIds.add(msgObjText.id);
      setTimeout(() => recentOutgoingIds.delete(msgObjText.id), 30000);
      break;
    }

    case 'image':
    case 'video':
    case 'document': {
      const filePath = step.content.startsWith('/') ? path.join(__dirname, step.content) : step.content;
      if (fs.existsSync(filePath)) {
        const { base64, mime, buffer, filename } = fileToBase64(filePath);
        const mediaKey = `${chatId}|${filename}|${step.type}`;
        recentOutgoingMedia.add(mediaKey);
        setTimeout(() => recentOutgoingMedia.delete(mediaKey), 30000);

        await sendFile(base64, mime, filename, step.caption || '');

        // Bloquear eco cuando WPPConnect reporta filename vacío (PDFs, @lid)
        // Ventana ampliada a -1s..+5s para cubrir ecos lentos de archivos pesados o conexión lenta
        const nowTs = Math.floor(Date.now() / 1000);
        for (let i = -1; i <= 5; i++) {
          const tk = `${chatId}|${step.type}|${nowTs + i}`;
          recentOutgoingKeys.add(tk);
          setTimeout(() => recentOutgoingKeys.delete(tk), 30000);
        }

        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const mimeMap2 = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
          mp4: 'video/mp4',  mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm',
          pdf: 'application/pdf',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          xls:  'application/vnd.ms-excel',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          doc:  'application/msword',
          zip:  'application/x-zip-compressed', rar: 'application/x-rar-compressed',
        };
        const inferredMime = mimeMap2[ext] || (
          step.type === 'image'    ? 'image/jpeg' :
          step.type === 'video'    ? 'video/mp4'  : 'application/octet-stream'
        );

        const savedUrl = saveOutgoingMedia(buffer, inferredMime, filename);
        const now      = Math.floor(Date.now() / 1000);
        const msgObj   = {
          id:                  'outgoing_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          from:                chatId,
          fromMe:              true,
          body:                step.caption || '',
          type:                step.type,
          timestamp:           now,
          senderName:          'Yo',
          hasMedia:            true,
          mediaUrl:            savedUrl,
          mediaMime:           inferredMime,
          mediaDownloaded:     !!savedUrl,
          mediaId:             null,
          fileName:            filename,
          latitude:            null,
          longitude:           null,
          locationDescription: null,
        };
        addInboxMessage(chatId, msgObj);
        pushSseEvent('new_message', { chatId, message: msgObj });
        recentOutgoingIds.add(msgObj.id);
        setTimeout(() => recentOutgoingIds.delete(msgObj.id), 30000);
      } else {
        await sendText('Archivo no encontrado: ' + step.content);
      }
      break;
    }

    case 'audio': {
      const filePath = step.content.startsWith('/') ? path.join(__dirname, step.content) : step.content;
      if (fs.existsSync(filePath)) {
        const buffer   = fs.readFileSync(filePath);
        const base64   = buffer.toString('base64');
        const filename = path.basename(filePath);

        const mediaKey = `${chatId}|${filename}|audio`;
        const mediaKeyPtt = `${chatId}|${filename}|ptt`;  // WPPConnect reporta ptt, no audio
        recentOutgoingMedia.add(mediaKey);
        recentOutgoingMedia.add(mediaKeyPtt);
        setTimeout(() => { recentOutgoingMedia.delete(mediaKey); recentOutgoingMedia.delete(mediaKeyPtt); }, 30000);

        await client.sendPttFromBase64(chatId, base64, filename);

        // Bloquear eco ptt cuando WPPConnect reporta filename vacío
        // Ventana ampliada a -1s..+5s para cubrir ecos lentos de audios pesados o conexión lenta
        const nowTsPtt = Math.floor(Date.now() / 1000);
        for (let i = -1; i <= 5; i++) {
          const tk = `${chatId}|ptt|${nowTsPtt + i}`;
          recentOutgoingKeys.add(tk);
          setTimeout(() => recentOutgoingKeys.delete(tk), 30000);
        }

        const savedUrl = saveOutgoingMedia(buffer, 'audio/ogg', filename);
        const now      = Math.floor(Date.now() / 1000);
        const msgObj   = {
          id:                  'outgoing_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          from:                chatId,
          fromMe:              true,
          body:                '',
          type:                'ptt',
          timestamp:           now,
          senderName:          'Yo',
          hasMedia:            true,
          mediaUrl:            savedUrl,
          mediaMime:           'audio/ogg',
          mediaDownloaded:     !!savedUrl,
          mediaId:             null,
          fileName:            filename,
          latitude:            null,
          longitude:           null,
          locationDescription: null,
        };
        addInboxMessage(chatId, msgObj);
        pushSseEvent('new_message', { chatId, message: msgObj });
        recentOutgoingIds.add(msgObj.id);
        setTimeout(() => recentOutgoingIds.delete(msgObj.id), 30000);
      } else {
        await sendText('Archivo no encontrado: ' + step.content);
      }
      break;
    }

    case 'location': {
      const lat  = parseFloat(step.latitude  ?? step.content?.latitude  ?? 0);
      const lng  = parseFloat(step.longitude ?? step.content?.longitude ?? 0);
      const desc = step.description ?? step.content?.description ?? '';

      if (!lat || !lng) {
        console.warn(`⚠️ Paso de ubicación sin coordenadas válidas en chat ${chatId}, omitiendo.`);
        break;
      }

      recentOutgoingChats.set(chatId, Date.now());
      setTimeout(() => recentOutgoingChats.delete(chatId), 15000);

      const locResult = await sendUbicacion(client, chatId, lat, lng, desc, '');
      if (!locResult.success) {
        console.error(`❌ No se pudo enviar ubicación a ${chatId}:`, locResult.error);
      }

      const nowLoc  = Math.floor(Date.now() / 1000);
      const msgObjLoc = {
        id:                  'outgoing_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        from:                chatId,
        fromMe:              true,
        body:                desc,
        type:                'location',
        timestamp:           nowLoc,
        senderName:          'Yo',
        hasMedia:            false,
        mediaUrl:            null,
        mediaMime:           null,
        mediaDownloaded:     false,
        mediaId:             null,
        fileName:            null,
        latitude:            lat,
        longitude:           lng,
        locationDescription: desc || null,
      };
      addInboxMessage(chatId, msgObjLoc);
      pushSseEvent('new_message', { chatId, message: msgObjLoc });
      recentOutgoingIds.add(msgObjLoc.id);
      setTimeout(() => recentOutgoingIds.delete(msgObjLoc.id), 30000);
      break;
    }

    default: {
      console.warn(`⚠️ Tipo de paso desconocido: "${step.type}" en chat ${chatId}, omitiendo.`);
      break;
    }
  }
}

// ── Procesar mensaje entrante contra flujos ───────────────────────────────────
async function procesarMensajeConFlujo(msg) {
  const config = getConfig();
  const body   = msg.body;
  const flow   = config.flows.find((f) => f.keywords.some((kw) => matchesKeyword(body, kw)));
  if (!flow) return;

  // Lógica de flujos por horario
  let activeFlow      = flow;
  const currentHour   = new Date().getHours();

  if (flow.schedules && flow.schedules.length > 0) {
    for (const sched of flow.schedules) {
      const start  = Number(sched.hourStart);
      const end    = Number(sched.hourEnd);
      const flowId = sched.flowId;
      if (!flowId) continue;
      const inRange = start <= end
        ? currentHour >= start && currentHour <= end
        : currentHour >= start || currentHour <= end;
      if (inRange) {
        const altFlow = config.flows.find((f) => f.id === flowId);
        if (altFlow && altFlow.steps && altFlow.steps.length > 0) {
          console.log(`🕐 Flujo horario: "${flow.name}" → "${altFlow.name}" (hora ${currentHour}, rango ${start}-${end})`);
          activeFlow = altFlow;
        }
        break;
      }
    }
  }

  const steps = activeFlow.steps;
  if (steps.length === 0) return;

  const minInit = Number(flow.initialDelayMin) || 0;
  const maxInit = Number(flow.initialDelayMax) || 0;
  if (minInit > 0 && !chatFirstResponseTime.has(msg.from)) {
    const initDelayMs = getRandomDelayMs(minInit, maxInit > minInit ? maxInit : minInit);
    console.log(`⏳ Delay inicial para ${msg.from}: ${(initDelayMs / 1000).toFixed(1)}s`);
    await delay(initDelayMs);
  }
  if (!chatFirstResponseTime.has(msg.from)) {
    chatFirstResponseTime.set(msg.from, Date.now());
  }

  await enviarMensajeConDelay(msg.from, steps[0], msg.id, 'reading', null);
  for (let i = 1; i < steps.length; i++) {
    await enviarMensajeConDelay(msg.from, steps[i], null, 'continuation', steps[i - 1]);
  }
}

// ── Cola de procesamiento ─────────────────────────────────────────────────────
function processQueue() {
  const queue = getMessageQueue();
  if (isProcessing() || queue.length === 0) return;
  setProcessing(true);
  const msg = queue.shift();
  procesarMensajeConFlujo(msg)
    .catch((err) => console.error('Error procesando mensaje:', err))
    .finally(() => {
      setProcessing(false);
      processQueue();
    });
}

// ── Resolver chatId ───────────────────────────────────────────────────────────
async function resolveChatId(rawId) {
  if (!rawId) throw new Error('chatId vacío');
  if (rawId.endsWith('@g.us') || rawId.endsWith('@c.us')) return rawId;
  if (rawId.endsWith('@lid')) {
    try {
      await getClient().getChatById(rawId);
      return rawId;
    } catch (_) {}
    const lidDigits = rawId.replace('@lid', '');
    try {
      const chats = await getClient().listChats();
      for (const c of chats) {
        const s = c.id?._serialized ?? c.id ?? '';
        if (s.replace(/\D/g, '').includes(lidDigits) || lidDigits.includes(s.replace(/[^0-9]/g, ''))) {
          return s;
        }
      }
    } catch (_) {}
    return rawId;
  }
  const digits = rawId.replace(/\D/g, '');
  if (digits.length >= 7) return `${digits}@c.us`;
  throw new Error(`chatId no reconocido: ${rawId}`);
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  normalizeText,
  matchesKeyword,
  fileToBase64,
  enviarMensajeConDelay,
  procesarMensajeConFlujo,
  processQueue,
  resolveChatId,
  chatFirstResponseTime,
};