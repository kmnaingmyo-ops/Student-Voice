# Student Voice — School Blog

A Japanese student blog built with Node.js, Express, MySQL, HTML, CSS, and JavaScript. New students sign up with email and password, verify their email address, and log in to write articles. Teachers review articles before publication.

## Live website

https://student-voice-p2mf.onrender.com/

Hosted on the free Render web service with a MySQL-compatible TiDB Cloud Starter database and a $0 spending limit. Free hosting may take about a minute to wake after inactivity. Uploaded images are stored in the database on this deployment so they survive restarts. Login sessions and rate-limit counters are stored in the database and survive server restarts. The GitHub copy includes the smaller intro video; the original 8K clip stays local.

## Put this project on GitHub

Extract `student-voice-github.zip`. Upload the files inside the student-voice-js folder to the root of your GitHub repository. The repository root should contain package.json, server.js, README.md, and the public and scripts folders.

The included .gitignore excludes local credentials, installed packages, logs, and uploaded student media. The .env.example file contains placeholders. Each person running the app should copy it to .env and enter their own local database settings.

From a new clone, follow the fresh MAMP installation steps below. Keep package-lock.json in the repository and run npm ci to install its recorded dependency versions. The homepage video setup is described in CAMPUS-FILM.md.

## Customize the homepage video

The navy and white interface has a full-width homepage video area. Put your selected MP4 at public/assets/student-hero.mp4 and refresh the page. The supplied academic video is included as public/assets/student-hero.mp4. See CAMPUS-FILM.md for details.

## Update your existing project

1. Stop the running app with Ctrl+C.
2. Replace the project source files with this release. Keep your own `.env` file and `uploads` folder.
3. Back up the database in phpMyAdmin using Export.
4. If student signup has not been installed yet, import `upgrade-accounts.sql` once. Then grant the app access to the new table with the SQL below. Skip this step if you already completed the account upgrade.

   ```sql
   GRANT SELECT, INSERT, UPDATE ON student_voice.students TO 'sv_app'@'127.0.0.1';
   ```

5. Import `upgrade-blog.sql`. This changes the article body column to TEXT, preserving existing content and allowing longer articles. It can be repeated safely.
6. Optionally import `sample-data.sql` for nine fictional blog posts.
7. For this image/reaction/comment release, import `upgrade-social.sql` once. Run the additional table grants below in phpMyAdmin as an administrator.

   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON student_voice.reactions TO 'sv_app'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON student_voice.comments TO 'sv_app'@'127.0.0.1';
   ```

8. Import `upgrade-profile.sql` once to add the display name, bio, and avatar fields. Existing student accounts are preserved.

9. Run `npm install`, then `npm start`. Refresh your browser. Use Ctrl+F5 if the old design is still visible.

The existing database table is called suggestions so older posts continue to work. Existing posts appear as blog articles after publication.

## Fresh installation with MAMP on Windows

1. Install Node.js 22 or newer and extract this folder into Documents or another convenient location.
2. Start MAMP's MySQL server. Open WebStart → Tools → phpMyAdmin.
3. Import `database.sql`. It creates the database and all tables. A fresh installation uses this file directly.
4. In phpMyAdmin's SQL tab, run the following as a database administrator. Replace the password with a unique local password of letters and digits.

   ```sql
   CREATE USER 'sv_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_THIS_PASSWORD';
   GRANT SELECT, INSERT, UPDATE ON student_voice.staff TO 'sv_app'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON student_voice.students TO 'sv_app'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON student_voice.suggestions TO 'sv_app'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON student_voice.reactions TO 'sv_app'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON student_voice.comments TO 'sv_app'@'127.0.0.1';
   ```

5. Open PowerShell in the extracted project folder and run the following.

   ```powershell
   npm install
   Copy-Item .env.example .env
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

