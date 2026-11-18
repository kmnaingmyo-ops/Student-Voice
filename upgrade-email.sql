-- Run once for an existing local installation. Cloud startup checks each step.
ALTER TABLE students ADD COLUMN email VARBINARY(254) DEFAULT NULL;
ALTER TABLE students ADD COLUMN firebase_uid VARBINARY(128) DEFAULT NULL;
ALTER TABLE students ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX uq_students_email ON students (email);
CREATE UNIQUE INDEX uq_students_firebase_uid ON students (firebase_uid);
