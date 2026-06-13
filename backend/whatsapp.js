// ============================================================
// whatsapp.js — WPPConnect · reconexión exponencial · heartbeat
// Gestiona el ciclo de vida del cliente WA. Exporta getters para
// que el resto de módulos accedan al cliente sin guardar referencias.
// MULTI-CUENTA: usa SESSION_NAME de storage para aislar sesiones.
// ============================================================

'use strict';

const wppconnect     = require('@wppconnect-team/wppconnect');
const fs             = require('fs');
const path           = require('path');

const { TOKENS_DIR, SESSION_NAME, deleteAuthFolder, hasSession } = require('./storage');
const { delay }                                     = require('./humanizer');
const { pushSseEvent, installInboxHook, resetInboxHook } = require('./inbox');

// ── Estado del cliente ────────────────────────────────────────────────────────
let currentClient      = null;
let currentStatus      = 'disconnected';
let currentQrDataURL   = null;
let currentClientReady = false;

// ── Cola de mensajes ──────────────────────────────────────────────────────────
let messageQueue = [];
let processing   = false;

// ── Control de reconexión ─────────────────────────────────────────────────────
let _reconnectAttempts = 0;
let _reconnectTimer    = null;
let _isInitializing    = false;
let _heartbeatTimer    = null;

// ── Getters públicos (nunca expongas los let directamente) ───────────────────
function getClient()      { return currentClient; }
function getStatus()      { return currentStatus; }
function getQrDataURL()   { return currentQrDataURL; }
function isClientReady()  { return currentClientReady; }
function getMessageQueue(){ return messageQueue; }
function isProcessing()   { return processing; }
function setProcessing(v) { processing = v; }

// ── Helpers privados ──────────────────────────────────────────────────────────
function isDeadFrameError(err) {
  const msg = err?.message || '';
  return msg.includes('Target closed') || msg.includes('detached Frame') || msg.includes('Session closed');
}

async function reconectarSiMuerto(err) {
  if (isDeadFrameError(err)) {
    console.warn('⚠️ Frame muerto detectado. Reconectando WhatsApp en 3s...');
    currentClientReady = false;
    currentStatus      = 'disconnected';
    setTimeout(async () => {
      try { await initializeClient(); }
      catch (e) { console.error('❌ Error al reconectar:', e.message); }
    }, 3000);
  }
}

async function killChromiumZombies() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('pkill -f "chromium|chrome" 2>/dev/null || true', () => resolve());
  });
}

async function destroyClientSafely() {
  if (!currentClient) return;
  const client = currentClient;
  currentClient = null;
  try {
    await Promise.race([
      client.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('close timeout')), 8000)),
    ]);
  } catch (e) {
    console.warn('⚠️  close() no respondió limpiamente:', e.message);
    await killChromiumZombies();
  }
  await delay(1500);
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
function startHeartbeat() {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer);
  _heartbeatTimer = setInterval(async () => {
    if (!currentClientReady || !currentClient) return;
    try {
      const state = await Promise.race([
        currentClient.getConnectionState(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('heartbeat timeout')), 10000)),
      ]);
      if (state !== 'CONNECTED') {
        console.warn('💔 Heartbeat detectó estado inválido:', state, '— reconectando...');
        currentClientReady = false;
        currentStatus      = 'disconnected';
        pushSseEvent('status_change', { status: 'disconnected' });
        scheduleReconnect();
      }
    } catch (e) {
      console.warn('💔 Heartbeat falló:', e.message, '— reconectando...');
      currentClientReady = false;
      currentStatus      = 'disconnected';
      pushSseEvent('status_change', { status: 'disconnected' });
      scheduleReconnect();
    }
  }, 5 * 60 * 1000); // cada 5 minutos
}

// ── Reconexión exponencial ────────────────────────────────────────────────────
function scheduleReconnect() {
  if (_reconnectTimer) return;
  const waitSec = Math.min(5 * Math.pow(2, _reconnectAttempts), 300);
  _reconnectAttempts++;
  console.log(`🔄 Reconectando en ${waitSec}s... (intento #${_reconnectAttempts})`);
  _reconnectTimer = setTimeout(async () => {
    _reconnectTimer = null;
    try { await initializeClient(); }
    catch (e) {
      console.error('❌ Error al reconectar:', e.message);
      scheduleReconnect();
    }
  }, waitSec * 1000);
}

