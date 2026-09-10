/** AlphaFX portal shell — Capiffy pt-* layout */
const BRAND = "ALPHAFX";
const PROMO_CODE = "ALPHA38";

const TRADER_PAGES = new Set([
  "dashboard",
  "challenges",
  "checkout",
  "payment",
  "accounts",
  "trade",
  "billing",
  "payouts",
  "leaderboard",
  "rules",
  "verification",
  "certificates",
  "referrals",
  "support",
  "notifications",
  "profile",
  "account-stats",
]);

const NAV = [
  { id: "dashboard", label: "Dashboard", href: "dashboard.html", group: "Workspace", icon: "dashboard" },
  { id: "challenges", label: "Challenges", href: "index.html", group: "Workspace", icon: "challenges" },
  { id: "accounts", label: "My Accounts", href: "accounts.html", group: "Workspace", icon: "accounts" },
  { id: "trade", label: "Trade", href: "trade.html", group: "Workspace", icon: "trade" },
  { id: "billing", label: "Billing", href: "billing.html", group: "Workspace", icon: "billing" },
  { id: "payouts", label: "Payouts", href: "payouts.html", group: "Workspace", icon: "payouts" },
  { id: "leaderboard", label: "Leaderboard", href: "leaderboard.html", group: "Workspace", icon: "leaderboard" },
  { id: "rules", label: "Rules", href: "rules.html", group: "Workspace", icon: "rules" },
  { id: "verification", label: "Verification", href: "verification.html", group: "Workspace", icon: "verification" },
  { id: "certificates", label: "Certificates", href: "certificates.html", group: "Workspace", icon: "certificates" },
  { id: "referrals", label: "Referrals", href: "referrals.html", group: "Workspace", icon: "referrals" },
  { id: "support", label: "Support", href: "support.html", group: "Workspace", icon: "support" },
  { id: "notifications", label: "Notifications", href: "notifications.html", group: "Workspace", icon: "notifications" },
  { id: "profile", label: "Profile", href: "profile.html", group: "Workspace", icon: "profile" },
];

const ADMIN_NAV = [
  { id: "admin-live", label: "Live trading", href: "admin.html#live", group: "Administration", icon: "trade", tab: "live" },
  { id: "admin-users", label: "Users", href: "admin.html#users", group: "Administration", icon: "accounts", tab: "users" },
  { id: "admin-accounts", label: "Accounts", href: "admin.html#accounts", group: "Administration", icon: "billing", tab: "accounts" },
  { id: "admin-orders", label: "Orders", href: "admin.html#orders", group: "Administration", icon: "billing", tab: "orders" },
  { id: "admin-payments", label: "Payments", href: "admin.html#payments", group: "Administration", icon: "payouts", tab: "payments" },
  { id: "admin-support", label: "Support", href: "admin.html#support", group: "Administration", icon: "support", tab: "support" },
];

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect>',
  challenges: '<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"></path>',
  accounts: '<rect x="2" y="3" width="20" height="5" rx="1.5"></rect><rect x="2" y="10" width="20" height="5" rx="1.5"></rect><rect x="2" y="17" width="12" height="4" rx="1.5"></rect><circle cx="20" cy="19" r="2.5"></circle><path d="M20 17v1.5M20 20.5V22"></path>',
  trade: '<path d="M3 17l6-6 4 4 8-9"></path><path d="M14 6h7v7"></path>',
  billing: '<path d="M4 4h14l2 3v14a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path><path d="M4 7h16"></path><path d="M9 12h6M9 16h4"></path>',
  payouts: '<rect x="2" y="6" width="20" height="13" rx="2"></rect><path d="M2 11h20"></path><circle cx="17" cy="15" r="1.5"></circle>',
  leaderboard: '<path d="M8 21h8m-4-4v4M6 4h12v6a6 6 0 01-12 0V4z"></path><path d="M6 7H3v2a3 3 0 003 3M18 7h3v2a3 3 0 01-3 3"></path>',
  rules: '<path d="M5 3h11l3 3v15a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"></path><path d="M14 3v4h4M8 12h8M8 16h6M8 8h3"></path>',
  verification: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"></path><path d="M9 12l2 2 4-4"></path>',
  certificates: '<rect x="3" y="3" width="18" height="14" rx="2"></rect><circle cx="12" cy="10" r="2.5"></circle><path d="M10 14l-1 7 3-2 3 2-1-7"></path>',
  referrals: '<rect x="3" y="8" width="18" height="13" rx="1.5"></rect><path d="M3 12h18M12 8v13"></path><path d="M12 8s-2-4-4-4a2 2 0 100 4h4zM12 8s2-4 4-4a2 2 0 110 4h-4z"></path>',
  support: '<circle cx="12" cy="12" r="9"></circle><path d="M9 10a3 3 0 116 0c0 2-3 2-3 4M12 17h.01"></path>',
  notifications: '<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0"></path>',
  profile: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 00.4 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.4 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.4-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.4-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.4H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.4l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.4 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"></path>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"></path>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>',
  chevron: '<path d="M9 18l6-6-6-6"></path>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="1.5"></rect><path d="M3 12h18M12 8v13"></path><path d="M12 8s-2-4-4-4a2 2 0 100 4h4zM12 8s2-4 4-4a2 2 0 110 4h-4z"></path>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"></path>',
  bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0"></path>',
};

