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
   npm run backup:external -- C:/PrivateBackups/school-2026-11-19.svbackup
   ```

The file uses gzip and AES-256-GCM with a random nonce. A wrong key or modified ciphertext is rejected. Existing files are never overwritten. Files inside the checkout are rejected, including when a symbolic link resolves inside it. The command requests owner-only permissions where the operating system supports them; on Windows, verify the folder's NTFS permissions yourself. Keep encrypted copies on a separate protected storage device with school-approved retention. No automatic upload, retention, production export, or scheduling is enabled by this release.

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
   npm run restore-test -- C:/PrivateBackups/school-2026-11-19.svbackup
   ```

4. Verify article content/counts, Japanese text, profiles, image bytes, moderation, comments/reactions, and administrator access with the original SESSION_SECRET in an isolated app. Do not connect test accounts to real email services unnecessarily.

The tool refuses production names, a name matching the source, non-utf8mb4 targets, or any target that already contains tables. It restores only the fixed known tables using parameterized inserts and local schema definitions, never SQL embedded in a backup. A failed import can leave empty tables because MySQL DDL is not transactional; use another empty recovery database after investigating. It never switches the live app to the recovery database.

Automated tests perform a real encrypted round trip with fictional articles, comments, reactions, binary email fields, image bytes and encrypted MFA records. They verify that session/counter tables remain empty, altered ciphertext/wrong keys fail, and repeat/production-target restores are refused. This is a tested application-level recovery path, not a completed restore drill of your TiDB production backup or a guaranteed recovery time.

For enterprise use, designate a recovery owner, approve backup retention, set recovery time/data-loss objectives, and run a supervised drill on production-like infrastructure. TiDB's current free daily backup retains only one day, so do not rely on it as the only long-term copy.

## Roll out the security review

1. Keep the current `SESSION_SECRET`. Do not set a password cutoff for this release. Record the currently deployed Render commit for rollback.
2. With the database operator, run `upgrade-legacy-password-policy.sql`, `upgrade-abuse-guards.sql`, and `upgrade-student-deletion.sql`. Run each SQL statement separately if the console only executes the statement at the cursor. Fresh installations and `npm run db:migrate` create the same schema.
3. Apply the additional table grants in `runtime-permissions.sql` with the actual runtime account name. This includes locking the media quota row, recording deleted Firebase identities and deleting the selected student data. It keeps schema changes with the operator.
4. Deploy the reviewed commit. The IP trust default remains one proxy hop on Render. Set `TRUST_PROXY_HOPS=1` explicitly only after confirming the architecture and observed source addresses. Keep `ALLOWED_EMAIL_DOMAINS` empty until a list is approved. It applies to signup only. Configure the account budgets in `.env.example` only if the defaults are unsuitable.
5. Run the live checks and test the feature paths with disposable accounts. Confirm that the dashboard remains visible after a trash or restore action. Do not test permanent deletion on a real student account.
6. Before rotating secrets, read the procedure below. After enabling the encryption update, avoid rolling back to code that only reads the old encryption format. A forward hotfix is the safest rollback path once users have signed in or MFA records have been rewritten.

## Rotate the session secret gradually

1. Store the currently deployed master and the new random master in an approved password manager. In the hosting settings set `SESSION_SECRET_PREVIOUS` to the current value. Set `SESSION_SECRET` to the new value in the same release. Never paste secret values into source control or logs.
2. Redeploy. Older cookies and encrypted database sessions remain readable with the previous master. Give old sessions at least their full one-hour lifetime. The first successful MFA login rewrites that teacher's enrollment using the current key. Have each enrolled teacher verify sign-in using their authenticator.
3. If an enrollment predates the key separation release, request fresh recovery codes from the teacher security panel while both keys are still available. The original code digests needed the legacy master. New codes use a separate key. The authenticator registration stays usable.
4. Remove `SESSION_SECRET_PREVIOUS` only after all active enrollments and recovery codes have been verified and older sessions have expired. Preserve the old master in secure recovery storage if older backups may need it. Treat emergency compromise recovery separately, since retaining a compromised key prolongs exposure.

## Complete a deletion request

Verify the requester privately. When deleting on behalf of a student, put the account in Trash first, then use the permanent action and confirm with your own teacher password. The application deletes the student's articles and associated comments and reactions even when other students wrote them. A Firebase credential deleted by a teacher requires a separate step in Firebase Console. The application stores a SHA-256 digest of the old Firebase UID to prevent the deleted credential from silently making a new local account. Do not record the student's email in tickets or security logs. Before restoring a backup, apply verified deletion requests again to the recovery copy to avoid restoring removed data. The school must approve retention periods before inviting students to use the service.
