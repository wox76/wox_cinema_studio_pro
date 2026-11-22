// The top bar's menus: hovering Image, Video or Audio opens a panel with every app of that studio, grouped like the
// studio, and the open models behind them. A click on the link itself still opens the studio. Pointer only: on touch
// screens the links behave as before, and phones use the menu button.
import { el, icon } from "./util.js";
import { t, lang } from "./i18n.js";
import { apps, byId, FEATURED, FUOBE_FX_SECTIONS, MODELS, menuGroups, modelOf, usesModel, tagline } from "./catalog.js";

const canHover = window.matchMedia?.("(hover: hover) and (pointer: fine)");
const OPEN_MS = 90, CLOSE_MS = 180;

function thumbOf(app) {
  const ex = app.example;
  const src = ex?.poster || (ex && ex.type !== "video" ? ex.card : null);
  return el("span", { class: "mm-thumb" }, src
    ? el("img", { src, alt: "", loading: "lazy", decoding: "async" })
    : icon(app.section === "3d" ? "box" : app.section === "video" ? "video" : app.section === "audio" ? "audio" : "image"));
}

function tagOf(app) {
  if (app.status === "draft") return el("span", { class: "tag ghost" }, t("tag.draft"));
  const f = FEATURED.find((x) => x.id === app.id);
  return f?.tag ? el("span", { class: `tag${f.tag === "new" ? "" : " violet"}` }, t(`tag.${f.tag}`)) : null;
}

const usedBy = (n) => t(n === 1 ? "menu.used1" : "menu.used", { n });

function appItem(app) {
  const model = modelOf(app);
  const tip = [model?.name, app.higgsfield_feature ? `${t("how.equiv")}: ${app.higgsfield_feature}` : null].filter(Boolean).join(" · ");
  const line = tagline(app);
  return el("a", { class: "mm-item", href: `#/app/${app.id}`, role: "menuitem", title: tip || null },
    thumbOf(app),
    el("span", { class: "mm-txt" }, el("b", {}, el("span", { class: "nm" }, app.name), tagOf(app)),
      el("small", {}, line !== app.name ? line : model?.name ?? "")));
}

function modelItem(m, menuApps, studio) {
  const users = menuApps.filter((a) => usesModel(a, m));
  // the model's own app, or the first app of this menu built on it (SeedVR2 in Image opens Upscale, not Upscale Video)
  const target = users.includes(byId.get(m.app)) ? byId.get(m.app) : users[0];
  return el("a", { class: "mm-item model", href: `#/app/${target.id}`, role: "menuitem" },
    el("span", { class: "mm-thumb glyph" }, icon(studio === "video" ? "video" : studio === "audio" ? "audio" : studio === "3d" ? "box" : "layers")),
    el("span", { class: "mm-txt" }, el("b", {}, el("span", { class: "nm" }, m.name),
      target.status === "draft" ? el("span", { class: "tag ghost" }, t("tag.draft")) : el("span", { class: "n" }, usedBy(users.length))),
      el("small", {}, (lang === "it" && m.note[2]) ? m.note[2] : m.note[lang === "es" ? 1 : 0])));
}

function fxToolItem(item) {
  const target = byId.get(item.appId);
  if (!target) return null;
  const ex = target.example;
  const src = ex?.poster || (ex && ex.type !== "video" ? ex.card : null);
  return el("a", { class: "mm-item", href: `#/app/${target.id}`, role: "menuitem", title: `${target.name} · ${item.sub}` },
    el("span", { class: "mm-thumb" }, src
      ? el("img", { src, alt: "", loading: "lazy", decoding: "async" })
      : icon(target.section === "3d" ? "box" : target.section === "video" ? "video" : "image")),
    el("span", { class: "mm-txt" },
      el("b", {}, el("span", { class: "nm" }, item.label)),
      el("small", {}, item.sub)));
}

