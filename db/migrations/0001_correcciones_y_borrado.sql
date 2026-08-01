-- =====================================================================
-- 0001 — Corregir y borrar empresas, sedes y períodos
--
-- Hasta ahora el esquema solo tenía políticas SELECT/INSERT: una vez
-- creada una empresa, una sede o un período, no había forma de arreglar
-- un nombre mal escrito ni de deshacer un período abierto en el mes
-- equivocado (que además bloqueaba el UNIQUE (sede_id, mes, anio) para
-- siempre). Esta migración agrega UPDATE y DELETE, con dos salvaguardas:
--
--   * Triggers de columna protegida, en la misma línea que los que ya
--     existen para mediciones y usuarios en db/rls.sql: un UPDATE
--     legítimo no puede aprovecharse para mover una sede de empresa ni
--     para reetiquetar el mes/año de un período que ya tiene datos.
--   * Guardas de borrado: nada que tenga información dependiente se
--     borra en cascada silenciosamente. Los FK de db/schema.sql están
--     declarados ON DELETE CASCADE, así que sin estos triggers borrar
--     una empresa se llevaría por delante sus sedes, sus períodos y
--     todas sus mediciones sin una sola advertencia.
--
-- Idempotente: se puede correr más de una vez sin efectos secundarios.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Índice que faltaba: se filtra sedes por empresa en casi toda pantalla
-- de administración, y empresa_id no estaba indexado (el PK cubre id,
-- no la FK).
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sedes_empresa ON sedes (empresa_id);

-- ---------------------------------------------------------------------
-- Columnas protegidas
-- ---------------------------------------------------------------------

-- Un admin puede renombrar sus sedes, pero no regalárselas a otra
-- empresa: eso las sacaría de su propio alcance de RLS y las metería en
-- el de otro cliente, arrastrando períodos y mediciones.
CREATE OR REPLACE FUNCTION sedes_proteger_columnas() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
        RAISE EXCEPTION 'No se puede mover una sede a otra empresa';
    END IF;
    NEW.id        := OLD.id;
    NEW.creado_en := OLD.creado_en;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sedes_proteger_columnas ON sedes;
CREATE TRIGGER trg_sedes_proteger_columnas
    BEFORE UPDATE ON sedes
    FOR EACH ROW
    EXECUTE FUNCTION sedes_proteger_columnas();

-- En períodos solo son editables 'tolerancia' y 'dias'. Cambiar mes/año
-- reescribiría la identidad de un registro histórico ya cargado, y
-- cambiar sede_id lo movería de planta con todas sus mediciones dentro.
CREATE OR REPLACE FUNCTION periodos_proteger_columnas() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_dia_max SMALLINT;
BEGIN
    IF auth.role() <> 'service_role' THEN
        IF NEW.sede_id IS DISTINCT FROM OLD.sede_id
           OR NEW.mes IS DISTINCT FROM OLD.mes
           OR NEW.anio IS DISTINCT FROM OLD.anio THEN
            RAISE EXCEPTION 'Solo se pueden modificar los días y la tolerancia del período';
        END IF;
        NEW.id        := OLD.id;
        NEW.creado_en := OLD.creado_en;
    END IF;

    -- Bajar 'dias' por debajo del último día ya capturado dejaría esas
    -- mediciones fuera del rango del período: invisibles en la tabla y
    -- en el resumen, pero todavía contando en la base y bloqueando el
    -- UNIQUE (periodo_id, dia, param_id). Se bloquea en vez de borrarlas.
    IF NEW.dias < OLD.dias THEN
        SELECT max(dia) INTO v_dia_max FROM mediciones WHERE periodo_id = OLD.id;
        IF v_dia_max IS NOT NULL AND v_dia_max > NEW.dias THEN
            RAISE EXCEPTION 'No se puede reducir a % días: ya hay mediciones cargadas hasta el día %', NEW.dias, v_dia_max;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_periodos_proteger_columnas ON periodos;
CREATE TRIGGER trg_periodos_proteger_columnas
    BEFORE UPDATE ON periodos
    FOR EACH ROW
    EXECUTE FUNCTION periodos_proteger_columnas();

-- ---------------------------------------------------------------------
-- Guardas de borrado — cada una explica en el mensaje qué hay que hacer
-- antes, porque el frontend muestra el texto del error tal cual.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION empresas_guardar_borrado() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_sedes    INTEGER;
    v_usuarios INTEGER;
