import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// ============================================================
// vite.config.ts
// PRODUCCIÓN MULTI-CUENTA:
//   El proxy Vite se ELIMINA porque ya no es necesario.
//   Cada cuenta tiene su propia URL explícita (http://localhost:PORT)
//   que se gestiona en accounts.ts → getApiBase().
//   Eliminar el proxy evita el bug crítico donde peticiones de
//   cuentas extras terminaban yendo a localhost:3000.
// ============================================================

export default defineConfig({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    // Sin proxy — cada cuenta habla directamente a su backend
  },
});
