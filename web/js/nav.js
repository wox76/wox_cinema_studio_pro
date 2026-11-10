// The top bar: studios (with a menu of their apps on hover, menu.js), featured apps, the VRAM map, language, and the GPU pill that tells
// whether the backend is warm (and wakes it on request; looking never starts it).
import { el, icon, logoMark, api, popover, closePopover, toast, live } from "./util.js";
import { t, lang, LANGS, setLang } from "./i18n.js";
import { byId, FEATURED } from "./catalog.js";
import { attachMenus } from "./menu.js";
import { createShellBtn } from "./shell.js";
import { createEditorToggleBtn } from "./video_editor.js";
import { createSettingsBtn } from "./settings.js";

export const gpuState = { data: null, listeners: new Set() };
let pollTimer = null;

async function pollGpu() {
  clearTimeout(pollTimer);
  try {
    gpuState.data = await api("/api/gpu");
  } catch {
    gpuState.data = null;
  }
  live.gpuWarm = Boolean(gpuState.data?.warm);
  for (const fn of gpuState.listeners) fn(gpuState.data);
  const busy = gpuState.data?.waking || gpuState.data?.running || gpuState.data?.safe?.throttled;
  pollTimer = setTimeout(pollGpu, busy ? 2000 : 8000);
}

function gpuPill() {
  const dot = el("span", { class: "dot" });
  const label = el("span", {});
  const pill = el("button", { class: "gpu", type: "button", "aria-haspopup": "dialog" }, dot, label);
  const draw = (g) => {
    pill.className = "gpu";
    if (!g) { label.textContent = "…"; return; }
    if (!g.configured) { pill.classList.add("off"); label.textContent = t("gpu.none"); }
    else if (g.waking?.error) { pill.classList.add("error"); label.textContent = t("gpu.failed"); }
    else if (g.waking) { pill.classList.add("waking"); label.textContent = t("gpu.waking", { s: g.waking.seconds }); }
    else if (g.warm) {
      pill.classList.add("warm");
      const safe = g.safe;
      const tempStr = safe?.current_temp ? `${Math.round(safe.current_temp)}°C` : "";
      if (safe?.enabled && safe.throttled) {
        pill.classList.add("throttling");
        label.textContent = `SAFE · COOLING ${tempStr}`.trim();
      } else if (safe?.enabled) {
        pill.classList.add("safe");
        label.textContent = tempStr ? `${t("gpu.ready")} · SAFE (${tempStr})` : `${t("gpu.ready")} · SAFE`;
      } else {
        label.textContent = tempStr ? `${t("gpu.ready")} (${tempStr})` : t("gpu.ready");
      }
    }
    else label.textContent = t("gpu.asleep");
  };
  gpuState.listeners.add(draw);
  draw(gpuState.data);
  pill.onclick = async () => {
    // VRAM in use is asked for only now, and the server only asks a backend that is already warm
    if (gpuState.data?.warm) {
      try { gpuState.data = await api("/api/gpu?device=1"); draw(gpuState.data); } catch { /* keep what we had */ }
    }
    const renderContent = () => {
      const g = gpuState.data;
      const safe = g?.safe;
      const wake = el("button", { class: "btn lime small", type: "button", onclick: async () => {
        try { gpuState.data = await api("/api/gpu/wake", { method: "POST" }); draw(gpuState.data); pollGpu(); closePopover(); }
        catch (err) { toast(err.message, { error: true }); }
      } }, icon("bolt"), t("gpu.pop.wake"));
      const lines = [];
      if (!g?.configured) lines.push(el("p", { class: "help" }, t("gpu.pop.none")));
      else {
        lines.push(el("p", { class: "help" }, `${t("gpu.pop.backend")}: ${g.host}`));
        if (g.waking?.error) lines.push(el("p", { class: "help", style: { color: "var(--bad)" } }, g.waking.error), wake);
        else if (g.waking) lines.push(el("p", { class: "help" }, t("gpu.pop.waking")));
        else if (g.warm) {
          lines.push(el("p", { class: "help" }, t("gpu.pop.ready")));

          // Temperature & Power
          if (safe?.supported && safe.current_temp !== null) {
            const tVal = Math.round(safe.current_temp);
            const tempCls = tVal >= 80 ? "hot" : tVal >= 75 ? "warm" : "cool";
            lines.push(
              el("div", { class: "temp-gauge" },
                el("span", { class: "dim" }, t("gpu.safe.temp")),
                el("span", { class: `temp-val ${tempCls}` }, `${tVal}°C`)
              )
            );
            if (safe.power_draw !== null) {
              lines.push(
                el("div", { class: "temp-gauge" },
                  el("span", { class: "dim" }, t("gpu.safe.power")),
                  el("span", { style: { fontWeight: "600", fontSize: "12.5px" } }, `${Math.round(safe.power_draw)} W`)
                )
              );
            }
          }

          if (g.device?.vram_total_gb) {
            lines.push(el("div", { style: { display: "grid", gap: "6px" } },
              el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12.5px" } }, el("span", { class: "dim" }, `${t("gpu.pop.vram")} · ${g.device.name || "GPU"}`),
                el("b", {}, `${g.device.vram_used_gb} / ${g.device.vram_total_gb} GB`)),
              el("div", { class: "vbar" }, el("i", { style: { width: `${(g.device.vram_used_gb / g.device.vram_total_gb) * 100}%` } }))));
          }
          if (g.device?.app) lines.push(el("p", { class: "help" }, `${t("gpu.pop.loaded")}: ${byId.get(g.device.app)?.name ?? g.device.app}`));

          // SAFE MODE CARD
          if (safe?.supported) {
            const toggleSafe = async () => {
              try {
                const updated = await api("/api/gpu/safe", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ enabled: !safe.enabled })
                });
                gpuState.data.safe = updated;
                draw(gpuState.data);
                popBox.replaceChildren(...renderContent());
              } catch (err) {
                toast(err.message, { error: true });
              }
            };

            const setThresh = async (threshold) => {
              try {
                const updated = await api("/api/gpu/safe", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ threshold })
                });
                gpuState.data.safe = updated;
                draw(gpuState.data);
                popBox.replaceChildren(...renderContent());
              } catch (err) {
                toast(err.message, { error: true });
              }
            };

            const statusMsg = safe.throttled
              ? t("gpu.safe.status.throttling")
              : safe.enabled
                ? (safe.state === "warm" ? t("gpu.safe.status.warm") : t("gpu.safe.status.cool"))
                : t("gpu.safe.off");

            const threshBtns = [75, 78, 82].map((th) => el("button", {
              type: "button",
              class: safe.threshold === th ? "active" : "",
              onclick: () => setThresh(th)
            }, `${th}°C`));

            const toggleBtn = el("button", {
              class: `btn small ${safe.enabled ? "ghost danger" : "lime"}`,
              type: "button",
              style: { height: "26px", padding: "0 10px", fontSize: "11.5px", borderRadius: "8px", flex: "none" },
              onclick: toggleSafe
            }, safe.enabled ? "Disable" : "Enable");

            const safeCard = el("div", { class: "safe-card" },
              el("div", { class: "safe-card-head", style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
                el("b", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px" } }, icon("shield"), t("gpu.safe.title")),
                toggleBtn
              ),
              el("p", { style: { margin: "0", fontSize: "11.5px", color: "var(--dim)", lineHeight: "1.4" } }, t("gpu.safe.desc")),
              el("div", { class: "safe-status-box" }, statusMsg),
              el("div", { class: "safe-thresh-row" },
                el("span", {}, t("gpu.safe.thresh")),
                el("div", { class: "safe-thresh-btns" }, ...threshBtns)
              )
            );
            lines.push(safeCard);
          }

        } else lines.push(el("p", { class: "help" }, t("gpu.pop.asleep")), wake);
        if (g.running) lines.push(el("p", { class: "help" }, t("gpu.pop.running", { n: g.running })));
        if (g.demo?.max_runs_per_day) lines.push(el("p", { class: "help" }, t("gpu.pop.demo", { n: g.demo.runs_left, max: g.demo.max_runs_per_day })));
      }
      return lines;
    };

    const popBox = el("div", { class: "pad", style: { width: "330px" } }, ...renderContent());
    popover(pill, popBox, { align: "end" });
  };
  return pill;
}

