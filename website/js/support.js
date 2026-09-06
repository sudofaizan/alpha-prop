/**
 * Support page — new ticket modal + local ticket list
 */
(function () {
  if (document.body.dataset.page !== "support") return;

  const STORAGE_KEY = "alphafx_support_tickets";
  let tickets = [];
  let selectedId = null;

  const els = {};

  function loadTickets() {
    try {
      tickets = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      tickets = [];
    }
  }

  function saveTickets() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
  }

  function formatWhen(iso) {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function priorityLabel(value) {
    return value.charAt(0) + value.slice(1).toLowerCase();
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
      <button type="button" class="support-ticket-row${t.id === selectedId ? " is-active" : ""}" data-ticket-id="${t.id}">
        <div class="support-ticket-subject">${escapeHtml(t.subject)}</div>
        <div class="support-ticket-meta">${priorityLabel(t.priority)} · ${formatWhen(t.created_at)}</div>
      </button>`
      )
      .join("");

    els.listBody.querySelectorAll("[data-ticket-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = Number(btn.dataset.ticketId);
        renderList(els.search?.value || "");
        renderThread();
      });
    });
  }

  function renderThread() {
    if (!els.thread) return;
    const ticket = tickets.find((t) => t.id === selectedId);
    if (!ticket) {
      els.thread.innerHTML = `
        <div class="pt-empty">
          <div class="pt-empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="pt-empty-title">Select a conversation</div>
          <p class="pt-empty-sub">Choose a ticket from the list to open the thread, or start a new conversation.</p>
        </div>`;
      return;
    }

    const files =
      ticket.files?.length ?
        `<div class="support-file-list">${ticket.files.map((f) => `<div class="support-file-item">${escapeHtml(f)}</div>`).join("")}</div>`
      : "";

    els.thread.innerHTML = `
      <div class="support-thread-view">
        <div class="support-thread-head">
          <h3>${escapeHtml(ticket.subject)}</h3>
          <div class="support-ticket-meta">${priorityLabel(ticket.priority)} · Open · ${formatWhen(ticket.created_at)}</div>
        </div>
        <p class="support-thread-message">${escapeHtml(ticket.message)}</p>
        ${files}
        <p class="support-ticket-meta" style="margin-top:18px;">Our team will reply here once support messaging is connected to the backend.</p>
      </div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    const subjectOk = subjectLen >= 5;
    const messageOk = messageLen >= 10;
    const ready = subjectOk && messageOk;
    els.submitBtn.disabled = !ready;
    if (ready) els.submitBtn.removeAttribute("aria-disabled");
    else els.submitBtn.setAttribute("aria-disabled", "true");

    const hint = document.getElementById("ticket-form-hint");
    if (hint) {
      if (ready) {
        hint.textContent = "";
        hint.hidden = true;
      } else if (!subjectOk) {
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
      els.fileList.innerHTML = names.map((n) => `<div class="support-file-item">${escapeHtml(n)}</div>`).join("");
    });

    els.form?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (els.submitBtn?.disabled) return;

      const ticket = {
        id: Date.now(),
        subject: els.subject.value.trim(),
        priority: els.priority.value,
        message: els.message.value.trim(),
        files: [...(els.files?.files || [])].slice(0, 3).map((f) => f.name),
        status: "open",
        created_at: new Date().toISOString(),
      };

      tickets.unshift(ticket);
      saveTickets();
      selectedId = ticket.id;
      closeModal();
      renderList(els.search?.value || "");
      renderThread();
    });

    els.search?.addEventListener("input", () => renderList(els.search.value));
  }

  function init() {
    cacheElements();
    loadTickets();
    bindEvents();
    renderList();
    renderThread();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
