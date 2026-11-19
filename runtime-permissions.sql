-- Create sv_runtime privately first, using a unique password.
-- This grants no schema changes or account administration. Do not grant ALL.
-- For TiDB, use the connection username prefix shown in its Connect panel.
GRANT SELECT, UPDATE ON `student_voice`.`staff` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE ON `student_voice`.`students` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE ON `student_voice`.`suggestions` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `student_voice`.`reactions` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE ON `student_voice`.`comments` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, DELETE ON `student_voice`.`media_files` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `student_voice`.`app_sessions` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `student_voice`.`security_limits` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, UPDATE ON `student_voice`.`staff_security` TO 'sv_runtime'@'%';
GRANT SELECT, INSERT, DELETE ON `student_voice`.`security_events` TO 'sv_runtime'@'%';
