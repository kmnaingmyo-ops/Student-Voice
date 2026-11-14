# Homepage video

The supplied CapCut export 1115.mov is converted into public/assets/student-hero.mp4. The complete clip is retained as a browser-compatible 1280×720, 30 fps H.264 MP4. Audio is omitted because this is a silent background intro. The original MOV is unchanged.

The homepage background video autoplays muted, loops, and plays inline. Its HTML autoplay attribute and JavaScript controller start playback automatically when the homepage video is visible.

Playback pauses while the homepage is hidden, the browser tab is hidden, or the video is outside the viewport, and resumes automatically when visible again. Playback controls are omitted from the interface.

To replace the clip, put another browser-compatible MP4 at the same path and refresh with Ctrl+F5. The video src attribute is in public/index.html. Playback behavior is in public/cinema.js.

The supplied video was checked in the browser and started without a click. The footer and bottom sharing section were checked at full page width.

## Original quality option

The first video source is now student-hero-8k.mp4: the original 7680×4320, 60 fps HEVC video remuxed from 1115.mov without re-encoding or quality loss. It is approximately 1.6 GB. The complete original video stream is retained; audio is omitted for the silent background. Browsers without the required HEVC decoding support use the 720p H.264 fallback. Actual 8K playback depends on the browser, operating system, GPU and display. The 8K file must be included when copying or hosting the project.
