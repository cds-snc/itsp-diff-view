const state = {
  data: null,
  rows: [],
  selectedId: null,
};

const els = {
  stats: document.querySelector("#stats"),
  rows: document.querySelector("#rows"),
  detail: document.querySelector("#detail"),
  search: document.querySelector("#search"),
  family: document.querySelector("#family"),
  status: document.querySelector("#status"),
  type: document.querySelector("#type"),
  sourceLink: document.querySelector("#sourceLink"),
};

const statusOrder = { added: 0, changed: 1, withdrawn: 2, removed: 3, unchanged: 4 };

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function searchable(row) {
  return [
    row.id,
    row.displayId,
    row.family,
    row.type,
    row.status,
    row.old?.title,
    row.old?.text,
    row.old?.related?.join(" "),
    row.new?.title,
    row.new?.text,
    row.new?.related?.join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderStats() {
  const labels = ["added", "changed", "removed", "withdrawn", "unchanged"];
  els.stats.innerHTML = labels.map((key) => `
    <div class="stat">
      <strong>${state.data.counts[key].toLocaleString()}</strong>
      <span>${key}</span>
    </div>
  `).join("");
}

function renderFamilies() {
  const families = [...new Set(state.data.diffs.map((row) => row.family).filter(Boolean))].sort();
  els.family.innerHTML = `<option value="">All families</option>${families.map((family) => `<option value="${esc(family)}">${esc(family)}</option>`).join("")}`;
}

function currentRows() {
  const q = els.search.value.trim().toLowerCase();
  const family = els.family.value;
  const status = els.status.value;
  const type = els.type.value;
  return state.data.diffs
    .filter((row) => !family || row.family === family)
    .filter((row) => !status || row.status === status)
    .filter((row) => !type || row.type === type)
    .filter((row) => !q || searchable(row).includes(q))
    .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || a.id.localeCompare(b.id));
}

function renderTable() {
  state.rows = currentRows();
  els.rows.innerHTML = state.rows.map((row) => {
    const title = row.new?.title || row.old?.title || "";
    return `
      <tr data-id="${esc(row.id)}" class="${row.id === state.selectedId ? "selected" : ""}">
        <td class="id">${esc(row.displayId)}</td>
        <td>${esc(row.family || "")}</td>
        <td>${esc(title)}</td>
        <td><span class="badge ${esc(row.status)}">${esc(row.status)}</span></td>
        <td>${esc(row.type || "")}</td>
      </tr>
    `;
  }).join("");
}

function renderDiff(parts) {
  if (!parts?.length) return "";
  return parts.map((part) => {
    if (part.t === "same") return `${esc(part.v)} `;
    return `<mark class="${part.t}">${esc(part.v)}</mark> `;
  }).join("");
}

function renderDetail(row) {
  if (!row) {
    els.detail.innerHTML = `<p class="empty">Select a row to inspect the old and new text.</p>`;
    return;
  }

  const oldItem = row.old || {};
  const newItem = row.new || {};
  const title = newItem.title || oldItem.title || row.displayId;
  const source = newItem.sourceUrl ? `<a href="${esc(newItem.sourceUrl)}">Official source</a>` : "";
  els.detail.innerHTML = `
    <h2>${esc(row.displayId)} ${esc(title)}</h2>
    <div class="meta">
      <span class="badge ${esc(row.status)}">${esc(row.status)}</span>
      <span class="pill">${esc(row.family || "")}</span>
      <span class="pill">${esc(row.type || "")}</span>
      ${source ? `<span class="pill">${source}</span>` : ""}
    </div>
    <div class="compare">
      ${row.diff?.length ? `<div class="text-box"><h3>Word diff</h3><pre>${renderDiff(row.diff)}</pre></div>` : ""}
      <div class="text-box"><h3>Old</h3><pre>${esc(oldItem.text || "No old entry")}</pre></div>
      <div class="text-box"><h3>New</h3><pre>${esc(newItem.text || "No new entry")}</pre></div>
      ${newItem.discussion ? `<div class="text-box"><h3>New discussion</h3><pre>${esc(newItem.discussion)}</pre></div>` : ""}
      ${newItem.related?.length ? `<div class="text-box"><h3>Related controls</h3><pre>${esc(newItem.related.join(", "))}</pre></div>` : ""}
    </div>
  `;
}

function sync() {
  state.rows = currentRows();
  if (!state.rows.some((row) => row.id === state.selectedId)) {
    state.selectedId = state.rows[0]?.id || null;
  }
  renderTable();
  renderDetail(state.data.diffs.find((row) => row.id === state.selectedId));
}

async function init() {
  const res = await fetch("./data/catalogue.json");
  if (!res.ok) {
    els.detail.innerHTML = `<p class="empty">Run <code>npm run build:data</code> first.</p>`;
    return;
  }
  state.data = await res.json();
  els.sourceLink.href = state.data.source;
  renderStats();
  renderFamilies();
  state.selectedId = state.data.diffs.find((row) => row.status !== "unchanged")?.id || state.data.diffs[0]?.id;
  sync();
}

[els.search, els.family, els.status, els.type].forEach((el) => el.addEventListener("input", sync));

els.rows.addEventListener("click", (event) => {
  const tr = event.target.closest("tr[data-id]");
  if (!tr) return;
  state.selectedId = tr.dataset.id;
  sync();
});

init();
