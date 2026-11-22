// Fuobe Marketing Templates Showcase (#/marketing).
// Organizes Product Shot, Kinetic Motion, AI Hypermotion, Mixed Media, UGC Hooks & Settings, Ads, Posters & Marketplace.
import { el, icon } from "./util.js";
import { byId } from "./catalog.js";
import { pickOption } from "./workspace.js";
import { KINETIC_SCENES } from "./kinetic.js";

export const MARKETING_CATEGORIES = [
  { id: "product", label: "Product Shot (22)", desc: "Packshot studio e foto prodotto con modello" },
  { id: "kinetic", label: "Kinetic Motion (18)", desc: "Motion graphics in browser pronte in 0 GB GPU" },
  { id: "motion", label: "AI Video & Mixed (15)", desc: "Hypermotion 3D CGI, Mixed Media e Demo SaaS" },
  { id: "ugc", label: "UGC & TikTok (14 + 9 Hooks)", desc: "Creator selfie, unboxing, stunt hooks e 14 ambientazioni" },
  { id: "ads", label: "Ads & Posters (18)", desc: "Ad creativi ad alta conversione e poster editoriali" },
  { id: "marketplace", label: "Marketplace (6)", desc: "Infografiche Amazon/e-commerce, callout e unboxing" },
];

export const MARKETING_ITEMS = [
  // Product Shot
  ...["Sunlit Plinth", "Ice Bath", "Citrus Burst", "Floating Trio", "Linen Flat Lay", "Splash Crown", "Palm Shadow", "Color Block", "Moss & Stone", "Studio White", "Golden Ripple", "Bathroom Shelf", "Midnight Gloss", "Gingham Picnic"].map((n) => ({
    cat: "product", name: n, badge: "Product Shot", appId: "marketing-studio", pickPrefix: `[Product Shot] ${n}`, desc: "Scenografia prodotto professionale Qwen-Edit 2509",
  })),
  ...["Mirror Selfie", "Golden Close-up", "Street Style", "Editorial Lounge", "Morning Routine", "Courtside", "Kitchen Candid", "Studio Smile"].map((n) => ({
    cat: "product", name: n, badge: "Con Modello", appId: "marketing-studio", pickPrefix: `[Con Modello] ${n}`, desc: "Prodotto tenuto o indossato da un modello",
  })),
  // Kinetic Motion (18 browser-rendered scenes)
  ...KINETIC_SCENES.map((k) => ({
    cat: "kinetic", name: k.name, badge: "Kinetic 0 GB", kineticSlug: k.slug, desc: k.blurb,
  })),
  // AI Video & Mixed
  ...[["Motion 2D", "Sticker Pop"], ["Motion 2D", "Paper Parade"], ["Motion 2D", "Comic Panels"], ["Motion 2D", "Grid Shuffle"],
    ["Hypermotion", "Orbit Hero"], ["Hypermotion", "Liquid Wrap"], ["Hypermotion", "Exploded View"], ["Hypermotion", "Ingredient Rain"],
    ["Hypermotion", "Spotlight Spin"], ["Hypermotion", "Drop & Bounce"], ["Hypermotion", "Slow Splash"], ["Hypermotion", "Neon Sweep"],
    ["Mixed Media", "Scrapbook Flip"], ["Mixed Media", "Riso Loop"], ["Mixed Media", "Y2K Desktop"], ["Mixed Media", "Clay Diorama"], ["Mixed Media", "Halftone Collage"],
    ["SaaS", "Device Float"]].map(([grp, n]) => ({
    cat: "motion", name: n, badge: grp, appId: "marketing-video", pickPrefix: `[${grp}] ${n}`, desc: "Spot video commerciale con audio MiniMax H3",
  })),
  // UGC & TikTok
  ...[["UGC Talking", "Honest Review"], ["UGC Talking", "Unboxing at Home"], ["UGC Talking", "Morning Routine"], ["UGC Talking", "Before & After"],
    ["UGC Talking", "Quick Tutorial"], ["UGC Talking", "Try-On Haul"], ["UGC Talking", "Delivery Day"], ["UGC Talking", "Sky-High Review"],
    ["TikTok", "This Saved My Week"], ["TikTok", "Secret Hack"], ["TikTok", "POV Camera"], ["TikTok", "Mess to Fresh"], ["TikTok", "Couple Test"], ["TikTok", "Direct to Camera"]].map(([grp, n]) => ({
    cat: "ugc", name: n, badge: grp, appId: "marketing-video", pickPrefix: `[${grp}] ${n}`, desc: "Creator review UGC con 9 Hook + 14 Ambientazioni",
  })),
  // Ads & Posters
  ...[["Ad Creativo", "Hero Headline"], ["Ad Creativo", "Problem → Solution"], ["Ad Creativo", "Before / After"], ["Ad Creativo", "Five Stars"],
    ["Ad Creativo", "Compare & Switch"], ["Ad Creativo", "Benefit Ladder"], ["Ad Creativo", "Ingredient Halo"], ["Ad Creativo", "Offer Burst"], ["Ad Creativo", "Big Number"], ["Ad Creativo", "Dark Premium"],
    ["Poster", "Swiss Grid"], ["Poster", "Riso Bloom"], ["Poster", "Giant Type"], ["Poster", "Retro Sunburst"], ["Poster", "Brutalist Stack"], ["Poster", "Botanical Gallery"], ["Poster", "Chrome Y2K"], ["Poster", "Zine Riot"]].map(([grp, n]) => ({
    cat: "ads", name: n, badge: grp, appId: "marketing-studio", pickPrefix: `[${grp}] ${n}`, desc: "Creativa advertising o poster tipografico ad alto impatto",
  })),
  // Marketplace
  ...["Clean Listing", "Feature Callouts", "Dimensions Card", "What's in the Box", "Lifestyle + Badge", "Dark Premium Listing"].map((n) => ({
    cat: "marketplace", name: n, badge: "Marketplace", appId: "marketing-studio", pickPrefix: `[Marketplace] ${n}`, desc: "Scheda prodotto e-commerce ad alta leggibilità",
  })),
];

