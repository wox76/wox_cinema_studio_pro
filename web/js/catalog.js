// The app catalog (/api/apps) and the ways the UI groups it: studios, categories, taglines.
// Everything about an app's form comes from its app.json; this file only decides where it shows up.
import { api, store } from "./util.js";
import { lang } from "./i18n.js";

export let apps = [];
export const byId = new Map();
export let draftsAllowed = false;
export let hosted = false;   // the server runs as a hosted demo (passcode, run cap): lab marks are read-only

const DEV = new URLSearchParams(location.search).has("dev");   // ?dev shows the smoke-test apps

export async function loadCatalog() {
  const d = await api("/api/apps");
  draftsAllowed = Boolean(d.drafts);
  hosted = Boolean(d.hosted);
  apps = d.apps.filter((a) => DEV || !a.id.startsWith("smoke"));
  byId.clear();
  for (const a of apps) byId.set(a.id, a);
  const zi = byId.get("z-image");
  if (zi) zi.name = "Create Image";
  const ci = byId.get("create-image");
  if (ci) ci.name = "Create Image [FLUX]";
  const h3 = byId.get("h3-video");
  if (h3) h3.name = "Create Video";
  const cv = byId.get("cinema-video");
  if (cv) cv.name = "Cinema Studio";
  return apps;
}

/** Apps grouped like a store: a card can only sit in one row. */
export const CATEGORIES = [
  { id: "create", apps: ["trellis-3d", "pixal3d", "multi-to-3d", "text-to-3d", "object-to-3d", "trellis2-native", "hunyuan3d-21", "idol-3d", "triposplat-3d", "scene-3d-moge", "body-double-3d", "z-image", "krea2-realism", "qwen-image-2512", "ideogram4", "flux1-krea", "z-image-grid", "z-image-palette", "moss-image", "h3-video", "orbit-360"] },
  { id: "identity", apps: ["character-studio", "character", "character-3", "speak", "talking", "recast", "motion-transfer", "genjutsu", "dub", "character-swap", "face-swap", "head-swap", "video-face-swap"] },
  { id: "camera", apps: ["qwen-multiangle", "any-angle-3d", "camera-moves", "draw-to-video", "fly-path", "camera-copy", "reshoot", "reframe", "extend-video", "transitions", "transitions-pro", "angles", "shots", "zooms", "whats-next", "bullet-time-scene", "bullet-time-white", "bullet-time-splash"] },
  { id: "style", apps: ["relight", "video-relight", "match-lighting", "match-colors", "colorize", "style-reference", "mixed-media", "upscale", "upscale-video", "video-restore", "sdr-hdr", "smooth", "remove-bg", "change-background", "qwen-layered", "layers-control", "video-remove-bg", "depth-map", "video-depth", "expand-image"] },
  { id: "vfx", apps: ["effects", "morph", "edit", "inpaint", "vfx-clean-plate", "vfx-day-to-night", "vfx-water", "video-insert", "video-swap", "video-remove-object", "video-restyle", "video-evolution", "video-blockout", "object-remover", "watermark-remover", "ip-cleanup", "video-trim", "video-join", "video-captions", "video-remove-dialogue", "video-export"] },
  { id: "ads", apps: ["marketing-studio", "marketing-video", "product-shot", "poster", "packshot", "macro-scene", "macro-product", "giant-product", "billboard", "graffiti-ad", "fridge-ad", "ugc-shot",
    "asmr-product", "chameleon", "magic-button", "truck-ad", "kick-ad", "volcano-ad"] },
  { id: "portraits", apps: ["wonderfull", "ai-influencer", "ai-influencer-photo", "photodump", "headshot", "commercial-faces", "style-snap", "skin-enhancer", "outfit-vending", "glitter-sticker", "fashion-factory", "try-on", "outfit-swap", "outfit-shot"] },
  { id: "clips", apps: ["music-video", "behind-the-scenes", "asmr-whisper", "asmr-host", "roller-coaster", "storm-creature", "cloud-surf", "mukbang", "melting-doodle", "rap-video", "idol"] },
  { id: "play", apps: ["game-styles", "plushie", "render-3d", "figure-3d", "pixel-game", "brick-toy", "sketch-to-real", "paint-app", "mural", "micro-beasts", "meme"] },
  { id: "templates", apps: ["j-magazine", "cafe-60s", "victory-card", "j-poster", "mascot", "burning-sunset", "comic-book", "giallo", "renaissance", "japanese-show", "breakdown", "edit-text", "image-effects", "color-grade"] },
];
export function categoryOf(id) {
  return CATEGORIES.find((c) => c.apps.includes(id))?.id ?? "more";
}

