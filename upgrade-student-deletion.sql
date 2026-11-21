-- Apply as the operator before deploying the account deletion feature.
CREATE TABLE IF NOT EXISTS student_voice.deleted_students (firebase_uid_hash BINARY(32) PRIMARY KEY);
