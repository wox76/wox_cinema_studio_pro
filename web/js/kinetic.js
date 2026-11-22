// Fuobe Kinetic Motion Studio — live HTML5 Canvas motion graphics & WebM/PNG exporter.
// Implements all 18 Fuobe Kinetic templates locally in browser (0 GB GPU).
import { el, icon, toast } from "./util.js";
import { feed } from "./feed.js";

export const KINETIC_SCENES = [
  {
    slug: "kinetic-headline",
    name: "Kinetic Headline",
    cat: "SaaS & Launch",
    blurb: "Your promise sets itself word by word in bold type with highlighted *focus* words.",
    aspect: "9:16",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Headline (*asterischi* per evidenziare)", default: "Create *cinema* shots in seconds." },
      { id: "cta", label: "Call to action", default: "Try Wox Studio" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
      { id: "note", label: "Corner note", default: "COLLECTION 01" },
    ],
  },
  {
    slug: "big-number",
    name: "Big Number",
    cat: "Stats",
    blurb: "One huge stat counts smoothly up to its target, followed by caption & brand mark.",
    aspect: "4:5",
    duration: 4.0,
    fields: [
      { id: "stat", label: "Numero / Metrica (es. 10×, 98%, 4K)", default: "98%" },
      { id: "caption", label: "Sottotitolo", default: "Faster creative turnaround across every format" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
      { id: "note", label: "Corner note", default: "BENCHMARK 2026" },
    ],
  },
  {
    slug: "end-card",
    name: "Logo End Card",
    cat: "End Cards",
    blurb: "Animated brand closing card in 5 styles: Draw-on, Rise, Iris, Split, Glint.",
    aspect: "9:16",
    duration: 3.5,
    variants: ["draw-on", "rise", "iris", "split", "glint"],
    fields: [
      { id: "headline", label: "Brand Name", default: "WOX STUDIO" },
      { id: "product", label: "Tagline", default: "Built for filmmakers & creators" },
      { id: "cta", label: "Call to action", default: "Start Creating" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
    ],
  },
  {
    slug: "quote",
    name: "Five-Star Quote",
    cat: "Social Proof",
    blurb: "Five stars pop in sequentially while a customer review reveals line by line.",
    aspect: "4:5",
    duration: 5.0,
    fields: [
      { id: "quote", label: "Recensione", default: "“Cut our production cycle from three weeks to a single afternoon.”" },
      { id: "name", label: "Autore", default: "Elena V., Creative Director" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
    ],
  },
  {
    slug: "logo-sting",
    name: "Logo Sting",
    cat: "Branding",
    blurb: "Geometric marks converge into your brand name with a clean metallic sweep.",
    aspect: "4:5",
    duration: 3.5,
    fields: [
      { id: "headline", label: "Brand / Titolo", default: "WOX PRO" },
      { id: "tagline", label: "Sottotitolo", default: "NEXT-GEN CINEMA ENGINE" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
    ],
  },
  {
    slug: "feature-cards",
    name: "Feature Cards",
    cat: "SaaS & Product",
    blurb: "Rounded benefit cards glide in and stack cleanly under a bold launch headline.",
    aspect: "4:5",
    duration: 5.0,
    fields: [
      { id: "headline", label: "Headline", default: "Everything you need to ship ads." },
      { id: "point1", label: "Card 1", default: "01 · 108 Camera Moves & Orbit 360°" },
      { id: "point2", label: "Card 2", default: "02 · 3D PBR Assets & ActionForge" },
      { id: "point3", label: "Card 3", default: "03 · Instant Kinetic Brand Exports" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
    ],
  },
  {
    slug: "stat-dashboard",
    name: "Dashboard Zoom",
    cat: "SaaS & Stats",
    blurb: "Dark analytics card push-in with animated bar chart & live counter.",
    aspect: "4:5",
    duration: 4.5,
    fields: [
      { id: "stat", label: "Metrica Chiave", default: "$1,284,000" },
      { id: "label", label: "Etichetta", default: "Verified Monthly Attribution Revenue" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
    ],
  },
  {
    slug: "drop-countdown",
    name: "Midnight Drop",
    cat: "Drops & Promo",
    blurb: "Flip-clock launch countdown with huge drop headline & glowing live timer.",
    aspect: "9:16",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Drop Name", default: "MIDNIGHT EDITION" },
      { id: "count", label: "Countdown", default: "03:12:45" },
      { id: "when", label: "Data / Ora", default: "TONIGHT · 00:00 CET" },
      { id: "cta", label: "CTA", default: "Notify Me" },
    ],
  },
  {
    slug: "fragrance-reveal",
    name: "Nocturne Luxury",
    cat: "Luxury",
    blurb: "Sweeping ribbons of warm light over a deep noir field with serif display title.",
    aspect: "9:16",
    duration: 5.0,
    fields: [
      { id: "headline", label: "Product Name", default: "NOCTURNE N°07" },
      { id: "line", label: "Subtitle", default: "EXTRAIT DE PARFUM · MILANO" },
      { id: "cta", label: "CTA", default: "Discover" },
    ],
  },
  {
    slug: "editorial-sale",
    name: "Season Finale",
    cat: "Fashion & Retail",
    blurb: "Oversized editorial sale typography with highlighter offer band & angled CTA pill.",
    aspect: "4:5",
    duration: 4.0,
    fields: [
      { id: "headline", label: "Headline", default: "SEASON FINALE" },
      { id: "offer", label: "Offer", default: "UP TO 40% OFF ARCHIVE" },
      { id: "cta", label: "CTA", default: "Shop Archive" },
      { id: "website", label: "Website", default: "atelier.example" },
    ],
  },
  {
    slug: "glass-spotlight",
    name: "Prism Stage",
    cat: "Product",
    blurb: "Glass pedestal concentric light rings illuminating your uploaded product & copy.",
    aspect: "4:5",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Product Name", default: "PRISM SERUM PRO" },
      { id: "line", label: "Copy", default: "Glass-skin hydration in one drop." },
      { id: "cta", label: "CTA", default: "Shop Now" },
    ],
  },
  {
    slug: "announcement",
    name: "Marquee Event",
    cat: "Events",
    blurb: "Architectural grid event announcement with warm headline reveal, date & venue.",
    aspect: "9:16",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Evento", default: "DESIGN WEEK MILANO" },
      { id: "when", label: "Quando", default: "14–19 APRILE 2026" },
      { id: "place", label: "Dove", default: "VIA TORTONA 31 · H19:30" },
      { id: "cta", label: "CTA", default: "RSVP Free" },
    ],
  },
  {
    slug: "lookbook",
    name: "Runway Titles",
    cat: "Editorial",
    blurb: "Full-bleed fashion photo behind crisp cut-in titles, italic script accent & corner notes.",
    aspect: "4:5",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Title", default: "AUTUMN LOOKBOOK" },
      { id: "accent", label: "Script Word", default: "Milano" },
      { id: "line", label: "Line", default: "Capsule Tailoring Collection" },
      { id: "note", label: "Corner note", default: "ISSUE 09" },
    ],
  },
  {
    slug: "stat-stack",
    name: "Stat Stack (3×)",
    cat: "Stats",
    blurb: "Three bold metrics rolling up cleanly on a Swiss editorial ruled grid.",
    aspect: "4:5",
    duration: 4.5,
    fields: [
      { id: "stat1", label: "Stat 1", default: "98%" },
      { id: "label1", label: "Label 1", default: "Client Retention" },
      { id: "stat2", label: "Stat 2", default: "4.9★" },
      { id: "label2", label: "Label 2", default: "Verified Score" },
      { id: "stat3", label: "Stat 3", default: "3.2×" },
      { id: "label3", label: "Label 3", default: "ROAS Uplift" },
    ],
  },
  {
    slug: "testimonials",
    name: "Kind Words (3×)",
    cat: "Social Proof",
    blurb: "Three verified customer review cards gliding vertically with star ratings.",
    aspect: "4:5",
    duration: 5.0,
    fields: [
      { id: "quote1", label: "Quote 1", default: "“Sharpest exports I have ever shipped for a social campaign.”" },
      { id: "name1", label: "Author 1", default: "Marco R." },
      { id: "quote2", label: "Quote 2", default: "“Replaces half our After Effects pipeline in ten seconds.”" },
      { id: "name2", label: "Author 2", default: "Sofia L." },
      { id: "quote3", label: "Quote 3", default: "“Looks genuinely custom on every screen ratio.”" },
      { id: "name3", label: "Author 3", default: "Luca M." },
    ],
  },
  {
    slug: "line-reveal",
    name: "Line-Art Reveal",
    cat: "Product",
    blurb: "Continuous geometric outline traces around your frame before revealing the photo.",
    aspect: "9:16",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Headline", default: "Precision by design." },
      { id: "cta", label: "CTA", default: "Explore Specs" },
      { id: "note", label: "Corner note", default: "SERIES 04" },
    ],
  },
  {
    slug: "starburst",
    name: "Retro Starburst",
    cat: "Promo",
    blurb: "70s spinning starburst rays behind your product photo, bold display headline & badge.",
    aspect: "9:16",
    duration: 4.5,
    fields: [
      { id: "headline", label: "Headline", default: "SUMMER DROP IS LIVE" },
      { id: "badge", label: "Badge", default: "NEW" },
      { id: "website", label: "Website", default: "shop.example" },
    ],
  },
  {
    slug: "offer-badge",
    name: "Offer Badge",
    cat: "Promo",
    blurb: "Popping discount badge & kinetic offer reveal built for paid social conversion.",
    aspect: "9:16",
    duration: 4.0,
    fields: [
      { id: "offer", label: "Offer Badge", default: "-30% OFF" },
      { id: "headline", label: "Headline", default: "Weekend Flash Edit" },
      { id: "cta", label: "CTA", default: "Claim Offer" },
      { id: "website", label: "Website", default: "woxcinema.studio" },
    ],
  },
];

const RATIOS = {
  "9:16": [540, 960],
  "4:5": [600, 750],
  "1:1": [640, 640],
  "16:9": [854, 480],
};

const easeOutCubic = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function wrapLines(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test.replace(/\*/g, "")).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function kineticView(initialSlug = null) {
  const sceneMap = new Map(KINETIC_SCENES.map((s) => [s.slug, s]));
  const queryMatch = /[?&]scene=([a-z0-9-]+)/.exec(location.hash);
  let activeSlug = sceneMap.has(initialSlug) ? initialSlug : (queryMatch && sceneMap.has(queryMatch[1]) ? queryMatch[1] : KINETIC_SCENES[0].slug);

  const state = {
    aspect: sceneMap.get(activeSlug).aspect,
    duration: sceneMap.get(activeSlug).duration,
    pace: "steady",
    look: "film",
    camera: "push",
    variant: "glint",
    bgColor: "#0e1017",
    accentColor: "#e8ff5a",
    textColor: "#f8fafc",
    values: {},
    image: null,
    t: 0.45,
    playing: true,
    raf: 0,
  };

  function seedDefaults(scene) {
    for (const f of scene.fields) {
      if (state.values[f.id] === undefined) state.values[f.id] = f.default;
    }
    state.aspect = scene.aspect;
    state.duration = scene.duration;
  }
  seedDefaults(sceneMap.get(activeSlug));

  const canvas = el("canvas", {
    width: 600,
    height: 750,
    style: {
      maxWidth: "100%",
      maxHeight: "68vh",
      width: "auto",
      height: "auto",
      borderRadius: "12px",
      background: "#090a0f",
      boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
      display: "block",
      margin: "0 auto",
    },
  });
  const ctx = canvas.getContext("2d");

  function paceCurve(p) {
    if (state.pace === "slow") return Math.pow(clamp01(p), 0.72);
    if (state.pace === "snappy") return easeOutCubic(Math.min(1, p * 1.35));
    return easeOutCubic(p);
  }

  function renderFrame(progress) {
    const scene = sceneMap.get(activeSlug);
    const [W, H] = RATIOS[state.aspect] || [600, 750];
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const p = clamp01(progress);
    const ev = paceCurve(p);
    const bg = state.bgColor;
    const acc = state.accentColor;
    const ink = state.textColor;
    const val = (id, fb = "") => String(state.values[id] ?? fb);

    ctx.save();
    // Base Backdrop
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Camera motion transform
    let camScale = 1;
    let camX = 0;
    if (state.camera === "push") camScale = 1 + 0.07 * p;
    else if (state.camera === "drift") camX = (p - 0.5) * 28;
    ctx.translate(W / 2 + camX, H / 2);
    ctx.scale(camScale, camScale);
    ctx.translate(-W / 2, -H / 2);

    // Soft atmospheric radial glow
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.38, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    grad.addColorStop(0, `${acc}26`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Scene-specific background visuals / Starburst / Photo / Grid
    if (scene.slug === "starburst") {
      ctx.save();
      ctx.translate(W / 2, H * 0.44);
      ctx.rotate(p * Math.PI * 0.45);
      for (let i = 0; i < 18; i++) {
        ctx.rotate((Math.PI * 2) / 18);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-W * 0.08, -H);
        ctx.lineTo(W * 0.08, -H);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? `${acc}28` : `${acc}0a`;
        ctx.fill();
      }
      ctx.restore();
    } else if (scene.slug === "glass-spotlight") {
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.ellipse(W / 2, H * 0.68, (W * 0.16) * r, (W * 0.045) * r, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `${acc}${r === 1 ? "aa" : "35"}`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (scene.slug === "fragrance-reveal") {
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        const y0 = H * (0.28 + k * 0.14) + Math.sin(p * Math.PI * 2 + k) * 35;
        ctx.moveTo(-40, y0);
        ctx.bezierCurveTo(W * 0.35, y0 - 65, W * 0.65, y0 + 65, W + 40, y0 - 20);
        ctx.strokeStyle = `${acc}44`;
        ctx.lineWidth = 18 - k * 4;
        ctx.stroke();
      }
    }

    // Optional uploaded image
    if (state.image && state.image.complete && state.image.naturalWidth > 0) {
      const img = state.image;
      if (["lookbook", "editorial-sale", "announcement"].includes(scene.slug)) {
        const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const dw = img.naturalWidth * sc;
        const dh = img.naturalHeight * sc;
        ctx.globalAlpha = scene.slug === "lookbook" ? 0.92 : 0.45;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(9,10,15,0.38)";
        ctx.fillRect(0, 0, W, H);
      } else {
        const boxW = W * 0.46;
        const boxH = H * 0.36;
        const sc = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
        const dw = img.naturalWidth * sc;
        const dh = img.naturalHeight * sc;
        const lift = (1 - easeOutCubic(Math.min(1, p * 1.4))) * 45;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 24;
        ctx.drawImage(img, (W - dw) / 2, H * 0.42 - dh / 2 + lift, dw, dh);
        ctx.restore();
      }
    }

    const padX = Math.round(W * 0.08);
    ctx.textBaseline = "middle";

    // Render scene foreground typography & animated elements
    if (scene.slug === "kinetic-headline") {
      const words = val("headline").split(/\s+/).filter(Boolean);
      ctx.font = `800 ${Math.round(W * 0.092)}px system-ui, -apple-system, sans-serif`;
      const showCount = Math.max(1, Math.ceil(words.length * clamp01(p * 1.65)));
      const lines = wrapLines(ctx, words.slice(0, showCount).join(" "), W - padX * 2);
      const startY = H * 0.42 - ((lines.length - 1) * W * 0.11) / 2;
      ctx.textAlign = "center";
      lines.forEach((line, idx) => {
        const clean = line.replace(/\*/g, "");
        const hasAccent = /\*[^*]+\*/.test(line);
        ctx.fillStyle = hasAccent ? acc : ink;
        ctx.fillText(clean, W / 2, startY + idx * W * 0.112);
      });
    } else if (scene.slug === "big-number" || scene.slug === "stat-dashboard") {
      const rawStat = val("stat", "98%");
      const m = /^([^0-9.-]*)([0-9][0-9.,]*)(.*)$/.exec(rawStat);
      let shownStat = rawStat;
      if (m) {
        const num = Number(m[2].replace(/,/g, ""));
        if (Number.isFinite(num)) {
          const cur = Math.round(num * easeOutCubic(Math.min(1, p * 1.45)));
          const fmt = m[2].includes(",") ? cur.toLocaleString("en-US") : String(cur);
          shownStat = `${m[1]}${fmt}${m[3]}`;
        }
      }
      if (scene.slug === "stat-dashboard") {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        drawRoundedRect(ctx, padX, H * 0.25, W - padX * 2, H * 0.48, 22);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.stroke();
        for (let b = 0; b < 6; b++) {
          const bh = (0.3 + 0.6 * ((b * 37 % 10) / 10)) * H * 0.16 * ev;
          ctx.fillStyle = b === 5 ? acc : "rgba(255,255,255,0.18)";
          drawRoundedRect(ctx, padX + 26 + b * ((W - padX * 2 - 52) / 6), H * 0.68 - bh, ((W - padX * 2 - 52) / 6) - 10, bh, 6);
          ctx.fill();
        }
      }
      ctx.textAlign = "center";
      ctx.fillStyle = acc;
      ctx.font = `900 ${Math.round(W * 0.21)}px system-ui, sans-serif`;
      ctx.fillText(shownStat, W / 2, H * 0.38);
      ctx.fillStyle = ink;
      ctx.font = `600 ${Math.round(W * 0.044)}px system-ui, sans-serif`;
      const lbl = val(scene.slug === "stat-dashboard" ? "label" : "caption");
      wrapLines(ctx, lbl, W - padX * 2).forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.52 + i * W * 0.06));
    } else if (scene.slug === "end-card" || scene.slug === "logo-sting") {
      const v = state.variant;
      if (scene.slug === "end-card" && v === "iris") {
        ctx.save();
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, Math.max(W, H) * easeOutCubic(Math.min(1, p * 1.4)), 0, Math.PI * 2);
        ctx.clip();
      }
      const riseY = v === "rise" ? (1 - ev) * 60 : 0;
      ctx.textAlign = "center";
      ctx.fillStyle = acc;
      ctx.font = `900 ${Math.round(W * 0.11)}px system-ui, sans-serif`;
      ctx.fillText(val("headline", "WOX STUDIO"), W / 2, H * 0.43 + riseY);
      if (v === "draw-on" || scene.slug === "logo-sting") {
        const lw = W * 0.42 * ev;
        ctx.fillStyle = acc;
        ctx.fillRect((W - lw) / 2, H * 0.495, lw, 4);
      }
      if (v === "glint") {
        const gx = W * (-0.3 + p * 1.6);
        const glint = ctx.createLinearGradient(gx - 80, 0, gx + 80, H);
        glint.addColorStop(0, "transparent");
        glint.addColorStop(0.5, "rgba(255,255,255,0.22)");
        glint.addColorStop(1, "transparent");
        ctx.fillStyle = glint;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.fillStyle = ink;
      ctx.font = `500 ${Math.round(W * 0.042)}px system-ui, sans-serif`;
      ctx.fillText(val(scene.slug === "logo-sting" ? "tagline" : "product"), W / 2, H * 0.55 + riseY * 0.5);
      if (scene.slug === "end-card" && v === "iris") ctx.restore();
    } else if (scene.slug === "quote" || scene.slug === "testimonials") {
      if (scene.slug === "quote") {
        ctx.textAlign = "center";
        const stars = Math.min(5, Math.ceil(5 * clamp01(p * 1.8)));
        ctx.font = `${Math.round(W * 0.075)}px system-ui, sans-serif`;
        ctx.fillStyle = acc;
        ctx.fillText("★ ".repeat(stars).trim(), W / 2, H * 0.28);
        ctx.fillStyle = ink;
        ctx.font = `600 ${Math.round(W * 0.052)}px Georgia, serif`;
        const qLines = wrapLines(ctx, val("quote"), W - padX * 2);
        qLines.slice(0, Math.ceil(qLines.length * ev)).forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.43 + i * W * 0.07));
        ctx.fillStyle = `${ink}99`;
        ctx.font = `600 ${Math.round(W * 0.036)}px system-ui, sans-serif`;
        ctx.fillText(val("name"), W / 2, H * 0.68);
      } else {
        ctx.textAlign = "left";
        for (let k = 1; k <= 3; k++) {
          const slide = clamp01(p * 2.1 - (k - 1) * 0.28);
          const cy = H * (0.2 + (k - 1) * 0.23) + (1 - easeOutCubic(slide)) * 45;
          ctx.globalAlpha = easeOutCubic(slide);
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          drawRoundedRect(ctx, padX, cy, W - padX * 2, H * 0.18, 14);
          ctx.fill();
          ctx.fillStyle = acc;
          ctx.font = `700 ${Math.round(W * 0.034)}px system-ui, sans-serif`;
          ctx.fillText(`★★★★★ · ${val(`name${k}`)}`, padX + 18, cy + 28);
          ctx.fillStyle = ink;
          ctx.font = `500 ${Math.round(W * 0.034)}px system-ui, sans-serif`;
          wrapLines(ctx, val(`quote${k}`), W - padX * 2 - 36).slice(0, 2).forEach((ln, j) => ctx.fillText(ln, padX + 18, cy + 58 + j * 24));
          ctx.globalAlpha = 1;
        }
      }
    } else if (scene.slug === "feature-cards") {
      ctx.textAlign = "left";
      ctx.fillStyle = ink;
      ctx.font = `800 ${Math.round(W * 0.068)}px system-ui, sans-serif`;
      wrapLines(ctx, val("headline"), W - padX * 2).forEach((ln, i) => ctx.fillText(ln, padX, H * 0.18 + i * W * 0.08));
      for (let k = 1; k <= 3; k++) {
        const sub = clamp01(p * 2.2 - (k - 1) * 0.25);
        const cx = padX + (1 - easeOutCubic(sub)) * 80;
        const cy = H * (0.36 + (k - 1) * 0.16);
        ctx.globalAlpha = easeOutCubic(sub);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        drawRoundedRect(ctx, cx, cy, W - padX * 2, H * 0.125, 14);
        ctx.fill();
        ctx.strokeStyle = `${acc}66`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = acc;
        ctx.font = `700 ${Math.round(W * 0.042)}px system-ui, sans-serif`;
        ctx.fillText(val(`point${k}`), cx + 22, cy + H * 0.062);
        ctx.globalAlpha = 1;
      }
    } else if (scene.slug === "drop-countdown") {
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      ctx.font = `900 ${Math.round(W * 0.095)}px system-ui, sans-serif`;
      wrapLines(ctx, val("headline"), W - padX * 2).forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.26 + i * W * 0.105));
      const tiles = val("count", "03:12:45").split("");
      const tw = (W - padX * 2) / tiles.length;
      tiles.forEach((ch, i) => {
        const flip = clamp01(p * 2.4 - i * 0.08);
        const y = H * 0.48 + (1 - easeOutCubic(flip)) * 30;
        ctx.fillStyle = ch === ":" ? "transparent" : "rgba(255,255,255,0.1)";
        drawRoundedRect(ctx, padX + i * tw + 2, y - 34, tw - 4, 68, 8);
        ctx.fill();
        ctx.fillStyle = ch === ":" ? acc : ink;
        ctx.font = `800 ${Math.round(W * 0.072)}px ui-monospace, monospace`;
        ctx.fillText(ch, padX + i * tw + tw / 2, y + 2);
      });
      ctx.fillStyle = acc;
      ctx.font = `700 ${Math.round(W * 0.04)}px system-ui, sans-serif`;
      ctx.fillText(val("when"), W / 2, H * 0.62);
    } else if (scene.slug === "stat-stack") {
      ctx.textAlign = "left";
      for (let k = 1; k <= 3; k++) {
        const sub = easeOutCubic(clamp01(p * 2.0 - (k - 1) * 0.22));
        const y = H * (0.2 + (k - 1) * 0.22);
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.beginPath(); ctx.moveTo(padX, y + H * 0.15); ctx.lineTo(W - padX, y + H * 0.15); ctx.stroke();
        ctx.fillStyle = acc;
        ctx.font = `900 ${Math.round(W * 0.13 * (0.85 + 0.15 * sub))}px system-ui, sans-serif`;
        ctx.fillText(val(`stat${k}`), padX, y + 28);
        ctx.fillStyle = ink;
        ctx.font = `600 ${Math.round(W * 0.042)}px system-ui, sans-serif`;
        ctx.fillText(val(`label${k}`), padX, y + 84);
      }
    } else if (scene.slug === "line-reveal") {
      const m = 48;
      const perim = (W - m * 2) * 2 + (H * 0.56) * 2;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 4;
      ctx.setLineDash([perim, perim]);
      ctx.lineDashOffset = perim * (1 - ev);
      ctx.strokeRect(m, H * 0.18, W - m * 2, H * 0.56);
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      ctx.font = `800 ${Math.round(W * 0.075)}px system-ui, sans-serif`;
      wrapLines(ctx, val("headline"), W - padX * 2).forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.8 + i * W * 0.085));
    } else {
      // Generic clean editorial/promo/luxury layout (offer-badge, starburst, editorial-sale, fragrance-reveal, glass-spotlight, announcement, lookbook)
      ctx.textAlign = "center";
      const offerTxt = val("offer") || val("badge");
      if (offerTxt) {
        ctx.save();
        ctx.translate(W * 0.72, H * 0.22);
        ctx.rotate(-0.14 * ev);
        const s = 0.6 + 0.4 * ev;
        ctx.scale(s, s);
        ctx.fillStyle = acc;
        drawRoundedRect(ctx, -95, -28, 190, 56, 28);
        ctx.fill();
        ctx.fillStyle = "#0b0c10";
        ctx.font = `900 ${Math.round(W * 0.046)}px system-ui, sans-serif`;
        ctx.fillText(offerTxt, 0, 1);
        ctx.restore();
      }
      ctx.fillStyle = ink;
      const isSerif = scene.slug === "fragrance-reveal";
      ctx.font = `${isSerif ? "600" : "900"} ${Math.round(W * 0.085)}px ${isSerif ? "Georgia, serif" : "system-ui, sans-serif"}`;
      const hl = val("headline");
      wrapLines(ctx, hl, W - padX * 2).forEach((ln, i) => ctx.fillText(ln, W / 2, H * (state.image ? 0.2 : 0.4) + i * W * 0.095));
      if (val("accent")) {
        ctx.fillStyle = acc;
        ctx.font = `italic 700 ${Math.round(W * 0.085)}px Georgia, serif`;
        ctx.fillText(val("accent"), W / 2, H * 0.56);
      }
      const sub = val("line") || val("when");
      if (sub) {
        ctx.fillStyle = `${ink}cc`;
        ctx.font = `500 ${Math.round(W * 0.042)}px system-ui, sans-serif`;
        ctx.fillText(sub, W / 2, H * 0.73);
      }
      if (val("place")) {
        ctx.fillStyle = acc;
        ctx.font = `700 ${Math.round(W * 0.036)}px system-ui, sans-serif`;
        ctx.fillText(val("place"), W / 2, H * 0.79);
      }
    }

    // Bottom CTA pill & website/corner notes
    const ctaTxt = val("cta");
    if (ctaTxt) {
      const bw = Math.min(W * 0.62, Math.max(170, ctx.measureText(ctaTxt).width + 56));
      ctx.globalAlpha = clamp01(p * 2.5 - 0.3);
      ctx.fillStyle = acc;
      drawRoundedRect(ctx, (W - bw) / 2, H * 0.855, bw, 46, 23);
      ctx.fill();
      ctx.fillStyle = "#090a0f";
      ctx.textAlign = "center";
      ctx.font = `800 ${Math.round(W * 0.038)}px system-ui, sans-serif`;
      ctx.fillText(ctaTxt, W / 2, H * 0.855 + 23);
      ctx.globalAlpha = 1;
    }
    if (val("website")) {
      ctx.fillStyle = `${ink}88`;
      ctx.textAlign = "center";
      ctx.font = `600 ${Math.round(W * 0.028)}px ui-monospace, monospace`;
      ctx.fillText(val("website"), W / 2, H * 0.945);
    }
    if (val("note")) {
      ctx.fillStyle = `${ink}77`;
      ctx.textAlign = "right";
      ctx.font = `700 ${Math.round(W * 0.025)}px ui-monospace, monospace`;
      ctx.fillText(val("note"), W - 26, 28);
    }

    // Look overlays (film grain / vignette)
    if (state.look === "rich" || state.look === "film") {
      const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  let lastTs = 0;
  const tick = (ts) => {
    if (!canvas.isConnected) { state.raf = 0; return; }
    if (state.playing) {
      if (lastTs) {
        const dt = (ts - lastTs) / 1000;
        state.t = (state.t + dt / Math.max(1, state.duration)) % 1;
        scrub.value = String(Math.round(state.t * 1000));
      }
      lastTs = ts;
      renderFrame(state.t);
    } else lastTs = 0;
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);

  async function saveToLibrary(file) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const res = await fetch("/api/history/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`Upload error ${res.status}`);
    await feed.load().catch(() => {});
    toast(`Salvato in Libreria: ${file.name}`);
  }

  async function exportWebm(saveLib = false) {
    if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      toast("MediaRecorder non supportato in questo browser", { error: true });
      return;
    }
    const wasPlaying = state.playing;
    state.playing = false;
    exportBtn.disabled = true;
    saveVidBtn.disabled = true;
    try {
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const chunks = [];
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_500_000 } : undefined);
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime || "video/webm" })); });
      rec.start(100);
      const frames = Math.round(state.duration * 25);
      for (let i = 0; i <= frames; i++) {
        renderFrame(i / Math.max(1, frames));
        track?.requestFrame?.();
        await new Promise((r) => setTimeout(r, 38));
      }
      rec.stop();
      const blob = await done;
      stream.getTracks().forEach((tr) => tr.stop());
      const file = new File([blob], `kinetic-${activeSlug}.webm`, { type: blob.type || "video/webm" });
      if (saveLib) await saveToLibrary(file);
      else {
        const a = el("a", { href: URL.createObjectURL(file), download: file.name });
        a.click();
        toast(`Esportato ${file.name}`);
      }
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      exportBtn.disabled = false;
      saveVidBtn.disabled = false;
      state.playing = wasPlaying;
    }
  }

  function exportPng(saveLib = false) {
    renderFrame(state.t);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `kinetic-${activeSlug}.png`, { type: "image/png" });
      if (saveLib) await saveToLibrary(file).catch((e) => toast(e.message, { error: true }));
      else {
        const a = el("a", { href: URL.createObjectURL(file), download: file.name });
        a.click();
      }
    }, "image/png");
  }

  const fieldsBox = el("div", { style: { display: "grid", gap: "8px" } });
  const variantWrap = el("div");
  function rebuildFields() {
    const sc = sceneMap.get(activeSlug);
    fieldsBox.replaceChildren(...sc.fields.map((f) => el("div", { class: "field" },
      el("label", {}, f.label),
      el("input", {
        type: "text",
        value: valText(f.id, f.default),
        oninput: (e) => { state.values[f.id] = e.target.value; renderFrame(state.t); },
      }))));
    variantWrap.replaceChildren(...(sc.variants ? [
      el("div", { class: "field" },
        el("label", {}, "Stile End Card"),
        el("select", {
          onchange: (e) => { state.variant = e.target.value; renderFrame(state.t); },
        }, ...sc.variants.map((v) => el("option", { value: v, selected: v === state.variant }, v))))
    ] : []));
  }
  const valText = (id, fb) => String(state.values[id] ?? fb);

  const sceneSel = el("select", {
    onchange: (e) => {
      activeSlug = e.target.value;
      seedDefaults(sceneMap.get(activeSlug));
      ratioSel.value = state.aspect;
      rebuildFields();
      renderFrame(state.t);
    },
  }, ...KINETIC_SCENES.map((s) => el("option", { value: s.slug, selected: s.slug === activeSlug }, `${s.name} · ${s.cat}`)));

  const ratioSel = el("select", {
    onchange: (e) => { state.aspect = e.target.value; renderFrame(state.t); },
  }, ...Object.keys(RATIOS).map((r) => el("option", { value: r, selected: r === state.aspect }, r)));

  const scrub = el("input", {
    type: "range",
    min: "0",
    max: "1000",
    value: "450",
    style: { flex: "1", accentColor: "#e8ff5a" },
    oninput: (e) => {
      state.playing = false;
      playBtn.textContent = "Play ▶";
      state.t = Number(e.target.value) / 1000;
      renderFrame(state.t);
    },
  });

  const playBtn = el("button", {
    class: "btn ghost",
    type: "button",
    onclick: () => {
      state.playing = !state.playing;
      playBtn.textContent = state.playing ? "Pausa ❚❚" : "Play ▶";
    },
  }, "Pausa ❚❚");

  const imgInput = el("input", {
    type: "file",
    accept: "image/*",
    onchange: () => {
      const f = imgInput.files?.[0];
      if (!f) return;
      const im = new Image();
      im.onload = () => { state.image = im; renderFrame(state.t); };
      im.src = URL.createObjectURL(f);
    },
  });

  const exportBtn = el("button", { class: "btn lime", type: "button", onclick: () => exportWebm(false) }, icon("download"), "Esporta WebM");
  const saveVidBtn = el("button", { class: "btn ghost", type: "button", onclick: () => exportWebm(true) }, icon("film"), "Salva Clip in Libreria");

  rebuildFields();
  renderFrame(state.t);

  const sidebar = el("aside", { class: "side", style: { padding: "14px", display: "grid", gap: "10px", alignContent: "start", overflowY: "auto" } },
    el("h2", { class: "display", style: { margin: 0, fontSize: "20px" } }, "Fuobe Kinetic Motion"),
    el("p", { style: { margin: 0, fontSize: "12px", color: "var(--dim)" } }, "18 template di motion graphics brandizzati renderizzati in tempo reale (0 GB GPU)."),
    el("div", { class: "field" }, el("label", {}, "Scena Kinetic (18)"), sceneSel),
    variantWrap,
    fieldsBox,
    el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
      el("div", { class: "field" }, el("label", {}, "Formato"), ratioSel),
      el("div", { class: "field" }, el("label", {}, "Ritmo"), el("select", { onchange: (e) => { state.pace = e.target.value; } },
        el("option", { value: "slow" }, "Slow"), el("option", { value: "steady", selected: true }, "Steady"), el("option", { value: "snappy" }, "Snappy")))
    ),
    el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" } },
      el("div", { class: "field" }, el("label", {}, "Sfondo"), el("input", { type: "color", value: state.bgColor, oninput: (e) => { state.bgColor = e.target.value; renderFrame(state.t); } })),
      el("div", { class: "field" }, el("label", {}, "Accento"), el("input", { type: "color", value: state.accentColor, oninput: (e) => { state.accentColor = e.target.value; renderFrame(state.t); } })),
      el("div", { class: "field" }, el("label", {}, "Testo"), el("input", { type: "color", value: state.textColor, oninput: (e) => { state.textColor = e.target.value; renderFrame(state.t); } }))
    ),
    el("div", { class: "field" }, el("label", {}, "Foto / Prodotto di sfondo (opzionale)"), imgInput),
    el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", paddingTop: "6px" } },
      exportBtn,
      saveVidBtn,
      el("button", { class: "btn ghost", type: "button", onclick: () => exportPng(true) }, "Salva PNG"),
      el("a", { class: "btn ghost", href: "#/marketing" }, "Tutti i Template →")
    )
  );

  const stage = el("section", { style: { flex: 1, padding: "20px", display: "grid", gap: "14px", alignContent: "center" } },
    canvas,
    el("div", { style: { display: "flex", gap: "10px", alignItems: "center", maxWidth: "600px", width: "100%", margin: "0 auto" } },
      playBtn,
      scrub
    )
  );

  const node = el("div", { class: "ws" }, sidebar, stage);
  return { node, active: "marketing", dispose: () => { if (state.raf) cancelAnimationFrame(state.raf); } };
}