/** Most recently created apps, ordered newest -> oldest. */
export function recentApps(limit = 10, pool = apps) {
  const seen = new Set();
  return pool
    .filter((a) => a && !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) =>
      ((b.createdAt || 0) - (a.createdAt || 0))
      || ((b.updatedAt || 0) - (a.updatedAt || 0))
      || a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

/** The video studio's three tabs, like a camera crew: shoot, fix, move. */
export const VIDEO_TABS = [
  { id: "create", apps: ["music-video", "video", "marketing-video", "cinema-video", "director", "h3-video", "orbit-360", "h3-photo", "effects", "morph", "video-t2v", "genjutsu", "video-blockout", "video-evolution", "speak", "talking", "dub", "transitions", "transitions-pro", "camera-moves"] },
  { id: "edit", apps: ["recast", "video-face-swap", "video-insert", "video-swap", "video-remove-object", "video-restyle", "video-relight", "mixed-media", "reframe", "extend-video", "vfx-clean-plate", "vfx-day-to-night", "vfx-water", "sdr-hdr", "upscale-video", "video-restore", "smooth", "video-remove-bg", "video-depth", "video-trim", "video-join", "video-captions", "video-remove-dialogue", "video-export", "reshoot"] },
  { id: "motion", apps: ["motion-transfer", "camera-copy", "draw-to-video", "fly-path"] },
  { id: "templates", apps: ["behind-the-scenes", "asmr-product", "asmr-whisper", "asmr-host", "chameleon", "magic-button", "truck-ad", "kick-ad", "volcano-ad",
    "roller-coaster", "storm-creature", "cloud-surf", "mukbang", "melting-doodle", "rap-video", "idol", "bullet-time-scene", "bullet-time-white", "bullet-time-splash"] },
];
export const videoTabOf = (id) => VIDEO_TABS.find((tab) => tab.apps.includes(id))?.id ?? null;

/** The image studio's six genres: create, edit, identity, camera, ads, creative styles. */
export const IMAGE_TABS = [
  { id: "create", apps: ["cinema-studio", "create-image", "z-image", "krea2-realism", "qwen-image-2512", "ideogram4", "flux1-krea", "z-image-grid", "z-image-palette", "moss-image"] },
  { id: "edit", apps: ["wonderfull", "edit", "inpaint", "qwen-layered", "layers-control", "object-remover", "watermark-remover", "ip-cleanup", "relight", "match-lighting", "match-colors", "colorize", "remove-bg", "change-background", "upscale", "expand-image", "depth-map", "color-grade", "edit-text"] },
  { id: "identity", apps: ["wonderfull", "face-swap", "head-swap", "character-studio", "character", "character-3", "character-swap", "headshot", "ai-influencer", "ai-influencer-photo", "commercial-faces", "style-snap", "skin-enhancer"] },
  { id: "camera", apps: ["qwen-multiangle", "any-angle-3d", "angles", "shots", "zooms", "whats-next"] },
  { id: "ads", apps: ["marketing-studio", "product-shot", "packshot", "billboard", "poster", "giant-product", "macro-scene", "macro-product", "fridge-ad", "graffiti-ad", "ugc-shot"] },
  { id: "styles", apps: ["styles", "style-reference", "render-3d", "figure-3d", "comic-book", "pixel-game", "brick-toy", "plushie", "sketch-to-real", "paint-app", "mural", "micro-beasts", "meme", "fashion-factory", "try-on", "outfit-swap", "outfit-shot", "outfit-vending", "photodump", "glitter-sticker", "moodboard", "cafe-60s", "renaissance", "giallo", "victory-card", "j-magazine", "j-poster", "mascot", "burning-sunset", "japanese-show", "breakdown", "image-effects", "game-styles"] },
];
export const imageTabOf = (id) => IMAGE_TABS.find((tab) => tab.apps.includes(id))?.id ?? null;

/** Shown in the top bar next to the studios, like a store's front window. */
export const FEATURED = [];

/** The open models behind the apps, for the top bar's menus. `file` is a piece of the model file's name: an app that
 *  downloads a matching file uses the model. `app` runs the model on its own. Order matters for modelOf(): an app is
 *  labelled with the first model it uses, so the video and audio models come before FLUX 3 Klein, which many video
 *  apps use only to prepare a frame. */
export const MODELS = [
  { name: "TRELLIS.2 4B (16GB)", file: "trellis_3d_4b", app: "trellis-3d", note: ["PBR 3D mesh (.GLB) + ActionForge Rigging", "Malla 3D PBR (.GLB) + Rigging en ActionForge", "Mesh 3D PBR (.GLB) + Rigging ActionForge"] },
  { name: "Pixal3D", file: "pixal3d", app: "pixal3d", note: ["High-precision PBR 3D mesh (.GLB)", "Malla 3D PBR de alta precisión (.GLB)", "Mesh 3D PBR ad alta precisione (.GLB)"] },
  { name: "Pixal3D Multi-View", file: "pixal3d_multiview", app: "multi-to-3d", note: ["2–4 angle reconstruction (.GLB)", "Reconstrucción 3D multi-vista (2–4 fotos)", "Ricostruzione 3D da 2–4 viste (.GLB)"] },
  { name: "TRELLIS.2 Native", file: "trellis2", app: "trellis2-native", note: ["Native ComfyUI two-stage 3D PBR mesh (.GLB)", "Malla 3D PBR nativa en dos etapas (.GLB)", "Mesh 3D PBR nativa a due stadi (.GLB)"] },
  { name: "Hunyuan3D 2.1", file: "hunyuan_3d", app: "hunyuan3d-21", note: ["Sculpt-quality 3D mesh (.GLB)", "Malla 3D de calidad escultura (.GLB)", "Mesh 3D qualità scultura (.GLB)"] },
  { name: "Idol 3D", file: "idol_3d", app: "idol-3d", note: ["Full character 3D mesh (.GLB)", "Malla 3D de personaje completo (.GLB)", "Personaggio 3D completo (.GLB)"] },
  { name: "TripoSplat", file: "triposplat", app: "triposplat-3d", note: ["3D Gaussian Splatting / mesh (.GLB)", "Gaussian Splatting 3D / malla (.GLB)", "Gaussian Splatting 3D / mesh (.GLB)"] },
  { name: "MoGe-2 Scene 3D", file: "moge_2", app: "scene-3d-moge", note: ["Instant 3D scene mesh from photo (0 GB download)", "Escena 3D instantánea desde foto", "Scena 3D istantanea da foto (0 GB download)"] },
  { name: "SAM 3D Body + InstantHMR", file: "sam3d_body", app: "body-double-3d", note: ["Photogrammetry human double 3D mesh", "Doble humano 3D fotogramétrico", "Doppio umano 3D fotogrammetrico"] },
  { name: "LTX-2.5 22B", file: "ltx-2.5-22b", app: "video", note: ["Image to video, IC-LoRAs and VFX", "Imagen a video, IC-LoRAs y VFX"] },
  { name: "MiniMax H3", file: "minimax_h3_", app: "h3-video", note: ["Video with sound, extend, reshoot, Orbit 360, VFX & transitions", "Video con sonido, extender, re-shoot, Orbit 360, VFX y transiciones", "Video con audio, extend, reshoot, Orbit 360, VFX e transizioni"] },
  { name: "SeedVR2 3B", file: "seedvr2", app: "upscale-video", note: ["Video and image upscale", "Escalado de video y de imagen"] },
  { name: "MiniMax Music 3", file: "minimax_music3", app: "music", note: ["Songs with lyrics", "Canciones con letra"] },
  { name: "Stable Audio 3", file: "stable_audio_3", app: "sfx", note: ["Sound effects and instrumental music", "Efectos de sonido y música instrumental"] },
  { name: "Qwen-Image-Edit 2509", file: "qwen_image_edit", app: "relight", note: ["Light, angles and the next shot", "Luz, ángulos y la siguiente toma"] },
  { name: "Qwen-Image 2512", file: "qwen_image_2512", app: "qwen-image-2512", note: ["Ultra text rendering & editorial visuals", "Texto nítido y visuales editoriales", "Testo nitido e grafica editoriale"] },
  { name: "Qwen-Image Layered", file: "qwen_image_layered", app: "qwen-layered", note: ["Decompose photo into RGBA layers", "Descompone foto en capas RGBA", "Scomposizione in livelli RGBA"] },
  { name: "Ideogram 4", file: "ideogram_4", app: "ideogram4", note: ["Typography, posters & branding", "Tipografía, pósters y diseño gráfico", "Tipografia, poster e branding"] },
  { name: "FLUX.1 Krea Dev", file: "flux1-krea", app: "flux1-krea", note: ["Aesthetic photography without AI sheen", "Fotografía estética sin brillo IA", "Fotografia estetica naturale"] },
  { name: "Krea 2 Turbo", file: "krea2_turbo", app: "krea2-realism", note: ["Ultra-realism & Krea styles", "Ultra-realismo y estilos de Krea", "Ultra-realismo e stili Krea"] },
  { name: "MOSS-Image", file: "moss_image", app: "moss-image", note: ["30 Film Looks & layout prompts", "30 looks de cine y layout", "30 Film Look e prompt layout"] },
  { name: "Z-Image Turbo", file: "z_image_turbo", app: "z-image", note: ["Fast drafts, grids & HEX palettes", "Borradores, cuadrículas y paletas HEX", "Bozze veloci, griglie e palette HEX"] },
  { name: "FLUX 3 Image Klein", file: "flux3-image-klein", app: "create-image", note: ["Text to image and every edit", "Texto a imagen y todas las ediciones"] },
];
export const usesModel = (app, m) => app.id === m.app || app.models.some((x) => x.name.includes(m.file));
/** The model an app is built on, for a one-line label ("FLUX 3 Image Klein"); null for the model-free apps. */
export function modelOf(app) {
  return MODELS.find((m) => usesModel(app, m)) ?? null;
}

/** The apps a top-bar menu lists, grouped like the studio itself: the image apps by genre, the video apps by tab. */
export function menuGroups(studio) {
  const inMenu = (a) => studio === "image" ? (imageTabOf(a.id) || a.section === "image")
    : studio === "video" ? (videoTabOf(a.id) || a.section === "video")
    : studioOf(a) === studio;
  const pick = (ids) => ids.map((id) => byId.get(id)).filter((a) => a && inMenu(a));
  const groups = studio === "video" ? VIDEO_TABS.map((g) => ({ key: `vtab.${g.id}`, apps: pick(g.apps) }))
    : studio === "image" ? IMAGE_TABS.map((g) => ({ key: `itab.${g.id}`, apps: pick(g.apps) }))
    : [{ key: null, apps: apps.filter(inMenu) }];
  const listed = new Set(groups.flatMap((g) => g.apps));
  const rest = apps.filter((a) => inMenu(a) && !listed.has(a));
  if (rest.length) groups.push({ key: "cat.more.t", apps: rest });
  return groups.filter((g) => g.apps.length);
}

/** Big cards on the Explore page, in this order when they have an example. */
// the hosted demo opens with these, each loaded with its lab example: quick first, then the big video models
export const START_HERE = ["face-swap", "morph", "mixed-media", "dub", "reshoot"];
export const HERO = ["effects", "recast", "motion-transfer", "speak", "camera-moves", "talking", "transitions", "vfx-day-to-night", "video-t2v", "relight", "styles"];

/** Prompt-first apps get the floating composer; upload-first apps get the sidebar. */
export function layoutOf(app) {
  if (app.section === "3d" || app.id === "trellis-3d" || app.id === "qwen-multiangle" || app.id === "draw-to-video" || app.id === "fly-path" || app.id === "any-angle-3d" || app.id === "marketing-studio" || app.id === "qwen-layered" || app.id === "layers-control") return "sidebar";
  if (app.inputs.some((i) => i.paint)) return "sidebar";   // painting a mask needs the photo in a dropzone
  const hasText = app.inputs.some((i) => i.type === "textarea");
  return (app.section === "image" || app.section === "audio" || app.id === "cinema-video" || app.id === "director" || app.layout === "composer") && hasText ? "composer" : "sidebar";
}

/** The apps a model switcher offers next to this one: the same kind of app in the same category. */
export function familyOf(app) {
  const layout = layoutOf(app);
  if (layout === "composer") return apps.filter((a) => layoutOf(a) === "composer" && a.section === app.section && categoryOf(a.id) === categoryOf(app.id));
  if (app.section === "video" || videoTabOf(app.id)) {
    const tab = videoTabOf(app.id);
    return apps.filter((a) => videoTabOf(a.id) === tab);
  }
  return apps.filter((a) => layoutOf(a) === "sidebar" && !videoTabOf(a.id));
}

/** Which studio (top-bar entry) an app belongs to. */
export function studioOf(app) {
  if (app.section === "3d" || app.id === "trellis-3d") return "3d";
  if (videoTabOf(app.id) || app.section === "video") return "video";
  if (app.section === "audio") return "audio";
  if (imageTabOf(app.id) || app.section === "image") return "image";
  return "apps";
}

const DEFAULT_APP = { image: "cinema-studio", video: "cinema-video", audio: "music", "3d": "trellis-3d" };
export function lastAppFor(studio) {
  const id = store.get(`last.${studio}`);
  if (id && byId.has(id)) return id;
  const fallback = DEFAULT_APP[studio];
  if (byId.has(fallback)) return fallback;
  return apps.find((a) => studioOf(a) === studio)?.id ?? apps[0]?.id;
}
export function rememberApp(app) {
  store.set(`last.${studioOf(app)}`, app.id);
}

const TAGLINES = {
  "trellis-3d": ["Create high-quality PBR 3D objects (.GLB) & rig in ActionForge", "Crea objetos 3D PBR (.GLB) y hazles rig en ActionForge", "Crea oggetti 3D PBR (.GLB) per 16GB VRAM e riggali in ActionForge"],
  "z-image": ["Words to picture in seconds", "De palabras a imagen en segundos"],
  "cinema-studio": ["Shoot it on any camera", "Fílmalo con cualquier cámara"],
  "cinema-video": ["The same film look, now moving", "El mismo look de cine, ahora en movimiento"],
  styles: ["Nine looks, one prompt", "Nueve estilos, un prompt"],
  "style-reference": ["Paint like your reference", "Pinta como tu referencia"],
  character: ["Same face, any scene", "La misma cara, cualquier escena"],
  edit: ["Edit with words", "Edita con palabras"],
  "product-shot": ["Your product, anywhere", "Tu producto, en cualquier lugar"],
  relight: ["Move the light", "Mueve la luz"],
  "remove-bg": ["Cut out anything", "Recorta lo que sea"],
  upscale: ["More pixels, more detail", "Más píxeles, más detalle"],
  video: ["Bring a still to life", "Dale vida a una foto"],
  "video-t2v": ["Type a shot, get a clip", "Escribe una toma, obtén un clip"],
  "camera-moves": ["Direct the camera", "Dirige la cámara"],
  effects: ["24 effects from one photo", "24 efectos desde una foto"],
  "camera-copy": ["Copy any camera move", "Copia cualquier movimiento de cámara"],
  recast: ["Recast anyone in your clip", "Cambia al protagonista de tu clip"],
  "motion-transfer": ["Borrow the moves", "Toma prestado el movimiento"],
  speak: ["Make a portrait talk", "Haz hablar un retrato"],
  talking: ["Lip-sync to your voice", "Sincroniza labios con tu voz"],
  transitions: ["From this frame to that one", "De este cuadro a aquel"],
  reshoot: ["Reshoot from a new angle", "Vuelve a filmar desde otro ángulo"],
  "upscale-video": ["Sharpen every frame", "Nitidez en cada cuadro"],
  smooth: ["Silky slow motion", "Cámara lenta fluida"],
  "vfx-clean-plate": ["Empty the street", "Vacía la calle"],
  "vfx-day-to-night": ["Day becomes night", "El día se vuelve noche"],
  "vfx-water": ["Add water to any shot", "Agrega agua a cualquier toma"],
  genjutsu: ["Your cast, props and place in one clip", "Tu elenco, props y lugar en un clip"],
  reframe: ["Any aspect ratio, nothing cropped", "Cualquier formato, sin recortar"],
  "sdr-hdr": ["HDR range for an SDR clip", "Rango HDR para un clip SDR"],
  "mixed-media": ["Same clip, 16 looks", "El mismo clip, 16 estilos"],
  dub: ["New words, same face", "Palabras nuevas, la misma cara"],
  morph: ["Fifteen transformations, your face", "Quince transformaciones, tu cara"],
  music: ["Write a song", "Compón una canción"],
  sfx: ["Sound for every scene", "Sonido para cada escena"],

  "ai-influencer": ["A made-up influencer for your feed", "Un influencer inventado para tu feed"],
  "ai-influencer-photo": ["Your face, a new look", "Tu cara, un look nuevo"],
  angles: ["The same scene from another angle", "La misma escena desde otro ángulo"],
  "asmr-host": ["You hosting an ASMR studio", "Tú conduciendo un estudio de ASMR"],
  "asmr-product": ["Your product in an ASMR clip", "Tu producto en un clip de ASMR"],
  "asmr-whisper": ["You whispering in an ASMR clip", "Tú susurrando en un clip de ASMR"],
  "behind-the-scenes": ["The camera pulls back to the film set", "La cámara se aleja y muestra el set"],
  billboard: ["Your photo on a city billboard", "Tu foto en un espectacular"],
  breakdown: ["Your subject taken apart and labeled", "Tu objeto desarmado y rotulado"],
  "brick-toy": ["Rebuilt from plastic bricks", "Reconstruido con bloques de plástico"],
  "bullet-time-scene": ["Freeze the moment, circle the camera", "Congela el momento y gira la cámara"],
  "bullet-time-splash": ["Frozen water around your subject", "Agua congelada alrededor del sujeto"],
  "bullet-time-white": ["Bullet time on a white backdrop", "Bullet time sobre fondo blanco"],
  "burning-sunset": ["Your scene under a blazing sunset", "Tu escena bajo un atardecer intenso"],
  "cafe-60s": ["You in a 1960s cafe", "Tú en un café de los años 60"],
  chameleon: ["A chameleon in your product's colors", "Un camaleón del color de tu producto"],
  "character-swap": ["Put another person in the scene", "Pon a otra persona en la escena"],
  "cloud-surf": ["You surfing across pink clouds", "Tú surfeando sobre nubes rosas"],
  "color-grade": ["Six color grades for a photo", "Seis gradaciones de color"],
  "comic-book": ["Your photo as a comic panel", "Tu foto como viñeta de cómic"],
  "commercial-faces": ["Campaign portraits of you", "Retratos de campaña tuyos"],
  "create-image": ["Text to image with FLUX 3 Klein", "Texto a imagen con FLUX 3 Klein"],
  "depth-map": ["Depth or normals from a photo", "Profundidad o normales de una foto"],
  "edit-text": ["Change the text in an image", "Cambia el texto de una imagen"],
  "expand-image": ["Grow a photo past its edges", "Extiende una foto más allá del borde"],
  "extend-video": ["Continue a clip, sound included", "Continúa un clip, con sonido"],
  "face-swap": ["Instant neural face swap with 100% likeness", "Intercambio facial de máxima fidelidad", "Scambio volto istantaneo con somiglianza perfetta"],
  "director": ["Direct any animation with 3D previs, assets & characters", "Dirige cualquier animación con previs 3D, assets y estilos", "Regia multi-reference con previs 3D, asset e persone"],
  "character-studio": ["Keep the same character in any pose, outfit or scene", "Mantén el mismo personaje en cualquier pose o ropa", "Stesso personaggio in qualsiasi posa, abito o sfondo"],
  "fashion-factory": ["A catalog photo in a new garment", "Foto de catálogo con otra prenda"],
  "figure-3d": ["You as a boxed collectible figure", "Tú como figura coleccionable"],
  "fridge-ad": ["Your product in a display fridge", "Tu producto en un refrigerador"],
  "game-styles": ["You in 12 video game styles", "Tú en 12 estilos de videojuego"],
  giallo: ["A 1970s giallo film still", "Un fotograma de giallo de los 70"],
  "giant-product": ["Your product as a city monument", "Tu producto gigante sobre la ciudad"],
  "glitter-sticker": ["You as a glitter sticker", "Tú como sticker con brillos"],
  "graffiti-ad": ["Your product as a graffiti mural", "Tu producto como mural de grafiti"],
  "h3-photo": ["A photo to a clip with sound", "De foto a clip con sonido"],
  "h3-video": ["A clip with sound from a prompt", "Un clip con sonido desde un prompt"],
  headshot: ["A studio headshot from a selfie", "Headshot de estudio desde una selfie"],
  idol: ["Your K-pop stage moment", "Tu momento de idol de K-pop"],
  "image-effects": ["Ten effects for a photo", "Diez efectos para una foto"],
  "j-magazine": ["You on a Japanese magazine cover", "Tú en portada de revista japonesa"],
  "j-poster": ["A Japanese-style poster of you", "Un póster de estilo japonés tuyo"],
  "japanese-show": ["You on a retro Japanese TV show", "Tú en un programa japonés retro"],
  "kick-ad": ["Boxes knocked away from your product", "Cajas que vuelan junto a tu producto"],
  "music-video": ["Music video with your song & singer", "Videoclip con tu música y cantante", "Crea un videoclip con la tua musica e voce cantata"],
  "macro-product": ["A macro detail of your product", "Un detalle macro de tu producto"],
  "macro-scene": ["Your product in a macro scene", "Tu producto en una escena macro"],
  "magic-button": ["A glowing button changes the scene", "Un botón que cambia la escena"],
  mascot: ["You in a mascot costume", "Tú con traje de mascota"],
  "melting-doodle": ["Doodles melting down the frame", "Garabatos que se derriten"],
  meme: ["A meme from a scene and two lines", "Un meme: una escena y dos textos"],
  "micro-beasts": ["You among tiny animals", "Tú entre animales diminutos"],
  "moss-image": ["30 Film Looks & cinematic photo composer", "30 looks de cine y composición de layout", "30 Film Look cinematografici & controllo luce"],
  "krea2-realism": ["Photorealistic photography powered by Krea 2", "Fotografía fotorrealista con Krea 2", "Fotoritratti ultra-realistici con Krea 2"],
  "qwen-image-2512": ["Crisp typography, design & visuals with Qwen 2512", "Tipografía nítida y diseño con Qwen 2512", "Testi nitidi, grafica e scene con Qwen 2512"],
  ideogram4: ["Pro typography, posters & brand identity", "Tipografía pro, pósters e identidad visual", "Tipografia pro, poster e branding con Ideogram 4"],
  "flux1-krea": ["Warm natural photography without AI plastic sheen", "Fotografía natural sin brillo plástico IA", "Fotografia estetica naturale senza effetto plastica"],
  "z-image-grid": ["Instant 2×2 or 3×3 visual exploration grid", "Cuadrícula visual 2×2 o 3×3 al instante", "Griglia contatti 2×2 o 3×3 istantanea (0 GB extra)"],
  "z-image-palette": ["Generate shots locked to a strict HEX color palette", "Genera tomas bloqueadas a una paleta HEX exacta", "Immagini bloccate su palette HEX precisa"],
  "qwen-layered": ["Decompose any image into editable RGBA layers", "Descompón una imagen en capas RGBA editables", "Scomponi qualsiasi immagine in livelli RGBA separati"],
  "draw-to-video": ["Draw trajectories on your photo to animate camera & subject", "Dibuja trayectorias sobre tu foto para animar cámara y sujeto", "Disegna frecce di movimento sull'immagine (Wan-Move)"],
  "fly-path": ["Fly the camera along a 3D trajectory with Uni3C", "Vuela la cámara por una trayectoria 3D con Uni3C", "Vola con la camera lungo una traiettoria 3D (Uni3C)"],
  "orbit-360": ["360° circular orbit + synchronized audio with MiniMax H3", "Órbita 360° circular + audio sincronizado", "Orbita circolare 360° con audio MiniMax H3"],
  "transitions-pro": ["11 seamless pro transitions between start and end frames", "11 transiciones pro entre cuadro inicial y final", "11 transizioni cinematografiche tra due frame (Wan 2.2)"],
  "any-angle-3d": ["Re-shoot from 360° camera angles & focal presets", "Reencuadra desde ángulos 360° y focales de cine", "Re-inquadra l'immagine da ogni angolazione e focale 3D"],
  pixal3d: ["High-detail PBR 3D objects (.GLB) for ActionForge", "Objetos 3D PBR de alto detalle (.GLB)", "Oggetti 3D PBR ad alta precisione (.GLB) + ActionForge"],
  "multi-to-3d": ["Reconstruct 3D PBR mesh (.GLB) from 2–4 photos", "Reconstruye malla 3D PBR (.GLB) desde 2–4 vistas", "Ricostruisci oggetti 3D PBR (.GLB) da 2–4 angolazioni"],
  "text-to-3d": ["Describe an object in words and turn it into PBR 3D", "Describe un objeto y conviértelo en malla 3D PBR", "Descrivi a parole e genera mesh 3D PBR (.GLB) con Z-Image + Pixal3D"],
  "object-to-3d": ["Pick and extract any object from a scene photo into 3D", "Segmenta y extrae un objeto de una foto en 3D", "Segmenta ed estrai un singolo oggetto da una foto in 3D (.GLB)"],
  "trellis2-native": ["Native ComfyUI two-stage TRELLIS.2 PBR 3D mesh", "Malla 3D PBR nativa en ComfyUI TRELLIS.2", "Mesh 3D PBR TRELLIS.2 nativa a due stadi (.GLB)"],
  "hunyuan3d-21": ["Sculpt-grade geometry & 3D assets (.GLB) by Tencent", "Escultura e geometría 3D profesional (.GLB)", "Sculture ed asset 3D ad alta definizione (.GLB)"],
  "idol-3d": ["Full-body character 3D reconstruction (.GLB)", "Reconstrucción 3D de personaje completo (.GLB)", "Personaggi 3D completi pronti per rigging (.GLB)"],
  "triposplat-3d": ["Gaussian Splatting 3D objects & scenes (.GLB)", "Objetos 3D Gaussian Splatting (.GLB)", "Gaussian Splatting 3D ultra-veloce (.GLB)"],
  "scene-3d-moge": ["Instant 3D spatial scene mesh from any photo", "Escena 3D espacial instantánea desde foto", "Ricostruzione scena 3D istantanea MoGe-2 (0 GB extra)"],
  "body-double-3d": ["Photogrammetric human body double 3D mesh (.GLB)", "Doble humano 3D fotogramétrico (.GLB)", "Doppio umano 3D da foto (SAM 3D Body + InstantHMR)"],
  mukbang: ["You eating for the camera", "Tú comiendo para la cámara"],
  mural: ["You on a street mural", "Tú en un mural callejero"],
  "outfit-shot": ["A garment on a model, in studio", "Una prenda en modelo, en estudio"],
  "outfit-swap": ["Wear someone else's outfit", "Ponte el outfit de otra persona"],
  "outfit-vending": ["Your clothes in a vending machine", "Tu ropa en una máquina expendedora"],
  packshot: ["The closing frame of an ad", "El cuadro final de un anuncio"],
  "paint-app": ["Redrawn in a 90s paint program", "En un programa de dibujo de los 90"],
  "pixel-game": ["Your scene as 16-bit pixel art", "Tu escena en pixel art de 16 bits"],
  plushie: ["Remade as a plush toy", "Convertido en peluche"],
  poster: ["A product photo to a poster", "De foto de producto a póster"],
  "rap-video": ["You in a rap music video", "Tú en un video de rap"],
  renaissance: ["You as a Renaissance painting", "Tú como pintura renacentista"],
  "render-3d": ["A stylized 3D render", "Un render 3D estilizado"],
  "roller-coaster": ["You on a roller coaster", "Tú en una montaña rusa"],
  shots: ["Nine framings of one image", "Nueve encuadres de una imagen"],
  "sketch-to-real": ["From a sketch to a photo", "De boceto a foto"],
  "skin-enhancer": ["A natural skin retouch", "Retoque de piel natural"],
  "storm-creature": ["A storm giant behind your scene", "Gigante de tormenta tras tu escena"],
  "style-snap": ["You in a complete new outfit", "Tú con un outfit completo nuevo"],
  "truck-ad": ["A toy truck with your product", "Camión de juguete con tu producto"],
  "try-on": ["Try a garment on your photo", "Pruébate una prenda en tu foto"],
  "ugc-shot": ["A casual phone photo of your product", "Una foto casual de tu producto"],
  "victory-card": ["Your face on a winning card", "Tu cara en una carta ganadora"],
  "video-remove-bg": ["Cut the subject out of a clip", "Recorta al sujeto de un clip"],
  "volcano-ad": ["A volcano erupts behind your product", "Un volcán detrás de tu producto"],
  "whats-next": ["The next shot of your scene", "La siguiente toma de tu escena"],
  wonderfull: ["FaceApp-style beauty, smile, contouring & color studio", "Estudio de belleza facial, sonrisa y color estilo FaceApp", "Bellezza volti, sorriso, contouring ed effetti colore stile FaceApp"],
  zooms: ["Zoom levels of one image", "Niveles de zoom de una imagen"],
  "character-3": ["Three photos, one face", "Tres fotos, una misma cara"],
  moodboard: ["The look of three images", "El look de tres imágenes"],
  photodump: ["Four photos of you, one aesthetic", "Cuatro fotos tuyas, una estética"],
  inpaint: ["Paint it, describe it", "Píntalo y descríbelo"],
  "video-trim": ["Cut a clip cleanly by start time and duration", "Corta un clip con precisión por inicio y duración", "Taglia qualsiasi clip per inizio e durata esatti (0 GB)"],
  "video-join": ["Join two video clips at matched resolution", "Une dos clips a la misma resolución", "Unisci due clip video in sequenza (0 GB)"],
  "video-captions": ["Burn crisp titles or captions onto every frame", "Quema títulos o subtítulos en tu video", "Imprimi titoli e sottotitoli sul video (0 GB)"],
  "video-remove-dialogue": ["Strip spoken dialogue and mute clip cleanly", "Silencia diálogos de tu clip al instante", "Rimuovi il parlato lasciando audio pulito (0 GB)"],
  "video-export": ["Export cinema masters: ProRes, FFV1, H.265 or AV1", "Exporta masters en ProRes, FFV1, H.265 o AV1", "Esporta master ProRes, FFV1 Lossless, H.265 o AV1"],
  "video-depth": ["Extract per-frame Z-depth and normal passes", "Extrae profundidad Z-depth y normales del clip", "Estrai mappe Z-depth & normal map su tutto il video"],
  "video-face-swap": ["Swap a face across every frame of a video clip", "Cambia un rostro en cada cuadro del video", "Sostituisci il volto su tutto il video con ReActor"],
  "video-restore": ["Sharpen, de-blur and restore archival footage", "Restaura y da nitidez a material antiguo", "Restaura e recupera nitidezza di filmati d'archivio"],
  "video-remove-object": ["Track and erase any object or person from video", "Rastrea y borra cualquier objeto de un video", "Traccia e cancella oggetti/persone dal video (VACE)"],
  "video-swap": ["Track and swap any subject or object in video", "Reemplaza objetos o sujetos seguidos por IA", "Sostituisci oggetti/soggetti tracciati nel video (VACE)"],
  "video-insert": ["Insert a product or object from photo into video", "Inserta un objeto desde foto en una escena video", "Inserisci oggetti/prodotti da foto nel video (VACE)"],
  "video-restyle": ["Restyle an entire clip guided by DA3 depth", "Reestiliza todo el clip guiado por profundidad", "Ri-stilizza tutto il video guidato da profondità DA3"],
  "video-evolution": ["Morph and evolve a scene across time", "Evoluciona y transforma la escena en el tiempo", "Evoluzione e morphing temporale della scena (VACE)"],
  "video-blockout": ["Turn a 3D camera blockout into final cinema footage", "Convierte un bloqueo 3D en toma de cine", "Trasforma un blockout 3D pre-vis in ripresa finale"],
  "video-relight": ["Relight an entire clip with new light direction", "Reilumina todo el clip preservando el movimiento", "Ri-illumina l'intero video preservando i movimenti"],
  "head-swap": ["Transfer full head, hair and ears onto another shot", "Cambia la cabeza completa con cabello incluido", "Trasferisci l'intera testa con capelli e luci naturali"],
  "match-colors": ["Match palette and film grade to a reference image", "Iguala colores y contraste con una referencia", "Copia palette e grading da una foto riferimento"],
  "match-lighting": ["Relight a photo to match a reference light setup", "Iguala iluminación desde una foto de referencia", "Copia direzione e temperatura luce da una foto riferimento"],
  "object-remover": ["Erase objects described by text and rebuild background", "Borra cualquier objeto descrito por texto", "Rimuovi oggetti descritti a parole senza maschera"],
  "watermark-remover": ["Cleanly remove watermarks, stamps and logos", "Limpia marcas de agua, textos y logotipos", "Pulisci watermark, loghi e scritte dalle foto"],
  "ip-cleanup": ["Replace branded logos with safe generic equivalents", "Limpia marcas y logos para publicación segura", "Rimuovi marchi e loghi protetti per uso commerciale"],
  "change-background": ["Replace background with matched lighting and edges", "Cambia el fondo igualando luces y bordes", "Cambia completamente sfondo preservando luce e bordi"],
  colorize: ["Restore authentic natural color to B&W photos", "Colorea fotos en blanco y negro con realismo", "Colora foto in bianco e nero con toni naturali"],
  "marketing-studio": ["46 Product Shot, Ad, Poster & Marketplace templates", "46 plantillas de Product Shot, Ads, Posters y Marketplace", "46 template Product Shot, Ads, Posters e Marketplace Fuobe"],
  "marketing-video": ["UGC Hooks, Settings, Hypermotion & Mixed Media ads", "Anuncios con UGC Hooks, Settings e Hypermotion", "Spot Video Marketing, UGC Hooks, Settings & Hypermotion"],
  "layers-control": ["Prompt-guided RGBA element layer extraction", "Extracción guiada de capas RGBA por texto", "Estrai elementi specifici su livelli RGBA trasparenti"],
};
export function tagline(app) {
  const pair = TAGLINES[app.id];
  if (!pair) return app.summary || app.name;
  return lang === "it" && pair[2] ? pair[2] : lang === "es" && pair[1] ? pair[1] : pair[0];
}

/** Icon name per app for chips and tiles. */
export function iconOf(app) {
  const byIdIcon = { "trellis-3d": "box", wonderfull: "spark", relight: "sun", "remove-bg": "scissors", "qwen-layered": "layers", "layers-control": "layers", "marketing-studio": "bolt", "marketing-video": "video", "product-shot": "box", character: "user", speak: "user", talking: "user",
    recast: "user", "motion-transfer": "hand", "camera-moves": "camera", "camera-copy": "camera", reshoot: "camera", "draw-to-video": "camera", "fly-path": "camera", "orbit-360": "camera", "transitions-pro": "video", "any-angle-3d": "camera", music: "audio", sfx: "audio", effects: "spark" };
  return byIdIcon[app.id] || (app.section === "3d" ? "box" : app.section === "video" ? "video" : app.section === "audio" ? "audio" : "image");
}

/** The prompt of a set of values: the first required textarea, else the first textarea. */
export function promptInput(app) {
  const texts = app.inputs.filter((i) => i.type === "textarea");
  return texts.find((i) => i.required) || texts[0] || null;
}

/** Seconds the lab example took, as an estimate for the Generate button. */
export function estimate(app) {
  const s = app.example?.seconds;
  return s ? { seconds: s, gpu: (app.example.gpu || "").split(",")[0] || "GPU" } : null;
}

/** "fits whole" → [label key, css class] */
export function fitOf(app) {
  const v = app.vram?.verdict;
  if (!v) return null;
  const map = { "fits whole": ["fit.whole", "ok"], "fits by phases": ["fit.phases", "ok"], "tight (by phases)": ["fit.tight", "tight"],
    "needs Modal": ["fit.big", "big"], "no models": ["fit.none", ""] };
  return map[v] || [v, ""];
}

/** Complete 5-stage map of all 62 Fuobe FX tools mapped 1-to-1 to runnable Wox Cinema Studio PRO apps. */
export const FUOBE_FX_SECTIONS = [
  {
    id: "replace",
    title: "Replace & Recast",
    chip: "Replace & Recast",
    line: "Swap a person, face, head or object in your plate while preserving camera motion.",
    items: [
      { fxId: "genjutsu", label: "Genjutsu", sub: "Insert or swap anyone in scene", appId: "genjutsu" },
      { fxId: "character-swap", label: "Character Swap", sub: "Swap person & identity in photo", appId: "character-swap" },
      { fxId: "motion-control", label: "Motion Control", sub: "Copy any dance or performance", appId: "motion-transfer" },
      { fxId: "genjutsu-character", label: "Genjutsu Character", sub: "Swap character actor across video", appId: "recast" },
      { fxId: "genjutsu-motion", label: "Genjutsu Motion", sub: "Drive character with clip motion", appId: "motion-transfer" },
      { fxId: "genjutsu-swap", label: "Genjutsu Swap", sub: "Replace tracked object in video (VACE)", appId: "video-swap" },
      { fxId: "genjutsu-insert", label: "Genjutsu Insert", sub: "Insert photo object into video (VACE)", appId: "video-insert" },
      { fxId: "genjutsu-picture", label: "From Picture", sub: "Animate photo setting in motion", appId: "h3-photo" },
      { fxId: "genjutsu-reshoot", label: "Fuobe Reshoot", sub: "Same shot, edit or change performance", appId: "reshoot" },
      { fxId: "app-recast", label: "Recast", sub: "SCAIL-2 + SAM 3.1 actor replacement", appId: "recast" },
      { fxId: "app-video-face-swap", label: "Video Face Swap", sub: "ReActor face swap across video frames", appId: "video-face-swap" },
      { fxId: "app-face-swap", label: "Face Swap", sub: "Put any face onto a photo", appId: "face-swap" },
      { fxId: "app-head-swap", label: "Head Swap", sub: "Transfer full head, hair & ears", appId: "head-swap" },
    ],
  },
  {
    id: "clean-plates",
    title: "Clean Plates & Mattes",
    chip: "Clean Plates",
    line: "Erase people or objects, remove watermarks, key green screens and extract depth mattes.",
    items: [
      { fxId: "video-tools", label: "Video Tools Hub", sub: "Trim, join, matte & deliver any clip", appId: "vfx-clean-plate" },
      { fxId: "video-tools-remove-object", label: "Remove Object (Video)", sub: "Track & erase objects from video (VACE)", appId: "video-remove-object" },
      { fxId: "video-tools-green-screen", label: "Key / Matte Video", sub: "Cut out subject alpha matte per frame", appId: "video-remove-bg" },
      { fxId: "video-tools-colors", label: "Match Colors", sub: "Match shot colors to a reference image", appId: "match-colors" },
      { fxId: "video-tools-remove-person", label: "Remove Person (Video)", sub: "Clean plate reconstruction without people", appId: "vfx-clean-plate" },
      { fxId: "video-tools-depth", label: "Video Depth Pass", sub: "Z-depth & normal map per video frame", appId: "video-depth" },
      { fxId: "inpaint", label: "Inpaint (Brush)", sub: "Paint a mask and describe what goes there", appId: "inpaint" },
      { fxId: "layers", label: "RGBA Layers", sub: "Decompose image into editable layers", appId: "qwen-layered" },
      { fxId: "app-video-background-remover", label: "Video BG Remover", sub: "Cut subject out of an entire clip", appId: "video-remove-bg" },
      { fxId: "app-remove-background", label: "Remove Background", sub: "Transparent cutout in one click", appId: "remove-bg" },
      { fxId: "app-object-remover", label: "Object Remover", sub: "Erase anything described by prompt", appId: "object-remover" },
      { fxId: "app-watermark-remover", label: "Watermark Remover", sub: "Clean logos, timestamps & marks off photo", appId: "watermark-remover" },
      { fxId: "app-change-background", label: "Change Background", sub: "Place subject in a brand-new environment", appId: "change-background" },
      { fxId: "app-similarity-score", label: "IP Cleanup", sub: "Remove brand logos & IP for safe publish", appId: "ip-cleanup" },
      { fxId: "app-text-edit", label: "Text Edit", sub: "Edit or replace text inside images", appId: "edit-text" },
    ],
  },
  {
    id: "finish",
    title: "Retime, Reframe & Finish",
    chip: "Retime & Finish",
    line: "Trim, join, smooth motion, burn captions, restore footage and export ProRes / lossless masters.",
    items: [
      { fxId: "extend", label: "Extend Video", sub: "Continue shot seamlessly forward", appId: "extend-video" },
      { fxId: "reframe", label: "Reframe", sub: "Adapt clip to vertical, square or widescreen", appId: "reframe" },
      { fxId: "upscale-fps", label: "Smooth / RIFE FPS", sub: "Interpolate frames for smooth slow-mo", appId: "smooth" },
      { fxId: "video-tools-restore", label: "Restore Footage", sub: "Sharpen old/compressed clips (SeedVR2)", appId: "video-restore" },
      { fxId: "upscale", label: "Upscale Image", sub: "Sharper high-res images with SeedVR2", appId: "upscale" },
      { fxId: "upscale-video", label: "Upscale Video", sub: "Double resolution cleanly with SeedVR2", appId: "upscale-video" },
      { fxId: "upscale-hdr", label: "SDR to HDR", sub: "Expand dynamic range to HDR look", appId: "sdr-hdr" },
      { fxId: "upscale-export", label: "Master Export", sub: "ProRes 422, FFV1 Lossless, H.265 & AV1", appId: "video-export" },
      { fxId: "genjutsu-finish", label: "Finish & Grade", sub: "Fix faces, beauty & final color finish", appId: "wonderfull" },
      { fxId: "video-tools-trim", label: "Trim Video", sub: "Cut clip cleanly by start & duration", appId: "video-trim" },
      { fxId: "video-tools-join", label: "Join Clips", sub: "Merge two clips at matched resolution", appId: "video-join" },
      { fxId: "video-tools-captions", label: "Burn Captions", sub: "Draw styled titles & captions onto clip", appId: "video-captions" },
      { fxId: "video-tools-remove-dialogue", label: "Mute / Strip Speech", sub: "Cleanly strip dialogue track for dubbing", appId: "video-remove-dialogue" },
      { fxId: "app-skin-enhancer", label: "Skin Enhancer", sub: "Natural skin texture & beauty retouch", appId: "skin-enhancer" },
    ],
  },
  {
    id: "look",
    title: "Relight, Grade & Look",
    chip: "Relight & Look",
    line: "Relight footage, match cinema grades, restyle shots and restore color to B&W stills.",
    items: [
      { fxId: "video-tools-relight", label: "Video Relight", sub: "Relight whole video with Bernini-R 14B", appId: "video-relight" },
      { fxId: "genjutsu-restyle", label: "Genjutsu Restyle", sub: "Restyle video via Fun VACE + DA3 depth", appId: "video-restyle" },
      { fxId: "color-grade", label: "Color Grading", sub: "Cinematic LUTs & color look adjustments", appId: "color-grade" },
      { fxId: "video-edit", label: "Edit Video / Restyle", sub: "Transform clip look while keeping motion", appId: "video-restyle" },
      { fxId: "app-match-lighting", label: "Match Lighting", sub: "Copy light setup from reference image", appId: "match-lighting" },
      { fxId: "app-match-colors", label: "Match Colors", sub: "Transfer color grade from reference photo", appId: "match-colors" },
      { fxId: "app-style-transfer", label: "Style Transfer", sub: "Paint photo in any visual art style", appId: "style-reference" },
      { fxId: "app-colorize", label: "Colorize B&W", sub: "Natural realistic colorization for B&W shots", appId: "colorize" },
    ],
  },
  {
    id: "camera",
    title: "Camera & 3D",
    chip: "Camera & 3D",
    line: "3D body twins, 360° viewpoints, 3D pre-vis blockouts, 108 camera moves and morph evolutions.",
    items: [
      { fxId: "body-double", label: "Body Double 3D", sub: "Photogrammetric 3D human body mesh", appId: "body-double-3d" },
      { fxId: "any-angle", label: "Any Angle 3D", sub: "Reshoot any 360° camera angle & focal", appId: "any-angle-3d" },
      { fxId: "image-to-3d", label: "Image to 3D (.GLB)", sub: "PBR 3D object & ActionForge rigging", appId: "trellis-3d" },
      { fxId: "image-to-3d-splat", label: "3D Gaussian Splat", sub: "TripoSplat 3D objects & orbit views", appId: "triposplat-3d" },
      { fxId: "cinema", label: "Cinema Studio", sub: "Anamorphic optics, lenses & film stocks", appId: "cinema-studio" },
      { fxId: "cinema-blockout", label: "3D Blockout to Video", sub: "Turn camera pre-vis into final footage", appId: "video-blockout" },
      { fxId: "motions", label: "108 Camera Motions", sub: "Crane, drone, orbit & dual-motion mixing", appId: "camera-moves" },
      { fxId: "effects", label: "Effects (24+ LoRAs)", sub: "Viral visual transformations from one still", appId: "effects" },
      { fxId: "video-tools-evolution", label: "Video Evolution Morph", sub: "Transform scene progressively over time", appId: "video-evolution" },
      { fxId: "app-fuobe-angles", label: "Multi-Angle Sheet", sub: "Turn one shot into 9 camera angles", appId: "angles" },
      { fxId: "app-zoom-out", label: "Zoom Out / Shots", sub: "Multi-scale zoom frames from one photo", appId: "zooms" },
      { fxId: "app-shots", label: "Cinema Shots (9×)", sub: "Nine film framings of a single still", appId: "shots" },
    ],
  },
];
