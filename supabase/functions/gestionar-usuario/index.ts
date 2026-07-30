// Edge Function: gestionar-usuario
// Reemplaza api/usuarios.php entero. Es el único código con privilegios
// elevados (service_role) del proyecto, porque crear/desactivar cuentas y
// resetear contraseñas requiere la Auth Admin API de Supabase, algo que
// nunca puede hacerse desde el navegador con la anon key.
//
// El caller se autentica con su JWT normal (igual que cualquier llamada a
// supabase.functions.invoke); esta función revalida su rol/empresa contra
// la tabla usuarios (vía un cliente "as-caller" sujeto a RLS) antes de usar
// el cliente service_role para la parte privilegiada.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function esEmailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "No autenticado" }, 401);

  const { data: caller, error: callerErr } = await callerClient
    .from("usuarios")
    .select("id, rol, empresa_id, activo")
    .eq("id", userData.user.id)
    .single();
  if (callerErr || !caller || !caller.activo) return json({ error: "No autenticado" }, 401);
  if (caller.rol !== "super" && caller.rol !== "admin") return json({ error: "Acceso denegado" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido" }, 400);
  }

  const accion = body.accion;

  if (accion === "crear") {
    const nombre = String(body.nombre ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const rol = body.rol;
    const empresaId = Number(body.empresa_id ?? (caller.rol === "admin" ? caller.empresa_id : 0));
    const sedes = Array.isArray(body.sedes) ? (body.sedes as unknown[]).map(Number) : [];

    if (!nombre) return json({ error: "El nombre es requerido" }, 400);
    if (!esEmailValido(email)) return json({ error: "Email inválido" }, 400);
    if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
    if (rol !== "admin" && rol !== "operario") return json({ error: "Rol inválido (admin u operario)" }, 400);
    if (!empresaId) return json({ error: "empresa_id es requerido" }, 400);
    if (caller.rol === "admin" && empresaId !== caller.empresa_id) {
      return json({ error: "Solo puedes crear usuarios en tu empresa" }, 403);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      const msg = /already.*registered|duplicate/i.test(createErr?.message ?? "")
        ? "El email ya está registrado"
        : createErr?.message ?? "No se pudo crear el usuario";
      return json({ error: msg }, 409);
    }

    const nuevoId = created.user.id;
    const { error: perfilErr } = await admin.from("usuarios").insert({
      id: nuevoId,
      empresa_id: empresaId,
      nombre,
      email,
      rol,
      activo: true,
    });
    if (perfilErr) {
      await admin.auth.admin.deleteUser(nuevoId);
      return json({ error: "No se pudo crear el perfil del usuario" }, 500);
    }

    if (sedes.length > 0) {
      const { data: sedesValidas } = await admin
        .from("sedes")
        .select("id")
        .eq("empresa_id", empresaId)
        .in("id", sedes);
      const idsValidos = (sedesValidas ?? []).map((s: { id: number }) => s.id);
      if (idsValidos.length > 0) {
        await admin
          .from("usuario_sedes")
          .insert(idsValidos.map((sedeId: number) => ({ usuario_id: nuevoId, sede_id: sedeId })));
      }
    }

    return json({ id: nuevoId, nombre, email, rol, sedes }, 201);
  }

  if (accion === "actualizar") {
    const targetId = String(body.id ?? "");
    if (!targetId) return json({ error: "id es requerido" }, 400);

    const { data: target, error: targetErr } = await admin
      .from("usuarios")
      .select("id, empresa_id, rol")
      .eq("id", targetId)
      .single();
    if (targetErr || !target) return json({ error: "Usuario no encontrado" }, 404);
    if (caller.rol === "admin" && target.empresa_id !== caller.empresa_id) {
      return json({ error: "Acceso denegado" }, 403);
    }

    const updates: Record<string, unknown> = {};

    if (typeof body.nombre === "string") {
      const nombre = body.nombre.trim();
      if (!nombre) return json({ error: "El nombre no puede estar vacío" }, 400);
      updates.nombre = nombre;
    }

    if (typeof body.activo === "boolean") {
      updates.activo = body.activo;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await admin.from("usuarios").update(updates).eq("id", targetId);
      if (updErr) return json({ error: "No se pudo actualizar el usuario" }, 500);
    }

    // Sincroniza el bloqueo con Auth: sin esto, un token ya emitido antes
    // de desactivar seguiría funcionando hasta que expire por sí solo.
    if (typeof body.activo === "boolean") {
      await admin.auth.admin.updateUserById(targetId, {
        ban_duration: body.activo ? "none" : "87600h",
      });
    }

    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < 8) return json({ error: "Contraseña muy corta (mínimo 8 caracteres)" }, 400);
      const { error: passErr } = await admin.auth.admin.updateUserById(targetId, { password: body.password });
      if (passErr) return json({ error: "No se pudo actualizar la contraseña" }, 500);
    }

    if (Array.isArray(body.sedes)) {
      const sedes = (body.sedes as unknown[]).map(Number);
      await admin.from("usuario_sedes").delete().eq("usuario_id", targetId);
      if (sedes.length > 0) {
        const { data: sedesValidas } = await admin
          .from("sedes")
          .select("id")
          .eq("empresa_id", target.empresa_id)
          .in("id", sedes);
        const idsValidos = (sedesValidas ?? []).map((s: { id: number }) => s.id);
        if (idsValidos.length > 0) {
          await admin
            .from("usuario_sedes")
            .insert(idsValidos.map((sedeId: number) => ({ usuario_id: targetId, sede_id: sedeId })));
        }
      }
    }

    return json({ ok: true });
  }

  return json({ error: "Acción inválida" }, 400);
});
