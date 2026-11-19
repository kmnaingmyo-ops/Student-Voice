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

Legacy student accounts remain accessible until individually migrated; old short passwords have not been silently reset. New Firebase accounts require email verification and the current password policy. Verify Firebase email enumeration protection in the console. Application signup/reset responses avoid revealing account existence, but this alone does not prove provider configuration.

## External work still required for enterprise use

- Identity / SSO: choose the school's identity provider and approved domains, configure tenant membership and provisioning/deprovisioning. Verified email alone is not school membership. This app is currently single-school, not a multi-tenant system.
- MFA / passwordless: enroll teachers now. School-wide passkeys or identity-provider MFA require provider configuration; TOTP is not phishing-resistant.
- Network: put a managed WAF/DDoS service in front, restrict the database to approved network paths, and review proxy trust. No WAF or private networking has been provisioned here.
- Secrets: move credentials into the organization's managed secret vault and separate migration credentials from runtime credentials. Existing Render environment settings remain in use; no passwords were rotated automatically.
- Cloud: enforce administrator MFA on GitHub/Render/TiDB/Firebase, least-privilege service identities, separate staging and production, and tested encrypted backups with retention and restore objectives. Do not put database exports in this public repository.
- Containers: run the supplied image with a read-only root filesystem, dropped capabilities, and resource limits when compatible with database media storage. Scan the built image and pin a reviewed base-image digest before enterprise release. Docker has not replaced Render's runtime automatically.
- Monitoring / SIEM: configure a restricted log drain to your chosen SIEM, alerts for repeated 401/403/429/503 responses and privileged actions, and an incident-response owner. Structured logs are ready; no external SIEM is connected.
- Endpoint: IT must manage staff devices using disk encryption, automatic updates, endpoint detection, and browser policies. Website code cannot enforce device protection by itself.
- Governance: independent access-control testing, penetration testing, privacy review, retention/deletion processes, breach response, and operational ownership are required before enterprise adoption.

## Operational checks

Run npm ci, npm run check, npm test, and npm audit --omit=dev. CI configuration must run successfully on GitHub before it is treated as an enforced control. Use branch protection after the checks are available; this file does not enable repository settings.

Back up the database and SESSION_SECRET through separate protected processes. A lost encryption secret makes saved authenticator keys unrecoverable. Restrict database roles; the bootstrap currently needs CREATE TABLE privileges. For enterprise operation, run migrations separately and give the runtime only required data privileges.
