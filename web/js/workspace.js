// An app's workspace. Two layouts, both built from app.json alone:
//   composer: prompt-first apps (image, audio): results fill the page, a floating prompt bar sits at the bottom
//   sidebar:  upload-first apps (video, tools): controls in a left column, results and examples on the right
import { el, icon, store, toast, popover, closePopover, fmtSeconds, fmtShort, isMedia, extOf, masonry } from "./util.js";
import { t } from "./i18n.js";
import {
  byId, layoutOf, familyOf, VIDEO_TABS, videoTabOf, IMAGE_TABS, imageTabOf, FEATURED, tagline, iconOf, promptInput, estimate, fitOf, rememberApp, categoryOf, CATEGORIES, apps,
} from "./catalog.js";
import { exampleItem, entryItem, thumb, hoverPlay, fullMedia, playWhenVisible, optionTile, optionThumb } from "./media.js";
import { flags, flagButton } from "./flags.js";
import { feed, hooks, statusText } from "./feed.js";
import { openPainter, maskPreview } from "./paint.js";
import { sendToVideoEditor } from "./video_editor.js";

// ------------------------------------------------------------------ form state (per app, kept while the page is open)
const forms = new Map();

/** A multiple select's value from older saves or examples, where it was one string. */
function asPicks(inp, v) {
  return inp.multiple && !Array.isArray(v) && v !== undefined && v !== null ? (v === "" ? [] : [v]) : v;
}

function validValue(inp, v) {
  if (v === undefined || v === null) return false;
  if (inp.multiple) return Array.isArray(v) && v.length <= (inp.multiple.max ?? Infinity) && v.every((x) => (inp.options || []).some((o) => String(o.value) === String(x)));
  if (inp.type === "select") return (inp.options || []).some((o) => String(o.value) === String(v));
  if (inp.type === "slider" || inp.type === "number") return Number.isFinite(Number(v)) && (inp.min === undefined || v >= inp.min) && (inp.max === undefined || v <= inp.max);
  return true;
}

export function formFor(app) {
  let f = forms.get(app.id);
  if (f) return f;
  const saved = store.get(`values.${app.id}`) || {};
  const values = {};
  for (const inp of app.inputs) {
    if (isMedia(inp.type)) continue;
    const fallback = inp.type === "textarea" || inp.type === "text" ? "" : inp.type === "seed" ? -1 : inp.multiple ? [...(inp.default ?? [])] : inp.default ?? "";
    let val = saved[inp.id];
    if (inp.id === "lens" && val === "a classic anamorphic widescreen look with oval bokeh and blue streak flares") {
      val = undefined;
    }
    values[inp.id] = validValue(inp, asPicks(inp, val)) ? asPicks(inp, val) : fallback;
  }
  f = { values, files: {}, dynamicRefs: [], preset: (app.presets || []).some((p) => p.id === saved.__preset) ? saved.__preset : "", count: 1 };
  forms.set(app.id, f);
  // Restore persisted static files (e.g. first_frame)
  if (saved.__staticFiles && typeof saved.__staticFiles === "object") {
    void (async () => {
      let restored = false;
      for (const [id, info] of Object.entries(saved.__staticFiles)) {
        const inp = app.inputs.find((x) => x.id === id && isMedia(x.type));
        if (!inp || !info?.srcUrl || f.files[id]) continue;
        try {
          const file = await fileFromUrl(info.srcUrl, info.name || `${id}.png`);
          setFile(app, inp, file, { srcUrl: info.srcUrl, silent: true });
          restored = true;
        } catch {}
      }
      if (restored) hooks.rerender?.();
    })();
  }
  // Restore persisted dynamic references (if any have library URLs)
  if (Array.isArray(saved.__dynamicRefs) && saved.__dynamicRefs.length && supportsDynamicRefs(app)) {
    void (async () => {
      let restored = false;
      for (const r of saved.__dynamicRefs) {
        if (!r?.id || !r?.srcUrl || f.dynamicRefs.some((x) => x.id === r.id)) continue;
        try {
          const file = await fileFromUrl(r.srcUrl, r.name || `${r.id}.png`);
          addDynamicRef(app, file, { id: r.id, srcUrl: r.srcUrl, silent: true });
          restored = true;
        } catch {}
      }
      if (restored) hooks.rerender?.();
    })();
  }
  return f;
}
function persist(app) {
  const f = formFor(app);
  const dynRefs = (f.dynamicRefs || []).filter((r) => r.srcUrl).map((r) => ({ id: r.id, name: r.name, type: r.type, srcUrl: r.srcUrl }));
  const staticFiles = {};
  for (const inp of app.inputs) {
    if (isMedia(inp.type) && f.files[inp.id]?.srcUrl) {
      staticFiles[inp.id] = { name: f.files[inp.id].file.name, srcUrl: f.files[inp.id].srcUrl };
    }
  }
  store.set(`values.${app.id}`, { ...f.values, __preset: f.preset, __dynamicRefs: dynRefs, __staticFiles: staticFiles });
}

const ACCEPT = { image: "image/*", video: "video/*", audio: "audio/*" };
function fileMatches(type, file) {
  if (file.type) return file.type.startsWith(`${type}/`);
  const ext = extOf(file.name);
  return { image: ["png", "jpg", "jpeg", "webp", "gif"], video: ["mp4", "mov", "webm", "mkv"], audio: ["mp3", "wav", "flac", "ogg", "m4a"] }[type]?.includes(ext);
}

function setFile(app, inp, file, opts = {}) {
  if (!fileMatches(inp.type, file)) {
    toast(`${inp.label}: ${file.name}?`, { error: true });
    return false;
  }
  const maxMb = inp.limits?.max_mb;
  if (maxMb && file.size > maxMb * 1e6) {
    toast(`${inp.label}: ${t("ws.drop.mb", { mb: maxMb })}`, { error: true });
    return false;
  }
  const f = formFor(app);
  if (f.files[inp.id]) {
    try { URL.revokeObjectURL(f.files[inp.id].url); } catch {}
  }
  const fileObj = { file, url: URL.createObjectURL(file), srcUrl: opts.srcUrl || null };
  f.files[inp.id] = fileObj;
  dropMasksOf(app, inp.id);
  if (!opts.srcUrl) {
    feed.upload(file).then((entry) => {
      const uploadedUrl = entry?.outputs?.[0]?.url;
      if (uploadedUrl && f.files[inp.id] === fileObj) {
        fileObj.srcUrl = uploadedUrl;
        persist(app);
      }
    }).catch(() => {});
  } else {
    persist(app);
  }
  return true;
}
function clearFile(app, id) {
  const f = formFor(app);
  if (f.files[id]) {
    try { URL.revokeObjectURL(f.files[id].url); } catch {}
  }
  delete f.files[id];
  dropMasksOf(app, id);

  // If this ID is also in dynamicRefs or a dynamic reference app, keep state synchronized
  if (f.dynamicRefs) {
    const idx = f.dynamicRefs.findIndex((r) => r.id === id);
    if (idx >= 0) {
      f.dynamicRefs.splice(idx, 1);
    }
  }

  // Also remove from any sibling modes (e.g. cinema-studio, cinema-video, director)
  if (app.modes) {
    for (const sibId of app.modes) {
      if (sibId !== app.id && forms.has(sibId)) {
        const sibF = forms.get(sibId);
        if (sibF?.files?.[id]) {
          try { URL.revokeObjectURL(sibF.files[id].url); } catch {}
          delete sibF.files[id];
        }
        if (sibF?.dynamicRefs) {
          const sIdx = sibF.dynamicRefs.findIndex((r) => r.id === id);
          if (sIdx >= 0) sibF.dynamicRefs.splice(sIdx, 1);
        }
        const sibApp = byId.get(sibId);
        if (sibApp) persist(sibApp);
      }
    }
  }

  persist(app);
}
/** A mask painted over a photo means nothing once the photo changes. */
function dropMasksOf(app, id) {
  for (const m of app.inputs.filter((i) => i.paint === id)) clearFile(app, m.id);
}

/** Put dropped or pasted files into the first matching slots (or dynamic references). */
function assignFiles(app, files) {
  const slots = app.inputs.filter((i) => isMedia(i.type) && !i.paint);   // a painted mask is made with the brush, not dropped
  const f = formFor(app);
  let used = 0;
  for (const file of files) {
    const free = slots.find((s) => fileMatches(s.type, file) && !f.files[s.id]) || slots.find((s) => fileMatches(s.type, file));
    if (free && setFile(app, free, file)) {
      used++;
    } else if (supportsDynamicRefs(app) && (fileMatches("image", file) || fileMatches("video", file))) {
      addDynamicRef(app, file);
      used++;
    }
  }
  return used;
}

async function fileFromUrl(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || res.headers.get("content-type") || "" });
}

