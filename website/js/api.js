/**
 * Shared AlphaFX API client
 */
(function () {
  const API = window.ALPHAFX_API || "http://localhost:8000";
  const TOKEN_KEY = "alphafx_token";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API}${path}`, { ...options, headers });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const detail = data?.detail;
      const code = typeof detail === "object" ? detail.code : "REQUEST_FAILED";
      const message = typeof detail === "object" ? detail.message : "Request failed";
      const err = new Error(message);
      err.code = code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.AlphaFXApi = {
    API,
    getToken,
    setToken,
    clearToken,
    request,
    login: (email, password) => request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    register: (email, password, full_name) =>
      request("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password, full_name }) }),
    logout: () => request("/api/v1/auth/logout", { method: "POST" }),
    me: () => request("/api/v1/auth/me"),
    getPlans: () => request("/api/v1/plans"),
    getDashboard: () => request("/api/v1/dashboard"),
    getAccounts: (status = "all") => request(`/api/v1/accounts?status=${encodeURIComponent(status)}`),
    getAccount: (id) => request(`/api/v1/accounts/${id}`),
    checkoutPay: (body) => request("/api/v1/checkout/pay", { method: "POST", body: JSON.stringify(body) }),
    adminStats: () => request("/api/v1/admin/stats"),
    adminUsers: () => request("/api/v1/admin/users"),
    adminAccounts: () => request("/api/v1/admin/accounts"),
    adminOrders: () => request("/api/v1/admin/orders"),
    adminBlockUser: (id, blocked, reason) =>
      request(`/api/v1/admin/users/${id}/block`, {
        method: "PATCH",
        body: JSON.stringify({ blocked, reason: reason || null }),
      }),
    getBilling: () => request("/api/v1/billing"),
    getNotifications: () => request("/api/v1/notifications"),
    getUnreadCount: () => request("/api/v1/notifications/unread-count"),
    markAllNotificationsRead: () => request("/api/v1/notifications/read-all", { method: "POST" }),
    getTradeSnapshot: (accountId) =>
      request(`/api/v1/trade/snapshot${accountId ? `?account_id=${accountId}` : ""}`),
    getMarketSymbols: () => request("/api/v1/market/symbols"),
    getMarketHistory: (symbol, timeframe = "M1", limit = 240) =>
      request(`/api/v1/market/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`),
  };
})();
