// ============================================================
// inbox.js — bandeja en memoria · SSE · hook de mensajes · media on-demand
// v3 — descarga directa via WPP para IDs @lid
// ============================================================
console.log('📦 [inbox.js] cargado — v3 (WPP direct download)');

'use strict';

const fs   = require('fs');
const path = require('path');

const {
  INBOX_BASE,
  MAX_MESSAGES_PER_CHAT,
  MAX_CHATS,
  persistInboxHistory: _persist,
  loadInboxHistory:    _load,
} = require('./storage');

// ── Estado ───────────────────────────────────────────────────────────────────
const inboxMessages      = new Map();   // chatId → msgObj[]
const sseClients         = new Set();   // res de SSE activos
const recentOutgoingChats = new Map();  // chatId → timestamp (evita eco de texto)
const recentOutgoingMedia = new Set();  // "chatId|filename|type" (evita eco de media)
const recentOutgoingKeys  = new Set();  // "chatId|type|timestamp" (evita eco cuando filename llega vacío)
const recentOutgoingIds   = new Set();  // IDs outgoing_ ya emitidos por flows/quickreply (evita doble SSE)

let inboxHookInstalled = false;

// ── SSE ───────────────────────────────────────────────────────────────────────
function pushSseEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}

// ── Persistencia ─────────────────────────────────────────────────────────────
function persist() { _persist(inboxMessages); }
function loadHistory() { _load(inboxMessages); }

