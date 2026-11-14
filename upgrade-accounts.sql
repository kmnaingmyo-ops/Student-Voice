USE student_voice;
CREATE TABLE IF NOT EXISTS students (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    password_version INT UNSIGNED NOT NULL DEFAULT 1,
    reset_hash CHAR(64) DEFAULT NULL,
    reset_expires DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Run this ALTER once on the existing project database.
ALTER TABLE suggestions ADD COLUMN student_id INT UNSIGNED DEFAULT NULL;