export function openLibraryPicker(app, inp, onSelect) {
  if (!feed.isLoaded("*")) {
    feed.load().catch(() => {});
  }
  let activeTab = "mine";
  const targetType = inp.type === "video" ? "video" : "image";
  const fileInput = el("input", { type: "file", accept: ACCEPT[inp.type] || (targetType === "video" ? "video/*" : "image/*"), hidden: true });

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    unsub?.();
    modal.remove();
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  const handleUploadFile = async (file) => {
    if (!file) return;
    if (!fileMatches(inp.type, file)) {
      toast(`${inp.label}: ${file.name}?`, { error: true });
      return;
    }
    const maxMb = inp.limits?.max_mb;
    if (maxMb && file.size > maxMb * 2 ** 20) {
      toast(t("ws.drop.mb", { mb: maxMb }), { error: true });
      return;
    }
    try {
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Uploading...";
      const uploadedEntry = await feed.upload(file);
      const uploadedUrl = uploadedEntry?.outputs?.[0]?.url || null;
      if (inp.customHandler) {
        await inp.customHandler(file, uploadedUrl);
        onSelect?.(file);
        toast(t("toast.uploaded") || "Media added to library");
        close();
      } else if (setFile(app, inp, file, { srcUrl: uploadedUrl })) {
        onSelect?.();
        toast(t("toast.uploaded") || "Media added to library");
        close();
      }
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.replaceChildren(icon("upload"), t("lib.picker.upload"));
    }
  };

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleUploadFile(fileInput.files[0]);
    fileInput.value = "";
  });

  const uploadBtn = el("button", { class: "btn lime small", type: "button", onclick: () => fileInput.click() }, icon("upload"), t("lib.picker.upload"));

  const uploadZone = el("div", { class: "lib-upload-zone", role: "button", tabindex: "0", onclick: () => fileInput.click() },
    el("div", { class: "left" },
      el("div", { class: "ic-box" }, icon("upload")),
      el("div", {},
        el("b", {}, t("lib.picker.upload")),
        el("small", {}, t("lib.picker.upload.sub"))
      )
    ),
    uploadBtn,
    fileInput
  );

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("over");
  });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("over"));
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("over");
    if (e.dataTransfer.files[0]) handleUploadFile(e.dataTransfer.files[0]);
  });

  const tabMine = el("button", { type: "button", class: "active" }, icon("clock"), t("lib.picker.mine"));
  const tabEx = el("button", { type: "button" }, icon("spark"), t("lib.picker.examples"));
  const tabs = el("div", { class: "lib-picker-tabs" }, tabMine, tabEx);

  const grid = el("div", { class: "lib-grid" });
  const gridWrap = el("div", { class: "lib-grid-wrap" }, grid);

  const selectItem = async (item) => {
    try {
      const src = item.url;
      if (!src) return;
      const ext = extOf(src) || (targetType === "video" ? "mp4" : "png");
      const baseName = item.name && item.name.includes(".") ? item.name : `${(item.name || targetType).toLowerCase().replace(/[^a-z0-9._-]/g, "-")}.${ext}`;
      const file = await fileFromUrl(src, baseName);
      if (inp.customHandler) {
        await inp.customHandler(file, src);
        onSelect?.(file);
        close();
      } else if (setFile(app, inp, file, { srcUrl: src })) {
        onSelect?.();
        close();
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  };

  const renderGrid = () => {
    const hist = feed.list();
    const mineItems = [];
    const seen = new Set();
    for (const e of hist) {
      if (e.status !== "succeeded") continue;
      const appMeta = byId.get(e.app);
      for (const o of e.outputs || []) {
        if (o.type === targetType && o.url && !seen.has(o.url)) {
          seen.add(o.url);
          const fileName = o.name || o.file || (o.url ? o.url.split("/").pop() : "image.png");
          mineItems.push({
            id: e.id,
            name: fileName,
            appName: appMeta?.name || e.app,
            url: o.url,
          });
        }
      }
      for (const i of e.inputs || []) {
        if (i.type === targetType && (i.url || i.file) && !seen.has(i.url || i.file)) {
          const u = i.url || i.file;
          seen.add(u);
          const fileName = i.name || (i.file ? i.file.split("/").pop() : null) || (u ? u.split("/").pop() : i.label) || "image.png";
          mineItems.push({
            id: `${e.id}-${i.id}`,
            name: fileName,
            appName: i.label || appMeta?.name || e.app,
            url: u,
          });
        }
      }
    }

    const exItems = apps.filter((a) => a.example?.full && (targetType === "video" ? a.example?.type === "video" : (a.example?.type === "image" || !a.example?.type))).map((a) => ({
      id: `ex-${a.id}`,
      name: a.example?.name || `${a.id}-example.png`,
      appName: a.name,
      url: a.example.full,
    }));

    tabMine.replaceChildren(icon("clock"), `${t("lib.picker.mine")} (${mineItems.length})`);
    tabEx.replaceChildren(icon("spark"), `${t("lib.picker.examples")} (${exItems.length})`);

    tabMine.classList.toggle("active", activeTab === "mine");
    tabEx.classList.toggle("active", activeTab === "ex");

    const currentItems = activeTab === "mine" ? mineItems : exItems;

    if (!currentItems.length) {
      grid.replaceChildren(el("div", { class: "lib-picker-empty", style: { gridColumn: "1 / -1" } },
        activeTab === "mine" ? t("lib.picker.empty") : "No examples found."
      ));
      return;
    }

    const nodes = currentItems.map((item) => {
      const mediaEl = targetType === "video"
        ? el("video", { src: item.url, muted: true, loop: true, playsinline: true, autoplay: true, style: { width: "100%", height: "100%", objectFit: "cover" } })
        : el("img", { src: item.url, loading: "lazy", alt: item.name });
      const tag = el("span", { class: "tag image-name-tag", title: item.name }, item.name);
      const appTag = item.appName ? el("span", { class: "tag app-name-tag", title: item.appName }, item.appName) : null;
      const hover = el("div", { class: "overlay-hover" }, "Select");
      const tile = el("button", {
        type: "button",
        class: "lib-item",
        role: "button",
        "aria-label": `${item.name} (${item.appName || ""})`,
        onclick: () => selectItem(item),
      }, mediaEl, appTag, tag, hover);
      return tile;
    });

    grid.replaceChildren(...nodes);
  };

  tabMine.onclick = () => { activeTab = "mine"; renderGrid(); };
  tabEx.onclick = () => { activeTab = "ex"; renderGrid(); };

  const unsub = feed.on(renderGrid);
  renderGrid();

  const modal = el("div", { class: "lib-modal", role: "dialog", "aria-modal": "true", onclick: (e) => { if (e.target === modal) close(); } },
    el("div", { class: "lib-box", onclick: (e) => e.stopPropagation() },
      el("header", {},
        el("div", {},
          el("h3", {}, icon("film"), t("lib.picker.title")),
          el("p", { class: "help" }, t("lib.picker.sub"))
        ),
        el("button", { class: "icon-btn", type: "button", "aria-label": t("act.close"), onclick: close }, icon("x"))
      ),
      uploadZone,
      tabs,
      gridWrap
    )
  );

  document.body.append(modal);
  document.addEventListener("keydown", onKey, true);
}

// ------------------------------------------------------------------ submitting
function missingInputs(app) {
  const f = formFor(app);
  const out = [];
  for (const inp of app.inputs) {
    if (isMedia(inp.type)) { if (inp.required && !f.files[inp.id]) out.push(inp); continue; }
    if (inp.required && inp.type === "textarea" && !String(f.values[inp.id] ?? "").trim() && !inp.default) out.push(inp);
  }
  return out;
}

function buildForm(app, { randomSeed = false } = {}) {
  const f = formFor(app);
  const fd = new FormData();
  for (const inp of app.inputs) {
    if (isMedia(inp.type)) { const x = f.files[inp.id]; if (x) fd.append(inp.id, x.file, x.file.name); continue; }
    const v = f.values[inp.id];
    if (inp.type === "toggle") { fd.append(inp.id, v ? "true" : "false"); continue; }
    if (inp.multiple) { fd.append(inp.id, JSON.stringify(Array.isArray(v) ? v : [])); continue; }   // none picked is a choice too
    if (inp.type === "seed" && (randomSeed || v === -1 || v === "-1" || v === "" || v === null)) continue;
    // "Any" in a builder select is the empty value: send it, or the server would fill in the default
    if (v === "" && inp.type === "select" && (inp.options || []).some((o) => o.value === "")) { fd.append(inp.id, ""); continue; }
    if (v === "" || v === null || v === undefined) continue;
    fd.append(inp.id, String(v));
  }
  if (f.preset) fd.append("preset", f.preset);
  // Append dynamic reference files (e.g. ref1, ref2, ref3, ...)
  for (const [id, x] of Object.entries(f.files)) {
    if (x?.file && !app.inputs.some((inp) => inp.id === id)) {
      fd.append(id, x.file, x.file.name);
    }
  }
  return fd;
}

/** Validate, then submit `count` runs. Returns false when something is missing (and shows what). */
async function submit(app, ui) {
  const missing = missingInputs(app);
  ui.clearMissing?.();
  if (missing.length) {
    for (const inp of missing) ui.markMissing?.(inp.id);
    const first = missing[0];
    toast(isMedia(first.type) ? t("ws.need", { label: first.label }) : t("ws.needtext", { label: first.label }), { error: true });
    return false;
  }
  const f = formFor(app);
  // Check if the prompt references @refN tags whose file is not attached
  if (supportsDynamicRefs(app)) {
    const pi = promptInput(app);
    const promptText = String(pi ? f.values[pi.id] ?? "" : "");
    const missingRefTags = [];
    for (const m of promptText.matchAll(/@ref(\d+)/gi)) {
      const refId = `ref${m[1]}`;
      if (!f.files[refId]?.file) {
        const tag = `@ref${m[1]}`;
        if (!missingRefTags.includes(tag)) missingRefTags.push(tag);
      }
    }
    if (missingRefTags.length) {
      ui.markMissing?.("add-ref");
      toast(`Manca il file per ${missingRefTags.join(", ")}! Aggiungi l'immagine di riferimento (+ Ref) prima di generare.`, { error: true });
      return false;
    }
  }
  const n = Math.max(1, Math.min(4, f.count || 1));
  persist(app);
  try {
    for (let k = 0; k < n; k++) await feed.run(app.id, buildForm(app, { randomSeed: n > 1 }));
    toast(t("toast.started", { app: app.name }));
    return true;
  } catch (err) {
    toast(err.message, { error: true });
    return false;
  }
}

/** Open an app with one option already chosen (a card on the Explore page's effects wall). */
export function pickOption(app, inputId, value) {
  formFor(app).values[inputId] = value;
  persist(app);
  if (location.hash !== `#/app/${app.id}`) location.hash = `#/app/${app.id}`;
  else hooks.rerender?.();
}

/** Load a result's settings and input files into its app's form (and optionally run it again). */
export async function recreate(item, { run = false } = {}) {
  const app = byId.get(item.app);
  if (!app) return;
  const f = formFor(app);
  for (const inp of app.inputs) {
    if (isMedia(inp.type)) continue;
    if (item.values?.[inp.id] !== undefined && validValue(inp, asPicks(inp, item.values[inp.id]))) f.values[inp.id] = asPicks(inp, item.values[inp.id]);
    if (inp.type === "seed" && item.seed !== null && item.seed !== undefined) f.values[inp.id] = item.seed;
  }
  f.preset = item.preset || "";
  if (supportsDynamicRefs(app) && f.dynamicRefs?.length) {
    for (const r of [...f.dynamicRefs]) removeDynamicRef(app, r.id);
  }
  try {
    await Promise.all((item.inputs || []).map(async (i) => {
      const src = i.url || i.file;
      if (!src) return;
      const name = i.name || `${i.id}.${extOf(src) || "bin"}`;
      const inp = app.inputs.find((x) => x.id === i.id);
      if (inp) {
        setFile(app, inp, await fileFromUrl(src, name));
      } else if (supportsDynamicRefs(app) && /^ref\d+$/.test(i.id)) {
        addDynamicRef(app, await fileFromUrl(src, name), { id: i.id, srcUrl: src, silent: true });
      }
    }));
  } catch (err) {
    toast(err.message, { error: true });
  }
  persist(app);
  if (run) wsTab = "history";
  if (location.hash !== `#/app/${app.id}`) location.hash = `#/app/${app.id}`;
  else hooks.rerender?.();
  if (run) await submit(app, {});
  else toast(t("toast.loaded", { app: app.name }));
}

/** Where a result usually goes next, by the kind of file it is (the rest of the apps that take it follow). */
const NEXT = {
  image: [
    "cinema-studio",
    "music-video",
    "remove-bg",
    "video",
    "director",
    "face-swap",
    "upscale",
    "edit",
    "inpaint",
    "relight",
    "character-studio",
    "expand-image",
    "h3-photo",
    "motion-transfer",
  ],
  video: [
    "director",
    "cinema-video",
    "upscale-video",
    "extend-video",
    "video-remove-bg",
    "reframe",
    "smooth",
    "mixed-media",
    "sdr-hdr",
    "recast",
  ],
  audio: [
    "music-video",
    "talking",
    "speak",
  ],
};

export function resolveSlot(targetApp, item, preferredSlotId = null) {
  if (!targetApp) return null;
  const f = formFor(targetApp);
  const type = item.type || "image";

  if (preferredSlotId) {
    const s = targetApp.inputs.find((i) => i.id === preferredSlotId);
    if (s) return s;
  }

  if (targetApp.id === "director") {
    if (type === "video") {
      return targetApp.inputs.find((i) => i.id === "ref1" || i.type === "video");
    }
    // For images, check empty reference slot among ref2..ref5
    const refSlots = ["ref2", "ref3", "ref4", "ref5"]
      .map((id) => targetApp.inputs.find((i) => i.id === id))
      .filter(Boolean);
    const free = refSlots.find((s) => !f.files[s.id]);
    return free || refSlots[0] || targetApp.inputs.find((i) => i.type === "image");
  }

  if (targetApp.id === "face-swap") {
    const sTarget = targetApp.inputs.find((i) => i.id === "image");
    const sFace = targetApp.inputs.find((i) => i.id === "image2");
    if (f.files[sTarget?.id] && !f.files[sFace?.id]) return sFace;
    return sTarget || sFace;
  }

  const mediaSlots = targetApp.inputs.filter((i) => i.type === type && !i.paint);
  if (mediaSlots.length) {
    return mediaSlots.find((s) => !f.files[s.id]) || mediaSlots[0];
  }
  if (supportsDynamicRefs(targetApp) && (type === "image" || type === "video")) {
    let idx = 1;
    while ((f.dynamicRefs || []).some((r) => r.id === `ref${idx}`)) idx++;
    return { id: `ref${idx}`, type, label: `Reference @ref${idx}`, isDynamicRef: true };
  }
  return null;
}

export async function sendItemToApp(item, targetAppOrId, preferredSlotId = null) {
  const targetApp = typeof targetAppOrId === "string" ? byId.get(targetAppOrId) : targetAppOrId;
  if (!targetApp) return false;
  const slot = resolveSlot(targetApp, item, preferredSlotId);
  if (!slot) {
    toast(`Nessun input compatibile in ${targetApp.name}`, { error: true });
    return false;
  }
  try {
    const src = item.full || item.card;
    if (!src) return false;
    const ext = extOf(src) || (item.type === "video" ? "mp4" : "png");
    const name = `${item.app || "media"}.${ext}`;
    const file = await fileFromUrl(src, name);
    let tag = "";
    if (slot.isDynamicRef) {
      const refObj = addDynamicRef(targetApp, file, { srcUrl: src, silent: true });
      tag = ` (${refObj.tag})`;
      persist(targetApp);
    } else {
      if (!setFile(targetApp, slot, file)) return false;
      tag = targetApp.id === "director" ? ` (@${slot.id})` : "";
    }
    if (location.hash !== `#/app/${targetApp.id}`) {
      location.hash = `#/app/${targetApp.id}`;
    } else {
      hooks.rerender?.();
    }
    toast(`${t("toast.sent", { app: targetApp.name })}${tag}`);
    return true;
  } catch (err) {
    toast(err.message, { error: true });
    return false;
  }
}

/** "Use in…": put a result (an image or a video) into another app, and open that app. */
export function useIn(anchor, item, done) {
  const type = item.type || "image";
  const takesType = (a) => a.inputs.some((i) => i.type === type && !i.paint) || (supportsDynamicRefs(a) && (type === "image" || type === "video"));
  const first = (NEXT[type] || []).map((id) => byId.get(id)).filter((a) => a && takesType(a));
  const rest = apps.filter((a) => takesType(a) && !first.includes(a)).sort((x, y) => x.name.localeCompare(y.name));
  const go = async (a) => {
    closePopover();
    done?.();
    await sendItemToApp(item, a);
  };
  const row = (a) => {
    const slot = resolveSlot(a, item);
    const slotHint = slot && (slot.isDynamicRef || a.inputs.filter((i) => i.type === type).length > 1) ? el("span", { class: "tag ghost mini", style: { marginLeft: "auto", fontSize: "10px" } }, `@${slot.id}`) : null;
    return el("button", { class: "opt", type: "button", onclick: () => go(a) },
      el("span", { class: "thumb" }, appThumb(a)),
      el("span", { class: "two" }, el("b", {}, a.name), el("small", {}, tagline(a))),
      slotHint
    );
  };
  const editorRow = el("button", {
    class: "opt wox-editor-opt",
    type: "button",
    style: { borderBottom: "1px solid var(--line, rgba(255,255,255,0.12))", marginBottom: "6px", paddingBottom: "8px" },
    onclick: () => {
      closePopover();
      done?.();
      sendToVideoEditor(item);
    }
  },
    el("span", { class: "thumb glyph" }, icon("film")),
    el("span", { class: "two" }, el("b", {}, "Editor Video"), el("small", {}, "Aggiungi alla Timeline multi-traccia")),
    el("span", { class: "tag ghost mini", style: { marginLeft: "auto", fontSize: "10px" } }, "Studio")
  );

  popover(anchor, el("div", { class: "usein" },
    el("h4", {}, t("act.usein")),
    editorRow,
    el("div", { class: "usein-list" }, ...first.map(row)),
    rest.length ? el("details", {}, el("summary", {}, t("usein.more", { n: rest.length })), ...rest.map(row)) : null
  ), { width: 340 });
}

export function quickHandoffBar(item, done) {
  const type = item.type;
  if (type !== "image" && type !== "video") return null;

  const bar = el("div", { class: "quick-handoff" });
  const head = el("div", { class: "qh-head" },
    el("span", { class: "qh-title" }, icon("send"), t("handoff.title") || "Flusso Rapido"),
    el("span", { class: "qh-hint" }, t("handoff.hint") || "Invia direttamente ad un'altra app")
  );
  bar.appendChild(head);

  const targets = type === "image" ? [
    { id: "editor", label: "🎞 Editor Video", badge: "Timeline", isEditor: true },
    { id: "remove-bg", label: "✂ Rimuovi sfondo", badge: "BiRefNet" },
    { id: "video", label: "🎬 Anima in Video", badge: "H3" },
    { id: "director", label: "🎥 AI Director", badge: "@ref2..5" },
    { id: "face-swap", label: "👤 Face Swap", badge: "ReActor" },
    { id: "upscale", label: "🔍 Upscale", badge: "Clarity" },
  ] : [
    { id: "editor", label: "🎞 Editor Video", badge: "Timeline", isEditor: true },
    { id: "director", label: "🎥 AI Director", badge: "@ref1" },
    { id: "upscale-video", label: "🔍 Upscale Video", badge: "Topaz/LTX" },
    { id: "extend-video", label: "⏩ Allunga Video", badge: "Extend" },
    { id: "video-remove-bg", label: "✂ Rimuovi sfondo Video", badge: "Matting" },
  ];

  const pills = el("div", { class: "qh-pills" });
  for (const tgt of targets) {
    if (tgt.isEditor) {
      const btn = el("button", {
        class: "qh-pill",
        type: "button",
        onclick: (e) => {
          e.stopPropagation();
          done?.();
          sendToVideoEditor(item);
        }
      },
        el("span", { class: "qh-pill-text" }, tgt.label),
        tgt.badge ? el("span", { class: "qh-pill-badge" }, tgt.badge) : null
      );
      pills.appendChild(btn);
      continue;
    }
    const a = byId.get(tgt.id);
    if (!a) continue;
    const btn = el("button", {
      class: "qh-pill",
      type: "button",
      onclick: async (e) => {
        e.stopPropagation();
        done?.();
        await sendItemToApp(item, a);
      }
    },
      el("span", { class: "qh-pill-text" }, tgt.label),
      tgt.badge ? el("span", { class: "qh-pill-badge" }, tgt.badge) : null
    );
    pills.appendChild(btn);
  }

  const moreBtn = el("button", {
    class: "qh-pill qh-pill-more",
    type: "button",
    onclick: (e) => {
      e.stopPropagation();
      useIn(e.currentTarget, item, done);
    }
  },
    icon("menu"),
    el("span", {}, t("act.more") || "Altre app…")
  );
  pills.appendChild(moreBtn);

  bar.appendChild(pills);
  return bar;
}

export async function sendToEdit(item) {
  return sendItemToApp(item, "edit");
}

// ------------------------------------------------------------------ small parts
function appThumb(a) {
  const ex = a.example?.full ? a.example : null;
  if (!ex) return el("span", { style: { display: "grid", placeItems: "center", width: "100%", height: "100%", color: "#55555c" } }, icon(iconOf(a)));
  const src = ex.type === "video" ? ex.poster : ex.card || ex.full;
  return el("img", { src, alt: "", loading: "lazy", class: ex.type === "audio" ? "contain" : null, style: ex.type === "audio" ? { objectFit: "contain" } : null });
}

function tagOf(app) {
  if (app.status === "draft") return el("span", { class: "tag ghost" }, t("tag.draft"));
  const f = FEATURED.find((x) => x.id === app.id);
  return f?.tag ? el("span", { class: `tag${f.tag === "new" ? "" : " violet"}` }, t(`tag.${f.tag}`)) : null;
}

function switcher(app) {
  let curStudio = (videoTabOf(app.id) || app.section === "video") ? "video" : "image";
  let curGenre = "all";
  let searchQ = "";

  const box = el("div", { class: "app-drawer" });

  const render = () => {
    const isVid = curStudio === "video";
    const tabList = isVid ? VIDEO_TABS : IMAGE_TABS;
    const tabPrefix = isVid ? "vtab" : "itab";

    const studioSwitch = el("div", { class: "seg", role: "group" },
      el("button", {
        type: "button",
        "aria-pressed": String(curStudio === "video"),
        onclick: () => { curStudio = "video"; curGenre = "all"; render(); }
      }, icon("video"), `${t("nav.video")}`),
      el("button", {
        type: "button",
        "aria-pressed": String(curStudio === "image"),
        onclick: () => { curStudio = "image"; curGenre = "all"; render(); }
      }, icon("image"), `${t("nav.image")}`)
    );

    const searchInput = el("input", {
      type: "search",
      class: "drawer-search",
      placeholder: t("ws.search.app"),
      value: searchQ
    });
    searchInput.oninput = () => { searchQ = searchInput.value.toLowerCase().trim(); drawList(); };

    const genrePills = el("div", { class: "pills drawer-pills", role: "group" },
      el("button", {
        type: "button",
        "aria-pressed": String(curGenre === "all"),
        onclick: () => { curGenre = "all"; drawList(); }
      }, t("apps.all")),
      ...tabList.map((g) => el("button", {
        type: "button",
        "aria-pressed": String(curGenre === g.id),
        onclick: () => { curGenre = g.id; drawList(); }
      }, t(`${tabPrefix}.${g.id}`)))
    );

    const listEl = el("div", { class: "drawer-list" });

    const drawList = () => {
      const activeTabs = curGenre === "all" ? tabList : tabList.filter((g) => g.id === curGenre);
      const q = searchQ;

      const groups = activeTabs.map((g) => {
        const appObjs = g.apps.map((id) => byId.get(id)).filter(Boolean).filter((a) => {
          if (!q) return true;
          const text = [a.name, tagline(a), a.summary, a.higgsfield_feature, a.id].filter(Boolean).join(" ").toLowerCase();
          return text.includes(q);
        });
        return { ...g, apps: appObjs };
      }).filter((g) => g.apps.length > 0);

      if (!groups.length) {
        listEl.replaceChildren(el("div", { class: "drawer-empty" }, t("apps.none", { q: searchQ })));
        return;
      }

      listEl.replaceChildren(...groups.map((g) => {
        return el("div", { class: "drawer-group" },
          el("h5", { class: "drawer-ghdr" }, t(`${tabPrefix}.${g.id}`)),
          el("div", { class: "drawer-items" }, ...g.apps.map((a) => {
            const isCur = a.id === app.id;
            const line = tagline(a);
            return el("button", {
              class: `drawer-item${isCur ? " active" : ""}`,
              type: "button",
              onclick: () => { closePopover(); location.hash = `#/app/${a.id}`; }
            },
              el("span", { class: "mm-thumb" }, appThumb(a)),
              el("div", { class: "txt" },
                el("b", {}, el("span", { class: "nm" }, a.name), tagOf(a)),
                el("small", {}, line)
              ),
              isCur ? el("span", { class: "chk" }, icon("check")) : null
            );
          }))
        );
      }));
    };

    drawList();

    box.replaceChildren(
      el("div", { class: "drawer-head" },
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } },
          el("h4", { style: { margin: 0, fontSize: "14px", fontWeight: "700" } }, t("ws.explore.apps")),
          studioSwitch
        ),
        searchInput,
        genrePills
      ),
      listEl
    );
  };

  render();
  return box;
}

