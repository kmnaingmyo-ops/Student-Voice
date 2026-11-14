'use strict';
(() => {
    const board = document.querySelector('#board');
    const hero = document.querySelector('.cinematic');
    const video = document.querySelector('#cinema-video');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let inView = true;
    let playPending = false;
    let triedFallback = false;

    video.muted = true;
    video.defaultMuted = true;
    video.controls = false;

    function visible() {
        return !board.hidden && !document.hidden && inView;
    }

    async function sync() {
        if (!visible()) {
            video.pause();
            return;
        }
        if (!video.paused || playPending) return;
        playPending = true;
        try {
            await video.play();
            if (!visible()) video.pause();
        } catch {
            hero.dataset.videoState = 'autoplay-blocked';
        } finally {
            playPending = false;
        }
    }

    video.addEventListener('playing', () => {
        video.classList.add('is-playing');
        hero.dataset.videoState = 'playing';
        if (!visible()) video.pause();
    });
    video.addEventListener('loadeddata', () => {
        video.classList.add('is-ready');
        sync();
    });
    video.addEventListener('error', () => {
        // Some devices advertise HEVC support but cannot decode an 8K stream.
        if (!triedFallback) {
            triedFallback = true;
            video.src = '/assets/student-hero.mp4?v=1115';
            video.load();
            return;
        }
        video.classList.remove('is-playing', 'is-ready');
        hero.dataset.videoState = 'unavailable';
    });
    document.addEventListener('visibilitychange', sync);
    new MutationObserver(sync).observe(board, { attributes: true, attributeFilter: ['hidden'] });
    new IntersectionObserver(entries => {
        inView = entries[0].isIntersecting;
        sync();
    }, { threshold: .05 }).observe(hero);

    function explore(event) {
        event.preventDefault();
        if (board.hidden) location.hash = 'board';
        requestAnimationFrame(() => {
            const journal = document.querySelector('#journal');
            journal.scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'start' });
            journal.focus({ preventScroll: true });
        });
    }
    document.querySelector('#explore-journal').addEventListener('click', explore);
    document.querySelector('.skip-link').addEventListener('click', explore);
    sync();
})();
