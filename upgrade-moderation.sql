-- Run once as the database operator before deploying the moderation update.
ALTER TABLE student_voice.students ADD COLUMN account_status ENUM('active','banned','archived') NOT NULL DEFAULT 'active';
ALTER TABLE student_voice.suggestions ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE student_voice.comments ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0;
