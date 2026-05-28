const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ MIDDLEWARES ============
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use('/media', express.static(path.join(__dirname, 'media')));

// ============ CONFIGURACIÓN DE ALMACENAMIENTO DE ARCHIVOS ============
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'documentos';
    if (file.mimetype.startsWith('image/')) folder = 'imagenes';
    else if (file.mimetype.startsWith('audio/')) folder = 'audios';
    else if (file.mimetype.startsWith('video/')) folder = 'videos';
    const dir = path.join(__dirname, 'media', folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Guardar con el nombre original del archivo
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// ============ HELPERS DE TIPO DE ARCHIVO ============
function inferMediaType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a', 'opus'].includes(ext)) return 'audio';
  return 'document';
}

// ============ CONFIG (flujos) ============
const configPath = path.join(__dirname, 'config.json');
let config = { flows: [] };

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = migrateConfig(config);
    } catch (e) {
      console.error('Error leyendo config.json:', e.message);
    }
  } else {
    saveConfig();
  }
}

function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function migrateKeywords(keywords) {
  if (!keywords || keywords.length === 0) return [];
  if (typeof keywords[0] === 'string') {
    return keywords.map((k) => ({ text: k, matchType: 'contains' }));
  }
  if ('value' in keywords[0]) {
    return keywords.map((k) => ({ text: k.value ?? '', matchType: k.match ?? 'contains' }));
  }
  return keywords;
}

function migrateConfig(cfg) {
  if (cfg.flows) {
    cfg.flows.forEach((flow) => {
      flow.keywords = migrateKeywords(flow.keywords || []);
      if (flow.steps) {
        flow.steps = flow.steps.map((s) => ({
          type: s.type ?? 'text',
          content: s.content ?? '',
          caption: s.caption ?? '',
          delayMin: Number(s.delayMin) || 1000,
          delayMax: Number(s.delayMax) || 4000,
          simulateTyping: !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
        }));
      }
    });
  }
  return cfg;
}

function configToFrontend(cfg) {
  return {
    flows: (cfg.flows || []).map((flow, fi) => ({
      id: flow.id || `flow-${fi}`,
      name: flow.name ?? '',
      keywords: (flow.keywords || []).map((kw) => ({
        value: kw.text ?? '',
        match: kw.matchType ?? 'contains',
      })),
      steps: (flow.steps || []).map((s, si) => ({
        id: s.id || `step-${fi}-${si}`,
        type: s.type ?? 'text',
        content: Array.isArray(s.content) ? s.content.join(' | ') : (s.content ?? ''),
        caption: s.caption ?? '',
        delayMin: Number(s.delayMin) || 1000,
        delayMax: Number(s.delayMax) || 4000,
        simulateTyping: !!s.simulateTyping,
        simulateRecording: !!s.simulateRecording,
      })),
    })),
  };
}

function configFromFrontend(body) {
  return {
    flows: (body.flows || []).map((flow) => ({
      id: flow.id,
      name: flow.name ?? '',
      keywords: (flow.keywords || []).map((kw) => ({
        text: kw.value ?? '',
        matchType: kw.match ?? 'contains',
      })),
      steps: (flow.steps || []).map((s) => {
        let content = s.content ?? '';
        if (s.type === 'text' && typeof content === 'string' && content.includes(' | ')) {
          content = content.split(' | ').map((t) => t.trim());
        }
        return {
          id: s.id,
          type: s.type ?? 'text',
          content,
          caption: s.caption ?? '',
          delayMin: Number(s.delayMin) || 1000,
          delayMax: Number(s.delayMax) || 4000,
          simulateTyping: !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
        };
      }),
    })),
  };
}

loadConfig();

// ============ NORMALIZACIÓN Y MATCHING DE KEYWORDS ============
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()\[\]{}<>]/g, '');
}

function matchesKeyword(message, keyword) {
  const msgNorm = normalizeText(message);
  const kwNorm = normalizeText(keyword.text);
  switch (keyword.matchType) {
    case 'exact':     return msgNorm === kwNorm;
    case 'startsWith': return msgNorm.startsWith(kwNorm);
    case 'endsWith':  return msgNorm.endsWith(kwNorm);
    case 'contains':
    default:          return msgNorm.includes(kwNorm);
  }
}

// ============ CLIENTE WHATSAPP ============
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wasavebot' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

let isReady = false;
let messageQueue = [];
let processing = false;
let lastMessageSentTime = 0;
const MIN_INTERVAL_MS = 1500;

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('📱 Escanea el código QR con WhatsApp');
});

client.on('ready', () => {
  isReady = true;
  console.log('✅ Bot conectado a WhatsApp');
  processQueue();
});

client.on('message', async (message) => {
  if (!isReady || message.fromMe) return;
  messageQueue.push(message);
  processQueue();
});

async function processQueue() {
  if (processing || messageQueue.length === 0) return;
  processing = true;
  const msg = messageQueue.shift();
  try {
    await procesarMensajeConFlujo(msg);
  } catch (err) {
    console.error('Error procesando mensaje:', err);
  }
  processing = false;
  processQueue();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 4000) {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return delay(ms);
}

