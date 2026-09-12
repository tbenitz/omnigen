import { db, uid, storageStats } from "./db.js";
import { PROVIDERS, providersFor, getProvider, modelsFor, loadSettings, saveSettings, ensurePuter } from "./providers.js";
import { runExport } from "./export.js";

const $ = (id) => document.getElementById(id);

const state = {
  mode: "text",
  threads: [],
  activeId: null,
  messages: [],
  selectedProviders: ["pollinations_text"],
  settings: loadSettings(),
  busy: false
};

function defaults() {
  if (!state.settings.keys) state.settings.keys = {};
  if (state.settings.enablePuter == null) state.settings.enablePuter = false;
  if (state.settings.warnDismissed == null) state.settings.warnDismissed = false;
}

defaults();

function formatBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

async function refreshThreads() {
  state.threads = await db.allThreads();
  renderThreads();
}

function renderThreads() {
  const q = ($("threadSearch").value || "").toLowerCase();
  const list = $("threadList");
  list.innerHTML = "";
  const rows = state.threads.filter((t) => !q || (t.title || "").toLowerCase().includes(q) || t.mode.includes(q));
  if (!rows.length) {
    list.innerHTML = `<p class=\"t-meta\" style=\"padding:10px\">No threads yet.</p>`;
    return;
  }
  for (const t of rows) {
    const btn = document.createElement("button");
    btn.className = `thread${t.id === state.activeId ? " active" : ""}`;
    btn.innerHTML = `<div class=\"t-title\">${escapeHtml(t.title || "Untitled")}</div>
      <div class=\"t-meta\"><span>${t.mode}</span><span>${timeAgo(t.updatedAt)}</span></div>`;
    btn.onclick = () => openThread(t.id);
    list.appendChild(btn);
  }
}

