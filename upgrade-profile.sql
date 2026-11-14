USE student_voice;
-- Import once after the student account upgrade.
ALTER TABLE students
    ADD COLUMN display_name VARCHAR(40) NOT NULL DEFAULT '',
    ADD COLUMN bio VARCHAR(300) NOT NULL DEFAULT '',
    ADD COLUMN avatar_name VARCHAR(50) DEFAULT NULL;
