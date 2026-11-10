// ComfyUI Live Terminal & Execution Monitor
import { el, icon, api, toast } from "./util.js";
import { t } from "./i18n.js";
import { gpuState } from "./nav.js";

let activeModal = null;
let pollTimer = null;
let autoScroll = true;
let isFullscreen = false;
let userCleared = false;

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Formats live terminal output mimicking a real interactive shell */
function formatLogs(rawText) {
  if (!rawText) return '<span class="log-dim">// No log output received yet</span><span class="shell-cursor">█</span>';

  // Gestione \n e carriage returns (\r tipici delle progress bars tqdm)
  const rawLines = rawText.split("\n");
  const lines = [];
  for (const r of rawLines) {
    if (r.includes("\r")) {
      const parts = r.split("\r").map((p) => p.trimEnd()).filter(Boolean);
      for (const p of parts) lines.push(p);
    } else {
      lines.push(r);
    }
  }

  const formatted = lines.map((line) => {
    // Rimuovi codici ANSI escape se presenti
    line = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    let esc = escapeHtml(line);

    // 1. SafeMode alert
    if (esc.match(/\[SafeMode\]|GPU temp critical|Paused PID/i)) {
      return `<span class="log-safemode">${esc}</span>`;
    }

    // 2. Progress bars (tqdm, AR sampling, ecc.)
    if (esc.match(/(\b\d+%\s*\||AR sampling:\s*\d+%)/i)) {
      esc = esc.replace(/(\b\d+%\s*\||AR sampling:\s*\d+%)/, '<span class="log-progress-val">$1</span>');
      return `<span class="log-progress">${esc}</span>`;
    }

    // 3. HTTP aiohttp access logs
    if (esc.match(/aiohttp\.access|GET \/api\/v2\/jobs/i)) {
      return `<span class="log-access">${esc}</span>`;
    }

    // 4. Timestamp [2026-11-06 22:15:51.149]
    esc = esc.replace(/^(\[\d{4}-\d{2}-\d{2}\s+[\d:.]+\])/, '<span class="log-time">$1</span>');

    // 5. [INFO] tags
    if (esc.match(/^\[INFO\]/)) {
      return esc.replace(/^\[INFO\]/, '<span class="log-info-tag">[INFO]</span>');
    }

    // 6. Error patterns
    if (esc.match(/\[ERROR\]|Error|Exception|Traceback|invalid prompt|failed validation|Value not in list/i)) {
      return `<span class="log-err">${esc}</span>`;
    }

    // 7. Warning patterns
    if (esc.match(/\[WARNING\]|Warning|deprecated/i)) {
      return `<span class="log-warn">${esc}</span>`;
    }

    // 8. Success / Model loading / Execution patterns
    if (esc.match(/Prompt executed in|Requested to load|prepared for dynamic VRAM|Staged|got prompt|FETCH .* \[DONE\]|All startup tasks have been completed/i)) {
      return `<span class="log-success">${esc}</span>`;
    }

    // 9. Info / custom node patterns
    if (esc.match(/\[ComfyUI-Manager\]|Starting server|Using RAM pressure|Import times/i)) {
      return `<span class="log-info">${esc}</span>`;
    }

    return esc;
  });

  return formatted.join("\n") + '<span class="shell-cursor">█</span>';
}

