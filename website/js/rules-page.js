const RULES_MODELS = {
  "one-step": {
    desc: "Clear the single evaluation phase within the rules to get your funded account.",
    phases: [{ title: "Phase 1 (Evaluation)", text: "Reach the profit target while respecting the risk limits.", target: "10%" }],
  },
  "two-step": {
    desc: "Clear all 2 phases within the rules to get your funded account.",
    phases: [
      { title: "Phase 1 (Step 1)", text: "Reach the profit target while respecting the risk limits. No time pressure.", target: "5%" },
      { title: "Phase 2 (Step 2)", text: "A further verification phase with the same risk rules.", target: "8%" },
    ],
  },
  "three-step": {
    desc: "Clear all 3 phases within the rules to get your funded account.",
    phases: [
      { title: "Phase 1", text: "First verification gate.", target: "5%" },
      { title: "Phase 2", text: "Second verification gate.", target: "5%" },
      { title: "Phase 3", text: "Final verification gate.", target: "4%" },
    ],
  },
  instant: {
    desc: "Instant funded — no evaluation. Survive the funded rules from day one.",
    phases: [{ title: "Funded", text: "Trade within limits. 70% profit split.", target: "—" }],
  },
};

document.getElementById("model-tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-model]");
  if (!btn) return;
  document.querySelectorAll("#model-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  const model = RULES_MODELS[btn.dataset.model];
  if (!model) return;
  document.getElementById("eval-desc").textContent = model.desc;
  const targets = document.querySelector("#rules-content > div:first-child");
  if (!targets) return;
  const boxes = model.phases.map((p) => `
    <div class="phase-box">
      <h4>${p.title}</h4>
      <p>${p.text}</p>
      <div class="profit-big">${p.target}</div>
      <div class="phase-meta"><span>Leverage: up to 1:100</span><span>Period: Unlimited</span></div>
    </div>`).join("");
  targets.innerHTML = `<h4 style="font-size:0.72rem;font-weight:800;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:0.75rem">TARGETS — HOW TO PASS</h4>${boxes}
    <div style="display:flex;gap:1rem;margin-top:0.75rem;font-size:0.72rem;color:var(--text-dim);flex-wrap:wrap">
      <span>🔴 News trading — Restricted</span><span>🔴 Weekend holding — Restricted</span><span>∞ No time limit</span>
    </div>`;
});

document.querySelectorAll(".cat-tabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".cat-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});
