-- Apply with the database operator before running the new application.
ALTER TABLE student_voice.students ADD COLUMN must_reset_password TINYINT(1) NOT NULL DEFAULT 0;