async function createThread(mode = state.mode) {
  const thread = {
    id: uid("th"),
    title: `${mode[0].toUpperCase() + mode.slice(1)} thread`,
    mode,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await db.putThread(thread);
  state.activeId = thread.id;
  state.messages = [];
  await refreshThreads();
  renderMain();
  return thread;
}

async function openThread(id) {
  const thread = await db.getThread(id);
  if (!thread) return;
  state.activeId = id;
  state.mode = thread.mode;
  document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
  state.messages = await db.messagesFor(id);
  const available = providersFor(state.mode).filter((p) => !p.needsKey || state.settings.keys?.[p.keyName]).map((p) => p.id);
  state.selectedProviders = state.selectedProviders.filter((pid) => providersFor(state.mode).some((p) => p.id === pid));
  if (!state.selectedProviders.length) state.selectedProviders = available.slice(0, 1);
  renderThreads();
  renderMain();
}

async function ensureActive() {
  if (state.activeId && await db.getThread(state.activeId)) return await db.getThread(state.activeId);
  return createThread();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" }[c]));
}

function objectUrl(blob) {
  return URL.createObjectURL(blob);
}

async function renderMain() {
  const thread = state.activeId ? await db.getThread(state.activeId) : null;
  $("threadTitle").value = thread?.title || "";
  $("modeLabel").textContent = state.mode;
  renderProviders();
  renderOptions();
  const box = $("messages");
  box.innerHTML = "";
  if (!state.messages.length) {
    box.innerHTML = `<div class=\"empty\">
      <h2>Test free AI providers in one place</h2>
      <p>Pick text, image, or video. Select one or more providers, send a prompt, and compare the results. Everything stays in IndexedDB on this device until you export it.</p>
    </div>`;
    return;
  }
  for (const m of state.messages) {
    const el = document.createElement("div");
    el.className = `msg ${m.role}${m.status === "error" ? " error" : ""}`;
    el.innerHTML = `<div class=\"meta\">
      <span>${escapeHtml(m.role)}</span>
      ${m.providerId ? `<span>${escapeHtml(getProvider(m.providerId)?.name || m.providerId)}</span>` : ""}
      ${m.model ? `<span>${escapeHtml(m.model)}</span>` : ""}
      <span>${new Date(m.createdAt).toLocaleTimeString()}</span>
    </div>
    <div class=\"body\">${escapeHtml(m.text || (m.status === "pending" ? "Generating…" : ""))}</div>
    <div class=\"media\" data-mid=\"${m.id}\"></div>`;
    box.appendChild(el);
    const atts = await db.attachmentsForMessage(m.id);
    if (atts.length) {
      const grid = document.createElement("div");
      grid.className = "media-grid";
      for (const a of atts) {
        const card = document.createElement("div");
        card.className = "media-card";
        const url = objectUrl(a.blob);
        if (a.kind === "video" || (a.mime || "").startsWith("video/")) {
          card.innerHTML = `<video src=\"${url}\" controls></video>`;
        } else {
          card.innerHTML = `<img src=\"${url}\" alt=\"\">`;
        }
        const cap = document.createElement("div");
        cap.className = "cap";
        cap.innerHTML = `<span>${escapeHtml(a.name || a.kind)}</span>`;
        const dl = document.createElement("button");
        dl.className = "ghost";
        dl.textContent = "Download";
        dl.onclick = () => {
          const link = document.createElement("a");
          link.href = url;
          link.download = a.name || "attachment";
          link.click();
        };
        cap.appendChild(dl);
        card.appendChild(cap);
        grid.appendChild(card);
      }
      el.querySelector(".media").appendChild(grid);
    }
  }
  box.scrollTop = box.scrollHeight;
}

function renderProviders() {
  const row = $("providerRow");
  row.innerHTML = "";
  for (const p of providersFor(state.mode)) {
    const hasKey = !p.needsKey || !!(state.settings.keys?.[p.keyName] || (p.id === "custom_openai" && state.settings.customBase));
    const btn = document.createElement("button");
    btn.className = `chip${state.selectedProviders.includes(p.id) ? " selected" : ""}${p.needsKey ? " needs-key" : ""}${p.needsKey && !hasKey ? " missing" : ""}`;
    btn.textContent = p.needsKey ? `${p.name}${hasKey ? "" : " · key"}` : p.name;
    btn.title = p.note || (p.needsKey ? "Requires an API key in Settings" : "Works without a key");
    btn.onclick = () => {
      if (state.selectedProviders.includes(p.id)) {
        state.selectedProviders = state.selectedProviders.filter((pid) => pid !== p.id);
      } else {
        state.selectedProviders.push(p.id);
      }
      renderProviders();
      renderOptions();
    };
    row.appendChild(btn);
  }
}

function renderOptions() {
  const wrap = $("opts");
  wrap.innerHTML = "";
  const first = getProvider(state.selectedProviders[0]);
  const models = first ? modelsFor(first, state.mode) : [];
  wrap.appendChild(field("Model", `<select id=\"optModel\">${models.map((m) => `<option>${escapeHtml(m)}</option>`).join("")}</select>`));
  wrap.appendChild(field("System prompt", `<input id=\"optSystem\" placeholder=\"Optional persona / instructions\">`));
  if (state.mode === "image") {
    wrap.appendChild(field("Width", `<input id=\"optWidth\" type=\"number\" value=\"1024\">`));
    wrap.appendChild(field("Height", `<input id=\"optHeight\" type=\"number\" value=\"1024\">`));
    wrap.appendChild(field("Seed", `<input id=\"optSeed\" placeholder=\"random\">`));
  }
  if (state.settings.lastSystem) $("optSystem").value = state.settings.lastSystem;
}

function field(label, control) {
  const el = document.createElement("div");
  el.className = "field";
  el.innerHTML = `<label>${label}</label>${control}`;
  return el;
}

async function sendPrompt() {
  if (state.busy) return;
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  if (!state.selectedProviders.length) {
    $("status").textContent = "Select at least one provider.";
    return;
  }
  const thread = await ensureActive();
  if (thread.mode !== state.mode) thread.mode = state.mode;
  if (thread.title.endsWith("thread") && prompt.length > 4) thread.title = prompt.slice(0, 48);
  thread.updatedAt = Date.now();
  await db.putThread(thread);

  const userMsg = {
    id: uid("msg"),
    threadId: thread.id,
    role: "user",
    text: prompt,
    createdAt: Date.now(),
    status: "ok"
  };
  await db.putMessage(userMsg);
  state.messages.push(userMsg);
  $("prompt").value = "";
  state.settings.lastSystem = $("optSystem")?.value || "";
  saveSettings(state.settings);

  const history = state.messages.filter((m) => m.role !== "system");
  const model = $("optModel")?.value;
  const system = $("optSystem")?.value.trim();
  const width = Number($("optWidth")?.value || 1024);
  const height = Number($("optHeight")?.value || 1024);
  const seedRaw = $("optSeed")?.value;
  const seed = seedRaw ? Number(seedRaw) : undefined;

  state.busy = true;
  $("sendBtn").disabled = true;
  $("status").textContent = `Running ${state.selectedProviders.length} provider(s)…`;
  await renderMain();
  await ensurePuter(state.settings.enablePuter && state.selectedProviders.includes("puter_image"));

  const jobs = state.selectedProviders.map(async (pid) => {
    const provider = getProvider(pid);
    const assistant = {
      id: uid("msg"),
      threadId: thread.id,
      role: "assistant",
      text: "",
      providerId: pid,
      model: model || modelsFor(provider, state.mode)[0],
      createdAt: Date.now(),
      status: "pending"
    };
    await db.putMessage(assistant);
    state.messages.push(assistant);
    try {
      const result = await provider.generate({
        prompt,
        model: assistant.model,
        system,
        history: history.filter((m) => m.id !== userMsg.id),
        kind: state.mode,
        width,
        height,
        seed,
        settings: state.settings,
        key: state.settings.keys?.pollinations
      });
      assistant.text = result.text || "";
      assistant.status = "ok";
      await db.putMessage(assistant);
      for (const att of result.attachments || []) {
        await db.putAttachment({
          id: uid("att"),
          messageId: assistant.id,
          threadId: thread.id,
          kind: att.kind,
          mime: att.mime,
          name: att.name,
          blob: att.blob
        });
      }
    } catch (err) {
      assistant.text = err.message || String(err);
      assistant.status = "error";
      await db.putMessage(assistant);
    }
  });

  await Promise.all(jobs);
  thread.updatedAt = Date.now();
  await db.putThread(thread);
  state.busy = false;
  $("sendBtn").disabled = false;
  $("status").textContent = "Saved to IndexedDB on this browser.";
  await refreshThreads();
  await renderMain();
  updateStorage();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  state.selectedProviders = providersFor(mode).slice(0, 1).map((p) => p.id);
  renderProviders();
  renderOptions();
}

function openModal(id) { $(id).classList.add("show"); }
function closeModal(id) { $(id).classList.remove("show"); }

function renderSettings() {
  $("enablePuter").checked = !!state.settings.enablePuter;
  $("keyPollinations").value = state.settings.keys.pollinations || "";
  $("keyGroq").value = state.settings.keys.groq || "";
  $("keyOpenrouter").value = state.settings.keys.openrouter || "";
  $("keyGemini").value = state.settings.keys.gemini || "";
  $("keyHf").value = state.settings.keys.huggingface || "";
  $("keyCerebras").value = state.settings.keys.cerebras || "";
  $("keyCustom").value = state.settings.keys.custom || "";
  $("customBase").value = state.settings.customBase || "";
}

function saveSettingsFromForm() {
  state.settings.enablePuter = $("enablePuter").checked;
  state.settings.keys = {
    pollinations: $("keyPollinations").value.trim(),
    groq: $("keyGroq").value.trim(),
    openrouter: $("keyOpenrouter").value.trim(),
    gemini: $("keyGemini").value.trim(),
    huggingface: $("keyHf").value.trim(),
    cerebras: $("keyCerebras").value.trim(),
    custom: $("keyCustom").value.trim()
  };
  state.settings.customBase = $("customBase").value.trim();
  saveSettings(state.settings);
  ensurePuter(state.settings.enablePuter).catch((e) => alert(e.message));
  renderProviders();
  closeModal("settingsModal");
}

async function renderExport() {
  const box = $("exportThreads");
  box.innerHTML = "";
  const threads = await db.allThreads();
  if (!threads.length) {
    box.innerHTML = "<p>No threads stored yet.</p>";
    return;
  }
  for (const t of threads) {
    const row = document.createElement("label");
    row.innerHTML = `<input type=\"checkbox\" value=\"${t.id}\" ${t.id === state.activeId ? "checked" : ""}>
      <span><strong>${escapeHtml(t.title)}</strong> · ${t.mode} · ${timeAgo(t.updatedAt)}</span>`;
    box.appendChild(row);
  }
}

async function doExport() {
  const ids = [...document.querySelectorAll("#exportThreads input:checked")].map((i) => i.value);
  const mode = document.querySelector("input[name=exportMode]:checked").value;
  $("exportStatus").textContent = "Preparing export…";
  try {
    await runExport({
      threadIds: ids,
      mode,
      includeAttachments: mode !== "json-text",
      includeText: mode !== "attachments-only"
    });
    $("exportStatus").textContent = "Export downloaded.";
  } catch (e) {
    $("exportStatus").textContent = e.message;
  }
}

async function importJson(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const threads = data.threads || [];
  for (const item of threads) {
    const thread = item.thread;
    if (!thread?.id) continue;
    thread.id = uid("th");
    thread.updatedAt = Date.now();
    await db.putThread(thread);
    const idMap = {};
    for (const m of item.messages || []) {
      const old = m.id;
      m.id = uid("msg");
      m.threadId = thread.id;
      idMap[old] = m.id;
      await db.putMessage(m);
    }
    for (const a of item.attachments || []) {
      let blob = a.blob;
      if (!blob && a.dataBase64) {
        const bin = atob(a.dataBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: a.mime || "application/octet-stream" });
      }
      if (!blob) continue;
      await db.putAttachment({
        id: uid("att"),
        messageId: idMap[a.messageId] || a.messageId,
        threadId: thread.id,
        kind: a.kind,
        mime: a.mime,
        name: a.name,
        blob
      });
    }
  }
  await refreshThreads();
  $("exportStatus").textContent = `Imported ${threads.length} thread(s).`;
}

