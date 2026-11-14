# Student Voice — School Blog

A Japanese student blog built with Node.js, Express, MySQL, HTML, CSS, and JavaScript. Students sign up and log in to write articles. Teachers review articles before publication.

## Put this project on GitHub

Extract `student-voice-github.zip`. Upload the files inside the student-voice-js folder to the root of your GitHub repository. The repository root should contain package.json, server.js, README.md, and the public and scripts folders.

The included .gitignore excludes local credentials, installed packages, logs, and uploaded student media. The .env.example file contains placeholders. Each person running the app should copy it to .env and enter their own local database settings.

From a new clone, follow the fresh MAMP installation steps below. Keep package-lock.json in the repository and run npm ci to install its recorded dependency versions. The homepage video setup is described in CAMPUS-FILM.md.

## Customize the homepage video

The red, white, and charcoal interface has a full-width homepage video area. Put your selected MP4 at public/assets/student-hero.mp4 and refresh the page. The supplied academic video is included as public/assets/student-hero.mp4. See CAMPUS-FILM.md for details.

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

Student usernames use 4–32 ASCII letters, digits, or underscores. New student and teacher passwords use 4–8 characters. Existing longer teacher passwords still work.

## Forgotten passwords

The student tells a teacher their username. After confirming the student's identity through the school's usual process, the teacher opens **先生用 → 生徒のパスワード再設定**, enters the username, and issues a reset code.

The student chooses **ログイン → パスワードを忘れた方** and enters their username, code, and new password. The code expires after 15 minutes and works once. Issuing a new code invalidates the old one. A completed reset invalidates existing student sessions.

Teacher passwords can be reset using `npm run create-staff`.

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

The app binds to 127.0.0.1 for classroom use. Sessions are stored in memory for one hour and reset when Node.js restarts. SQL uses prepared statements, passwords are hashed, write actions require a session token, and private teacher routes require authorization. Submitted text is displayed using textContent. Only public files are served to browsers.

## Images, reactions, and comments

Students choose an automatic real-photo thumbnail, the color blog icon, or a local image in the article editor. The image preview changes before submission. Uploaded images must be JPEG, PNG, or WebP, up to 3MB and 16 million pixels. The app decodes them, strips metadata, resizes them to fit within 1600 × 1600, and stores a re-encoded WebP under a random filename.

Files are stored in `uploads/`, outside the public directory. Back up this folder with your database. Pending and hidden images are available to teachers for review. Published article images are available to readers.

Open a full article to use 👍 Like, ❤️ Love, 😆 Haha, 😮 Wow, 😢 Sad, or 🤗 Care. Student login is required to react. Each student has one reaction per article and can change it or click the selected reaction again to remove it.

Students can write comments of 1–500 characters. Commenter usernames are public. Comments appear immediately. Teachers can hide or restore them from the dashboard's **コメントの管理** section. Readers see the latest 50 visible comments, and teachers see the latest 100 comments for moderation. Hiding an article also hides its image and discussion.

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
