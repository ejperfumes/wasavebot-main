// ============================================================
// routes.js — todos los endpoints REST de la aplicación
// ============================================================

'use strict';

const fs    = require('fs');
const path  = require('path');
const multer = require('multer');

const {
  getClient, getStatus, getQrDataURL, isClientReady,
  initializeClient, reconectarSiMuerto, isDeadFrameError,
  sendUbicacion,
} = require('./whatsapp');

const {
  getConfig, setConfig, saveConfig,
  configToFrontend, configFromFrontend,
  loadConnectionName, saveConnectionName, getConnectionName,
  deleteAuthFolder, hasSession, TOKENS_DIR,
  normalizeMessage, MAX_MESSAGES_PER_CHAT,
} = require('./storage');

const {
  inboxMessages, sseClients, pushSseEvent,
  addInboxMessage, saveOutgoingMedia, downloadAndSaveMediaOnDemand,
  normalizeMsgId, installInboxHook, resetInboxHook,
} = require('./inbox');

const {
  enviarMensajeConDelay, resolveChatId, processQueue,
} = require('./flows');

const { esperarConTyping, throttleMessages } = require('./humanizer');
const { registerMediaRoutes, inferMediaType } = require('./media');

// ── Multer para subida de media de biblioteca ─────────────────────────────────
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'documentos';
    if (file.mimetype.startsWith('image/')) folder = 'imagenes';
    else if (file.mimetype.startsWith('audio/')) folder = 'audios';
    else if (file.mimetype.startsWith('video/')) folder = 'videos';
    const dir = path.join(__dirname, 'media', folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage: diskStorage });