async function updateStorage() {
  const stats = await storageStats();
  if (!stats) return;
  $("storageHint").textContent = `Local cache ${formatBytes(stats.used)} / ${formatBytes(stats.quota)}`;
}

function bind() {
  document.querySelectorAll(".modes button").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $("newThread").onclick = () => createThread();
  $("threadSearch").oninput = renderThreads;
  $("sendBtn").onclick = sendPrompt;
  $("prompt").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendPrompt();
  });
  $("threadTitle").onchange = async () => {
    const t = await db.getThread(state.activeId);
    if (!t) return;
    t.title = $("threadTitle").value.trim() || t.title;
    t.updatedAt = Date.now();
    await db.putThread(t);
    await refreshThreads();
  };
  $("deleteThread").onclick = async () => {
    if (!state.activeId) return;
    if (!confirm("Delete this thread and its attachments from IndexedDB?")) return;
    await db.deleteThread(state.activeId);
    state.activeId = null;
    state.messages = [];
    await refreshThreads();
    if (state.threads[0]) await openThread(state.threads[0].id);
    else renderMain();
  };
  $("settingsBtn").onclick = () => { renderSettings(); openModal("settingsModal"); };
  $("saveSettings").onclick = saveSettingsFromForm;
  $("closeSettings").onclick = () => closeModal("settingsModal");
  $("exportBtn").onclick = async () => { await renderExport(); openModal("exportModal"); };
  $("closeExport").onclick = () => closeModal("exportModal");
  $("runExport").onclick = doExport;
  $("importFile").onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) importJson(file);
  };
  $("dismissWarn").onclick = () => {
    state.settings.warnDismissed = true;
    saveSettings(state.settings);
    $("warnBar").style.display = "none";
  };
  $("toggleSidebar").onclick = () => $("sidebar").classList.toggle("open");
  $("selectAllThreads").onclick = () => {
    document.querySelectorAll("#exportThreads input").forEach((i) => i.checked = true);
  };
}

async function init() {
  bind();
  if (state.settings.warnDismissed) $("warnBar").style.display = "none";
  await ensurePuter(state.settings.enablePuter).catch(() => {});
  await refreshThreads();
  if (state.threads[0]) await openThread(state.threads[0].id);
  else {
    renderProviders();
    renderOptions();
    renderMain();
  }
  updateStorage();
}

init().catch((err) => {
  console.error(err);
  $("status").textContent = err.message;
});
