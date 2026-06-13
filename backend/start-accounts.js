// ============================================================
// start-accounts.js — Lanzador multi-cuenta de WaSaveBot
// PRODUCCIÓN:
//   • Auto-reinicio con backoff si un proceso muere
//   • Colores en consola para distinguir cuentas
//   • La cuenta "default" pasa ACCOUNT_ID='' explícito
//   • Cuentas ilimitadas: agrega las que necesites en accounts-config.json
//
// USO:  node start-accounts.js
//
// Formato de accounts-config.json:
// [
//   { "id": "default", "port": 3000, "label": "Cuenta Principal" },
//   { "id": "cuenta2", "port": 3001, "label": "Tienda Norte" },
//   { "id": "cuenta3", "port": 3002, "label": "Soporte" }
// ]
// ============================================================

'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

const CONFIG_FILE = path.join(__dirname, 'accounts-config.json');

const DEFAULT_ACCOUNTS = [
  { id: 'default', port: 3000, label: 'Cuenta Principal' },
];

// Colores ANSI para diferenciar cuentas en la consola
const COLORS = ['\x1b[32m', '\x1b[34m', '\x1b[33m', '\x1b[35m', '\x1b[36m', '\x1b[31m'];
const RESET  = '\x1b[0m';

let accounts;
try {
  accounts = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  console.log(`✅ Cargadas ${accounts.length} cuenta(s) desde accounts-config.json`);
} catch {
  console.log('ℹ️  No se encontró accounts-config.json. Iniciando solo cuenta principal.');
  accounts = DEFAULT_ACCOUNTS;
}

const processes = [];

function spawnAccount(account, colorIdx, restartCount = 0) {
  // La cuenta "default" usa ACCOUNT_ID vacío para mantener nombres de archivo compatibles
  const accountId = account.id === 'default' ? '' : account.id;
  const color     = COLORS[colorIdx % COLORS.length];
  const prefix    = `${color}[${account.label}]${RESET}`;

  const env = {
    ...process.env,
    PORT:       String(account.port),
    ACCOUNT_ID: accountId,
  };

  if (restartCount === 0) {
    console.log(`🚀 Iniciando ${prefix} en puerto ${account.port}...`);
  } else {
    console.log(`🔄 Reiniciando ${prefix} (intento #${restartCount})...`);
  }

  const child = spawn('node', ['server.js'], {
    cwd:   __dirname,
    env,
    stdio: 'pipe',
  });

  child.stdout.on('data', (data) => {
    process.stdout.write(`${prefix} ${data}`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`${prefix} ⚠️  ${data}`);
  });

  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') return; // apagado limpio
    const delay = Math.min(5000 * Math.pow(2, restartCount), 60000); // backoff: 5s, 10s, 20s… máx 60s
    console.log(`${prefix} ❌ Proceso terminó (código ${code}). Reintentando en ${delay / 1000}s...`);
    setTimeout(() => {
      const newChild = spawnAccount(account, colorIdx, restartCount + 1);
      const entry = processes.find((p) => p.account.id === account.id);
      if (entry) entry.child = newChild;
    }, delay);
  });

  return child;
}

accounts.forEach((account, idx) => {
  const child = spawnAccount(account, idx);
  processes.push({ account, child });
});

// Apagar todo limpiamente al cerrar el lanzador
function shutdown() {
  console.log('\n🛑 Deteniendo todos los procesos...');
  processes.forEach((p) => {
    try { p.child.kill('SIGTERM'); } catch {}
  });
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

console.log(`\n📋 Multi-cuenta activo:`);
accounts.forEach((a, i) => {
  const color = COLORS[i % COLORS.length];
  console.log(`   ${color}• ${a.label}${RESET} → http://localhost:${a.port}`);
});
console.log(`\nPresiona Ctrl+C para detener todo.\n`);
