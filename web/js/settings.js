// Wox Cinema Studio [PRO] — Options & Auto-Installer (Nodes + Models)
import { el, icon, api, toast, store } from "./util.js";
import { LANGS, lang, setLang } from "./i18n.js";
import { loadCatalog } from "./catalog.js";
import { pollGpu } from "./nav.js";
import { openShellModal } from "./shell.js";

let activeModal = null;
let pollTimer = null;
let currentTab = "installer"; // "installer" | "options"
let packFilter = "all";       // "all" | "essential" | "missing" | "installed"
const expandedPacks = new Set();
let headerDotEl = null;

export function createSettingsBtn({ onLang } = {}) {
  headerDotEl = el("span", { class: "settings-status-dot", style: { display: "none" } });
  const btn = el("button", {
    class: "icon-btn settings-gear-btn",
    type: "button",
    title: "Opzioni & Auto-Installer (Nodi e Modelli Wox Cinema Studio [PRO])",
    "aria-label": "Opzioni e Auto-Installer",
    onclick: () => openSettingsModal({ onLang })
  }, icon("gear"), headerDotEl);

  // Check status once in background to light up indicator if task is running or essential nodes missing
  api("/api/installer/status").then((st) => {
    updateGearIndicator(st);
  }).catch(() => {});

  return btn;
}

function updateGearIndicator(st) {
  if (!headerDotEl || !st) return;
  const running = st.task?.status === "running";
  const missingNodes = st.summary && !st.summary.nodes_ready;
  if (running) {
    headerDotEl.className = "settings-status-dot running";
    headerDotEl.style.display = "block";
  } else if (missingNodes) {
    headerDotEl.className = "settings-status-dot warn";
    headerDotEl.style.display = "block";
  } else {
    headerDotEl.style.display = "none";
  }
}

