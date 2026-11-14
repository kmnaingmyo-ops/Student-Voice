# Student Voice visual update

The current interface is inspired by Baker Mountain Guides' spacious navigation, oversized condensed headings, red blocks, full-width media, and white/charcoal sections.

## Main files

- public/index.html contains the navigation, homepage headline, video element, and page sections.
- public/editorial.css defines the red, white, and charcoal theme, mobile layout, and full-width hero.
- public/cinema.js controls the local homepage video and the jump to the article grid.
- public/style.css provides the base component layouts.

## Apply the design

Use the updated source files, start the existing application, and refresh the browser with Ctrl+F5. Keep your local .env and uploads folder.

## Add your video

Place your selected MP4 at public/assets/student-hero.mp4 and refresh. CAMPUS-FILM.md explains playback behavior and customization.

## Scroll navigation

The navbar stays at the top while scrolling down and hides while scrolling up. It returns at the top of the page. Tiny movements are ignored. Keyboard focus keeps the navbar available. The behavior is in public/navigation.js, and its styles are in public/editorial.css.

## Writing page

The writing page uses a charcoal and red photo header, a clear guest registration panel, and three real-photo story inspiration cards. Signed-in students get an editor with a character progress bar and topic prompts. Prompts select a category and suggest an opening sentence without replacing the student's text. The layout adapts to phones. No database changes are needed.