function svg(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function brandLogo() {
  return `<svg width="30" height="30" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${BRAND}" style="display:block;flex-shrink:0"><defs><linearGradient id="g1-af" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE45C"></stop><stop offset="0.55" stop-color="#FFD700"></stop><stop offset="1" stop-color="#C99A2E"></stop></linearGradient><linearGradient id="g2-af" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.78"></stop><stop offset="0.12" stop-color="#FFFFFF" stop-opacity="0.34"></stop><stop offset="0.40" stop-color="#FFFFFF" stop-opacity="0"></stop></linearGradient><radialGradient id="g3-af" cx="0.3" cy="0.22" r="0.5"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.85"></stop><stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.18"></stop><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"></stop></radialGradient><radialGradient id="g4-af" cx="0.62" cy="1.05" r="0.7"><stop offset="0" stop-color="#FFD877" stop-opacity="0.55"></stop><stop offset="1" stop-color="#FFD877" stop-opacity="0"></stop></radialGradient></defs><rect x="0" y="0" width="512" height="512" rx="118" fill="url(#g1-af)"></rect><rect x="0" y="0" width="512" height="512" rx="118" fill="url(#g4-af)"></rect><rect x="0" y="0" width="512" height="512" rx="118" fill="url(#g3-af)"></rect><rect x="0" y="0" width="512" height="512" rx="118" fill="url(#g2-af)"></rect><rect x="5" y="5" width="502" height="502" rx="114" fill="none" stroke="#FFF6D6" stroke-opacity="0.55" stroke-width="3"></rect><g fill="none" stroke="#0D0D0F" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"><path d="M 324.8 171.7 A 120 120 0 1 0 324.8 368.3"></path><path d="M 324.8 171.7 L 404 92"></path><path d="M 360 92 L 404 92 L 404 136"></path></g></svg>`;
}

function adminTabFromHash() {
  const hash = (window.location.hash || "").replace("#", "").toLowerCase();
  return ["live", "users", "accounts", "orders", "payments"].includes(hash) ? hash : "live";
}

function isNavItemActive(item, active, isAdmin) {
  if (isAdmin) {
    if (active !== "admin") return false;
    return item.tab === adminTabFromHash();
  }
  return item.id === active;
}

function navItem(item, active, isAdmin) {
  const cls = isNavItemActive(item, active, isAdmin) ? "pt-nav-item is-active" : "pt-nav-item";
  const badgeVal = item.id === "notifications" ? (window.__ALPHAFX_UNREAD ?? item.badge) : item.badge;
  const badge = badgeVal ? `<span class="pt-nav-item-badge" data-nav-badge="${item.id}">${badgeVal}</span>` : "";
  return `<a class="${cls}" href="${item.href}"><span class="pt-nav-item-icon">${svg(item.icon)}</span><span class="pt-nav-item-label">${item.label}</span>${badge}</a>`;
}

function isChallengesPage() {
  const page = document.body.dataset.page;
  if (page === "challenges" || page === "checkout") return true;
  const path = window.location.pathname.toLowerCase();
  return path.endsWith("/index.html") || path.endsWith("/") || path.endsWith("index.html") || path.endsWith("/checkout.html");
}

function shouldShowPromo(isAdmin) {
  if (isAdmin || !isChallengesPage()) return false;
  return sessionStorage.getItem("alphafx-promo-dismissed") !== "1";
}

function renderPromo() {
  return `<div class="pt-promo" id="sidebar-promo">
      <button type="button" class="pt-promo-dismiss" id="dismiss-promo" aria-label="Dismiss promo" title="Dismiss">×</button>
      <div class="pt-promo-label">${svg("gift", 11)}Live promo · 38% off</div>
      <p class="pt-promo-body">38% off all accounts</p>
      <button type="button" title="Click to copy" class="pt-promo-code" id="copy-promo"><span>${PROMO_CODE}</span>${svg("copy", 13)}</button>
      <a class="pt-promo-cta" href="index.html">Buy now<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"></path></svg></a>
    </div>`;
}

function renderSidebar(active, isAdmin) {
  const navItems = isAdmin ? ADMIN_NAV : NAV;
  const groupLabel = isAdmin ? "Administration" : "Workspace";
  const brandHref = isAdmin ? "admin.html" : "dashboard.html";
  const brandSub = isAdmin ? "Admin Console" : "Trader Portal";
  const nav = navItems.map((item) => navItem(item, active, isAdmin)).join("");
  const promo = shouldShowPromo(isAdmin) ? renderPromo() : "";
  return `<aside class="pt-sidebar${isAdmin ? " pt-sidebar--admin" : ""}" id="pt-sidebar">
    <a class="pt-sidebar-brand" href="${brandHref}">${brandLogo()}<div><div class="pt-sidebar-brand-title">${BRAND}</div><div class="pt-sidebar-brand-sub">${brandSub}</div></div></a>
    <button type="button" title="Collapse" class="pt-sidebar-toggle" id="pt-sidebar-toggle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg);transition:transform 240ms var(--ease-out-quart)"><path d="M9 18l6-6-6-6"></path></svg></button>
    <nav class="pt-sidebar-nav"><div class="pt-sidebar-group-label">${groupLabel}</div>${nav}</nav>
    ${promo}
    <div class="pt-sidebar-foot"><button type="button" id="sign-out-btn" title="Sign out" class="pt-sidebar-logout"><span class="pt-nav-item-icon">${svg("logout")}</span><span>Sign out</span></button></div>
  </aside>`;
}

function renderMobileBar(active, isAdmin) {
  const items = isAdmin
    ? [
        { id: "admin-live", label: "Live", href: "admin.html#live", icon: "trade", tab: "live" },
        { id: "admin-users", label: "Users", href: "admin.html#users", icon: "accounts", tab: "users" },
        { id: "admin-accounts", label: "Accounts", href: "admin.html#accounts", icon: "billing", tab: "accounts" },
        { id: "admin-orders", label: "Orders", href: "admin.html#orders", icon: "billing", tab: "orders" },
      ]
    : [
        { id: "dashboard", label: "Home", href: "dashboard.html", icon: "dashboard" },
        { id: "accounts", label: "My Accounts", href: "accounts.html", icon: "accounts" },
        { id: "trade", label: "Trade", href: "trade.html", icon: "trade" },
        { id: "payouts", label: "Payouts", href: "payouts.html", icon: "payouts" },
      ];
  const links = items
    .map((item) => {
      const on = isAdmin ? isNavItemActive(item, active, true) : item.id === active;
      const cls = on ? "pt-mobile-bar-item is-active" : "pt-mobile-bar-item";
      return `<a class="${cls}" href="${item.href}">${svg(item.icon)}<span>${item.label}</span></a>`;
    })
    .join("");
  return `<nav class="pt-mobile-bar">${links}<button type="button" class="pt-mobile-bar-item" id="pt-mobile-menu" aria-label="Menu" aria-expanded="false">${svg("menu")}<span>Menu</span></button></nav>`;
}

function renderTopbar(title, isAdmin) {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const sub = isAdmin ? "Administration" : "Trader Portal";
  const bell = isAdmin
    ? ""
    : `<a href="notifications.html" title="Notifications" class="pt-topbar-bell">${svg("bell")}<span class="pt-topbar-bell-dot"></span></a><span class="pt-topbar-divider" aria-hidden="true"></span>`;
  const profileHref = isAdmin ? "admin.html#users" : "profile.html";
  return `<header class="pt-topbar">
    <div class="pt-topbar-title-block"><div class="pt-topbar-title">${title}</div><div class="pt-topbar-date">${date}</div></div>
    <div class="pt-topbar-right">
      ${bell}
      <a title="View profile" class="pt-topbar-profile" href="${profileHref}"><span class="pt-topbar-avatar" id="pt-topbar-avatar">··</span><span><div class="pt-topbar-profile-name" id="pt-topbar-profile-name">Loading…</div><div class="pt-topbar-profile-sub">${sub}</div></span></a>
    </div>
  </header>`;
}

function bindShellEvents() {
  document.getElementById("copy-promo")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(PROMO_CODE);
  });
  document.getElementById("dismiss-promo")?.addEventListener("click", () => {
    sessionStorage.setItem("alphafx-promo-dismissed", "1");
    document.getElementById("sidebar-promo")?.remove();
  });
  document.getElementById("pt-sidebar-toggle")?.addEventListener("click", () => {
    document.getElementById("pt-sidebar")?.classList.toggle("is-collapsed");
  });
  document.getElementById("pt-mobile-menu")?.addEventListener("click", () => {
    document.getElementById("pt-sidebar")?.classList.toggle("is-open");
  });
}

