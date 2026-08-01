-- =====================================================================
-- Monitoreo Ósmosis Inversa — Esquema PostgreSQL (Supabase-nativo)
-- La autenticación la gestiona Supabase Auth (auth.users); usuarios.id
-- referencia directamente ese id, no hay password_hash propio.
--
-- ESTE ARCHIVO ES LA LÍNEA BASE, NO UNA MIGRACIÓN.
-- Describe el estado inicial del esquema y es idempotente: correrlo sobre
-- un proyecto que ya tiene estas tablas no hace nada y, sobre todo, NO
-- BORRA DATOS. Todo cambio posterior al esquema va como archivo nuevo y
-- numerado en db/migrations/, que se corren en orden una sola vez cada uno.
--
-- Ojo con la contracara de ser idempotente: como usa CREATE TABLE IF NOT
-- EXISTS, si una tabla ya existe se salta entera — incluidas las columnas
-- que le falten. Por eso este archivo sirve para levantar un proyecto
-- desde cero, y db/migrations/ para evolucionar uno que ya está vivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipo enumerado para roles de usuario
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE rol_usuario AS ENUM ('super', 'admin', 'operario');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresas (
    id        SERIAL PRIMARY KEY,
    nombre    VARCHAR(120) NOT NULL CHECK (btrim(nombre) <> ''),
    creado_en TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Sedes (plantas) — cada empresa puede tener varias
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sedes (
    id         SERIAL PRIMARY KEY,
    empresa_id INTEGER      NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    nombre     VARCHAR(120) NOT NULL CHECK (btrim(nombre) <> ''),
    creado_en  TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Usuarios (perfil de autorización; las credenciales viven en auth.users)
-- empresa_id es NULL únicamente para el rol 'super'
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id            UUID          PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    empresa_id    INTEGER       REFERENCES empresas (id) ON DELETE SET NULL,
    nombre        VARCHAR(120)  NOT NULL CHECK (btrim(nombre) <> ''),
    email         VARCHAR(180)  NOT NULL UNIQUE,
    rol           rol_usuario   NOT NULL DEFAULT 'operario',
    activo        BOOLEAN       NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMP     NOT NULL DEFAULT now(),
    CONSTRAINT usuarios_empresa_rol_check CHECK (
        (rol = 'super' AND empresa_id IS NULL) OR
        (rol <> 'super' AND empresa_id IS NOT NULL)
    )
);

-- ---------------------------------------------------------------------
-- Sedes accesibles por cada usuario (operario / admin)
-- El super no necesita filas aquí; ve todo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_sedes (
    usuario_id UUID    NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    sede_id    INTEGER NOT NULL REFERENCES sedes (id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, sede_id)
);

-- ---------------------------------------------------------------------
-- Períodos mensuales por sede
-- UNIQUE(sede_id, mes, anio) impide duplicar el mismo mes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS periodos (
    id         SERIAL    PRIMARY KEY,
    sede_id    INTEGER   NOT NULL REFERENCES sedes (id) ON DELETE CASCADE,
    mes        SMALLINT  NOT NULL CHECK (mes BETWEEN 1 AND 12),
    anio       SMALLINT  NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    dias       SMALLINT  NOT NULL DEFAULT 30 CHECK (dias BETWEEN 28 AND 31),
    tolerancia SMALLINT  NOT NULL DEFAULT 10 CHECK (tolerancia BETWEEN 0 AND 100),
    creado_en  TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (sede_id, mes, anio)
);

-- ---------------------------------------------------------------------
-- Mediciones (una fila = un día + un parámetro dentro de un período)
-- usuario_id = dueño de la celda (quien la cargó por última vez)
-- UNIQUE(periodo_id, dia, param_id) garantiza una sola celda por combo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mediciones (
    id             SERIAL        PRIMARY KEY,
    periodo_id     INTEGER       NOT NULL REFERENCES periodos (id) ON DELETE CASCADE,
    dia            SMALLINT      NOT NULL CHECK (dia BETWEEN 1 AND 31),
    param_id       VARCHAR(20)   NOT NULL CHECK (param_id IN (
                        'pre_ce', 'pre_ph', 'pre_cl', 'pre_al',
                        'air_ce', 'air_ph', 'air_cl',
                        'prf_ce', 'prf_ph', 'prf_cl',
                        'pof_ce', 'pof_ph', 'pof_cl',
                        'prd_ce', 'prd_ph', 'prd_cl', 'prd_caudal'
                    )),
    valor          NUMERIC(10,4) CHECK (valor IS NULL OR valor BETWEEN -9999.9999 AND 99999.9999),
    usuario_id     UUID          NOT NULL REFERENCES usuarios (id),
    actualizado_en TIMESTAMP     NOT NULL DEFAULT now(),
    UNIQUE (periodo_id, dia, param_id)
);

-- Equivalente a MySQL "ON UPDATE CURRENT_TIMESTAMP" para mediciones.actualizado_en
CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_10_actualizado_en ON mediciones;
CREATE TRIGGER trg_10_actualizado_en
    BEFORE UPDATE ON mediciones
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();

-- Validación cruzada dia <= periodos.dias (no se puede expresar como CHECK
-- simple porque depende de otra tabla).
CREATE OR REPLACE FUNCTION validar_dia_mediciones()
RETURNS TRIGGER AS $$
DECLARE
    v_dias SMALLINT;
BEGIN
    SELECT dias INTO v_dias FROM periodos WHERE id = NEW.periodo_id;
    IF v_dias IS NULL OR NEW.dia > v_dias THEN
        RAISE EXCEPTION 'Día fuera de rango para este período';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_20_validar_dia ON mediciones;
CREATE TRIGGER trg_20_validar_dia
    BEFORE INSERT OR UPDATE ON mediciones
    FOR EACH ROW
    EXECUTE FUNCTION validar_dia_mediciones();

-- =====================================================================
-- Las políticas de Row Level Security, funciones helper y el trigger de
-- columnas protegidas viven en db/rls.sql — correr ese archivo después
-- de este. Después de rls.sql van, en orden numérico, los archivos de
-- db/migrations/. El primer usuario 'super' se crea vía la Auth Admin API
-- (ver README.md), no con un INSERT directo, porque Supabase Auth debe
-- conocer sus credenciales.
-- =====================================================================
