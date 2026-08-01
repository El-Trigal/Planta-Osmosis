import { useEffect, useState } from "react";

// navigator.onLine no garantiza que Supabase sea alcanzable (puede ser
// falso positivo con un wifi cautivo, o falso negativo en algunos
// navegadores), pero sirve como señal de UI y como disparador para
// reintentar la cola cuando el navegador detecta que volvió la conexión.
// La clasificación real de un fallo de red vs. un rechazo del servidor
// se hace por request, no acá.
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const marcarOnline = () => setOnline(true);
    const marcarOffline = () => setOnline(false);
    window.addEventListener("online", marcarOnline);
    window.addEventListener("offline", marcarOffline);
    return () => {
      window.removeEventListener("online", marcarOnline);
      window.removeEventListener("offline", marcarOffline);
    };
  }, []);

  return online;
}
