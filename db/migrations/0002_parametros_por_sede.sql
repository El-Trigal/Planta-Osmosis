-- =====================================================================
-- 0002 — Parámetros por sede, congelados por período
--
-- Hasta ahora los 17 parámetros y sus rangos de referencia estaban
-- quemados en dos lugares a la vez: la constante ETAPAS del frontend y
-- un CHECK sobre mediciones.param_id. Eran los de UNA planta, así que
-- una segunda sede con otro proceso no tenía forma de entrar al sistema.
--
-- El modelo queda en dos niveles:
--
--   sede_etapas / sede_parametros       → la PLANTILLA de la sede, que
--                                         es lo que un admin edita
--   periodo_etapas / periodo_parametros → lo que RIGE en un período
--                                         concreto, copiado de la
--                                         plantilla al crearlo
--
-- y mediciones cuelga del segundo nivel. La razón es que el estado de
-- una medición (ok / revisar / fuera de rango) no es un dato guardado
-- sino algo que se recalcula contra su rango: si los rangos vivieran
-- solo en la sede, corregir hoy el pH objetivo reescribiría en silencio
-- el cumplimiento de todos los meses ya reportados. Congelándolos, marzo
-- se sigue evaluando para siempre con los rangos que regían en marzo.
--
-- Los rangos de un período sí son editables (por admin o super): eso
-- cubre el caso de un valor mal cargado que hay que arreglar de verdad,
-- y a diferencia de editar la plantilla es explícito sobre qué período
-- se está tocando.
--
-- Migra los datos existentes: siembra la plantilla actual en cada sede,
-- le copia el snapshot a cada período ya creado y reapunta las
-- mediciones. Aborta sin cambiar nada si alguna medición no logra
-- mapearse.
--
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sede_etapas (
    id      SERIAL       PRIMARY KEY,
    sede_id INTEGER      NOT NULL REFERENCES sedes (id) ON DELETE CASCADE,
    clave   VARCHAR(30)  NOT NULL CHECK (btrim(clave) <> ''),
    nombre  VARCHAR(80)  NOT NULL CHECK (btrim(nombre) <> ''),
    icono   VARCHAR(30)  NOT NULL DEFAULT 'Beaker',
    color   CHAR(7)      NOT NULL DEFAULT '#0369a1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    orden   SMALLINT     NOT NULL DEFAULT 1,
    UNIQUE (sede_id, clave)
);

