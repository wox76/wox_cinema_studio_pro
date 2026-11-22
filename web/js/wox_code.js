// Wox Code (#/code)
// Assistente AI di programmazione e agente autonomo 100% locale (stile Claude Code) alimentato da Bonsai 2.
import { el, icon, api, toast } from "./util.js";

function injectStyles() {
  if (document.getElementById("wox-code-css")) return;
  const css = `
.wc-shell { display: grid; grid-template-columns: 270px minmax(0, 1fr) auto; height: calc(100vh - 64px); background: #0e0f12; color: #e5e7eb; overflow: hidden; }
@media (max-width: 960px) { .wc-shell { grid-template-columns: 1fr; height: auto; min-height: calc(100vh - 64px); } }
.wc-side { background: #141519; border-right: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 10px; }
.wc-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px; }
.wc-brand h2 { margin: 0; font-size: 15.5px; font-weight: 800; letter-spacing: -0.02em; display: flex; align-items: center; gap: 7px; }
.wc-dot { width: 7px; height: 7px; border-radius: 50%; background: #64748b; display: inline-block; }
.wc-dot.ok { background: #4ade80; box-shadow: 0 0 8px rgba(74,222,128,0.6); }
.wc-dot.off { background: #f59e0b; }
.wc-new-btn { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.wc-new-btn:hover { background: rgba(232,255,90,0.14); border-color: rgba(232,255,90,0.45); color: #e8ff5a; }
.wc-search { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.09); border-radius: 9px; padding: 7px 10px; color: inherit; font-size: 12.5px; }
.wc-search:focus { outline: none; border-color: rgba(232,255,90,0.45); }
.wc-sec-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; padding: 4px 4px 0; }
.wc-sec-btn { background: transparent; border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1; border-radius: 6px; padding: 2px 7px; font-size: 11px; cursor: pointer; }
.wc-sec-btn:hover { border-color: #e8ff5a; color: #e8ff5a; }
.wc-list { display: flex; flex-direction: column; gap: 3px; overflow-y: auto; min-height: 0; }
.wc-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 9px; border-radius: 8px; cursor: pointer; font-size: 12.5px; color: #cbd5e1; border: 1px solid transparent; transition: all 0.12s; }
.wc-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
.wc-item.active { background: rgba(232,255,90,0.11); border-color: rgba(232,255,90,0.3); color: #fff; font-weight: 600; }
.wc-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.wc-item-del { opacity: 0; background: transparent; border: 0; color: #ff5c72; cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 5px; }
.wc-item:hover .wc-item-del { opacity: 0.85; }
.wc-item-del:hover { opacity: 1 !important; background: rgba(255,92,114,0.15); }

.wc-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #101114; }
.wc-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 18px; border-bottom: 1px solid rgba(255,255,255,0.07); background: rgba(20,21,25,0.7); }
.wc-proj-pill { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: #fff; }
.wc-proj-path { font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wc-messages { flex: 1; overflow-y: auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 18px; }
.wc-empty { margin: auto; max-width: 680px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; padding: 24px 12px; }
.wc-greeting { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; color: #f8fafc; display: flex; align-items: center; gap: 12px; margin: 0; }
.wc-spark { color: #f97316; font-size: 28px; }
.wc-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.wc-chip { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; border-radius: 99px; padding: 7px 13px; font-size: 12.5px; cursor: pointer; transition: all 0.15s; }
.wc-chip:hover { border-color: #e8ff5a; color: #fff; background: rgba(232,255,90,0.09); }

.wc-msg { max-width: 820px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
.wc-msg.user { align-items: flex-end; }
.wc-bubble-user { background: #23252c; border: 1px solid rgba(255,255,255,0.1); color: #f8fafc; border-radius: 16px 16px 4px 16px; padding: 11px 15px; font-size: 14px; line-height: 1.5; max-width: 85%; white-space: pre-wrap; word-break: break-word; }
.wc-bubble-ai { color: #e5e7eb; font-size: 14px; line-height: 1.62; word-break: break-word; }
.wc-bubble-ai p { margin: 0 0 10px; }
.wc-bubble-ai p:last-child { margin-bottom: 0; }
.wc-bubble-ai pre { background: #090a0d; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px 14px; overflow-x: auto; font-size: 12.5px; line-height: 1.5; position: relative; margin: 10px 0; }
.wc-bubble-ai code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 5px; }
.wc-bubble-ai pre code { background: transparent; padding: 0; }
.wc-copy-btn { position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #cbd5e1; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
.wc-copy-btn:hover { border-color: #e8ff5a; color: #e8ff5a; }

.wc-tools { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.wc-tool-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; overflow: hidden; font-size: 12px; }
.wc-tool-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 11px; cursor: pointer; color: #cbd5e1; }
.wc-tool-head:hover { background: rgba(255,255,255,0.03); }
.wc-tool-out { border-top: 1px solid rgba(255,255,255,0.07); padding: 9px 11px; background: #090a0d; font-family: ui-monospace, monospace; font-size: 11.5px; color: #94a3b8; max-height: 220px; overflow: auto; white-space: pre-wrap; display: none; }
.wc-tool-card.open .wc-tool-out { display: block; }

.wc-composer-wrap { padding: 12px 20px 18px; max-width: 860px; width: 100%; margin: 0 auto; }
.wc-composer { background: #1a1b20; border: 1px solid rgba(255,255,255,0.13); border-radius: 16px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 12px 36px rgba(0,0,0,0.35); }
.wc-composer:focus-within { border-color: rgba(232,255,90,0.45); }
.wc-attached { display: flex; flex-wrap: wrap; gap: 6px; }
.wc-att-pill { display: inline-flex; align-items: center; gap: 5px; background: rgba(232,255,90,0.12); border: 1px solid rgba(232,255,90,0.3); color: #e8ff5a; border-radius: 8px; padding: 3px 8px; font-size: 11.5px; font-family: ui-monospace, monospace; }
.wc-input { width: 100%; min-height: 44px; max-height: 180px; resize: none; background: transparent; border: 0; color: #f8fafc; font: inherit; font-size: 14px; line-height: 1.45; outline: none; }
.wc-comp-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.wc-comp-left, .wc-comp-right { display: flex; align-items: center; gap: 6px; }
.wc-mode-btn { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
.wc-mode-btn.active { background: rgba(255,255,255,0.1); border-color: rgba(232,255,90,0.4); color: #e8ff5a; }

.wc-files-pane { width: 270px; background: #141519; border-left: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 10px; }
.wc-files-pane.hidden { display: none; }
.wc-file-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 7px; font-size: 12px; font-family: ui-monospace, monospace; color: #cbd5e1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wc-file-row:hover { background: rgba(255,255,255,0.06); color: #fff; }
.wc-modal-bg { position: fixed; inset: 0; z-index: 9999; background: rgba(5,6,10,0.82); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 20px; }
.wc-modal-box { width: min(560px, 94vw); max-height: 85vh; background: #14161d; border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
.wc-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.wc-model-wrap { position: relative; display: inline-flex; align-items: center; }
.wc-model-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); color: #cbd5e1; font-size: 11.5px; font-weight: 500; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.wc-model-btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); color: #f8fafc; }
.wc-model-menu { position: absolute; right: 0; bottom: calc(100% + 8px); min-width: 225px; background: #161922; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 5px; box-shadow: 0 14px 36px rgba(0,0,0,0.55); z-index: 60; display: none; flex-direction: column; gap: 3px; }
.wc-model-menu.open { display: flex; }
.wc-model-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 12.5px; font-weight: 600; transition: background 0.12s, border-color 0.12s; }
.wc-model-opt:hover { background: rgba(255,255,255,0.07); }
.wc-model-opt.active { background: rgba(234,179,8,0.14); border-color: rgba(234,179,8,0.38); color: #fef08a; }
.wc-model-opt-sub { font-size: 11px; font-weight: 400; color: #94a3b8; }
`;
  document.head.appendChild(el("style", { id: "wox-code-css" }, css));
}

