"use strict";

const $ = (id) => document.getElementById(id);
const api = async (method, url, body) => {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(url, opt);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
};

function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- auth ----------
async function checkAuth() {
  try {
    const me = await api("GET", "/api/me");
    showMain(me);
  } catch {
    showLogin();
  }
}

function showLogin() {
  $("login").classList.remove("hidden");
  $("main").classList.add("hidden");
}

function showMain(me) {
  $("login").classList.add("hidden");
  $("main").classList.remove("hidden");
  $("who").textContent = me.user || "";
  const warn = $("warn");
  if (me.systemctlOk === false) {
    warn.textContent = "警告：当前进程无权调用 systemctl（需要 root 或免密 sudo）。服务启停操作可能失败。";
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
  loadConfig();
  loadServices();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    await api("POST", "/api/login", { username: $("login-user").value, password: $("login-pass").value });
    const me = await api("GET", "/api/me");
    showMain(me);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("btn-logout").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  showLogin();
});

// ---------- config ----------
let CONFIG = {};
async function loadConfig() {
  try { CONFIG = await api("GET", "/api/config"); } catch {}
}

// ---------- services ----------
const stateLabels = {
  running: "运行中", stopped: "已停止", failed: "失败", activating: "启动中",
  deactivating: "停止中", paused: "已暂停", unknown: "未知",
};

let streamCache = {};

async function loadServices() {
  let data;
  try { data = await api("GET", "/api/services"); } catch (e) { return; }
  const box = $("services");
  if (!data.services.length) {
    box.innerHTML = `<div class="muted" style="padding:20px">还没有服务。点击「新增服务」添加第一个 dsh 服务。</div>`;
    return;
  }
  box.innerHTML = data.services.map(renderService).join("");
  data.services.forEach((s) => bindService(s));
}

function renderService(s) {
  const dotCls = s.state;
  const mem = s.memoryBytes ? (s.memoryBytes / 1024 / 1024).toFixed(1) + " MiB" : "—";
  const tokenBlock = s.token
    ? `<div class="tokenline">
         <span class="muted">token:</span>
         <span class="tokenval" id="tok-${s.id}" data-tok="${esc(s.token)}">${esc(mask(s.token))}</span>
         <button class="ghost small" data-act="showtok" data-id="${s.id}">显示</button>
         <button class="ghost small" data-act="copytok" data-id="${s.id}">复制 token</button>
         <button class="ghost small" data-act="copylink" data-id="${s.id}">复制访问链接</button>
       </div>`
    : `<div class="muted">token: ${s.state === "running" ? "等待启动日志中出现 token…" : "服务未运行"}</div>`;

  const restarted = s.paused
    ? `<span class="badge" style="border-color:var(--yellow);color:#e8c76a">已暂停：连续失败 ${s.restartCount} 次</span>`
    : "";

  return `
  <div class="svc" data-svc="${s.id}" data-link="${esc(s.webLink || "")}">
    <div class="svc-head">
      <span class="dot ${dotCls}"></span>
      <span class="svc-name">${esc(s.name)}</span>
      <span class="svc-meta">profile: ${esc(s.profile)} · ${stateLabels[s.state] || s.state} · PID ${s.pid ?? "—"} · ${mem} · 版本 ${esc(s.dshVersion)}</span>
      ${restarted}
      <span class="grow"></span>
    </div>
    <div class="svc-body">
      ${tokenBlock}
      <div class="svc-actions">
        <button class="small" data-act="start" data-id="${s.id}" ${s.state === "running" ? "disabled" : ""}>启动</button>
        <button class="ghost small" data-act="stop" data-id="${s.id}" ${s.state === "stopped" ? "disabled" : ""}>停止</button>
        <button class="ghost small" data-act="restart" data-id="${s.id}">重启</button>
        <button class="ghost small" data-act="logs" data-id="${s.id}">查看日志</button>
        <button class="ghost small" data-act="edit" data-id="${s.id}">编辑</button>
        <button class="danger small" data-act="del" data-id="${s.id}">删除</button>
      </div>
      <pre class="logbox" id="log-${s.id}"></pre>
    </div>
  </div>`;
}

function mask(tok) {
  if (!tok) return "";
  if (tok.length <= 10) return "••••••";
  return tok.slice(0, 4) + "…" + tok.slice(-4) + " （点击显示）";
}

function bindService(s) {
  const root = document.querySelector(`[data-svc="${s.id}"]`);
  if (!root) return;
  root.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => handleAction(btn.dataset.act, s.id, btn));
  });
}

