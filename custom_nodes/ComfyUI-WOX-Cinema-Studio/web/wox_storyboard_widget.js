import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Ensure styles are loaded
const cssLink = document.createElement("link");
cssLink.rel = "stylesheet";
cssLink.type = "text/css";
cssLink.href = new URL("./wox_cinema.css?v=" + Date.now(), import.meta.url).href;
document.head.appendChild(cssLink);

// =============================================================================
// GENERAZIONE RAPIDA THUMBNAIL (1 Fotogramma / 1 Immagine) IN BACKGROUND VIA COMFYUI
// =============================================================================
export async function generateStoryboardThumbFast({ prompt, filmSetup = "Cinematic 35mm", aspectRatio = "16:9", onStart, onComplete, onError }) {
    if (onStart) onStart();

    let tw = 384, th = 216;
    if (aspectRatio === "9:16") { tw = 216; th = 384; }
    else if (aspectRatio === "1:1") { tw = 256; th = 256; }
    else if (aspectRatio === "21:9") { tw = 420; th = 180; }
    else if (aspectRatio === "4:3") { tw = 320; th = 240; }

    const filmDescriptions = {
        "Cinematic 35mm": "Kodak 35mm motion picture film stock, shallow depth of field, natural organic halation, authentic celluloid texture",
        "IMAX 70mm": "Shot on IMAX 70mm cameras, extreme sharpness, dynamic range, pristine clarity",
        "NOIR": "Film Noir aesthetic, deep dramatic shadows, high contrast chiaroscuro lighting, vintage texture",
        "Action": "High-octane action movie style, intense dynamic contrast, kinetic visual texture",
        "Horror": "Dark horror movie aesthetic, eerie desaturated tones, deep unsettling shadows",
        "Anime Style": "High-end anime aesthetic, vibrant lighting, painterly background textures",
        "Hyperrealistic 8k": "Hyperrealistic 8k digital cinematography, razor-sharp details, photorealistic rendering",
        "Vintage Super 8": "Vintage Super 8mm retro film stock, warm nostalgic tones, charming film grain"
    };

    const filmText = filmDescriptions[filmSetup] || filmSetup;
    const cleanPrompt = (prompt || "Cinematic film scene, high quality, studio lighting").trim();
    const fullPrompt = `${cleanPrompt}. Style: ${filmText}, single cinematic frame, masterpiece.`;
    const seed = Math.floor(Math.random() * 1000000000);
    const ts = Date.now();
    const prefix = `wox_cinema/storyboard/thumbs/thumb_${ts}`;

    // Workflow a 4 passi leggerissimo con z_image_turbo_int8_convrot
    const thumbGraph = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "z_image_turbo_int8_convrot.safetensors",
                "weight_dtype": "default"
            }
        },
        "2": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {
                "shift": 3.0,
                "model": ["1", 0]
            }
        },
        "3": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_3_4b.safetensors",
                "type": "lumina2"
            }
        },
        "4": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": "ae.safetensors"
            }
        },
        "5": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {
                "width": tw,
                "height": th,
                "batch_size": 1
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": fullPrompt,
                "clip": ["3", 0]
            }
        },
        "7": {
            "class_type": "ConditioningZeroOut",
            "inputs": {
                "conditioning": ["6", 0]
            }
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["2", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
                "seed": seed,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "res_multistep",
                "scheduler": "simple",
                "denoise": 1.0
            }
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["8", 0],
                "vae": ["4", 0]
            }
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": prefix,
                "images": ["9", 0]
            }
        }
    };

    try {
        const res = await fetch("/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: thumbGraph,
                client_id: "wox_thumb_bg_" + ts
            })
        });

        if (!res.ok) {
            throw new Error("Errore invio coda thumb: " + res.statusText);
        }

        const qData = await res.json();
        const promptId = qData.prompt_id;
        if (!promptId) throw new Error("Prompt ID non ricevuto");

        // Polling discreto in background dello storico di esecuzione
        const maxAttempts = 35;
        let attempts = 0;
        const checkStatus = async () => {
            attempts++;
            try {
                const hRes = await fetch(`/history/${promptId}`);
                if (hRes.ok) {
                    const hData = await hRes.json();
                    const pInfo = hData[promptId];
                    if (pInfo) {
                        if (pInfo.status?.status_str === "error") {
                            const errMsgs = pInfo.status?.messages || [];
                            const errDetails = errMsgs.find(m => m[0] === "execution_error")?.[1]?.exception_message || "Errore esecuzione";
                            throw new Error(errDetails);
                        }
                        if (pInfo.outputs && pInfo.outputs["10"]) {
                            const imgs = pInfo.outputs["10"].images || [];
                            if (imgs.length > 0) {
                                const imgObj = imgs[0];
                                const fn = encodeURIComponent(imgObj.filename || "");
                                const sf = encodeURIComponent(imgObj.subfolder || "");
                                const tp = encodeURIComponent(imgObj.type || "output");
                                const imgUrl = `/view?filename=${fn}&subfolder=${sf}&type=${tp}&_t=${Date.now()}`;
                                if (onComplete) onComplete(imgUrl, imgObj.filename);
                                return;
                            }
                        }
                    }
                }
            } catch (pErr) {
                console.warn("Poll history thumb error:", pErr);
            }

            if (attempts < maxAttempts) {
                setTimeout(checkStatus, 1000);
            } else {
                if (onError) onError(new Error("Timeout completamento thumb"));
            }
        };

        setTimeout(checkStatus, 1000);
    } catch (err) {
        console.error("Errore avvio thumb in background:", err);
        if (onError) onError(err);
    }
}
window.woxGenerateStoryboardThumbFast = generateStoryboardThumbFast;