function optionLabel(inp, v) {
  if (Array.isArray(v)) return v.length ? v.map((x) => optionLabel(inp, x)).join(inp.multiple?.ordered ? " → " : ", ") : t("ws.none");
  const o = (inp.options || []).find((x) => String(x.value) === String(v));
  return o ? o.label : String(v ?? "");
}

/** A multiple select's list: tap to add or remove; ordered ones number the picks, which is the order they run in. */
function multiPicker(inp, f, onChange) {
  const max = inp.multiple.max ?? Infinity;
  const list = el("div", { class: "multi-list" });
  const draw = () => {
    const picked = f.values[inp.id] || [];
    list.replaceChildren(...(inp.options || []).map((o) => {
      const at = picked.findIndex((x) => String(x) === String(o.value));
      return el("button", { class: "opt", type: "button", "aria-pressed": String(at >= 0), onclick: () => {
        const cur = [...(f.values[inp.id] || [])];
        if (at >= 0) cur.splice(at, 1);
        else if (cur.length >= max) { toast(t("ws.multi.max", { n: max }), { error: true }); return; }
        else cur.push(o.value);
        f.values[inp.id] = cur;
        onChange();
        draw();
      } }, o.label, at >= 0 ? el("span", { class: "pick" }, inp.multiple.ordered ? String(at + 1) : icon("check")) : null);
    }));
  };
  draw();
  const clear = el("button", { class: "mini-link", type: "button", onclick: () => { f.values[inp.id] = []; onChange(); draw(); } }, t("ws.multi.clear"));
  return el("div", {}, el("h4", {}, inp.label, el("span", { class: "n" }, Number.isFinite(max) ? t(inp.multiple.ordered ? "ws.multi.upto.ordered" : "ws.multi.upto", { n: max }) : ""), clear), list);
}

/** The switch between sibling apps (Cinema Studio's image and video modes). */
function modeSwitch(app) {
  if (!app.modes) return null;
  return el("div", { class: "seg modes", role: "group", "aria-label": app.name }, ...app.modes.map((id) => byId.get(id)).filter(Boolean).map((a) =>
    el("button", { type: "button", "aria-pressed": String(a.id === app.id), onclick: () => { if (a.id !== app.id) location.hash = `#/app/${a.id}`; } },
      icon(a.mode_label ? (a.inputs.some((i) => i.type === "image") ? "user" : "spark") : a.section === "video" ? "video" : "image"),
      a.mode_label || t(`nav.${a.section}`))));
}

/** A select marked "gallery" (the effects picker): cards with each option's lab example, and the chosen one playing. */
function galleryField(app, inp, f, set, help) {
  const shots = app.example?.options?.[inp.id] || {};
  const val = el("span", { class: "v" }, optionLabel(inp, f.values[inp.id]));
  const now = el("div", { class: "fx-now" });
  const drawNow = () => {
    const shot = shots[String(f.values[inp.id])];
    now.hidden = !shot;
    now.replaceChildren(...(shot ? [optionThumb(shot, { play: "visible" })] : []));
  };
  drawNow();
  const row = el("button", { class: "selrow", type: "button", "aria-haspopup": "dialog", "aria-label": inp.label }, val, icon("chevD"));
  row.onclick = () => popover(row, el("div", {}, el("h4", {}, inp.label), el("div", { class: "fx-grid" }, ...(inp.options || []).map((o) =>
    optionTile(o, shots[String(o.value)], { selected: String(o.value) === String(f.values[inp.id]), flagKey: flags.key(app.id, inp.id, o.value),
      onPick: () => { set(o.value); val.textContent = o.label; drawNow(); closePopover(); } })))), { width: 640, cls: "wide" });
  return el("div", { class: "field" }, el("span", { class: "lbl" }, inp.label), row, now, help);
}

function rangeInput(inp, value, onChange) {
  const out = el("b", {}, String(value));
  const r = el("input", { type: "range", min: inp.min ?? 0, max: inp.max ?? 100, step: inp.step ?? 1, value: value, "aria-label": inp.label });
  const paint = () => r.style.setProperty("--p", `${((r.value - r.min) / (r.max - r.min || 1)) * 100}%`);
  paint();
  r.addEventListener("input", () => { out.textContent = r.value; paint(); onChange(Number(r.value)); });
  return el("div", { class: "range" }, el("div", { class: "top" }, el("span", {}, inp.label), out), r);
}

function seedEditor(app, inp, f, onChange) {
  const box = el("input", { type: "number", min: inp.min ?? 0, placeholder: t("ws.seed.random"), value: f.values[inp.id] === -1 ? "" : f.values[inp.id] ?? "" });
  box.addEventListener("input", () => { f.values[inp.id] = box.value === "" ? -1 : Math.trunc(Number(box.value)); onChange(); });
  const last = feed.list(app.id).find((e) => e.values?.[inp.id] !== undefined);
  return el("div", { class: "pad" },
    el("div", { class: "row" }, box,
      el("button", { class: "btn small ghost", type: "button", title: t("ws.seed.random"), onclick: () => { box.value = ""; f.values[inp.id] = -1; onChange(); } }, icon("dice"))),
    last ? el("button", { class: "btn small ghost", type: "button", onclick: () => { box.value = last.values[inp.id]; f.values[inp.id] = last.values[inp.id]; onChange(); } },
      `${t("ws.seed.reuse")} · ${last.values[inp.id]}`) : null,
    el("p", { class: "help" }, t("ws.seed.help")));
}

