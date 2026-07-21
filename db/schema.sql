-- =====================================================================
-- Monitoreo Ósmosis Inversa — Esquema MySQL
-- Hostinger Business · Motor InnoDB · utf8mb4
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresas (
    id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre    VARCHAR(120) NOT NULL,
    creado_en DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Sedes (plantas) — cada empresa puede tener varias
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sedes (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    empresa_id INT UNSIGNED NOT NULL,
    nombre     VARCHAR(120) NOT NULL,
    creado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Usuarios
-- empresa_id es NULL únicamente para el rol 'super'
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    empresa_id    INT UNSIGNED,
    nombre        VARCHAR(120)  NOT NULL,
    email         VARCHAR(180)  NOT NULL,
    password_hash VARCHAR(255)  NOT NULL,
    rol           ENUM('super','admin','operario') NOT NULL DEFAULT 'operario',
    activo        TINYINT(1)    NOT NULL DEFAULT 1,
    creado_en     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_email (email),
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Sedes accesibles por cada usuario (operario / admin)
-- El super no necesita filas aquí; ve todo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_sedes (
    usuario_id INT UNSIGNED NOT NULL,
    sede_id    INT UNSIGNED NOT NULL,
    PRIMARY KEY (usuario_id, sede_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
    FOREIGN KEY (sede_id)    REFERENCES sedes    (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Períodos mensuales por sede
-- UNIQUE(sede_id, mes, anio) impide duplicar el mismo mes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS periodos (
    id         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    sede_id    INT UNSIGNED     NOT NULL,
    mes        TINYINT UNSIGNED NOT NULL COMMENT '1..12',
    anio       SMALLINT UNSIGNED NOT NULL,
    dias       TINYINT UNSIGNED NOT NULL DEFAULT 30,
    tolerancia TINYINT UNSIGNED NOT NULL DEFAULT 10,
    creado_en  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_periodo (sede_id, mes, anio),
    FOREIGN KEY (sede_id) REFERENCES sedes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Mediciones (una fila = un día + un parámetro dentro de un período)
-- usuario_id = dueño de la celda (quien la cargó por última vez)
-- UNIQUE(periodo_id, dia, param_id) garantiza una sola celda por combo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mediciones (
    id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    periodo_id     INT UNSIGNED     NOT NULL,
    dia            TINYINT UNSIGNED NOT NULL COMMENT '1..31',
    param_id       VARCHAR(20)      NOT NULL,
    valor          DECIMAL(10,4),
    usuario_id     INT UNSIGNED     NOT NULL,
    actualizado_en DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_medicion (periodo_id, dia, param_id),
    FOREIGN KEY (periodo_id) REFERENCES periodos (id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- Para crear el primer usuario 'super' después de importar este esquema,
-- ejecuta en phpMyAdmin (ajusta email y contraseña):
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
