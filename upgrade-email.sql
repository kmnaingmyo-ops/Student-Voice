-- Run once for an existing local installation. Cloud startup performs this safely.
ALTER TABLE students
    ADD COLUMN email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL UNIQUE,
    ADD COLUMN firebase_uid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL UNIQUE,
    ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0;
