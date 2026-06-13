/**
 * ThemeToggle.tsx
 * Cambia entre modo oscuro y claro.
 * Guarda la preferencia en localStorage y la restaura al montar.
 */

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = "wa_theme_preference";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

/** Detecta si el sistema prefiere modo oscuro */
function systemPrefersDark(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Restaura tema guardado o usa preferencia del sistema */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const isDark = saved !== null ? saved === "dark" : systemPrefersDark();
  applyTheme(isDark);
}

export function ThemeToggle({ className }: { className?: string }) {
  // Siempre arranca en false para que servidor y cliente coincidan en el primer render
  const [isDark, setIsDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  // Solo en el cliente: leer preferencia real y aplicar tema
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const dark = saved !== null ? saved === "dark" : systemPrefersDark();
    setIsDark(dark);
    applyTheme(dark);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={toggle}
          aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
          {/* Mientras no está montado no renderiza ícono para evitar mismatch */}
          {mounted && (isDark
            ? <Sun className="size-4" />
            : <Moon className="size-4" />)}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isDark ? "Modo claro" : "Modo oscuro"}
      </TooltipContent>
    </Tooltip>
  );
}