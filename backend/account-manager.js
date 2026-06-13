// ============================================================
// account-manager.js — Gestor dinámico de cuentas en tiempo real
// Permite agregar / detener cuentas SIN reiniciar el servidor.
//
// CÓMO FUNCIONA:
//   • El backend principal (puerto 3000) importa este módulo.
//   • Expone rutas REST que el frontend consume:
//       GET  /api/accounts          → lista de cuentas + estado de cada proceso
//       POST /api/accounts          → agregar cuenta nueva y lanzar su proceso
//       DELETE /api/accounts/:id    → detener proceso y eliminar cuenta
//       GET  /api/accounts/:id/status → estado del proceso (running/stopped/error)
//
// NOTAS:
//   • Solo el backend "default" (puerto 3000) debe importar este módulo.
//   • Los procesos hijo son instancias independientes de server.js.
//   • accounts-config.json se actualiza automáticamente.
// ============================================================

'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');

const CONFIG_FILE = path.join(__dirname, 'accounts-config.json');

// ── Estado en memoria de los procesos hijos ───────────────────────────────────
// Map<accountId, { child, port, label, status, restartCount, restartTimer }>
const _processes = new Map();

// Colores ANSI para logs
const COLORS = ['\x1b[32m','\x1b[34m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[31m'];
const RESET  = '\x1b[0m';

// ── Leer / escribir accounts-config.json ─────────────────────────────────────
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return [{ id: 'default', port: 3000, label: 'Cuenta Principal' }];
  }
}

function writeConfig(accounts) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(accounts, null, 2));
}

// ── Calcular próximo puerto libre ─────────────────────────────────────────────
function nextFreePort(accounts) {
  const used = accounts.map((a) => Number(a.port)).filter(Boolean);
  let port = 3001;
  while (used.includes(port)) port++;
  return port;
}

// ── Lanzar un proceso hijo para una cuenta ───────────────────────────────────
function spawnAccount(account, colorIdx = 0, restartCount = 0) {
  const accountId = account.id === 'default' ? '' : account.id;
  const color     = COLORS[colorIdx % COLORS.length];
  const prefix    = `${color}[${account.label}]${RESET}`;

  console.log(restartCount === 0
    ? `🚀 Iniciando ${prefix} en puerto ${account.port}...`
    : `🔄 Reiniciando ${prefix} (intento #${restartCount})...`
  );

  const child = spawn('node', ['server.js'], {
    cwd:   __dirname,
    env:   { ...process.env, PORT: String(account.port), ACCOUNT_ID: accountId },
    stdio: 'pipe',
  });

  const entry = {
    child,
    port:         account.port,
    label:        account.label,
    status:       'starting',
    restartCount,
    restartTimer: null,
    colorIdx,
    startedAt:    Date.now(),
  };
  _processes.set(account.id, entry);

  child.stdout.on('data', (data) => {
    const text = String(data);
    process.stdout.write(`${prefix} ${text}`);
    // Detectar cuando el backend está escuchando
    if (text.includes('corriendo en')) {
      entry.status = 'running';
      // Una vez running, verificar periódicamente que siga respondiendo
      if (!entry.healthTimer) {
        entry.healthTimer = setInterval(async () => {
          if (entry.status === 'stopped') { clearInterval(entry.healthTimer); return; }
          try {
            const http = require('http');
            await new Promise((resolve, reject) => {
              const req = http.get(`http://localhost:${entry.port}/api/account-info`, { timeout: 2000 }, resolve);
              req.on('error', reject);
              req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            });
            // Si responde, asegurarse de que esté como running
            if (entry.status === 'error') entry.status = 'running';
          } catch {
            // No responde — solo marcar error si el proceso sigue vivo
            if (entry.child && !entry.child.killed) entry.status = 'error';
          }
        }, 10000); // cada 10 segundos
      }
    }
  });

  child.stderr.on('data', (data) => {
    const text = String(data);
    process.stderr.write(`${prefix} ⚠️  ${text}`);
    // WPPConnect escribe logs verbose/debug/info/http en stderr — NO son errores reales.
    // Solo marcar error si hay un crash de Node (uncaught exception, etc.)
    // El estado real se confirma vía stdout cuando imprime 'corriendo en'.
    // Si el proceso ya está 'running', un stderr de WPPConnect NO lo degrada a error.
    if (entry.status !== 'running') {
      // Solo marcar error si el texto parece un crash real de Node, no un log de librería
      const isLibraryLog = /^\s*(verbose|debug|info|http|warn|error):\s+\[/.test(text);
      if (!isLibraryLog) {
        entry.status = 'error';
      }
    }
  });

  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      entry.status = 'stopped';
      console.log(`${prefix} 🛑 Detenido.`);
      return;
    }
    entry.status = 'crashed';
    const delay  = Math.min(5000 * Math.pow(2, restartCount), 60000);
    console.log(`${prefix} ❌ Terminó (código ${code}). Reiniciando en ${delay / 1000}s...`);
    entry.restartTimer = setTimeout(() => {
      const accounts = readConfig();
      const acc      = accounts.find((a) => a.id === account.id);
      if (acc) spawnAccount(acc, colorIdx, restartCount + 1);
    }, delay);
  });

  return child;
}

