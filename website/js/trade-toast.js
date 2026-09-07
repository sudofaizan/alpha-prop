/**
 * Soft toast notifications for the trade terminal (no blocking alert dialogs).
 */
(function () {
  let wrap = null;

  function ensureWrap() {
    if (wrap) return wrap;
    wrap = document.createElement("div");
    wrap.className = "trade-toast-wrap";
    wrap.setAttribute("aria-live", "polite");
    document.body.appendChild(wrap);
    return wrap;
  }

  function show(message, type = "info", durationMs = 3200) {
    const root = ensureWrap();
    const el = document.createElement("div");
    el.className = `trade-toast trade-toast--${type}`;
    el.textContent = message;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-visible"));
    const remove = () => {
      el.classList.remove("is-visible");
      setTimeout(() => el.remove(), 280);
    };
    const timer = setTimeout(remove, durationMs);
    el.addEventListener("click", () => {
      clearTimeout(timer);
      remove();
    });
  }

  window.AlphaFXToast = { show };
})();