function genButton(app, onClick, { wide = false } = {}) {
  const est = estimate(app);
  const b = el("button", { class: `generate${wide ? " wide" : ""}`, type: "button", disabled: !app.runnable,
    title: !app.runnable ? (app.status === "draft" ? t("ws.draft") : t("ws.noworkflow")) : est ? t("ws.est", { gpu: est.gpu }) : null },
    t("ws.generate"), est ? el("span", { class: "cost" }, icon("spark"), fmtShort(est.seconds)) : el("span", { class: "cost" }, icon("spark")));
  b.addEventListener("click", async () => {
    if (b.dataset.busy) return;
    b.dataset.busy = "1";
    try { await onClick(); } finally { delete b.dataset.busy; }
  });
  return b;
}

function countControl(f) {
  const label = el("span", {});
  const minus = el("button", { type: "button", "aria-label": "−" }, "−");
  const plus = el("button", { type: "button", "aria-label": "+" }, "+");
  const draw = () => {
    label.replaceChildren(String(f.count), el("small", {}, "/4"));
    minus.disabled = f.count <= 1;
    plus.disabled = f.count >= 4;
  };
  minus.onclick = () => { f.count = Math.max(1, f.count - 1); draw(); };
  plus.onclick = () => { f.count = Math.min(4, f.count + 1); draw(); };
  draw();
  return el("div", { class: "count", title: t("ws.count") }, minus, label, plus);
}

export function supportsDynamicRefs(app) {
  return app.id === "cinema-studio" || app.id === "cinema-video" || app.id === "director" || app.id === "create-image" || app.id === "z-image";
}

export function addDynamicRef(app, file, opts = {}) {
  const f = formFor(app);
  f.dynamicRefs = f.dynamicRefs || [];
  let id = opts.id;
  if (!id || f.dynamicRefs.some((r) => r.id === id)) {
    let idx = 1;
    while (f.dynamicRefs.some((r) => r.id === `ref${idx}`)) {
      idx++;
    }
    id = `ref${idx}`;
  }
  const tag = `@${id}`;
  const isVideo = file.type?.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name);
  const type = isVideo ? "video" : "image";
  const url = URL.createObjectURL(file);
  const refObj = { id, tag, type, file, url, name: file.name, srcUrl: opts.srcUrl || null };
  f.dynamicRefs.push(refObj);
  f.files[id] = { file, url };
  if (!opts.srcUrl) {
    feed.upload(file).then((entry) => {
      const uploadedUrl = entry?.outputs?.[0]?.url;
      if (uploadedUrl) {
        refObj.srcUrl = uploadedUrl;
        persist(app);
      }
    }).catch(() => {});
  } else {
    persist(app);
  }
  if (!opts.silent) {
    toast(`✔ Reference ${tag} aggiunta (${file.name})`);
  }
  return refObj;
}

export function removeDynamicRef(app, id) {
  const f = formFor(app);
  if (f.files?.[id]) {
    try { URL.revokeObjectURL(f.files[id].url); } catch {}
    delete f.files[id];
  }
  if (f.dynamicRefs) {
    const idx = f.dynamicRefs.findIndex((r) => r.id === id);
    if (idx >= 0) {
      const ref = f.dynamicRefs[idx];
      if (ref?.url) {
        try { URL.revokeObjectURL(ref.url); } catch {}
      }
      f.dynamicRefs.splice(idx, 1);
    }
  }

  // Also remove from any sibling modes (e.g. cinema-studio, cinema-video, director)
  if (app.modes) {
    for (const sibId of app.modes) {
      if (sibId !== app.id && forms.has(sibId)) {
        const sibF = forms.get(sibId);
        if (sibF?.files?.[id]) {
          try { URL.revokeObjectURL(sibF.files[id].url); } catch {}
          delete sibF.files[id];
        }
        if (sibF?.dynamicRefs) {
          const sIdx = sibF.dynamicRefs.findIndex((r) => r.id === id);
          if (sIdx >= 0) sibF.dynamicRefs.splice(sIdx, 1);
        }
        const sibApp = byId.get(sibId);
        if (sibApp) persist(sibApp);
      }
    }
  }

  persist(app);
}