function refreshShellForUser(user) {
  const active = document.body.dataset.page;
  const isAdmin = Boolean(user?.is_admin);
  const sidebar = document.getElementById("pt-sidebar");
  const mobileBar = document.querySelector(".pt-mobile-bar");
  if (!sidebar) return;

  const collapsed = sidebar.classList.contains("is-collapsed");
  const open = sidebar.classList.contains("is-open");
  sidebar.outerHTML = renderSidebar(active, isAdmin);
  const nextSidebar = document.getElementById("pt-sidebar");
  if (collapsed) nextSidebar?.classList.add("is-collapsed");
  if (open) nextSidebar?.classList.add("is-open");

  if (mobileBar) mobileBar.outerHTML = renderMobileBar(active, isAdmin);

  const sub = document.querySelector(".pt-topbar-profile-sub");
  if (sub) sub.textContent = isAdmin ? "Administration" : "Trader Portal";

  bindShellEvents();
  document.body.classList.toggle("is-admin-user", isAdmin);
}

function initLayout() {
  if (!document.getElementById("alphafx-promo-guard")) {
    const style = document.createElement("style");
    style.id = "alphafx-promo-guard";
    style.textContent = `
      body:not([data-page="challenges"]) .pt-sidebar .pt-promo { display: none !important; }
      .pt-promo-dismiss {
        position: absolute; top: 8px; right: 8px; width: 24px; height: 24px;
        border: none; border-radius: 6px; background: rgba(26, 21, 5, 0.2);
        color: #1a1505; font-size: 18px; line-height: 1; cursor: pointer;
        display: flex; align-items: center; justify-content: center; padding: 0;
      }
      .pt-promo-dismiss:hover { background: rgba(26, 21, 5, 0.35); }
    `;
    document.head.appendChild(style);
  }

  const active = document.body.dataset.page;
  const title = document.body.dataset.title || "Dashboard";
  const noWrap = document.body.dataset.noWrap === "true";
  const slot = document.getElementById("app-root");
  if (!slot) return;

  const isAdmin = Boolean(window.__ALPHAFX_USER?.is_admin);
  const content = slot.innerHTML;
  const pageInner = noWrap ? content : `<div class="pt-page dfx-scope" data-screen-label="${title}">${content}</div>`;

  const portal = document.createElement("div");
  portal.setAttribute("data-portal", "true");
  portal.style.cssText = "display:flex;min-height:100vh";
  portal.innerHTML = `${renderSidebar(active, isAdmin)}${renderMobileBar(active, isAdmin)}<div style="flex:1 1 0%;display:flex;flex-direction:column;min-height:100vh;min-width:0">${renderTopbar(title, isAdmin)}<main class="dashboard-main" style="flex:1 1 0%;overflow-y:auto">${pageInner}</main></div>`;

  slot.replaceWith(portal);
  document.body.classList.toggle("is-admin-user", isAdmin);
  bindShellEvents();

  window.dispatchEvent(new CustomEvent("alphafx:layout-ready"));
  if (window.__ALPHAFX_USER) {
    window.dispatchEvent(new CustomEvent("alphafx:user", { detail: window.__ALPHAFX_USER }));
  }
}

