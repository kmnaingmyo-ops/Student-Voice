-- Apply each statement with the database operator. Use the runtime account name from your host.
ALTER TABLE student_voice.comments ADD COLUMN review_pending TINYINT(1) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS student_voice.media_quota_lock (id TINYINT UNSIGNED PRIMARY KEY);
INSERT IGNORE INTO student_voice.media_quota_lock (id) VALUES (1);
