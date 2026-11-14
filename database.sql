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
