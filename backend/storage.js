// ============================================================
// storage.js — config.json · inbox-history · connection-name
// Sin dependencias del cliente de WhatsApp.
// MULTI-CUENTA: soporta ACCOUNT_ID por variable de entorno.
//   Cada cuenta tiene sus propios archivos de datos pero
//   comparte la misma carpeta media/ de biblioteca.
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// ── ID de cuenta (vacío = comportamiento original, cuenta 1) ─────────────────
// Se puede pasar como variable de entorno: ACCOUNT_ID=cuenta2 node server.js
const ACCOUNT_ID = (process.env.ACCOUNT_ID || '').trim();

// Sufijo para los archivos de datos de esta cuenta
const ACCOUNT_SUFFIX = ACCOUNT_ID ? `-${ACCOUNT_ID}` : '';

// Nombre de sesión WPPConnect (debe ser único por cuenta)
const SESSION_NAME = ACCOUNT_ID ? `wasavebot-${ACCOUNT_ID}` : 'wasavebot';

// ── Rutas absolutas ──────────────────────────────────────────────────────────
// Los datos de cada cuenta van en archivos separados
const configPath       = path.join(__dirname, `config${ACCOUNT_SUFFIX}.json`);
const inboxPersistPath = path.join(__dirname, `inbox-history${ACCOUNT_SUFFIX}.json`);
const namePath         = path.join(__dirname, `connection-name${ACCOUNT_SUFFIX}.json`);
const TOKENS_DIR       = path.join(__dirname, 'wppconnect_tokens');

// La biblioteca de media es COMPARTIDA entre todas las cuentas
const INBOX_BASE       = path.join(__dirname, 'media', 'inbox');

if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true });
if (!fs.existsSync(INBOX_BASE)) fs.mkdirSync(INBOX_BASE, { recursive: true });

// ── Estado interno ───────────────────────────────────────────────────────────
let config         = { flows: [], quickReplies: [] };
let connectionName = '';

// ── Migración de keywords heredadas ─────────────────────────────────────────
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
          type:              s.type ?? 'text',
          content:           s.content ?? '',
          caption:           s.caption ?? '',
          delayMin:          (Number(s.delayMin) > 100) ? Math.round(Number(s.delayMin) / 1000) : (Number(s.delayMin) || 8),
          delayMax:          (Number(s.delayMax) > 100) ? Math.round(Number(s.delayMax) / 1000) : (Number(s.delayMax) || 10),
          simulateTyping:    !!s.simulateTyping,
          simulateRecording: !!s.simulateRecording,
        }));
      }
      flow.initialDelayMin = Number(flow.initialDelayMin) || 0;
      flow.initialDelayMax = Number(flow.initialDelayMax) || 0;
      if (!flow.schedules) flow.schedules = [];
    });
  }
  if (!cfg.quickReplies) cfg.quickReplies = [];
  return cfg;
}

// ── Config ───────────────────────────────────────────────────────────────────
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

function getConfig()          { return config; }
function setConfig(newConfig) { config = newConfig; }

// ── Transformaciones frontend ↔ backend ─────────────────────────────────────
function stepsToFrontend(steps, prefix) {
  return (steps || []).map((s, si) => ({
    id:                s.id || `step-${prefix}-${si}`,
    type:              s.type ?? 'text',
    content:           Array.isArray(s.content) ? s.content.join(' | ') : (s.content ?? ''),
    caption:           s.caption ?? '',
    delayMin:          Number(s.delayMin) || 8,
    delayMax:          Number(s.delayMax) || 10,
    simulateTyping:    !!s.simulateTyping,
    simulateRecording: !!s.simulateRecording,
    title:             s.title ?? '',
  }));
}

function stepsFromFrontend(steps) {
  return (steps || []).map((s) => {
    let content = s.content ?? '';
    if (s.type === 'text' && typeof content === 'string' && content.includes(' | ')) {
      content = content.split(' | ').map((t) => t.trim());
    }
    return {
      id:                s.id,
      type:              s.type ?? 'text',
      content,
      caption:           s.caption ?? '',
      delayMin:          Number(s.delayMin) || 8,
      delayMax:          Number(s.delayMax) || 10,
      simulateTyping:    !!s.simulateTyping,
      simulateRecording: !!s.simulateRecording,
      title:             s.title ?? '',
    };
  });
}

function configToFrontend(cfg) {
  return {
    quickReplies: (cfg.quickReplies || []).map((qr) => ({
      id:             qr.id,
      name:           qr.name ?? '',
      color:          qr.color ?? '#22c55e',
      editBeforeSend: !!qr.editBeforeSend,
      steps:          stepsToFrontend(qr.steps, qr.id),
    })),
    flows: (cfg.flows || []).map((flow, fi) => ({
      id:              flow.id || `flow-${fi}`,
      name:            flow.name ?? '',
      keywords:        (flow.keywords || []).map((kw) => ({ value: kw.text ?? '', match: kw.matchType ?? 'contains' })),
      steps:           stepsToFrontend(flow.steps, `${fi}`),
      initialDelayMin: Number(flow.initialDelayMin) || 0,
      initialDelayMax: Number(flow.initialDelayMax) || 0,
      schedules:       (flow.schedules || []).map((s) => ({
        id:        s.id,
        hourStart: Number(s.hourStart) || 0,
        hourEnd:   Number(s.hourEnd)   || 23,
        flowId:    s.flowId ?? '',
      })),
    })),
  };
}