function panelFor(studio) {
  if (studio === "fx") {
    const total = FUOBE_FX_SECTIONS.reduce((n, s) => n + s.items.length, 0);
    const fxApps = [...new Set(FUOBE_FX_SECTIONS.flatMap((s) => s.items.map((x) => byId.get(x.appId)).filter(Boolean)))];
    const feats = el("section", { class: "mm-feats" },
      el("h4", {}, "Fuobe FX Pipeline", el("span", { class: "n" }, `${total} strumenti`)),
      el("div", { class: "mm-cols" },
        ...FUOBE_FX_SECTIONS.map((sec) => el("div", { class: "mm-group", role: "group", "aria-label": sec.title },
          el("h5", {}, `${sec.title} (${sec.items.length})`),
          ...sec.items.map(fxToolItem)))));
    const models = MODELS.map((m, i) => ({ m, i, n: fxApps.filter((a) => usesModel(a, m)).length }))
      .filter((x) => x.n).sort((a, b) => b.n - a.n || a.i - b.i);
    const mods = el("section", { class: "mm-models" },
      el("h4", {}, t("menu.models")),
      ...models.map(({ m }) => modelItem(m, fxApps, "video")));
    return el("div", { class: "mm-inner mm-fx" }, feats, mods);
  }

  if (studio === "3d") {
    const pick = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
    const fiveModesApps = pick(["pixal3d", "multi-to-3d", "text-to-3d", "object-to-3d", "triposplat-3d"]);
    const extraMeshApps = pick(["trellis-3d", "trellis2-native", "hunyuan3d-21", "idol-3d", "scene-3d-moge", "body-double-3d"]);
    const knownIds = new Set([...fiveModesApps, ...extraMeshApps].map((a) => a.id));
    const extra3d = apps.filter((a) => a.section === "3d" && !knownIds.has(a.id));
    if (extra3d.length) extraMeshApps.push(...extra3d);
    const all3d = [...fiveModesApps, ...extraMeshApps];
    const actionForgeItem = el("a", {
      class: "mm-item",
      href: "/actionforge/",
      target: "_blank",
      rel: "noopener",
      role: "menuitem",
      title: "ActionForge - 3D Character Rigging & Animation Studio"
    },
      el("span", { class: "mm-thumb glyph" }, icon("cube")),
      el("span", { class: "mm-txt" },
        el("b", {}, el("span", { class: "nm" }, "ActionForge [Studio]"), el("span", { class: "tag violet" }, "Rigging")),
        el("small", {}, "Auto-rigging scheletrico interattivo, pose ed esportazione FBX/GLB")
      )
    );
    const feats = el("section", { class: "mm-feats" },
      el("h4", {}, "3D Studio · 5 Modalità & ActionForge", el("span", { class: "n" }, `${all3d.length + 1} strumenti`)),
      el("div", { class: "mm-cols" },
        el("div", { class: "mm-group", role: "group" },
          el("h5", {}, "Image to 3D · 5 Modalità Fuobe"),
          ...fiveModesApps.map(appItem)
        ),
        el("div", { class: "mm-group", role: "group" },
          el("h5", {}, "Motori 3D, Scene & Rigging"),
          ...extraMeshApps.map(appItem),
          actionForgeItem
        )
      )
    );
    const models3d = MODELS.map((m, i) => ({ m, i, n: all3d.filter((a) => usesModel(a, m)).length }))
      .filter((x) => x.n).sort((a, b) => b.n - a.n || a.i - b.i);
    const mods = el("section", { class: "mm-models" },
      el("h4", {}, t("menu.models")),
      ...models3d.map((x) => modelItem(x.m, all3d, "3d"))
    );
    return el("div", { class: "mm-inner mm-3d" }, feats, mods);
  }

  const groups = menuGroups(studio);
  const menuApps = groups.flatMap((g) => g.apps);
  const models = MODELS.map((m, i) => ({ m, i, n: menuApps.filter((a) => usesModel(a, m)).length }))
    .filter((x) => x.n).sort((a, b) => b.n - a.n || a.i - b.i);

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const countBadge = el("span", { class: "n" }, t("explore.apps", { n: menuApps.length }));
  const emptyMsg = el("div", { class: "mm-empty", hidden: true }, "Nessun risultato trovato.");

  const groupNodes = groups.map((g) => {
    const gLabel = g.key ? t(g.key) : "";
    const itemEntries = g.apps.map((a) => {
      const node = appItem(a);
      const model = modelOf(a);
      const hay = norm([
        a.id, a.name, a.summary, tagline(a), a.higgsfield_feature,
        model?.name, ...(model?.note || []), gLabel,
      ].filter(Boolean).join(" "));
      return { node, hay };
    });
    const groupEl = el("div", { class: "mm-group", role: "group", "aria-label": gLabel || null },
      g.key ? el("h5", {}, gLabel) : null, ...itemEntries.map((x) => x.node));
    return { groupEl, itemEntries };
  });

  const modelEntries = models.map(({ m }) => {
    const node = modelItem(m, menuApps, studio);
    const hay = norm([m.name, m.file, ...(m.note || [])].filter(Boolean).join(" "));
    return { node, hay };
  });

  let searchWrap = null;
  if (studio === "image" || studio === "video") {
    const input = el("input", {
      class: "mm-search-input",
      type: "search",
      placeholder: studio === "video"
        ? "Cerca app, effetti, stile, modello video..."
        : "Cerca app, stile, ritocco, modello immagine...",
      "aria-label": "Cerca nel menu",
      autocomplete: "off",
      spellcheck: "false",
    });
    const clearBtn = el("button", {
      class: "mm-search-clear",
      type: "button",
      hidden: true,
      "aria-label": "Pulisci ricerca",
      onclick: () => { input.value = ""; applyFilter(); input.focus(); },
    }, icon("x"));

    const applyFilter = () => {
      const tokens = norm(input.value).split(/\s+/).filter(Boolean);
      clearBtn.hidden = tokens.length === 0;
      let visibleApps = 0;
      for (const g of groupNodes) {
        let groupVisible = 0;
        for (const item of g.itemEntries) {
          const ok = tokens.every((tok) => item.hay.includes(tok));
          item.node.hidden = !ok;
          if (ok) { groupVisible++; visibleApps++; }
        }
        g.groupEl.hidden = groupVisible === 0;
      }
      for (const me of modelEntries) {
        me.node.hidden = tokens.length > 0 && !tokens.every((tok) => me.hay.includes(tok));
      }
      countBadge.textContent = t("explore.apps", { n: visibleApps });
      emptyMsg.hidden = visibleApps > 0;
    };

    input.addEventListener("input", applyFilter);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && input.value) {
        e.stopPropagation();
        input.value = "";
        applyFilter();
      }
    });
    searchWrap = el("div", { class: "mm-search-bar" }, icon("search"), input, clearBtn);
  }

  const feats = el("section", { class: "mm-feats" },
    el("h4", {}, t("menu.features"), countBadge),
    searchWrap,
    el("div", { class: `mm-cols${groups.length === 1 ? " one" : ""}` }, ...groupNodes.map((g) => g.groupEl)),
    emptyMsg);
  const mods = el("section", { class: "mm-models" }, el("h4", {}, t("menu.models")), ...modelEntries.map((x) => x.node));
  return el("div", { class: `mm-inner mm-${studio}` }, feats, mods);
}

