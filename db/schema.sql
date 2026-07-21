-- =====================================================================
-- Monitoreo Ósmosis Inversa — Esquema PostgreSQL (Supabase)
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
    nombre    VARCHAR(120) NOT NULL,
    creado_en TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Sedes (plantas) — cada empresa puede tener varias
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sedes (
    id         SERIAL PRIMARY KEY,
    empresa_id INTEGER      NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    nombre     VARCHAR(120) NOT NULL,
    creado_en  TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Usuarios
-- empresa_id es NULL únicamente para el rol 'super'
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL        PRIMARY KEY,
    empresa_id    INTEGER       REFERENCES empresas (id) ON DELETE SET NULL,
    nombre        VARCHAR(120)  NOT NULL,
    email         VARCHAR(180)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    rol           rol_usuario   NOT NULL DEFAULT 'operario',
    activo        BOOLEAN       NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMP     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Sedes accesibles por cada usuario (operario / admin)
-- El super no necesita filas aquí; ve todo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_sedes (
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
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
    anio       SMALLINT  NOT NULL,
    dias       SMALLINT  NOT NULL DEFAULT 30,
    tolerancia SMALLINT  NOT NULL DEFAULT 10,
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
    param_id       VARCHAR(20)   NOT NULL,
    valor          NUMERIC(10,4),
    usuario_id     INTEGER       NOT NULL REFERENCES usuarios (id),
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

DROP TRIGGER IF EXISTS trg_mediciones_actualizado_en ON mediciones;
CREATE TRIGGER trg_mediciones_actualizado_en
    BEFORE UPDATE ON mediciones
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();

-- =====================================================================
-- Para crear el primer usuario 'super' después de importar este esquema,
-- ejecuta en el SQL Editor de Supabase (ajusta email y contraseña):
--
--   INSERT INTO usuarios (nombre, email, password_hash, rol)
--   VALUES (
--     'Super Admin',
--     'super@plantaosmosis.trigal-digital.com',
--     '$2y$10$CAMBIA_ESTE_HASH_CON_EL_SCRIPT_create_super.php',
--     'super'
--   );
--
-- O usa el script create_super.php incluido en el README.
-- =====================================================================
