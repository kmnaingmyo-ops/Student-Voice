USE student_voice;
-- Import once on an existing account-enabled blog database.
ALTER TABLE suggestions ADD COLUMN cover_icon VARCHAR(20) NOT NULL DEFAULT 'outline', ADD COLUMN image_name VARCHAR(50) DEFAULT NULL;
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

