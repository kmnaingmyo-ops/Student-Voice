CREATE DATABASE IF NOT EXISTS student_voice CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE student_voice;

CREATE TABLE IF NOT EXISTS staff (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARBINARY(254) DEFAULT NULL UNIQUE,
    firebase_uid VARBINARY(128) DEFAULT NULL UNIQUE,
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    password_hash VARCHAR(255) NOT NULL,
    password_version INT UNSIGNED NOT NULL DEFAULT 1,
    display_name VARCHAR(40) NOT NULL DEFAULT '',
    bio VARCHAR(300) NOT NULL DEFAULT '',
    avatar_name VARCHAR(50) DEFAULT NULL,
    reset_hash CHAR(64) DEFAULT NULL,
    reset_expires DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suggestions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id INT UNSIGNED DEFAULT NULL,
    title VARCHAR(60) NOT NULL,
    category VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,
    cover_icon VARCHAR(20) NOT NULL DEFAULT 'outline',
    image_name VARCHAR(50) DEFAULT NULL,
    status ENUM('pending','published','hidden') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (status, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reactions (
    post_id INT UNSIGNED NOT NULL,
    student_id INT UNSIGNED NOT NULL,
    kind ENUM('like','love','haha','wow','sad','care') NOT NULL,
    PRIMARY KEY (post_id, student_id),
    FOREIGN KEY (post_id) REFERENCES suggestions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    post_id INT UNSIGNED NOT NULL,
    student_id INT UNSIGNED NOT NULL,
    body VARCHAR(500) NOT NULL,
    hidden TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (post_id, hidden, id),
    FOREIGN KEY (post_id) REFERENCES suggestions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_sessions (
 id VARBINARY(64) PRIMARY KEY, data MEDIUMTEXT NOT NULL, expires_at BIGINT NOT NULL, INDEX (expires_at)
);
CREATE TABLE IF NOT EXISTS security_limits (
 id VARBINARY(64) PRIMARY KEY, hits INT UNSIGNED NOT NULL, reset_at BIGINT NOT NULL, INDEX (reset_at)
);
CREATE TABLE IF NOT EXISTS staff_security (
 staff_id INT UNSIGNED PRIMARY KEY, secret_cipher TEXT NULL, last_step BIGINT NOT NULL DEFAULT -1,
 recovery_hashes TEXT NULL, epoch INT UNSIGNED NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS security_events (
 id CHAR(36) PRIMARY KEY, occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 event VARCHAR(64) NOT NULL, actor VARCHAR(64) NOT NULL, request_id CHAR(36) NOT NULL,
 status SMALLINT NOT NULL, INDEX (occurred_at)
);
