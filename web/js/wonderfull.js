// Wonderfull FaceApp-style Studio UI:
// 1. Load photo (Galleria / Library / Demo / Drag & Drop / Quick Handoff)
// 2. Detect faces automatically (/api/wonderfull/detect-faces)
// 3. Click a detected face (or "Tutta la foto") to unlock FaceApp-style edit categories
// 4. Open a category strip (Sorrisi, Impressione, Età, Barbe, Capelli, Contouring, Colori, Extra)
// 5. Pick style & intensity (1-4), hit Applica -> crops/edits face or grades full image -> seamless composite
// 6. Compare (<|> hold/split), stack more edits, undo/reset, download or save to Library.

import { api, el, icon, popover, toast } from "./util.js";
import { feed, hooks, isDone, statusText } from "./feed.js";
import { apps } from "./catalog.js";
import { t } from "./i18n.js";

const FACEAPP_CATEGORIES = [
  { id: "smile", inputId: "smile", label: "Sorrisi", scope: "face", hasIntensity: false, multi: false },
  { id: "impression", inputId: "impression", label: "Impressione", badge: "PRO", scope: "face", hasIntensity: true, multi: false },
  { id: "age", inputId: "age", label: "Età", scope: "face", hasIntensity: true, multi: false },
  { id: "beard", inputId: "beard", label: "Barbe", scope: "face", hasIntensity: false, multi: false },
  { id: "hair_style", inputId: "hair_style", label: "Capelli", scope: "face", hasIntensity: false, multi: false },
  { id: "contouring", inputId: "contouring", label: "Contouring", badge: "MULTI", scope: "face", hasIntensity: true, multi: true },
  { id: "color_effect", inputId: "color_effect", label: "Colori", scope: "full", hasIntensity: true, multi: false },
  { id: "details", inputId: "details", label: "Extra AI", scope: "face", hasIntensity: true, multi: false, isText: true },
];

const OPTION_FILTERS = {
  "Armonia Viva": "contrast(1.08) saturate(1.18) brightness(1.03)",
  "Aero": "brightness(1.08) contrast(1.05) saturate(1.08) sepia(0.08)",
  "Freddo": "saturate(0.92) hue-rotate(8deg) brightness(1.04) contrast(1.06)",
  "Autunno": "sepia(0.28) saturate(1.25) contrast(1.06)",
  "Tonici Blu": "contrast(1.1) saturate(0.95) hue-rotate(-10deg)",
  "Golden Hour": "sepia(0.22) saturate(1.32) brightness(1.05)",
  "Teal & Orange": "contrast(1.15) saturate(1.22)",
  "Bianco & Nero": "grayscale(1) contrast(1.25)",
};

const OPTION_EMOJI = {
  "Originale": "📷",
  "Classico": "🙂",
  "Ampio": "😄",
  "Stretto": "😌",
  "Bei Denti": "😁",
  "Turbo": "🤩",
  "Chiuso": "😶",
  "Bacio": "☀️",
  "Hollywood": "🌟",
  "Carino": "🌸",
  "Fascino": "✨",
  "Star": "📸",
  "Pelle Naturale": "🧴",
  "Giovane": "🌱",
  "Giovanissimo": "🧒",
  "Maturo": "🎩",
  "Anziano": "🤍",
  "Barba Piena": "🧔",
  "Barba Incolta": "🪒",
  "Pizzetto": "🧔🏻‍♂️",
  "Baffi": "🥸",
  "Rasato": "✨",
  "Volume": "💁",
  "Lunghi": "💇‍♀️",
  "Corto": "💇‍♂️",
  "Frangia": "✂️",
  "Biondo": "💛",
  "Rosso": "🧡",
  "Castano": "🤎",
  "Occhiali": "👓",
  "Contouring": "💎",
  "Fard": "🌺",
  "Eyeliner": "👁️",
  "Occhi da Gatto": "😼",
  "Labbra": "💋",
  "Sopracciglia": "〰️",
  "Occhi Luminosi": "✨",
  "Anti-Occhiaie & Luce": "🌟",
};

function faceSvg(id) {
  const mk = (paths) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.9");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = paths;
    return svg;
  };
  switch (id) {
    case "smile":
      return mk(`<circle cx="18" cy="18" r="11"/><path d="M13 15.5v-.5M23 15.5v-.5"/><path d="M12.5 21c1.5 2.5 3.4 3.5 5.5 3.5s4-1 5.5-3.5z"/>`);
    case "impression":
      return mk(`<path d="M11 20c0 4.5 3 8 7 8s7-3.5 7-8v-3c0-3.8-3.1-7-7-7s-7 3.2-7 7v3Z"/><path d="M8 9l1.2 2.4L11.6 12.6 9.2 13.8 8 16.2 6.8 13.8 4.4 12.6 6.8 11.4 8 9Z"/><path d="M15 18h.01M21 18h.01M15.5 23h5"/>`);
    case "age":
      return mk(`<circle cx="18" cy="18" r="11"/><path d="M14 14h8M14.5 17.5h.01M21.5 17.5h.01M13 21.5c1 .8 2 .8 2.5.4M23 21.5c-1 .8-2 .8-2.5.4M14.5 24h7"/>`);
    case "beard":
      return mk(`<circle cx="18" cy="15" r="8"/><path d="M10.5 17.5c0 6 3.2 10.5 7.5 10.5s7.5-4.5 7.5-10.5c-1.5 2-3.5 2.8-7.5 2.8s-6-.8-7.5-2.8Z"/><path d="M15.5 18.5h5"/>`);
    case "hair_style":
      return mk(`<path d="M9 19c0-6.5 4-11 9-11s9 4.5 9 11c-1.5-2.5-4-3.5-9-3.5S10.5 16.5 9 19Z"/><path d="M11 19v2c0 4.2 3.1 7.5 7 7.5s7-3.3 7-7.5v-2"/>`);
    case "contouring":
      return mk(`<path d="M11 17c0 5 3.1 9.5 7 9.5s7-4.5 7-9.5c0-4.2-3.1-7.5-7-7.5S11 12.8 11 17Z"/><path d="M14.5 19l-1.5 3M21.5 19l1.5 3M15 15.5h.01M21 15.5h.01"/>`);
    case "color_effect":
      return mk(`<path d="M18 7c4.5 5.6 8 10 8 14a8 8 0 1 1-16 0c0-4 3.5-8.4 8-14Z"/><path d="M14.5 22a3.5 3.5 0 0 0 3.5 3.5"/>`);
    default:
      return mk(`<path d="M18 6l2.4 5.2L26 12l-4 4 .9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-4 5.6-.8L18 6Z"/>`);
  }
}