export function openShellModal() {
  if (activeModal) {
    activeModal.focus();
    return;
  }

  userCleared = false;
  autoScroll = true;
  isFullscreen = false;

  const backdrop = el("div", { class: "shell-backdrop", role: "dialog", "aria-modal": "true" });
  const dialog = el("div", { class: "shell-dialog", tabindex: "-1" });

  // 1. Title bar & Traffic Lights
  const closeDot = el("button", { class: "shell-traffic red", type: "button", title: "Close (Esc)", onclick: () => close() });
  const clearDot = el("button", { class: "shell-traffic yellow", type: "button", title: "Clear output", onclick: () => clearScreen() });
  const maxDot = el("button", { class: "shell-traffic green", type: "button", title: "Toggle Fullscreen", onclick: () => toggleFullscreen() });

  const statusBadge = el("span", { class: "shell-badge offline" }, el("span", { class: "dot" }), "CONNECTING...");
  const vramBadge = el("span", { class: "shell-badge opt-hide" }, icon("chip"), "VRAM: …");
  const safeBadge = el("span", { class: "shell-badge opt-hide" }, icon("shield"), "SAFE: --");
  const queueBadge = el("span", { class: "shell-badge" }, icon("clock"), "Queue: 0");

  const autoScrollBtn = el("button", {
    class: "shell-tool-btn active",
    type: "button",
    title: "Toggle Auto-scroll to bottom",
    onclick: () => {
      autoScroll = !autoScroll;
      autoScrollBtn.classList.toggle("active", autoScroll);
      autoScrollBtn.textContent = autoScroll ? "Scroll: ON" : "Scroll: PAUSED";
      if (autoScroll) scrollToBottom(true);
    }
  }, "Scroll: ON");

  const freeVramBtn = el("button", {
    class: "shell-tool-btn",
    type: "button",
    title: "Unload models and free GPU memory",
    onclick: async () => {
      try {
        freeVramBtn.disabled = true;
        freeVramBtn.textContent = "Freeing…";
        const res = await api("/api/comfy/free", { method: "POST" });
        toast(res.ok ? "GPU VRAM cleared & models unloaded" : "ComfyUI could not free memory");
      } catch (err) {
        toast(err.message, { error: true });
      } finally {
        freeVramBtn.disabled = false;
        freeVramBtn.textContent = "Free VRAM";
      }
    }
  }, icon("chip"), "Free VRAM");

  const copyBtn = el("button", {
    class: "shell-tool-btn",
    type: "button",
    title: "Copy terminal text",
    onclick: () => {
      const text = logPre.textContent;
      navigator.clipboard.writeText(text).then(
        () => toast("Terminal logs copied to clipboard"),
        () => toast("Failed to copy logs", { error: true })
      );
    }
  }, icon("copy"), "Copy");

  const closeBtn = el("button", { class: "shell-close-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("x"));

  const header = el("div", { class: "shell-head" },
    el("div", { class: "shell-head-left" },
      el("div", { class: "shell-traffic-group" }, closeDot, clearDot, maxDot),
      el("span", { class: "shell-title" }, icon("shell"), "ComfyUI Terminal")
    ),
    el("div", { class: "shell-head-center" }, statusBadge, vramBadge, safeBadge, queueBadge),
    el("div", { class: "shell-head-right" }, autoScrollBtn, freeVramBtn, copyBtn, closeBtn)
  );

  // 2. Execution Status Strip (if running)
  const execStrip = el("div", { class: "shell-exec-strip", style: { display: "none" } },
    el("span", { class: "shell-exec-spin" }),
    el("span", { class: "shell-exec-text" }, "Executing workflow…"),
    el("div", { class: "shell-exec-bar" }, el("div", { class: "shell-exec-fill" }))
  );

  // 3. Log Terminal Body
  const logPre = el("pre", { class: "shell-log" });
  const termBody = el("div", { class: "shell-body" },
    el("div", { class: "shell-prompt-banner" },
      el("span", { class: "prompt-user" }, "wox@cinema-studio-pro"),
      el("span", { class: "prompt-col" }, ":"),
      el("span", { class: "prompt-path" }, "~/ComfyUI"),
      el("span", { class: "prompt-sym" }, "$ "),
      el("span", { class: "prompt-cmd" }, "./main.py --listen 127.0.0.1 --port 8188")
    ),
    logPre
  );

  termBody.addEventListener("scroll", () => {
    const atBottom = termBody.scrollHeight - termBody.scrollTop - termBody.clientHeight < 30;
    if (!atBottom && autoScroll) {
      autoScroll = false;
      autoScrollBtn.classList.remove("active");
      autoScrollBtn.textContent = "Scroll: PAUSED";
    } else if (atBottom && !autoScroll) {
      autoScroll = true;
      autoScrollBtn.classList.add("active");
      autoScrollBtn.textContent = "Scroll: ON";
    }
  });

  // 4. Footer
  const footerInfo = el("span", { class: "shell-foot-info" }, "Log: --");
  const footerHint = el("span", { class: "shell-foot-hint" }, "Esc to close · Click backdrop to dismiss");
  const footer = el("div", { class: "shell-foot" }, footerInfo, footerHint);

  dialog.append(header, execStrip, termBody, footer);
  backdrop.append(dialog);

  function scrollToBottom(smooth = false) {
    if (smooth) {
      termBody.scrollTo({ top: termBody.scrollHeight, behavior: "smooth" });
    } else {
      termBody.scrollTop = termBody.scrollHeight;
    }
  }

  function clearScreen() {
    userCleared = true;
    logPre.innerHTML = '<span class="log-dim">// Console cleared by user</span>';
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    dialog.classList.toggle("is-fullscreen", isFullscreen);
    scrollToBottom(false);
  }

  function close() {
    clearTimeout(pollTimer);
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
    activeModal = null;
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener("keydown", onKeyDown);
  document.body.append(backdrop);
  dialog.focus();
  activeModal = dialog;

  // Real-time polling function
  async function poll() {
    clearTimeout(pollTimer);
    let data = null;
    try {
      data = await api("/api/comfy/shell");
      if (!data || !activeModal) return;

      // Status badge
      if (data.connected) {
        statusBadge.className = "shell-badge online";
        statusBadge.replaceChildren(el("span", { class: "dot" }), "ONLINE :8188");
      } else {
        statusBadge.className = "shell-badge offline";
        statusBadge.replaceChildren(el("span", { class: "dot" }), "OFFLINE");
      }

      // VRAM badge
      const dev = data.devices?.[0];
      if (dev && dev.vram_total) {
        const totalGb = (dev.vram_total / 2 ** 30).toFixed(1);
        const freeGb = (dev.vram_free / 2 ** 30).toFixed(1);
        const usedGb = ((dev.vram_total - dev.vram_free) / 2 ** 30).toFixed(1);
        vramBadge.replaceChildren(icon("chip"), `${dev.name?.split(" : ")[0] || "GPU"}: ${usedGb} / ${totalGb} GB`);
        vramBadge.style.display = "inline-flex";
      }

      // SafeMode status badge
      if (data.safe?.enabled && data.safe.current_temp !== null) {
        const tVal = Math.round(data.safe.current_temp);
        if (data.safe.throttled) {
          safeBadge.className = "shell-badge safe-paused";
          safeBadge.replaceChildren(icon("shield"), `SAFE: PAUSED (${tVal}°C)`);
        } else {
          safeBadge.className = "shell-badge safe-ok";
          safeBadge.replaceChildren(icon("shield"), `SAFE: ${tVal}°C`);
        }
        safeBadge.style.display = "inline-flex";
      } else {
        safeBadge.style.display = "none";
      }

      // Queue & active execution strip
      const qRunning = data.queue?.queue_running?.length || 0;
      const qPending = data.queue?.queue_pending?.length || 0;
      const runningCount = data.running_count || qRunning;

      queueBadge.replaceChildren(icon("clock"), `Queue: ${runningCount} active, ${qPending} waiting`);

      if (runningCount > 0 || data.active_job) {
        const appName = data.active_job?.app || "workflow";
        const progress = data.active_job?.progress;
        let progressTxt = `Running: ${appName}`;
        if (progress?.step && progress?.total) {
          progressTxt += ` · step ${progress.step}/${progress.total}`;
        }
        execStrip.querySelector(".shell-exec-text").textContent = progressTxt;
        const fill = execStrip.querySelector(".shell-exec-fill");
        if (progress?.step && progress?.total) {
          const pct = Math.min(100, Math.round((progress.step / progress.total) * 100));
          fill.style.width = `${pct}%`;
        } else {
          fill.style.width = "60%";
        }
        execStrip.style.display = "flex";
      } else {
        execStrip.style.display = "none";
      }

      // Footer info
      if (data.log_path) {
        const base = data.log_path.split("/").pop();
        footerInfo.textContent = `Log source: ${base} (${data.logs?.length || 0} bytes)`;
      }

      // Update terminal text if not user-cleared
      if (!userCleared && data.logs) {
        const wasAtBottom = termBody.scrollHeight - termBody.scrollTop - termBody.clientHeight < 40;
        logPre.innerHTML = formatLogs(data.logs);
        if (autoScroll || wasAtBottom) {
          scrollToBottom(false);
        }
      }
    } catch {
      statusBadge.className = "shell-badge offline";
      statusBadge.replaceChildren(el("span", { class: "dot" }), "CONNECT ERROR");
    } finally {
      if (activeModal) {
        const isBusy = Boolean(data?.active_job || data?.running_count > 0 || data?.safe?.throttled);
        pollTimer = setTimeout(poll, isBusy ? 700 : 1300);
      }
    }
  }

  poll();
}

/** Creates the shell button for the navbar */
export function createShellBtn() {
  const dot = el("span", { class: "shell-dot" });
  const label = el("span", { class: "lbl-long" }, "Shell");
  const btn = el("button", {
    class: "shell-btn",
    type: "button",
    title: "ComfyUI Terminal / Live Console",
    "aria-label": "ComfyUI Terminal",
    onclick: () => {
      if (activeModal) {
        const bd = document.querySelector(".shell-backdrop");
        bd?.remove();
        activeModal = null;
      } else {
        openShellModal();
      }
    }
  }, icon("shell"), label, dot);

  // Update busy status from GPU / run state
  const updateState = (g) => {
    const isBusy = Boolean(g?.running || g?.waking);
    btn.classList.toggle("busy", isBusy);
    if (isBusy) {
      btn.title = `ComfyUI Terminal (${g.running} active job${g.running > 1 ? "s" : ""})`;
    } else {
      btn.title = "ComfyUI Terminal / Live Console";
    }
  };

  gpuState.listeners.add(updateState);
  updateState(gpuState.data);

  return btn;
}