// ── Helpers de media ─────────────────────────────────────────────────────────
function getDateFolder(timestamp) {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMediaTypeFolder(mime) {
  if (mime.startsWith('image/')) return 'imagenes';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audios';
  return 'documentos';
}

const EXT_MAP = {
  'image/jpeg': '.jpg',  'image/png': '.png',   'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4':  '.mp4',  'video/quicktime': '.mov', 'video/webm': '.webm',
  'audio/mpeg': '.mp3',  'audio/ogg': '.ogg',   'audio/wav': '.wav', 'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
};

function saveOutgoingMedia(buffer, mimeType, originalName) {
  try {
    const now        = Math.floor(Date.now() / 1000);
    const dateFolder = getDateFolder(now);
    const typeFolder = getMediaTypeFolder(mimeType);
    const targetDir  = path.join(INBOX_BASE, dateFolder, typeFolder);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const cleanMime = mimeType.split(';')[0].trim();
    const ext       = EXT_MAP[cleanMime] || ('.' + (originalName?.split('.').pop() || 'bin'));
    const filename  = `outgoing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(targetDir, filename), buffer);
    return `/media/inbox/${dateFolder}/${typeFolder}/${filename}`;
  } catch (e) {
    console.error('Error guardando media saliente:', e.message);
    return null;
  }
}

// ── Descarga directa via page.evaluate + WPP/Store internos de WA Web ──────────
// clientInstance.downloadMedia() falla para IDs @lid porque internamente hace
// getMessageById y esos mensajes no están en la caché React.
// Aquí buscamos el mensaje en el Store de WA Web directamente por su msgId
// o construimos la descarga desde mediaKey+directPath usando las APIs internas.
async function downloadMediaViaWPP(clientInstance, message) {
  try {
    const page = clientInstance.page;
    if (!page) { console.warn('⚠️ [inbox] clientInstance.page no disponible'); return null; }

    const msgId    = message.id      || '';
    const mediaKey = message.mediaKey || message.mediaKeyBase64 || null;
    const directPath = message.directPath || null;
    const mimetype   = (message.mimetype || '').split(';')[0].trim();

    if (!mediaKey || !directPath) return null;

    // Intentar varios métodos dentro del contexto Puppeteer, del más simple al más bajo nivel
    const result = await page.evaluate(async (msgId, mediaKey, directPath, mimetype) => {
      const blobToBase64 = (blob) => new Promise((res) => {
        const r = new FileReader();
        r.onloadend = () => res(r.result.split(',')[1]);
        r.readAsDataURL(blob);
      });

      // ── Método A: buscar el mensaje en el MsgStore de WA Web por su _serialized ──
      try {
        const store = window.Store || window.mR?.findModule?.((e) => e?.default?.get)?.[0]?.default;
        if (store) {
          const waMsg = store.get?.(msgId) || store.find?.(msgId);
          if (waMsg) {
            const blob = await window.WPP.chat.downloadMedia(waMsg);
            if (blob) return { data: await blobToBase64(blob), ok: 'A' };
          }
        }
      } catch (_) {}

      // ── Método B: WPP.media.downloadMedia con objeto plano (wa-js >= 2.x) ──
      try {
        const blob = await window.WPP.media.downloadMedia({
          mediaKey, directPath, mimetype,
        });
        if (blob) return { data: await blobToBase64(blob), ok: 'B' };
      } catch (_) {}

      // ── Método C: WPP.chat.downloadMedia con objeto plano ──
      try {
        const blob = await window.WPP.chat.downloadMedia({ mediaKey, directPath, mimetype });
        if (blob) return { data: await blobToBase64(blob), ok: 'C' };
      } catch (_) {}

      // ── Método D: buscar en todos los Stores conocidos el mensaje por id ──
      try {
        const allModules = window.mR
          ? Object.values(window.mR.modules || {}).map((m) => m?.default).filter(Boolean)
          : [];
        for (const mod of allModules) {
          if (typeof mod?.get === 'function' && typeof mod?.find === 'function') {
            try {
              const m = mod.get(msgId) || mod.find?.(msgId);
              if (m && (m.mediaKey || m.directPath)) {
                const blob = await window.WPP.chat.downloadMedia(m);
                if (blob) return { data: await blobToBase64(blob), ok: 'D' };
              }
            } catch (_) {}
          }
        }
      } catch (_) {}

      // Ninguno funcionó — devolver info de diagnóstico
      return {
        data: null,
        ok:   null,
        diag: {
          hasWPP:        typeof window.WPP !== 'undefined',
          hasWPPMedia:   typeof window.WPP?.media?.downloadMedia === 'function',
          hasWPPChat:    typeof window.WPP?.chat?.downloadMedia  === 'function',
          hasStore:      typeof window.Store !== 'undefined',
          hasMR:         typeof window.mR    !== 'undefined',
        },
      };
    }, msgId, mediaKey, directPath, mimetype);

    if (result?.data) {
      console.log(`✅ [inbox] Descarga WPP método ${result.ok} exitosa`);
      return { data: result.data, mimetype };
    }

    if (result?.diag) {
      console.warn(`⚠️ [inbox] WPP todos los métodos fallaron. Diag:`, JSON.stringify(result.diag));
    }
    return null;
  } catch (e) {
    console.warn(`⚠️ [inbox] downloadMediaViaWPP excepción: ${e.message}`);
    return null;
  }
}

// ── Fallback: descarga directa desde CDN de WhatsApp via Node.js ─────────────
// Cuando page.evaluate no funciona, descargamos nosotros mismos el archivo
// cifrado desde mmg.whatsapp.net y lo desciframos con AES-256-CBC.
async function downloadMediaFromCDN(message) {
  try {
    const directPath = message.directPath;
    const mediaKeyB64 = message.mediaKey || message.mediaKeyBase64;
    const mimetype    = (message.mimetype || '').split(';')[0].trim();
    if (!directPath || !mediaKeyB64) return null;

    // Tipo de media para derivar la clave HKDF
    const typeMap = {
      'image':    'WhatsApp Image Keys',
      'video':    'WhatsApp Video Keys',
      'audio':    'WhatsApp Audio Keys',
      'ptt':      'WhatsApp Audio Keys',
      'voice':    'WhatsApp Audio Keys',
      'document': 'WhatsApp Document Keys',
      'sticker':  'WhatsApp Image Keys',
    };
    const mediaType = message.type || 'image';
    const hkdfInfo  = typeMap[mediaType] || 'WhatsApp Image Keys';

    const https  = require('https');
    const crypto = require('crypto');

    // Construir URL de descarga
    const url = `https://mmg.whatsapp.net${directPath}`;

    // Descargar el archivo cifrado
    const encryptedBuf = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'WhatsApp/2.23.24.82 A' } }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`CDN HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end',  ()  => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });

    // Derivar mediaKey → mediaKeyExpanded via HKDF (SHA-256)
    const mediaKeyBuf = Buffer.from(mediaKeyB64, 'base64');
    const hkdfExpanded = await new Promise((resolve, reject) => {
      // HKDF: extract + expand
      const prk = crypto.createHmac('sha256', Buffer.alloc(32)).update(mediaKeyBuf).digest();
      const info = Buffer.from(hkdfInfo, 'utf8');
      const t1   = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
      const t2   = crypto.createHmac('sha256', prk).update(Buffer.concat([t1, info, Buffer.from([2])])).digest();
      const t3   = crypto.createHmac('sha256', prk).update(Buffer.concat([t2, info, Buffer.from([3])])).digest();
      resolve(Buffer.concat([t1, t2, t3]).slice(0, 112));
    });

    const iv         = hkdfExpanded.slice(0,  16);
    const cipherKey  = hkdfExpanded.slice(16, 48);
    // encPayload = primeros (len-10) bytes; últimos 10 son MAC (ignorado aquí)
    const encPayload = encryptedBuf.slice(0, encryptedBuf.length - 10);

    const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
    const decrypted = Buffer.concat([decipher.update(encPayload), decipher.final()]);

    console.log(`✅ [inbox] Descarga CDN exitosa: ${decrypted.length} bytes`);
    return { data: decrypted.toString('base64'), mimetype };
  } catch (e) {
    console.warn(`⚠️ [inbox] downloadMediaFromCDN falló: ${e.message}`);
    return null;
  }
}

// ── Retry helper para downloadMedia ──────────────────────────────────────────
// Estrategia: primero intenta el método estándar (funciona para @c.us y mensajes
// en caché). Si falla 2 veces seguidas con data=null, cambia al método directo
// via WPP.chat.downloadMedia que no depende de getMessageById.
async function downloadMediaWithRetry(clientInstance, message) {
  // Intento 1: método estándar (rápido, funciona cuando está en caché)
  try {
    const media = await clientInstance.downloadMedia(message);
    if (media && media.data) return media;
  } catch (_) {}

  // Pequeña espera — a veces el blob tarda un momento en estar disponible
  await new Promise((r) => setTimeout(r, 1200));

  // Intento 2: método estándar otra vez
  try {
    const media = await clientInstance.downloadMedia(message);
    if (media && media.data) return media;
  } catch (_) {}

  // Intento 3: método directo via WPP page.evaluate (no usa getMessageById)
  console.log(`🔄 [inbox] Intentando descarga via WPP page.evaluate para ${message.type}...`);
  const mediaWPP = await downloadMediaViaWPP(clientInstance, message);
  if (mediaWPP && mediaWPP.data) {
    console.log(`✅ [inbox] Descarga WPP exitosa para ${message.type}`);
    return mediaWPP;
  }

  // Intento 4: descarga directa desde CDN de WhatsApp + descifrado AES en Node
  console.log(`🔄 [inbox] Intentando descarga CDN directa para ${message.type}...`);
  const mediaCDN = await downloadMediaFromCDN(message);
  if (mediaCDN && mediaCDN.data) return mediaCDN;

  return null;
}

async function downloadAndSaveMediaOnDemand(messageId, chatId, timestamp, mimeType, mediaData) {
  if (!mediaData) return null;
  const dateFolder = getDateFolder(timestamp);
  const typeFolder = getMediaTypeFolder(mimeType);
  const targetDir  = path.join(INBOX_BASE, dateFolder, typeFolder);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  let ext = EXT_MAP[mimeType] || '';
  if (!ext) {
    const simple = mimeType.split('/')[1];
    ext = simple ? `.${simple}` : '.bin';
  }
  const filename = `${messageId.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
  const filePath = path.join(targetDir, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.from(mediaData, 'base64'));
  }
  return `/media/inbox/${dateFolder}/${typeFolder}/${filename}`;
}