async function urlToFile(url, name = "photo.png") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile leggere l'immagine (${res.status})`);
  const blob = await res.blob();
  const ext = blob.type.includes("jpeg") ? "jpg" : "png";
  const fname = name.includes(".") ? name : `${name}.${ext}`;
  return new File([blob], fname, { type: blob.type || "image/png" });
}

function waitJobDone(entryId, onTick) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const cur = feed.get(entryId);
      if (!cur) return;
      onTick?.(cur);
      if (isDone(cur)) {
        off();
        if (cur.status === "succeeded" && cur.outputs?.length) resolve(cur);
        else reject(new Error(cur.error || "Elaborazione fallita"));
      }
    };
    const off = feed.on(check);
    check();
  });
}

const GALLERY_BLOCK_SIZE = 24;

function demoPortraits() {
  const priority = ["headshot", "skin-enhancer", "ai-influencer-photo", "commercial-faces", "relight", "character-studio", "face-swap"];
  const list = [];
  for (const id of priority) {
    const a = apps.find((x) => x.id === id && x.example?.full);
    if (a) list.push({ id: a.id, label: a.name, url: a.example.full, thumb: a.example.card || a.example.full, isDemo: true });
  }
  return list;
}

function entryToGalleryItems(e) {
  if (e.status !== "succeeded" || !e.outputs?.length) return [];
  const label = e.app === "wonderfull" ? "Wonderfull" : e.app;
  const items = [];
  for (const o of e.outputs) {
    if (o.type !== "image") continue;
    const url = `/api/history/${e.id}/files/${o.file}`;
    items.push({
      id: e.id,
      label,
      url,
      thumb: o.thumb ? `/api/history/${e.id}/files/${o.thumb}` : url,
      isDemo: false,
    });
  }
  return items;
}