6. Set `SESSION_SECRET` in `.env` to the generated random value. Set `DB_PASSWORD` to the database password above. Set `DB_PORT` to MAMP's MySQL port, usually 3306 or 8889. Quote passwords containing spaces or #.
7. Run `npm run create-staff` and choose a teacher username and password. The console displays the password as you type. Running it again with an existing username resets that teacher's password.
8. Optionally import `sample-data.sql` through phpMyAdmin.
9. Run `npm start` and open [Student Voice](http://localhost:3000). Keep the terminal open. Ctrl+C stops the server.

Node.js serves the website. MAMP supplies MySQL. MAMP's PHP version does not affect the app.

## Using the blog

- **ブログ** shows a featured article, category filters, illustrated cards, and pagination when there are more than seven matching articles.
- **記事を読む** opens the complete published article with its date and category.
- **新規登録** creates a student account. **ログイン** signs into an existing one.
- **記事を書く** requires student login. Articles have a title up to 60 characters and a body up to 5,000 characters.
- Students use a topic-matched real photo, choose the color Flaticon blog icon, or upload their own JPEG, PNG, or WebP image.
- **先生用** opens teacher login and the review dashboard. Teachers can publish or hide articles.
- Pending and hidden articles stay private, including their individual article URLs.
- Article author usernames stay private. Commenter usernames are displayed beside their comments. The database links each new article to the submitting student.

Student usernames use 4–32 ASCII letters, digits, or underscores. New student and teacher passwords use 15–64 characters. Student usernames use 4–32 letters, digits or underscores. A weak legacy student password can start the five-minute upgrade, which must finish before account access. Existing teacher credentials remain usable. Password resets use the 15–64 character rule.

## Forgotten passwords

New email accounts request a reset link from the recovery page. Firebase sends the email and enforces the required 15–64 character password policy. Links expire and can be used only once. Existing username accounts use the collapsed legacy section and ask a teacher for a code after identity verification. Teacher passwords can be reset with npm run create-staff. Existing short passwords remain usable for login; new passwords must follow the new rule.

## Sample posts

`sample-data.sql` adds nine fictional Japanese school stories, including seven published, one pending, and one hidden article. Re-importing skips matching titles and bodies while preserving their moderation status. Earlier sample posts stay in the database.

## Files and checks

- `server.js` handles API routes, sessions, validation, and authorization.
- `database.js` reads MySQL settings from `.env`.
- `password.js` hashes and verifies passwords using scrypt.
- `scripts/create-staff.js` creates or resets teacher accounts.
- `database.sql` creates the schema for new installations.
- `upgrade-accounts.sql` adds student accounts to an older installation.
- `upgrade-blog.sql` expands existing article bodies for the blog version.
- `upgrade-social.sql` adds image columns, reactions, and comments.
- `upgrade-profile.sql` adds profile fields to existing student accounts.
- `profile.js` handles private student profiles, avatars, and lists of their articles.
- `media.js` validates and re-encodes uploaded images.
- `social.js` handles image access, emoji reactions, comments, and comment moderation.
- `sample-data.sql` adds fictional school stories.
- `public/index.html`, `public/style.css`, and `public/app.js` provide the Japanese UI.
- `public/icons/` contains the two attributed Flaticon blog icons.
- `.env.example` shows local settings. Keep your actual `.env` private.
- `package-lock.json` records dependency versions.

Run `npm run check` for JavaScript syntax checks.

If a connection error appears, check MySQL is running and that `.env` matches the database account, password, and port. Restart Node.js after editing `.env`. If port 3000 is occupied, change `PORT` to 3001 and open `http://localhost:3001`.

The local start command defaults to `127.0.0.1`. The hosted Express app runs on Render with an externally reachable bind address and is served at [Student Voice Kamata](https://student-voice-kamata.pages.dev/) through Cloudflare. TiDB stores school data and one-hour encrypted application sessions. Firebase verifies email credentials. SQL uses prepared statements, passwords are hashed, write actions require the session’s CSRF token, and teacher routes check administrator access. Submitted text is displayed with `textContent`.

## Images, reactions, and comments

Students choose an automatic real-photo thumbnail, the color blog icon, or a local image in the article editor. The image preview changes before submission. Uploaded images must be JPEG, PNG, or WebP, up to 3MB and 16 million pixels. The app decodes them, strips metadata, resizes them to fit within 1600 × 1600, and stores a re-encoded WebP under a random filename.

Files are stored in `uploads/`, outside the public directory. Back up this folder with your database. Pending and hidden images are available to teachers for review. Published article images are available to readers.

Open a full article to use 👍 Like, ❤️ Love, 😆 Haha, 😮 Wow, 😢 Sad, or 🤗 Care. Student login is required to react. Each student has one reaction per article and can change it or click the selected reaction again to remove it.

Students can write comments of 1–500 characters. Comments display the account alias. The first two comments from an account with no prior comments are held for teacher review by default. The author can see their pending comments. Teachers can publish, hide, or move comments to Trash from **コメントの管理**. Older comments can be loaded in the dashboard. Hiding or trashing an article removes its image and discussion from public access.

## Icon credits

The project includes these Flaticon PNG icons for use in its interface, with visible attribution in the footer.

- [Blogger outline by cube29](https://www.flaticon.com/free-icon/blogger_1726052)
- [Blogger color by Circlon Tech](https://www.flaticon.com/free-icon/blogger_10173005)

Students can browse [Flaticon's web blog icons](https://www.flaticon.com/free-icons/web-blog), download a PNG, and select it as their article image. Follow the attribution requirements for any additional icons you use.
## Student profile page

After signing in as a student, choose **マイプロフィール** in the top navigation.

The page displays your username, optional display name, short bio, profile image, registration date, and a list of your articles. Articles are labeled **確認待ち**, **公開中**, or **非公開**. Published articles link to their public page.

Edit the display name (up to 40 characters) and bio (up to 300 characters), optionally choose a profile picture, and select **変更を保存**. Profile pictures use the same JPEG, PNG, WebP, and 3MB limits as article images. To remove a picture, check **現在のプロフィール画像を削除する** and save with the file field empty.

Profiles and their pictures are private to the signed-in student. The profile display name and bio are used on this private page. Comments continue to show the account username. Signing out clears the private profile from the page.
## Homepage video, thumbnails, and footer

The supplied video, 6009474_4k_Video_Academic_1280x720.mp4, is included as public/assets/student-hero.mp4. It autoplays muted, loops, and plays inline as a background video.

Default blog thumbnails are real Unsplash photographs matched to the title and category. The included stories use library, science, lunch, festival, campus, notebook, study goals, sports, and rain photographs. Student-uploaded cover images take priority, and a selected color icon is respected.

The footer includes two latest published stories, a sharing invitation, and school-appropriate navigation and account links. It updates the recent-story tiles from the actual published blog list.

Photographer names, original source links, and the license link are in public/photo-credits.html and public/thumbnails/sources.json. These files and the downloaded thumbnails are included for local use.
## Video in this GitHub copy

The browser-compatible 720p intro is included. The 1.6 GB original 8K file is kept out of Git. To play the original locally, copy student-hero-8k.mp4 into public/assets; it is ignored by Git. The homepage automatically uses the included fallback when the original is absent. Never commit your local .env or student uploads.


## Verified email accounts

New students register with an email address and a 15–64 character password. Common and repetitive passwords are rejected. Firebase Authentication sends verification and recovery emails; inbox ownership must be verified before sign-in creates a local session or permits posting. Format checks do not prove that a mailbox exists, and a disposable mailbox can still be verified if someone controls it.

Set FIREBASE_WEB_API_KEY in the server environment using the Web API key from your Firebase project. Enable Email/Password authentication and a required minimum password length of 15 in Firebase Authentication settings. Keep the Spark (free) plan. New local installations use database.sql; existing local installations import upgrade-email.sql once. Cloud startup adds the new columns without replacing account IDs or posts.

Existing username accounts continue to sign in using the same login field. They are not falsely marked as email-verified. Their teacher-issued recovery codes remain under the recovery page's legacy-account section. Firebase email accounts use email reset links instead. Email passwords are handled by Firebase; a random unusable local password hash prevents username sign-in from bypassing Firebase verification. Public comments continue to use an internal alias, never the student's email address.

## Additional security controls

See [SECURITY.md](SECURITY.md) for teacher authenticator setup, recovery codes, session revocation, audit logging, CI checks, container guidance, and external services still needed for enterprise use. Existing teachers should enroll MFA and replace short legacy passwords themselves. No school SSO, WAF, SIEM, or endpoint agent is claimed to be active.

Students can request permanent deletion from their profile by re-entering their password and typing `DELETE`. Teachers can complete a confirmed request from Trash. Deletion includes the student's articles and associated data. Read the [operator instructions](OPERATIONS.md) for Firebase and backups before deploying.