// ── Inicialización principal ──────────────────────────────────────────────────
async function initializeClient(processQueueFn = null) {
  if (_isInitializing) {
    console.log('⏳ Ya hay una inicialización en curso, ignorando...');
    return;
  }
  _isInitializing = true;

  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

  await destroyClientSafely();

  currentStatus      = 'connecting';
  currentQrDataURL   = null;
  currentClientReady = false;
  messageQueue       = [];
  processing         = false;

  console.log(`🔄 Creando cliente WPPConnect [sesión: ${SESSION_NAME}]... (intento ${_reconnectAttempts + 1})`);

  try {
    const client = await Promise.race([
      wppconnect.create({
        // SESSION_NAME es único por cuenta (ej: wasavebot, wasavebot-cuenta2)
        session: SESSION_NAME,

        tokenStore:      'file',
        folderNameToken: TOKENS_DIR,

        catchQR: async (base64Qr, asciiQR) => {
          currentStatus    = 'connecting';
          currentQrDataURL = base64Qr; // WPPConnect ya entrega data URL
          console.log(`📱 Nuevo QR generado [${SESSION_NAME}]`);
          if (asciiQR) console.log(asciiQR);
        },

        onLoadingScreen: (percent, message) => {
          console.log(`⏳ Cargando WhatsApp [${SESSION_NAME}]: ${percent}% - ${message}`);
        },

        statusFind: (status, session) => {
          console.log('🔁 Estado WPPConnect:', status, '| Sesión:', session);

          if (status === 'inChat' || status === 'isLogged' || status === 'qrReadSuccess') {
            currentStatus      = 'connected';
            currentQrDataURL   = null;
            currentClientReady = true;
            _reconnectAttempts = 0;
            console.log(`✅ Bot conectado a WhatsApp [${SESSION_NAME}]`);
            pushSseEvent('status_change', { status: 'connected' });
            startHeartbeat();
            if (processQueueFn) processQueueFn();
            if (!currentClient) {
              resetInboxHook();
              installInboxHook(currentClient);
            }

          } else if (status === 'notLogged' || status === 'deleteToken') {
            console.error('❌ Sesión expirada o inválida:', status);
            currentStatus      = 'qr_required';
            currentClientReady = false;
            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
            console.warn('⚠️  La sesión de WhatsApp expiró. Ve a la interfaz → "Conectar" y escanea el QR.');
            pushSseEvent('status_change', { status: 'qr_required', message: 'La sesión expiró. Escanea el QR nuevamente.' });

          } else if (status === 'desconnectedMobile' || status === 'browserClose' || status === 'autocloseCalled') {
            console.log('⚠️ Desconectado de WhatsApp:', status);
            currentStatus      = 'disconnected';
            currentClientReady = false;
            currentQrDataURL   = null;
            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
            pushSseEvent('status_change', { status: 'disconnected' });
            scheduleReconnect();
          }
        },

        headless:        true,
        useChrome:       false,
        debug:           false,
        logQR:           false,
        disableWelcome:  true,
        updatesLog:      false,
        autoClose:       0,

        puppeteerOptions: {
          executablePath: (() => {
            try {
              const p  = require('puppeteer');
              const ep = p.executablePath ? p.executablePath() : undefined;
              if (typeof ep === 'string' && ep.length > 0) return ep;
              const winPaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
              ];
              const fs2 = require('fs');
              for (const wp of winPaths) {
                if (fs2.existsSync(wp)) return wp;
              }
              return undefined;
            } catch (e) {
              return undefined;
            }
          })(),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
          ],
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('create() timeout tras 90s')), 90000)),
    ]);

    currentClient = client;
    console.log(`✅ WPPConnect create() completado [${SESSION_NAME}]`);
    _reconnectAttempts = 0;

    resetInboxHook();
    installInboxHook(currentClient);

    client.onStateChange((state) => {
      console.log('🔁 Estado cambiado:', state);
    });

  } catch (err) {
    console.error('❌ Error en create():', err.message);
    currentStatus = 'disconnected';
    await destroyClientSafely();
  } finally {
    _isInitializing = false;
  }
}

// ── Envío de ubicación como link Google Maps (compatible con @lid y @c.us) ────
async function sendUbicacion(client, chatId, lat, lng, title = '', address = '') {
  let resolvedId = chatId;
  if (chatId.endsWith('@lid')) {
    try {
      const entry = await client.getPnLidEntry(chatId);
      if (entry && entry.phoneNumber) {
        const digits = String(entry.phoneNumber).replace(/\D/g, '');
        if (digits.length >= 7) {
          resolvedId = `${digits}@c.us`;
          console.log(`🔁 @lid resuelto: ${chatId} → ${resolvedId}`);
        }
      }
    } catch (e) {
      console.warn(`⚠️ No se pudo resolver @lid, usando original:`, e.message);
    }
  }

  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const texto   = title
    ? `📍 *${title}*\n${address ? address + '\n' : ''}${mapsUrl}`
    : `📍 ${mapsUrl}`;

  for (let intento = 1; intento <= 3; intento++) {
    try {
      await client.sendText(resolvedId, texto);
      console.log(`✅ Ubicación enviada a ${resolvedId}`);
      return { success: true, resolvedId };
    } catch (error) {
      console.error(`❌ Intento ${intento} fallido:`, error.message);
      if (intento === 3) return { success: false, error: error.message };
      await new Promise(resolve => setTimeout(resolve, 2000 * intento));
    }
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  getClient,
  getStatus,
  getQrDataURL,
  isClientReady,
  getMessageQueue,
  isProcessing,
  setProcessing,
  initializeClient,
  scheduleReconnect,
  destroyClientSafely,
  deleteAuthFolder,
  hasSession,
  isDeadFrameError,
  reconectarSiMuerto,
  sendUbicacion,
};
