/**
 * Support page — tickets + live chat with support team
 */
(function () {
  if (document.body.dataset.page !== "support") return;

  const POLL_MS = 3000;
  let tickets = [];
  let selectedId = null;
  let thread = null;
  let pollTimer = null;
  let sending = false;

  const els = {};

  function parseWhen(iso) {
    const d = window.AlphaFXTime ? window.AlphaFXTime.parseUtc(iso) : new Date(iso);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function timeAgo(iso) {
    return window.AlphaFXTime ? window.AlphaFXTime.formatTimeAgo(iso) : parseWhen(iso);
  }

  function priorityLabel(value) {
    return value.charAt(0) + value.slice(1).toLowerCase();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cacheElements() {
    els.newBtn = document.getElementById("support-new-ticket-btn");
    els.search = document.getElementById("support-search");
    els.listBody = document.getElementById("support-list-body");
    els.thread = document.getElementById("support-thread");
    els.modal = document.getElementById("support-modal");
    els.form = document.getElementById("support-ticket-form");
    els.subject = document.getElementById("ticket-subject");
    els.priority = document.getElementById("ticket-priority");
    els.message = document.getElementById("ticket-message");
    els.files = document.getElementById("ticket-files");
    els.fileList = document.getElementById("ticket-file-list");
    els.submitBtn = document.getElementById("ticket-submit-btn");
    els.closeBtns = document.querySelectorAll("[data-close-ticket-modal]");
  }

  async function loadTickets() {
    const data = await window.AlphaFXApi.listSupportTickets();
    tickets = data.items || [];
  }

  function renderList(filter = "") {
    if (!els.listBody) return;
    const q = filter.trim().toLowerCase();
    const items = tickets.filter((t) => !q || t.subject.toLowerCase().includes(q));

    if (!items.length) {
      els.listBody.innerHTML = `<p class="support-empty-list">${tickets.length ? "No matching tickets" : "No tickets yet"}</p>`;
      return;
    }

    els.listBody.innerHTML = items
      .map(
        (t) => `
      <button type="button" class="support-ticket-row${t.id === selectedId ? " is-active" : ""}${t.needs_reply && t.status === "open" ? " needs-attention" : ""}" data-ticket-id="${t.id}">
        <div class="support-ticket-subject">${escapeHtml(t.subject)}</div>
        <div class="support-ticket-meta">${priorityLabel(t.priority)} · ${t.status} · ${timeAgo(t.last_message_at || t.created_at)}</div>
      </button>`
      )
      .join("");

    els.listBody.querySelectorAll("[data-ticket-id]").forEach((btn) => {
      btn.addEventListener("click", () => selectTicket(Number(btn.dataset.ticketId)));
    });
  }

  function renderMessages(messages) {
    return (messages || [])
      .map(
        (m) => `
      <div class="support-chat-bubble${m.is_staff ? " is-staff" : " is-user"}">
        <div class="support-chat-meta">${m.is_staff ? "Support" : escapeHtml(m.sender_name || "You")} · ${parseWhen(m.created_at)}</div>
        <div class="support-chat-text">${escapeHtml(m.body)}</div>
      </div>`
      )
      .join("");
  }

  function scrollThreadToBottom() {
    const box = els.thread?.querySelector(".support-chat-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function renderThreadView() {
    if (!els.thread) return;
    if (!thread) {
      els.thread.innerHTML = `
        <div class="pt-empty">
          <div class="pt-empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="pt-empty-title">Select a conversation</div>
          <p class="pt-empty-sub">Choose a ticket from the list to chat with support, or start a new conversation.</p>
        </div>`;
      return;
    }

    const closed = thread.status === "closed";
    els.thread.innerHTML = `
      <div class="support-thread-view support-thread-view--chat">
        <div class="support-thread-head">
          <h3>${escapeHtml(thread.subject)}</h3>
          <div class="support-ticket-meta">${priorityLabel(thread.priority)} · ${thread.status} · opened ${parseWhen(thread.created_at)}</div>
        </div>
        <div class="support-chat-messages" id="support-chat-messages">${renderMessages(thread.messages)}</div>
        ${
          closed
            ? `<p class="support-ticket-meta support-chat-closed">This ticket is closed. Open a new ticket if you need more help.</p>`
            : `<form class="support-chat-compose" id="support-reply-form">
            <textarea class="dfx-textarea" id="support-reply-input" rows="2" placeholder="Type a message…" required minlength="1"></textarea>
            <button type="submit" class="pt-btn pt-btn--primary" id="support-reply-btn">Send</button>
          </form>`
        }
      </div>`;

    scrollThreadToBottom();

    if (!closed) {
      const form = document.getElementById("support-reply-form");
      form?.addEventListener("submit", handleReply);
    }
  }

  async function fetchThread(ticketId, { silent = false } = {}) {
    if (!ticketId) return;
    try {
      const data = await window.AlphaFXApi.getSupportTicket(ticketId);
      const prevLen = thread?.messages?.length || 0;
      thread = data;
      if (!silent || prevLen !== (data.messages?.length || 0)) {
        renderThreadView();
      } else {
        const box = document.getElementById("support-chat-messages");
        if (box) box.innerHTML = renderMessages(data.messages);
        scrollThreadToBottom();
      }
    } catch (err) {
      if (!silent) {
        els.thread.innerHTML = `<div class="pt-card" style="padding:20px;color:var(--danger);">${escapeHtml(err.message || "Failed to load ticket")}</div>`;
      }
    }
  }

  async function selectTicket(id) {
    selectedId = id;
    thread = null;
    renderList(els.search?.value || "");
    renderThreadView();
    els.thread.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading conversation…</div>`;
    await fetchThread(id);
    startPolling();
  }

  async function handleReply(e) {
    e.preventDefault();
    if (sending || !selectedId) return;
    const input = document.getElementById("support-reply-input");
    const text = (input?.value || "").trim();
    if (!text) return;
    sending = true;
    const btn = document.getElementById("support-reply-btn");
    if (btn) btn.disabled = true;
    try {
      await window.AlphaFXApi.postSupportMessage(selectedId, text);
      if (input) input.value = "";
      await fetchThread(selectedId);
      await loadTickets();
      renderList(els.search?.value || "");
    } catch (err) {
      alert(err.message || "Send failed");
    } finally {
      sending = false;
      if (btn) btn.disabled = false;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    if (!selectedId) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      fetchThread(selectedId, { silent: true }).catch(console.error);
      loadTickets()
        .then(() => renderList(els.search?.value || ""))
        .catch(console.error);
    }, POLL_MS);
  }

  function openModal() {
    els.form?.reset();
    if (els.priority) els.priority.value = "MEDIUM";
    if (els.fileList) els.fileList.innerHTML = "";
    updateSubmitState();
    els.modal?.classList.add("is-open");
    document.body.style.overflow = "hidden";
    els.subject?.focus();
  }

  function closeModal() {
    els.modal?.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function updateSubmitState() {
    if (!els.submitBtn) return;
    const subjectLen = (els.subject?.value || "").trim().length;
    const messageLen = (els.message?.value || "").trim().length;
    const ready = subjectLen >= 5 && messageLen >= 10;
    els.submitBtn.disabled = !ready;
    if (ready) els.submitBtn.removeAttribute("aria-disabled");
    else els.submitBtn.setAttribute("aria-disabled", "true");

    const hint = document.getElementById("ticket-form-hint");
    if (hint) {
      if (ready) {
        hint.textContent = "";
        hint.hidden = true;
      } else if (subjectLen < 5) {
        hint.textContent = `Subject needs ${5 - subjectLen} more character${5 - subjectLen === 1 ? "" : "s"}.`;
        hint.hidden = false;
      } else {
        hint.textContent = `Message needs ${10 - messageLen} more character${10 - messageLen === 1 ? "" : "s"}.`;
        hint.hidden = false;
      }
    }
  }

  function bindEvents() {
    els.newBtn?.addEventListener("click", openModal);
    els.closeBtns.forEach((btn) => btn.addEventListener("click", closeModal));
    els.modal?.addEventListener("click", (e) => {
      if (e.target === els.modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.modal?.classList.contains("is-open")) closeModal();
    });

    [els.subject, els.message].forEach((el) => el?.addEventListener("input", updateSubmitState));

    els.files?.addEventListener("change", () => {
      if (!els.fileList || !els.files) return;
      const names = [...els.files.files].slice(0, 3).map((f) => f.name);
      els.fileList.innerHTML = names.map((n) => `<div class="support-file-item">${escapeHtml(n)} (not uploaded yet)</div>`).join("");
    });

    els.form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (els.submitBtn?.disabled || sending) return;
      sending = true;
      els.submitBtn.disabled = true;
      try {
        const created = await window.AlphaFXApi.createSupportTicket({
          subject: els.subject.value.trim(),
          priority: els.priority.value,
          message: els.message.value.trim(),
        });
        await loadTickets();
        closeModal();
        selectedId = created.id;
        thread = created;
        renderList(els.search?.value || "");
        renderThreadView();
        startPolling();
      } catch (err) {
        alert(err.message || "Could not create ticket");
      } finally {
        sending = false;
        updateSubmitState();
      }
    });

    els.search?.addEventListener("input", () => renderList(els.search.value));
    window.addEventListener("beforeunload", stopPolling);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopPolling();
      else if (selectedId) startPolling();
    });
  }

  async function init() {
    cacheElements();
    bindEvents();
    els.listBody.innerHTML = `<p class="support-empty-list">Loading tickets…</p>`;
    try {
      await loadTickets();
      renderList();
      renderThreadView();
    } catch (err) {
      els.listBody.innerHTML = `<p class="support-empty-list" style="color:var(--danger);">${escapeHtml(err.message || "Failed to load")}</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => init().catch(console.error));
})();
