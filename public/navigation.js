'use strict';
(() => {
    const header = document.querySelector('header.top');
    let previousPosition = Math.max(0, window.scrollY);
    let framePending = false;

    function showHeader(show) {
        // Keep navigation usable while a keyboard user is working inside it.
        if (header.contains(document.activeElement) && document.activeElement.matches(':focus-visible')) show = true;
        header.classList.toggle('nav-hidden', !show);
        header.inert = !show;
    }

    function updateOnScroll() {
        framePending = false;
        const position = Math.max(0, window.scrollY);
        if (position <= 20) {
            showHeader(true);
            previousPosition = position;
            return;
        }
        const distance = position - previousPosition;
        // Ignore tiny movements from touchpads and touch scrolling.
        if (Math.abs(distance) < 6) return;
        showHeader(distance > 0);
        previousPosition = position;
    }

    window.addEventListener('scroll', () => {
        if (framePending) return;
        framePending = true;
        requestAnimationFrame(updateOnScroll);
    }, { passive: true });
    header.addEventListener('focusin', () => showHeader(true));
    new ResizeObserver(() => {
        document.documentElement.style.setProperty('--nav-height', header.offsetHeight + 'px');
    }).observe(header);
})();
