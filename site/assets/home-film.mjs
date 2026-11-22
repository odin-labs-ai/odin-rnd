const trigger = document.querySelector('.play-film');
const player = document.querySelector('.home-film-player');
const video = player?.querySelector('video');

if (trigger && video && typeof player.showModal === 'function') {
  trigger.setAttribute('aria-haspopup', 'dialog');

  trigger.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    player.showModal();
    event.preventDefault();
    video.src = trigger.href;
    // Native controls and the direct file link also work when playback is restricted.
    video.play().catch(() => {});
  });

  player.addEventListener('click', event => {
    if (event.target === player) player.close();
  });

  player.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    trigger.focus({ preventScroll: true });
  });
}
