/**
 * AlphaFX auth — single session, route guard, user hydration
 */
(function () {
  const PUBLIC_PAGES = new Set(["home", "login", "register"]);

  function currentPage() {
    return document.body.dataset.page || "";
  }

  function redirectToLogin() {
    const page = window.location.pathname.split("/").pop() || "dashboard.html";
    const next = encodeURIComponent(`${page}${window.location.search || ""}`);
    window.location.href = `login.html?next=${next}`;
  }

  async function establishSession(token) {
    window.AlphaFXApi.setToken(token);
    return window.AlphaFXApi.me();
  }

  async function login(email, password) {
    const data = await window.AlphaFXApi.login(email, password);
    window.AlphaFXApi.setToken(data.access_token);
    window.dispatchEvent(new CustomEvent("alphafx:user", { detail: data.user }));
    return data.user;
  }

  async function register(email, password, fullName) {
    const data = await window.AlphaFXApi.register(email, password, fullName);
    window.AlphaFXApi.setToken(data.access_token);
    window.dispatchEvent(new CustomEvent("alphafx:user", { detail: data.user }));
    return data.user;
  }

  async function logout() {
    try {
      if (window.AlphaFXApi.getToken()) await window.AlphaFXApi.logout();
    } catch {
      /* ignore */
    }
    window.AlphaFXApi.clearToken();
  }

  async function requireAuth() {
    if (currentPage() === "home") return null;
    if (PUBLIC_PAGES.has(currentPage())) return null;
    if (!window.AlphaFXApi.getToken()) {
      redirectToLogin();
      return null;
    }
    try {
      const user = await window.AlphaFXApi.me();
      window.__ALPHAFX_USER = user;
      window.dispatchEvent(new CustomEvent("alphafx:user", { detail: user }));

      if (user.is_admin) {
        if (currentPage() !== "admin" && window.AlphaFXLayout?.TRADER_PAGES?.has(currentPage())) {
          window.location.href = "admin.html";
          return null;
        }
      } else if (currentPage() === "admin") {
        window.location.href = "dashboard.html";
        return null;
      }
      return user;
    } catch {
      window.AlphaFXApi.clearToken();
      redirectToLogin();
      return null;
    }
  }

  function bindLoginForm() {
    const form = document.getElementById("login-form");
    if (!form) return;
    const errorEl = document.getElementById("login-error");
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      submitBtn.disabled = true;
      try {
        const user = await login(form.email.value.trim(), form.password.value);
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next");
        if (user.is_admin) {
          window.location.href = next && next.includes("admin") ? next : "admin.html";
        } else {
          window.location.href = next || "dashboard.html";
        }
      } catch (err) {
        errorEl.textContent = err.message || "Login failed";
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });

    if (window.AlphaFXApi.getToken()) {
      window.AlphaFXApi.me()
        .then((user) => {
          const params = new URLSearchParams(window.location.search);
          const next = params.get("next");
          if (user.is_admin) {
            window.location.href = next && next.includes("admin") ? next : "admin.html";
          } else {
            window.location.href = next || "dashboard.html";
          }
        })
        .catch(() => window.AlphaFXApi.clearToken());
    }
  }

  function bindRegisterForm() {
    const form = document.getElementById("register-form");
    if (!form) return;
    const errorEl = document.getElementById("register-error");
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      submitBtn.disabled = true;
      try {
        await register(form.email.value.trim(), form.password.value, form.full_name.value.trim());
        window.location.href = "dashboard.html";
      } catch (err) {
        errorEl.textContent = err.message || "Registration failed";
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function bindSignOut() {
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("#sign-out-btn");
      if (!btn) return;
      e.preventDefault();
      await logout();
      window.location.href = "home.html";
    });
  }

  function hydrateTopbar(user) {
    if (!user) return;
    window.__ALPHAFX_USER = user;
    window.dispatchEvent(new CustomEvent("alphafx:user", { detail: user }));
  }

  window.addEventListener("alphafx:layout-ready", () => {
    if (window.__ALPHAFX_USER) hydrateTopbar(window.__ALPHAFX_USER);
  });

  window.AlphaFXAuth = { login, register, logout, requireAuth };

  document.addEventListener("DOMContentLoaded", () => {
    bindLoginForm();
    bindRegisterForm();
    bindSignOut();
    requireAuth();
  });
})();