// ------------------------------------------------------------------ composer layout
function composerBar(app, rerenderBar) {
  const f = formFor(app);
  const pi = promptInput(app);
  const isDynRefApp = supportsDynamicRefs(app);
  f.dynamicRefs = f.dynamicRefs || [];

  // Carry over dynamic references across sibling modes (Cinema Studio Immagine <-> Video <-> Director)
  if (isDynRefApp && !f.dynamicRefs.length && app.modes) {
    for (const sibId of app.modes) {
      if (sibId !== app.id && forms.has(sibId)) {
        const sibF = forms.get(sibId);
        if (sibF?.dynamicRefs?.length) {
          f.dynamicRefs = [...sibF.dynamicRefs];
          for (const r of f.dynamicRefs) {
            f.files[r.id] = { file: r.file, url: r.url };
          }
          break;
        }
      }
    }
  }

  const mediaInputs = app.inputs.filter((i) => isMedia(i.type));
  const pickers = Object.fromEntries(mediaInputs.map((inp) => {
    const input = el("input", { type: "file", accept: ACCEPT[inp.type], hidden: true });
    input.addEventListener("change", () => { if (input.files[0] && setFile(app, inp, input.files[0])) rerenderBar(); input.value = ""; });
    return [inp.id, input];
  }));
  const pick = (inp) => {
    if (inp.type === "image") {
      openLibraryPicker(app, inp, rerenderBar);
    } else {
      pickers[inp.id].click();
    }
  };
  const hint = el("div", { class: "cmp-hint", hidden: true });

  const prompt = pi ? el("textarea", { class: "cmp-prompt", rows: "2", "aria-label": pi.label,
    // an optional prompt (a template app's "Extra direction") says so instead of asking for a scene
    placeholder: pi.default ? t("ws.eg", { x: pi.default }) : pi.required ? t("ws.prompt.ph") : t("ws.prompt.opt", { label: pi.label }), value: f.values[pi.id] ?? "" }) : null;
  const grow = () => {
    if (!prompt) return;
    if (f.customPromptHeight) {
      prompt.style.height = `${f.customPromptHeight}px`;
      return;
    }
    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(window.innerHeight * 0.65, Math.max(48, prompt.scrollHeight))}px`;
  };

  const insertTagIntoPrompt = (tag, replaceLen = 0) => {
    if (!prompt) return;
    const start = Math.max(0, (prompt.selectionStart ?? prompt.value.length) - replaceLen);
    const end = prompt.selectionEnd ?? prompt.value.length;
    const spaceBefore = start > 0 && !/\s$/.test(prompt.value.slice(0, start)) ? " " : "";
    const spaceAfter = end < prompt.value.length && !/^\s/.test(prompt.value.slice(end)) ? " " : " ";
    const insert = `${spaceBefore}${tag}${spaceAfter}`;
    prompt.value = prompt.value.slice(0, start) + insert + prompt.value.slice(end);
    f.values[pi.id] = prompt.value;
    prompt.focus();
    const newPos = start + insert.length;
    prompt.setSelectionRange(newPos, newPos);
    grow();
    persistSoon();
  };

  const triggerAddRef = (onAdded) => {
    const pop = el("div", { class: "ref-picker-pop", style: { padding: "4px" } },
      el("h4", { style: { margin: "2px 0 4px", fontSize: "13.5px" } }, "Aggiungi Reference (@ref)"),
      el("p", { class: "dim", style: { margin: "0 0 10px", fontSize: "11.5px" } }, "Supporta infinite immagini o video (da disco o libreria)"),
      el("button", {
        class: "opt",
        type: "button",
        onclick: () => {
          closePopover();
          openLibraryPicker(app, {
            id: "ref_temp",
            type: "image",
            label: "Reference Immagine",
            customHandler: (file, srcUrl) => {
              const r = addDynamicRef(app, file, { srcUrl });
              onAdded?.(r);
              rerenderBar();
            }
          }, () => rerenderBar());
        }
      }, icon("image"), el("div", {}, el("b", { style: { display: "block" } }, "Immagine Reference"), el("small", { class: "dim" }, "Foto, Concept, Texture, Character"))),
      el("button", {
        class: "opt",
        type: "button",
        onclick: () => {
          closePopover();
          openLibraryPicker(app, {
            id: "ref_temp",
            type: "video",
            label: "Reference Video",
            customHandler: (file, srcUrl) => {
              const r = addDynamicRef(app, file, { srcUrl });
              onAdded?.(r);
              rerenderBar();
            }
          }, () => rerenderBar());
        }
      }, icon("video"), el("div", {}, el("b", { style: { display: "block" } }, "Video Reference"), el("small", { class: "dim" }, "Motion, Guida 3D, Previs, Animazione")))
    );
    popover(document.activeElement || prompt, pop, { width: 300 });
  };

  const acPopup = el("div", { class: "ref-autocomplete-pop", hidden: true });

  const checkAutocomplete = () => {
    if (!isDynRefApp || !prompt) return;
    const text = prompt.value;
    const pos = prompt.selectionStart;
    const before = text.slice(0, pos);
    const match = /@([a-zA-Z0-9_]*)$/.exec(before);
    if (!match) {
      acPopup.hidden = true;
      return;
    }
    const query = match[1].toLowerCase();
    const refs = f.dynamicRefs || [];
    const filtered = refs.filter((r) => r.tag.toLowerCase().includes(query) || r.name.toLowerCase().includes(query));

    const items = [];
    if (filtered.length) {
      items.push(el("div", { class: "ac-header" }, "Riferimenti disponibili (@tag):"));
      for (const r of filtered) {
        const thumbEl = r.type === "image"
          ? el("img", { src: r.url, class: "ac-thumb", alt: r.name })
          : el("video", { src: `${r.url}#t=0.1`, muted: true, class: "ac-thumb" });
        items.push(el("button", {
          class: "ac-item",
          type: "button",
          onmousedown: (e) => {
            e.preventDefault();
            insertTagIntoPrompt(r.tag, match[0].length);
            acPopup.hidden = true;
          }
        }, thumbEl, el("b", { class: "ac-tag" }, r.tag), el("span", { class: "ac-name" }, r.name), el("span", { class: "ac-type" }, r.type === "video" ? "Video" : "Foto")));
      }
    } else if (refs.length) {
      items.push(el("div", { class: "ac-header dim" }, `Nessuna reference corrisponde a "@${query}"`));
    } else {
      items.push(el("div", { class: "ac-header dim" }, "Nessuna reference ancora aggiunta"));
    }

    items.push(el("button", {
      class: "ac-item ac-add",
      type: "button",
      onmousedown: (e) => {
        e.preventDefault();
        acPopup.hidden = true;
        triggerAddRef((newRef) => {
          if (newRef) insertTagIntoPrompt(newRef.tag, match[0].length);
        });
      }
    }, icon("plus"), el("span", { style: { fontWeight: "600" } }, "+ Aggiungi nuova reference (Immagine/Video)...")));

    acPopup.replaceChildren(...items);
    acPopup.hidden = false;
  };

  if (prompt) {
    prompt.addEventListener("input", () => {
      f.values[pi.id] = prompt.value;
      grow();
      prompt.classList.remove("missing");
      persistSoon();
      checkAutocomplete();
    });
    prompt.addEventListener("click", checkAutocomplete);
    prompt.addEventListener("keyup", (e) => {
      if (e.key === "Escape") {
        acPopup.hidden = true;
        return;
      }
      checkAutocomplete();
    });
    prompt.addEventListener("keydown", (e) => {
      if (!acPopup.hidden && (e.key === "Enter" || e.key === "Tab")) {
        const firstItem = acPopup.querySelector(".ac-item");
        if (firstItem) {
          e.preventDefault();
          firstItem.dispatchEvent(new MouseEvent("mousedown"));
          return;
        }
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
    });
    prompt.addEventListener("blur", () => {
      setTimeout(() => { acPopup.hidden = true; }, 200);
    });
    requestAnimationFrame(grow);
  }

  const attachChildren = [];
  // Render static media inputs if present
  for (const inp of mediaInputs) {
    const x = f.files[inp.id];
    const isTag = inp.label.includes("(@");
    const tagText = isTag ? `@${inp.id}` : inp.label;
    if (!x) {
      attachChildren.push(el("button", { class: "att need", type: "button", title: `${t("ws.add", { what: inp.label })}${inp.required ? "" : ` (${t("ws.optional")})`}`,
        "aria-label": t("ws.add", { what: inp.label }), dataset: { slot: inp.id }, onclick: () => pick(inp) },
        icon(inp.type === "image" ? "image" : inp.type),
        isTag ? el("span", { style: { fontSize: "10.5px", fontWeight: "700", color: "var(--accent, #e5ff54)", marginTop: "2px" } }, tagText) : null
      ));
    } else {
      const m = inp.type === "image" ? el("img", { src: x.url, alt: "" }) : inp.type === "video" ? el("video", { src: `${x.url}#t=0.1`, muted: true, preload: "metadata" }) : el("span", { style: { display: "grid", placeItems: "center", height: "100%" } }, icon("audio"));
      attachChildren.push(el("div", { class: "att", title: x.file.name },
        m, el("span", { class: "lbl" }, isTag ? tagText : inp.label),
        el("button", { class: "x", type: "button", "aria-label": t("ws.remove"), onclick: () => { clearFile(app, inp.id); rerenderBar(); } }, icon("x"))));
    }
  }

  // Render dynamic references if app supports them
  if (isDynRefApp) {
    for (const ref of f.dynamicRefs) {
      const m = ref.type === "image"
        ? el("img", { src: ref.url, alt: ref.name })
        : el("video", { src: `${ref.url}#t=0.1`, muted: true, preload: "metadata" });

      const attCard = el("div", {
        class: "att ref-att",
        title: `${ref.tag} · ${ref.name} (Clicca per inserire nel prompt)`,
        onclick: () => insertTagIntoPrompt(ref.tag)
      },
        m,
        el("button", {
          class: "ref-tag-badge",
          type: "button",
          onclick: (e) => { e.stopPropagation(); insertTagIntoPrompt(ref.tag); }
        }, ref.tag),
        el("button", {
          class: "x",
          type: "button",
          title: `Rimuovi ${ref.tag}`,
          onclick: (e) => { e.stopPropagation(); removeDynamicRef(app, ref.id); rerenderBar(); }
        }, icon("x"))
      );
      attachChildren.push(attCard);
    }

    // Always append the + Reference button to allow infinite references
    attachChildren.push(el("button", {
      class: "att need add-ref-card",
      type: "button",
      dataset: { slot: "add-ref" },
      title: "Aggiungi altra Reference (infiniti slot disponibili)",
      onclick: () => triggerAddRef()
    }, icon("plus"), el("span", { class: "add-ref-lbl" }, "+ Ref")));
  }

  const attach = el("div", { class: "cmp-attach" }, ...attachChildren);

  let promptWrap;
  if (isDynRefApp && pi) {
    const refChips = f.dynamicRefs.map((r) => el("button", {
      class: "ref-chip",
      type: "button",
      title: `Clicca per inserire ${r.tag} nel prompt`,
      onclick: () => insertTagIntoPrompt(r.tag)
    }, icon(r.type === "image" ? "image" : "video"), el("b", { class: "accent-tag" }, r.tag), el("span", { class: "ref-name" }, r.name)));

    const addTagBtn = el("button", {
      class: "ref-chip ref-chip-add",
      type: "button",
      title: "Aggiungi altra reference (infiniti slot disponibili)",
      onclick: () => triggerAddRef()
    }, icon("plus"), "Aggiungi Reference");

    const refTagBar = el("div", { class: "ref-tag-bar" },
      el("span", { class: "ref-tag-title" }, icon("spark"), "Tag @:"),
      ...refChips,
      addTagBtn
    );

    promptWrap = el("div", { class: "cmp-prompt-wrap" },
      refTagBar,
      prompt,
      acPopup
    );
  } else {
    promptWrap = el("div", { class: "cmp-prompt-wrap" }, prompt || el("div", { class: "cmp-prompt dim", style: { paddingTop: "16px" } }, app.summary));
  }

  const chips = [];
  if (mediaInputs.length) {
    chips.push(el("button", { class: "chip square", type: "button", title: t("ws.add", { what: mediaInputs[0].label }), "aria-label": t("ws.add", { what: mediaInputs[0].label }),
      onclick: (ev) => {
        const empty = mediaInputs.filter((i) => !f.files[i.id]);
        if (mediaInputs.length === 1 || empty.length === 1) return pick(empty[0] || mediaInputs[0]);
        popover(ev.currentTarget, el("div", {}, ...mediaInputs.map((inp) => el("button", { class: "opt", type: "button", onclick: () => { closePopover(); pick(inp); } },
          icon(inp.type === "image" ? "image" : inp.type), inp.label))));
      } }, icon("plus")));
  }
  const modes = modeSwitch(app);
  if (modes) chips.push(modes);

  if (isDynRefApp) {
    chips.push(el("button", {
      class: `chip${f.dynamicRefs.length ? " filled" : ""}`,
      type: "button",
      title: "Riferimenti @tag",
      onclick: (ev) => {
        if (!f.dynamicRefs.length) {
          triggerAddRef();
          return;
        }
        popover(ev.currentTarget, el("div", {},
          el("h4", {}, "Inserisci Tag nel Prompt"),
          ...f.dynamicRefs.map((r) => el("button", {
            class: "opt",
            type: "button",
            onclick: () => {
              closePopover();
              insertTagIntoPrompt(r.tag);
            }
          }, icon(r.type === "image" ? "image" : "video"), el("b", { style: { color: "var(--accent, #e5ff54)" } }, r.tag), el("span", { class: "dim", style: { marginLeft: "auto", fontSize: "12px" } }, r.name))),
          el("button", {
            class: "opt",
            type: "button",
            style: { borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "4px", paddingTop: "8px" },
            onclick: () => { closePopover(); triggerAddRef(); }
          }, icon("plus"), el("b", { style: { color: "var(--accent, #e5ff54)" } }, "+ Aggiungi Nuova Reference"))
        ), { width: 280 });
      }
    }, el("span", { class: "k" }, "@tags"), el("span", { class: "v" }, f.dynamicRefs.length ? `${f.dynamicRefs.length} ref` : "Add @ref")));
  } else if (app.id === "director") {
    const tagHelper = el("button", { class: "chip", type: "button", title: "Inserisci tag reference",
      onclick: (ev) => {
        popover(ev.currentTarget, el("div", {},
          el("h4", {}, "Inserisci Tag nel Prompt"),
          ...mediaInputs.map((inp) => el("button", {
            class: "opt",
            type: "button",
            onclick: () => {
              closePopover();
              if (!prompt) return;
              const tag = `@${inp.id}`;
              insertTagIntoPrompt(tag);
            }
          }, icon(inp.type === "image" ? "image" : inp.type), el("b", { style: { color: "var(--accent, #e5ff54)" } }, `@${inp.id}`), el("span", { class: "dim", style: { marginLeft: "auto", fontSize: "12px" } }, inp.label.replace(/\s*\(@.*\)/, ""))))
        ), { width: 260 });
      }
    }, el("span", { class: "k" }, "@tags"), el("span", { class: "v" }, "Insert @ref"));
    chips.push(tagHelper);
  }
  const model = el("button", { class: "chip model", type: "button", "aria-haspopup": "dialog", title: t("ws.explore.apps"),
    onclick: (ev) => popover(ev.currentTarget, switcher(app), { width: 520, cls: "drawer-pop" }) },
    icon("grid"), el("span", { class: "v" }, `${app.name} ▾`));
  chips.push(model);

  for (const inp of app.inputs) {
    if (isMedia(inp.type) || inp === pi) continue;
    chips.push(chipFor(app, inp, f));
  }
  if (app.presets?.length) {
    const presetChip = el("button", { class: `chip${f.preset ? " filled" : ""}`, type: "button" }, el("span", { class: "k" }, t("ws.preset")),
      el("span", { class: "v" }, f.preset ? app.presets.find((p) => p.id === f.preset)?.label : t("ws.preset.none")));
    presetChip.onclick = (ev) => popover(ev.currentTarget, el("div", {}, el("h4", {}, t("ws.preset")),
      ...[{ id: "", label: t("ws.preset.none") }, ...app.presets].map((p) => el("button", { class: "opt", type: "button", "aria-selected": String(f.preset === p.id),
        onclick: () => { f.preset = p.id; persist(app); closePopover(); rerenderBar(); } }, p.label, el("span", { class: "chk" }, icon("check"))))));
    chips.push(presetChip);
  }

  const ui = {
    clearMissing: () => { prompt?.classList.remove("missing"); attach.querySelectorAll(".missing").forEach((n) => n.classList.remove("missing")); },
    markMissing: (id) => {
      if (pi && id === pi.id) { prompt.classList.add("missing"); prompt.focus(); }
      attach.querySelector(`[data-slot="${id}"]`)?.classList.add("missing");
    },
  };
  const go = async () => { if (await submit(app, ui) && wsTab !== "history") { wsTab = "history"; hooks.rerender?.(); } };
  const gen = genButton(app, go);
  if (!app.runnable) { hint.hidden = false; hint.textContent = app.status === "draft" ? t("ws.draft") : t("ws.noworkflow"); }

  const resizer = el("div", { class: "cmp-resizer", title: "Trascina verso l'alto per ingrandire il campo prompt" });
  let isResizingPrompt = false;
  let startResizingY = 0;
  let startPromptH = 0;

  const onPointerMove = (e) => {
    if (!isResizingPrompt || !prompt) return;
    const dy = startResizingY - e.clientY;
    const maxH = Math.max(200, window.innerHeight * 0.75);
    const newH = Math.max(48, Math.min(maxH, startPromptH + dy));
    f.customPromptHeight = newH;
    prompt.style.height = `${newH}px`;
  };

  const stopPromptResize = (e) => {
    if (!isResizingPrompt) return;
    isResizingPrompt = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopPromptResize);
    window.removeEventListener("pointercancel", stopPromptResize);
    try {
      if (e?.pointerId !== undefined && resizer.hasPointerCapture?.(e.pointerId)) {
        resizer.releasePointerCapture(e.pointerId);
      }
    } catch {}
    bar.classList.remove("resizing-h");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  resizer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !prompt) return;
    e.preventDefault();
    isResizingPrompt = true;
    startResizingY = e.clientY;
    startPromptH = prompt.getBoundingClientRect().height;
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {}
    bar.classList.add("resizing-h");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPromptResize);
    window.addEventListener("pointercancel", stopPromptResize);
  });

  const bar = el("div", { class: "composer" },
    resizer,
    hint,
    el("div", { class: "cmp-top" }, attach, promptWrap),
    el("div", { class: "cmp-row" }, ...chips, el("span", { class: "grow" }), countControl(f), gen),
    ...Object.values(pickers));

  if (isDynRefApp) {
    bar.addEventListener("dragover", (e) => {
      e.preventDefault();
      bar.classList.add("drag");
    });
    bar.addEventListener("dragleave", (e) => {
      if (e.currentTarget === bar) bar.classList.remove("drag");
    });
    bar.addEventListener("drop", (e) => {
      e.preventDefault();
      bar.classList.remove("drag");
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      let lastAdded = null;
      for (const file of files) {
        if (file.type?.startsWith("image/") || file.type?.startsWith("video/") || /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i.test(file.name)) {
          lastAdded = addDynamicRef(app, file);
        }
      }
      if (lastAdded) {
        rerenderBar();
        insertTagIntoPrompt(lastAdded.tag);
      }
    });
  }

  return bar;
}

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { for (const id of forms.keys()) { const a = byId.get(id); if (a) persist(a); } }, 400);
}

function chipFor(app, inp, f) {
  const set = (v) => { f.values[inp.id] = v; persistSoon(); };
  if (inp.type === "toggle") {
    const b = el("button", { class: `chip${f.values[inp.id] ? " on" : ""}`, type: "button", "aria-pressed": String(Boolean(f.values[inp.id])), title: inp.help || inp.label },
      icon(/enhance|reprompt/.test(inp.id) ? "wand" : "check"), inp.label);
    b.onclick = () => { set(!f.values[inp.id]); b.classList.toggle("on", Boolean(f.values[inp.id])); b.setAttribute("aria-pressed", String(Boolean(f.values[inp.id]))); };
    return b;
  }
  const v = el("span", { class: "v" });
  const displayLabel = t(`inp.${inp.id}`) !== `inp.${inp.id}` ? t(`inp.${inp.id}`) : inp.label;
  const b = el("button", { class: "chip", type: "button", "aria-haspopup": "dialog", title: inp.help || inp.label },
    inp.type === "seed" ? icon("dice") : el("span", { class: "k" }, displayLabel), v);
  const draw = () => {
    const val = f.values[inp.id];
    if (inp.type === "select") v.textContent = optionLabel(inp, val);
    else if (inp.type === "seed") v.textContent = val === -1 || val === "" ? t("ws.seed.random") : String(val);
    else if (inp.type === "textarea" || inp.type === "text") { v.textContent = String(val || "").trim() ? "✓" : "—"; b.classList.toggle("filled", Boolean(String(val || "").trim())); }
    else v.textContent = String(val);
  };
  draw();
  b.onclick = (ev) => {
    let content;
    if (inp.multiple) {
      content = multiPicker(inp, f, () => { persistSoon(); draw(); });
    } else if (inp.type === "select") {
      content = el("div", {}, el("h4", {}, inp.label), ...(inp.options || []).map((o) => el("button", { class: "opt", type: "button",
        "aria-selected": String(String(o.value) === String(f.values[inp.id])), onclick: () => { set(o.value); draw(); closePopover(); } },
        o.label, el("span", { class: "chk" }, icon("check")))));
    } else if (inp.type === "slider") {
      content = el("div", { class: "pad" }, rangeInput(inp, f.values[inp.id], (n) => { set(n); draw(); }), inp.help ? el("p", { class: "help" }, inp.help) : null);
    } else if (inp.type === "seed") {
      content = seedEditor(app, inp, f, () => { persistSoon(); draw(); });
    } else if (inp.type === "textarea") {
      const ta = el("textarea", { placeholder: inp.default ? t("ws.eg", { x: inp.default }) : inp.label, value: f.values[inp.id] ?? "" });
      ta.addEventListener("input", () => { set(ta.value); draw(); });
      content = el("div", { class: "pad" }, el("b", {}, inp.label), ta, inp.help ? el("p", { class: "help" }, inp.help) : null);
    } else {
      const box = el("input", { type: inp.type === "number" ? "number" : "text", min: inp.min, max: inp.max, step: inp.step, value: f.values[inp.id] ?? "",
        placeholder: inp.default !== undefined ? String(inp.default) : "" });
      box.addEventListener("input", () => { set(inp.type === "number" ? (box.value === "" ? "" : Number(box.value)) : box.value); draw(); });
      content = el("div", { class: "pad" }, el("b", {}, inp.label), box, inp.help ? el("p", { class: "help" }, inp.help) : null);
    }
    popover(ev.currentTarget, content, { width: inp.type === "textarea" ? 360 : undefined });
  };
  return b;
}

