const trigger = document.querySelector('.play-film');
const player = document.querySelector('.home-film-player');
const video = player?.querySelector('video');
const still = document.querySelector('.film-still');
const motion = document.querySelector('.film-motion');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

let background;
let stopped = false;

function updateBackground() {
  if (!trigger || !still || !motion) return;
  if (reduced.matches) {
    if (background) {
      background.pause();
      background.replaceChildren();
      background.load();
      background.remove();
      background = undefined;
    }
    motion.hidden = true;
    return;
  }
  if (!background) {
    background = document.createElement('video');
    background.className = 'film-background';
    background.setAttribute('aria-hidden', 'true');
    background.defaultMuted = true;
    background.muted = true;
    background.loop = true;
    background.playsInline = true;
    background.autoplay = !stopped;
    if (stopped) motion.hidden = false;
    background.poster = still.currentSrc || still.src;
    const source = document.createElement('source');
    source.type = 'video/mp4';
    source.src = trigger.href;
    background.append(source);
    background.addEventListener('playing', event => {
      if (event.target === background) motion.hidden = false;
    });
    still.after(background);
  }
  if (stopped || document.hidden || player?.open) {
    background.pause();
  } else {
    background.play().catch(() => {});
  }
}

motion?.addEventListener('click', () => {
  stopped = !stopped;
  motion.textContent = stopped ? 'Resume background film' : 'Pause background film';
  updateBackground();
});
reduced.addEventListener('change', updateBackground);
document.addEventListener('visibilitychange', updateBackground);
updateBackground();

if (trigger && video && typeof player.showModal === 'function') {
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    player.showModal();
    event.preventDefault();
    updateBackground();
    video.src = trigger.href;
    video.play().catch(() => {});
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else video.webkitEnterFullscreen?.();
  });

  player.addEventListener('click', event => {
    if (event.target === player) player.close();
  });

  player.addEventListener('close', () => {
    if (document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
    video.pause();
    video.removeAttribute('src');
    video.load();
    trigger.focus({ preventScroll: true });
    updateBackground();
  });
}