export function marketingView() {
  let activeCat = "all";
  let query = "";
  const body = el("div");
  const pills = el("div", { class: "pills", role: "group" });
  const search = el("input", { type: "search", placeholder: "Cerca template Marketing, UGC o Kinetic..." });

  function launchItem(it) {
    if (it.kineticSlug) {
      location.hash = `#/kinetic?scene=${it.kineticSlug}`;
      return;
    }
    const target = byId.get(it.appId);
    if (!target) return;
    const tplInp = target.inputs.find((i) => i.id === "template");
    const opt = tplInp?.options?.find((o) => o.label === it.pickPrefix);
    if (opt) pickOption(target, "template", opt.value);
    else location.hash = `#/app/${target.id}`;
  }

  function draw() {
    pills.replaceChildren(
      el("button", { type: "button", "aria-pressed": String(activeCat === "all"), onclick: () => { activeCat = "all"; draw(); } }, `Tutti (${MARKETING_ITEMS.length})`),
      ...MARKETING_CATEGORIES.map((c) => el("button", { type: "button", "aria-pressed": String(activeCat === c.id), onclick: () => { activeCat = c.id; draw(); } }, c.label))
    );

    const q = query.trim().toLowerCase();
    const cats = activeCat === "all" ? MARKETING_CATEGORIES : MARKETING_CATEGORIES.filter((c) => c.id === activeCat);
    const sections = cats.map((c) => {
      const items = MARKETING_ITEMS.filter((it) => it.cat === c.id && (!q || `${it.name} ${it.badge} ${it.desc}`.toLowerCase().includes(q)));
      if (!items.length) return null;
      return el("section", {},
        el("div", { class: "sec-head" }, el("div", {}, el("h2", { class: "display" }, c.label), el("p", {}, c.desc))),
        el("div", { class: "app-row" }, ...items.map((it) => el("button", {
          type: "button",
          class: "app-card",
          style: { textAlign: "left", cursor: "pointer" },
          onclick: () => launchItem(it),
        },
          el("div", { class: "media", style: { display: "grid", placeItems: "center", background: "linear-gradient(135deg, rgba(232,255,90,0.12), rgba(56,189,248,0.08))" } },
            el("span", { class: "placeholder" }, icon(it.kineticSlug ? "bolt" : it.appId === "marketing-video" ? "video" : "image")),
            el("div", { class: "badges" }, el("span", { class: `tag ${it.kineticSlug ? "lime" : "dark"}` }, it.badge))),
          el("h3", {}, it.name),
          el("p", {}, it.desc),
          el("span", { class: "btn white small" }, icon("play"), it.kineticSlug ? "Apri in Kinetic" : "Usa Template"))))
      );
    }).filter(Boolean);

    body.replaceChildren(...(sections.length ? sections : [el("div", { class: "empty" }, `Nessun template per "${query}"`)]));
  }

  search.addEventListener("input", () => { query = search.value; draw(); });
  draw();

  const node = el("div", { class: "page" },
    el("header", { class: "apps-head" },
      el("span", { class: "ic" }, icon("bolt")),
      el("h1", { class: "display" }, "Marketing ", el("em", {}, "& Kinetic Motion")),
      el("p", {}, "Tutti i Marketing Templates di Fuobe (Product Shot, Ads, Posters, Marketplace, UGC Hooks & Settings) + 18 scene Kinetic Motion in browser."),
      el("div", { class: "seg", style: { marginBottom: "12px" } },
        el("a", { class: "btn lime small", href: "#/kinetic" }, icon("bolt"), "Apri Kinetic Motion Studio (18)"),
        el("a", { class: "btn ghost small", href: "#/app/marketing-studio" }, icon("image"), "Marketing Foto Studio"),
        el("a", { class: "btn ghost small", href: "#/app/marketing-video" }, icon("video"), "Marketing Video & UGC")
      ),
      el("div", { class: "apps-bar" }, el("label", { class: "search" }, icon("search"), search), pills)),
    body);
  return { node, active: "marketing" };
}