// ------------------------------------------------------------------ sidebar layout
/** An input painted over another image (inpaint's mask): opens the brush over that image. */
function paintZone(app, inp, rerender) {
  const f = formFor(app);
  const src = f.files[inp.paint];
  const srcInp = app.inputs.find((i) => i.id === inp.paint);
  const x = f.files[inp.id];
  const paint = async () => {
    if (!src) { toast(t("paint.first", { label: srcInp?.label || inp.paint }), { error: true }); return; }
    const file = await openPainter(src.file, { mask: x?.file || null, title: inp.label });
    if (file && setFile(app, inp, file)) rerender();
  };
  if (!x) {
    return el("div", { class: `drop paint${src ? "" : " off"}`, role: "button", tabindex: "0", dataset: { slot: inp.id }, "aria-label": t("paint.cta"),
      onclick: paint, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); paint(); } } },
      src ? el("img", { src: src.url, alt: "" }) : null,
      el("span", { class: "ic" }, icon("wand")),
      el("b", {}, inp.label),
      el("small", {}, src ? t("paint.cta") : t("paint.first", { label: srcInp?.label || inp.paint })),
      inp.help ? el("small", { class: "faint" }, inp.help) : null);
  }
  const zone = el("div", { class: "drop has", dataset: { slot: inp.id } },
    el("span", { class: "fname" }, inp.label),
    el("div", { class: "bar2" },
      el("button", { class: "mini", type: "button", title: t("paint.edit"), "aria-label": t("paint.edit"), onclick: paint }, icon("wand")),
      el("button", { class: "mini", type: "button", title: t("ws.remove"), "aria-label": t("ws.remove"), onclick: () => { clearFile(app, inp.id); rerender(); } }, icon("x"))));
  if (src) maskPreview(src.url, x.file).then((c) => zone.prepend(c)).catch(() => zone.prepend(el("img", { src: x.url, alt: "" })));
  else zone.prepend(el("img", { src: x.url, alt: "" }));
  return zone;
}

function dropzone(app, inp, rerender) {
  if (inp.paint) return paintZone(app, inp, rerender);
  const f = formFor(app);
  const x = f.files[inp.id];
  const input = el("input", { type: "file", accept: ACCEPT[inp.type], hidden: true });
  input.addEventListener("change", () => { if (input.files[0] && setFile(app, inp, input.files[0])) rerender(); input.value = ""; });
  const limits = [inp.limits?.max_mb ? t("ws.drop.mb", { mb: inp.limits.max_mb }) : "", inp.limits?.seconds ? t("ws.drop.seconds", { a: inp.limits.seconds[0], b: inp.limits.seconds[1] }) : ""].filter(Boolean).join(" · ");
  let zone;
  const triggerPick = () => {
    openLibraryPicker(app, inp, rerender);
  };
  const tagBadge = app.id === "director" ? el("span", {
    style: { display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "11.5px", fontWeight: "700", color: "#111", background: "var(--accent, #e5ff54)", marginBottom: "4px" }
  }, `@${inp.id}`) : null;
  if (!x) {
    const recent = feed.list().find((e) => {
      if (e.status !== "succeeded" || !e.outputs?.length) return false;
      const first = e.outputs[0];
      return (inp.type === "image" && first?.type === "image") ||
             (inp.type === "video" && first?.type === "video");
    });
    let quickPill = null;
    if (recent) {
      const it = entryItem(recent);
      const recentApp = byId.get(recent.app);
      const name = recentApp?.name || recent.app;
      quickPill = el("div", { class: "drop-quick-wrap" },
        el("button", {
          class: "drop-quick-pull",
          type: "button",
          title: t("ws.drop.last", { app: name }),
          onclick: async (e) => {
            e.stopPropagation();
            try {
              const ext = extOf(it.full) || (inp.type === "video" ? "mp4" : "png");
              const file = await fileFromUrl(it.full, `${recent.app || "output"}.${ext}`);
              if (setFile(app, inp, file)) rerender();
              toast(t("toast.loaded", { app: app.name }));
            } catch (err) {
              toast(err.message, { error: true });
            }
          }
        },
          it.card ? el("img", { class: "dqp-thumb", src: it.card, alt: "" }) : icon("clock"),
          el("span", { class: "dqp-text" }, t("ws.drop.last", { app: name }))
        )
      );
    }
    zone = el("div", { class: "drop", role: "button", tabindex: "0", dataset: { slot: inp.id }, "aria-label": t("ws.add", { what: inp.label }),
      onclick: triggerPick, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); triggerPick(); } } },
      el("span", { class: "ic" }, icon(inp.type === "image" ? "image" : inp.type === "video" ? "video" : "audio")),
      tagBadge,
      el("b", {}, inp.label, inp.required ? "" : el("span", { class: "faint", style: { fontWeight: 500 } }, ` · ${t("ws.optional")}`)),
      el("small", {}, inp.help || t(`ws.drop.${inp.type}`)),
      el("small", { class: "faint" }, [t("ws.drop.hint"), limits].filter(Boolean).join(" · ")),
      quickPill,
      input);
  } else {
    const media = inp.type === "image" ? el("img", { src: x.url, alt: "" })
      : inp.type === "video" ? el("video", { src: x.url, muted: true, loop: true, playsinline: true, autoplay: true, preload: "auto" })
        : el("audio", { src: x.url, controls: true, preload: "metadata" });
    if (inp.type === "video") media.muted = true;
    const warn = el("span", { class: "fname" }, x.file.name);
    if (inp.type === "video" && inp.limits?.seconds) {
      media.addEventListener("loadedmetadata", () => {
        const [a, b] = inp.limits.seconds;
        if (media.duration < a || media.duration > b) { warn.textContent = `${x.file.name} · ${media.duration.toFixed(1)} s (${a}–${b} s)`; warn.style.color = "var(--warn)"; }
      });
    }
    zone = el("div", { class: "drop has", dataset: { slot: inp.id } }, media, tagBadge, warn,
      el("div", { class: "bar2" },
        el("button", { class: "mini", type: "button", title: t("ws.replace"), "aria-label": t("ws.replace"), onclick: triggerPick }, icon("swap")),
        el("button", { class: "mini", type: "button", title: t("ws.remove"), "aria-label": t("ws.remove"), onclick: () => { clearFile(app, inp.id); rerender(); } }, icon("x"))),
      input);
  }
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove("over");
    const file = e.dataTransfer.files[0];
    if (file && setFile(app, inp, file)) rerender();
  });
  return zone;
}

function sideField(app, inp, f, ui) {
  const set = (v) => { f.values[inp.id] = v; persistSoon(); };
  const help = inp.help ? el("p", { class: "help" }, inp.help) : null;
  if (inp.type === "textarea") {
    const ta = el("textarea", { class: inp.required ? "" : "short", placeholder: inp.default ? t("ws.eg", { x: inp.default }) : inp.label, value: f.values[inp.id] ?? "", "aria-label": inp.label });
    ta.addEventListener("input", () => { set(ta.value); ta.classList.remove("missing"); });
    ui.refs[inp.id] = ta;
    let tagBar = null;
    if (app.id === "director") {
      const tags = [
        { tag: "@ref1", label: "Ref 1 (Video)", icon: "video" },
        { tag: "@ref2", label: "Ref 2", icon: "image" },
        { tag: "@ref3", label: "Ref 3", icon: "image" },
        { tag: "@ref4", label: "Ref 4", icon: "image" },
        { tag: "@ref5", label: "Ref 5", icon: "image" }
      ];
      tagBar = el("div", { class: "director-tag-bar", style: { display: "flex", gap: "6px", flexWrap: "wrap", margin: "6px 0" } },
        ...tags.map((tItem) => el("button", {
          class: "btn ghost mini",
          type: "button",
          style: { padding: "3px 8px", fontSize: "11.5px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" },
          title: `Inserisci ${tItem.tag} nel prompt`,
          onclick: (e) => {
            e.preventDefault();
            const start = ta.selectionStart ?? ta.value.length;
            const end = ta.selectionEnd ?? ta.value.length;
            const spaceBefore = start > 0 && !/\s$/.test(ta.value.slice(0, start)) ? " " : "";
            const spaceAfter = end < ta.value.length && !/^\s/.test(ta.value.slice(end)) ? " " : " ";
            const insert = `${spaceBefore}${tItem.tag}${spaceAfter}`;
            ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
            set(ta.value);
            ta.focus();
            const newPos = start + insert.length;
            ta.setSelectionRange(newPos, newPos);
          }
        }, icon(tItem.icon), el("b", { style: { color: "var(--accent, #e5ff54)" } }, tItem.tag), el("span", { style: { opacity: 0.8 } }, tItem.label)))
      );
    }
    return el("label", { class: "field" }, el("span", { class: "lbl" }, inp.label, inp.required ? null : el("small", {}, t("ws.optional"))), tagBar, ta, help);
  }
  if (inp.multiple) {
    const val = el("span", { class: "v" }, optionLabel(inp, f.values[inp.id]));
    const row = el("button", { class: "selrow", type: "button", "aria-haspopup": "dialog", "aria-label": inp.label }, val, icon("chevD"));
    row.onclick = () => popover(row, multiPicker(inp, f, () => { persistSoon(); val.textContent = optionLabel(inp, f.values[inp.id]); }), { width: Math.max(280, row.offsetWidth) });
    return el("div", { class: "field" }, el("span", { class: "lbl" }, inp.label), row, help);
  }
  if (inp.type === "select" && inp.gallery) return galleryField(app, inp, f, set, help);
  if (inp.type === "select") {
    const opts = inp.options || [];
    const short = opts.length <= 4 && opts.every((o) => String(o.label).length <= 12);
    if (short) {
      const seg = el("div", { class: "seg", role: "group", "aria-label": inp.label });
      const draw = () => seg.replaceChildren(...opts.map((o) => el("button", { type: "button", "aria-pressed": String(String(o.value) === String(f.values[inp.id])),
        onclick: () => { set(o.value); draw(); } }, o.label)));
      draw();
      return el("div", { class: "field" }, el("span", { class: "lbl" }, inp.label), seg, help);
    }
    const val = el("span", { class: "v" }, optionLabel(inp, f.values[inp.id]));
    const row = el("button", { class: "selrow", type: "button", "aria-haspopup": "dialog", "aria-label": inp.label }, val, icon("chevD"));
    row.onclick = () => popover(row, el("div", {}, el("h4", {}, inp.label), ...opts.map((o) => el("button", { class: "opt", type: "button",
      "aria-selected": String(String(o.value) === String(f.values[inp.id])), onclick: () => { set(o.value); val.textContent = o.label; closePopover(); } },
      o.label, el("span", { class: "chk" }, icon("check"))))), { width: Math.max(260, row.offsetWidth) });
    return el("div", { class: "field" }, el("span", { class: "lbl" }, inp.label), row, help);
  }
  if (inp.type === "slider") return el("div", { class: "field" }, rangeInput(inp, f.values[inp.id], set), help);
  if (inp.type === "toggle") {
    const box = el("input", { type: "checkbox", checked: Boolean(f.values[inp.id]), "aria-label": inp.label });
    box.addEventListener("change", () => set(box.checked));
    return el("label", { class: "field" }, el("span", { class: "togrow" }, el("span", { class: "t" }, el("b", { style: { fontSize: "13px" } }, inp.label),
      inp.help ? el("small", {}, inp.help) : null), el("span", { class: "switch" }, box, el("i"))));
  }
  if (inp.type === "seed") {
    const box = el("input", { type: "number", min: inp.min ?? 0, placeholder: t("ws.seed.random"), value: f.values[inp.id] === -1 ? "" : f.values[inp.id] ?? "", "aria-label": inp.label });
    box.addEventListener("input", () => set(box.value === "" ? -1 : Math.trunc(Number(box.value))));
    return el("label", { class: "field" }, el("span", { class: "lbl" }, inp.label || t("ws.seed"),
      el("button", { class: "mini", type: "button", title: t("ws.seed.random"), style: { width: "26px", height: "26px" }, onclick: (e) => { e.preventDefault(); box.value = ""; set(-1); } }, icon("dice"))),
      box, el("p", { class: "help" }, t("ws.seed.help")));
  }
  const box = el("input", { type: inp.type === "number" ? "number" : "text", min: inp.min, max: inp.max, step: inp.step, value: f.values[inp.id] ?? "",
    placeholder: inp.default !== undefined ? String(inp.default) : "", "aria-label": inp.label });
  box.addEventListener("input", () => set(inp.type === "number" ? (box.value === "" ? "" : Number(box.value)) : box.value));
  return el("label", { class: "field" }, el("span", { class: "lbl" }, inp.label, inp.required ? null : el("small", {}, t("ws.optional"))), box, help);
}