async function handleAction(act, id, btn) {
  const svc = await api("GET", `/api/services/${id}`).catch(() => null);
  if (!svc && act !== "del") return;
  try {
    btn.disabled = true;
    if (act === "start") { await api("POST", `/api/services/${id}/start`); toast("已发送启动", "ok"); }
    else if (act === "stop") { await api("POST", `/api/services/${id}/stop`); toast("已停止", "ok"); }
    else if (act === "restart") { await api("POST", `/api/services/${id}/restart`); toast("重启中…", "ok"); }
    else if (act === "showtok") { toggleToken(id); btn.disabled = false; return; }
    else if (act === "copytok") { copy(svc.token); toast("token 已复制", "ok"); btn.disabled = false; return; }
    else if (act === "copylink") { copy(svc.webLink); toast("访问链接已复制", "ok"); btn.disabled = false; return; }
    else if (act === "logs") { toggleLogs(id); btn.disabled = false; return; }
    else if (act === "edit") { openEditor(await fullService(id)); btn.disabled = false; return; }
    else if (act === "del") {
      if (!confirm("确认删除该服务？将先停止进程。")) { btn.disabled = false; return; }
      await api("DELETE", `/api/services/${id}`);
      toast("已删除", "ok");
      setTimeout(loadServices, 400);
      return;
    }
    setTimeout(loadServices, 900);
  } catch (e) {
    toast(e.message, "err");
    btn.disabled = false;
  }
}

function toggleToken(id) {
  const el = $(`tok-${id}`);
  if (!el) return;
  const real = el.dataset.tok;
  if (el.textContent.startsWith("•") || el.textContent.includes("…")) el.textContent = real;
  else el.textContent = mask(real);
}

function toggleLogs(id) {
  const box = $(`log-${id}`);
  if (!box) return;
  if (box.classList.toggle("open")) {
    if (!streamCache[id]) {
      box.textContent = "(连接日志流…)\n";
      const es = new EventSource(`/api/services/${id}/stream`);
      es.onmessage = (ev) => {
        try {
          const lines = JSON.parse(ev.data);
          box.textContent += lines.map((l) => l + "\n").join("");
          box.scrollTop = box.scrollHeight;
        } catch {}
      };
      es.onerror = () => {};
      streamCache[id] = es;
    }
  }
}

function copy(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  });
}

async function fullService(id) {
  const cfg = await api("GET", "/api/config");
  return (cfg.services || []).find((x) => x.id === id) || null;
}

// ---------- editor ----------
let editingId = null;

function openEditor(svc) {
  editingId = svc ? svc.id : null;
  $("modal-title").textContent = svc ? "编辑服务" : "新增服务";
  $("modal-error").textContent = "";
  $("svc-id").value = svc?.id || "";
  $("svc-name").value = svc?.name || "dsh web";
  $("svc-profile").value = svc?.profile || "web";
  $("svc-args").value = (svc?.args || ["--no-open", "--port", "3080"]).join("\n");
  $("svc-env").value = Object.entries(svc?.env || {}).map(([k, v]) => `${k}=${v}`).join("\n");
  $("svc-workdir").value = svc?.workdir || "/";
  $("svc-port").value = svc?.port ?? 3080;
  $("svc-restart").value = svc?.restartPolicy || "exponential";
  $("svc-maxrestarts").value = svc?.maxRestarts ?? 5;
  $("svc-delay").value = svc?.restartDelaySec ?? 3;
  $("svc-mem").value = svc?.memoryMaxMiB ?? 0;
  $("svc-version").value = svc?.dshVersion || "inherit";
  $("svc-autostart").checked = !!svc?.autostart;
  $("modal").classList.remove("hidden");
}

