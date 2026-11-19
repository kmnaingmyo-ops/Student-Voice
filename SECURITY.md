# Security deployment notes

This is a school project with additional security controls, not a certified enterprise service.

## Included controls

- MySQL/TiDB shared sessions, with AES-256-GCM encryption and HMAC session identifiers. Browser session IDs are not stored verbatim. Keep SESSION_SECRET stable and private. Rotating it deliberately signs out everyone and invalidates stored MFA keys: migration/re-enrollment must be planned first.
- Shared database rate limits by client IP and login account, with fail-closed database errors. Anonymous reads are also rate-limited. Trust proxy is set for Render's one-proxy configuration; review this before moving hosting.
- Existing server-side student/staff authorization and ownership checks, CSRF tokens, prepared queries, upload re-encoding, and CSP. Added HSTS in production, Permissions-Policy, frame blocking, and request IDs.
- Teacher TOTP authentication using OTPAuth, encrypted setup keys, five-minute challenges, single-use time steps, and eight hashed single-use recovery codes. Enabling MFA invalidates other teacher sessions. Setup requires the current password and a valid authenticator code.
- Teacher password changes invalidate existing sessions. Both teachers and students can sign out all application sessions. This does not revoke an identity-provider session outside Student Voice.
- Security events in structured server logs and the security_events database table. No request bodies, email addresses, passwords, cookies, OTPs, or recovery codes are logged. Database event retention is 30 days; session and limiter cleanup runs hourly and at startup.
- Non-root Docker image and a minimal build context; dependency alerts, npm audit, tests, and CodeQL workflow configuration. The current Render service still uses its Node runtime; adding a Dockerfile does not change that deployment mode.

## Teacher activation — do this yourself

1. Open the existing private teacher login route, then Account security (アカウントのセキュリティ).
2. Change a short legacy teacher password to a unique 15–64 character passphrase. This signs out all teacher sessions.
3. Log in again. Enter the current password under two-step verification, display the setup key, and add it manually to your authenticator app (TOTP, 6 digits, 30 seconds, SHA-1).
4. Enter the current six-digit app code. Save the eight recovery codes offline, separately from the password. Each can be used once instead of an app code.
5. Sign out and test a fresh login. A password alone must not show the dashboard after enrollment.

MFA is enforced for an enrolled teacher, but enrollment is not silently enabled: a person must control the authenticator and save recovery codes. There is no password-only MFA bypass or disable endpoint. If both the app and recovery codes are lost, recovery requires an authorized database operator after independently verifying identity. Do not remove MFA on an unverified request.

Legacy student accounts remain accessible until individually migrated; old short passwords have not been silently reset. New Firebase accounts require email verification and the current password policy. Firebase email enumeration protection was confirmed enabled in Authentication > Settings > User actions on 2026-11-19. Its password policy was also confirmed set to Require enforcement with a 15-character minimum and 64-character maximum. Application signup/reset responses avoid revealing account existence. Verified email proves inbox access, not school membership.

## External work still required for enterprise use

- Identity / SSO: choose the school's identity provider and approved domains, configure tenant membership and provisioning/deprovisioning. Verified email alone is not school membership. This app is currently single-school, not a multi-tenant system.
- MFA / passwordless: enroll teachers now. School-wide passkeys or identity-provider MFA require provider configuration; TOTP is not phishing-resistant.
- Network: the deployed TiDB public endpoint is limited to Render shared outbound ranges 74.220.49.0/24 and 74.220.57.0/24 (checked 2026-11-19). All-public access was replaced. These ranges are shared with other Render services, so TLS and database credentials are still required. No dedicated IP, WAF, or private networking has been provisioned. Re-check the Render Connect panel before changing regions or services.
- Secrets: move credentials into the organization's managed secret vault and separate migration credentials from runtime credentials. Existing Render environment settings remain in use; no passwords were rotated automatically.
- Cloud: enforce administrator MFA on GitHub/Render/TiDB/Firebase, least-privilege service identities, separate staging and production, and tested encrypted backups with retention and restore objectives. Do not put database exports in this public repository.
- Containers: the base image and CI actions are pinned to reviewed digests/commit SHAs. CI scans the built image with Grype and blocks fixable high/critical findings; lower-severity and unfixed findings still need regular review. Render still uses the Node runtime. Enterprise container operation additionally needs a read-only filesystem, dropped capabilities, and resource limits.
- Monitoring / SIEM: configure a restricted log drain to your chosen SIEM, alerts for repeated 401/403/429/503 responses and privileged actions, and an incident-response owner. Structured logs are ready; no external SIEM is connected.
- Endpoint: IT must manage staff devices using disk encryption, automatic updates, endpoint detection, and browser policies. Website code cannot enforce device protection by itself.
- Governance: independent access-control testing, penetration testing, privacy review, retention/deletion processes, breach response, and operational ownership are required before enterprise adoption.