// ── Arrancar todas las cuentas del config (excepto default que ya corre) ──────
function initAllAccounts() {
  const accounts = readConfig();
  accounts.forEach((acc, idx) => {
    if (acc.id === 'default') return; // el proceso default ya está corriendo
    if (!_processes.has(acc.id)) {
      spawnAccount(acc, idx);
    }
  });
}

// ── Registrar las rutas en Express ───────────────────────────────────────────
function registerAccountManagerRoutes(app) {

  // GET /api/accounts — lista con estado de cada proceso
  app.get('/api/accounts', (_req, res) => {
    const accounts = readConfig();
    const result   = accounts.map((acc) => {
      const proc = _processes.get(acc.id);
      return {
        id:     acc.id,
        label:  acc.label,
        port:   acc.port,
        apiUrl: `http://localhost:${acc.port}`,
        status: acc.id === 'default' ? 'running' : (proc?.status || 'stopped'),
      };
    });
    res.json(result);
  });

  // POST /api/accounts — crear cuenta nueva y lanzar proceso
  app.post('/api/accounts', (req, res) => {
    const { label } = req.body;
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'El campo "label" es requerido.' });
    }

    const accounts = readConfig();
    const port     = nextFreePort(accounts);
    const id       = `cuenta_${Date.now()}`;

    const newAccount = { id, port, label: label.trim() };
    accounts.push(newAccount);
    writeConfig(accounts);

    // Lanzar el proceso inmediatamente
    const colorIdx = accounts.length - 1;
    spawnAccount(newAccount, colorIdx, 0);

    console.log(`✅ Nueva cuenta creada: [${label.trim()}] → puerto ${port}`);

    res.json({
      ok:     true,
      account: {
        id,
        label:  label.trim(),
        port,
        apiUrl: `http://localhost:${port}`,
        status: 'starting',
      },
      message: `Cuenta "${label.trim()}" creada en http://localhost:${port}. El proceso tardará ~5s en estar listo.`,
    });
  });

  // DELETE /api/accounts/:id — detener proceso y eliminar cuenta
  app.delete('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    if (id === 'default') {
      return res.status(400).json({ error: 'No se puede eliminar la cuenta principal.' });
    }

    const proc = _processes.get(id);
    if (proc) {
      if (proc.restartTimer) clearTimeout(proc.restartTimer);
      try { proc.child.kill('SIGTERM'); } catch {}
      _processes.delete(id);
    }

    const accounts = readConfig().filter((a) => a.id !== id);
    writeConfig(accounts);

    res.json({ ok: true, message: `Cuenta ${id} eliminada.` });
  });

  // GET /api/accounts/:id/status — estado del proceso
  app.get('/api/accounts/:id/status', (req, res) => {
    const { id } = req.params;
    if (id === 'default') return res.json({ status: 'running' });
    const proc = _processes.get(id);
    res.json({ status: proc?.status || 'stopped' });
  });

  // GET /api/accounts/next-port — siguiente puerto libre
  app.get('/api/accounts/next-port', (_req, res) => {
    const accounts = readConfig();
    res.json({ port: nextFreePort(accounts) });
  });
}

// ── Apagado limpio ────────────────────────────────────────────────────────────
function shutdownAll() {
  console.log('🛑 Deteniendo todos los procesos hijo...');
  for (const [, proc] of _processes) {
    if (proc.restartTimer) clearTimeout(proc.restartTimer);
    try { proc.child.kill('SIGTERM'); } catch {}
  }
}

module.exports = {
  initAllAccounts,
  registerAccountManagerRoutes,
  shutdownAll,
  readConfig,
  nextFreePort,
};