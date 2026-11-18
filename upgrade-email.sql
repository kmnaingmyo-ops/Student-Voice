-- Run once for an existing local installation. Cloud startup performs this safely.
ALTER TABLE students
    ADD COLUMN email VARBINARY(254) DEFAULT NULL UNIQUE,
    ADD COLUMN firebase_uid VARBINARY(128) DEFAULT NULL UNIQUE,
    ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0;