async function simulateHumanTyping(chatId, text) {
  try {
    const chat = await client.getChatById(chatId);
    if (!chat) return;
    const duration = Math.max(800, Math.min(5000, text.length * 50 + (Math.random() * 1000 - 500)));
    await chat.sendStateTyping();
    await delay(duration);
    await chat.clearState();
  } catch (err) {
    console.error('Error simulando escritura:', err);
  }
}

async function throttleMessages() {
  const now = Date.now();
  const timeSinceLast = now - lastMessageSentTime;
  if (timeSinceLast < MIN_INTERVAL_MS) {
    await delay(MIN_INTERVAL_MS - timeSinceLast);
  }
  lastMessageSentTime = Date.now();
}

async function procesarMensajeConFlujo(msg) {
  const body = msg.body;
  const flow = config.flows.find((f) => f.keywords.some((kw) => matchesKeyword(body, kw)));
  if (!flow) return;

  for (const step of flow.steps) {
    const delayMin = step.delayMin || 1000;
    const delayMax = step.delayMax || 4000;
    await randomDelay(delayMin, delayMax);
    await throttleMessages();

    if (step.simulateTyping) {
      const typingText =
        step.type === 'text'
          ? Array.isArray(step.content) ? step.content[0] || '' : step.content
          : step.caption || '📎 Enviando archivo...';
      await simulateHumanTyping(msg.from, typingText);
    }

    if (step.simulateRecording && step.type === 'audio') {
      await msg.reply('🎤 Grabando audio...');
      await randomDelay(1500, 3000);
    }

    switch (step.type) {
      case 'text': {
        let textToSend = step.content;
        if (Array.isArray(step.content) && step.content.length > 0) {
          textToSend = step.content[Math.floor(Math.random() * step.content.length)];
        }
        await msg.reply(textToSend);
        break;
      }
      case 'image':
      case 'video':
      case 'audio':
      case 'document': {
        const filePath = step.content.startsWith('/')
          ? path.join(__dirname, step.content)
          : step.content;
        if (fs.existsSync(filePath)) {
          const media = MessageMedia.fromFilePath(filePath);
          await msg.reply(media, undefined, { caption: step.caption || '' });
        } else {
          await msg.reply(`❌ Archivo no encontrado: ${step.content}`);
        }
        break;
      }
      default:
        console.warn(`Tipo de paso desconocido: ${step.type}`);
    }
  }
}

// ============ API REST ============

app.get('/api/config', (req, res) => {
  res.json(configToFrontend(config));
});

app.post('/api/config', (req, res) => {
  try {
    config = configFromFrontend(req.body);
    saveConfig();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  const relativePath = '/media/' + path.relative(path.join(__dirname, 'media'), req.file.path).replace(/\\/g, '/');
  const mediaType = inferMediaType(req.file.originalname);
  res.json({
    name: req.file.originalname,
    path: relativePath,
    type: mediaType,
    size: req.file.size,
  });
});

app.get('/api/media-list', (req, res) => {
  const folders = {
    imagenes: 'image',
    videos: 'video',
    audios: 'audio',
    documentos: 'document',
  };
  const items = [];
  for (const [folder, type] of Object.entries(folders)) {
    const dir = path.join(__dirname, 'media', folder);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((f) => {
        items.push({
          name: f,
          path: `/media/${folder}/${f}`,
          type,
          size: fs.statSync(path.join(dir, f)).size,
        });
      });
    }
  }
  res.json(items);
});

app.delete('/api/media/:folder/:filename', (req, res) => {
  const { folder, filename } = req.params;
  const allowed = ['imagenes', 'videos', 'audios', 'documentos'];
  if (!allowed.includes(folder)) {
    return res.status(400).json({ error: 'Carpeta no válida' });
  }
  const filePath = path.join(__dirname, 'media', folder, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/send-message', async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ error: 'WhatsApp no está conectado aún' });
  }

  const { number, type, content, caption, simulateTyping, simulateRecording, delayMs } = req.body;

  if (!number || !type || !content) {
    return res.status(400).json({ error: 'Faltan campos requeridos: number, type, content' });
  }

  let chatId = number.replace(/\s+/g, '');
  if (!chatId.includes('@')) {
    chatId = `${chatId}@c.us`;
  }

  try {
    if (delayMs && delayMs > 0) await delay(delayMs);

    if (simulateTyping) {
      const typingText = type === 'text' ? content : caption || '📎 Enviando archivo...';
      await simulateHumanTyping(chatId, typingText);
    }

    if (simulateRecording && type === 'audio') {
      await client.sendMessage(chatId, '🎤 Grabando audio...');
      await randomDelay(1500, 3000);
    }

    if (type === 'text') {
      await client.sendMessage(chatId, content);
    } else {
      const filePath = content.startsWith('/')
        ? path.join(__dirname, content)
        : content;
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: `Archivo no encontrado: ${content}` });
      }
      const media = MessageMedia.fromFilePath(filePath);
      await client.sendMessage(chatId, media, { caption: caption || '' });
    }

    await throttleMessages();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al enviar mensaje:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ INICIAR ============
client.initialize();
app.listen(PORT, () => {
  console.log(`🌐 Backend WaSaveBot corriendo en http://localhost:${PORT}`);
  console.log(`📡 Conecta el frontend apuntando a http://localhost:${PORT}`);
});