function configFromFrontend(body) {
  return {
    quickReplies: (body.quickReplies || []).map((qr) => ({
      id:             qr.id,
      name:           qr.name ?? '',
      color:          qr.color ?? '#22c55e',
      editBeforeSend: !!qr.editBeforeSend,
      steps:          stepsFromFrontend(qr.steps),
    })),
    flows: (body.flows || []).map((flow) => ({
      id:              flow.id,
      name:            flow.name ?? '',
      keywords:        (flow.keywords || []).map((kw) => ({ text: kw.value ?? '', matchType: kw.match ?? 'contains' })),
      steps:           stepsFromFrontend(flow.steps),
      initialDelayMin: Number(flow.initialDelayMin) || 0,
      initialDelayMax: Number(flow.initialDelayMax) || 0,
      schedules:       (flow.schedules || []).map((s) => ({
        id:        s.id,
        hourStart: Number(s.hourStart) || 0,
        hourEnd:   Number(s.hourEnd)   || 23,
        flowId:    s.flowId ?? '',
      })),
    })),
  };
}

// ── Inbox history ────────────────────────────────────────────────────────────
const MAX_MESSAGES_PER_CHAT = 200;
const MAX_CHATS             = 500;

let _persistTimer   = null;
let _persistWriting = false;

// ── Normalización de contrato de mensaje ─────────────────────────────────────
function normalizeMessage(msg) {
  return {
    ...msg,
    read:            msg.fromMe ? true : (msg.read ?? false),
    contextInfo:     msg.contextInfo     ?? null,
    isForwarded:     msg.isForwarded     ?? false,
    forwardingScore: msg.forwardingScore ?? 0,
    fileName:        msg.fileName        ?? null,
  };
}

function persistInboxHistory(inboxMessages) {
  if (_persistTimer) return;
  _persistTimer = setTimeout(async () => {
    _persistTimer = null;

    if (_persistWriting) {
      _persistTimer = setTimeout(() => {
        _persistTimer = null;
        persistInboxHistory(inboxMessages);
      }, 2000);
      return;
    }

    _persistWriting  = true;
    const tmpPath    = inboxPersistPath + '.tmp';

    try {
      const obj = {};
      for (const [chatId, msgs] of inboxMessages.entries()) {
        obj[chatId] = msgs.map(({ mediaData, ...rest }) => rest);
      }
      const json = JSON.stringify(obj);

      await fs.promises.writeFile(tmpPath, json);

      try {
        await fs.promises.rename(tmpPath, inboxPersistPath);
      } catch (renameErr) {
        console.error('⚠️  rename falló, intentando escritura directa:', renameErr.message);
        await fs.promises.writeFile(inboxPersistPath, json);
      }
    } catch (e) {
      console.error('⚠️  Error persistiendo historial:', e.message);
    } finally {
      _persistWriting = false;
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  }, 2000);
}

function loadInboxHistory(inboxMessages) {
  try {
    if (fs.existsSync(inboxPersistPath)) {
      const raw = JSON.parse(fs.readFileSync(inboxPersistPath, 'utf8'));
      for (const [chatId, msgs] of Object.entries(raw)) {
        if (Array.isArray(msgs) && msgs.length) {
          inboxMessages.set(chatId, msgs.slice(-MAX_MESSAGES_PER_CHAT).map(normalizeMessage));
        }
      }
      console.log(`📂 Historial de bandeja cargado: ${inboxMessages.size} chats`);
    }
  } catch (e) {
    console.error('⚠️  No se pudo cargar inbox-history.json:', e.message);
  }
}

// ── Connection name ──────────────────────────────────────────────────────────
function loadConnectionName() {
  try {
    if (fs.existsSync(namePath)) {
      const data = fs.readFileSync(namePath, 'utf8');
      const json = JSON.parse(data);
      connectionName = json.name || '';
    }
  } catch (e) {
    console.error('Error leyendo nombre de conexión:', e);
  }
}

function saveConnectionName(name) {
  try {
    connectionName = name;
    fs.writeFileSync(namePath, JSON.stringify({ name }, null, 2));
  } catch (e) {
    console.error('Error guardando nombre de conexión:', e);
  }
}

function getConnectionName()      { return connectionName; }

// ── Auth folder (logout) ─────────────────────────────────────────────────────
async function deleteAuthFolder() {
  const authPath = path.join(TOKENS_DIR, SESSION_NAME);
  if (fs.existsSync(authPath)) {
    try {
      console.log('🗑️ Eliminando carpeta de autenticación:', authPath);
      await fs.promises.rm(authPath, { recursive: true, force: true });
      console.log('✅ Carpeta eliminada correctamente');
      return true;
    } catch (err) {
      console.error('❌ Error al eliminar carpeta:', err);
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`rmdir /s /q "${authPath}"`, (error) => {
          if (error) console.error('Fallback falló:', error);
          else console.log('Fallback exitoso');
        });
      }
      return false;
    }
  } else {
    console.log('No existe carpeta de autenticación');
    return true;
  }
}

function hasSession() {
  return fs.existsSync(path.join(TOKENS_DIR, SESSION_NAME));
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // rutas
  configPath,
  inboxPersistPath,
  namePath,
  TOKENS_DIR,
  INBOX_BASE,
  // identidad de cuenta
  ACCOUNT_ID,
  SESSION_NAME,
  // constantes
  MAX_MESSAGES_PER_CHAT,
  MAX_CHATS,
  // config
  loadConfig,
  saveConfig,
  getConfig,
  setConfig,
  configToFrontend,
  configFromFrontend,
  // inbox persistence
  loadInboxHistory,
  persistInboxHistory,
  normalizeMessage,
  // connection name
  loadConnectionName,
  saveConnectionName,
  getConnectionName,
  // auth
  deleteAuthFolder,
  hasSession,
};