app.registerExtension({
    name: "WOX.CinemaStudio.Storyboard",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // =====================================================================
        // 1. NODO SCENA DELLO STORYBOARD (WOXStoryboardSceneNode)
        // =====================================================================
        if (nodeData.name === "WOXStoryboardSceneNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                // Dimensioni calibrate per contenere tutta la card HTML senza tagli
                node.setSize([380, 560]);
                node.bgcolor = "#0b0d12";
                node.color = "#161b22";

                // BLOCCA COMPLETAMENTE IL DISEGNO DEI WIDGET CANVAS LITEGRAPH
                // Questo impedisce che combo box come lighting/prompt/ref_image compaiano sopra o dietro la card!
                node.drawWidgets = function(ctx) {};

                const getWidget = (name) => node.widgets?.find(w => w.name === name);

                // Nascondi tutti i widget nativi e azzera il loro spazio verticale
                if (node.widgets) {
                    node.widgets.forEach(w => {
                        w.type = "hidden";
                        w.computeSize = () => [0, -4];
                    });
                }

                // Container Principale Scheda Scena HTML
                const card = document.createElement("div");
                card.className = "wox-sb-scene-card";
                card.style.marginTop = "28px"; // Spazio pulito per visualizzare gli slot di connessione sopra la card
                card.style.boxSizing = "border-box";
                card.style.width = "100%";

                // 0. Barra Indicatori Slot di Connessione (Ingresso & STORYBOARD OUT)
                const slotsBar = document.createElement("div");
                slotsBar.className = "wox-sb-slots-bar";
                slotsBar.innerHTML = `
                    <span class="slot-indicator in">◀ IN (storyboard_in)</span>
                    <span class="slot-indicator out">STORYBOARD OUT ▶</span>
                `;

                // 1. Header: Badge Scena & Tipologia
                const header = document.createElement("div");
                header.className = "wox-sb-header";

                const badge = document.createElement("div");
                badge.className = "wox-sb-badge";
                badge.innerHTML = `<span>🎬</span><span class="wox-sb-title-text">SCENA</span>`;

                const modeTag = document.createElement("div");
                modeTag.className = "wox-sb-mode-tag";
                modeTag.innerText = "VIDEO";

                header.appendChild(badge);
                header.appendChild(modeTag);

                // 2. IN ALTO: THUMBNAIL / PREVIEW DEL PROMPT
                const thumbWrap = document.createElement("div");
                thumbWrap.className = "wox-sb-thumb-wrap";

                const thumbPlaceholder = document.createElement("div");
                thumbPlaceholder.className = "wox-sb-thumb-placeholder";
                thumbPlaceholder.innerHTML = `
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d4ff32" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                        <line x1="7" y1="2" x2="7" y2="22"></line>
                        <line x1="17" y1="2" x2="17" y2="22"></line>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <line x1="2" y1="7" x2="7" y2="7"></line>
                        <line x1="2" y1="17" x2="7" y2="17"></line>
                        <line x1="17" y1="17" x2="22" y2="17"></line>
                        <line x1="17" y1="7" x2="22" y2="7"></line>
                    </svg>
                    <span>Anteprima Prompt Scena</span>
                `;

                const thumbOverlay = document.createElement("div");
                thumbOverlay.className = "wox-sb-thumb-overlay-badge";
                thumbOverlay.innerText = "In attesa di rendering";

                // Pulsante rapido rigenera thumbnail a bassissima risoluzione
                const quickThumbBtn = document.createElement("button");
                quickThumbBtn.className = "wox-sb-quick-thumb-btn";
                quickThumbBtn.title = "Genera un rendering ultra-veloce a bassissima risoluzione per creare la thumb";
                quickThumbBtn.innerHTML = `<span>⚡</span><span>Thumb</span>`;

                thumbWrap.appendChild(thumbPlaceholder);
                thumbWrap.appendChild(thumbOverlay);
                thumbWrap.appendChild(quickThumbBtn);

                // Funzione per aggiornare la thumbnail con immagine o video renderizzato
                const updateThumbnailMedia = (url, isVideo = false) => {
                    if (!url) return;
                    thumbWrap.innerHTML = "";
                    if (isVideo || url.endsWith(".mp4") || url.endsWith(".webm")) {
                        const vid = document.createElement("video");
                        vid.className = "wox-sb-thumb-media";
                        vid.src = url;
                        vid.autoplay = true;
                        vid.loop = true;
                        vid.muted = true;
                        vid.playsInline = true;
                        thumbWrap.appendChild(vid);
                    } else {
                        const img = document.createElement("img");
                        img.className = "wox-sb-thumb-media";
                        img.src = url;
                        thumbWrap.appendChild(img);
                    }
                    thumbOverlay.innerText = "✓ Render Completato";
                    thumbOverlay.style.borderColor = "#d4ff32";
                    thumbOverlay.style.color = "#d4ff32";
                    thumbWrap.appendChild(thumbOverlay);
                    thumbWrap.appendChild(quickThumbBtn);
                };

                // 3. SOTTO: TEXTAREA PROMPT INTERATTIVA DELLA SCENA
                const promptBox = document.createElement("div");
                promptBox.className = "wox-sb-prompt-box";

                const promptLbl = document.createElement("div");
                promptLbl.className = "wox-sb-prompt-lbl";
                promptLbl.innerText = "PROMPT DELLA SCENA";

                const promptTextarea = document.createElement("textarea");
                promptTextarea.className = "wox-sb-prompt-textarea";
                promptTextarea.rows = 2;
                promptTextarea.placeholder = "Descrivi il prompt della scena...";
                promptTextarea.value = getWidget("prompt")?.value || "";

                promptTextarea.addEventListener("input", (e) => {
                    const w = getWidget("prompt");
                    if (w) {
                        w.value = e.target.value;
                        if (w.callback) w.callback(w.value);
                    }
                });

                promptBox.appendChild(promptLbl);
                promptBox.appendChild(promptTextarea);

                // 4. SOTTO: IMPOSTAZIONI COMPATTE CON SELETTORI INTERATTIVI
                const pillsGrid = document.createElement("div");
                pillsGrid.className = "wox-sb-pills-grid";

                // Pill Risoluzione
                const pillRes = document.createElement("div");
                pillRes.className = "wox-sb-pill";
                pillRes.innerHTML = `
                    <span class="wox-sb-pill-k">RISOLUZIONE</span>
                    <select class="wox-sb-select accent" id="sel-res">
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                        <option value="1080p" selected>1080p</option>
                        <option value="4k">4k</option>
                    </select>
                `;

                // Pill FPS
                const pillFps = document.createElement("div");
                pillFps.className = "wox-sb-pill";
                pillFps.innerHTML = `
                    <span class="wox-sb-pill-k">FRAMERATE</span>
                    <select class="wox-sb-select" id="sel-fps">
                        <option value="24" selected>24 FPS</option>
                        <option value="25">25 FPS</option>
                        <option value="30">30 FPS</option>
                        <option value="60">60 FPS</option>
                    </select>
                `;

                // Pill Aspect Ratio
                const pillRatio = document.createElement("div");
                pillRatio.className = "wox-sb-pill";
                pillRatio.innerHTML = `
                    <span class="wox-sb-pill-k">ASPECT RATIO</span>
                    <select class="wox-sb-select" id="sel-ratio">
                        <option value="16:9" selected>16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="21:9">21:9</option>
                        <option value="4:3">4:3</option>
                    </select>
                `;

                // Pill Durata
                const pillDur = document.createElement("div");
                pillDur.className = "wox-sb-pill";
                pillDur.innerHTML = `
                    <span class="wox-sb-pill-k">DURATA</span>
                    <select class="wox-sb-select" id="sel-dur">
                        <option value="3">3s</option>
                        <option value="5" selected>5s</option>
                        <option value="10">10s</option>
                    </select>
                `;

                // Pill Tipologia / Mode
                const pillMode = document.createElement("div");
                pillMode.className = "wox-sb-pill span-2";
                pillMode.innerHTML = `
                    <span class="wox-sb-pill-k">TIPOLOGIA</span>
                    <select class="wox-sb-select accent" id="sel-mode">
                        <option value="Video (Minimax H3)" selected>Video (Minimax H3)</option>
                        <option value="Image (Z-Image Turbo)">Image (Z-Image Turbo)</option>
                        <option value="Image (Krea 2)">Image (Krea 2)</option>
                    </select>
                `;

                // Pill Film Setup & Camera
                const pillLook = document.createElement("div");
                pillLook.className = "wox-sb-pill span-3";
                pillLook.innerHTML = `
                    <span class="wox-sb-pill-k">SETUP & CAMERA</span>
                    <div style="display:flex;gap:4px;width:100%;">
                        <select class="wox-sb-select" id="sel-film" style="flex:1;">
                            <option value="General">General</option>
                            <option value="Cinematic 35mm" selected>Cinematic 35mm</option>
                            <option value="IMAX 70mm">IMAX 70mm</option>
                            <option value="NOIR">NOIR</option>
                            <option value="Action">Action</option>
                            <option value="Horror">Horror</option>
                            <option value="Drama">Drama</option>
                            <option value="Anime Style">Anime Style</option>
                            <option value="Hyperrealistic 8k">Hyperrealistic 8k</option>
                            <option value="Vintage Super 8">Vintage Super 8</option>
                        </select>
                        <select class="wox-sb-select" id="sel-cam" style="flex:1;">
                            <option value="Auto" selected>Auto</option>
                            <option value="Static Tripod">Static Tripod</option>
                            <option value="Pan Left to Right">Pan Left to Right</option>
                            <option value="Tilt Up">Tilt Up</option>
                            <option value="Slow Zoom In">Slow Zoom In</option>
                            <option value="Drone FPV">Drone FPV</option>
                            <option value="360 Orbit">360 Orbit</option>
                            <option value="Handheld Shake">Handheld Shake</option>
                        </select>
                    </div>
                `;

                pillsGrid.appendChild(pillRes);
                pillsGrid.appendChild(pillFps);
                pillsGrid.appendChild(pillRatio);
                pillsGrid.appendChild(pillDur);
                pillsGrid.appendChild(pillMode);
                pillsGrid.appendChild(pillLook);

                const selRes = pillRes.querySelector("#sel-res");
                const selFps = pillFps.querySelector("#sel-fps");
                const selRatio = pillRatio.querySelector("#sel-ratio");
                const selDur = pillDur.querySelector("#sel-dur");
                const selMode = pillMode.querySelector("#sel-mode");
                const selFilm = pillLook.querySelector("#sel-film");
                const selCam = pillLook.querySelector("#sel-cam");

                const attachSelectSync = (el, widgetName) => {
                    if (!el) return;
                    el.addEventListener("change", (e) => {
                        const w = getWidget(widgetName);
                        if (w) {
                            w.value = e.target.value;
                            if (w.callback) w.callback(w.value);
                        }
                        if (widgetName === "mode") {
                            modeTag.innerText = e.target.value.includes("Image") ? "IMMAGINE" : "VIDEO";
                        }
                    });
                };

                attachSelectSync(selRes, "resolution");
                attachSelectSync(selFps, "fps");
                attachSelectSync(selRatio, "aspect_ratio");
                attachSelectSync(selDur, "duration");
                attachSelectSync(selMode, "mode");
                attachSelectSync(selFilm, "film_setup");
                attachSelectSync(selCam, "camera");

                const syncCardFromWidgets = () => {
                    const wPrompt = getWidget("prompt");
                    if (wPrompt && promptTextarea && promptTextarea.value !== wPrompt.value) {
                        promptTextarea.value = wPrompt.value || "";
                    }
                    const wMode = getWidget("mode");
                    if (wMode && selMode) {
                        selMode.value = wMode.value;
                        modeTag.innerText = wMode.value.includes("Image") ? "IMMAGINE" : "VIDEO";
                    }
                    const validRes = ["480p", "720p", "1080p", "4k"];
                    const wRes = getWidget("resolution");
                    if (wRes && selRes) {
                        selRes.value = validRes.includes(wRes.value) ? wRes.value : "1080p";
                    }
                    const wFps = getWidget("fps");
                    if (wFps && selFps) selFps.value = String(wFps.value);
                    const validRatio = ["16:9", "9:16", "1:1", "21:9", "4:3"];
                    const wRatio = getWidget("aspect_ratio");
                    if (wRatio && selRatio) {
                        selRatio.value = validRatio.includes(wRatio.value) ? wRatio.value : "16:9";
                    }
                    const wDur = getWidget("duration");
                    if (wDur && selDur) selDur.value = String(wDur.value);
                    const wFilm = getWidget("film_setup");
                    if (wFilm && selFilm) selFilm.value = wFilm.value;
                    const wCam = getWidget("camera");
                    if (wCam && selCam) selCam.value = wCam.value;
                };

                // Funzione per avviare il rendering 1 frame a bassissima risoluzione in background
                node.triggerBackgroundThumb = function(overridePrompt) {
                    const curPrompt = (overridePrompt !== undefined ? overridePrompt : (getWidget("prompt")?.value || promptTextarea.value || "")).trim();
                    const curFilm = getWidget("film_setup")?.value || (selFilm ? selFilm.value : "Cinematic 35mm");
                    const curRatio = getWidget("aspect_ratio")?.value || (selRatio ? selRatio.value : "16:9");

                    thumbOverlay.innerText = "⏳ Render 1 Frame in corso...";
                    thumbOverlay.classList.add("loading");
                    quickThumbBtn.disabled = true;

                    generateStoryboardThumbFast({
                        prompt: curPrompt,
                        filmSetup: curFilm,
                        aspectRatio: curRatio,
                        onComplete: (url, fn) => {
                            updateThumbnailMedia(url, false);
                            thumbOverlay.innerText = "✓ Thumb 1 Frame Pronta";
                            thumbOverlay.classList.remove("loading");
                            quickThumbBtn.disabled = false;
                            node.setDirtyCanvas(true, true);
                        },
                        onError: (err) => {
                            console.warn("Errore generazione thumb 1 frame:", err);
                            thumbOverlay.innerText = "⚠️ Errore Thumb";
                            thumbOverlay.classList.remove("loading");
                            quickThumbBtn.disabled = false;
                            node.setDirtyCanvas(true, true);
                        }
                    });
                };

                // Pulsante Rapido Rigenera Thumb 1 Frame
                quickThumbBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    node.triggerBackgroundThumb();
                });

                // 5. AZIONI RAPIDE DEL NODO (Collega Scena Successiva, Collega Render & Salva Storyboard)
                const actionsRow = document.createElement("div");
                actionsRow.className = "wox-sb-actions-row";

                const btnAddNext = document.createElement("button");
                btnAddNext.className = "wox-sb-action-btn";
                btnAddNext.title = "Crea la scena successiva collegando STORYBOARD OUT all'ingresso del nuovo nodo";
                btnAddNext.innerHTML = `<span>+</span><span>Scena Successiva</span>`;

                btnAddNext.addEventListener("click", (e) => {
                    e.stopPropagation();
                    try {
                        const nextNode = LiteGraph.createNode("WOXStoryboardSceneNode");
                        if (nextNode) {
                            nextNode.pos = [node.pos[0] + node.size[0] + 50, node.pos[1]];
                            app.graph.add(nextNode);

                            const outSlot = node.findOutputSlot("STORYBOARD OUT") !== -1 ? node.findOutputSlot("STORYBOARD OUT") : 0;
                            const inSlot = nextNode.findInputSlot("storyboard_in") !== -1 ? nextNode.findInputSlot("storyboard_in") : 0;
                            if (outSlot !== -1 && inSlot !== -1) {
                                node.connect(outSlot, nextNode, inSlot);
                            }

                            const copyWidgets = ["mode", "resolution", "fps", "aspect_ratio", "film_setup"];
                            copyWidgets.forEach(wn => {
                                const srcW = getWidget(wn);
                                const dstW = nextNode.widgets?.find(w => w.name === wn);
                                if (srcW && dstW) dstW.value = srcW.value;
                            });

                            app.graph.setDirtyCanvas(true, true);

                            // Lancia in background il rendering 1 frame della nuova scena
                            setTimeout(() => {
                                if (typeof nextNode.triggerBackgroundThumb === "function") {
                                    nextNode.triggerBackgroundThumb();
                                }
                            }, 300);
                        }
                    } catch (err) {
                        console.error("Errore creazione scena successiva:", err);
                    }
                });

                const btnAddRender = document.createElement("button");
                btnAddRender.className = "wox-sb-action-btn secondary";
                btnAddRender.title = "Crea e collega il nodo Render finale a STORYBOARD OUT";
                btnAddRender.innerHTML = `<span>🎥</span><span>Collega Render</span>`;

                btnAddRender.addEventListener("click", (e) => {
                    e.stopPropagation();
                    try {
                        const renderNode = LiteGraph.createNode("WOXStoryboardRenderNode");
                        if (renderNode) {
                            renderNode.pos = [node.pos[0] + node.size[0] + 50, node.pos[1] + 30];
                            app.graph.add(renderNode);

                            const outSlot = node.findOutputSlot("STORYBOARD OUT") !== -1 ? node.findOutputSlot("STORYBOARD OUT") : 0;
                            const inSlot = renderNode.findInputSlot("storyboard") !== -1 ? renderNode.findInputSlot("storyboard") : 0;
                            if (outSlot !== -1 && inSlot !== -1) {
                                node.connect(outSlot, renderNode, inSlot);
                            }
                            app.graph.setDirtyCanvas(true, true);
                        }
                    } catch (err) {
                        console.error("Errore creazione nodo render:", err);
                    }
                });

                const btnSaveStoryboard = document.createElement("button");
                btnSaveStoryboard.className = "wox-sb-action-btn secondary";
                btnSaveStoryboard.title = "Salva l'intero progetto Storyboard con tutte le scene su disco (JSON)";
                btnSaveStoryboard.innerHTML = `<span>💾</span><span>Salva Storyboard</span>`;

                btnSaveStoryboard.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const allNodes = app.graph._nodes || [];
                    const sceneNodes = allNodes.filter(n => n.type === "WOXStoryboardSceneNode");
                    if (sceneNodes.length === 0) {
                        alert("Nessuna scena presente nello Storyboard da salvare!");
                        return;
                    }
                    sceneNodes.sort((a, b) => a.pos[0] - b.pos[0]);
                    const scenesData = sceneNodes.map((sn, idx) => {
                        const getW = (name) => sn.widgets?.find(w => w.name === name)?.value;
                        return {
                            scene_number: idx + 1,
                            prompt: getW("prompt") || "",
                            mode: getW("mode") || "Video (Minimax H3)",
                            resolution: getW("resolution") || "1080p",
                            fps: getW("fps") || 24,
                            aspect_ratio: getW("aspect_ratio") || "16:9",
                            duration: getW("duration") || 5,
                            film_setup: getW("film_setup") || "Cinematic 35mm",
                            camera: getW("camera") || "Auto"
                        };
                    });

                    const origHtml = btnSaveStoryboard.innerHTML;
                    btnSaveStoryboard.innerHTML = `<span>Salvataggio...</span>`;

                    try {
                        const res = await fetch("/wox_cinema/storyboard/save_project", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                title: `Storyboard_Project_${Date.now()}`,
                                scenes: scenesData
                            })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            btnSaveStoryboard.style.color = "#d4ff32";
                            btnSaveStoryboard.style.borderColor = "#d4ff32";
                            btnSaveStoryboard.innerHTML = `<span>✓ SALVATO (${scenesData.length} SCENE)!</span>`;

                            const blob = new Blob([JSON.stringify({ project: data.project_id, scenes: scenesData }, null, 2)], { type: "application/json" });
                            const dlLink = document.createElement("a");
                            dlLink.href = URL.createObjectURL(blob);
                            dlLink.download = data.filename || `Storyboard_Project_${Date.now()}.json`;
                            document.body.appendChild(dlLink);
                            dlLink.click();
                            document.body.removeChild(dlLink);

                            setTimeout(() => {
                                btnSaveStoryboard.style.color = "";
                                btnSaveStoryboard.style.borderColor = "";
                                btnSaveStoryboard.innerHTML = origHtml;
                            }, 2500);
                        }
                    } catch (err) {
                        console.error("Errore salvataggio:", err);
                        btnSaveStoryboard.innerHTML = `<span>Errore</span>`;
                        setTimeout(() => { btnSaveStoryboard.innerHTML = origHtml; }, 1800);
                    }
                });

                actionsRow.appendChild(btnAddNext);
                actionsRow.appendChild(btnAddRender);
                actionsRow.appendChild(btnSaveStoryboard);

                node.updateThumbnail = updateThumbnailMedia;

                // Assemblaggio Card
                card.appendChild(slotsBar);
                card.appendChild(header);
                card.appendChild(thumbWrap);
                card.appendChild(promptBox);
                card.appendChild(pillsGrid);
                card.appendChild(actionsRow);

                // Registrazione DOM Widget
                const domWidget = node.addDOMWidget("wox_sb_scene_ui", "custom_ui", card, {
                    getValue() { return getWidget("prompt")?.value || ""; },
                    setValue(v) {
                        if (getWidget("prompt")) getWidget("prompt").value = v;
                        if (promptTextarea) promptTextarea.value = v;
                    },
                    hideOnZoom: false
                });

                if (domWidget) {
                    domWidget.computeSize = function() {
                        return [380, 560];
                    };
                }

                // Sincronizzazione dimensioni e stato canvas
                const fitCard = () => {
                    node.setSize([380, 560]);
                    node.setDirtyCanvas(true, true);
                };

                node.onConfigure = function() {
                    setTimeout(fitCard, 100);
                };

                api.addEventListener("wox_storyboard_scene_rendered", (event) => {
                    const detail = event.detail || {};
                    const curPrompt = getWidget("prompt")?.value || "";
                    if (detail.url && (detail.prompt === curPrompt || curPrompt.includes(detail.prompt?.slice(0, 20)))) {
                        updateThumbnailMedia(detail.url, detail.mode?.includes("Video"));
                    }
                });

                setTimeout(() => {
                    syncCardFromWidgets();
                    fitCard();
                }, 100);

                return r;
            };
        }

        // =====================================================================
        // 2. NODO STORYBOARD OUT (WOXStoryboardOutputNode)
        // =====================================================================
        if (nodeData.name === "WOXStoryboardOutputNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                node.setSize([340, 160]);
                node.bgcolor = "#0b0d12";
                node.color = "#161b22";
                node.drawWidgets = function(ctx) {};

                const card = document.createElement("div");
                card.className = "wox-sb-scene-card";
                card.style.marginTop = "24px";
                card.style.padding = "12px";

                card.innerHTML = `
                    <div class="wox-sb-header">
                        <div class="wox-sb-badge">
                            <span>📤</span><span>STORYBOARD OUT</span>
                        </div>
                        <div class="wox-sb-mode-tag" style="color:#d4ff32;">ATTIVO</div>
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; margin-top: 8px;">
                        Flusso sequenza Storyboard attivo. Collega l'uscita <b>STORYBOARD OUT</b> al nodo Render finale.
                    </div>
                `;

                node.addDOMWidget("wox_sb_out_ui", "custom_ui", card, { hideOnZoom: false });
                return r;
            };
        }

        // =====================================================================
        // 3. NODO RENDER DELLO STORYBOARD (WOXStoryboardRenderNode)
        // =====================================================================
        if (nodeData.name === "WOXStoryboardRenderNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                node.setSize([380, 480]);
                node.bgcolor = "#0b0d12";
                node.color = "#161b22";

                // BLOCCA IL DISEGNO DEI WIDGET CANVAS LITEGRAPH
                node.drawWidgets = function(ctx) {};

                if (node.widgets) {
                    node.widgets.forEach(w => {
                        w.type = "hidden";
                        w.computeSize = () => [0, -4];
                    });
                }

                const card = document.createElement("div");
                card.className = "wox-sb-render-card";
                card.style.marginTop = "28px";
                card.style.boxSizing = "border-box";
                card.style.width = "100%";

                // Header
                const header = document.createElement("div");
                header.className = "wox-sb-render-header";
                header.innerHTML = `
                    <div class="wox-sb-render-title">
                        <span>🎥</span><span>WOX STORYBOARD RENDERER</span>
                    </div>
                    <div class="wox-sb-mode-tag" style="color:#d4ff32; border-color: rgba(212,255,50,0.4);">
                        SEQUENZIALE
                    </div>
                `;

                // IL BOTTONE PRINCIPALE RENDER STORYBOARD
                const renderBtn = document.createElement("button");
                renderBtn.className = "wox-sb-render-btn-main";
                renderBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <span>RENDER STORYBOARD</span>
                `;

                const origRenderBtnHtml = renderBtn.innerHTML;

                // Progress Bar Container
                const progressBox = document.createElement("div");
                progressBox.style.display = "flex";
                progressBox.style.flexDirection = "column";
                progressBox.style.gap = "6px";
                progressBox.style.margin = "6px 0";

                const progressTrack = document.createElement("div");
                progressTrack.className = "wox-sb-render-progress-track";

                const progressFill = document.createElement("div");
                progressFill.className = "wox-sb-render-progress-fill";

                progressTrack.appendChild(progressFill);

                const statusText = document.createElement("div");
                statusText.className = "wox-sb-render-status-text";
                statusText.innerText = "Premi RENDER STORYBOARD per avviare l'elaborazione.";

                progressBox.appendChild(progressTrack);
                progressBox.appendChild(statusText);

                // Video Player Container per visualizzare il filmato finale esportato
                const playerContainer = document.createElement("div");
                playerContainer.style.display = "none";
                playerContainer.style.flexDirection = "column";
                playerContainer.style.gap = "8px";

                const videoPlayer = document.createElement("video");
                videoPlayer.controls = true;
                videoPlayer.style.width = "100%";
                videoPlayer.style.borderRadius = "8px";
                videoPlayer.style.background = "#000";
                videoPlayer.style.maxHeight = "180px";

                const downloadBtn = document.createElement("a");
                downloadBtn.className = "wox-sb-action-btn";
                downloadBtn.style.textDecoration = "none";
                downloadBtn.innerText = "⬇️ Scarica Montaggio Finale";
                downloadBtn.target = "_blank";

                playerContainer.appendChild(videoPlayer);
                playerContainer.appendChild(downloadBtn);

                // Info card footer
                const infoFooter = document.createElement("div");
                infoFooter.style.fontSize = "10px";
                infoFooter.style.color = "#64748b";
                infoFooter.style.lineHeight = "1.4";
                infoFooter.innerText = "Renderizza ogni scena collegata in serie ed esporta il montaggio finale unito in output/video.";

                // Listener sul pulsante RENDER STORYBOARD: Avvia il prompt su ComfyUI
                renderBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    renderBtn.disabled = true;
                    renderBtn.innerHTML = `<span>⏳</span><span>Avvio Rendering...</span>`;
                    statusText.innerText = "Avvio workflow ComfyUI in corso...";
                    statusText.style.color = "#d4ff32";
                    progressFill.style.width = "5%";

                    try {
                        if (app && app.queuePrompt) {
                            await app.queuePrompt(0);
                        } else {
                            throw new Error("app.queuePrompt non disponibile");
                        }
                    } catch (err) {
                        console.error("Errore avvio render storyboard:", err);
                        statusText.innerText = "Errore durante l'avvio del render: " + err.message;
                        statusText.style.color = "#ef4444";
                        renderBtn.disabled = false;
                        renderBtn.innerHTML = origRenderBtnHtml;
                    }
                });

                card.appendChild(header);
                card.appendChild(renderBtn);
                card.appendChild(progressBox);
                card.appendChild(playerContainer);
                card.appendChild(infoFooter);

                node.addDOMWidget("wox_sb_render_ui", "custom_ui", card, {
                    hideOnZoom: false
                });

                // WebSocket Progress Listener
                api.addEventListener("wox_storyboard_progress", (event) => {
                    const detail = event.detail || {};
                    const pct = detail.percent || 0;
                    progressFill.style.width = `${pct}%`;
                    statusText.innerText = `🎬 Render Scena ${detail.current} di ${detail.total} (${detail.title || ""})...`;
                    statusText.style.color = "#d4ff32";
                    renderBtn.disabled = true;
                    renderBtn.innerHTML = `<span>⏳</span><span>Elaborazione Scena ${detail.current}/${detail.total}...</span>`;
                });

                // WebSocket Complete Listener
                api.addEventListener("wox_storyboard_complete", (event) => {
                    const detail = event.detail || {};
                    progressFill.style.width = "100%";
                    statusText.innerText = `✓ Completato! ${detail.total_scenes} scene renderizzate con successo.`;
                    statusText.style.color = "#d4ff32";

                    renderBtn.disabled = false;
                    renderBtn.innerHTML = `<span>✓</span><span>RENDER COMPLETATO!</span>`;

                    if (detail.final_video_url) {
                        playerContainer.style.display = "flex";
                        videoPlayer.src = detail.final_video_url;
                        downloadBtn.href = detail.final_video_url;
                        downloadBtn.download = "Storyboard_Final_Film.mp4";
                        node.setSize([380, 580]);
                    }

                    setTimeout(() => {
                        renderBtn.innerHTML = `
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            <span>RI-RENDER STORYBOARD</span>
                        `;
                    }, 4000);
                });

                return r;
            };
        }
    }
});
