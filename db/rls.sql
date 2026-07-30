-- =====================================================================
-- Monitoreo Ósmosis Inversa — Row Level Security
-- Correr después de db/schema.sql. Reemplaza toda la autorización que
-- antes vivía a mano en api/*.php.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones helper (SECURITY DEFINER: sus consultas internas ignoran RLS
-- porque corren como el dueño de las tablas, no como el rol que llama).
-- rol_actual()/empresa_actual() filtran "AND activo" a propósito: en
-- cuanto se desactiva un usuario, cada política construida sobre estas
-- funciones empieza a fallar cerrado de inmediato, sin esperar a que
-- expire su sesión.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rol_actual() RETURNS rol_usuario
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT rol FROM usuarios WHERE id = auth.uid() AND activo $$;

CREATE OR REPLACE FUNCTION empresa_actual() RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() AND activo $$;

CREATE OR REPLACE FUNCTION empresa_de_usuario(p_usuario_id UUID) RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT empresa_id FROM usuarios WHERE id = p_usuario_id $$;

CREATE OR REPLACE FUNCTION empresa_de_sede(p_sede_id INTEGER) RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT empresa_id FROM sedes WHERE id = p_sede_id $$;

-- Regla de 3 vías: super ve todo; admin ve su propia empresa; operario ve
-- solo las sedes que tiene asignadas en usuario_sedes. Equivalente exacto
-- de api/helpers.php::sedes_del_usuario() / puede_ver_sede().
CREATE OR REPLACE FUNCTION puede_ver_sede(p_sede_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
    SELECT CASE
        WHEN rol_actual() = 'super' THEN true
        WHEN rol_actual() = 'admin' THEN
            EXISTS (SELECT 1 FROM sedes s WHERE s.id = p_sede_id AND s.empresa_id = empresa_actual())
        WHEN rol_actual() = 'operario' THEN
            EXISTS (SELECT 1 FROM usuario_sedes us WHERE us.usuario_id = auth.uid() AND us.sede_id = p_sede_id)
        ELSE false
    END
$$;

CREATE OR REPLACE FUNCTION puede_ver_periodo(p_periodo_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT COALESCE(puede_ver_sede(sede_id), false) FROM periodos WHERE id = p_periodo_id $$;

GRANT EXECUTE ON FUNCTION rol_actual() TO authenticated;
GRANT EXECUTE ON FUNCTION empresa_actual() TO authenticated;
GRANT EXECUTE ON FUNCTION empresa_de_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION empresa_de_sede(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION puede_ver_sede(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION puede_ver_periodo(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------
-- Triggers de columnas protegidas.
-- Las políticas RLS solo filtran QUÉ FILAS son visibles/escribibles; no
-- impiden que un UPDATE por lo demás legítimo cambie una columna sensible
-- dentro de esa fila. api/mediciones.php nunca reasigna usuario_id al
-- actualizar (ni siquiera admin/super); api/usuarios.php nunca deja
-- cambiar rol/empresa_id/email desde el PUT. Estos triggers portan esa
-- regla a nivel de base de datos.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mediciones_proteger_columnas() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.periodo_id := OLD.periodo_id;
    NEW.dia        := OLD.dia;
    NEW.param_id   := OLD.param_id;
    NEW.usuario_id := OLD.usuario_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_30_proteger_columnas ON mediciones;
CREATE TRIGGER trg_30_proteger_columnas
    BEFORE UPDATE ON mediciones
    FOR EACH ROW
    EXECUTE FUNCTION mediciones_proteger_columnas();

-- service_role (la Edge Function) es la única vía de escritura en
-- usuarios, así que este trigger es una segunda red de seguridad, no la
-- defensa principal.
CREATE OR REPLACE FUNCTION usuarios_proteger_columnas() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;
    IF NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Solo se pueden modificar nombre y activo';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_proteger_columnas ON usuarios;
CREATE TRIGGER trg_usuarios_proteger_columnas
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION usuarios_proteger_columnas();

-- ---------------------------------------------------------------------
-- Habilitar RLS. Importante: NUNCA usar FORCE ROW LEVEL SECURITY en estas
-- tablas — forzaría RLS también sobre el dueño de las tablas y rompería
-- en silencio las funciones SECURITY DEFINER de arriba (empezarían a
-- devolver menos filas de las esperadas, sin ningún error visible).
-- ---------------------------------------------------------------------
ALTER TABLE empresas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sedes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_sedes ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediciones    ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- empresas — equivalente de api/empresas.php (todo el archivo exige
-- require_rol('super')); admin/operario solo necesitan leer el nombre de
-- su propia empresa para mostrarlo en pantalla.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS empresas_select_super ON empresas;
CREATE POLICY empresas_select_super ON empresas FOR SELECT
    USING (rol_actual() = 'super');

DROP POLICY IF EXISTS empresas_select_own ON empresas;
CREATE POLICY empresas_select_own ON empresas FOR SELECT
    USING (id = empresa_actual());

DROP POLICY IF EXISTS empresas_insert_super ON empresas;
CREATE POLICY empresas_insert_super ON empresas FOR INSERT
    WITH CHECK (rol_actual() = 'super');
-- Sin políticas de UPDATE/DELETE: tampoco existían esos métodos en PHP.

-- ---------------------------------------------------------------------
-- sedes — equivalente de api/sedes.php
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS sedes_select ON sedes;
CREATE POLICY sedes_select ON sedes FOR SELECT
    USING (puede_ver_sede(id));

DROP POLICY IF EXISTS sedes_insert ON sedes;
CREATE POLICY sedes_insert ON sedes FOR INSERT
    WITH CHECK (
        rol_actual() = 'super'
        OR (rol_actual() = 'admin' AND empresa_id = empresa_actual())
    );

-- ---------------------------------------------------------------------
-- usuarios — solo lectura para el cliente (equivalente de api/me.php +
-- las partes GET de api/usuarios.php). Toda escritura pasa por la Edge
-- Function gestionar-usuario (usa service_role, ignora estas políticas).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS usuarios_select_own ON usuarios;
CREATE POLICY usuarios_select_own ON usuarios FOR SELECT
    USING (id = auth.uid());

-- api/mediciones.php siempre unía usuarios sin filtrar por rol (para
-- mostrar "cargado por X" a cualquiera que viera el período), así que
-- aquí se permite leer cualquier fila de la misma empresa sin distinguir
-- admin/operario — restringirlo a solo admin rompería esa atribución.
DROP POLICY IF EXISTS usuarios_select_admin ON usuarios;
DROP POLICY IF EXISTS usuarios_select_empresa ON usuarios;
CREATE POLICY usuarios_select_empresa ON usuarios FOR SELECT
    USING (empresa_id = empresa_actual());

DROP POLICY IF EXISTS usuarios_select_super ON usuarios;
CREATE POLICY usuarios_select_super ON usuarios FOR SELECT
    USING (rol_actual() = 'super');

-- ---------------------------------------------------------------------
-- usuario_sedes — solo lectura (el frontend necesita mostrar qué sedes
-- tiene asignadas un usuario). Las escrituras también van por la Edge
-- Function, igual que la creación/edición de usuarios en PHP.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS usuario_sedes_select_own ON usuario_sedes;
CREATE POLICY usuario_sedes_select_own ON usuario_sedes FOR SELECT
    USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS usuario_sedes_select_admin ON usuario_sedes;
CREATE POLICY usuario_sedes_select_admin ON usuario_sedes FOR SELECT
    USING (
        rol_actual() = 'super'
        OR (rol_actual() = 'admin' AND empresa_de_usuario(usuario_id) = empresa_actual())
    );

-- ---------------------------------------------------------------------
-- periodos — equivalente de api/periodos.php
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS periodos_select ON periodos;
CREATE POLICY periodos_select ON periodos FOR SELECT
    USING (puede_ver_sede(sede_id));

DROP POLICY IF EXISTS periodos_insert ON periodos;
CREATE POLICY periodos_insert ON periodos FOR INSERT
    WITH CHECK (puede_ver_sede(sede_id));

-- ---------------------------------------------------------------------
-- mediciones — equivalente de api/mediciones.php, incluida la regla de
-- propiedad por celda: un operario solo inserta reclamando su propio uid,
-- y solo edita/borra celdas que ya son suyas; admin/super no tienen esa
-- restricción.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS mediciones_select ON mediciones;
CREATE POLICY mediciones_select ON mediciones FOR SELECT
    USING (puede_ver_periodo(periodo_id));

DROP POLICY IF EXISTS mediciones_insert ON mediciones;
CREATE POLICY mediciones_insert ON mediciones FOR INSERT
    WITH CHECK (
        puede_ver_periodo(periodo_id)
        AND usuario_id = auth.uid()
    );

DROP POLICY IF EXISTS mediciones_update ON mediciones;
CREATE POLICY mediciones_update ON mediciones FOR UPDATE
    USING (
        puede_ver_periodo(periodo_id)
        AND (rol_actual() <> 'operario' OR usuario_id = auth.uid())
    )
    WITH CHECK (
        puede_ver_periodo(periodo_id)
        AND (rol_actual() <> 'operario' OR usuario_id = auth.uid())
    );

DROP POLICY IF EXISTS mediciones_delete ON mediciones;
CREATE POLICY mediciones_delete ON mediciones FOR DELETE
    USING (
        puede_ver_periodo(periodo_id)
        AND (rol_actual() <> 'operario' OR usuario_id = auth.uid())
    );

-- ---------------------------------------------------------------------
-- Esta app no tiene ninguna superficie anónima: todo requiere sesión.
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    empresas, sedes, usuarios, usuario_sedes, periodos, mediciones
TO authenticated;
-- Las secuencias (ids autoincrementales) también necesitan uso explícito.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