function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text || "").split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```")) {
      const inner = part.slice(3, -3);
      const nl = inner.indexOf("\n");
      const code = nl >= 0 ? inner.slice(nl + 1) : inner;
      const copyBtn = el("button", {
        class: "wc-copy-btn",
        type: "button",
        onclick: () => {
          navigator.clipboard?.writeText(code);
          copyBtn.textContent = "✓ Copiato";
          setTimeout(() => { copyBtn.textContent = "Copia"; }, 1400);
        },
      }, "Copia");
      frag.appendChild(el("pre", {}, copyBtn, el("code", {}, code)));
    } else {
      const paras = part.trim().split(/\n{2,}/);
      for (const p of paras) {
        if (!p.trim()) continue;
        const pEl = el("p", {});
        const tokens = p.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
        for (const t of tokens) {
          if (t.startsWith("`") && t.endsWith("`")) {
            pEl.appendChild(el("code", {}, t.slice(1, -1)));
          } else if (t.startsWith("**") && t.endsWith("**")) {
            pEl.appendChild(el("strong", {}, t.slice(2, -2)));
          } else {
            pEl.appendChild(document.createTextNode(t));
          }
        }
        frag.appendChild(pEl);
      }
    }
  }
  return frag;
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return "Buongiorno, Wox";
  if (h < 18) return "Buon pomeriggio, Wox";
  return "Buonasera, Wox";
}

export function woxCodeView() {
  injectStyles();

  let statusData = null;
  let projects = [];
  let chats = [];
  let projectFiles = [];
  let activeProjectId = null;
  let activeChatId = null;
  let activeChat = null;
  let mode = "agent"; // agent | chat
  let reasoningEffort = localStorage.getItem("wox_code_reasoning") || "medium"; // low | medium | high
  if (!["low", "medium", "high"].includes(reasoningEffort)) reasoningEffort = "medium";
  let searchQuery = "";
  let showFilesPane = true;
  let attachedFiles = [];
  let pollTimer = null;
  let disposed = false;

  const statusPill = el("div", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#94a3b8" } });
  const searchInput = el("input", {
    class: "wc-search",
    type: "search",
    placeholder: "Cerca chat...",
    oninput: (e) => { searchQuery = e.target.value.toLowerCase(); renderSidebar(); },
  });
  const projectsListEl = el("div", { class: "wc-list", style: { maxHeight: "34%" } });
  const chatsListEl = el("div", { class: "wc-list", style: { flex: "1" } });

  const topbarLeft = el("div", { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } });
  const topbarRight = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  const messagesEl = el("div", { class: "wc-messages" });
  const attachedBar = el("div", { class: "wc-attached" });
  const inputEl = el("textarea", {
    class: "wc-input",
    placeholder: "Chiedi a Wox Code di creare codice, modificare file, riassumere documenti o eseguire comandi...",
    rows: "2",
  });
  const filesListEl = el("div", { class: "wc-list", style: { flex: "1" } });
  const filesPane = el("aside", { class: "wc-files-pane" },
    el("div", { class: "wc-sec-head" },
      el("span", {}, "File Progetto"),
      el("button", { class: "wc-sec-btn", type: "button", onclick: () => refreshFiles() }, "↻")
    ),
    filesListEl
  );

  function openNewProjectModal() {
    const nameIn = el("input", { class: "wc-search", placeholder: "Es. Mio Sito Web, Videogioco 2D, Tool Python...", style: { padding: "9px 11px", fontSize: "13px" } });
    const tplEl = el("select", { class: "wc-search", style: { padding: "9px 11px", fontSize: "13px" } },
      el("option", { value: "web" }, "Web / Videogioco (index.html, css/style.css, js/main.js)"),
      el("option", { value: "python" }, "Python (main.py, src/utils.py, requirements.txt)"),
      el("option", { value: "c" }, "C (src/main.c, include/app.h, Makefile)"),
      el("option", { value: "empty" }, "Cartella vuota (crea i file via chat)"),
    );
    const pathIn = el("input", { class: "wc-search", placeholder: "(Opzionale) Percorso cartella locale esistente, es. /home/wox76/progetto", style: { padding: "9px 11px", fontSize: "12.5px" } });
    const close = () => overlay.remove();
    const create = async () => {
      const name = nameIn.value.trim();
      if (!name) { toast("Inserisci un nome per il progetto.", { error: true }); return; }
      try {
        const proj = await api("/api/code/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, path: pathIn.value.trim() || undefined, template: tplEl.value }),
        });
        projects.unshift(proj);
        activeProjectId = proj.id;
        activeChatId = null;
        activeChat = null;
        attachedFiles = [];
        close();
        renderSidebar();
        renderTopbar();
        renderMessages();
        await refreshFiles();
        toast(`Progetto "${proj.name}" creato!`);
      } catch (err) {
        toast(err.message || "Errore creazione progetto", { error: true });
      }
    };
    const overlay = el("div", { class: "wc-modal-bg", onclick: (e) => { if (e.target === overlay) close(); } },
      el("div", { class: "wc-modal-box" },
        el("div", { class: "wc-modal-head" },
          el("strong", {}, "Nuovo Progetto · Wox Code"),
          el("button", { class: "btn small ghost", type: "button", onclick: close }, "✕")
        ),
        el("div", { style: { padding: "18px", display: "flex", flexDirection: "column", gap: "12px" } },
          el("label", { style: { fontSize: "12px", color: "#94a3b8", fontWeight: "600" } }, "Nome Progetto"),
          nameIn,
          el("label", { style: { fontSize: "12px", color: "#94a3b8", fontWeight: "600" } }, "Struttura File Iniziale"),
          tplEl,
          el("label", { style: { fontSize: "12px", color: "#94a3b8", fontWeight: "600" } }, "Cartella Locale (opzionale)"),
          pathIn,
          el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" } },
            el("button", { class: "btn small ghost", type: "button", onclick: close }, "Annulla"),
            el("button", { class: "btn small lime", type: "button", onclick: create }, "Crea Progetto")
          )
        )
      )
    );
    document.body.appendChild(overlay);
    nameIn.focus();
  }

  async function openFilePreview(relPath) {
    if (!activeProjectId) return;
    try {
      const data = await api(`/api/code/projects/${encodeURIComponent(activeProjectId)}/file?path=${encodeURIComponent(relPath)}`);
      const close = () => overlay.remove();
      const overlay = el("div", { class: "wc-modal-bg", onclick: (e) => { if (e.target === overlay) close(); } },
        el("div", { class: "wc-modal-box", style: { width: "min(760px, 94vw)" } },
          el("div", { class: "wc-modal-head" },
            el("strong", { style: { fontFamily: "ui-monospace, monospace", fontSize: "13px" } }, data.path),
            el("div", { style: { display: "flex", gap: "6px" } },
              el("button", {
                class: "btn small lime",
                type: "button",
                onclick: () => {
                  if (!attachedFiles.includes(relPath)) attachedFiles.push(relPath);
                  renderAttached();
                  inputEl.value = `Riassumi il file ${relPath} spiegando i punti principali.`;
                  close();
                  inputEl.focus();
                },
              }, "Riassumi con Bonsai 2"),
              el("button", {
                class: "btn small ghost",
                type: "button",
                onclick: () => {
                  if (!attachedFiles.includes(relPath)) attachedFiles.push(relPath);
                  renderAttached();
                  close();
                  inputEl.focus();
                },
              }, "+ Allega"),
              el("button", { class: "btn small ghost", type: "button", onclick: close }, "✕")
            )
          ),
          el("pre", { style: { margin: "0", padding: "16px", overflow: "auto", fontSize: "12px", lineHeight: "1.5", color: "#cbd5e1", background: "#090a0d" } }, data.content)
        )
      );
      document.body.appendChild(overlay);
    } catch (err) {
      toast(err.message || "Impossibile leggere il file", { error: true });
    }
  }

  function renderStatus() {
    const ok = Boolean(statusData?.bonsai?.online);
    const nodes = [
      el("span", { class: `wc-dot ${ok ? "ok" : "off"}` }),
      el("span", {}, ok ? "Bonsai 2" : "Offline"),
    ];
    if (!ok) {
      const btn = el("button", {
        class: "wc-sec-btn",
        type: "button",
        onclick: async () => {
          btn.disabled = true;
          btn.textContent = "...";
          try {
            const res = await api("/api/code/bonsai/start", { method: "POST" });
            toast(res.message || "Avvio Bonsai 2...");
            await refreshStatus();
          } catch (err) {
            toast(err.message, { error: true });
          } finally {
            btn.disabled = false;
          }
        },
      }, "Avvia");
      nodes.push(btn);
    }
    statusPill.replaceChildren(...nodes);
  }

  function renderSidebar() {
    projectsListEl.replaceChildren(...projects.map((p) =>
      el("div", {
        class: `wc-item ${p.id === activeProjectId ? "active" : ""}`,
        onclick: async () => {
          activeProjectId = p.id;
          const firstChat = chats.find((c) => c.projectId === p.id);
          activeChatId = firstChat ? firstChat.id : null;
          activeChat = firstChat || null;
          attachedFiles = [];
          renderSidebar();
          renderTopbar();
          renderAttached();
          renderMessages();
          await refreshFiles();
        },
      },
        el("span", { class: "wc-item-label" }, `📁 ${p.name}`),
        projects.length > 1 ? el("button", {
          class: "wc-item-del",
          type: "button",
          title: "Rimuovi progetto",
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm(`Rimuovere il progetto "${p.name}" dalla lista?`)) return;
            await api(`/api/code/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
            projects = projects.filter((x) => x.id !== p.id);
            if (activeProjectId === p.id) activeProjectId = projects[0]?.id || null;
            renderSidebar();
            renderTopbar();
            await refreshFiles();
          },
        }, "✕") : null
      )
    ));

    const filteredChats = chats.filter((c) => {
      if (activeProjectId && c.projectId !== activeProjectId && !searchQuery) return false;
      if (searchQuery && !c.title.toLowerCase().includes(searchQuery)) return false;
      return true;
    });

    chatsListEl.replaceChildren(...filteredChats.map((c) =>
      el("div", {
        class: `wc-item ${c.id === activeChatId ? "active" : ""}`,
        onclick: async () => {
          activeChatId = c.id;
          activeProjectId = c.projectId;
          activeChat = await api(`/api/code/chats/${encodeURIComponent(c.id)}`);
          renderSidebar();
          renderTopbar();
          renderMessages();
          await refreshFiles();
        },
      },
        el("span", { class: "wc-item-label" }, `${c.running ? "⏳ " : ""}${c.title}`),
        el("button", {
          class: "wc-item-del",
          type: "button",
          title: "Elimina chat",
          onclick: async (e) => {
            e.stopPropagation();
            await api(`/api/code/chats/${encodeURIComponent(c.id)}`, { method: "DELETE" });
            chats = chats.filter((x) => x.id !== c.id);
            if (activeChatId === c.id) { activeChatId = null; activeChat = null; }
            renderSidebar();
            renderMessages();
            renderFiles();
            renderTopbar();
          },
        }, "✕")
      )
    ));
  }

  function normalizeRelPath(p) {
    return String(p || "").trim().replace(/^\.\/+/, "").replace(/^\/+/, "");
  }

  function getActiveChatFiles() {
    const paths = new Set();
    for (const f of attachedFiles) {
      const n = normalizeRelPath(f);
      if (n) paths.add(n);
    }
    if (activeChat) {
      for (const m of activeChat.messages || []) {
        for (const att of m.attachments || []) {
          const n = normalizeRelPath(att?.path);
          if (n) paths.add(n);
        }
        // Fallback for older chats with inline attachment markers
        if (m.role === "user" && typeof m.content === "string") {
          for (const match of m.content.matchAll(/(?:--- (?:FILE|PDF) ALLEGATO:|\[IMMAGINE ALLEGATA:)\s*([^\]\n-]+?)(?:\s*---|\])/g)) {
            const n = normalizeRelPath(match[1]);
            if (n) paths.add(n);
          }
        }
        for (const tc of m.toolCalls || []) {
          const n = normalizeRelPath(tc?.args?.path);
          if (!n) continue;
          if (tc.tool === "write_file" || tc.tool === "edit_file") paths.add(n);
          else if (tc.tool === "delete_file") paths.delete(n);
        }
      }
      for (const tc of activeChat.liveTools || []) {
        const n = normalizeRelPath(tc?.args?.path);
        if (!n) continue;
        if (tc.tool === "write_file" || tc.tool === "edit_file") paths.add(n);
        else if (tc.tool === "delete_file") paths.delete(n);
      }
    }
    return projectFiles.filter((f) => !f.isDir && paths.has(normalizeRelPath(f.path)));
  }

  function findPreviewHtmlFile() {
    const chatFiles = getActiveChatFiles();
    const htmls = chatFiles.filter((f) => /\.html?$/i.test(f.path));
    if (!htmls.length) return null;
    const idx = htmls.find((f) => f.path.toLowerCase() === "index.html") || htmls.find((f) => f.path.toLowerCase().endsWith("/index.html"));
    return (idx || htmls[0]).path;
  }

  function openPreviewModal(htmlPath) {
    if (!activeProjectId || !htmlPath) return;
    const url = `/api/code/projects/${encodeURIComponent(activeProjectId)}/preview/${htmlPath.split("/").map(encodeURIComponent).join("/")}`;
    const iframe = el("iframe", {
      src: `${url}?t=${Date.now()}`,
      style: { width: "100%", flex: "1", border: "0", background: "#fff", minHeight: "520px" },
      allow: "fullscreen; autoplay",
      title: htmlPath,
    });
    const close = () => {
      overlay.remove();
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);

    const overlay = el("div", { class: "wc-modal-bg", onclick: (e) => { if (e.target === overlay) close(); } },
      el("div", { class: "wc-modal-box", style: { width: "min(1120px, 95vw)", height: "min(86vh, 820px)" } },
        el("div", { class: "wc-modal-head" },
          el("strong", { style: { fontFamily: "ui-monospace, monospace", fontSize: "13px" } }, `▶ Anteprima Live · ${htmlPath}`),
          el("div", { style: { display: "flex", gap: "6px" } },
            el("button", {
              class: "btn small ghost",
              type: "button",
              onclick: () => { iframe.src = `${url}?t=${Date.now()}`; },
            }, "↻ Ricarica"),
            el("a", {
              class: "btn small lime",
              href: url,
              target: "_blank",
              rel: "noopener",
            }, "↗ Nuova Scheda"),
            el("button", { class: "btn small ghost", type: "button", onclick: close }, "✕ Chiudi")
          )
        ),
        iframe
      )
    );
    document.body.appendChild(overlay);
  }

  function renderTopbar() {
    const proj = projects.find((p) => p.id === activeProjectId);
    const previewHtml = findPreviewHtmlFile();
    topbarLeft.replaceChildren(
      ...[
        el("div", { class: "wc-proj-pill" }, proj ? `📁 ${proj.name}` : "Wox Code"),
        proj ? el("div", { class: "wc-proj-path", title: proj.path }, proj.path) : null,
      ].filter(Boolean)
    );
    const rightBtns = [];
    if (previewHtml) {
      rightBtns.push(
        el("button", {
          class: "btn small lime",
          type: "button",
          onclick: () => openPreviewModal(previewHtml),
        }, "▶ Anteprima Live")
      );
    }
    if (proj) {
      rightBtns.push(
        el("button", {
          class: "btn small ghost",
          type: "button",
          title: `Apri ${proj.path} nel file manager`,
          onclick: async () => {
            try {
              await api(`/api/code/projects/${encodeURIComponent(proj.id)}/open-folder`, { method: "POST" });
            } catch (err) {
              toast(err.message || "Impossibile aprire la cartella", { error: true });
            }
          },
        }, "📂 Apri Cartella")
      );
    }
    rightBtns.push(
      el("button", {
        class: "btn small ghost",
        type: "button",
        onclick: () => {
          showFilesPane = !showFilesPane;
          filesPane.classList.toggle("hidden", !showFilesPane);
          renderTopbar();
        },
      }, showFilesPane ? "Nascondi File" : "Mostra File")
    );
    topbarRight.replaceChildren(...rightBtns);
  }

  function renderFiles() {
    const visibleFiles = getActiveChatFiles();
    if (!visibleFiles.length) {
      filesListEl.replaceChildren(
        el(
          "div",
          { style: { fontSize: "12px", color: "#64748b", padding: "8px 4px" } },
          activeChat
            ? "Nessun file in questa chat. Carica file con + File o chiedi a Wox Code di crearne!"
            : "Seleziona una chat o avvia una nuova attività per vedere i relativi file."
        )
      );
      return;
    }
    filesListEl.replaceChildren(...visibleFiles.map((f) =>
      el("div", {
        class: "wc-file-row",
        title: f.path,
        onclick: () => { if (!f.isDir) void openFilePreview(f.path); },
      }, `📄 ${f.path}`)
    ));
  }

  function renderAttached() {
    attachedBar.replaceChildren(...attachedFiles.map((f) =>
      el("span", { class: "wc-att-pill" },
        `📄 ${f}`,
        el("button", {
          type: "button",
          style: { background: "transparent", border: 0, color: "inherit", cursor: "pointer", padding: "0 2px" },
          onclick: () => { attachedFiles = attachedFiles.filter((x) => x !== f); renderAttached(); },
        }, "✕")
      )
    ));
  }

  function renderMessages() {
    if (!activeChat || !activeChat.messages?.length) {
      const quickPrompts = [
        "Crea una web app HTML/CSS/JS completa di una calcolatrice moderna",
        "Elenca tutti i file del progetto e spiegami la struttura",
        "Crea uno script Python per analizzare e riassumere file di testo",
        "Crea un mini gioco Snake in HTML5 Canvas pronto da aprire",
      ];
      messagesEl.replaceChildren(
        el("div", { class: "wc-empty" },
          el("h1", { class: "wc-greeting" }, el("span", { class: "wc-spark" }, "✦"), greetingText()),
          el("p", { style: { margin: "0", fontSize: "13.5px", color: "#94a3b8", maxWidth: "520px" } },
            "Agente di programmazione 100% locale con Bonsai 2. Crea file, modifica codice, riassumi documenti ed esegui comandi direttamente nel tuo progetto."
          ),
          el("div", { class: "wc-chips" }, ...quickPrompts.map((q) =>
            el("button", {
              class: "wc-chip",
              type: "button",
              onclick: () => { inputEl.value = q; inputEl.focus(); },
            }, q)
          ))
        )
      );
      return;
    }

    const nodes = activeChat.messages.map((m) => {
      if (m.role === "user") {
        return el("div", { class: "wc-msg user" }, el("div", { class: "wc-bubble-user" }, m.content));
      }
      const toolsNode = m.toolCalls?.length ? el("div", { class: "wc-tools" }, ...m.toolCalls.map((tc) => {
        const card = el("div", { class: "wc-tool-card" },
          el("div", {
            class: "wc-tool-head",
            onclick: () => card.classList.toggle("open"),
          },
            el("span", {}, `${tc.status === "done" ? "✓" : tc.status === "error" ? "✕" : "⏳"} ${tc.summary || tc.tool}`),
            el("span", { style: { fontSize: "10.5px", color: "#64748b", fontFamily: "ui-monospace, monospace" } }, tc.tool)
          ),
          el("div", { class: "wc-tool-out" }, tc.output || "(nessun output)")
        );
        return card;
      })) : null;
      const body = el("div", { class: "wc-bubble-ai" });
      body.appendChild(renderMarkdown(m.content));
      return el("div", { class: "wc-msg assistant" }, toolsNode, body);
    });

    if (activeChat.running) {
      const liveToolsNode = activeChat.liveTools?.length ? el("div", { class: "wc-tools" }, ...activeChat.liveTools.map((tc) => {
        const card = el("div", { class: "wc-tool-card" },
          el("div", {
            class: "wc-tool-head",
            onclick: () => card.classList.toggle("open"),
          },
            el("span", {}, `${tc.status === "done" ? "✓" : tc.status === "error" ? "✕" : "⏳"} ${tc.summary || tc.tool}`),
            el("span", { style: { fontSize: "10.5px", color: "#64748b", fontFamily: "ui-monospace, monospace" } }, tc.tool)
          ),
          el("div", { class: "wc-tool-out" }, tc.output || "(in esecuzione...)")
        );
        return card;
      })) : null;

      const liveLogEl = el("div", {
        style: {
          background: "#07080b",
          border: "1px solid rgba(232,255,90,0.28)",
          borderRadius: "12px",
          padding: "12px 14px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
          lineHeight: "1.55",
          color: "#e8ff5a",
          maxHeight: "220px",
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
      }, activeChat.liveText || activeChat.liveStatus || "Connessione a Bonsai 2...");

      nodes.push(
        el("div", { class: "wc-msg assistant" },
          liveToolsNode,
          el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11.5px", color: "#e8ff5a", fontWeight: "700" } },
            el("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
              el("span", { class: "wc-dot ok" }),
              activeChat.liveStatus || "Bonsai 2 Live Output"
            ),
            el("span", { style: { opacity: "0.75", fontFamily: "ui-monospace, monospace" } }, "LIVE STREAM")
          ),
          liveLogEl
        )
      );
      requestAnimationFrame(() => {
        liveLogEl.scrollTop = liveLogEl.scrollHeight;
      });
    }

    messagesEl.replaceChildren(...nodes);
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  }

  const agentModeBtn = el("button", {
    class: "wc-mode-btn active",
    type: "button",
    onclick: () => { mode = "agent"; agentModeBtn.classList.add("active"); chatModeBtn.classList.remove("active"); },
  }, "⚡ Agent (Autonomo)");
  const chatModeBtn = el("button", {
    class: "wc-mode-btn",
    type: "button",
    onclick: () => { mode = "chat"; chatModeBtn.classList.add("active"); agentModeBtn.classList.remove("active"); },
  }, "💬 Chat");

  const sendBtn = el("button", {
    class: "btn small lime",
    type: "button",
    style: { fontWeight: "800", height: "32px", padding: "0 14px" },
  }, "Invia ↑");

  function updateSendButton() {
    if (activeChat?.running) {
      sendBtn.textContent = "⏹ Stop";
      sendBtn.className = "btn small ghost danger";
    } else {
      sendBtn.textContent = "Invia ↑";
      sendBtn.className = "btn small lime";
    }
  }

  async function handleSend() {
    if (activeChat?.running) {
      await api(`/api/code/chats/${encodeURIComponent(activeChat.id)}/stop`, { method: "POST" });
      await pollActiveChat();
      return;
    }
    const text = inputEl.value.trim();
    if (!text && !attachedFiles.length) return;
    try {
      if (!activeChatId) {
        const created = await api("/api/code/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: activeProjectId, mode }),
        });
        chats.unshift(created);
        activeChatId = created.id;
        activeChat = created;
      }
      inputEl.value = "";
      const toAttach = [...attachedFiles];
      attachedFiles = [];
      renderAttached();

      activeChat = await api(`/api/code/chats/${encodeURIComponent(activeChatId)}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, mode, reasoningEffort, attachedFiles: toAttach }),
      });
      const idx = chats.findIndex((c) => c.id === activeChat.id);
      if (idx >= 0) chats[idx] = activeChat;
      renderSidebar();
      renderMessages();
      updateSendButton();
      clearTimeout(pollTimer);
      pollTimer = setTimeout(pollActiveChat, 450);
    } catch (err) {
      toast(err.message || "Errore invio messaggio", { error: true });
    }
  }

  sendBtn.onclick = () => void handleSend();
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  });

  const REASONING_OPTIONS = [
    { id: "low", label: "Bonsai 2 - Low", sub: "Ragionamento rapido (~512 token)" },
    { id: "medium", label: "Bonsai 2 - Medium", sub: "Ragionamento bilanciato (~2048 token)" },
    { id: "high", label: "Bonsai 2 - High", sub: "Ragionamento approfondito (~4096 token)" },
  ];

  const modelMenu = el("div", { class: "wc-model-menu" });
  const modelBtn = el("button", {
    class: "wc-model-btn",
    type: "button",
    title: "Seleziona il livello di ragionamento di Bonsai 2",
    onclick: (e) => {
      e.stopPropagation();
      modelMenu.classList.toggle("open");
    },
  });

  function renderModelSelector() {
    const cur = REASONING_OPTIONS.find((o) => o.id === reasoningEffort) || REASONING_OPTIONS[1];
    modelBtn.textContent = `${cur.label} ▾`;
    modelMenu.replaceChildren(
      ...REASONING_OPTIONS.map((opt) =>
        el("button", {
          class: "wc-model-opt" + (opt.id === reasoningEffort ? " active" : ""),
          type: "button",
          onclick: (e) => {
            e.stopPropagation();
            reasoningEffort = opt.id;
            try { localStorage.setItem("wox_code_reasoning", reasoningEffort); } catch { /* ignore */ }
            modelMenu.classList.remove("open");
            renderModelSelector();
          },
        },
          el("span", {}, opt.label),
          el("span", { class: "wc-model-opt-sub" }, opt.sub)
        )
      )
    );
  }
  renderModelSelector();

  const onDocClick = () => modelMenu.classList.remove("open");
  document.addEventListener("click", onDocClick);

  const modelWrap = el("div", { class: "wc-model-wrap" }, modelBtn, modelMenu);

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`Impossibile leggere ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  const fileUploadInput = el("input", {
    type: "file",
    multiple: true,
    accept: "image/*,.pdf,.txt,.md,.json,.csv,.xml,.yaml,.yml,.html,.css,.js,.ts,.jsx,.tsx,.py,.c,.cpp,.h,.hpp,.sh,.sql,.log",
    style: { display: "none" },
    onchange: async (e) => {
      const selected = Array.from(e.target.files || []);
      e.target.value = "";
      if (!selected.length) return;
      if (!activeProjectId) {
        toast("Seleziona o crea prima un progetto.", { error: true });
        return;
      }
      try {
        const payloadFiles = [];
        for (const f of selected.slice(0, 20)) {
          const dataBase64 = await readFileAsBase64(f);
          payloadFiles.push({ name: f.name, mime: f.type || "", dataBase64 });
        }
        const res = await api(`/api/code/projects/${encodeURIComponent(activeProjectId)}/upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files: payloadFiles }),
        });
        const uploaded = res.uploaded || [];
        for (const u of uploaded) {
          if (u.path && !attachedFiles.includes(u.path)) {
            attachedFiles.push(u.path);
          }
        }
        renderAttached();
        await refreshFiles();
        toast(
          uploaded.length === 1
            ? `File aggiunto al progetto: ${uploaded[0].name}`
            : `${uploaded.length} file aggiunti al progetto e allegati!`
        );
      } catch (err) {
        toast(err.message || "Errore caricamento file", { error: true });
      }
    },
  });

  const composerWrap = el("div", { class: "wc-composer-wrap" },
    fileUploadInput,
    el("div", { class: "wc-composer" },
      attachedBar,
      inputEl,
      el("div", { class: "wc-comp-bar" },
        el("div", { class: "wc-comp-left" },
          agentModeBtn,
          chatModeBtn,
          el("button", {
            class: "wc-mode-btn",
            type: "button",
            title: "Carica uno o più file nel progetto (Immagini, PDF, Testo, Codice)",
            onclick: () => fileUploadInput.click(),
          }, "+ File")
        ),
        el("div", { class: "wc-comp-right" },
          modelWrap,
          sendBtn
        )
      )
    )
  );

  const sidebar = el("aside", { class: "wc-side" },
    el("div", { class: "wc-brand" },
      el("h2", {}, icon("spark"), "Wox Code"),
      statusPill
    ),
    el("button", {
      class: "wc-new-btn",
      type: "button",
      onclick: () => {
        activeChatId = null;
        activeChat = null;
        attachedFiles = [];
        renderSidebar();
        renderAttached();
        renderMessages();
        renderFiles();
        renderTopbar();
        updateSendButton();
        inputEl.focus();
      },
    }, "+ Nuova Chat"),
    searchInput,
    el("div", { class: "wc-sec-head" },
      el("span", {}, "Progetti"),
      el("button", { class: "wc-sec-btn", type: "button", onclick: openNewProjectModal }, "+ Nuovo")
    ),
    projectsListEl,
    el("div", { class: "wc-sec-head" }, el("span", {}, "Chat e attività")),
    chatsListEl
  );

  const mainPane = el("main", { class: "wc-main" },
    el("div", { class: "wc-topbar" }, topbarLeft, topbarRight),
    messagesEl,
    composerWrap
  );

  const root = el("div", { class: "wc-shell" }, sidebar, mainPane, filesPane);

  async function refreshStatus() {
    try {
      statusData = await api("/api/code/status");
      renderStatus();
    } catch { /* ignore */ }
  }

  async function refreshFiles() {
    if (!activeProjectId) { projectFiles = []; renderFiles(); renderTopbar(); return; }
    try {
      const res = await api(`/api/code/projects/${encodeURIComponent(activeProjectId)}/files`);
      projectFiles = res.files || [];
      renderFiles();
      renderTopbar();
    } catch { /* ignore */ }
  }

  async function pollActiveChat() {
    if (disposed || !activeChatId) return;
    try {
      const updated = await api(`/api/code/chats/${encodeURIComponent(activeChatId)}`);
      const wasRunning = Boolean(activeChat?.running);
      activeChat = updated;
      const idx = chats.findIndex((c) => c.id === updated.id);
      if (idx >= 0) chats[idx] = updated;
      renderSidebar();
      renderMessages();
      updateSendButton();
      if (wasRunning && !updated.running) {
        await refreshFiles();
        const lastMsg = updated.messages?.[updated.messages.length - 1];
        const touchedFiles = (lastMsg?.toolCalls || []).some((tc) => tc.status === "done" && (tc.tool === "write_file" || tc.tool === "edit_file"));
        const previewHtml = findPreviewHtmlFile();
        if (touchedFiles && previewHtml) {
          openPreviewModal(previewHtml);
        }
      }
      if (updated.running && !disposed) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(pollActiveChat, 450);
      }
    } catch { /* ignore */ }
  }

  async function init() {
    await refreshStatus();
    try {
      const [pRes, cRes] = await Promise.all([api("/api/code/projects"), api("/api/code/chats")]);
      projects = pRes.projects || [];
      chats = cRes.chats || [];
      if (!activeProjectId && projects.length) activeProjectId = projects[0].id;
      renderSidebar();
      renderTopbar();
      renderMessages();
      updateSendButton();
      await refreshFiles();
    } catch (err) {
      toast(err.message || "Errore caricamento Wox Code", { error: true });
    }
  }

  void init();

  return {
    node: root,
    active: "code",
    dispose() {
      disposed = true;
      clearTimeout(pollTimer);
      document.removeEventListener("click", onDocClick);
    },
  };
}
