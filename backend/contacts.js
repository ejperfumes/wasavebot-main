// ============================================================
// contacts.js — persistencia de datos CRM de contactos
// Completamente aislado. No modifica ningún módulo existente.
// MULTI-CUENTA: archivo contacts separado por ACCOUNT_ID.
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { ACCOUNT_ID } = require('./storage');
const ACCOUNT_SUFFIX = ACCOUNT_ID ? `-${ACCOUNT_ID}` : '';

const CONTACTS_FILE = path.join(__dirname, `contacts${ACCOUNT_SUFFIX}.json`);

// ── Estructura de un contacto ────────────────────────────────────────────────
// {
//   [chatId]: {
//     wa:  { pushname, phone, isBusiness, isEnterprise, status, profilePicUrl, syncedAt }
//     crm: { name, email, company, notes, tags, updatedAt }
//   }
// }

// ── Carga / guarda ────────────────────────────────────────────────────────────

function loadContacts() {
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[contacts] Error cargando contacts.json:', e.message);
  }
  return {};
}

function saveContacts(data) {
  try {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[contacts] Error guardando contacts.json:', e.message);
  }
}

// ── Datos vacíos por defecto ──────────────────────────────────────────────────

function emptyWa() {
  return {
    pushname:      null,
    phone:         null,
    isBusiness:    false,
    isEnterprise:  false,
    isMyContact:   false,
    status:        null,
    profilePicUrl: null,
    syncedAt:      null,
  };
}

function emptyCrm() {
  return {
    name:      '',
    email:     '',
    company:   '',
    notes:     '',
    tags:      [],
    updatedAt: null,
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Obtiene el registro completo de un contacto.
 * Siempre devuelve un objeto con { wa, crm } aunque no exista aún.
 */
function getContact(chatId) {
  const all = loadContacts();
  const entry = all[chatId] || {};
  return {
    wa:  { ...emptyWa(),  ...(entry.wa  || {}) },
    crm: { ...emptyCrm(), ...(entry.crm || {}) },
  };
}

/**
 * Actualiza únicamente los campos CRM del contacto.
 * Solo persiste los campos reconocidos — no sobreescribe wa.
 */
function updateCrm(chatId, fields) {
  const all = loadContacts();
  if (!all[chatId]) all[chatId] = {};
  const allowed = ['name', 'email', 'company', 'notes', 'tags'];
  const current = { ...emptyCrm(), ...(all[chatId].crm || {}) };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      current[key] = fields[key];
    }
  }
  current.updatedAt = Math.floor(Date.now() / 1000);
  all[chatId].crm = current;
  saveContacts(all);
  return { wa: { ...emptyWa(), ...(all[chatId].wa || {}) }, crm: current };
}

/**
 * Actualiza únicamente los campos WA (sync desde WPPConnect).
 * Solo persiste los campos de whitelist — nunca toca crm.
 */
function updateWa(chatId, fields) {
  const all = loadContacts();
  if (!all[chatId]) all[chatId] = {};
  const allowed = ['pushname', 'phone', 'isBusiness', 'isEnterprise', 'isMyContact', 'status', 'profilePicUrl'];
  const current = { ...emptyWa(), ...(all[chatId].wa || {}) };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key) && fields[key] != null) {
      current[key] = fields[key];
    }
  }
  current.syncedAt = Math.floor(Date.now() / 1000);
  all[chatId].wa = current;
  saveContacts(all);
  return { wa: current, crm: { ...emptyCrm(), ...(all[chatId].crm || {}) } };
}

// ── Catálogo global de etiquetas ──────────────────────────────────────────────
// Guardado en contacts.json bajo la clave especial "__labels__"
// Estructura: { id: string, name: string, color: string }[]

const LABELS_KEY = '__labels__';

function getGlobalLabels() {
  const all = loadContacts();
  return all[LABELS_KEY] || [];
}

function saveGlobalLabels(labels) {
  const all = loadContacts();
  all[LABELS_KEY] = labels;
  saveContacts(all);
  return labels;
}

/**
 * Asegura que una etiqueta exista en el catálogo global.
 * Si ya existe (comparación case-insensitive) devuelve la existente.
 * Si no existe la crea con el color dado (o un color por defecto).
 * Devuelve { id, name, color } de la etiqueta garantizada.
 */
function ensureLabel(name, color) {
  const all = loadContacts();
  const labels = all[LABELS_KEY] || [];
  const normalized = name.trim().toLowerCase();
  const existing = labels.find((l) => l.name.toLowerCase() === normalized);
  if (existing) return existing;
  const newLabel = {
    id:    `lbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name:  name.trim(),
    color: color || '#22c55e',
  };
  labels.push(newLabel);
  all[LABELS_KEY] = labels;
  saveContacts(all);
  return newLabel;
}

module.exports = { getContact, updateCrm, updateWa, getGlobalLabels, saveGlobalLabels, ensureLabel };