// ── Registro principal ────────────────────────────────────────────────────────
function registerRoutes(app) {

  // ── WhatsApp: status / connect / disconnect / logout ─────────────────────
  app.get('/api/whatsapp/status', (_req, res) => {
    res.json({ status: getStatus(), qr: getQrDataURL() || null, ready: isClientReady() });
  });

  app.post('/api/whatsapp/connect', async (req, res) => {
    if (isClientReady()) {
      return res.status(400).json({ error: 'Ya estás conectado. Usa desconectar o eliminar sesión.' });
    }
    if (getStatus() === 'connecting' && getQrDataURL()) {
      return res.status(400).json({ error: 'Ya hay una conexión en curso. Escanea el QR.' });
    }
    try {
      const client = getClient();
      if (client) { await client.close(); }
      await initializeClient(processQueue);
      res.json({ ok: true, message: 'Conectando... Escanea el QR cuando aparezca.' });
    } catch (err) {
      console.error('Error al conectar:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      const client = getClient();
      if (client) { await client.close(); }
      await initializeClient(processQueue);
      res.json({ ok: true, message: 'Desconectado. La sesión se mantiene.' });
    } catch (err) {
      console.error('Error en disconnect:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    try {
      const client = getClient();
      if (client) { await client.close(); }
      await new Promise((r) => setTimeout(r, 1000));
      await deleteAuthFolder();
      res.json({ ok: true, message: 'Sesión eliminada. Usa "Conectar" para escanear un nuevo QR.' });
    } catch (err) {
      console.error('Error en logout:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/has-session', (_req, res) => {
    res.json({ hasSession: hasSession() });
  });

  // ── Nombre de conexión ───────────────────────────────────────────────────
  app.get('/api/whatsapp/name', (_req, res) => {
    res.json({ name: getConnectionName() });
  });

  app.post('/api/whatsapp/name', (req, res) => {
    const { name } = req.body;
    if (typeof name === 'string') {
      saveConnectionName(name);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Nombre inválido' });
    }
  });

  // ── Config / media biblioteca ─────────────────────────────────────────────
  app.get('/api/config', (_req, res) => {
    res.json(configToFrontend(getConfig()));
  });

  app.post('/api/config', (req, res) => {
    try {
      setConfig(configFromFrontend(req.body));
      saveConfig();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const relativePath = '/media/' + path.relative(path.join(__dirname, 'media'), req.file.path).replace(/\\/g, '/');
    const mediaType    = inferMediaType(req.file.originalname);
    res.json({ name: req.file.originalname, path: relativePath, type: mediaType, size: req.file.size });
  });

  app.get('/api/media-list', (_req, res) => {
    const folders = { imagenes: 'image', videos: 'video', audios: 'audio', documentos: 'document' };
    const items   = [];
    for (const [folder, type] of Object.entries(folders)) {
      const dir = path.join(__dirname, 'media', folder);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach((f) => {
          items.push({ name: f, path: `/media/${folder}/${f}`, type, size: fs.statSync(path.join(dir, f)).size });
        });
      }
    }
    res.json(items);
  });

  app.delete('/api/media/:folder/:filename', (req, res) => {
    const { folder, filename } = req.params;
    const allowed = ['imagenes', 'videos', 'audios', 'documentos'];
    if (!allowed.includes(folder)) return res.status(400).json({ error: 'Carpeta no válida' });
    const filePath = path.join(__dirname, 'media', folder, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    try {
      fs.unlinkSync(filePath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Respuestas rápidas ────────────────────────────────────────────────────
  const quickReplyCancellations = new Map();

  app.post('/api/execute-quick-reply', async (req, res) => {
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
    const { chatId: rawChatId, quickReplyId } = req.body;
    if (!rawChatId || !quickReplyId) return res.status(400).json({ error: 'Faltan campos: chatId, quickReplyId' });

    let chatId;
    try { chatId = await resolveChatId(rawChatId); }
    catch (err) { return res.status(400).json({ error: `No se pudo resolver el chat: ${err.message}` }); }

    const config = getConfig();
    const qr     = (config.quickReplies || []).find((q) => q.id === quickReplyId);
    if (!qr)                               return res.status(404).json({ error: 'Respuesta rápida no encontrada' });
    if (!qr.steps || !qr.steps.length)    return res.status(400).json({ error: 'La respuesta rápida no tiene pasos' });

    const total = qr.steps.length;
    quickReplyCancellations.delete(chatId);
    res.json({ ok: true, message: `Ejecutando "${qr.name}" en ${chatId}`, total });

    (async () => {
      try {
        pushSseEvent('quick_reply_progress', { id: quickReplyId, chatId, step: 0, total, done: false, error: null });
        for (let i = 0; i < total; i++) {
          if (quickReplyCancellations.get(chatId)) {
            quickReplyCancellations.delete(chatId);
            console.log(`🚫 Respuesta rápida "${qr.name}" cancelada en paso ${i + 1}/${total}`);
            pushSseEvent('quick_reply_progress', { id: quickReplyId, chatId, step: i, total, done: false, error: 'Cancelado' });
            return;
          }
          await enviarMensajeConDelay(chatId, qr.steps[i], null, 'continuation', i > 0 ? qr.steps[i - 1] : null);
          pushSseEvent('quick_reply_progress', { id: quickReplyId, chatId, step: i + 1, total, done: i === total - 1, error: null });

          const chatMsgs = inboxMessages.get(chatId);
          if (chatMsgs) {
            for (const m of chatMsgs) { if (!m.fromMe && !m.read) m.read = true; }
          }
        }
        console.log(`✅ Respuesta rápida "${qr.name}" ejecutada en ${chatId}`);
      } catch (err) {
        console.error(`❌ Error ejecutando respuesta rápida "${qr.name}":`, err.message);
        pushSseEvent('quick_reply_progress', { id: quickReplyId, chatId, step: 0, total, done: false, error: err.message });
      }
    })();
  });

  app.post('/api/cancel-quick-reply', (req, res) => {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: 'Falta chatId' });
    quickReplyCancellations.set(chatId, true);
    console.log(`🚫 Cancelación solicitada para ${chatId}`);
    res.json({ ok: true, message: 'Cancelación registrada' });
  });

  // ── Envío manual de mensaje ───────────────────────────────────────────────
  app.post('/api/send-message', async (req, res) => {
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
    let { number, type, content, caption, simulateTyping, delaySec, quotedMsgId } = req.body;
    if (!number || !type || !content) return res.status(400).json({ error: 'Faltan campos' });

    let chatId;
    try { chatId = await resolveChatId(number); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    try {
      const minSeg    = delaySec || 0;
      const maxSeg    = delaySec || 0;
      const shouldType = (type === 'audio') ? false : simulateTyping;

      if (minSeg > 0) await esperarConTyping(chatId, minSeg, maxSeg, shouldType, false, 'none', null, getClient);
      else if (shouldType) await esperarConTyping(chatId, 0.8, 1.5, true, false, 'none', null, getClient);
      await throttleMessages();

      const client = getClient();
      if (type === 'text') {
        if (quotedMsgId) {
          // WPPConnect falla con prepareRawMessage cuando el mensaje citado
          // tiene ID @lid. Buscamos directamente en el inbox local y usamos
          // reply() en lugar de sendText con quotedMsg para evitar el error.
          const { inboxMessages } = require('./inbox');
          let foundMsg = null;
          for (const msgs of inboxMessages.values()) {
            const m = msgs.find((m) => m.id === quotedMsgId);
            if (m) { foundMsg = m; break; }
          }

          if (foundMsg) {
            try {
              // reply() acepta el ID string directamente sin necesitar el objeto
              await client.reply(chatId, content, quotedMsgId);
            } catch (replyErr) {
              console.warn(`[reply] reply() falló: ${replyErr.message} — enviando sin reply`);
              await client.sendText(chatId, content);
            }
          } else {
            // Mensaje no encontrado en inbox local — intentar getMessageById
            let quotedMsgObj = null;
            try { quotedMsgObj = await client.getMessageById(quotedMsgId); } catch (_) {}
            if (quotedMsgObj) {
              try {
                await client.sendText(chatId, content, { quotedMsg: quotedMsgObj });
              } catch (_) {
                await client.sendText(chatId, content);
              }
            } else {
              await client.sendText(chatId, content);
            }
          }
        } else {
          await client.sendText(chatId, content);
        }
      } else {
        const filePath = content.startsWith('/') ? path.join(__dirname, content) : content;
        if (!fs.existsSync(filePath)) return res.status(400).json({ error: `Archivo no encontrado: ${content}` });
        const buffer   = fs.readFileSync(filePath);
        const base64   = buffer.toString('base64');
        const filename = path.basename(filePath);
        const ext      = (filename.split('.').pop() || '').toLowerCase();
        const mimeMap  = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
          mp4: 'video/mp4',  mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm',
          mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
          pdf: 'application/pdf',
        };
        const mime = mimeMap[ext] || 'application/octet-stream';

        // Resolver objeto del mensaje citado si viene quotedMsgId
        let quotedMsgObj = null;
        if (quotedMsgId) {
          const { inboxMessages } = require('./inbox');
          for (const msgs of inboxMessages.values()) {
            const m = msgs.find((m) => m.id === quotedMsgId);
            if (m) { quotedMsgObj = m; break; }
          }
          if (!quotedMsgObj) {
            try { quotedMsgObj = await client.getMessageById(quotedMsgId); } catch (_) {}
          }
        }

        if (type === 'audio') {
          // sendPttFromBase64 no acepta quotedMsg — enviamos el audio y luego
          // reply solo con el texto vacío no aplica; usamos sendFile como PTT con options
          try {
            if (quotedMsgObj) {
              await client.sendPttFromBase64(chatId, base64, filename, { quotedMsg: quotedMsgObj });
            } else {
              await client.sendPttFromBase64(chatId, base64, filename);
            }
          } catch (_) {
            // Fallback sin reply si falla con options
            await client.sendPttFromBase64(chatId, base64, filename);
          }
        } else if (type === 'sticker') {
          try {
            if (quotedMsgObj) {
              await client.sendImageAsStickerGif(chatId, `data:${mime};base64,${base64}`, { quotedMsg: quotedMsgObj });
            } else {
              await client.sendImageAsStickerGif(chatId, `data:${mime};base64,${base64}`);
            }
          } catch (_) {
            await client.sendFile(chatId, `data:${mime};base64,${base64}`, filename, caption || '');
          }
        } else {
          try {
            if (quotedMsgObj) {
              await client.sendFile(chatId, `data:${mime};base64,${base64}`, filename, caption || '', { quotedMsg: quotedMsgObj });
            } else {
              await client.sendFile(chatId, `data:${mime};base64,${base64}`, filename, caption || '');
            }
          } catch (sendErr) {
            // Fallback sin reply
            await client.sendFile(chatId, `data:${mime};base64,${base64}`, filename, caption || '');
          }
        }
      }
      res.json({ ok: true, chatId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bandeja: SSE ──────────────────────────────────────────────────────────
  app.get('/api/inbox/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { clearInterval(keepAlive); }
    }, 25000);

    sseClients.add(res);
    req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
  });

  // ── Bandeja: chats ────────────────────────────────────────────────────────
  app.get('/api/inbox/chats', async (_req, res) => {
    try {
      const contactsStore = require('./contacts');
      const globalLabels  = contactsStore.getGlobalLabels();
      const labelMap      = new Map(globalLabels.map((l) => [l.id, l]));

      const localChats = [];
      for (const [chatId, msgs] of inboxMessages.entries()) {
        if (!msgs.length) continue;
        const lastMsg = msgs[msgs.length - 1];
        const unread  = msgs.filter((m) => !m.fromMe && !m.read).length;

        // Enriquecer con datos del contacto (tags + profilePic) — lectura pura, sin escritura
        const record     = contactsStore.getContact(chatId);
        const rawTags    = record?.crm?.tags || [];
        // Resolver tags: puede ser ID del catálogo o string legacy
        const resolvedTags = rawTags
          .map((t) => labelMap.get(t) || null)
          .filter(Boolean);

        // extractPicUrl: normaliza string | objeto WPPConnect | null → string | null
        const rawPic = record?.wa?.profilePicUrl;
        const picUrl = !rawPic ? null
          : typeof rawPic === 'string' ? rawPic
          : rawPic.img || rawPic.eurl || rawPic.imgFull || rawPic.url || null;

        localChats.push({
          id:              chatId,
          name:            record?.wa?.pushname || record?.crm?.name || lastMsg.senderName || chatId.replace('@c.us', ''),
          lastMessage:     lastMsg.body || '',
          lastMessageType: lastMsg.type || 'text',
          timestamp:       lastMsg.timestamp,
          unreadCount:     unread,
          isGroup:         chatId.endsWith('@g.us'),
          tags:            resolvedTags,           // [{ id, name, color }]
          profilePicUrl:   picUrl,
        });
      }
      if (isClientReady() && getClient()) {
        try {
          const waChats = await getClient().listChats();
          const waMap   = new Map(waChats.map((c) => {
            const id = typeof c.id === 'string' ? c.id : (c.id?._serialized || c.id);
            return [id, c];
          }));
          for (const lc of localChats) {
            const wc = waMap.get(lc.id);
            if (wc) { lc.name = wc.name || lc.name; lc.isGroup = wc.isGroup || lc.isGroup; }
          }
        } catch (_) {}
      }
      localChats.sort((a, b) => b.timestamp - a.timestamp);
      res.json(localChats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Bandeja: mensajes de un chat ──────────────────────────────────────────
  app.get('/api/inbox/messages/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const limit      = parseInt(req.query.limit) || 50;
    try {
      let localMsgs = (inboxMessages.get(chatId) || []).slice(-limit);
      if (isClientReady() && getClient() && localMsgs.length < limit) {
        try {
          const fetched = await getClient().getMessages(chatId, { count: limit, direction: 'before' });
          const existingIds = new Set(localMsgs.map((m) => m.id));
          for (const m of fetched) {
            const msgId = normalizeMsgId(m);
            if (existingIds.has(msgId)) continue;
            let mediaMime = null, mediaId = null, latitude = null, longitude = null, locationDescription = null;
            if (m.type === 'location') { latitude = m.lat || null; longitude = m.lng || null; locationDescription = m.body || null; }
            if (m.isMedia || m.isMMS) {
              try {
                const media = await getClient().downloadMedia(m);
                if (media) { mediaMime = (media.mimetype || '').split(';')[0].trim(); mediaId = msgId; }
              } catch (_) {}
            }
            localMsgs.unshift(normalizeMessage({
              id: msgId, from: m.from, fromMe: m.fromMe, body: m.body || '', type: m.type,
              timestamp: m.timestamp, senderName: m.fromMe ? 'Yo' : (m.notifyName || chatId.replace('@c.us', '')),
              hasMedia: m.isMedia || m.isMMS || false, mediaUrl: null, mediaMime, mediaDownloaded: false,
              mediaId, latitude, longitude, locationDescription,
            }));
            existingIds.add(msgId);
          }
          localMsgs.sort((a, b) => a.timestamp - b.timestamp);

// Deduplicar outgoing_ contra mensajes reales traídos de WPPConnect
const realMsgs = localMsgs.filter((m) => !m.id?.startsWith('outgoing_'));
const deduped = localMsgs.filter((m) => {
  if (!m.id?.startsWith('outgoing_')) return true;
  const isMediaOrPtt = m.hasMedia || m.type === 'ptt' || m.type === 'audio' || m.type === 'voice';
  const tsWindow = isMediaOrPtt ? 60 : 45;
  return !realMsgs.some((r) => {
    if (r.fromMe !== m.fromMe) return false;
    // 'text' y 'chat' son el mismo tipo — WPPConnect usa 'chat', flows.js usaba 'text'
    const normalizeType = (t) => (t === 'text' ? 'chat' : t);
    if (normalizeType(r.type) !== normalizeType(m.type)) return false;
    if (Math.abs(r.timestamp - m.timestamp) > tsWindow) return false;
    if (isMediaOrPtt) return true;
    return r.body === m.body;
  });
});

inboxMessages.set(chatId, deduped.slice(-MAX_MESSAGES_PER_CHAT));
        } catch (_) {}
      }
      if (isClientReady() && getClient()) {
        try { await getClient().sendSeen(chatId); } catch (_) {}
      }
      const msgsToSend = inboxMessages.get(chatId) || localMsgs;
res.json(msgsToSend.slice(-limit));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Bandeja: descargar media bajo demanda ────────────────────────────────
  app.get('/api/inbox/media/:messageId', async (req, res) => {
    const { messageId } = req.params;
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no conectado' });

    let foundMsg = null, foundChatId = null;
    for (const [chatId, msgs] of inboxMessages.entries()) {
      const msg = msgs.find((m) => m.id === messageId);
      if (msg) { foundMsg = msg; foundChatId = chatId; break; }
    }
    if (!foundMsg) return res.status(404).json({ error: 'Mensaje no encontrado' });
    if (foundMsg.mediaUrl) return res.json({ url: foundMsg.mediaUrl });

    // Si mediaId es null, intentar con el id del mensaje directamente (fallback para msgs viejos)
    const resolveId = foundMsg.mediaId || foundMsg.id;
    if (!resolveId) return res.status(400).json({ error: 'Sin media asociada' });

    try {
      // FIX Bug #1: se eliminó el bloqueo de @lid — WPPConnect sí puede resolverlos
      const waMsg = await getClient().getMessageById(resolveId);
      if (!waMsg) return res.status(404).json({ error: 'Media no disponible' });
      const media = await getClient().downloadMedia(waMsg);
      if (!media || !media.data) return res.status(500).json({ error: 'Error al descargar media' });

      const mime     = (media.mimetype || '').split(';')[0].trim();
      const savedUrl = await downloadAndSaveMediaOnDemand(foundMsg.id, foundChatId, foundMsg.timestamp, mime, media.data);
      if (savedUrl) {
        foundMsg.mediaUrl        = savedUrl;
        foundMsg.mediaMime       = mime;
        foundMsg.mediaId         = resolveId;
        foundMsg.mediaDownloaded = true;
        pushSseEvent('media_downloaded', { chatId: foundChatId, messageId: foundMsg.id, mediaUrl: savedUrl });
        return res.json({ url: savedUrl });
      }
      return res.status(500).json({ error: 'No se pudo guardar el archivo' });
    } catch (err) {
      console.error('Error descargando media bajo demanda:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bandeja: marcar leído / no leído / limpiar ────────────────────────────
  app.post('/api/inbox/read/:chatId', async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      // 1. Actualizar estado local (memoria + disco)
      const msgs = inboxMessages.get(chatId);
      if (msgs) {
        let changed = false;
        for (const m of msgs) { if (!m.fromMe && !m.read) { m.read = true; changed = true; } }
        if (changed) require('./inbox').persist();
      }
      // 2. Sincronizar con el teléfono: marcar como leído en WhatsApp
      if (isClientReady() && getClient()) {
        try { await getClient().sendSeen(chatId); } catch (e) { console.warn('[read] sendSeen falló:', e.message); }
      }
      pushSseEvent('chat_read', { chatId });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/inbox/unread/:chatId', async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      // 1. Actualizar estado local: marcar el último mensaje recibido como no leído
      const msgs = inboxMessages.get(chatId);
      if (msgs) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (!msgs[i].fromMe) { msgs[i].read = false; break; }
        }
        require('./inbox').persist();
      }
      // 2. Sincronizar con el teléfono: marcar como no visto en WhatsApp
      if (isClientReady() && getClient()) {
        try {
          await getClient().markUnread(chatId);
        } catch (e) { console.warn('[unread] markUnread falló:', e.message); }
      }
      pushSseEvent('chat_unread', { chatId });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/inbox/clean', async (_req, res) => {
    try {
      const { INBOX_BASE } = require('./storage');
      if (fs.existsSync(INBOX_BASE)) fs.rmSync(INBOX_BASE, { recursive: true, force: true });
      fs.mkdirSync(INBOX_BASE, { recursive: true });
      inboxMessages.clear();
      require('./inbox').persist();
      pushSseEvent('inbox_cleaned', {});
      res.json({ ok: true, message: 'Todos los archivos de la bandeja han sido eliminados' });
    } catch (err) {
      console.error('Error limpiando inbox:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bandeja: eliminar un chat individual ──────────────────────────────────
  app.delete('/api/inbox/chat/:chatId', (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const existed = inboxMessages.has(chatId);
      inboxMessages.delete(chatId);
      require('./inbox').persist();
      pushSseEvent('chat_deleted', { chatId });
      res.json({ ok: true, deleted: existed });
    } catch (err) {
      console.error('Error eliminando chat:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inbox/path', (_req, res) => {
    const { INBOX_BASE } = require('./storage');
    res.json({ path: INBOX_BASE });
  });

  app.post('/api/inbox/install-hook', (req, res) => {
    const client = getClient();
    if (client) {
      resetInboxHook();
      installInboxHook(client);
      res.json({ ok: true, message: 'Hook instalado' });
    } else {
      res.status(503).json({ error: 'Cliente de WA no inicializado' });
    }
  });

  // ── Enviar ubicación ─────────────────────────────────────────────────────
  app.post('/api/send-location', async (req, res) => {
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
    const { phoneNumber, latitude, longitude, description } = req.body;
    if (!phoneNumber || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Faltan campos: phoneNumber, latitude, longitude' });
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'Coordenadas inválidas' });

    let chatId;
    try { chatId = await resolveChatId(phoneNumber); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    try {
      const result = await sendUbicacion(getClient(), chatId, lat, lng, description || '', '');
      if (result.success) {
        res.json({ ok: true });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (err) {
      console.error('Error enviando ubicación:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Rutas de media (voz, adjuntos, stickers, ubicación) ──────────────────
  registerMediaRoutes(app);

  // ── Rutas de contactos CRM ────────────────────────────────────────────────
  // ── Resolver chatId desde número ─────────────────────────────────────────
  // GET /api/resolve-chat?number=573001234567
  // Devuelve { chatId: "573001234567@c.us" | "85345...@lid" }
  app.get('/api/resolve-chat', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: 'Falta el parámetro number' });
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
    try {
      const chatId = await resolveChatId(number);
      res.json({ chatId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Rutas de contactos CRM ────────────────────────────────────────────────
  // Completamente aditivas. No modifican ninguna ruta existente.
  const contactsStore = require('./contacts');

  // GET /api/contacts/:chatId — devuelve { wa, crm } del contacto
  app.get('/api/contacts/:chatId', (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      res.json(contactsStore.getContact(chatId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/contacts/:chatId — guarda campos CRM editables
  // Body: { name?, email?, company?, notes?, tags? }
  app.post('/api/contacts/:chatId', (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const result = contactsStore.updateCrm(chatId, req.body);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/contacts/:chatId/sync-wa — sincroniza datos reales desde WPPConnect
  // Llama getContact + getPnLidEntry + getProfilePicFromServer + getStatus
  app.post('/api/contacts/:chatId/sync-wa', async (req, res) => {
    if (!isClientReady()) {
      return res.status(503).json({ error: 'WhatsApp no está conectado' });
    }
    const chatId = decodeURIComponent(req.params.chatId);
    const client = getClient();
    const waFields = {};

    // 1. getContact — pushname, name, isBusiness, isEnterprise, isMyContact
    try {
      const contact = await client.getContact(chatId);
      if (contact) {
        waFields.pushname     = contact.pushname     || contact.name || contact.formattedName || null;
        waFields.isBusiness   = !!contact.isBusiness;
        waFields.isEnterprise = !!contact.isEnterprise;
        waFields.isMyContact  = !!contact.isMyContact;
        // verifiedName solo en cuentas business verificadas
        if (contact.verifiedName) waFields.pushname = contact.verifiedName;
      }
    } catch (_) {}

    // 2. getPnLidEntry — resuelve número real para IDs @lid
    if (chatId.endsWith('@lid')) {
      try {
        const entry = await client.getPnLidEntry(chatId);
        // getPnLidEntry puede devolver null, o un objeto sin phoneNumber
        if (entry && entry.phoneNumber) {
          const digits = String(entry.phoneNumber).replace(/\D/g, '');
          if (digits.length >= 7) {
            // Tiene dígitos válidos — formatear
            if (digits.length >= 10) {
              const cc  = digits.slice(0, digits.length - 10);
              const sub = digits.slice(digits.length - 10);
              waFields.phone = cc ? `+${cc} ${sub.slice(0,3)} ${sub.slice(3,6)} ${sub.slice(6)}` : sub;
            } else {
              waFields.phone = `+${digits}`;
            }
          } else {
            // Número incompleto — marcar como pendiente
            waFields.phone = 'Pendiente de sincronización';
          }
        } else {
          // getPnLidEntry no devolvió número — puede ser dispositivo vinculado sin número resuelto
          waFields.phone = 'Número no disponible';
        }
      } catch (_) {
        // Error al llamar getPnLidEntry — no asumir nada
        waFields.phone = 'Pendiente de sincronización';
      }
    } else if (chatId.endsWith('@c.us')) {
      // Para @c.us el número ya está en el chatId
      const digits = chatId.replace('@c.us', '').replace(/\D/g, '');
      if (digits.length >= 10) {
        const cc  = digits.slice(0, digits.length - 10);
        const sub = digits.slice(digits.length - 10);
        waFields.phone = cc ? `+${cc} ${sub.slice(0,3)} ${sub.slice(3,6)} ${sub.slice(6)}` : sub;
      }
    }

    // 3. getProfilePicFromServer — foto de perfil real
    // Normalizar a string limpio: WPPConnect puede devolver objeto {img, eurl, ...}
    try {
      const pic = await client.getProfilePicFromServer(chatId);
      if (pic) {
        const picUrl = typeof pic === 'string' ? pic
          : pic.img || pic.eurl || pic.imgFull || pic.url || null;
        if (picUrl) waFields.profilePicUrl = picUrl;
      }
    } catch (_) {}

    // 4. getStatus — bio del contacto
    try {
      const statusObj = await client.getStatus(chatId);
      if (statusObj && statusObj.status) waFields.status = statusObj.status;
    } catch (_) {}

    const result = contactsStore.updateWa(chatId, waFields);
    res.json(result);
  });

  // ── Rutas de etiquetas globales ───────────────────────────────────────────
  // GET /api/labels — devuelve catálogo global { id, name, color }[]
  app.get('/api/labels', (_req, res) => {
    try {
      res.json(contactsStore.getGlobalLabels());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/labels — crea o actualiza una etiqueta global
  // Body: { name, color? }  → devuelve la etiqueta garantizada { id, name, color }
  app.post('/api/labels', (req, res) => {
    try {
      const { name, color } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: 'name es requerido' });
      const label = contactsStore.ensureLabel(name.trim(), color || '#22c55e');
      res.json(label);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/labels/:id — actualiza nombre o color de una etiqueta
  app.put('/api/labels/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { name, color } = req.body || {};
      const labels = contactsStore.getGlobalLabels();
      const idx = labels.findIndex((l) => l.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Etiqueta no encontrada' });
      // Evitar nombre duplicado (case-insensitive) salvo la misma etiqueta
      if (name) {
        const norm = name.trim().toLowerCase();
        const dup = labels.find((l, i) => i !== idx && l.name.toLowerCase() === norm);
        if (dup) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' });
        labels[idx].name = name.trim();
      }
      if (color) labels[idx].color = color;
      contactsStore.saveGlobalLabels(labels);
      res.json(labels[idx]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/labels/:id — elimina una etiqueta del catálogo global
  app.delete('/api/labels/:id', (req, res) => {
    try {
      const { id } = req.params;
      const labels = contactsStore.getGlobalLabels().filter((l) => l.id !== id);
      contactsStore.saveGlobalLabels(labels);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/contacts/:chatId/tags/:tag — elimina una etiqueta (ID o string legacy) de un contacto
  app.delete('/api/contacts/:chatId/tags/:tag', (req, res) => {
    try {
      const { chatId, tag } = req.params;
      const record  = contactsStore.getContact(chatId);
      const current = record?.crm?.tags || [];
      const updated = current.filter((t) => t !== decodeURIComponent(tag));
      contactsStore.updateCrm(chatId, { tags: updated });
      res.json({ ok: true, tags: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/contacts/:chatId/profile-pic — devuelve foto de perfil (caché o WPP en tiempo real)
  app.get('/api/contacts/:chatId/profile-pic', async (req, res) => {
    try {
      const { chatId } = req.params;
      const record = contactsStore.getContact(chatId);

      // Helper para extraer URL string de cualquier formato que devuelva WPPConnect
      const extractUrl = (raw) => {
        if (!raw) return null;
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'object') return raw.img || raw.eurl || raw.imgFull || raw.url || null;
        return null;
      };

      // Verificar si el token CDN de WhatsApp ya expiró (parámetro oe= en hex Unix seconds)
      // Las URLs de WA tienen oe=XXXXXXXX que indica cuándo expira el enlace firmado.
      // Si no tiene oe= (URL no-CDN) se asume válida.
      const isCdnExpired = (url) => {
        if (!url) return true;
        const m = url.match(/[?&]oe=([0-9A-Fa-f]+)/);
        if (!m) return false;
        return Date.now() > parseInt(m[1], 16) * 1000;
      };

      const cached = extractUrl(record?.wa?.profilePicUrl);

      // Devolver caché si existe y su token CDN no ha expirado
      if (cached && !isCdnExpired(cached)) {
        return res.json({ url: cached });
      }

      // URL expirada o sin caché → renovar desde WPPConnect
      if (!isClientReady() || !getClient()) {
        // WA no disponible: devolver la caché aunque esté expirada (mejor que null)
        return res.json({ url: cached || null });
      }
      try {
        const pic = await getClient().getProfilePicFromServer(chatId);
        const url = extractUrl(pic);
        if (url) {
          // Guardar URL como string limpio en caché
          contactsStore.updateWa(chatId, { profilePicUrl: url });
        }
        return res.json({ url: url || cached || null });
      } catch (_) {
        return res.json({ url: cached || null });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Link preview: extrae og:title / og:description / og:image de una URL ──
  // GET /api/link-preview?url=https://...
  // - Caché en memoria por 30 min para no repetir fetches.
  // - Timeout de 5s para no bloquear la UI.
  // - Si falla (CORS, 403, timeout) responde { ok: false } silenciosamente.
  const _linkPreviewCache = new Map(); // url → { data, expiresAt }
  const PREVIEW_TTL = 30 * 60 * 1000; // 30 minutos

  app.get('/api/link-preview', async (req, res) => {
    const { url: rawUrl } = req.query;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({ ok: false, error: 'Falta el parámetro url' });
    }

    // Validar que sea una URL http/https
    let targetUrl;
    try {
      targetUrl = new URL(rawUrl);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('Protocolo no válido');
    } catch {
      return res.status(400).json({ ok: false, error: 'URL no válida' });
    }

    // Revisar caché
    const cached = _linkPreviewCache.get(rawUrl);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.data);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          // Simular un navegador para evitar bloqueos básicos
          'User-Agent': 'Mozilla/5.0 (compatible; WaSaveBot/1.0; +https://wasavebot.app)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es,en;q=0.9',
        },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const result = { ok: false };
        _linkPreviewCache.set(rawUrl, { data: result, expiresAt: Date.now() + PREVIEW_TTL });
        return res.json(result);
      }

      const html = await response.text();

      // Extraer metatags con regex (sin depender de cheerio ni jsdom)
      const getMeta = (property) => {
        const patterns = [
          new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
          new RegExp(`<meta[^>]+name=["']${property.replace('og:', '')}["'][^>]+content=["']([^"']+)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property.replace('og:', '')}["']`, 'i'),
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m?.[1]) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        }
        return null;
      };

      // Extraer <title> como fallback
      const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;

      const title       = getMeta('og:title')       || titleTag;
      const description = getMeta('og:description') || getMeta('description');
      const image       = getMeta('og:image');
      const siteName    = getMeta('og:site_name');

      // Resolver imagen relativa a absoluta
      let imageUrl = image;
      if (imageUrl && !imageUrl.startsWith('http')) {
        try {
          imageUrl = new URL(imageUrl, rawUrl).href;
        } catch { imageUrl = null; }
      }

      // Si no hay ni título ni descripción, no vale la pena mostrar el preview
      if (!title && !description) {
        const result = { ok: false };
        _linkPreviewCache.set(rawUrl, { data: result, expiresAt: Date.now() + PREVIEW_TTL });
        return res.json(result);
      }

      const result = {
        ok: true,
        title:       title       || null,
        description: description || null,
        image:       imageUrl    || null,
        siteName:    siteName    || targetUrl.hostname,
        url:         rawUrl,
      };

      _linkPreviewCache.set(rawUrl, { data: result, expiresAt: Date.now() + PREVIEW_TTL });
      res.json(result);
    } catch (err) {
      // Timeout, CORS, red caída — respuesta silenciosa
      const result = { ok: false };
      _linkPreviewCache.set(rawUrl, { data: result, expiresAt: Date.now() + 60_000 }); // caché corta para errores
      res.json(result);
    }
  });

}

module.exports = { registerRoutes };