export function wonderfullView(app, { initialFile, onImageChange, switcherBtn }) {
  const root = el("div", { class: "wf-shell" });
  const inputMap = Object.fromEntries(app.inputs.map((i) => [i.id, i]));

  const gallery = {
    items: [],
    seenUrls: new Set(),
    offset: 0,
    totalEntries: 0,
    hasMore: true,
    loading: false,
    loadedOnce: false,
    error: null,
    generation: 0,
    inflight: null,
  };
  let activeGalleryMounts = [];
  let galleryObservers = [];

  const disconnectGalleryObservers = () => {
    for (const stop of galleryObservers) try { stop(); } catch {}
    galleryObservers = [];
    activeGalleryMounts = [];
  };

  const state = {
    originalFile: null,
    originalUrl: null,
    currentFile: null,
    currentUrl: null,
    stack: [],           // undo history: [{ file, url, label }]
    faces: [],
    imgSize: { w: 0, h: 0 },
    detecting: false,
    selectedFaceIdx: null, // null = waiting user pick; -1 = full image; >= 0 = face index
    applyScope: "face",    // "face" | "full"
    faceZoom: false,
    activeCat: null,       // null = top category bar, or category id
    footerTab: "editor",   // "editor" | "history" | "compare"
    draftValues: {
      impression: "",
      smile: "",
      age: "",
      beard: "",
      hair_style: "",
      contouring: [],
      color_effect: "",
      intensity: inputMap.intensity?.options?.[2]?.value || "",
      details: "",
    },
    appliedLabels: [],
    busy: false,
    busyText: "",
    holdingCompare: false,
    showLibraryModal: false,
    steps: Number(inputMap.steps?.default || 6),
  };

  const objectUrls = new Set();
  const trackUrl = (u) => { if (u && u.startsWith("blob:")) objectUrls.add(u); return u; };
  let lastStageTransform = "translate(0px, 0px) scale(1)";
  const cleanup = () => {
    disconnectGalleryObservers();
    for (const u of objectUrls) try { URL.revokeObjectURL(u); } catch {}
    objectUrls.clear();
  };

  function formatGalleryCounter() {
    if (!gallery.loadedOnce && gallery.loading) return "Caricamento galleria…";
    if (!gallery.items.length) return "Nessuna foto in Library";
    if (gallery.hasMore && gallery.totalEntries > gallery.items.length) {
      return `${gallery.items.length} / ${gallery.totalEntries}+ foto`;
    }
    return `${gallery.items.length} foto`;
  }

  function renderGallerySentinelContent(node) {
    if (!node) return;
    if (gallery.loading) {
      node.replaceChildren(
        el("div", { class: "wf-gal-status" },
          el("span", { class: "wf-spin-dot" }),
          el("span", {}, `Caricamento blocco… (${gallery.items.length} caricate)`)
        )
      );
      return;
    }
    if (gallery.error) {
      node.replaceChildren(
        el("button", { type: "button", class: "wf-gal-more-btn", onclick: () => loadNextGalleryBlock() },
          `Errore caricamento (${gallery.error}) · Riprova`
        )
      );
      return;
    }
    if (gallery.hasMore) {
      node.replaceChildren(
        el("button", { type: "button", class: "wf-gal-more-btn", onclick: () => loadNextGalleryBlock() },
          `Scorri o clicca per caricare altri (${formatGalleryCounter()})`
        )
      );
      return;
    }
    if (gallery.items.length > 0) {
      node.replaceChildren(
        el("span", { class: "wf-gal-end" }, `Tutta la galleria caricata (${gallery.items.length} foto)`)
      );
      return;
    }
    if (gallery.loadedOnce) {
      node.replaceChildren(
        el("p", { class: "wf-lib-empty" }, "Nessuna immagine nella Library. Carica una foto dal tuo dispositivo!")
      );
    }
  }

  function syncGalleryMounts(newItems = []) {
    for (const mount of activeGalleryMounts) {
      if (!mount.grid.isConnected) continue;
      if (newItems.length) {
        if (mount.emptyNode?.isConnected) mount.emptyNode.remove();
        for (const item of newItems) {
          mount.grid.insertBefore(mount.makeTile(item), mount.insertBeforeNode || null);
        }
      } else if (gallery.loadedOnce && !gallery.items.length && mount.emptyNode && !mount.emptyNode.isConnected && mount.showEmptyWhenNone) {
        mount.grid.insertBefore(mount.emptyNode, mount.insertBeforeNode || null);
      }
      if (mount.countEl) mount.countEl.textContent = formatGalleryCounter();
      renderGallerySentinelContent(mount.sentinel);
    }
  }

  function isSentinelNearBottom(mount) {
    if (!mount.scrollRoot?.isConnected || !mount.sentinel?.isConnected) return false;
    const sr = mount.scrollRoot.getBoundingClientRect();
    const tr = mount.sentinel.getBoundingClientRect();
    return tr.top <= sr.bottom + 240;
  }

  async function loadNextGalleryBlock() {
    if (gallery.loading || !gallery.hasMore) return;
    if (gallery.inflight) return gallery.inflight;
    const gen = gallery.generation;
    gallery.loading = true;
    gallery.error = null;
    syncGalleryMounts([]);

    const run = (async () => {
      try {
        const data = await api(`/api/history?media=image&limit=${GALLERY_BLOCK_SIZE}&offset=${gallery.offset}`);
        if (gen !== gallery.generation) return;
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const added = [];
        for (const e of entries) {
          for (const item of entryToGalleryItems(e)) {
            if (gallery.seenUrls.has(item.url)) continue;
            gallery.seenUrls.add(item.url);
            gallery.items.push(item);
            added.push(item);
          }
        }
        gallery.offset += entries.length;
        gallery.totalEntries = typeof data.total === "number" ? data.total : gallery.items.length;
        gallery.hasMore = Boolean(data.hasMore) && entries.length > 0;
        gallery.loadedOnce = true;
        gallery.loading = false;
        gallery.error = null;
        syncGalleryMounts(added);

        // If the visible viewport still has room below already-loaded items, load the next block cleanly.
        if (gallery.hasMore) {
          requestAnimationFrame(() => {
            if (gen === gallery.generation && activeGalleryMounts.some(isSentinelNearBottom)) {
              loadNextGalleryBlock();
            }
          });
        }
      } catch (err) {
        if (gen !== gallery.generation) return;
        gallery.loading = false;
        gallery.loadedOnce = true;
        gallery.error = err?.message || "rete";
        syncGalleryMounts([]);
      } finally {
        gallery.inflight = null;
      }
    })();

    gallery.inflight = run;
    return run;
  }

  function refreshGallery() {
    gallery.generation += 1;
    gallery.items = [];
    gallery.seenUrls.clear();
    gallery.offset = 0;
    gallery.totalEntries = 0;
    gallery.hasMore = true;
    gallery.loading = false;
    gallery.loadedOnce = false;
    gallery.error = null;
    gallery.inflight = null;
    return loadNextGalleryBlock();
  }

  function attachGalleryMount(mount) {
    activeGalleryMounts.push(mount);
    renderGallerySentinelContent(mount.sentinel);
    if (mount.countEl) mount.countEl.textContent = formatGalleryCounter();

    const maybeTrigger = () => {
      if (gallery.hasMore && !gallery.loading && isSentinelNearBottom(mount)) {
        loadNextGalleryBlock();
      }
    };

    const onScroll = () => maybeTrigger();
    mount.scrollRoot.addEventListener("scroll", onScroll, { passive: true });

    let io = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((hits) => {
        if (hits.some((h) => h.isIntersecting)) loadNextGalleryBlock();
      }, { root: mount.scrollRoot, rootMargin: "240px 0px" });
      io.observe(mount.sentinel);
    }

    galleryObservers.push(() => {
      mount.scrollRoot.removeEventListener("scroll", onScroll);
      io?.disconnect();
    });

    if (!gallery.loadedOnce && !gallery.loading) {
      loadNextGalleryBlock();
    } else if (gallery.hasMore) {
      requestAnimationFrame(maybeTrigger);
    }
  }

  const fileInput = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) loadPhoto(f);
  });

  async function detectFaces(file) {
    state.detecting = true;
    state.faces = [];
    state.selectedFaceIdx = null;
    draw();
    try {
      const fd = new FormData();
      fd.append("image", file, file.name || "photo.png");
      const res = await fetch("/api/wonderfull/detect-faces", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      state.imgSize = { w: data.width || 0, h: data.height || 0 };
      state.faces = Array.isArray(data.faces) ? data.faces : [];
      if (state.faces.length === 0) {
        // No face detected -> allow full-image color/beauty immediately
        state.selectedFaceIdx = -1;
        state.applyScope = "full";
      } else {
        // Wait for user to click a detected face on the photo or face bar
        state.selectedFaceIdx = null;
        state.applyScope = "face";
      }
    } catch (err) {
      toast(`Rilevamento volti: ${err.message}`, { error: true });
      state.selectedFaceIdx = -1;
      state.applyScope = "full";
    } finally {
      state.detecting = false;
      draw();
    }
  }

  async function loadPhoto(fileOrEntry) {
    if (state.busy) return;
    let file;
    if (fileOrEntry instanceof File || fileOrEntry instanceof Blob) {
      file = fileOrEntry instanceof File ? fileOrEntry : new File([fileOrEntry], "photo.png", { type: fileOrEntry.type || "image/png" });
    } else if (fileOrEntry?.file instanceof File || fileOrEntry?.file instanceof Blob) {
      file = fileOrEntry.file instanceof File ? fileOrEntry.file : new File([fileOrEntry.file], fileOrEntry.name || "photo.png", { type: "image/png" });
    } else if (fileOrEntry?.url) {
      try {
        file = await urlToFile(fileOrEntry.url, fileOrEntry.name || "wonderfull-photo.png");
      } catch (e) {
        toast(e.message, { error: true });
        return;
      }
    } else return;

    const url = trackUrl(URL.createObjectURL(file));
    state.originalFile = file;
    state.originalUrl = url;
    state.currentFile = file;
    state.currentUrl = url;
    state.stack = [];
    state.appliedLabels = [];
    state.activeCat = null;
    state.faceZoom = false;
    lastStageTransform = "translate(0px, 0px) scale(1)";
    state.footerTab = "editor";
    state.showLibraryModal = false;
    onImageChange?.({ name: file.name, url, file });
    await detectFaces(file);
  }

  function resetAll() {
    if (!state.originalFile || state.busy) return;
    state.currentFile = state.originalFile;
    state.currentUrl = state.originalUrl;
    state.stack = [];
    state.appliedLabels = [];
    state.activeCat = null;
    draw();
  }

  function undoLast() {
    if (!state.stack.length || state.busy) return;
    state.stack.pop();
    if (state.stack.length) {
      const top = state.stack[state.stack.length - 1];
      state.currentFile = top.file;
      state.currentUrl = top.url;
      state.appliedLabels.pop();
    } else {
      state.currentFile = state.originalFile;
      state.currentUrl = state.originalUrl;
      state.appliedLabels = [];
    }
    draw();
  }

  function buildJobValues(catId) {
    const cat = FACEAPP_CATEGORIES.find((c) => c.id === catId);
    const out = {
      impression: "",
      smile: "",
      age: "",
      beard: "",
      hair_style: "",
      contouring: [],
      color_effect: "",
      intensity: state.draftValues.intensity,
      details: "",
      steps: state.steps,
      seed: -1,
    };
    if (!cat) return out;
    if (cat.multi) {
      out[cat.inputId] = [...(state.draftValues[cat.inputId] || [])];
    } else {
      out[cat.inputId] = state.draftValues[cat.inputId] || "";
    }
    return out;
  }

  function hasPendingSelection(cat) {
    const v = state.draftValues[cat.inputId];
    return Array.isArray(v) ? v.length > 0 : Boolean(String(v || "").trim());
  }

  function activeChoiceLabel(cat) {
    const v = state.draftValues[cat.inputId];
    const inp = inputMap[cat.inputId];
    if (cat.isText) return String(v || "").trim().slice(0, 26);
    if (Array.isArray(v)) {
      if (!v.length) return "";
      return v.map((val) => inp?.options?.find((o) => o.value === val)?.label || "").filter(Boolean).join(" + ");
    }
    const opt = inp?.options?.find((o) => o.value === v);
    return opt && opt.value ? opt.label : "";
  }

  async function applyCategory(cat) {
    if (!state.currentFile || state.busy) return;
    if (!hasPendingSelection(cat)) {
      state.activeCat = null;
      draw();
      return;
    }

    const chosenLabel = activeChoiceLabel(cat) || cat.label;
    const face = state.selectedFaceIdx !== null && state.selectedFaceIdx >= 0 ? state.faces[state.selectedFaceIdx] : null;
    const useFaceCrop = Boolean(face && state.applyScope === "face" && cat.scope === "face");

    state.busy = true;
    state.busyText = useFaceCrop ? `Modifico Volto ${face.index + 1} (${chosenLabel})…` : `Applico ${chosenLabel}…`;
    draw();

    try {
      const jobVals = buildJobValues(cat.id);
      const fd = new FormData();
      fd.append("image", state.currentFile, state.currentFile.name || "image.png");
      if (useFaceCrop && face?.cropBox) {
        const b = face.cropBox;
        fd.append("wf_crop_box", `${b.x},${b.y},${b.w},${b.h}`);
        if (face.bbox) fd.append("wf_face_box", `${face.bbox.x},${face.bbox.y},${face.bbox.w},${face.bbox.h}`);
        const editsHead = cat.id === "hair_style" || cat.id === "age" || cat.id === "details";
        fd.append("wf_mode", editsHead ? "head" : "face");
        const wantsGlasses = cat.id === "hair_style" && String(state.draftValues.hair_style || "").toLowerCase().includes("eyeglass");
        fd.append("wf_keep_glasses", wantsGlasses ? "0" : "1");
      }
      for (const inp of app.inputs) {
        if (inp.id === "image") continue;
        const val = jobVals[inp.id];
        if (inp.multiple) fd.append(inp.id, JSON.stringify(Array.isArray(val) ? val : []));
        else fd.append(inp.id, String(val ?? ""));
      }

      const entry = await feed.run(app.id, fd);
      const doneEntry = await waitJobDone(entry.id, (cur) => {
        state.busyText = `${chosenLabel}: ${statusText(cur)}`;
        const txtNode = root.querySelector(".wf-busy-txt");
        if (txtNode) txtNode.textContent = state.busyText;
      });

      const outObj = doneEntry.outputs.find((o) => o.type === "image") || doneEntry.outputs[0];
      const jobOutUrl = `/api/history/${doneEntry.id}/files/${outObj.file}`;
      const finalFile = await urlToFile(jobOutUrl, `wonderfull-${Date.now()}.png`);
      const finalUrl = trackUrl(URL.createObjectURL(finalFile));
      state.currentFile = finalFile;
      state.currentUrl = finalUrl;
      state.stack.push({ file: finalFile, url: finalUrl, label: chosenLabel });
      state.appliedLabels.push(chosenLabel);
      state.activeCat = null;
      toast(`✨ ${chosenLabel} applicato!`);
    } catch (err) {
      toast(err.message || "Errore durante l'applicazione", { error: true });
    } finally {
      state.busy = false;
      state.busyText = "";
      draw();
    }
  }

  async function saveResultToLibrary() {
    if (!state.currentFile) return;
    if (state.stack.length > 0) {
      toast("✅ Immagine già salvata nella Library!");
      return;
    }
    try {
      await feed.upload(state.currentFile);
      refreshGallery();
      toast("💾 Immagine salvata nella Library!");
    } catch (err) {
      toast(`Errore salvataggio: ${err.message}`, { error: true });
    }
  }

  function downloadResult() {
    if (!state.currentUrl) return;
    const a = document.createElement("a");
    a.href = state.currentUrl;
    a.download = `wonderfull-${Date.now()}.png`;
    document.body.append(a);
    a.click();
    a.remove();
  }

  function openSplitCompare() {
    if (!state.currentUrl || !state.originalUrl) return;
    hooks.compare?.({
      app: app.id,
      type: "image",
      full: state.currentUrl,
      inputs: [{ file: state.originalUrl, thumb: state.originalUrl, label: "Originale", type: "image" }],
    });
  }

  // ------------------------------------------------------------------ Subviews
  function makeStartTile(r) {
    return el("button", { type: "button", class: "wf-face-tile", onclick: () => loadPhoto(r) },
      el("img", { src: r.thumb, alt: r.label, loading: "lazy", decoding: "async" })
    );
  }

  function makeLibTile(r) {
    return el("button", { type: "button", class: "wf-lib-item", onclick: () => loadPhoto(r) },
      el("img", { src: r.thumb, alt: r.label, loading: "lazy", decoding: "async" }),
      el("small", {}, r.label)
    );
  }

  function renderStartScreen() {
    const demos = demoPortraits();
    const gridCards = [
      el("button", { type: "button", class: "wf-face-tile wf-tile-cam", onclick: () => fileInput.click() },
        icon("upload"),
        el("span", {}, "Carica Foto")
      ),
      ...demos.slice(0, 3).map((d) => el("button", { type: "button", class: "wf-face-tile", onclick: () => loadPhoto(d) },
        el("img", { src: d.thumb, alt: d.label, loading: "lazy", decoding: "async" }),
        el("span", { class: "wf-demo-tag" }, "DEMO")
      )),
      ...gallery.items.map(makeStartTile),
    ];

    const countEl = el("small", {}, formatGalleryCounter());
    const facesGrid = el("div", { class: "wf-faces-grid" }, ...gridCards);
    const sentinel = el("div", { class: "wf-gal-sentinel" });
    const startBody = el("div", { class: "wf-start-body" },
      el("h3", { class: "wf-sec-lbl" }, "Collezioni"),
      el("div", { class: "wf-collections" },
        el("button", { type: "button", class: "wf-col-card wf-col-gal", onclick: () => fileInput.click() },
          icon("image"),
          el("span", {}, "Galleria")
        ),
        el("button", { type: "button", class: "wf-col-card wf-col-lib", onclick: () => { state.showLibraryModal = true; draw(); } },
          icon("film"),
          el("span", {}, "Library"),
          el("i", { class: "wf-col-badge" }, "L")
        ),
        el("button", { type: "button", class: "wf-col-card wf-col-demo", onclick: () => { if (demos[0]) loadPhoto(demos[0]); else fileInput.click(); } },
          icon("spark"),
          el("span", {}, "Celebrità / Demo"),
          el("i", { class: "wf-col-badge" }, "★")
        )
      ),
      el("div", { class: "wf-volti-head" },
        el("h3", { class: "wf-sec-lbl" }, "Volti & Foto Recenti"),
        countEl
      ),
      facesGrid,
      sentinel
    );

    attachGalleryMount({
      grid: facesGrid,
      scrollRoot: startBody,
      sentinel,
      countEl,
      insertBeforeNode: null,
      makeTile: makeStartTile,
      emptyNode: null,
      showEmptyWhenNone: false,
    });

    return el("div", { class: "wf-phone wf-start" },
      el("div", { class: "wf-topbar" },
        switcherBtn ? switcherBtn() : el("span", { class: "wf-top-sp" }),
        el("span", { class: "wf-top-title" }, "Wonderfull · FaceApp Studio"),
        el("span", { class: "wf-top-sp" })
      ),
      startBody
    );
  }

  function renderCategoryPanel(cat) {
    const inp = inputMap[cat.inputId];
    const selectedFace = state.selectedFaceIdx !== null && state.selectedFaceIdx >= 0 ? state.faces[state.selectedFaceIdx] : null;
    const faceThumb = selectedFace?.thumb || state.currentUrl;
    const val = state.draftValues[cat.inputId];

    // 4 circular intensity buttons 1..4 (like FaceApp screenshots)
    const intensityOpts = inputMap.intensity?.options || [];
    const intensityBar = cat.hasIntensity ? el("div", { class: "wf-intensity-bar" },
      ...intensityOpts.map((o) => {
        const active = state.draftValues.intensity === o.value;
        return el("button", {
          type: "button",
          class: `wf-int-btn${active ? " active" : ""}`,
          onclick: () => { state.draftValues.intensity = o.value; draw(); }
        }, o.label);
      })
    ) : null;

    let strip;
    if (cat.isText) {
      const ta = el("textarea", {
        class: "wf-extra-ta",
        rows: 2,
        placeholder: "Descrivi qualsiasi ritocco sul volto o sulla foto (es. occhi più verdi, luce morbida…)",
        value: String(val || "")
      });
      ta.addEventListener("input", () => { state.draftValues.details = ta.value; });
      strip = el("div", { class: "wf-extra-wrap" }, ta);
    } else {
      const opts = inp?.options || [];
      strip = el("div", { class: "wf-opt-strip" }, ...opts.map((o) => {
        const isSelected = cat.multi
          ? Array.isArray(val) && val.includes(o.value)
          : val === o.value;
        const isPro = o.label !== "Originale" && ["Hollywood", "Fascino", "Ampio", "Turbo", "Giovanissimo"].includes(o.label);
        const cssFilter = cat.id === "color_effect" ? (OPTION_FILTERS[o.label] || "") : "";
        return el("button", {
          type: "button",
          class: `wf-opt-card${isSelected ? " selected" : ""}`,
          onclick: () => {
            if (cat.multi) {
              const cur = Array.isArray(state.draftValues[cat.inputId]) ? [...state.draftValues[cat.inputId]] : [];
              const at = cur.indexOf(o.value);
              if (at >= 0) cur.splice(at, 1);
              else if (cur.length < (inp.multiple?.max || 4)) cur.push(o.value);
              state.draftValues[cat.inputId] = cur;
            } else {
              state.draftValues[cat.inputId] = o.value;
            }
            draw();
          }
        },
          el("div", { class: "wf-opt-thumb" },
            faceThumb ? el("img", { src: faceThumb, alt: o.label, style: cssFilter ? { filter: cssFilter } : {} }) : null,
            o.label !== "Originale" ? el("span", { class: "wf-opt-em" }, OPTION_EMOJI[o.label] || "✨") : null,
            isPro ? el("span", { class: "wf-pro-tag" }, "PRO") : null
          ),
          el("span", { class: "wf-opt-lbl" }, o.label)
        );
      }));
    }

    return el("div", { class: "wf-dock-cat" },
      intensityBar,
      strip,
      el("div", { class: "wf-cat-actions" },
        el("button", {
          type: "button",
          class: "wf-act-cancel",
          onclick: () => { state.activeCat = null; draw(); }
        }, "Annulla"),
        el("button", {
          type: "button",
          class: `wf-act-apply${hasPendingSelection(cat) ? " ready" : ""}`,
          disabled: state.busy,
          onclick: () => applyCategory(cat)
        }, "Applica")
      )
    );
  }

  function renderCategoryBar() {
    if (state.detecting) {
      return el("div", { class: "wf-dock-prompt" },
        el("span", { class: "wf-spin" }, icon("loader")),
        el("b", {}, "Individuazione dei volti in corso…")
      );
    }

    if (state.selectedFaceIdx === null && state.faces.length > 0) {
      return el("div", { class: "wf-dock-prompt" },
        el("span", { class: "wf-pick-hand" }, "👆"),
        el("div", {},
          el("b", {}, state.faces.length === 1 ? "1 volto individuato nella foto" : `${state.faces.length} volti individuati nella foto`),
          el("p", {}, "Clicca sul volto che vuoi modificare (sulla foto o nelle miniature qui sopra) per aprire gli strumenti FaceApp.")
        )
      );
    }

    if (state.footerTab === "history") {
      return el("div", { class: "wf-dock-cat" },
        el("div", { class: "wf-stack-list" },
          state.stack.length === 0
            ? el("span", { class: "wf-empty-stack" }, "Nessuna modifica applicata finora.")
            : state.stack.map((st, idx) => el("button", {
                type: "button",
                class: `wf-stack-chip${idx === state.stack.length - 1 ? " active" : ""}`,
                onclick: () => {
                  state.stack = state.stack.slice(0, idx + 1);
                  state.appliedLabels = state.stack.map((x) => x.label);
                  state.currentFile = st.file;
                  state.currentUrl = st.url;
                  draw();
                }
              }, `${idx + 1}. ${st.label}`))
        ),
        el("div", { class: "wf-cat-actions" },
          el("button", { type: "button", class: "wf-act-cancel", onclick: undoLast, disabled: !state.stack.length }, "↶ Annulla ultimo"),
          el("button", { type: "button", class: "wf-act-apply", onclick: () => { state.footerTab = "editor"; draw(); } }, "Torna all'Editor")
        )
      );
    }

    const iconsBar = el("div", { class: "wf-cat-strip" }, ...FACEAPP_CATEGORIES.map((cat) => {
      const hasVal = hasPendingSelection(cat);
      return el("button", {
        type: "button",
        class: `wf-cat-btn${hasVal ? " has-val" : ""}`,
        onclick: () => { state.activeCat = cat; draw(); }
      },
        el("span", { class: "wf-cat-ic" },
          faceSvg(cat.id),
          cat.badge ? el("span", { class: "wf-pro-tag" }, cat.badge) : null
        ),
        el("span", { class: "wf-cat-lbl" }, cat.label)
      );
    }));

    const bottomTabs = el("div", { class: "wf-bottom-tabs" },
      el("button", { type: "button", class: state.footerTab === "editor" ? "active" : "", onclick: () => { state.footerTab = "editor"; draw(); } }, "EDITOR"),
      el("button", {
        type: "button",
        disabled: !state.stack.length,
        onclick: openSplitCompare
      }, "CONFRONTA"),
      el("button", {
        type: "button",
        class: state.footerTab === "history" ? "active" : "",
        onclick: () => { state.footerTab = "history"; draw(); }
      }, `STORIA${state.stack.length ? ` (${state.stack.length})` : ""}`)
    );

    return el("div", { class: "wf-dock-main" }, iconsBar, bottomTabs);
  }

  function computeFaceZoomTransform(stage, frame, faceObj) {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const fw = frame.offsetWidth;
    const fh = frame.offsetHeight;
    if (!sw || !sh || !fw || !fh || !faceObj?.bbox) {
      return "translate(0px, 0px) scale(1)";
    }
    const { x, y, w, h } = faceObj.bbox;
    const pad = 1.85;
    const boxW = Math.max(0.05, w) * fw * pad;
    const boxH = Math.max(0.05, h) * fh * pad;
    const rawScale = Math.min((sw - 16) / boxW, (sh - 16) / boxH);
    const scale = Math.max(1.25, Math.min(3.8, rawScale));

    const cx = x + w / 2;
    const cy = y + h / 2;
    let tx = -scale * (cx - 0.5) * fw;
    let ty = -scale * (cy - 0.5) * fh;

    const maxTx = Math.max(0, (scale * fw - sw) / 2);
    const maxTy = Math.max(0, (scale * fh - sh) / 2);
    tx = Math.max(-maxTx, Math.min(maxTx, tx));
    ty = Math.max(-maxTy, Math.min(maxTy, ty));

    return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  }

  function renderEditor() {
    const activeCat = state.activeCat;
    const activeTitle = activeCat ? activeCat.label : (state.selectedFaceIdx === null && state.faces.length ? "Seleziona Volto" : "Editor");
    const displayUrl = state.holdingCompare && state.originalUrl ? state.originalUrl : state.currentUrl;
    const face = state.selectedFaceIdx !== null && state.selectedFaceIdx >= 0 ? state.faces[state.selectedFaceIdx] : null;
    const shouldZoomFace = Boolean(face && state.faceZoom && state.applyScope === "face" && activeCat?.scope !== "full");

    // Detected face boxes overlay over the photo (hidden once zoomed in or inside a category so the face stays clean)
    const faceOverlays = (!state.holdingCompare && !activeCat && !shouldZoomFace && state.faces.length > 0)
      ? state.faces.map((f) => {
          const isSel = state.selectedFaceIdx === f.index;
          return el("button", {
            type: "button",
            class: `wf-face-box${isSel ? " selected" : ""}`,
            style: {
              left: `${f.bbox.x * 100}%`,
              top: `${f.bbox.y * 100}%`,
              width: `${f.bbox.w * 100}%`,
              height: `${f.bbox.h * 100}%`,
            },
            title: `Seleziona Volto ${f.index + 1}`,
            onclick: () => {
              state.selectedFaceIdx = f.index;
              state.applyScope = "face";
              state.faceZoom = true;
              draw();
            }
          }, el("span", { class: "wf-face-pill" }, isSel ? `✓ Volto ${f.index + 1}` : `Volto ${f.index + 1}`));
        })
      : [];

    const facesStrip = (!state.detecting && !activeCat) ? el("div", { class: "wf-detected-bar" },
      el("span", { class: "wf-det-title" }, state.faces.length ? "Volti:" : "Modalità:"),
      ...state.faces.map((f) => el("button", {
        type: "button",
        class: `wf-det-chip${state.selectedFaceIdx === f.index ? " active" : ""}`,
        onclick: () => {
          state.selectedFaceIdx = f.index;
          state.applyScope = "face";
          state.faceZoom = true;
          draw();
        }
      },
        el("img", { src: f.thumb, alt: `Volto ${f.index + 1}` }),
        el("span", {}, `Volto ${f.index + 1}`)
      )),
      el("button", {
        type: "button",
        class: `wf-det-chip wf-det-full${state.selectedFaceIdx === -1 ? " active" : ""}`,
        onclick: () => {
          state.selectedFaceIdx = -1;
          state.applyScope = "full";
          state.faceZoom = false;
          draw();
        }
      }, el("span", {}, "🌐 Tutta la foto")),
      face ? el("label", { class: "wf-scope-chk", title: "Quando attivo, ritaglia e fonde in alta definizione solo sul volto scelto lasciando intatto il resto della foto." },
        el("input", {
          type: "checkbox",
          checked: state.applyScope === "face",
          onchange: (e) => {
            state.applyScope = e.target.checked ? "face" : "full";
            state.faceZoom = e.target.checked;
            draw();
          }
        }),
        el("span", {}, "Solo volto")
      ) : null
    ) : null;

    // Floating zoom toggle pill top-left when a face is selected
    const zoomFab = (face && state.applyScope === "face" && activeCat?.scope !== "full") ? el("button", {
      type: "button",
      class: `wf-zoom-fab${shouldZoomFace ? " active" : ""}`,
      title: shouldZoomFace ? "Mostra foto intera (1x)" : `Zooma su Volto ${face.index + 1}`,
      onclick: () => {
        state.faceZoom = !state.faceZoom;
        draw();
      }
    }, icon("search"), el("span", {}, shouldZoomFace ? `Volto ${face.index + 1} · 1x` : `Zoom Volto ${face.index + 1}`)) : null;

    // Floating compare button <|> bottom-right (FaceApp style)
    const compareFab = state.stack.length ? el("button", {
      type: "button",
      class: `wf-compare-fab${state.holdingCompare ? " active" : ""}`,
      title: "Tieni premuto per vedere l'originale",
      onpointerdown: () => { state.holdingCompare = true; const img = root.querySelector(".wf-stage-img"); if (img && state.originalUrl) img.src = state.originalUrl; },
      onpointerup: () => { state.holdingCompare = false; const img = root.querySelector(".wf-stage-img"); if (img && state.currentUrl) img.src = state.currentUrl; },
      onpointerleave: () => { if (state.holdingCompare) { state.holdingCompare = false; const img = root.querySelector(".wf-stage-img"); if (img && state.currentUrl) img.src = state.currentUrl; } },
    }, "⟨|⟩") : null;

    const busyOverlay = state.busy ? el("div", { class: "wf-busy-overlay" },
      el("div", { class: "wf-busy-card" },
        el("span", { class: "wf-spin" }, icon("loader")),
        el("span", { class: "wf-busy-txt" }, state.busyText || "Applico modifica AI…")
      )
    ) : null;

    const stageImg = el("img", { class: "wf-stage-img", src: displayUrl, alt: "Anteprima Wonderfull" });
    const stageFrame = el("div", { class: "wf-stage-frame" },
      stageImg,
      ...faceOverlays
    );
    const stageEl = el("div", { class: "wf-stage" },
      stageFrame,
      zoomFab,
      state.holdingCompare ? el("span", { class: "wf-orig-pill" }, "ORIGINALE") : null,
      compareFab,
      busyOverlay
    );

    // Preserve previous transform briefly then animate smoothly to target zoom (or 1x)
    stageFrame.style.transition = "none";
    stageFrame.style.transform = lastStageTransform;
    const applyZoom = () => {
      if (!stageFrame.isConnected) return;
      const target = shouldZoomFace
        ? computeFaceZoomTransform(stageEl, stageFrame, face)
        : "translate(0px, 0px) scale(1)";
      lastStageTransform = target;
      stageFrame.style.transition = "";
      stageFrame.style.transform = target;
    };
    requestAnimationFrame(() => requestAnimationFrame(applyZoom));
    if (!stageImg.complete) {
      stageImg.addEventListener("load", applyZoom, { once: true });
    }

    return el("div", { class: "wf-phone wf-editor" },
      el("div", { class: "wf-topbar" },
        el("button", {
          type: "button",
          class: "wf-top-icon",
          title: activeCat ? "Torna alle categorie" : "Cambia foto",
          onclick: () => {
            if (activeCat) { state.activeCat = null; draw(); }
            else {
              const hadEdits = state.stack.length > 0;
              state.currentFile = null;
              state.currentUrl = null;
              state.originalFile = null;
              state.originalUrl = null;
              state.faces = [];
              state.selectedFaceIdx = null;
              state.faceZoom = false;
              lastStageTransform = "translate(0px, 0px) scale(1)";
              state.stack = [];
              if (hadEdits) refreshGallery();
              draw();
            }
          }
        }, icon("chevL")),
        el("span", { class: "wf-top-title" }, activeTitle),
        el("div", { class: "wf-top-right" },
          state.stack.length ? el("button", { type: "button", class: "wf-top-icon", title: "Ripristina originale", onclick: resetAll }, icon("redo")) : null,
          el("button", { type: "button", class: "wf-top-icon", title: "Salva nella Library", onclick: saveResultToLibrary }, icon("upload")),
          el("button", { type: "button", class: "wf-top-icon wf-dl", title: "Scarica immagine", onclick: downloadResult }, icon("download"))
        )
      ),
      stageEl,
      facesStrip,
      el("div", { class: "wf-dock" },
        activeCat ? renderCategoryPanel(activeCat) : renderCategoryBar()
      )
    );
  }

  function renderLibraryModal() {
    if (!state.showLibraryModal) return null;
    const countEl = el("small", { class: "wf-lib-count" }, formatGalleryCounter());
    const sentinel = el("div", { class: "wf-gal-sentinel wf-gal-sentinel-grid" });
    const emptyNode = el("p", { class: "wf-lib-empty wf-gal-sentinel-grid" }, "Nessuna immagine nella Library. Carica una foto dal tuo dispositivo!");
    const showEmpty = gallery.loadedOnce && !gallery.items.length;
    const libGrid = el("div", { class: "wf-lib-grid" },
      ...(showEmpty ? [emptyNode] : gallery.items.map(makeLibTile)),
      sentinel
    );

    attachGalleryMount({
      grid: libGrid,
      scrollRoot: libGrid,
      sentinel,
      countEl,
      insertBeforeNode: sentinel,
      makeTile: makeLibTile,
      emptyNode,
      showEmptyWhenNone: true,
    });

    return el("div", { class: "wf-lib-modal", onclick: (e) => { if (e.target.classList.contains("wf-lib-modal")) { state.showLibraryModal = false; draw(); } } },
      el("div", { class: "wf-lib-card" },
        el("div", { class: "wf-lib-head" },
          el("div", { class: "wf-lib-title" },
            el("b", {}, "Scegli una foto da Library / History"),
            countEl
          ),
          el("button", { type: "button", class: "icon-btn mini", onclick: () => { state.showLibraryModal = false; draw(); } }, icon("x"))
        ),
        libGrid
      )
    );
  }

  function draw() {
    const prevStartScroll = root.querySelector(".wf-start-body")?.scrollTop || 0;
    disconnectGalleryObservers();
    root.replaceChildren(
      ...[
        fileInput,
        state.currentUrl ? renderEditor() : renderStartScreen(),
        renderLibraryModal(),
      ].filter(Boolean)
    );
    const nextStartBody = root.querySelector(".wf-start-body");
    if (nextStartBody && prevStartScroll > 0) nextStartBody.scrollTop = prevStartScroll;
  }

  // Drag & drop support on entire studio
  root.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); root.classList.add("drag"); } });
  root.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) root.classList.remove("drag"); });
  root.addEventListener("drop", (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
    root.classList.remove("drag");
    if (f) { e.preventDefault(); loadPhoto(f); }
  });

  draw();

  if (initialFile) {
    loadPhoto(initialFile);
  }

  return {
    node: root,
    loadPhoto,
    dispose: cleanup,
  };
}