## Operational checks

Run npm ci, npm run check, npm test, and npm audit --omit=dev. CI configuration must run successfully on GitHub before it is treated as an enforced control. Use branch protection after the checks are available; this file does not enable repository settings.

Back up the database and SESSION_SECRET through separate protected processes. A lost encryption secret makes saved authenticator keys unrecoverable. `DB_AUTO_MIGRATE=false` disables schema changes and administrator bootstrap in web startup. Run `npm run db:migrate` with separate private operator settings first, then grant the web account only `runtime-permissions.sql`. Default/local bootstrap remains compatible. Production account activation is a separate administrator step; shipping the SQL alone does not change live privileges. See OPERATIONS.md.


## Additional free protections (2026-11-19)

- GitHub dependency graph, Dependabot vulnerability alerts/security updates, malware alerts, and private vulnerability reporting are enabled. Secret scanning and push protection were already enabled and were preserved. Paid AI scanning was left off.
- The administrator dashboard includes a private security log viewer: 24-hour rejection/rate-limit/server-error counts plus the latest 50 events. Guests and students cannot read it. This is a local monitoring view, not an external SIEM or a staffed alert service.
- CI is scheduled weekly as well as on main pushes and pull requests. Action implementations and the Docker base image are pinned. The container scan runs without uploading the container to a registry; scan findings are published to the repository's security interface.
- MFA enrollment remains skipped at the owner's request. Existing passwords and authenticator settings were not changed.
- A local MySQL client can no longer reach the cloud database unless its source network is deliberately added by an authorized operator. Local MAMP/XAMPP databases are unaffected. Never restore all-public access just for convenience.

The container uses separate dependency-installation and runtime stages. npm, npx, Yarn, and Corepack are excluded from the final image. CI also smoke-tests runtime dependencies as a non-root user with a read-only filesystem, dropped capabilities, and no privilege escalation. This smoke test does not replace an end-to-end container deployment test with a production-like database.

## Live checks and recovery (2026-11-19)

The main branch is protected: pull requests, up-to-date passing check/codeql/container-scan jobs, and resolved conversations are required, including for administrators. Force pushes and deletion are not allowed. A separate reviewer is not required for this single-owner project.

Run `node check-live.mjs` with Node.js 22 or newer to check the public deployed site. No packages, passwords, or database credentials are needed. The separate Live security check workflow runs daily at approximately 08:35 Japan time and can be started manually in GitHub Actions. Scheduled GitHub jobs can be delayed or disabled by GitHub after repository inactivity; this is not continuous uptime monitoring. Review failed workflow runs and configure your own GitHub notification preferences.

The check tests security headers, HTTPS-only session cookie attributes, guest sessions, public article/database availability, rejection of guest administrator requests, rejection of guest article submission, and rejection of requests missing CSRF tokens. It sends eight requests, creates no student accounts or articles, and prints neither article content nor session tokens. Denied requests deliberately appear in security logs. The temporary guest session expires after one hour. This does not test real inbox delivery, authenticated ownership rules, MFA enrollment, restore correctness, or attacks against Firebase directly. Local database integration tests cover additional authenticated controls.

TiDB Cloud Starter's existing daily backup was checked in the console: the 2026-11-18 17:00 UTC backup succeeded and expires 2026-11-19 17:00 UTC. Backup settings show a daily 17:00 UTC cycle and **one-day retention** at the current $0 spending limit. Longer retention requires changing spending settings; no paid settings were enabled. A backup existing is not proof of a tested restore.

### If the website stops working

