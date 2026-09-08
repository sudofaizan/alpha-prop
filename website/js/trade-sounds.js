/**
 * Trade terminal sound effects (order fill, SL/TP hit).
 */
(function () {
  const clips = {};

  function getClip(key, src) {
    if (!clips[key]) {
      clips[key] = new Audio(src);
      clips[key].preload = "auto";
      clips[key].volume = 0.75;
    }
    return clips[key];
  }

  function playClip(key, src) {
    try {
      const audio = getClip(key, src);
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise?.catch) playPromise.catch(() => {});
    } catch {
      /* ignore autoplay / missing file */
    }
  }

  window.playOrderFilledSound = () => playClip("order-filled", "audio/order-filled.mp3");
  window.playSlHitSound = () => playClip("sl-hit", "audio/sl-hit.mp3");
  window.playTpHitSound = () => playClip("tp-hit", "audio/tp-hit.mp3");
})();
