# WaSaveBot

Panel de administración para bots de WhatsApp.  
**Frontend:** React + TanStack Start (Vite)  
**Backend:** Node.js + Express + whatsapp-web.js

---

## Estructura del proyecto

```
wasavebot/
├── src/                   ← Frontend React
│   ├── components/wa/     ← Componentes del panel (flujos, biblioteca, envío)
│   ├── lib/wa-api.ts      ← Cliente HTTP hacia el backend
│   └── routes/            ← Páginas TanStack Router
├── backend/               ← Backend WhatsApp
│   ├── server.js          ← API REST + cliente WhatsApp
│   ├── config.json        ← Flujos guardados
│   └── media/             ← Archivos multimedia subidos
├── package.json           ← Dependencias del frontend
└── vite.config.ts
```

---

## Instalación

### 1. Dependencias del frontend
```bash
bun install
# o: npm install
```

### 2. Dependencias del backend
```bash
cd backend
npm install
```

---

## Ejecución

Necesitas **dos terminales**.

### Terminal 1 – Backend
```bash
# Desde la raíz del proyecto:
npm run backend

# O desde la carpeta backend:
cd backend && node server.js
```

Al arrancar por primera vez aparece un código QR en la terminal.  
Escanéalo con WhatsApp → **Dispositivos vinculados** → **Vincular un dispositivo**.

### Terminal 2 – Frontend
```bash
bun dev
# o: npm run dev
```

El frontend corre en **http://localhost:5173** (o el puerto que Vite asigne).

---

## Configuración del frontend

1. Abre el panel en el navegador.
2. Haz clic en el botón **API** (arriba a la derecha).
3. Escribe la URL del backend: `http://localhost:3000`
4. Guarda. El panel queda conectado al bot.

---

## Flujo de trabajo

1. **Biblioteca** → Sube imágenes, audios, videos y documentos.
2. **Flujos automáticos** → Crea flujos con palabras clave y pasos de respuesta.
3. **Respuesta rápida** → Envía mensajes manuales a cualquier número.

---

## Variables de entorno del backend

| Variable | Default | Descripción         |
|----------|---------|---------------------|
| PORT     | 3000    | Puerto del servidor |

Para cambiar el puerto:
```bash
PORT=4000 node backend/server.js
```