// ── Inbox message management ─────────────────────────────────────────────────
function addInboxMessage(chatId, msgObj) {
  if (!inboxMessages.has(chatId)) {
    if (inboxMessages.size >= MAX_CHATS) {
      const oldestKey = inboxMessages.keys().next().value;
      inboxMessages.delete(oldestKey);
    }
    inboxMessages.set(chatId, []);
  }
  const chat = inboxMessages.get(chatId);

  // Dedup exacto por ID
  if (msgObj.id && chat.some((m) => m.id === msgObj.id)) return;

  // Dedup adicional para outgoing_ temporales: evita que React Concurrent/StrictMode
  // o una doble llamada inserten dos mensajes con distinto ID pero mismo contenido.
  if (msgObj.id && msgObj.id.startsWith('outgoing_') && msgObj.fromMe) {
    const tsWindow = msgObj.hasMedia ? 20 : 5;
    const hasDup = chat.some((m) =>
      m.fromMe &&
      m.type === msgObj.type &&
      m.body === msgObj.body &&
      Math.abs(m.timestamp - msgObj.timestamp) <= tsWindow
    );
    if (hasDup) return;
  }

  // Si es un mensaje real de WA (id tipo true_... o false_...) con media o texto,
  // verificar si ya existe un outgoing_ equivalente por tipo+body+timestamp cercano.
  // Si existe, reemplazarlo en lugar de agregar uno nuevo.
  const isRealId = msgObj.id && (msgObj.id.startsWith('true_') || msgObj.id.startsWith('false_'));
  if (isRealId && msgObj.fromMe) {
    // Para media el body es "" en ambos mensajes, así que no podemos discriminar por texto.
    // Usamos ventana más amplia (±20s) para cubrir ecos lentos de archivos pesados.
    const isMediaOrPtt = msgObj.hasMedia || 
                     msgObj.type === 'ptt' || 
                     msgObj.type === 'audio' || 
                     msgObj.type === 'voice';
const tsWindow = isMediaOrPtt ? 60 : 10;

const idx = chat.findIndex((m) => {
  if (!m.id || !m.id.startsWith('outgoing_')) return false;
  // 'text' y 'chat' son el mismo tipo — WPPConnect usa 'chat', flows.js usaba 'text'
  const normalizeType = (t) => (t === 'text' ? 'chat' : t);
  if (normalizeType(m.type) !== normalizeType(msgObj.type)) return false;
  if (Math.abs(m.timestamp - msgObj.timestamp) > tsWindow) return false;
  // Para PTT/media body siempre es "" — no comparar body, solo type+timestamp
  if (isMediaOrPtt) return true;
  // Para texto exigir body igual
  return m.body === msgObj.body;
});
    if (idx !== -1) {
      // Reemplazar el outgoing temporal por el mensaje real,
      // preservando mediaUrl si el real no la tiene aún
      const existing = chat[idx];
      chat[idx] = {
        ...msgObj,
        read:     true,
        mediaUrl: msgObj.mediaUrl || existing.mediaUrl || null,
        mediaMime:    msgObj.mediaMime    || existing.mediaMime    || null,
        mediaDownloaded: msgObj.mediaUrl ? true : existing.mediaDownloaded,
      };
      persist();
      return;
    }
  }

  const withRead = { ...msgObj, read: msgObj.fromMe ? true : (msgObj.read ?? false) };
  chat.push(withRead);
  if (chat.length > MAX_MESSAGES_PER_CHAT) chat.shift();
  persist();
}