window.addEventListener("alphafx:user", (e) => {
  window.__ALPHAFX_USER = e.detail;
  const user = e.detail;
  const nameEl = document.getElementById("pt-topbar-profile-name");
  const avatarEl = document.getElementById("pt-topbar-avatar");
  if (nameEl && user?.full_name) nameEl.textContent = user.full_name;
  if (avatarEl && user?.full_name) {
    const parts = user.full_name.trim().split(/\s+/);
    avatarEl.textContent = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : user.full_name.slice(0, 2).toUpperCase();
  }

  refreshShellForUser(user);

  if (user?.is_admin || window.AlphaFXApi?.getUnreadCount) {
    if (user?.is_admin) return;
    window.AlphaFXApi.getUnreadCount()
      .then(({ count }) => {
        window.__ALPHAFX_UNREAD = count || null;
        document.querySelectorAll('[data-nav-badge="notifications"]').forEach((el) => {
          if (count > 0) {
            el.textContent = count;
            el.style.display = "";
          } else {
            el.remove();
          }
        });
        const bell = document.querySelector(".pt-topbar-bell");
        if (bell) bell.classList.toggle("has-unread", count > 0);
      })
      .catch(() => {});
  }
});

window.addEventListener("hashchange", () => {
  if (document.body.dataset.page !== "admin" || !window.__ALPHAFX_USER?.is_admin) return;
  refreshShellForUser(window.__ALPHAFX_USER);
});

document.addEventListener("DOMContentLoaded", initLayout);

window.AlphaFXLayout = { refreshShellForUser, TRADER_PAGES };
