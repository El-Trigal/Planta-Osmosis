import { createClient } from "@supabase/supabase-js";

// La URL y la anon key son públicas por diseño (viajan en el bundle del
// navegador); la seguridad real la da Row Level Security en Postgres, no
// el secreto de estos valores.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// La Edge Function gestionar-usuario devuelve errores como { error: "..." }
// tanto en respuestas 2xx (defensivo) como no-2xx (caso normal); este
// helper normaliza ambos casos a una excepción con mensaje legible.
export async function invocarGestionUsuario(body) {
  const { data, error } = await supabase.functions.invoke("gestionar-usuario", { body });
  if (error) {
    let mensaje = error.message;
    try {
      const cuerpo = await error.context?.json?.();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      /* la respuesta de error no traía JSON legible */
    }
    throw new Error(mensaje);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
