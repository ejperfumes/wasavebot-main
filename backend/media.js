// ============================================================
// media.js — notas de voz · adjuntos · stickers · ubicación · ffmpeg
// ============================================================

'use strict';

const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { execFile } = require('child_process');
const multer    = require('multer');

const { getClient, isClientReady, isDeadFrameError, reconectarSiMuerto } = require('./whatsapp');
const { addInboxMessage, pushSseEvent, saveOutgoingMedia, recentOutgoingChats, inboxMessages } = require('./inbox');
const { esperarConTyping, throttleMessages }                              = require('./humanizer');
const { INBOX_BASE }                                                      = require('./storage');

// ── Multers ────────────────────────────────────────────────────────────────
const audioUpload  = multer({ storage: multer.memoryStorage() });
const attachUpload = multer({ storage: multer.memoryStorage() });
const STICKERS_DIR = path.join(__dirname, 'media', 'stickers');
if (!fs.existsSync(STICKERS_DIR)) fs.mkdirSync(STICKERS_DIR, { recursive: true });
const stickerUpload = multer({ storage: multer.memoryStorage() });

function inferMediaType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext))          return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a', 'opus'].includes(ext))          return 'audio';
  return 'document';
}

// ── Conversión ffmpeg a ogg/opus ──────────────────────────────────────────────
function convertToOggOpus(inputBuffer) {
  return new Promise((resolve, reject) => {
    let ffmpegPath;
    try { ffmpegPath = require('ffmpeg-static'); }
    catch { ffmpegPath = 'ffmpeg'; }

    const tmpIn  = path.join(os.tmpdir(), `wa_in_${Date.now()}.webm`);
    const tmpOut = path.join(os.tmpdir(), `wa_out_${Date.now()}.ogg`);

    try { fs.writeFileSync(tmpIn, inputBuffer); }
    catch (err) { return reject(new Error('No se pudo escribir archivo temporal de entrada')); }

    execFile(ffmpegPath, [
      '-y', '-i', tmpIn,
      '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-compression_level', '10',
      tmpOut,
    ], (err, _stdout, stderr) => {
      try { fs.unlinkSync(tmpIn); } catch {}
      if (err) {
        try { fs.unlinkSync(tmpOut); } catch {}
        return reject(new Error('ffmpeg error: ' + stderr));
      }
      try {
        const outBuffer = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpOut);
        resolve(outBuffer);
      } catch (readErr) { reject(readErr); }
    });
  });
}