1. Check the latest Live security check and Render deployment logs. Keep response bodies, passwords, tokens, and student records out of public issues.
2. For a code regression, revert through a pull request with passing checks, then deploy the corrected commit. If urgent, use Render's existing rollback to a known good deployment while preparing the source revert. Database changes may need separate recovery; a code rollback does not reverse them.
3. If the database connection fails, compare Render's current outbound ranges with TiDB's allowlist, check TLS, and review database service status. Keep the database restricted; do not restore all-public access.

### If school data is deleted or damaged

1. Stop additional writes and contact the project owner immediately. The current one-day backup window is short; wait times can cause the last useful backup to expire.
2. In TiDB's Data > Backup screen, identify a successful backup from before the incident. Review the restore target and provider warnings before submitting any restore. Prefer a separate recovery target; do not overwrite production as a first experiment. A target or feature that requires payment needs an explicit budget decision.
3. Keep the original database and current application secret available privately. Validate article counts, images, profiles, moderation states, and permissions against the recovery target before switching the app. Do not publish database exports in GitHub or attach them to Actions artifacts.
4. Database backups contain password hashes and encrypted MFA keys but do not back up Firebase accounts, Render environment settings, or the SESSION_SECRET. Preserve the secret separately in a protected password manager. Do not rotate it during recovery without a migration plan.
5. After a restore, invalidate restored application sessions and verify student/teacher access. An independently tested restore and longer encrypted retention remain required for enterprise use; neither has been claimed here.

### If a credential is exposed

Revoke/rotate the affected provider credential privately, update the relevant hosting setting, and redeploy. Review security logs and GitHub secret alerts. Do not paste credentials into chat or commit them. Treat SESSION_SECRET separately: its rotation invalidates stored authenticator encryption and needs planned re-enrollment. Account and device MFA remain manual owner/IT tasks.

## Tested recovery and runtime separation

The maintenance CLI provides authenticated encrypted database snapshots and restoration only into an empty, separately named recovery database. Automated tests restore fictional data and media, reject tampering/wrong keys and unsafe targets, and exclude saved sessions. No production backup has been exported by these tests. Retention and protected storage are still operator responsibilities; the free TiDB backup configuration is unchanged.

Access-control integration tests run the web app using the restricted runtime grants, with automatic migrations disabled. CREATE, ALTER, and DROP are explicitly denied while authenticated controls and session storage work. The live TiDB account's ten table grants were verified on 2026-11-19, with only USAGE globally and no schema/account-administration privileges. Render now uses that account with DB_AUTO_MIGRATE=false. The corrected deployment and all five live check groups passed. Password values are not recorded here. Operator settings and .svbackup files are excluded from Git and Docker build context.

## Container integration and dependency inventory

CI also runs the authenticated access-control suite against the actual Docker image and a disposable MySQL database. The container uses its non-root production user, a read-only root filesystem, dropped capabilities, no privilege escalation, 256 MiB memory, one CPU, a 128-process limit, and a 16 MiB noexec temporary filesystem. It verifies the effective process settings and that the application directory cannot be written. The test port is bound only to runner loopback. The container can reach the runner database through its bridge gateway; this is not an egress firewall.

The suite exercises teacher login, CSRF rejection, MFA setup/replay/recovery, session revocation, student login and private-route authorization. CI simulates the trusted HTTPS proxy header over the runner's local HTTP connection and checks secure cookies and HSTS. It does not test real TLS termination or real Firebase inbox delivery. No production database or operator credentials are supplied to the container. Running Docker itself requires a trusted runner with access to its daemon.

Each successful security check generates a CycloneDX production dependency inventory using npm's built-in SBOM command and keeps the exact JSON artifact for 14 days. It contains the public dependency graph, not environment files, database exports, credentials, or student content. The upload action is pinned. An SBOM is an inventory, not a vulnerability verdict, signature, or compliance certification; the existing npm/CodeQL/container scan gates remain in place.

The live Render service continues to use Render's Node runtime. These Docker constraints are verified for the supplied image in CI and are not claimed as Render host configuration. The owner chose to keep the free Render URL: no separate domain, Cloudflare WAF, paid identity provider, vault, SIEM, Kubernetes cluster, or managed device product has been provisioned.
