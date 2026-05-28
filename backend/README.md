# WaSaveBot – Backend

Motor WhatsApp basado en [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).

## Instalación

```bash
cd backend
npm install
```

## Uso

```bash
# Producción
npm start

# Desarrollo (recarga automática con Node 18+)
npm run dev
```

Al iniciar por primera vez verás un código QR en la terminal.
Escanéalo con WhatsApp → Dispositivos vinculados → Vincular un dispositivo.

## Estructura de archivos

```
backend/
├── server.js       ← API REST + cliente WhatsApp
├── config.json     ← flujos guardados (se genera automáticamente)
├── package.json
└── media/
    ├── imagenes/
    ├── videos/
    ├── audios/
    └── documentos/
```

## Variables de entorno

| Variable | Default | Descripción            |
|----------|---------|------------------------|
| PORT     | 3000    | Puerto del servidor    |

## Endpoints

| Método | Ruta               | Descripción                        |
|--------|--------------------|------------------------------------|
| GET    | /api/config        | Obtener flujos                     |
| POST   | /api/config        | Guardar flujos                     |
| POST   | /api/upload        | Subir archivo multimedia           |
| GET    | /api/media-list    | Listar archivos de la biblioteca   |
| POST   | /api/send-message  | Enviar mensaje manual              |
