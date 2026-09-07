/**
 * Shared AlphaFX API client
 */
(function () {
  const API = window.ALPHAFX_API || "http://localhost:8000";
  const TOKEN_KEY = "alphafx_token";
  const DEVICE_KEY = "alphafx_device_id";

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return `dev-${Date.now()}`;
    }
  }

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
    headers["X-Device-Id"] = getDeviceId();

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
    getDeviceId,
    request,
    login: (email, password) =>
      request("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, device_id: getDeviceId() }),
      }),
    register: (email, password, full_name) =>
      request("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name, device_id: getDeviceId() }),
      }),
    logout: () => request("/api/v1/auth/logout", { method: "POST" }),
    me: () => request("/api/v1/auth/me"),
    getPlans: () => request("/api/v1/plans"),
    getDashboard: () => request("/api/v1/dashboard"),
    getAccounts: (status = "all") => request(`/api/v1/accounts?status=${encodeURIComponent(status)}`),
    getAccount: (id) => request(`/api/v1/accounts/${id}`),
    checkoutPay: (body) => request("/api/v1/checkout/pay", { method: "POST", body: JSON.stringify(body) }),
    adminStats: () => request("/api/v1/admin/stats"),
    adminUsers: (params = {}) => {
      const q = params.device_id ? `?device_id=${encodeURIComponent(params.device_id)}` : "";
      return request(`/api/v1/admin/users${q}`);
    },
    adminUser: (id) => request(`/api/v1/admin/users/${id}`),
    adminUserSnapshot: (userId, accountId) =>
      request(`/api/v1/admin/users/${userId}/snapshot?account_id=${encodeURIComponent(accountId)}`),
    adminLiveTrading: () => request("/api/v1/admin/trading/live"),
    adminClosePosition: (tradeId, message) =>
      request(`/api/v1/admin/positions/${tradeId}/close`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    adminAccounts: () => request("/api/v1/admin/accounts"),
    adminOrders: () => request("/api/v1/admin/orders"),
    adminBlockUser: (id, blocked, reason) =>
      request(`/api/v1/admin/users/${id}/block`, {
        method: "PATCH",
        body: JSON.stringify({ blocked, reason: reason || null }),
      }),
    adminStrikeUser: (id, rule_label, reason) =>
      request(`/api/v1/admin/users/${id}/strike`, {
        method: "POST",
        body: JSON.stringify({ rule_label, reason }),
      }),
    adminClearStrikes: (id) => request(`/api/v1/admin/users/${id}/strikes`, { method: "DELETE" }),
    adminUserStrikes: (id) => request(`/api/v1/admin/users/${id}/strikes`),
    getBilling: () => request("/api/v1/billing"),
    getNotifications: () => request("/api/v1/notifications"),
    getUnreadCount: () => request("/api/v1/notifications/unread-count"),
    markAllNotificationsRead: () => request("/api/v1/notifications/read-all", { method: "POST" }),
    listSupportTickets: () => request("/api/v1/support/tickets"),
    createSupportTicket: (body) => request("/api/v1/support/tickets", { method: "POST", body: JSON.stringify(body) }),
    getSupportTicket: (id) => request(`/api/v1/support/tickets/${id}`),
    postSupportMessage: (id, body) =>
      request(`/api/v1/support/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    adminSupportTickets: () => request("/api/v1/admin/support/tickets"),
    adminSupportTicket: (id) => request(`/api/v1/admin/support/tickets/${id}`),
    adminSupportReply: (id, body) =>
      request(`/api/v1/admin/support/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    adminSupportClose: (id) => request(`/api/v1/admin/support/tickets/${id}/close`, { method: "POST" }),
    getTradeSnapshot: (accountId) =>
      request(`/api/v1/trade/snapshot${accountId ? `?account_id=${accountId}` : ""}`),
    getMarketSymbols: () => request("/api/v1/market/symbols"),
    getMarketHistory: (symbol, timeframe = "M1", limit = 240, anchor) => {
      let url = `/api/v1/market/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`;
      if (anchor != null) url += `&anchor=${encodeURIComponent(anchor)}`;
      return request(url);
    },
  };
})();