/** Wire the menus onto the studio links of a freshly built top bar. */
export function attachMenus(bar, links) {
  if (!canHover?.matches) return;
  const panel = el("div", { class: "mm", role: "menu", hidden: true });
  bar.append(panel);
  const built = new Map();
  let openKey = null, openTimer = null, closeTimer = null;

  const close = () => {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (!openKey) return;
    links.get(openKey)?.setAttribute("aria-expanded", "false");
    openKey = null;
    panel.hidden = true;
  };
  const open = (key) => {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (openKey === key) return;
    if (openKey) links.get(openKey)?.setAttribute("aria-expanded", "false");
    if (!built.has(key)) built.set(key, panelFor(key));
    panel.replaceChildren(built.get(key));
    panel.dataset.studio = key;
    panel.hidden = false;
    panel.scrollTop = 0;
    for (const a of panel.querySelectorAll(".mm-item")) {
      if (a.getAttribute("href") === location.hash) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    openKey = key;
    links.get(key).setAttribute("aria-expanded", "true");
  };
  const later = () => { clearTimeout(openTimer); clearTimeout(closeTimer); closeTimer = setTimeout(close, CLOSE_MS); };

  for (const key of ["image", "video", "audio", "3d", "fx"]) {
    const a = links.get(key);
    if (!a || !apps.length) continue;
    a.setAttribute("aria-haspopup", "true");
    a.setAttribute("aria-expanded", "false");
    a.addEventListener("pointerenter", () => {
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      // moving from one open menu to the next swaps at once; the first one waits a beat so passing over the bar does not flash it
      if (openKey) open(key); else openTimer = setTimeout(() => open(key), OPEN_MS);
    });
    a.addEventListener("pointerleave", later);
    a.addEventListener("click", (e) => {
      if (key === "fx") {
        close();
        return;
      }
      e.preventDefault();
      if (openKey === key && !panel.hidden) {
        close();
      } else {
        open(key);
      }
    });
    a.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); open(key); panel.querySelector(".mm-item")?.focus(); }
    });
  }
  document.addEventListener("click", (e) => {
    if (openKey && !panel.contains(e.target) && ![...links.values()].some((l) => l.contains(e.target))) {
      close();
    }
  });
  panel.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  panel.addEventListener("pointerleave", later);
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { const k = openKey; close(); links.get(k)?.focus(); }
  });
  panel.addEventListener("focusout", (e) => { if (!panel.contains(e.relatedTarget) && ![...links.values()].includes(e.relatedTarget)) close(); });
  window.addEventListener("hashchange", close);
  window.addEventListener("blur", close);
}
