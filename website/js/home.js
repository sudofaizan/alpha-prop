/**
 * AlphaFX public landing — mobile nav, scroll effects, logged-in redirect
 */
(function () {
  function bindMobileNav() {
    const burger = document.querySelector(".hp-fnav-burger");
    const drawer = document.querySelector(".hp-fnav-drawer");
    const scrim = document.querySelector(".hp-fnav-drawer-scrim");
    if (!burger || !drawer) return;

    function setOpen(open) {
      drawer.dataset.open = open ? "true" : "false";
      drawer.setAttribute("aria-hidden", open ? "false" : "true");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.querySelectorAll("span").forEach((s) => {
        s.dataset.open = open ? "true" : "false";
      });
      document.body.style.overflow = open ? "hidden" : "";
    }

    burger.addEventListener("click", () => setOpen(drawer.dataset.open !== "true"));
    scrim?.addEventListener("click", () => setOpen(false));
    drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  }

  function bindScrollEffects() {
    const nav = document.querySelector(".hp-fnav");
    let ticking = false;

    function onScroll() {
      const y = window.scrollY || 0;
      document.documentElement.style.setProperty("--hp-scroll", String(y));
      if (nav) nav.dataset.scrolled = y > 24 ? "true" : "false";
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(onScroll);
        }
      },
      { passive: true }
    );
    onScroll();
  }

  function bindReveal() {
    const els = document.querySelectorAll(".hp-reveal:not(.hp-reveal-in), .hp-reveal-stagger:not(.hp-reveal-in)");
    if (!els.length || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("hp-reveal-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("hp-reveal-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  function bindAtmParallax() {
    const atm = document.querySelector(".hp-atm");
    const gold = document.querySelector(".hp-gold");
    if (!atm && !gold) return;

    function onMove(e) {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      const mx = `${50 + x * 18}%`;
      const my = `${50 + y * 14}%`;
      if (atm) {
        atm.style.setProperty("--mx", mx);
        atm.style.setProperty("--my", my);
      }
      if (gold) {
        gold.style.setProperty("--mx", String(x));
        gold.style.setProperty("--my", String(y));
      }
    }

    window.addEventListener("pointermove", onMove, { passive: true });
  }

  function bindTestimonialRail() {
    const rail = document.querySelector(".hp-tm-rail");
    const prev = document.querySelector(".hp-tm-nav-prev");
    const next = document.querySelector(".hp-tm-nav-next");
    if (!rail) return;
    const step = () => Math.min(380, rail.clientWidth * 0.82);
    prev?.addEventListener("click", () => rail.scrollBy({ left: -step(), behavior: "smooth" }));
    next?.addEventListener("click", () => rail.scrollBy({ left: step(), behavior: "smooth" }));
  }

  function bindSpotlight() {
    document.querySelectorAll(".hp-spotlight").forEach((card) => {
      card.addEventListener(
        "pointermove",
        (e) => {
          const r = card.getBoundingClientRect();
          card.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
          card.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
        },
        { passive: true }
      );
    });
  }

  async function redirectIfLoggedIn() {
    if (!window.AlphaFXApi?.getToken()) return;
    try {
      await window.AlphaFXApi.me();
      window.location.href = "dashboard.html";
    } catch {
      window.AlphaFXApi.clearToken();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindMobileNav();
    bindScrollEffects();
    bindReveal();
    bindAtmParallax();
    bindTestimonialRail();
    bindSpotlight();
    redirectIfLoggedIn();
  });
})();
