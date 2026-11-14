-- Import once for the blog version. Existing content is preserved.
USE student_voice;
ALTER TABLE suggestions MODIFY COLUMN body TEXT NOT NULL;