$("btn-add").addEventListener("click", async () => {
  const cfg = await api("GET", "/api/config");
  openEditor({ name: "dsh web", profile: "web", args: ["--no-open", "--port", "3080"], workdir: "/", port: 3080, restartPolicy: "exponential", maxRestarts: 5, restartDelaySec: 3, memoryMaxMiB: 0, dshVersion: "inherit", autostart: true });
});
$("btn-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));

$("btn-save").addEventListener("click", async () => {
  $("modal-error").textContent = "";
  const args = $("svc-args").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const env = {};
  for (const line of $("svc-env").value.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    const i = l.indexOf("=");
    if (i < 0) { $("modal-error").textContent = `环境变量格式错误: ${l}`; return; }
    env[l.slice(0, i).trim()] = l.slice(i + 1);
  }
  const body = {
    name: $("svc-name").value,
    profile: $("svc-profile").value,
    args,
    env,
    workdir: $("svc-workdir").value,
    port: $("svc-port").value === "" ? null : Number($("svc-port").value),
    restartPolicy: $("svc-restart").value,
    maxRestarts: Number($("svc-maxrestarts").value),
    restartDelaySec: Number($("svc-delay").value),
    memoryMaxMiB: Number($("svc-mem").value),
    dshVersion: $("svc-version").value.trim() || "inherit",
    autostart: $("svc-autostart").checked,
  };
  try {
    if (editingId) await api("PUT", `/api/services/${editingId}`, body);
    else await api("POST", "/api/services", body);
    $("modal").classList.add("hidden");
    toast("已保存", "ok");
    loadServices();
  } catch (e) {
    $("modal-error").textContent = e.message;
  }
});

// ---------- versions ----------
$("btn-versions").addEventListener("click", async () => {
  $("vmodal").classList.remove("hidden");
  await refreshVersions();
});
$("btn-vclose").addEventListener("click", () => $("vmodal").classList.add("hidden"));

async function refreshVersions() {
  const list = $("versions-list");
  list.innerHTML = "加载中…";
  try {
    const data = await api("GET", "/api/versions");
    const rows = [`<div class="vrow"><div class="grow"><b>system</b> <span class="muted">（服务器自带的 dsh）</span></div>
      ${data.activeVersion === "system" ? '<span class="badge active">使用中</span>' : `<button class="ghost small" data-actver="system">切换</button>`}</div>`];
    for (const v of data.installed) {
      rows.push(`<div class="vrow"><div class="grow"><b>${esc(v.version)}</b> <span class="muted">${esc(v.installedAt)}</span></div>
        ${v.active ? '<span class="badge active">使用中</span>' : `<button class="ghost small" data-actver="${esc(v.version)}">切换</button>`}</div>`);
    }
    list.innerHTML = rows.join("");
    list.querySelectorAll("[data-actver]").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await api("POST", "/api/versions/activate", { version: b.dataset.actver });
          toast("已切换版本，请重启对应服务以生效", "ok");
          refreshVersions();
        } catch (e) { toast(e.message, "err"); }
      });
    });
  } catch (e) {
    list.innerHTML = `<span class="error">${esc(e.message)}</span>`;
  }
}

$("btn-vinstall").addEventListener("click", async () => {
  const v = $("vinstall-input").value.trim();
  if (!v) return;
  $("version-log").classList.add("open");
  $("version-log").textContent = "安装中…（可能需要几分钟）\n";
  try {
    const r = await api("POST", "/api/versions/install", { version: v });
    $("version-log").textContent += (r.log || "done") + "\n";
    toast("安装完成", "ok");
    refreshVersions();
  } catch (e) {
    $("version-log").textContent += "失败: " + e.message + "\n";
  }
});

// ---------- config modal ----------
$("btn-config").addEventListener("click", () => {
  $("cfg-launch").value = CONFIG.launchHost || "";
  $("cfg-dsh").value = CONFIG.dshHost || "";
  $("cfg-dshpath").value = CONFIG.systemDshPath || "dsh";
  $("cfg-error").textContent = "";
  $("cmodal").classList.remove("hidden");
});
$("btn-cfg-cancel").addEventListener("click", () => $("cmodal").classList.add("hidden"));
$("btn-cfg-save").addEventListener("click", async () => {
  try {
    await api("PATCH", "/api/config", {
      launchHost: $("cfg-launch").value.trim(),
      dshHost: $("cfg-dsh").value.trim(),
      systemDshPath: $("cfg-dshpath").value.trim(),
    });
    await loadConfig();
    $("cmodal").classList.add("hidden");
    toast("配置已保存", "ok");
    loadServices();
  } catch (e) { $("cfg-error").textContent = e.message; }
});

// ---------- password modal (simple prompt-based) ----------
$("btn-password").addEventListener("click", async () => {
  const current = prompt("当前密码：");
  if (!current) return;
  const next = prompt("新密码（至少 8 位）：");
  if (!next) return;
  const confirm2 = prompt("再次输入新密码：");
  if (next !== confirm2) { toast("两次输入不一致", "err"); return; }
  try {
    await api("POST", "/api/password", { current, next });
    toast("密码已修改", "ok");
  } catch (e) { toast(e.message, "err"); }
});

// ---------- boot ----------
checkAuth();
setInterval(() => {
  const onMain = !$("main").classList.contains("hidden");
  const noModal = $("modal").classList.contains("hidden") && $("vmodal").classList.contains("hidden") && $("cmodal").classList.contains("hidden");
  if (onMain && noModal) loadServices();
}, 5000);
