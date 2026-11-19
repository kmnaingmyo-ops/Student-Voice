# Student Voice: database operations

These tools support this small school database. They do not create a managed vault, a production backup schedule, or enterprise certification. Use a separate test environment with fictional records before handling real student data.

## Separate the web account from the operator

The web app needs data access, not permission to create/drop tables or manage MySQL accounts. `runtime-permissions.sql` grants only the operations currently used by the app. An isolated integration test runs login, MFA, revocation and session/rate-limit storage using those grants, and confirms CREATE, ALTER and DROP are denied.

1. Apply database migrations using an operator connection before deploying a schema change. Copy `operator.env.example` to `operator.env` privately. Enter the operator connection settings there; do not put operator credentials in Render's web environment or GitHub.
2. Run `npm run db:migrate`. This creates missing tables and applies the existing email-field/index migration. It does not drop or replace school records. This is not a general migration framework for arbitrary future schema changes.
3. Create a separate database user called `sv_runtime` through the database administrator console, choosing its password privately. TiDB Starter requires the instance prefix in both SQL account names and connection usernames: create `<prefix>.sv_runtime` and replace **every** quoted `sv_runtime` in `runtime-permissions.sql` with that exact full name before running it. Find the prefix in TiDB's Connect panel. Review and run the adjusted grants as the operator. Keep the database network allowlist restricted; the `%` MySQL host pattern does not replace that allowlist. See the [TiDB Starter username requirements](https://docs.pingcap.com/tidbcloud/select-cluster-tier/?compatibility=mysql&plan=starter).
4. In Render, set `DB_AUTO_MIGRATE=false`, then change DB_USER/DB_PASSWORD to the restricted account together. Save and deploy. Verify the live security workflow, student posting/profile/reactions, and administrator moderation. The old operator credentials should not remain in the web service settings after the switch.
5. Keep migrations and backups on a separate protected operator machine or deployment job. New administrator creation also needs the operator; `scripts/create-staff.js` cannot insert staff through the restricted runtime user.

Do not revoke the old account before the restricted account has been tested. Creating a new production account and choosing its password are private administrator steps. Merely committing these grants does not change the live database user. The original first-time setup remains compatible unless DB_AUTO_MIGRATE is explicitly false.

## Encrypted backup

1. Use Node.js 22 or newer and install the recorded dependencies with `npm ci`.
2. Set the source DB_NAME and private operator settings in `operator.env`. For a cloud database use `DB_SSL=true`. The operator's network must be deliberately permitted in TiDB; do not reopen all-public access for backups.
3. Generate a backup encryption key locally:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

4. Save the key in a protected password manager and enter it as BACKUP_KEY in the private operator file. Keep it separate from backup files. Do not use SESSION_SECRET or a short human password as BACKUP_KEY.
5. Make a private `backups` folder and run:

   ```powershell
   npm run backup -- backups/school-2026-11-19.svbackup
   ```

The file uses gzip and AES-256-GCM with a random nonce. A wrong key or modified ciphertext is rejected. Existing files are never overwritten. Files under the project's public folder are rejected, including a symlinked parent directory. The command requests owner-only permissions where the operating system supports them; on Windows, verify the folder's NTFS permissions yourself. Keep encrypted copies on a separate protected storage device with school-approved retention. No automatic upload, retention, production export, or scheduling is enabled by this release.

Backups cover the current staff, students, suggestions, reactions, comments, staff_security, security_events, and database-stored media_files tables. They deliberately omit app_sessions and security_limits, so restoring does not revive sessions. They have a 100 MiB uncompressed limit and 100,000-row limit per table; a larger service needs a streaming managed backup system. Pause schema changes during the snapshot. File-based media in a local `uploads` folder requires a separate protected file backup; the live deployment uses database media.

Firebase accounts, provider configuration, Render settings, and SESSION_SECRET are not in this export. Preserve SESSION_SECRET privately: encrypted authenticator secrets cannot be used without it. Restoring an old backup may also bring back old password hashes or recovery-code hashes. Plan credential review/recovery-code replacement before using restored data in production.

## Test a restore without touching production

1. On a local or separate recovery server, create a new empty database, for example:

   ```sql
   CREATE DATABASE sv_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Point the private operator file at this recovery server and set DB_NAME=sv_restore_drill. Use the original BACKUP_KEY.
3. Run:

   ```powershell
   npm run restore-test -- backups/school-2026-11-19.svbackup
   ```

4. Verify article content/counts, Japanese text, profiles, image bytes, moderation, comments/reactions, and administrator access with the original SESSION_SECRET in an isolated app. Do not connect test accounts to real email services unnecessarily.

The tool refuses production names, a name matching the source, non-utf8mb4 targets, or any target that already contains tables. It restores only the fixed known tables using parameterized inserts and local schema definitions, never SQL embedded in a backup. A failed import can leave empty tables because MySQL DDL is not transactional; use another empty recovery database after investigating. It never switches the live app to the recovery database.

Automated tests perform a real encrypted round trip with fictional articles, comments, reactions, binary email fields, image bytes and encrypted MFA records. They verify that session/counter tables remain empty, altered ciphertext/wrong keys fail, and repeat/production-target restores are refused. This is a tested application-level recovery path, not a completed restore drill of your TiDB production backup or a guaranteed recovery time.

For enterprise use, designate a recovery owner, approve backup retention, set recovery time/data-loss objectives, and run a supervised drill on production-like infrastructure. TiDB's current free daily backup retains only one day, so do not rely on it as the only long-term copy.