const isAdvanced = (inp) => inp.type === "seed" || /negative/.test(inp.id);

function presetField(app, f) {
  const opts = [{ id: "", label: t("ws.preset.none") }, ...app.presets];
  const seg = el("div", { class: "seg", role: "group", "aria-label": t("ws.preset") });
  const draw = () => seg.replaceChildren(...opts.map((p) => el("button", { type: "button", "aria-pressed": String(p.id === f.preset),
    onclick: () => { f.preset = p.id; persist(app); draw(); } }, p.label)));
  draw();
  return el("div", { class: "field" }, el("span", { class: "lbl" }, t("ws.preset")), seg);
}

function sidebarPanel(app, rerenderSide) {
  const f = formFor(app);
  const ui = { refs: {} };
  const isVid = videoTabOf(app.id) || app.section === "video";
  const tab = isVid ? videoTabOf(app.id) : imageTabOf(app.id);
  const tabList = isVid ? VIDEO_TABS : IMAGE_TABS;
  const prefix = isVid ? "vtab" : "itab";
  const tabs = tabList ? el("div", { class: "side-tabs", role: "tablist" }, ...tabList.map((vt) => el("button", { type: "button", role: "tab",
    "aria-selected": String(vt.id === tab),
    onclick: () => {
      if (vt.id === tab) return;
      const last = store.get(`last.${prefix}.${vt.id}`);
      const target = vt.apps.includes(last) && byId.has(last) ? last : vt.apps.find((id) => byId.has(id));
      if (target) location.hash = `#/app/${target}`;
    } }, t(`${prefix}.${vt.id}`)))) : null;

  const card = el("div", { class: "model-card", role: "button", tabindex: "0", "aria-label": `${t("ws.change")}: ${app.name}` });
  const ex = exampleItem(app);
  const cardMedia = thumb(ex, { play: "visible" });
  card.append(cardMedia, el("div", { class: "txt" }, el("h3", { class: "display" }, app.name), el("p", {}, tagline(app))));
  const change = el("button", { class: "change", type: "button" }, icon("swap"), t("ws.change"));
  const openSwitch = (ev) => { ev.stopPropagation(); popover(change, switcher(app), { width: 520, cls: "drawer-pop" }); };
  change.onclick = openSwitch;
  card.onclick = openSwitch;
  card.onkeydown = (e) => { if (e.key === "Enter") openSwitch(e); };
  card.append(change);

  const main = [], adv = [];
  for (const inp of app.inputs) {
    if (isMedia(inp.type)) main.push(dropzone(app, inp, rerenderSide));
    else (isAdvanced(inp) ? adv : main).push(sideField(app, inp, f, ui));
  }
  if (app.presets?.length) adv.unshift(presetField(app, f));
  const advanced = adv.length ? el("details", { class: "adv" }, el("summary", {}, t("ws.advanced"), icon("chevD", "i-chev")), el("div", { class: "in" }, ...adv)) : null;

  const scroll = el("div", { class: "side-scroll" }, card, modeSwitch(app), ...main, advanced);
  const note = el("p", { class: "side-note" }, !app.runnable ? (app.status === "draft" ? t("ws.draft") : t("ws.noworkflow")) : "");
  ui.clearMissing = () => { scroll.querySelectorAll(".missing").forEach((n) => n.classList.remove("missing")); };
  ui.markMissing = (id) => {
    const n = ui.refs[id] || scroll.querySelector(`[data-slot="${id}"]`);
    if (!n) return;
    n.classList.add("missing");
    n.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const go = async () => { if (await submit(app, ui) && wsTab !== "history") { wsTab = "history"; hooks.rerender?.(); } };
  const foot = el("div", { class: "side-foot" }, el("div", { class: "row" }, countControl(f), genButton(app, go)), note);
  const side = el("aside", { class: "side", "aria-label": app.name }, tabs, scroll, foot);
  side.addEventListener("dragover", (e) => e.preventDefault());
  side.addEventListener("drop", (e) => { e.preventDefault(); if (assignFiles(app, e.dataTransfer.files)) rerenderSide(); });
  return side;
}

// ------------------------------------------------------------------ main area: history, library, how it works
let wsTab = "history";
let dense = store.get("dense", false);

function relatedExamples(app) {
  const cat = categoryOf(app.id);
  const same = (CATEGORIES.find((c) => c.id === cat)?.apps || []).filter((id) => id !== app.id).map((id) => byId.get(id)).filter((a) => a?.example);
  const rest = apps.filter((a) => a.example?.full && a.id !== app.id && !same.includes(a) && a.section === app.section);
  return [...same, ...rest].slice(0, 12);
}

function exampleTiles(list, { onPick } = {}) {
  return list.map((a) => {
    const item = exampleItem(a);
    const m = thumb(item, { play: "visible" });
    const node = el("div", { class: "m-item", role: "button", tabindex: "0", onclick: () => onPick?.(a), onkeydown: (e) => { if (e.key === "Enter") onPick?.(a); } },
      m, el("div", { class: "cap" }, el("span", {}, a.name), icon("chevR")));
    return node;
  });
}

function heroFlow(app) {
  const item = exampleItem(app);
  if (!item) return null;
  const ins = item.inputs.slice(0, 2).map((i) => el("div", { class: "media" }, i.thumb ? el("img", { src: i.thumb, alt: i.label, title: i.label }) : el("span", { class: "typeicon" }, icon(i.type || "image"))));
  return el("div", { class: "flow" },
    ins.length ? el("div", { class: "ins" }, ...ins) : null,
    ins.length ? el("span", { class: "arrow" }, icon("chevR")) : null,
    el("div", { class: "out" }, thumb(item, { play: "visible", useFull: item.type === "video" })));
}

function composerCarousel(app) {
  const isVideo = app.section === "video" || app.id === "cinema-video";
  const targetType = isVideo ? "video" : "image";

  // Trigger loading all history if not loaded yet
  if (!feed.isLoaded("*")) {
    feed.load().catch(() => {});
  }

  const getItems = () => {
    // 1. History items matching targetType (succeeded with outputs, newest first)
    const histTarget = feed.list().filter((e) => {
      if (e.status !== "succeeded" || !e.outputs?.length) return false;
      const it = entryItem(e);
      return it && it.type === targetType;
    }).map(entryItem);

    // 2. Other history items (recent creations/modifications)
    const histOther = feed.list().filter((e) => {
      if (e.status !== "succeeded" || !e.outputs?.length) return false;
      const it = entryItem(e);
      return it && it.type !== targetType;
    }).map(entryItem);

    // 3. Showcase examples
    const exTarget = apps
      .filter((a) => a.example?.full && a.example.type === targetType)
      .map(exampleItem)
      .filter(Boolean);

    const exOther = apps
      .filter((a) => a.example?.full && a.example.type !== targetType)
      .map(exampleItem)
      .filter(Boolean);

    const seen = new Set();
    const result = [];
    for (const it of [...histTarget, ...histOther, ...exTarget, ...exOther]) {
      const key = it.key || it.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(it);
      if (result.length >= 10) break;
    }

    if (result.length === 2) {
      result.push(
        { ...result[0], key: `${result[0].key || result[0].id}_d1` },
        { ...result[1], key: `${result[1].key || result[1].id}_d2` }
      );
    }
    return result;
  };

  let items = getItems();
  let lastKeys = items.map((x) => x.key || x.id).join(",");

  const statusBanner = el("div", { class: "carousel-status-banner", style: { display: "none" } });
  const viewport = el("div", { class: "composer-carousel" });
  const dotsBox = el("div", { class: "carousel-dots" });
  const wrap = el("div", { class: "composer-carousel-wrap" }, statusBanner, viewport, dotsBox);

  let cur = 0;
  let timer = null;
  let isHovered = false;
  let slides = [];
  let dots = [];
  let lastFailedId = null;

  const updateStatus = () => {
    const active = feed.active().filter((e) => !app || e.app === app.id);
    if (active.length > 0) {
      const curActive = active[0];
      statusBanner.style.display = "inline-flex";
      statusBanner.className = "carousel-status-banner";
      statusBanner.replaceChildren(
        el("span", { class: "spin", style: { display: "inline-flex", animation: "spin 1s linear infinite" } }, icon("loader")),
        el("span", {}, statusText(curActive)),
        el("button", {
          class: "btn ghost small",
          type: "button",
          style: { padding: "2px 8px", fontSize: "11px", height: "auto" },
          onclick: () => feed.cancel(curActive.id)
        }, t("act.cancel"))
      );
      return;
    }
    const recentFailed = feed.list(app?.id).find((e) => e.status === "failed");
    if (recentFailed && recentFailed.id !== lastFailedId && (Date.now() - (recentFailed.completed_at || 0) < 30000)) {
      statusBanner.style.display = "inline-flex";
      statusBanner.className = "carousel-status-banner err";
      statusBanner.replaceChildren(
        icon("alert"),
        el("span", {}, recentFailed.error || t("status.failed")),
        el("button", {
          class: "icon-btn mini",
          type: "button",
          "aria-label": t("act.close"),
          onclick: () => { lastFailedId = recentFailed.id; statusBanner.style.display = "none"; }
        }, icon("x"))
      );
      return;
    }
    statusBanner.style.display = "none";
  };

  function syncMedia(index) {
    slides.forEach((sl, i) => {
      const vid = sl.querySelector("video");
      if (vid) {
        if (i === index) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
          try { vid.currentTime = 0; } catch {}
        }
      }
    });
  }

  function updateSlides() {
    const count = items.length;
    if (count <= 1) {
      slides[0]?.classList.add("is-center", "is-single");
      dots.forEach((d, i) => d.classList.toggle("active", i === cur));
      syncMedia(cur);
      return;
    }

    const prevIdx = (cur - 1 + count) % count;
    const nextIdx = (cur + 1) % count;

    slides.forEach((sl, i) => {
      sl.className = "carousel-slide";
      if (i === cur) {
        sl.classList.add("is-center");
        sl.setAttribute("aria-hidden", "false");
        sl.tabIndex = 0;
      } else if (i === prevIdx) {
        sl.classList.add("is-prev");
        sl.setAttribute("aria-hidden", "false");
        sl.tabIndex = 0;
      } else if (i === nextIdx) {
        sl.classList.add("is-next");
        sl.setAttribute("aria-hidden", "false");
        sl.tabIndex = 0;
      } else {
        const distFwd = (i - cur + count) % count;
        if (distFwd <= count / 2) {
          sl.classList.add("is-hidden-right");
        } else {
          sl.classList.add("is-hidden-left");
        }
        sl.setAttribute("aria-hidden", "true");
        sl.tabIndex = -1;
      }
    });

    dots.forEach((d, i) => d.classList.toggle("active", i === cur));
    syncMedia(cur);
  }

  function goTo(index) {
    const count = items.length;
    cur = (index + count) % count;
    updateSlides();
    restartTimer();
  }

  function tick() {
    if (!wrap.isConnected) {
      clearInterval(timer);
      return;
    }
    if (!isHovered && items.length > 1) {
      goTo(cur + 1);
    }
  }

  function restartTimer() {
    clearInterval(timer);
    if (items.length > 1) {
      timer = setInterval(tick, 3500);
    }
  }

  const prevBtn = el("button", {
    class: "car-arrow prev",
    type: "button",
    "aria-label": t("act.prev"),
    onclick: (ev) => { ev.stopPropagation(); goTo(cur - 1); }
  }, icon("chevL"));

  const nextBtn = el("button", {
    class: "car-arrow next",
    type: "button",
    "aria-label": t("act.next"),
    onclick: (ev) => { ev.stopPropagation(); goTo(cur + 1); }
  }, icon("chevR"));

  const buildUI = () => {
    const count = items.length;
    dotsBox.hidden = count <= 1;

    slides = items.map((it, idx) => {
      const appInfo = byId.get(it.app);
      const mediaNode = thumb(it, { play: "none", useFull: it.type === "video" });
      const tag = el("span", { class: "slide-tag" }, appInfo?.name || (it.kind === "history" ? t("nav.library") : t("tag.featured")));
      const editBtn = it.type === "image" ? el("button", {
        class: "mini slide-edit",
        type: "button",
        title: "Edit in Edit Image",
        "aria-label": "Edit",
        onclick: (ev) => {
          ev.stopPropagation();
          sendToEdit(it);
        }
      }, icon("edit")) : null;
      const topRow = el("div", { class: "slide-top-row" }, tag, editBtn);
      const prompt = it.values?.prompt || it.values?.scene || "";
      const pNode = prompt ? el("div", { class: "slide-prompt", title: prompt }, prompt) : null;
      const qb = el("div", { class: "slide-quick-bar" },
        el("button", {
          class: "sqb-btn",
          type: "button",
          title: t("act.usein") || "Invia ad un'altra app",
          onclick: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            useIn(ev.currentTarget, it);
          }
        }, icon("send"), el("span", {}, "INVIA A…")),
        el("button", {
          class: "sqb-btn",
          type: "button",
          title: "Invia all'Editor Video (Timeline)",
          onclick: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            sendToVideoEditor(it);
          }
        }, icon("film"), el("span", {}, "EDITOR VIDEO"))
      );
      const ov = el("div", { class: "slide-ov" }, topRow, pNode, qb);

      const slide = el("div", {
        class: "carousel-slide",
        role: "button",
        tabindex: "0",
        "aria-label": `${appInfo?.name ?? ""} (${idx + 1}/${count})`,
        onclick: () => {
          if (slide.classList.contains("is-center") || count <= 1) {
            hooks.open?.(items, it.key || it.id);
          } else if (slide.classList.contains("is-prev")) {
            goTo(cur - 1);
          } else if (slide.classList.contains("is-next")) {
            goTo(cur + 1);
          }
        },
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            hooks.open?.(items, it.key || it.id);
          }
        }
      }, mediaNode, ov);
      return slide;
    });

    dots = items.map((_, i) => el("button", {
      class: `car-dot${i === cur ? " active" : ""}`,
      type: "button",
      "aria-label": `Slide ${i + 1}`,
      onclick: (ev) => {
        ev.stopPropagation();
        goTo(i);
      }
    }));

    if (count <= 1) {
      prevBtn.hidden = true;
      nextBtn.hidden = true;
    } else {
      prevBtn.hidden = false;
      nextBtn.hidden = false;
    }

    viewport.replaceChildren(...slides, prevBtn, nextBtn);
    dotsBox.replaceChildren(...dots);
    updateSlides();
    updateStatus();
  };

  buildUI();

  viewport.addEventListener("mouseenter", () => { isHovered = true; });
  viewport.addEventListener("mouseleave", () => { isHovered = false; });

  let touchStartX = 0;
  let touchDiff = 0;
  viewport.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchDiff = 0;
    isHovered = true;
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    touchDiff = e.touches[0].clientX - touchStartX;
  }, { passive: true });

  viewport.addEventListener("touchend", () => {
    isHovered = false;
    if (touchDiff > 40) goTo(cur - 1);
    else if (touchDiff < -40) goTo(cur + 1);
  });

  const unfeed = feed.on(() => {
    if (!wrap.isConnected) return;
    updateStatus();
    const freshItems = getItems();
    const freshKeys = freshItems.map((x) => x.key || x.id).join(",");
    if (freshKeys !== lastKeys) {
      items = freshItems;
      lastKeys = freshKeys;
      cur = 0; // spotlight the newly generated or modified creation!
      buildUI();
      restartTimer();
    }
  });

  wrap._dispose = () => {
    unfeed();
    clearInterval(timer);
  };

  setTimeout(() => {
    if (wrap.isConnected) {
      updateSlides();
      updateStatus();
      restartTimer();
    }
  }, 80);

  return wrap;
}