export function openSettingsModal({ onLang, tab } = {}) {
  if (tab) currentTab = tab;
  if (activeModal) {
    activeModal.focus();
    return;
  }

  let state = null;
  const backdrop = el("div", { class: "shell-backdrop wox-settings-backdrop", role: "dialog", "aria-modal": "true" });
  const dialog = el("div", { class: "shell-dialog wox-settings-dialog", tabindex: "-1" });

  const close = () => {
    clearTimeout(pollTimer);
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    activeModal = null;
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);

  // Header
  const tabInstallerBtn = el("button", {
    type: "button",
    class: `wox-set-tab ${currentTab === "installer" ? "active" : ""}`,
    onclick: () => { currentTab = "installer"; render(); }
  }, icon("download"), "Auto-Installer (Nodi & Modelli)");

  const tabOptionsBtn = el("button", {
    type: "button",
    class: `wox-set-tab ${currentTab === "options" ? "active" : ""}`,
    onclick: () => { currentTab = "options"; render(); }
  }, icon("gear"), "Opzioni & Sistema");

  const closeBtn = el("button", {
    class: "shell-close-btn",
    type: "button",
    title: "Chiudi (Esc)",
    onclick: close
  }, icon("x"));

  const header = el("div", { class: "shell-head wox-settings-head" },
    el("div", { class: "shell-head-left" },
      el("span", { class: "wox-settings-logo" }, icon("gear")),
      el("div", {},
        el("div", { class: "wox-settings-title" }, "Wox Cinema Studio [PRO] · Opzioni & Setup"),
        el("div", { class: "wox-settings-sub" }, "Auto-Installer nodi ComfyUI, modelli AI e configurazione studio")
      )
    ),
    el("div", { class: "wox-set-tabs" }, tabInstallerBtn, tabOptionsBtn),
    el("div", { class: "shell-head-right" }, closeBtn)
  );

  const body = el("div", { class: "wox-settings-body" },
    el("div", { class: "empty" }, "Caricamento stato nodi e modelli...")
  );

  const footerLeft = el("span", { class: "shell-foot-info" }, "Wox Cinema Studio [PRO]");
  const footerRight = el("span", { class: "shell-foot-hint" }, "Premi Esc per chiudere");
  const footer = el("div", { class: "shell-foot" }, footerLeft, footerRight);

  dialog.append(header, body, footer);
  backdrop.append(dialog);
  document.body.append(backdrop);
  dialog.focus();
  activeModal = dialog;

  async function startInstallerAction(payload, msg) {
    try {
      const res = await api("/api/installer/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (msg) toast(msg);
      if (state && res.task) state.task = res.task;
      render();
      schedulePoll(600);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function cancelCurrentTask() {
    try {
      await api("/api/installer/cancel", { method: "POST" });
      toast("Operazione interrotta");
      await refreshStatus();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  function renderTaskBox(task) {
    if (!task) return null;
    const isRunning = task.status === "running";
    const isOk = task.status === "completed";
    const isErr = task.status === "failed" || task.status === "canceled";

    const logPre = el("pre", { class: "wox-inst-log" }, (task.logs || []).slice(-80).join("\n") || "In attesa di output...");
    setTimeout(() => { logPre.scrollTop = logPre.scrollHeight; }, 10);

    return el("div", { class: `wox-inst-task-card ${task.status}` },
      el("div", { class: "wox-inst-task-head" },
        el("div", { class: "wox-inst-task-title" },
          isRunning ? el("span", { class: "shell-exec-spin" }) : icon(isOk ? "check" : "info"),
          el("b", {}, task.title),
          el("span", { class: `wox-badge ${isRunning ? "lime" : isOk ? "ok" : "err"}` },
            isRunning ? `${task.percent}%` : isOk ? "COMPLETATO" : task.status === "canceled" ? "ANNULLATO" : "ATTENZIONE")
        ),
        isRunning
          ? el("button", { class: "btn small danger", type: "button", onclick: cancelCurrentTask }, icon("stop"), "Interrompi")
          : null
      ),
      el("div", { class: "wox-inst-step" }, task.currentStep || ""),
      el("div", { class: "wox-inst-bar" },
        el("div", { class: "wox-inst-bar-fill", style: { width: `${Math.max(3, task.percent || 0)}%` } })
      ),
      isErr && task.error ? el("div", { class: "wox-inst-err-msg" }, task.error) : null,
      logPre
    );
  }

  function renderInstallerTab() {
    if (!state) return el("div", { class: "empty" }, "Caricamento...");
    const s = state.summary;
    const isRunning = state.task?.status === "running";

    // Hero Auto-Installer Card
    const heroCard = el("div", { class: "wox-inst-hero" },
      el("div", { class: "wox-inst-hero-top" },
        el("div", { class: "wox-inst-hero-info" },
          el("div", { class: "wox-inst-kicker" }, icon("bolt"), "AUTO-INSTALLER UFFICIALE"),
          el("h3", {}, "Prepara Wox Cinema Studio [PRO] con un clic"),
          el("p", {},
            "Installa e configura automaticamente tutti i Custom Nodes ComfyUI necessari (WOX Cinema Studio, ReferenceMultiLatent, LTXVideo, CrossViewWarp, ReActor, KJNodes, VHS), il proxy API e scarica i modelli AI mancanti nella cartella ComfyUI."
          )
        ),
        el("div", { class: "wox-inst-stats" },
          el("div", { class: `wox-stat-box ${s.nodes_ready ? "ok" : "warn"}` },
            el("span", { class: "lbl" }, "Nodi ComfyUI"),
            el("strong", {}, `${s.nodes_installed} / ${s.nodes_total}`),
            el("small", {}, s.nodes_ready ? "✓ Tutti installati" : `${s.nodes_total - s.nodes_installed} da installare`)
          ),
          el("div", { class: `wox-stat-box ${s.essential_models_installed === s.essential_models_total ? "ok" : ""}` },
            el("span", { class: "lbl" }, "Modelli Core [PRO]"),
            el("strong", {}, `${s.essential_models_installed} / ${s.essential_models_total}`),
            el("small", {}, s.essential_missing_gb > 0 ? `${s.essential_missing_gb} GB mancanti` : "✓ Core completi")
          ),
          el("div", { class: "wox-stat-box" },
            el("span", { class: "lbl" }, "Catalogo Totale"),
            el("strong", {}, `${s.all_models_installed} / ${s.all_models_total}`),
            el("small", {}, `${s.all_installed_gb} / ${s.all_total_gb} GB su disco`)
          )
        )
      ),
      el("div", { class: "wox-inst-hero-actions" },
        el("button", {
          class: "btn lime wox-cta-btn",
          type: "button",
          disabled: isRunning,
          onclick: () => startInstallerAction(
            { action: "install_all_starter" },
            "Avviato Auto-Installer Wox Cinema Studio [PRO] (Nodi + Modelli Core)!"
          )
        }, icon("bolt"), "Auto-Install Wox Cinema Studio [PRO] (Nodi + Modelli Core)"),
        el("button", {
          class: "btn ghost",
          type: "button",
          disabled: isRunning,
          onclick: () => startInstallerAction(
            { action: "install_nodes" },
            "Avviata installazione e verifica di tutti i Nodi ComfyUI!"
          )
        }, icon("layers"), s.nodes_ready ? "Verifica / Ripara Tutti i Nodi" : `Installa Tutti i Nodi (${s.nodes_total - s.nodes_installed} mancanti)`),
        el("button", {
          class: "btn ghost",
          type: "button",
          disabled: isRunning,
          onclick: () => startInstallerAction(
            { action: "install_all_everything" },
            "Avviata installazione completa di tutti i Nodi e di tutti i Pack Modelli!"
          )
        }, icon("download"), `Installa Tutto il Catalogo (${s.all_missing_gb} GB mancanti)`)
      )
    );

    // Custom Nodes Section
    const nodesGrid = el("div", { class: "wox-nodes-grid" },
      ...state.nodes.map((n) => el("div", { class: `wox-node-card ${n.installed ? "installed" : "missing"}` },
        el("div", { class: "wox-node-head" },
          el("div", { class: "wox-node-title" },
            el("span", { class: `wox-status-dot ${n.installed ? "ok" : "warn"}` }),
            el("b", {}, n.name),
            n.essential ? el("span", { class: "wox-badge core" }, "RICHIESTO") : null
          ),
          el("div", { class: "wox-node-act" },
            el("span", { class: `wox-badge ${n.installed ? "ok" : "warn"}` }, n.installed ? "✓ Installato" : "✗ Mancante"),
            el("button", {
              class: `btn small ${n.installed ? "ghost" : "lime"}`,
              type: "button",
              disabled: isRunning,
              onclick: () => startInstallerAction({ action: "install_nodes", nodes: [n.id] }, `Installazione ${n.name}...`)
            }, n.installed ? "Ripara" : "Installa")
          )
        ),
        el("p", { class: "wox-node-desc" }, n.description),
        el("div", { class: "wox-node-meta" },
          el("span", { class: "mono" }, n.targetRel),
          n.commit ? el("span", { class: "mono" }, `commit ${n.commit.slice(0, 7)}`) : null
        )
      ))
    );

    const nodesSection = el("section", { class: "wox-set-section" },
      el("div", { class: "wox-sec-title-row" },
        el("div", {},
          el("h4", {}, icon("layers"), "1. Nodi ComfyUI necessari a Wox Cinema Studio [PRO]"),
          el("p", {}, `Percorso: ${state.comfy_dir}/custom_nodes`)
        ),
        el("button", {
          class: "btn small lime",
          type: "button",
          disabled: isRunning,
          onclick: () => startInstallerAction({ action: "install_nodes" }, "Installazione di tutti i nodi avviata")
        }, icon("check"), "Installa / Aggiorna Tutti i Nodi")
      ),
      nodesGrid
    );

    // Models & Packs Section
    const filterButtons = [
      ["all", `Tutti i Pack (${state.packs.length})`],
      ["essential", `Core [PRO] (${state.packs.filter((p) => p.essential).length})`],
      ["missing", `Da Completare (${state.packs.filter((p) => !p.installed).length})`],
      ["installed", `Completi (${state.packs.filter((p) => p.installed).length})`],
    ].map(([id, label]) => el("button", {
      type: "button",
      class: `wox-filter-pill ${packFilter === id ? "active" : ""}`,
      onclick: () => { packFilter = id; render(); }
    }, label));

    const filteredPacks = state.packs.filter((p) => {
      if (packFilter === "essential") return p.essential;
      if (packFilter === "missing") return !p.installed;
      if (packFilter === "installed") return p.installed;
      return true;
    });

    const packsList = el("div", { class: "wox-packs-list" },
      ...filteredPacks.map((p) => {
        const isExp = expandedPacks.has(p.id);
        const pct = p.total_count > 0 ? Math.round((p.installed_count / p.total_count) * 100) : 100;

        const modelsTable = isExp ? el("div", { class: "wox-pack-models" },
          ...p.models.map((m) => el("div", { class: `wox-model-row ${m.installed ? "ok" : "missing"}` },
            el("div", { class: "wox-model-info" },
              el("span", { class: `wox-status-dot ${m.installed ? "ok" : "warn"}` }),
              el("span", { class: "mono wox-model-name" }, `${m.dir}/${m.name}`),
              m.gated ? el("a", {
                class: "wox-badge gated",
                href: `https://huggingface.co/${m.repo}`,
                target: "_blank",
                rel: "noopener",
                title: "Modello con licenza su Hugging Face: clicca per aprire il repository"
              }, "🔒 Gated HF ↗") : null
            ),
            el("div", { class: "wox-model-right" },
              el("span", { class: "dim" }, `${m.gb} GB`),
              m.installed
                ? el("span", { class: "wox-badge ok" }, "✓ Presente")
                : el("button", {
                  class: "btn small lime",
                  type: "button",
                  disabled: isRunning,
                  onclick: () => startInstallerAction(
                    { action: "download_model", model: m },
                    `Download di ${m.name} avviato`
                  )
                }, icon("download"), "Scarica")
            )
          ))
        ) : null;

        return el("div", { class: `wox-pack-card ${p.installed ? "installed" : ""}` },
          el("div", { class: "wox-pack-main" },
            el("div", { class: "wox-pack-left" },
              el("div", { class: "wox-pack-title-row" },
                el("b", {}, p.title),
                p.essential ? el("span", { class: "wox-badge core" }, "CORE [PRO]") : null,
                p.needs_hf_token ? el("span", { class: "wox-badge gated" }, "Richiede HF_TOKEN") : null,
                el("span", { class: `wox-badge ${p.installed ? "ok" : "warn"}` },
                  `${p.installed_count}/${p.total_count} modelli`)
              ),
              el("p", { class: "wox-pack-desc" }, p.description),
              el("div", { class: "wox-pack-bar-wrap" },
                el("div", { class: "wox-pack-bar" }, el("i", { style: { width: `${pct}%` } })),
                el("span", { class: "dim" }, p.installed
                  ? `✓ Completo (${p.download_gb} GB)`
                  : `Mancano ${p.missing_gb} GB su ${p.download_gb} GB`)
              )
            ),
            el("div", { class: "wox-pack-actions" },
              el("button", {
                class: "btn small ghost",
                type: "button",
                onclick: () => {
                  if (expandedPacks.has(p.id)) expandedPacks.delete(p.id);
                  else expandedPacks.add(p.id);
                  render();
                }
              }, icon(isExp ? "chevU" : "chevD"), isExp ? "Nascondi file" : `File (${p.total_count})`),
              !p.installed ? el("button", {
                class: "btn small lime",
                type: "button",
                disabled: isRunning,
                onclick: () => startInstallerAction(
                  { action: "download_packs", packs: [p.id] },
                  `Download pack ${p.title} avviato`
                )
              }, icon("download"), `Scarica (${p.missing_gb} GB)`) : null
            )
          ),
          modelsTable
        );
      })
    );

    const modelsSection = el("section", { class: "wox-set-section" },
      el("div", { class: "wox-sec-title-row" },
        el("div", {},
          el("h4", {}, icon("box"), "2. Modelli AI necessari a Wox Cinema Studio [PRO]"),
          el("p", {}, `Cartella modelli: ${state.models_dir}`)
        ),
        el("div", { class: "wox-filter-bar" }, ...filterButtons)
      ),
      !state.hf_token_configured ? el("div", { class: "wox-hf-banner" },
        icon("info"),
        el("span", {}, "Alcuni modelli (come FLUX 3 Klein e LTX-2.5) sono protetti da licenza su Hugging Face. Configura il tuo "),
        el("button", {
          type: "button",
          class: "wox-link-btn",
          onclick: () => { currentTab = "options"; render(); }
        }, "Token Hugging Face (HF_TOKEN) nelle Opzioni →")
      ) : null,
      packsList
    );

    return el("div", { class: "wox-tab-pane" },
      renderTaskBox(state.task),
      heroCard,
      nodesSection,
      modelsSection
    );
  }

  function renderOptionsTab() {
    if (!state) return el("div", { class: "empty" }, "Caricamento...");
    const comfyInput = el("input", {
      type: "text",
      class: "wox-input",
      value: state.comfy_dir || "",
      placeholder: "~/opt/ComfyUI  /  C:\\ComfyUI"
    });
    const modelsInput = el("input", {
      type: "text",
      class: "wox-input",
      value: state.models_dir || "",
      placeholder: "~/opt/ComfyUI/models  /  C:\\ComfyUI\\models"
    });
    const hfInput = el("input", {
      type: "password",
      class: "wox-input",
      placeholder: state.hf_token_configured ? `Attivo (${state.hf_token_preview}) — incolla per sostituire` : "hf_..."
    });

    const savePathsBtn = el("button", {
      class: "btn lime small",
      type: "button",
      onclick: async () => {
        try {
          state = await api("/api/installer/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              comfy_dir: comfyInput.value.trim(),
              models_dir: modelsInput.value.trim()
            })
          });
          toast("Percorsi ComfyUI salvati!");
          render();
        } catch (err) {
          toast(err.message, { error: true });
        }
      }
    }, icon("check"), "Salva Percorsi");

    const saveHfBtn = el("button", {
      class: "btn lime small",
      type: "button",
      onclick: async () => {
        const val = hfInput.value.trim();
        if (!val) {
          toast("Inserisci un token hf_ valido", { error: true });
          return;
        }
        try {
          state = await api("/api/installer/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hf_token: val })
          });
          toast("Token Hugging Face salvato in .env e cache HF!");
          render();
        } catch (err) {
          toast(err.message, { error: true });
        }
      }
    }, icon("check"), "Salva HF_TOKEN");

    const safe = state.safe || {};
    const toggleSafe = async () => {
      try {
        state = await api("/api/installer/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ safe_enabled: !safe.enabled })
        });
        pollGpu();
        render();
      } catch (err) {
        toast(err.message, { error: true });
      }
    };

    const setSafeThresh = async (th) => {
      try {
        state = await api("/api/installer/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ safe_threshold: th })
        });
        pollGpu();
        render();
      } catch (err) {
        toast(err.message, { error: true });
      }
    };

    const toggleDrafts = async () => {
      try {
        state = await api("/api/installer/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ drafts: !state.drafts_allowed })
        });
        await loadCatalog();
        toast(state.drafts_allowed ? "App sperimentali (Draft) abilitate" : "App sperimentali nascoste");
        render();
      } catch (err) {
        toast(err.message, { error: true });
      }
    };

    const freeVram = async () => {
      try {
        const res = await api("/api/comfy/free", { method: "POST" });
        toast(res.ok ? "VRAM GPU liberata con successo!" : "Impossibile liberare la VRAM");
      } catch (err) {
        toast(err.message, { error: true });
      }
    };

    const curVeH = store.get("ve.height") || "52vh";

    return el("div", { class: "wox-tab-pane wox-options-grid" },
      // Card 1: Paths & Environment
      el("div", { class: "wox-opt-card" },
        el("h4", {}, icon("box"), "Percorsi ComfyUI & Modelli"),
        el("p", { class: "help" }, "Specifica dove risiede l'installazione locale di ComfyUI e la cartella dei modelli."),
        el("label", { class: "wox-field" },
          el("span", {}, "Cartella ComfyUI"),
          comfyInput
        ),
        el("label", { class: "wox-field" },
          el("span", {}, "Cartella Modelli ComfyUI"),
          modelsInput
        ),
        el("div", { class: "wox-opt-meta" },
          el("span", { class: "dim" }, `Python: ${state.python_bin}`),
          savePathsBtn
        )
      ),

      // Card 2: Hugging Face Token
      el("div", { class: "wox-opt-card" },
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } },
          el("h4", {}, icon("globe"), "Token Hugging Face (HF_TOKEN)"),
          el("span", { class: `wox-badge ${state.hf_token_configured ? "ok" : "warn"}` },
            state.hf_token_configured ? `✓ Attivo (${state.hf_token_preview})` : "Non configurato")
        ),
        el("p", { class: "help" },
          "Necessario per scaricare i modelli con licenza (come FLUX 3 Image Klein e LTX-2.5). Viene salvato in locale in .env e ~/.cache/huggingface/token."
        ),
        el("label", { class: "wox-field" },
          el("span", {}, "Token di accesso (Read)"),
          hfInput
        ),
        el("div", { class: "wox-opt-meta" },
          el("a", {
            href: "https://huggingface.co/settings/tokens",
            target: "_blank",
            rel: "noopener",
            class: "wox-ext-link"
          }, "Crea token su Hugging Face ↗"),
          saveHfBtn
        )
      ),

      // Card 3: GPU Safe Mode & VRAM
      el("div", { class: "wox-opt-card" },
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } },
          el("h4", {}, icon("shield"), "GPU Safe Mode & Gestione VRAM"),
          el("button", {
            type: "button",
            class: `btn small ${safe.enabled ? "lime" : "ghost"}`,
            onclick: toggleSafe
          }, safe.enabled ? "✓ Safe Mode ATTIVO" : "Attiva Safe Mode")
        ),
        el("p", { class: "help" },
          "Monitora la temperatura della GPU e regola automaticamente il carico per prevenire spegnimenti o surriscaldamenti."
        ),
        el("div", { class: "wox-opt-row" },
          el("span", {}, "Soglia massima temperatura GPU"),
          el("div", { class: "wox-pill-group" },
            ...[75, 78, 82].map((th) => el("button", {
              type: "button",
              class: `wox-filter-pill ${safe.threshold === th ? "active" : ""}`,
              onclick: () => setSafeThresh(th)
            }, `${th}°C`))
          )
        ),
        el("div", { class: "wox-opt-row", style: { marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.07)" } },
          el("button", { class: "btn small ghost", type: "button", onclick: freeVram }, icon("chip"), "Svuota VRAM GPU"),
          el("button", {
            class: "btn small ghost",
            type: "button",
            onclick: () => { close(); openShellModal(); }
          }, icon("shell"), "Apri Terminale ComfyUI")
        )
      ),

      // Card 4: Studio & UI Preferences
      el("div", { class: "wox-opt-card" },
        el("h4", {}, icon("sliders"), "Preferenze Studio & Interfaccia"),
        el("div", { class: "wox-opt-row" },
          el("span", {}, "Lingua Interfaccia"),
          el("div", { class: "wox-pill-group" },
            ...LANGS.map(([code, label]) => el("button", {
              type: "button",
              class: `wox-filter-pill ${lang === code ? "active" : ""}`,
              onclick: () => {
                setLang(code);
                onLang?.();
                render();
              }
            }, label))
          )
        ),
        el("div", { class: "wox-opt-row" },
          el("span", {}, "Mostra App Sperimentali / Bozza (WOX_DRAFTS)"),
          el("button", {
            type: "button",
            class: `btn small ${state.drafts_allowed ? "lime" : "ghost"}`,
            onclick: toggleDrafts
          }, state.drafts_allowed ? "✓ Abilitate" : "Disabilitate")
        ),
        el("div", { class: "wox-opt-row" },
          el("span", {}, "Altezza predefinita Editor Video Timeline (Sotto)"),
          el("div", { class: "wox-pill-group" },
            ...[["45vh", "Compatto (45%)"], ["52vh", "Standard (52%)"], ["68vh", "Ampio (68%)"]].map(([h, lbl]) => el("button", {
              type: "button",
              class: `wox-filter-pill ${curVeH === h ? "active" : ""}`,
              onclick: () => {
                store.set("ve.height", h);
                document.documentElement.style.setProperty("--ve-height", h);
                toast(`Altezza Editor Video impostata a ${lbl}`);
                render();
              }
            }, lbl))
          )
        )
      )
    );
  }

  function render() {
    tabInstallerBtn.classList.toggle("active", currentTab === "installer");
    tabOptionsBtn.classList.toggle("active", currentTab === "options");
    if (state) {
      footerLeft.textContent = `ComfyUI: ${state.comfy_exists ? "✓ Trovato" : "✗ Non trovato"} (${state.comfy_dir}) · Nodi: ${state.summary.nodes_installed}/${state.summary.nodes_total} · Modelli: ${state.summary.all_models_installed}/${state.summary.all_models_total}`;
    }
    body.replaceChildren(currentTab === "installer" ? renderInstallerTab() : renderOptionsTab());
  }

  function schedulePoll(ms = 2000) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refreshStatus, ms);
  }

  async function refreshStatus() {
    clearTimeout(pollTimer);
    if (!activeModal) return;
    try {
      state = await api("/api/installer/status");
      updateGearIndicator(state);
      render();
      if (state.task?.status === "running") {
        schedulePoll(1000);
      }
    } catch (err) {
      body.replaceChildren(el("div", { class: "empty" }, `Errore caricamento opzioni: ${err.message}`));
    }
  }

  refreshStatus();
}