// ── Normalizar ID de mensaje WPPConnect ───────────────────────────────────────
function normalizeMsgId(message) {
  return message.id || '';
}

// ── Hook de mensajes entrantes/salientes ─────────────────────────────────────
function installInboxHook(clientInstance) {
  if (!clientInstance || inboxHookInstalled) return;
  inboxHookInstalled = true;

  // ── Mensajes ENTRANTES ──────────────────────────────────────────────────
  clientInstance.onMessage(async (message) => {
    try {
      const chatId = message.from;
      const msgId  = normalizeMsgId(message);

      let mediaMime            = null;
      let mediaId              = null;
      let latitude             = null;
      let longitude            = null;
      let locationDescription  = null;
      let fileName             = null;

      if (message.type === 'location') {
        latitude  = message.lat  || message.location?.lat  || message.location?.latitude  || null;
        longitude = message.lng  || message.location?.lng  || message.location?.longitude || null;
        const rawBody = message.body || '';
        const isBase64Thumb = rawBody.startsWith('/9j/') || rawBody.startsWith('AAAA') ||
          (rawBody.length > 200 && !/\s/.test(rawBody) && /^[A-Za-z0-9+/=]{100,}/.test(rawBody));
        locationDescription = isBase64Thumb ? (message.caption || message.description || '') : rawBody;
      }

      const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'voice']);
      const isMediaMsg = message.isMedia || message.isMMS || MEDIA_TYPES.has(message.type);

      let mediaUrl         = null;
      let mediaDownloaded  = false;

      if (isMediaMsg) {
        try {
          console.log(`📥 [inbox] Intentando downloadMedia para ${message.type} | id: ${msgId}`);
          // Diagnóstico completo de campos del mensaje
          console.log(`🔍 [inbox] mediaKey=${!!(message.mediaKey||message.mediaKeyBase64)} directPath=${!!message.directPath} mimetype=${message.mimetype||'?'} isMedia=${message.isMedia} isMMS=${message.isMMS} size=${message.size||message.fileSize||'?'}`);
          const media = await downloadMediaWithRetry(clientInstance, message);
          if (media) {
            mediaMime = (media.mimetype || '').split(';')[0].trim();
            mediaId   = msgId;
            fileName  = media.filename || message.filename || null;
            console.log(`📥 [inbox] media descargado: mime=${mediaMime} | data=${media.data ? media.data.length + ' chars' : 'null'}`);
            // FIX Bug #2: guardar base64 inmediatamente, mientras está disponible en caché
            if (media.data) {
              const savedUrl = await downloadAndSaveMediaOnDemand(
                msgId, chatId, message.timestamp, mediaMime, media.data
              );
              if (savedUrl) {
                mediaUrl        = savedUrl;
                mediaDownloaded = true;
                console.log(`✅ [inbox] Guardado en: ${savedUrl}`);
              } else {
                console.warn(`⚠️ [inbox] downloadAndSaveMediaOnDemand devolvió null`);
              }
            } else {
              console.warn(`⚠️ [inbox] media.data es null/vacío para ${message.type}`);
            }
          } else {
            // downloadMedia devolvió null pero el mensaje es media — guardar mediaId para intento posterior
            console.warn(`⚠️ [inbox] downloadMedia devolvió null para ${message.type} | id: ${msgId}`);
            mediaId = msgId;
          }
        } catch (err) {
          console.error(`❌ [inbox] Error en downloadMedia para ${message.type} | id: ${msgId} | error: ${err.message}`);
          mediaId = msgId;
        }
      }

      const msgObj = {
        id:                  msgId,
        from:                message.from,
        fromMe:              false,
        // location: body contiene thumbnail base64 — nunca usarlo como texto
        // media: usar caption; texto: usar body
        body:                message.type === 'location'
                               ? ''
                               : isMediaMsg
                                 ? (message.caption || '')
                                 : (message.body   || ''),
        type:                message.type,
        timestamp:           message.timestamp,
        senderName:          message.notifyName || message.sender?.name || chatId.replace('@c.us', ''),
        hasMedia:            isMediaMsg,
        mediaUrl,
        mediaMime,
        mediaDownloaded,
        mediaId,
        fileName,
        latitude,
        longitude,
        locationDescription,
        contextInfo:         message.contextInfo    || null,
        isForwarded:         message.isForwarded    || false,
        forwardingScore:     message.forwardingScore || 0,
      };

      addInboxMessage(chatId, msgObj);
      pushSseEvent('new_message', { chatId, message: msgObj });
    } catch (e) {
      console.error('Error procesando mensaje entrante para bandeja:', e.message);
    }
  });

  // ── Mensajes SALIENTES ──────────────────────────────────────────────────
  clientInstance.onAnyMessage(async (message) => {
    if (!message.fromMe) return;
    try {
      const msgId  = normalizeMsgId(message);
      const chatId = message.to;

      // DIAGNÓSTICO TEMPORAL
    console.log(`[onAnyMessage] msgId=${msgId} inRecentIds=${recentOutgoingIds.has(msgId)} inRecentChats=${recentOutgoingChats.has(chatId)}`);

      // Evitar eco de texto enviado por nuestros endpoints
      if (recentOutgoingChats.has(chatId)) return;

      // Evitar re-emisión SSE de un outgoing_ que flows/quickreply ya emitió
      if (recentOutgoingIds.has(msgId)) return;

      // Evitar eco de media enviada por nuestros endpoints.
      // NOTA: para mensajes @lid, WPPConnect deja isMedia e isMMS como undefined,
      // así que también verificamos si el type es un tipo de media conocido.
      const ECHO_MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'voice']);
      const couldBeMedia = message.isMedia || message.isMMS || ECHO_MEDIA_TYPES.has(message.type);
      if (couldBeMedia) {
        const fName     = message.filename || '';
        const mediaKey  = `${chatId}|${message.type}|${message.timestamp}|${fName}`;
        const legacyKey = `${chatId}|${fName}|${message.type}`;
        if (recentOutgoingMedia.has(mediaKey) || recentOutgoingMedia.has(legacyKey)) return;
        // Bloquear eco cuando WPPConnect reporta filename vacío (PDFs, @lid, ptt)
        const timeKey = `${chatId}|${message.type}|${message.timestamp}`;
        if (recentOutgoingKeys.has(timeKey)) return;
      }

      let mediaMime            = null;
      let mediaId              = null;
      let latitude             = null;
      let longitude            = null;
      let locationDescription  = null;
      let fileName             = null;

      if (message.type === 'location') {
        // WPPConnect puede poner las coordenadas en distintos campos según la versión
        latitude  = message.lat  || message.location?.lat  || message.location?.latitude  || null;
        longitude = message.lng  || message.location?.lng  || message.location?.longitude || null;
        // El body de ubicación saliente contiene la thumbnail en base64 — descartarlo
        const rawBody = message.body || '';
        const isBase64Thumb = rawBody.startsWith('/9j/') || rawBody.startsWith('AAAA') ||
          (rawBody.length > 200 && !/\s/.test(rawBody) && /^[A-Za-z0-9+/=]{100,}/.test(rawBody));
        locationDescription = isBase64Thumb ? (message.caption || message.description || '') : rawBody;
      }

      const MEDIA_TYPES_OUT = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'voice']);
      const isMediaMsgOut = message.isMedia || message.isMMS || MEDIA_TYPES_OUT.has(message.type);

      let mediaUrlOut        = null;
      let mediaDownloadedOut = false;

      if (isMediaMsgOut) {
        try {
          const media = await downloadMediaWithRetry(clientInstance, message);
          if (media) {
            mediaMime = (media.mimetype || '').split(';')[0].trim();
            mediaId   = msgId;
            fileName  = media.filename || message.filename || null;
            // FIX Bug #2: guardar base64 inmediatamente también para salientes
            if (media.data) {
              const savedUrl = await downloadAndSaveMediaOnDemand(
                msgId, chatId, message.timestamp, mediaMime, media.data
              );
              if (savedUrl) {
                mediaUrlOut        = savedUrl;
                mediaDownloadedOut = true;
              }
            }
          } else {
            mediaId = msgId;
          }
        } catch (_) {
          mediaId = msgId;
        }
      }

      // Stickers salientes: forzar mimetype si falla downloadMedia
      if (message.type === 'sticker' && !mediaMime) {
        mediaMime = 'image/webp';
        mediaId   = mediaId || msgId;
      }

      const msgObj = {
        id:                  msgId,
        from:                chatId,
        fromMe:              true,
        // location: body contiene thumbnail base64 — usar locationDescription ya limpio
        // media: usar caption
        // texto: usar body directamente
        body:                message.type === 'location'
                               ? ''
                               : isMediaMsgOut
                                 ? (message.caption || '')
                                 : (message.body   || ''),
        type:                message.type,
        timestamp:           message.timestamp,
        senderName:          'Yo',
        hasMedia:            isMediaMsgOut,
        mediaUrl:            mediaUrlOut,
        mediaMime,
        mediaDownloaded:     mediaDownloadedOut,
        mediaId,
        fileName,
        latitude,
        longitude,
        locationDescription,
        contextInfo:         message.contextInfo    || null,
        isForwarded:         message.isForwarded    || false,
        forwardingScore:     message.forwardingScore || 0,
      };

      addInboxMessage(chatId, msgObj);

      // Marcar mensajes entrantes como leídos al responder
      const chatMsgs = inboxMessages.get(chatId);
      if (chatMsgs) {
        let changed = false;
        for (const m of chatMsgs) {
          if (!m.fromMe && !m.read) { m.read = true; changed = true; }
        }
        if (changed) {
          persist();
          pushSseEvent('chat_read', { chatId });
        }
      }

      pushSseEvent('new_message', { chatId, message: msgObj });
    } catch (_) {}
  });
}

function resetInboxHook()    { inboxHookInstalled = false; }
function isHookInstalled()  { return inboxHookInstalled; }

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // estado
  inboxMessages,
  sseClients,
  recentOutgoingChats,
  recentOutgoingMedia,
  recentOutgoingKeys,
  recentOutgoingIds,
  // funciones
  pushSseEvent,
  addInboxMessage,
  saveOutgoingMedia,
  downloadAndSaveMediaOnDemand,
  normalizeMsgId,
  installInboxHook,
  resetInboxHook,
  isHookInstalled,
  loadHistory,
  persist,
  getDateFolder,
  getMediaTypeFolder,
};