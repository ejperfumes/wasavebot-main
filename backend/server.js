// ============================================================
// server.js — arranque del backend WaSaveBot
// MULTI-CUENTA AUTOMÁTICO:
//   • Si ACCOUNT_ID está vacío (cuenta default/principal):
//       → Importa account-manager y gestiona todos los procesos hijo
//       → Expone /api/accounts para que el frontend cree cuentas sin tocar código
//   • Si ACCOUNT_ID tiene valor (cuenta hija):
//       → Solo arranca su propio Express, sin gestionar otras cuentas
// ============================================================

'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');

const {
  loadConfig, loadConnectionName, getConnectionName,
  INBOX_BASE, hasSession, ACCOUNT_ID, SESSION_NAME,
} = require('./storage');
const { loadHistory }       = require('./inbox');
const { initializeClient }  = require('./whatsapp');
const { processQueue }      = require('./flows');
const { registerRoutes }    = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — permite localhost en cualquier puerto ──────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origen no permitido: ${origin}`));
  },
  credentials: true,
}));
app.use(bodyParser.json({ limit: '50mb' }));

app.use('/media',       express.static(path.join(__dirname, 'media')));
app.use('/media/inbox', express.static(INBOX_BASE));

// ── Rutas principales ─────────────────────────────────────────────────────────
registerRoutes(app);

// ── Info de esta instancia ───────────────────────────────────────────────────
app.get('/api/account-info', (_req, res) => {
  res.json({
    accountId:      ACCOUNT_ID || 'default',
    sessionName:    SESSION_NAME,
    port:           Number(PORT),
    connectionName: getConnectionName() || '',
  });
});

// ── Gestión de cuentas: SOLO en la instancia principal (puerto 3000) ──────────
if (!ACCOUNT_ID) {
  const {
    initAllAccounts,
    registerAccountManagerRoutes,
    shutdownAll,
  } = require('./account-manager');

  registerAccountManagerRoutes(app);

  process.on('SIGINT',  () => { shutdownAll(); process.exit(0); });
  process.on('SIGTERM', () => { shutdownAll(); process.exit(0); });

  // Lanzar cuentas adicionales al arrancar
  setTimeout(initAllAccounts, 1000); // pequeño delay para que el log sea limpio
}

// ── Parche: reinstalar hook si se pierde ──────────────────────────────────────
const { getClient, isClientReady }                  = require('./whatsapp');
const { installInboxHook, resetInboxHook, isHookInstalled } = require('./inbox');

setInterval(() => {
  const client = getClient();
  if (client && isClientReady() && !isHookInstalled()) {
    console.log('🔁 Instalando hook de bandeja (fallback)...');
    resetInboxHook();
    installInboxHook(client);
  }
}, 3000);

// ── Arranque ──────────────────────────────────────────────────────────────────
loadConfig();
loadConnectionName();
loadHistory();

const accountLabel = ACCOUNT_ID ? ` [Cuenta: ${ACCOUNT_ID}]` : ' [Cuenta principal]';

let _autoConnectDone = false;
app.listen(PORT, async () => {
  console.log(`🌐 Backend WaSaveBot corriendo en http://localhost:${PORT}${accountLabel}`);
  console.log(`🔑 Sesión WPP: ${SESSION_NAME}`);
  if (hasSession() && !_autoConnectDone) {
    _autoConnectDone = true;
    console.log('🔄 Sesión guardada detectada. Conectando automáticamente...');
    await initializeClient(processQueue);
  } else {
    console.log('💡 No hay sesión guardada. Usa el botón "Conectar" desde la interfaz.');
  }
});
