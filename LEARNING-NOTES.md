# Learn from the Student Voice Kamata review

## Terms used in the review

- **Authentication** proves who is making a request. A teacher supplies a password, and an enrolled teacher also supplies a second factor.
- **Authorization** determines what the authenticated user can do. For example, a student can edit their own profile while only a teacher can open the moderation list.
- **IDOR** means a requested record ID can be swapped to act on someone else's record. Using the student's verified session ID for profile edits prevents a request body from choosing a different student.
- **CSRF** is when another site tricks a browser into making an authenticated change. Student Voice expects a session-specific token on writes, so a cross-site form cannot submit a valid article.
- **Session fixation** is preselecting a session ID and waiting for its user to sign in. Issuing a new ID at login separates the signed-in session from the old guest session.
- **Secure, HttpOnly, SameSite** are cookie rules. This app sends the cookie over HTTPS, keeps it out of browser scripts, and omits it on cross-site requests.
- **Rate limiting** caps attempts in a time window. The comment budget follows the signed-in student across devices, while an IP budget also limits traffic from one address.
- **Fail closed** means refusing an action when its security check cannot complete. If the database counter is unavailable, a comment write fails instead of proceeding uncounted.
- **Account enumeration** is learning which accounts exist from response differences. Password recovery gives the same message for known and unknown addresses, though provider timing can still differ.
- **HKDF** derives keys for different jobs from one high-entropy secret. The app uses different keys for session identifiers, session encryption, and authenticator seed encryption.
- **HMAC** is a keyed digest. It lets the app turn a private session ID into a database lookup key without storing the cookie value directly.
- **Authenticated encryption** protects readability and detects tampering. Changing one byte of an encrypted session causes it to be rejected.
- **MFA and TOTP** combine a password with another factor. TOTP is the six-digit code an authenticator creates from a shared secret and the current time.
- **Race condition and row lock** describe overlapping requests and how to order them. If a ban finishes first, a later write reads the banned state while holding the student row lock and stops.
- **XSS** happens when untrusted text is treated as executable markup. Displaying student text with `textContent` makes a pasted script appear as text.
- **SQL injection** is input being interpreted as SQL. A placeholder treats a title containing an apostrophe as data rather than query syntax.
- **Path traversal** is using a filename to escape its intended directory. The app only reads generated names such as a 32-digit hexadecimal value ending in `.webp`.
- **SSRF** is tricking a server into requesting a host it should not reach. The Cloudflare Worker fixes the destination to Render and the sign-in requests use a fixed Firebase host.
- **Decompression bomb** is a small file that expands to consume substantial memory. An image must meet both the uploaded-byte cap and the decoded-pixel cap.
- **Trust proxy** tells Express which upstream server addresses to believe. An extra trusted hop can make the app treat unverified forwarding data as a client address.
- **SHA-256 digest** is a one-way fingerprint. The deletion marker stores a digest of the random Firebase ID so the deleted credential cannot reconstruct its local account.
- **Recovery drill** means restoring a backup and checking that real flows work. This project restores fictional data into a new `sv_restore_` database and leaves production alone.

## How to check the fixes yourself

1. **Teacher credentials.** Run the database integration tests. They verify a teacher, replace the password hash, and prove a session issued from that older check cannot authorize a teacher request.
2. **Logout.** The suite loads a fictional session, deletes it, then writes and touches the stale copy. It confirms that the session stays gone. This reproduces the ordering without sending concurrent requests to the live site.
3. **Dashboard.** Run `node --test tests/moderation-ui.test.mjs`. It checks Cancel, a pending Trash request, successful Trash, and Restore. The login form never appears, the dashboard stays visible, and a second card stays in place.
4. **Legacy login.** On a disposable database, sign in as a student with a weak password. The upgrade screen should appear, with profile access unavailable until a strong password is saved. The tests assert the reset flag clears and the old password fails. Keep the cutoff blank in production.
5. **Secret rotation.** Run the encryption tests with their fictional old and new keys. They open older enrollment ciphertext and reject altered ciphertext. In a test environment, follow `OPERATIONS.md` and use a real authenticator only for a disposable teacher account before changing any production key.
6. **Abuse budgets.** Use a disposable student and temporarily set small limits. The integration suite proves two students have separate comment budgets, pending comments are private, and a full database media budget rejects uploads. It also confirms a stale student write fails after a ban.
7. **Email policy.** The unit test checks disposable subdomains and exact approved-domain matching. In a test Firebase project, request reset for an existing inbox and a nonexistent inbox. Compare the statuses and messages. Provider response times can still vary.
8. **Backups.** Run `npm run backup:external` with a path in the checkout and confirm it refuses. Use the fictional-data drill in `OPERATIONS.md` to back up to a private external folder and restore into a separate empty database.
9. **Deletion.** On a disposable database, confirm that the wrong password and a missing CSRF token fail. Then remove a fictional account and verify the selected articles, comments, reactions, and images are gone while another student's article remains. Run these checks only on disposable data.
10. **Proxy and docs.** Start the production-shaped fixture with `TRUST_PROXY_HOPS=1`, confirm HTTPS cookies and the normal requests pass, and compare the actual client address at the host before changing the hop count. Read the deployment section for the distinction between the local bind address and Render.