-- ref_tipo replica la forma que el frontend ya usaba en ETAPAS:
--   'target' → objetivo con tolerancia porcentual (la del período)
--   'range'  → banda cerrada [ref_min, ref_max]
--   'min'    → piso, 'max' → techo
-- 'medicion' agrupa el mismo parámetro a lo largo de las etapas (la
-- conductividad del pretratamiento y la del producto son ambas 'ce'), y
-- es lo que alimenta la gráfica de tendencia. Antes eso se deducía del
-- sufijo del id con un endsWith(), que funcionaba solo porque las claves
-- estaban escritas a mano con ese formato.
CREATE TABLE IF NOT EXISTS sede_parametros (
    id             SERIAL        PRIMARY KEY,
    sede_etapa_id  INTEGER       NOT NULL REFERENCES sede_etapas (id) ON DELETE CASCADE,
    clave          VARCHAR(30)   NOT NULL CHECK (btrim(clave) <> ''),
    label          VARCHAR(80)   NOT NULL CHECK (btrim(label) <> ''),
    unidad         VARCHAR(20)   NOT NULL DEFAULT '',
    medicion       VARCHAR(20)   NOT NULL CHECK (btrim(medicion) <> ''),
    ref_tipo       VARCHAR(10)   NOT NULL CHECK (ref_tipo IN ('target', 'range', 'min', 'max')),
    ref_valor      NUMERIC(10,4),
    ref_min        NUMERIC(10,4),
    ref_max        NUMERIC(10,4),
    orden          SMALLINT      NOT NULL DEFAULT 1,
    UNIQUE (sede_etapa_id, clave),
    CONSTRAINT sede_parametros_ref_check CHECK (
        (ref_tipo = 'range' AND ref_min IS NOT NULL AND ref_max IS NOT NULL AND ref_min < ref_max)
        OR (ref_tipo <> 'range' AND ref_valor IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS periodo_etapas (
    id         SERIAL       PRIMARY KEY,
    periodo_id INTEGER      NOT NULL REFERENCES periodos (id) ON DELETE CASCADE,
    clave      VARCHAR(30)  NOT NULL CHECK (btrim(clave) <> ''),
    nombre     VARCHAR(80)  NOT NULL CHECK (btrim(nombre) <> ''),
    icono      VARCHAR(30)  NOT NULL DEFAULT 'Beaker',
    color      CHAR(7)      NOT NULL DEFAULT '#0369a1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    orden      SMALLINT     NOT NULL DEFAULT 1,
    UNIQUE (periodo_id, clave)
);

CREATE TABLE IF NOT EXISTS periodo_parametros (
    id                SERIAL        PRIMARY KEY,
    periodo_etapa_id  INTEGER       NOT NULL REFERENCES periodo_etapas (id) ON DELETE CASCADE,
    clave             VARCHAR(30)   NOT NULL CHECK (btrim(clave) <> ''),
    label             VARCHAR(80)   NOT NULL CHECK (btrim(label) <> ''),
    unidad            VARCHAR(20)   NOT NULL DEFAULT '',
    medicion          VARCHAR(20)   NOT NULL CHECK (btrim(medicion) <> ''),
    ref_tipo          VARCHAR(10)   NOT NULL CHECK (ref_tipo IN ('target', 'range', 'min', 'max')),
    ref_valor         NUMERIC(10,4),
    ref_min           NUMERIC(10,4),
    ref_max           NUMERIC(10,4),
    orden             SMALLINT      NOT NULL DEFAULT 1,
    UNIQUE (periodo_etapa_id, clave),
    CONSTRAINT periodo_parametros_ref_check CHECK (
        (ref_tipo = 'range' AND ref_min IS NOT NULL AND ref_max IS NOT NULL AND ref_min < ref_max)
        OR (ref_tipo <> 'range' AND ref_valor IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_sede_etapas_sede ON sede_etapas (sede_id);
CREATE INDEX IF NOT EXISTS idx_sede_parametros_etapa ON sede_parametros (sede_etapa_id);
CREATE INDEX IF NOT EXISTS idx_periodo_etapas_periodo ON periodo_etapas (periodo_id);
CREATE INDEX IF NOT EXISTS idx_periodo_parametros_etapa ON periodo_parametros (periodo_etapa_id);

-- ---------------------------------------------------------------------
-- Plantilla por defecto: exactamente las 5 etapas y 17 parámetros que
-- estaban quemados en ETAPAS, para que una sede nueva siga arrancando
-- lista para usar y esta migración no cambie nada de lo que ya existe.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sembrar_plantilla_sede(p_sede_id INTEGER) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Sin esto, una sede que ya tiene su plantilla editada la vería
    -- duplicada al reaplicar la migración.
    IF EXISTS (SELECT 1 FROM sede_etapas WHERE sede_id = p_sede_id) THEN
        RETURN;
    END IF;

    WITH nuevas AS (
        INSERT INTO sede_etapas (sede_id, clave, nombre, icono, color, orden)
        VALUES
            (p_sede_id, 'pretratamiento', 'Pretratamiento',     'Beaker',       '#0369a1', 1),
            (p_sede_id, 'aireacion',      'Tanque de Aireación', 'Wind',        '#0891b2', 2),
            (p_sede_id, 'prefiltro',      'Pre-filtro',          'Filter',      '#0d9488', 3),
            (p_sede_id, 'posfiltro',      'Pos-filtro',          'Filter',      '#16a34a', 4),
            (p_sede_id, 'producto',       'Producto',            'FlaskConical', '#2563eb', 5)
        RETURNING id, clave
    )
    INSERT INTO sede_parametros (sede_etapa_id, clave, label, unidad, medicion, ref_tipo, ref_valor, ref_min, ref_max, orden)
    SELECT n.id, v.clave, v.label, v.unidad, v.medicion, v.ref_tipo, v.ref_valor, v.ref_min, v.ref_max, v.orden
    FROM nuevas n
    JOIN (VALUES
        ('pretratamiento', 'pre_ce',     'Conductividad (Ce)', 'mS/cm', 'ce',     'target', 0.8::NUMERIC(10,4), NULL::NUMERIC(10,4), NULL::NUMERIC(10,4), 1::SMALLINT),
        ('pretratamiento', 'pre_ph',     'pH',                 '',      'ph',     'min',    8.0,                NULL,                NULL,                2),
        ('pretratamiento', 'pre_cl',     'Cl-Libre',           'ppm',   'cl',     'target', 0.5,                NULL,                NULL,                3),
        ('pretratamiento', 'pre_al',     'Aluminio',           'ppm',   'al',     'min',    0.2,                NULL,                NULL,                4),
        ('aireacion',      'air_ce',     'Conductividad (Ce)', 'mS/cm', 'ce',     'target', 0.1,                NULL,                NULL,                1),
        ('aireacion',      'air_ph',     'pH',                 '',      'ph',     'range',  NULL,               6.0,                 6.6,                 2),
        ('aireacion',      'air_cl',     'Cl-Libre',           'ppm',   'cl',     'target', 0.1,                NULL,                NULL,                3),
        ('prefiltro',      'prf_ce',     'Conductividad (Ce)', 'mS/cm', 'ce',     'target', 1.1,                NULL,                NULL,                1),
        ('prefiltro',      'prf_ph',     'pH',                 '',      'ph',     'range',  NULL,               6.0,                 6.7,                 2),
        ('prefiltro',      'prf_cl',     'Cl-Libre',           'ppm',   'cl',     'target', 1.1,                NULL,                NULL,                3),
        ('posfiltro',      'pof_ce',     'Conductividad (Ce)', 'mS/cm', 'ce',     'target', 1.1,                NULL,                NULL,                1),
        ('posfiltro',      'pof_ph',     'pH',                 '',      'ph',     'target', 6.7,                NULL,                NULL,                2),
        ('posfiltro',      'pof_cl',     'Cl-Libre',           'ppm',   'cl',     'target', 0.0,                NULL,                NULL,                3),
        ('producto',       'prd_ce',     'Conductividad (Ce)', 'mS/cm', 'ce',     'range',  NULL,               0.1,                 0.3,                 1),
        ('producto',       'prd_ph',     'pH',                 '',      'ph',     'target', 6.7,                NULL,                NULL,                2),
        ('producto',       'prd_cl',     'Cl-Libre',           'ppm',   'cl',     'target', 0.0,                NULL,                NULL,                3),
        ('producto',       'prd_caudal', 'Caudal',             'l/min', 'caudal', 'target', 35.0,               NULL,                NULL,                4)
    ) AS v(etapa_clave, clave, label, unidad, medicion, ref_tipo, ref_valor, ref_min, ref_max, orden)
      ON v.etapa_clave = n.clave;
END;
$$;

-- Copia la plantilla vigente de la sede al período. Es lo que congela
-- los rangos: a partir de acá, editar la plantilla ya no afecta a este
-- período.
CREATE OR REPLACE FUNCTION copiar_plantilla_a_periodo(p_periodo_id INTEGER) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sede_id INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM periodo_etapas WHERE periodo_id = p_periodo_id) THEN
        RETURN;
    END IF;

    SELECT sede_id INTO v_sede_id FROM periodos WHERE id = p_periodo_id;
    IF v_sede_id IS NULL THEN
        RETURN;
    END IF;

    -- Una sede creada antes de esta migración puede no tener plantilla
    -- todavía si el trigger de siembra no llegó a correr para ella.
    PERFORM sembrar_plantilla_sede(v_sede_id);

    WITH nuevas AS (
        INSERT INTO periodo_etapas (periodo_id, clave, nombre, icono, color, orden)
        SELECT p_periodo_id, se.clave, se.nombre, se.icono, se.color, se.orden
        FROM sede_etapas se
        WHERE se.sede_id = v_sede_id
        RETURNING id, clave
    )
    INSERT INTO periodo_parametros (periodo_etapa_id, clave, label, unidad, medicion, ref_tipo, ref_valor, ref_min, ref_max, orden)
    SELECT n.id, sp.clave, sp.label, sp.unidad, sp.medicion, sp.ref_tipo, sp.ref_valor, sp.ref_min, sp.ref_max, sp.orden
    FROM nuevas n
    JOIN sede_etapas se ON se.sede_id = v_sede_id AND se.clave = n.clave
    JOIN sede_parametros sp ON sp.sede_etapa_id = se.id;
END;
$$;

-- Los dos triggers hacen que esto sea invisible desde el frontend: crear
-- una sede o un período por supabase-js sigue siendo un solo INSERT.
CREATE OR REPLACE FUNCTION sedes_sembrar_plantilla() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM sembrar_plantilla_sede(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sedes_sembrar_plantilla ON sedes;
CREATE TRIGGER trg_sedes_sembrar_plantilla
    AFTER INSERT ON sedes
    FOR EACH ROW
    EXECUTE FUNCTION sedes_sembrar_plantilla();

CREATE OR REPLACE FUNCTION periodos_copiar_plantilla() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM copiar_plantilla_a_periodo(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_periodos_copiar_plantilla ON periodos;
CREATE TRIGGER trg_periodos_copiar_plantilla
    AFTER INSERT ON periodos
    FOR EACH ROW
    EXECUTE FUNCTION periodos_copiar_plantilla();

-- ---------------------------------------------------------------------
-- Backfill de lo que ya existe
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_sede    RECORD;
    v_periodo RECORD;
BEGIN
    FOR v_sede IN SELECT id FROM sedes LOOP
        PERFORM sembrar_plantilla_sede(v_sede.id);
    END LOOP;
    FOR v_periodo IN SELECT id FROM periodos LOOP
        PERFORM copiar_plantilla_a_periodo(v_periodo.id);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- mediciones: param_id (texto de una lista fija) → parametro_id (FK)
--
-- ON DELETE RESTRICT y no CASCADE: borrar un parámetro no puede llevarse
-- las mediciones que lo usan. El trigger de más abajo convierte ese
-- rechazo en un mensaje en castellano.
-- ---------------------------------------------------------------------
ALTER TABLE mediciones ADD COLUMN IF NOT EXISTS parametro_id INTEGER
    REFERENCES periodo_parametros (id) ON DELETE RESTRICT;

-- Va antes de soltar param_id: el trigger de columnas protegidas de
-- db/rls.sql fija esa columna, así que entre el DROP y su redefinición
-- todo UPDATE sobre mediciones fallaría. La regla que aplica es la misma
-- de siempre: un UPDATE legítimo no puede reasignar a qué celda ni a
-- quién pertenece la medición.
CREATE OR REPLACE FUNCTION mediciones_proteger_columnas() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.periodo_id   := OLD.periodo_id;
    NEW.dia          := OLD.dia;
    NEW.parametro_id := OLD.parametro_id;
    NEW.usuario_id   := OLD.usuario_id;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    v_huerfanas INTEGER;
BEGIN
    -- Si la columna vieja ya no está, la migración ya corrió entera.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mediciones' AND column_name = 'param_id'
    ) THEN
        RETURN;
    END IF;

    UPDATE mediciones m
    SET parametro_id = pp.id
    FROM periodo_etapas pe
    JOIN periodo_parametros pp ON pp.periodo_etapa_id = pe.id
    WHERE pe.periodo_id = m.periodo_id
      AND pp.clave = m.param_id
      AND m.parametro_id IS NULL;

    SELECT count(*) INTO v_huerfanas FROM mediciones WHERE parametro_id IS NULL;
    IF v_huerfanas > 0 THEN
        -- Aborta la transacción entera: es preferible no migrar a migrar
        -- dejando mediciones sin parámetro al que apuntar.
        RAISE EXCEPTION '% medición(es) no se pudieron mapear a un parámetro; se aborta la migración', v_huerfanas;
    END IF;

    ALTER TABLE mediciones ALTER COLUMN parametro_id SET NOT NULL;
    ALTER TABLE mediciones DROP CONSTRAINT IF EXISTS mediciones_periodo_id_dia_param_id_key;
    -- No se pierde información al soltar param_id: su contenido es exactamente
    -- periodo_parametros.clave, que queda guardado en el snapshot del período.
    ALTER TABLE mediciones DROP COLUMN param_id;
    ALTER TABLE mediciones ADD CONSTRAINT mediciones_periodo_dia_parametro_key
        UNIQUE (periodo_id, dia, parametro_id);
END;
$$;

-- ---------------------------------------------------------------------
-- Guardas de borrado, en la misma línea que las de 0001
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION periodo_parametros_guardar_borrado() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_mediciones INTEGER;
BEGIN
    SELECT count(*) INTO v_mediciones FROM mediciones WHERE parametro_id = OLD.id;
    IF v_mediciones > 0 THEN
        RAISE EXCEPTION 'El parámetro "%" ya tiene % medición(es) cargada(s) en este período', OLD.label, v_mediciones;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_periodo_parametros_guardar_borrado ON periodo_parametros;
CREATE TRIGGER trg_periodo_parametros_guardar_borrado
    BEFORE DELETE ON periodo_parametros
    FOR EACH ROW
    EXECUTE FUNCTION periodo_parametros_guardar_borrado();

-- Borrar la etapa arrastra sus parámetros por CASCADE, y cada uno pasaría
-- por su propia guarda; este chequeo se adelanta para dar un mensaje que
-- hable de la etapa y no de un parámetro suelto.
CREATE OR REPLACE FUNCTION periodo_etapas_guardar_borrado() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_mediciones INTEGER;
BEGIN
    SELECT count(*) INTO v_mediciones
    FROM mediciones m
    JOIN periodo_parametros pp ON pp.id = m.parametro_id
    WHERE pp.periodo_etapa_id = OLD.id;
    IF v_mediciones > 0 THEN
        RAISE EXCEPTION 'La etapa "%" ya tiene % medición(es) cargada(s) en este período', OLD.nombre, v_mediciones;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_periodo_etapas_guardar_borrado ON periodo_etapas;
CREATE TRIGGER trg_periodo_etapas_guardar_borrado
    BEFORE DELETE ON periodo_etapas
    FOR EACH ROW
    EXECUTE FUNCTION periodo_etapas_guardar_borrado();

-- ---------------------------------------------------------------------
-- Helpers de RLS: las políticas necesitan llegar a la sede o al período
-- desde una fila que solo conoce a su etapa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sede_de_etapa(p_etapa_id INTEGER) RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT sede_id FROM sede_etapas WHERE id = p_etapa_id $$;

CREATE OR REPLACE FUNCTION periodo_de_etapa(p_etapa_id INTEGER) RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT periodo_id FROM periodo_etapas WHERE id = p_etapa_id $$;

-- Administrar la configuración de una planta es cosa de admin/super; el
-- operario captura mediciones contra ella pero no la define.
CREATE OR REPLACE FUNCTION puede_administrar_sede(p_sede_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
    SELECT CASE
        WHEN rol_actual() = 'super' THEN true
        WHEN rol_actual() = 'admin' THEN
            EXISTS (SELECT 1 FROM sedes s WHERE s.id = p_sede_id AND s.empresa_id = empresa_actual())
        ELSE false
    END
$$;

CREATE OR REPLACE FUNCTION puede_administrar_periodo(p_periodo_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT COALESCE(puede_administrar_sede(sede_id), false) FROM periodos WHERE id = p_periodo_id $$;

GRANT EXECUTE ON FUNCTION sede_de_etapa(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION periodo_de_etapa(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION puede_administrar_sede(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION puede_administrar_periodo(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------
-- RLS de las cuatro tablas nuevas
-- ---------------------------------------------------------------------
ALTER TABLE sede_etapas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sede_parametros    ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodo_etapas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodo_parametros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sede_etapas_select ON sede_etapas;
CREATE POLICY sede_etapas_select ON sede_etapas FOR SELECT
    USING (puede_ver_sede(sede_id));

DROP POLICY IF EXISTS sede_etapas_escribir ON sede_etapas;
CREATE POLICY sede_etapas_escribir ON sede_etapas FOR ALL
    USING (puede_administrar_sede(sede_id))
    WITH CHECK (puede_administrar_sede(sede_id));

DROP POLICY IF EXISTS sede_parametros_select ON sede_parametros;
CREATE POLICY sede_parametros_select ON sede_parametros FOR SELECT
    USING (puede_ver_sede(sede_de_etapa(sede_etapa_id)));

DROP POLICY IF EXISTS sede_parametros_escribir ON sede_parametros;
CREATE POLICY sede_parametros_escribir ON sede_parametros FOR ALL
    USING (puede_administrar_sede(sede_de_etapa(sede_etapa_id)))
    WITH CHECK (puede_administrar_sede(sede_de_etapa(sede_etapa_id)));

DROP POLICY IF EXISTS periodo_etapas_select ON periodo_etapas;
CREATE POLICY periodo_etapas_select ON periodo_etapas FOR SELECT
    USING (puede_ver_periodo(periodo_id));

DROP POLICY IF EXISTS periodo_etapas_escribir ON periodo_etapas;
CREATE POLICY periodo_etapas_escribir ON periodo_etapas FOR ALL
    USING (puede_administrar_periodo(periodo_id))
    WITH CHECK (puede_administrar_periodo(periodo_id));

DROP POLICY IF EXISTS periodo_parametros_select ON periodo_parametros;
CREATE POLICY periodo_parametros_select ON periodo_parametros FOR SELECT
    USING (puede_ver_periodo(periodo_de_etapa(periodo_etapa_id)));

DROP POLICY IF EXISTS periodo_parametros_escribir ON periodo_parametros;
CREATE POLICY periodo_parametros_escribir ON periodo_parametros FOR ALL
    USING (puede_administrar_periodo(periodo_de_etapa(periodo_etapa_id)))
    WITH CHECK (puede_administrar_periodo(periodo_de_etapa(periodo_etapa_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON
    sede_etapas, sede_parametros, periodo_etapas, periodo_parametros
TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
