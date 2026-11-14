// Boot and routing. Each route builds a view ({ node, dispose, active }) into <main>.
//   #/                 Explore         #/apps      the app store       #/app/<id>  an app's workspace
//   #/image #/video #/audio            the studios (open the last app used there)
//   #/library          history and lab examples                       #/vram      the VRAM map
import { el, closePopover, toast, api } from "./util.js";
import { t } from "./i18n.js";
import { loadCatalog, byId, lastAppFor, studioOf, FEATURED, hosted } from "./catalog.js";
import { topbar, gpuState, pollGpu } from "./nav.js";
import { exploreView, appsView, libraryView, vramView } from "./views.js";
import { workspaceView, recreate, useIn, sendToEdit, quickHandoffBar, sendItemToApp } from "./workspace.js";
import { hooks, feed } from "./feed.js";
import { openViewer } from "./viewer.js";
import { openCompare } from "./compare.js";
import { flags } from "./flags.js";

const isWonderfullStandalone =
  new URLSearchParams(location.search).get("wonderfull") === "1" ||
  location.pathname === "/wonderfull" ||
  location.pathname === "/wonderfull/";
if (isWonderfullStandalone) {
  document.body.classList.add("wonderfull-standalone");
}

const main = el("main", { id: "main", class: "view" });
let bar = null;
let current = null;

function route() {
  if (isWonderfullStandalone) {
    if (location.hash !== "#/app/wonderfull") {
      history.replaceState(null, "", `${location.pathname}${location.search}#/app/wonderfull`);
    }
    const view = workspaceView("wonderfull");
    return { ...view, active: "wonderfull" };
  }
  let hash = location.hash || "#";
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    if (location.hash !== "#/app/cinema-studio") history.replaceState(null, "", "#/app/cinema-studio");
    hash = "#/app/cinema-studio";
  }
  const m = /^#\/app\/([\w-]+)/.exec(hash);
  if (m) {
    if (m[1] === "create-video") {
      location.replace("#/app/h3-video");
      return null;
    }
    const view = workspaceView(m[1]);
    const app = view.app;
    const featured = app && FEATURED.some((f) => f.id === app.id);
    return { ...view, active: app ? (featured ? app.id : studioOf(app)) : "apps" };
  }
  const studio = /^#\/(image|video|audio|3d)$/.exec(hash);
  if (studio) {
    location.replace(`#/app/${lastAppFor(studio[1])}`);
    return null;
  }
  if (hash.startsWith("#/apps") || hash.startsWith("#apps")) return appsView();
  if (hash.startsWith("#/library")) return libraryView();
  if (hash.startsWith("#/vram")) return vramView(gpuState.data?.device ? gpuState.data : null);
  return exploreView();
}

function render({ keepScroll = false } = {}) {
  closePopover();
  const view = route();
  if (!view) return;   // redirected
  current?.dispose?.();
  current = view;
  main.replaceChildren(view.node);
  bar?.update(view.active);
  if (!keepScroll) window.scrollTo(0, 0);
  const app = view.app;
  document.title = app ? `${app.name} · Wox Cinema Studio PRO` : "Wox Cinema Studio PRO";
}

function buildBar() {
  if (isWonderfullStandalone) return;
  const next = topbar({ onLang: () => { buildBar(); render({ keepScroll: true }); } });
  if (bar) bar.node.replaceWith(next.node); else document.body.prepend(next.node);
  bar = next;
}

hooks.open = (items, key) => openViewer(items, key);
hooks.recreate = (item) => recreate(item);
hooks.retry = (item) => recreate(item, { run: true });
hooks.compare = (item) => openCompare(item);
hooks.useIn = (anchor, item, done) => useIn(anchor, item, done);
hooks.edit = (item) => sendToEdit(item);
hooks.quickHandoff = (item, done) => quickHandoffBar(item, done);
hooks.sendItem = (item, targetAppId, slotId) => sendItemToApp(item, targetAppId, slotId);
hooks.rerender = () => render({ keepScroll: true });

// a run starting or ending changes what the GPU pill should say
let activeRuns = 0;
feed.on(() => {
  const n = feed.active().length;
  if (n !== activeRuns) { activeRuns = n; pollGpu(); }
});

async function boot() {
  document.body.append(main);
  try {
    await loadCatalog();
    await flags.load();
    feed.load().catch(() => {});
  } catch (err) {
    main.replaceChildren(el("div", { class: "page" }, el("div", { class: "empty" }, `${err.message}. Is \`npm run serve\` running?`)));
    return;
  }
  buildBar();
  window.addEventListener("hashchange", () => render());
  render();
  if (hosted) wakeOnce();
}

// on the hosted demo the GPU starts when someone opens the page, so it is warm by the time they press Generate
async function wakeOnce() {
  try { if (sessionStorage.getItem("ff.woke") === "1") return; } catch { /* no storage: wake every visit */ }
  try {
    const g = await api("/api/gpu");
    if (g.configured && !g.warm && !g.waking) {
      await api("/api/gpu/wake", { method: "POST" });
      toast(t("gpu.autowake"));
      pollGpu();
    }
    try { sessionStorage.setItem("ff.woke", "1"); } catch { /* fine */ }
  } catch { /* the pill still offers the button */ }
}

window.addEventListener("unhandledrejection", (e) => {
  if (e.reason?.name === "AbortError") return;
  toast(String(e.reason?.message || e.reason), { error: true });
});
boot();
export { byId, t };