// ── Registrar rutas en la app Express ────────────────────────────────────────
function registerMediaRoutes(app) {

  // Servir stickers estáticos
  app.use('/media/stickers', require('express').static(STICKERS_DIR));

  // ── Stickers ─────────────────────────────────────────────────────────────
  app.post('/api/stickers/upload', stickerUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const filename = `${Date.now()}_${req.file.originalname}`;
    const filePath = path.join(STICKERS_DIR, filename);
    fs.writeFileSync(filePath, req.file.buffer);
    res.json({ ok: true, url: `/media/stickers/${filename}`, name: req.file.originalname });
  });

  app.get('/api/stickers/list', (_req, res) => {
    try {
      const files = fs.readdirSync(STICKERS_DIR).map((f) => ({ name: f, url: `/media/stickers/${f}` }));
      res.json(files);
    } catch { res.json([]); }
  });

  app.delete('/api/stickers/:filename', (req, res) => {
    const filePath = path.join(STICKERS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  });

// ── Ubicación — delegado a whatsapp.js (sendUbicacion con reintentos) ─────
app.post('/api/send-location', async (req, res) => {
  if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
  const { phoneNumber, latitude, longitude, description = '' } = req.body;
  if (!phoneNumber || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Faltan datos: phoneNumber, latitude, longitude' });
  }
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'Coordenadas inválidas' });

  let chatId = phoneNumber.replace(/\s+/g, '');
  if (!chatId.includes('@')) chatId = `${chatId}@c.us`;

  try {
    const { sendUbicacion } = require('./whatsapp');

    recentOutgoingChats.set(chatId, Date.now());
    setTimeout(() => recentOutgoingChats.delete(chatId), 15000);

    const result = await sendUbicacion(getClient(), chatId, lat, lng, description, '');
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    const finalChatId = result.resolvedId || chatId;
    if (finalChatId !== chatId) {
      recentOutgoingChats.set(finalChatId, Date.now());
      setTimeout(() => recentOutgoingChats.delete(finalChatId), 15000);
    }

    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    const now     = Math.floor(Date.now() / 1000);
    const msgObj  = {
      id:                  `outgoing_${Date.now()}`,
      from:                finalChatId,
      fromMe:              true,
      body:                description ? `📍 *${description}*\n${mapsUrl}` : `📍 ${mapsUrl}`,
      type:                'location',
      timestamp:           now,
      senderName:          'Yo',
      hasMedia:            false,
      mediaUrl:            null,
      mediaMime:           null,
      mediaDownloaded:     false,
      mediaId:             null,
      fileName:            null,
      latitude:            lat,
      longitude:           lng,
      locationDescription: description || null,
    };
    addInboxMessage(finalChatId, msgObj);
    pushSseEvent('new_message', { chatId: finalChatId, message: msgObj });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando ubicación:', err);
    await reconectarSiMuerto(err);
    res.status(500).json({
      error: isDeadFrameError(err) ? 'WhatsApp se desconectó, reconectando automáticamente...' : err.message,
    });
  }
});

  // ── Nota de voz ───────────────────────────────────────────────────────────
  app.post('/api/send-voice-note', audioUpload.single('audio'), async (req, res) => {
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
    const { phoneNumber } = req.body;
    const audioFile = req.file;
    if (!phoneNumber || !audioFile) {
      return res.status(400).json({ error: 'Faltan datos: phoneNumber o archivo de audio' });
    }
    let chatId = phoneNumber.replace(/\s+/g, '');
    if (!chatId.includes('@')) chatId = `${chatId}@c.us`;

    try {
      let audioBuffer = audioFile.buffer;

      try {
        const converted = await convertToOggOpus(audioFile.buffer);
        if (converted) audioBuffer = converted;
        else throw new Error('conversión falló');
      } catch (convErr) {
        console.warn('⚠️ Conversión a ogg/opus falló, enviando audio original:', convErr.message);
      }

      const base64Audio = audioBuffer.toString('base64');

      recentOutgoingChats.set(chatId, Date.now());
      setTimeout(() => recentOutgoingChats.delete(chatId), 30000);

      await getClient().sendPttFromBase64(chatId, base64Audio, 'nota_de_voz.ogg');

      const audioMime = 'audio/ogg';
      const mediaUrl  = saveOutgoingMedia(audioBuffer, audioMime, 'nota_de_voz.ogg');
      const now       = Math.floor(Date.now() / 1000);
      const msgObj    = {
        id:                  `outgoing_${Date.now()}`,
        from:                chatId,
        fromMe:              true,
        body:                '',
        type:                'ptt',
        timestamp:           now,
        senderName:          'Yo',
        hasMedia:            true,
        mediaUrl,
        mediaMime:           audioMime,
        mediaDownloaded:     !!mediaUrl,
        mediaId:             null,
        fileName:            'nota_de_voz.ogg',
        latitude:            null,
        longitude:           null,
        locationDescription: null,
      };
      addInboxMessage(chatId, msgObj);

      const chatMsgs = inboxMessages.get(chatId);
      if (chatMsgs) {
        for (const m of chatMsgs) { if (!m.fromMe && !m.read) m.read = true; }
      }

      pushSseEvent('new_message', { chatId, message: msgObj });
      res.json({ ok: true });

    } catch (error) {
      console.error('Error enviando nota de voz:', error);
      await reconectarSiMuerto(error);
      res.status(500).json({
        error: isDeadFrameError(error) ? 'WhatsApp se desconectó, reconectando automáticamente...' : error.message,
      });
    }
  });

  // ── Adjunto (imagen / video / documento / sticker) ────────────────────────
  app.post('/api/send-attachment', attachUpload.single('file'), async (req, res) => {
    if (!isClientReady()) return res.status(503).json({ error: 'WhatsApp no está conectado' });
    const { phoneNumber, caption = '', asSticker = 'false' } = req.body;
    const file = req.file;
    if (!phoneNumber || !file) return res.status(400).json({ error: 'Faltan datos' });

    let chatId = phoneNumber.replace(/\s+/g, '');
    if (!chatId.includes('@')) chatId = `${chatId}@c.us`;

    try {
      const isStickerMode = asSticker === 'true';
      const cleanMime     = isStickerMode ? 'image/webp' : file.mimetype.split(';')[0].trim();
      const base64        = file.buffer.toString('base64');
      const dataUri       = `data:${file.mimetype};base64,${base64}`;

      recentOutgoingChats.set(chatId, Date.now());
      setTimeout(() => recentOutgoingChats.delete(chatId), 30000);

      if (isStickerMode) {
        await getClient().sendImageAsSticker(chatId, dataUri);
      } else {
        await getClient().sendFile(chatId, dataUri, file.originalname, caption || '');
      }

      const mediaUrl = saveOutgoingMedia(file.buffer, cleanMime, file.originalname);
      const now      = Math.floor(Date.now() / 1000);
      const msgObj   = {
        id:                  `outgoing_${Date.now()}`,
        from:                chatId,
        fromMe:              true,
        body:                caption || '',
        type:                isStickerMode ? 'sticker' : (
          file.mimetype.startsWith('image/') ? 'image' :
          file.mimetype.startsWith('video/') ? 'video' :
          file.mimetype.startsWith('audio/') ? 'audio' : 'document'
        ),
        timestamp:           now,
        senderName:          'Yo',
        hasMedia:            true,
        mediaUrl,
        mediaMime:           cleanMime,
        mediaDownloaded:     !!mediaUrl,
        mediaId:             null,
        fileName:            file.originalname,
        latitude:            null,
        longitude:           null,
        locationDescription: null,
      };
      addInboxMessage(chatId, msgObj);

      const chatMsgs = inboxMessages.get(chatId);
      if (chatMsgs) {
        for (const m of chatMsgs) { if (!m.fromMe && !m.read) m.read = true; }
      }

      pushSseEvent('new_message', { chatId, message: msgObj });
      res.json({ ok: true });

    } catch (err) {
      console.error('Error enviando adjunto:', err);
      await reconectarSiMuerto(err);
      res.status(500).json({
        error: isDeadFrameError(err) ? 'WhatsApp se desconectó, reconectando automáticamente...' : err.message,
      });
    }
  });
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  registerMediaRoutes,
  inferMediaType,
  convertToOggOpus,
  audioUpload,
  attachUpload,
  stickerUpload,
  STICKERS_DIR,
};