/** Build the bar once; update() marks the current page. */
export function topbar({ onLang }) {
  gpuState.listeners.clear();   // a rebuilt bar (language change) replaces the old pill
  const items = [
    ["home", "#/app/cinema-video", "home"], ["image", "#/image", "image"], ["video", "#/video", "video"], ["audio", "#/audio", "audio"],
    ["apps", "#/apps", "layers"], ["library", "#/library", "film"],
  ];
  const links = new Map();
  const nav = el("nav", { class: "nav-main", "aria-label": "Wox Cinema Studio Pro" });
  for (const [key, hash] of items) {
    const a = el("a", { href: hash }, t(`nav.${key}`));
    links.set(key, a);
    nav.append(a);
  }
  nav.append(el("span", { class: "sep opt-hide" }));
  for (const f of FEATURED) {
    const app = byId.get(f.id);
    if (!app) continue;
    const a = el("a", { href: `#/app/${app.id}`, class: "opt-hide" }, app.name, f.tag ? el("span", { class: `tag${f.tag === "new" ? "" : " violet"}` }, t(`tag.${f.tag}`)) : null);
    links.set(app.id, a);
    nav.append(a);
  }
  const vram = el("a", { class: "icon-btn", href: "#/vram", title: t("nav.vram"), "aria-label": t("nav.vram") }, icon("chip"));
  links.set("vram", vram);
  const langBtn = el("button", { class: "icon-btn", type: "button", title: t("nav.lang"), "aria-label": t("nav.lang") }, icon("globe"));
  langBtn.onclick = () => popover(langBtn, el("div", {}, ...LANGS.map(([code, name]) => el("button", { class: "opt", type: "button", "aria-selected": String(code === lang),
    onclick: () => { closePopover(); setLang(code); onLang(); } }, name, el("span", { class: "chk" }, icon("check"))))), { align: "end" });
  // phones: the same links in a menu
  const menuBtn = el("button", { class: "icon-btn menu-btn", type: "button", "aria-label": "Menu" }, icon("menu"));
  menuBtn.onclick = () => popover(menuBtn, el("div", {}, ...[...items.map(([key, hash, ic]) => [t(`nav.${key}`), hash, ic]),
    ...FEATURED.filter((f) => byId.has(f.id)).map((f) => [byId.get(f.id).name, `#/app/${f.id}`, "spark"]), [t("nav.vram"), "#/vram", "chip"]]
    .map(([label, hash, ic]) => el("a", { class: "opt", href: hash, onclick: closePopover }, icon(ic), label))));
  const bar = el("header", { class: "topbar" },
    menuBtn,
    el("a", { class: "logo", href: "#/app/cinema-video", "aria-label": "Wox Cinema Studio Pro" }, logoMark(), el("span", { class: "word" }, "Wox Cinema Studio Pro")),
    nav,
    el("div", { class: "nav-right" }, vram, langBtn, gpuPill(), createShellBtn(), createEditorToggleBtn(), createSettingsBtn({ onLang }), el("a", { class: "btn lime small cta", href: "#/image" }, icon("spark"), t("nav.create"))));
  attachMenus(bar, links);
  if (!pollTimer) pollGpu();
  return {
    node: bar,
    update(active) {
      for (const [key, a] of links) {
        if (key === active) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
    },
  };
}
export { pollGpu };
