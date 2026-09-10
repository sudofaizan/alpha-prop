/**
 * Crypto payment waiting page — USDT BEP-20 with auto balance poll + hash verify.
 */
(function () {
  if (document.body.dataset.page !== "payment") return;

  const POLL_MS = 8000;
  let pollTimer = null;
  let countdownTimer = null;
  let expiresAt = null;
  let sessionId = null;

  const els = {};

  function money(n) {
    return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function cacheElements() {
    Object.assign(els, {
      main: document.getElementById("pay-main"),
      success: document.getElementById("pay-success"),
      successMsg: document.getElementById("pay-success-msg"),
      successTrade: document.getElementById("pay-success-trade"),
      successAccounts: document.getElementById("pay-success-accounts"),
      sessionId: document.getElementById("pay-session-id"),
      planSub: document.getElementById("pay-plan-sub"),
      summaryLines: document.getElementById("pay-summary-lines"),
      amount: document.getElementById("pay-amount"),
      expected: document.getElementById("pay-expected"),
      delta: document.getElementById("pay-delta"),
      qr: document.getElementById("pay-qr"),
      address: document.getElementById("pay-address"),
      copyBtn: document.getElementById("pay-copy-btn"),
      timer: document.getElementById("pay-timer"),
      txHash: document.getElementById("pay-tx-hash"),
      verifyBtn: document.getElementById("pay-verify-btn"),
      error: document.getElementById("pay-error"),
    });
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.classList.add("is-visible");
  }

  function clearError() {
    els.error.textContent = "";
    els.error.classList.remove("is-visible");
  }

  function summaryRow(label, value) {
    return `<div class="checkout-summary-row"><dt>${label}</dt><dd>${value}</dd></div>`;
  }

  function renderSession(data) {
    els.sessionId.textContent = data.session_id;
    els.planSub.textContent = `${data.program_label} · ${data.account_size_label}`;
    els.summaryLines.innerHTML = [
      summaryRow("Challenge", `${data.account_size_label} ${data.program_label}`),
      summaryRow("Payment method", "USDT BEP-20"),
      summaryRow("Status", data.status === "completed" ? "Complete" : "Incomplete"),
      summaryRow("Order #", String(data.order_id)),
    ].join("");
    els.amount.textContent = `${Number(data.amount).toFixed(2)} USDT`;
    els.expected.textContent = Number(data.amount).toFixed(2);
    els.address.textContent = data.wallet_address;
    els.delta.textContent = Number(data.balance_delta || 0).toFixed(2);

    const qrData = encodeURIComponent(data.wallet_address);
    els.qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${qrData}`;
    els.qr.hidden = false;

    expiresAt = new Date(data.expires_at);
    if (data.tx_hash) els.txHash.value = data.tx_hash;

    if (data.status === "completed" || data.order_status === "paid") {
      showSuccess(data);
    }
  }

  function showSuccess(data) {
    stopTimers();
    els.main.hidden = true;
    els.success.hidden = false;
    const acct = data.account_number ? `#${data.account_number}` : "your account";
    els.successMsg.textContent = `Payment confirmed. Challenge account ${acct} is ready.`;
    if (data.account_number) {
      els.successAccounts.href = `accounts.html?purchased=${encodeURIComponent(data.account_number)}`;
    }
  }

  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    pollTimer = null;
    countdownTimer = null;
  }

  function updateCountdown() {
    if (!expiresAt) return;
    const ms = expiresAt.getTime() - Date.now();
    if (ms <= 0) {
      els.timer.textContent = "00:00";
      return;
    }
    const totalSec = Math.floor(ms / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    els.timer.textContent = `${m}:${s}`;
  }

  async function refreshSession() {
    if (!sessionId) return;
    try {
      const data = await window.AlphaFXApi.getPaymentSession(sessionId);
      renderSession(data);
      if (data.status === "expired") {
        showError("Payment window expired. Start a new checkout from Billing.");
        stopTimers();
      }
    } catch (err) {
      showError(err.message || "Could not refresh payment status");
    }
  }

  function bindEvents() {
    els.copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(els.address.textContent.trim());
        window.AlphaFXToast?.show?.("Address copied", "success");
      } catch {
        showError("Could not copy address");
      }
    });

    els.verifyBtn.addEventListener("click", async () => {
      clearError();
      const hash = (els.txHash.value || "").trim();
      if (!hash) {
        showError("Enter your transaction hash");
        return;
      }
      els.verifyBtn.disabled = true;
      try {
        const data = await window.AlphaFXApi.verifyPaymentHash(sessionId, hash);
        window.AlphaFXToast?.show?.(data.message || "Payment verified", "success");
        renderSession(data);
      } catch (err) {
        showError(err.message || "Verification failed");
      } finally {
        els.verifyBtn.disabled = false;
      }
    });
  }

  async function init() {
    cacheElements();
    const params = new URLSearchParams(window.location.search);
    sessionId = params.get("session");
    if (!sessionId) {
      showError("Missing payment session. Go to Billing or Checkout.");
      return;
    }

    bindEvents();
    await refreshSession();

    pollTimer = setInterval(refreshSession, POLL_MS);
    countdownTimer = setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("beforeunload", stopTimers);
})();