function valueRows(app, values) {
  const labels = Object.fromEntries(app.inputs.map((i) => [i.id, i]));
  const pi = promptInput(app);
  return Object.entries(values || {}).filter(([k, v]) => labels[k] && labels[k] !== pi && labels[k].type !== "seed" && v !== "" && v !== null && v !== undefined)
    .flatMap(([k, v]) => [el("dt", {}, labels[k].label), el("dd", {}, labels[k].type === "select" ? optionLabel(labels[k], v) : labels[k].type === "toggle" ? (v === true || v === "true" ? "✓" : "—") : String(v))]);
}

function libraryTab(app) {
  const item = exampleItem(app);
  const wrap = el("div", { style: { display: "grid", gap: "8px" } });
  if (item) {
    const pi = promptInput(app);
    const prompt = pi ? item.values?.[pi.id] : null;
    wrap.append(el("section", { class: "ex-big" },
      el("div", { class: "stage" }, fullMedia(item.type, item.full, { poster: item.poster, autoplay: false })),
      el("div", { class: "side2" },
        el("div", {}, el("span", { class: "tag ghost" }, t("ws.example")), el("h2", { class: "display", style: { margin: "10px 0 0", fontSize: "26px" } }, app.name)),
        prompt ? el("div", { class: "prompt", style: { padding: "12px", borderRadius: "12px", background: "#1b1b1e", fontSize: "13.5px" } }, prompt) : null,
        item.inputs.length ? el("div", { class: "ins-row" }, ...item.inputs.map((i) => el("figure", {},
          el("div", { class: "media" }, i.thumb ? el("img", { src: i.thumb, alt: "" }) : el("span", { class: "typeicon" }, icon(i.type || "image"))), el("figcaption", {}, i.label)))) : null,
        el("dl", { class: "vals" }, ...valueRows(app, item.values)),
        el("div", { class: "statline" },
          item.seconds ? el("span", {}, icon("clock"), fmtSeconds(item.seconds)) : null,
          item.gpu ? el("span", {}, icon("chip"), item.gpu.split(",")[0]) : null,
          item.peak ? el("span", {}, t("view.peak", { gb: item.peak })) : null,
          item.seed !== null && item.seed !== undefined ? el("span", {}, icon("dice"), item.seed) : null),
        el("div", { class: "row", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          el("button", { class: "btn lime", type: "button", onclick: () => recreate(item) }, icon("redo"), t("ws.useex")),
          el("button", { class: "btn ghost", type: "button", onclick: () => hooks.compare?.(item) }, icon("compare"), t("act.compare")),
          flagButton(flags.key(app.id))))));
  }
  const related = relatedExamples(app);
  if (related.length) {
    const grid = el("div");
    masonry(grid, exampleTiles(related, { onPick: (a) => { location.hash = `#/app/${a.id}`; } }), { min: 230 });
    wrap.append(el("div", { class: "sec-head" }, el("h2", { class: "display" }, t("ws.related"))), grid);
  }
  if (!item && !related.length) wrap.append(el("div", { class: "empty" }, t("explore.noex")));
  return wrap;
}

function vramBars(app) {
  const v = app.vram;
  if (!v) return null;
  const peak = app.example?.peak_vram_gb ?? null;
  const max = Math.max(48, v.whole_gb, peak || 0) * 1.05;
  const pct = (gb) => `${Math.min(100, (gb / max) * 100)}%`;
  const ticks = [24, 48].map((g) => el("u", { style: { left: pct(g) }, title: `${g} GB` }));
  const row = (label, gb, cls) => el("div", { style: { display: "grid", gap: "6px" } },
    el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12.5px" } }, el("span", { class: "dim" }, label), el("b", {}, `${gb} GB`)),
    el("div", { class: "vbar" }, el("i", { class: cls, style: { width: pct(gb) } }), ...ticks));
  const fit = fitOf(app);
  return el("div", { class: "card" }, el("h3", {}, icon("chip"), t("how.vram"), fit ? el("span", { class: `fit ${fit[1]}`, style: { marginLeft: "auto" } }, t(fit[0])) : null),
    row(t("how.whole"), v.whole_gb, "whole"), row(t("how.phase"), v.largest_phase_gb, ""),
    peak ? row(`${t("how.measured")} (${(app.example.gpu || "").split(",")[0]})`, peak, "whole") : null,
    el("div", { class: "vscale" }, el("span", { style: { left: pct(24) } }, "24 GB"), el("span", { style: { left: pct(48) } }, "48 GB")));
}

function cliLine(app) {
  const parts = ["npm run app --", app.id];
  for (const inp of app.inputs) {
    if (isMedia(inp.type)) { if (inp.required) parts.push(`--file ${inp.id}=my-${inp.type}.${inp.type === "image" ? "jpg" : inp.type === "video" ? "mp4" : "mp3"}`); continue; }
    if (inp.required && inp.type === "textarea") parts.push(`--set ${inp.id}="${String(inp.default || "…").slice(0, 40)}"`);
  }
  return parts.join(" ");
}

function howTab(app) {
  const total = app.models.filter((m) => !m.optional).reduce((s, m) => s + m.gb, 0);
  return el("div", { class: "how-grid" },
    el("div", { class: "card" }, el("h3", {}, icon("layers"), t("how.pipeline")), el("p", {}, t("how.pipeline.d", { id: app.id })),
      el("div", { class: "statline" }, el("span", {}, `${t("how.pack")}: ${app.pack}`), el("span", {}, app.status === "ready" ? "ready" : t("tag.draft")),
        app.higgsfield_feature ? el("span", {}, `${t("how.equiv")}: ${app.higgsfield_feature}`) : null),
      app.runnable || app.status === "draft" ? el("p", { class: "row" }, el("a", { class: "btn small", href: `/api/apps/${app.id}/workflow`, download: `wox-${app.id}.json` },
        icon("download"), t("how.workflow")), el("span", { class: "dim", style: { fontSize: "12.5px" } }, t("how.workflow.d"))) : null,
      el("p", {}, t("how.download")), el("pre", { class: "code" }, `modal run infra/modal_app.py::download --pack ${app.pack}`),
      el("p", {}, t("how.cli")), el("pre", { class: "code" }, cliLine(app))),
    app.models.length ? el("div", { class: "card" }, el("h3", {}, icon("box"), t("how.models"), el("span", { class: "dim", style: { marginLeft: "auto", fontWeight: 500 } }, t("how.total", { gb: total.toFixed(1) }))),
      el("table", { class: "models" }, el("tbody", {}, ...app.models.map((m) => el("tr", {},
        el("td", {}, el("div", {}, m.name), el("small", { class: "dim" }, [m.repo, m.license, m.gated ? t("how.gated") : "", m.optional ? t("how.optional") : ""].filter(Boolean).join(" · "))),
        el("td", { class: "r" }, `${m.gb} GB`)))))) : null,
    vramBars(app),
    app.notes || app.credits?.length ? el("div", { class: "card" },
      app.notes ? el("h3", {}, icon("info"), t("how.notes")) : null, app.notes ? el("p", {}, app.notes) : null,
      app.credits?.length ? el("h3", {}, t("how.credits")) : null, app.credits?.length ? el("p", {}, app.credits.join(" · ")) : null) : null);
}

function mainArea(app, layout, disposers) {
  const body = el("div", { class: "ws-body", style: { display: "flex", flexDirection: "column", flex: "1", minHeight: "0" } });
  const tabs = el("div", { class: "tabs", role: "tablist" });
  let disposeBody = null;
  const draw = () => {
    tabs.replaceChildren(...[["history", "clock"], ["library", "film"], ["how", "info"]].map(([id, ic]) => el("button", { type: "button", role: "tab",
      "aria-selected": String(wsTab === id), onclick: () => { wsTab = id; draw(); } }, icon(ic), t(`ws.${id}`))));
    disposeBody?.();
    disposeBody = null;
    if (wsTab === "history") {
      const carouselWrap = composerCarousel(app);
      body.replaceChildren(carouselWrap);
      disposeBody = () => {
        carouselWrap._dispose?.();
      };
    } else {
      body.replaceChildren(wsTab === "library" ? libraryTab(app) : howTab(app));
    }
  };
  draw();
  disposers.push(() => disposeBody?.());
  return el("section", { class: "ws-main" }, el("div", { class: "ws-top" }, tabs), body);
}

// ------------------------------------------------------------------ the view
export function workspaceView(appId) {
  const app = byId.get(appId);
  if (!app) return { node: el("div", { class: "page" }, el("div", { class: "empty" }, `${appId}?`)), active: "apps" };
  rememberApp(app);
  const vt = videoTabOf(app.id);
  if (vt) store.set(`last.vtab.${vt}`, app.id);
  const layout = layoutOf(app);
  const disposers = [];
  const root = el("div", { class: `ws l-${layout}` });

  if (layout === "composer") {
    let bar = null;
    const drawBar = () => { const next = composerBar(app, drawBar); bar ? bar.replaceWith(next) : null; bar = next; if (!bar.isConnected) root.append(bar); };
    root.append(mainArea(app, layout, disposers));
    drawBar();
    // drop files anywhere on the page
    const over = (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); bar.classList.add("drag"); } };
    const leave = (e) => { if (!e.relatedTarget) bar.classList.remove("drag"); };
    const drop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); bar.classList.remove("drag"); if (assignFiles(app, e.dataTransfer.files)) drawBar(); };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    disposers.push(() => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); });
    disposers.push(() => bar?.remove());
    const paste = (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length && assignFiles(app, files)) { e.preventDefault(); drawBar(); } };
    document.addEventListener("paste", paste);
    disposers.push(() => document.removeEventListener("paste", paste));
  } else {
    let side = null;
    const drawSide = () => {
      const scrollTop = side?.querySelector(".side-scroll")?.scrollTop || 0;
      const next = sidebarPanel(app, drawSide);
      if (side) side.replaceWith(next); else root.prepend(next);
      side = next;
      side.querySelector(".side-scroll").scrollTop = scrollTop;
    };
    root.append(mainArea(app, layout, disposers));
    drawSide();
    const paste = (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length && assignFiles(app, files)) { e.preventDefault(); drawSide(); } };
    document.addEventListener("paste", paste);
    disposers.push(() => document.removeEventListener("paste", paste));
  }
  return { node: root, dispose: () => disposers.forEach((d) => d()), app };
}

/** For the viewer's "Recreate" and the feed's "Try again". */
export function setTab(tab) { wsTab = tab; }
export { submit as submitApp, hoverPlay, playWhenVisible };