BEGIN
    SELECT count(*) INTO v_sedes FROM sedes WHERE empresa_id = OLD.id;
    IF v_sedes > 0 THEN
        RAISE EXCEPTION 'La empresa tiene % sede(s): borra primero sus sedes', v_sedes;
    END IF;
    SELECT count(*) INTO v_usuarios FROM usuarios WHERE empresa_id = OLD.id;
    IF v_usuarios > 0 THEN
        RAISE EXCEPTION 'La empresa tiene % usuario(s) asignado(s)', v_usuarios;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresas_guardar_borrado ON empresas;
CREATE TRIGGER trg_empresas_guardar_borrado
    BEFORE DELETE ON empresas
    FOR EACH ROW
    EXECUTE FUNCTION empresas_guardar_borrado();

CREATE OR REPLACE FUNCTION sedes_guardar_borrado() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_periodos INTEGER;
BEGIN
    SELECT count(*) INTO v_periodos FROM periodos WHERE sede_id = OLD.id;
    IF v_periodos > 0 THEN
        RAISE EXCEPTION 'La sede tiene % período(s) con historial: borra primero los períodos vacíos o consérvala', v_periodos;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sedes_guardar_borrado ON sedes;
CREATE TRIGGER trg_sedes_guardar_borrado
    BEFORE DELETE ON sedes
    FOR EACH ROW
    EXECUTE FUNCTION sedes_guardar_borrado();

-- Un período sin ninguna medición es, casi siempre, un error de captura
-- recién cometido (mes equivocado, sede equivocada); uno con mediciones
-- es historial de la planta y no se borra desde la aplicación.
CREATE OR REPLACE FUNCTION periodos_guardar_borrado() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_mediciones INTEGER;
BEGIN
    SELECT count(*) INTO v_mediciones FROM mediciones WHERE periodo_id = OLD.id;
    IF v_mediciones > 0 THEN
        RAISE EXCEPTION 'El período tiene % medición(es) cargada(s) y no se puede borrar', v_mediciones;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_periodos_guardar_borrado ON periodos;
CREATE TRIGGER trg_periodos_guardar_borrado
    BEFORE DELETE ON periodos
    FOR EACH ROW
    EXECUTE FUNCTION periodos_guardar_borrado();

-- ---------------------------------------------------------------------
-- Políticas nuevas
--
-- Criterio de rol: renombrar una empresa es cosa del super (igual que
-- crearla). Sedes y períodos los administra quien administra la planta
-- — admin de la empresa o super — nunca el operario, aunque el operario
-- sí pueda crear períodos (comportamiento heredado que esta migración
-- deliberadamente no cambia): ajustar la tolerancia altera cómo se
-- evalúan las mediciones de todo el equipo, y borrar es irreversible.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS empresas_update_super ON empresas;
CREATE POLICY empresas_update_super ON empresas FOR UPDATE
    USING (rol_actual() = 'super')
    WITH CHECK (rol_actual() = 'super');

DROP POLICY IF EXISTS empresas_delete_super ON empresas;
CREATE POLICY empresas_delete_super ON empresas FOR DELETE
    USING (rol_actual() = 'super');

DROP POLICY IF EXISTS sedes_update ON sedes;
CREATE POLICY sedes_update ON sedes FOR UPDATE
    USING (
        rol_actual() = 'super'
        OR (rol_actual() = 'admin' AND empresa_id = empresa_actual())
    )
    WITH CHECK (
        rol_actual() = 'super'
        OR (rol_actual() = 'admin' AND empresa_id = empresa_actual())
    );

DROP POLICY IF EXISTS sedes_delete ON sedes;
CREATE POLICY sedes_delete ON sedes FOR DELETE
    USING (
        rol_actual() = 'super'
        OR (rol_actual() = 'admin' AND empresa_id = empresa_actual())
    );

DROP POLICY IF EXISTS periodos_update ON periodos;
CREATE POLICY periodos_update ON periodos FOR UPDATE
    USING (rol_actual() <> 'operario' AND puede_ver_sede(sede_id))
    WITH CHECK (rol_actual() <> 'operario' AND puede_ver_sede(sede_id));

DROP POLICY IF EXISTS periodos_delete ON periodos;
CREATE POLICY periodos_delete ON periodos FOR DELETE
    USING (rol_actual() <> 'operario' AND puede_ver_sede(sede_id));
