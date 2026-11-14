// The waiter: turns form values into a filled workflow using only what app.json says,
// asks the gateway to clear the GPU when the app's models change, and submits with the Comfy SDK.
import { Comfy } from "@comfyorg/sdk";
import type { App, Input } from "./registry.ts";
import { isFileInput, modelKey } from "./registry.ts";

export type FileValue = { bytes: Uint8Array; name: string; type?: string };
export type Values = Record<string, unknown>;

/** Anything with setInput, so tests can pass a fake instead of the SDK's Workflow. */
export type Settable = { setInput(node: string, field: string, value: unknown): unknown };

export class InputError extends Error {}

function isFileValue(v: unknown): v is FileValue {
  return typeof v === "object" && v !== null && (v as FileValue).bytes instanceof Uint8Array;
}

function coerce(input: Input, raw: unknown): unknown {
  switch (input.type) {
    case "number":
    case "slider":
    case "seed": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new InputError(`${input.id}: expected a number`);
      if (input.min !== undefined && n < input.min) throw new InputError(`${input.id}: must be ≥ ${input.min}`);
      if (input.max !== undefined && n > input.max) throw new InputError(`${input.id}: must be ≤ ${input.max}`);
      return input.type === "seed" ? Math.trunc(n) : n;
    }
    case "toggle":
      return raw === true || raw === "true" || raw === "1" || raw === "on";
    case "select": {
      if (input.multiple) return picks(input, raw);
      const opts = input.options ?? [];
      const hit = opts.find((o) => o.value === raw || String(o.value) === String(raw));
      if (!hit) throw new InputError(`${input.id}: "${String(raw)}" is not one of the options`);
      return hit.value;
    }
    default:
      return raw;
  }
}

/** A multiple select's value: the picked option values in the order picked, no repeats. The form sends a JSON list. */
function picks(input: Input, raw: unknown): string[] {
  let list: unknown[];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { list = JSON.parse(raw); } catch { throw new InputError(`${input.id}: expected a list`); }
    if (!Array.isArray(list)) throw new InputError(`${input.id}: expected a list`);
  } else list = raw === "" || raw === null || raw === undefined ? [] : [raw];
  const out: string[] = [];
  for (const r of list) {
    const hit = (input.options ?? []).find((o) => String(o.value) === String(r));
    if (!hit) throw new InputError(`${input.id}: "${String(r)}" is not one of the options`);
    const v = String(hit.value);
    if (v && !out.includes(v)) out.push(v);
  }
  const max = input.multiple?.max;
  if (max && out.length > max) throw new InputError(`${input.id}: at most ${max}`);
  return out;
}

/** The picks of a multiple select as the one string templates and binds get. */
export function joinPicks(input: Input, list: unknown): string {
  const items = Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  if (!items.length) return "";
  const m = input.multiple ?? {};
  return `${m.prefix ?? ""}${items.join(m.join ?? ", ")}${m.suffix ?? ""}`;
}

/** Values as the workflow gets them: multiple selects joined. */
export function textValues(app: App, values: Values): Values {
  const out: Values = { ...values };
  for (const input of app.inputs) if (input.multiple && values[input.id] !== undefined) out[input.id] = joinPicks(input, values[input.id]);
  return out;
}

/** Fill defaults, coerce types, check required fields. File inputs pass through as FileValue. */
export function resolveValues(app: App, values: Values): Values {
  const out: Values = {};
  for (const input of app.inputs) {
    let v = values[input.id];
    // "" is a choice when a select offers it ("Any" in a builder writes nothing); elsewhere it means "use the default"
    const emptyIsOption = input.type === "select" && (Boolean(input.multiple) || (input.options ?? []).some((o) => o.value === ""));
    if (v === undefined || (v === "" && !emptyIsOption)) v = input.default;
    if (input.type === "seed" && (v === undefined || v === -1 || v === "-1")) {
      v = Math.floor(Math.random() * 2 ** 48);
    }
    if (v === undefined) {
      const isRequired = input.required === true || (input.required === undefined && isFileInput(input));
      if (isRequired) throw new InputError(`${input.id}: required`);
      continue;
    }
    if (isFileInput(input)) {
      if (!isFileValue(v)) throw new InputError(`${input.id}: expected a file`);
      const maxMb = input.limits?.max_mb;
      if (maxMb && v.bytes.byteLength > maxMb * 1e6) throw new InputError(`${input.id}: file is over ${maxMb} MB`);
      out[input.id] = v;
    } else {
      out[input.id] = coerce(input, v);
    }
  }
  // Forward any dynamic reference files (ref1, ref2, ...)
  for (const [key, v] of Object.entries(values)) {
    if (/^ref\d+$/.test(key) && !out[key] && isFileValue(v)) {
      out[key] = v;
    }
  }
  return out;
}

export function renderTemplate(template: string, values: Values): string {
  return template
    .replace(/\{([a-z][a-z0-9_]*)\}/g, (_, k: string) => (values[k] === undefined ? "" : String(values[k])))
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/,$/, "");
}

/** A value in an option's or preset's `sets`: a string with {placeholders} is filled like a bind template. */
export function setValue(value: unknown, values: Values): unknown {
  return typeof value === "string" && /\{[a-z][a-z0-9_]*\}/.test(value) ? renderTemplate(value, values) : value;
}

/**
 * Apply resolved values and an optional preset to a workflow.
 * `asset` turns a FileValue into whatever the workflow expects (an SDK asset handle).
 */
export function applyInputs(
  app: App,
  values: Values,
  wf: Settable,
  asset: (f: FileValue) => unknown,
  presetId?: string,
): void {
  values = textValues(app, values);
  for (const input of app.inputs) {
    const v = values[input.id];
    if (v === undefined) continue;
    for (const b of input.bind ?? []) {
      if (b.template) wf.setInput(b.node, b.field, renderTemplate(b.template, values));
      else wf.setInput(b.node, b.field, isFileValue(v) ? asset(v) : v);
    }
    // a select option can carry extra fields (the LoRA that goes with a style, an effect's prompt)
    const chosen = input.type === "select" ? input.options?.find((o) => o.value === v) : undefined;
    for (const s of chosen?.sets ?? []) wf.setInput(s.node, s.field, setValue(s.value, values));
  }
  if (presetId) {
    const preset = (app.presets ?? []).find((p) => p.id === presetId);
    if (!preset) throw new InputError(`preset "${presetId}" does not exist in ${app.id}`);
    for (const s of preset.sets) wf.setInput(s.node, s.field, setValue(s.value, values));
  }
  if (app.id === "character-studio" && !values.background) {
    if ((wf as any).json) {
      if ((wf as any).json["4"]?.inputs) {
        delete (wf as any).json["4"].inputs.image3;
      }
      if ((wf as any).json["14"]?.inputs) {
        delete (wf as any).json["14"].inputs.image3;
      }
      delete (wf as any).json["31"];
      delete (wf as any).json["32"];
    }
    const currentPrompt = (wf as any).json?.["4"]?.inputs?.prompt ?? (wf as any).sets?.["4.prompt"];
    if (typeof currentPrompt === "string") {
      const cleaned = currentPrompt.replace(/Environment and location:\s*(?:<ref_image_2>|Picture 3)\.\s*/gi, "").replace(/\s{2,}/g, " ").trim();
      wf.setInput("4", "prompt", cleaned);
    }
  }
  if (app.id === "cinema-studio") {
    if ((wf as any).json?.["18:6"] && (wf as any).json?.["30:64"]) {
      (wf as any).json["30:64"].inputs.width = (wf as any).json["18:6"].inputs.width;
      (wf as any).json["30:64"].inputs.height = (wf as any).json["18:6"].inputs.height;
    }
    if ((wf as any).json?.["18:17"]?.inputs?.value && typeof (wf as any).json["18:17"].inputs.value === "string") {
      (wf as any).json["18:17"].inputs.value = (wf as any).json["18:17"].inputs.value.replace(/\[?\s*@ref(\d+)\s*\]?/gi, (_: string, n: string) => `Picture ${n}`);
    }
  }

  // Handle trellis-3d hybrid Image-to-3D / Text-to-3D routing
  if (app.id === "trellis-3d" && (wf as any).json) {
    const g = (wf as any).json as Record<string, any>;
    const hasUploadedImage = isFileValue(values.image);
    if (hasUploadedImage) {
      // User uploaded an image: wire load_image directly into WOXTrellis3DNode and skip Z-Image generation
      if (g["trellis"]?.inputs) {
        g["trellis"].inputs.image = ["load_image", 0];
      }
      for (const nid of ["57:27", "57:28", "57:29", "57:30", "57:33", "57:11", "57:13", "57:3", "57:8"]) {
        delete g[nid];
      }
    } else {
      // No image uploaded: generate the 3D concept image first with Z-Image Turbo, then feed into WOXTrellis3DNode
      delete g["load_image"];
      if (g["trellis"]?.inputs) {
        g["trellis"].inputs.image = ["57:8", 0];
      }
    }
  }

  // Handle optional first_frame in video modes (cinema-video, director)
  if ((app.id === "cinema-video" || app.id === "director") && (wf as any).json) {
    const g = (wf as any).json as Record<string, any>;
    const hasFirstFrame = isFileValue(values.first_frame);
    if (hasFirstFrame && g["140:131"]) {
      // Match first_frame_scale megapixels to the chosen resolution if available
      const targetMp = Number(g["403"]?.inputs?.megapixels) || 0.6;
      if (g["first_frame_scale"]?.inputs) {
        g["first_frame_scale"].inputs.megapixels = targetMp;
      }
      // User provided an initial frame: feed the scaled image into MiniMax H3 first_frame socket
      g["140:131"].inputs.first_frame = ["first_frame_scale", 0];
      // Also update the still:9 save node to save the uploaded initial frame (or first frame)
      if (g["still:9"]?.inputs) {
        g["still:9"].inputs.images = ["first_frame_scale", 0];
      }
    } else {
      // No initial frame uploaded: run in text-to-video / generated still mode
      if (g["140:131"]?.inputs) {
        delete g["140:131"].inputs.first_frame;
      }
      delete g["first_frame"];
      delete g["first_frame_scale"];
    }
  }

  // Collect any dynamic references passed in values (ref1, ref2, ...) sorted by index
  const refEntries = Object.entries(values)
    .filter(([key, v]) => /^ref(\d+)$/.test(key) && isFileValue(v))
    .map(([key, v]) => ({
      key,
      num: Number(key.replace("ref", "")),
      file: v as FileValue,
      isVideo: (v as FileValue).type?.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test((v as FileValue).name),
      mappedNode: key === "ref1" ? "1" :
        key === "ref2" ? "still:18:11" :
        key === "ref3" ? "still:18:12" :
        key === "ref4" ? "still:18:13" :
        key === "ref5" ? "still:18:14" : `ref_node_${key.replace("ref", "")}`,
    }))
    .sort((a, b) => a.num - b.num);

  // Dynamically map any references passed in values (ref1, ref2, ...)
  for (const r of refEntries) {
    const field = r.isVideo ? "file" : "image";
    if (typeof (wf as any).setInput === "function") {
      if ((wf as any).json && !(wf as any).json[r.mappedNode]) {
        (wf as any).json[r.mappedNode] = {
          class_type: r.isVideo ? "LoadVideo" : "LoadImage",
          inputs: { [field]: asset(r.file) },
          _meta: { title: `Reference ${r.key} (@${r.key})` }
        };
      } else {
        if ((wf as any).json && (wf as any).json[r.mappedNode]) {
          const expectedClass = r.isVideo ? "LoadVideo" : "LoadImage";
          if ((wf as any).json[r.mappedNode].class_type !== expectedClass) {
            (wf as any).json[r.mappedNode].class_type = expectedClass;
            const oldField = r.isVideo ? "image" : "file";
            if ((wf as any).json[r.mappedNode].inputs) {
              delete (wf as any).json[r.mappedNode].inputs[oldField];
            }
          }
        }
        wf.setInput(r.mappedNode, field, asset(r.file));
      }
    }
  }

    // Clean up unused static placeholder ref nodes in cinema-video / director
    if ((app.id === "cinema-video" || app.id === "director") && (wf as any).json) {
      const g = (wf as any).json as Record<string, any>;
      const usedNodes = new Set(refEntries.map((r) => r.mappedNode));
      for (const placeholder of ["1", "still:18:11", "still:18:12", "still:18:13", "still:18:14"]) {
        if (!usedNodes.has(placeholder)) delete g[placeholder];
      }
    }
  const imageRefs = refEntries.filter((r) => !r.isVideo).slice(0, 3);
  if ((app.id === "cinema-studio" || app.id === "create-image" || app.id === "z-image") && (wf as any).json) {
    const g = (wf as any).json as Record<string, any>;
    if (imageRefs.length === 0) {
      if (app.id === "cinema-studio") {
        if (g["30:52"]?.inputs) {
          delete g["30:52"].inputs.image1;
          delete g["30:52"].inputs.image2;
          delete g["30:52"].inputs.image3;
        }
        if (g["30:15"]?.inputs) {
          g["30:15"].inputs.strength_model = 0.0;
        }
        delete g["1"];
        delete g["still:18:11"];
        delete g["still:18:12"];
        delete g["still:18:13"];
        delete g["still:18:14"];
      }
    } else {
      // Build a map from @refN / Picture N -> Picture <slotIdx> (1..3)
      const refNumToSlot = new Map<number, number>();
      imageRefs.forEach((r, idx) => refNumToSlot.set(r.num, idx + 1));

      // Extract the composed prompt text
      const promptNodeId = app.id === "z-image" ? "57:27" : "18:17";
      const promptField = app.id === "z-image" ? "text" : "value";
      let promptText = String(g[promptNodeId]?.inputs?.[promptField] ?? values.prompt ?? "");

      // Identify which reference is explicitly intended for face/identity (e.g. "@ref1 face", "@ref3 face", "identity of @ref2")
      let faceRefEntry: typeof imageRefs[0] | null = null;
      for (const r of imageRefs) {
        const tagPattern = new RegExp(`(?:face|identity|features|visage|volto|faccia|ritratto|person|man|woman|character)\\s+(?:of|from|di|del|in)?\\s*\\[?\\s*@ref${r.num}\\s*\\]?|\\[?\\s*@ref${r.num}\\s*\\]?\\s*(?:face|identity|volto)`, "i");
        if (tagPattern.test(promptText)) {
          faceRefEntry = r;
          break;
        }
      }
      // If user explicitly asks for face/identity but without naming a specific ref, or general prompt, check prompt keywords
      const hasFaceKeyword = /\b(face|facial|identity|volto|faccia|somiglianza)\b/i.test(promptText);

      promptText = promptText
        .replace(/\[?\s*@ref(\d+)\s*\]?/gi, (_: string, n: string) => `Picture ${refNumToSlot.get(Number(n)) ?? n}`)
        .replace(/\bPicture\s+(\d+)\b/gi, (_: string, n: string) => `Picture ${refNumToSlot.get(Number(n)) ?? n}`);

      // Ensure every active reference is mentioned in the prompt so Qwen-Image-Edit uses all attached references
      const unmentioned: number[] = [];
      for (let i = 1; i <= imageRefs.length; i++) {
        if (!new RegExp(`\\bPicture\\s+${i}\\b`, "i").test(promptText)) {
          unmentioned.push(i);
        }
      }
      if (unmentioned.length > 0) {
        const refDesc = imageRefs.length === 1
          ? "Featuring the exact subject, details, and visual reference from Picture 1."
          : `Combining the exact visual elements, subjects, style, and references from ${imageRefs.map((_, i) => `Picture ${i + 1}`).join(" and ")}.`;
        promptText = `${refDesc} ${promptText}`;
      }
      if (g[promptNodeId]?.inputs) {
        g[promptNodeId].inputs[promptField] = promptText;
      }

      // Clean up unused static placeholder ref nodes in cinema-studio
      const usedNodes = new Set(refEntries.map((r) => r.mappedNode));
      for (const placeholder of ["1", "still:18:11", "still:18:12", "still:18:13", "still:18:14"]) {
        if (!usedNodes.has(placeholder)) delete g[placeholder];
      }

      // Wire Qwen-Image-Edit-2509 multi-reference nodes
      const posInputs: Record<string, unknown> = {
        clip: ["qwen_ref_clip", 0],
        vae: ["qwen_ref_vae", 0],
        prompt: app.id === "z-image" ? promptText : [promptNodeId, 0],
      };
      const negInputs: Record<string, unknown> = {
        clip: ["qwen_ref_clip", 0],
        vae: ["qwen_ref_vae", 0],
        prompt: "deformed, distorted, wrong anatomy, blurry, low quality, artifacts",
      };

      imageRefs.forEach((r, idx) => {
        const scaleNode = `qwen_ref_scale_${idx + 1}`;
        g[scaleNode] = {
          class_type: "FluxKontextImageScale",
          inputs: { image: [r.mappedNode, 0] },
          _meta: { title: `Scale Reference ${idx + 1}` },
        };
        posInputs[`image${idx + 1}`] = [scaleNode, 0];
        negInputs[`image${idx + 1}`] = [scaleNode, 0];
      });

      g["qwen_ref_unet"] = {
        class_type: "UNETLoader",
        inputs: { unet_name: "qwen_image_edit_2509_fp8_e4m3fn.safetensors", weight_dtype: "default" },
        _meta: { title: "Load Qwen Image Edit Model" },
      };
      g["qwen_ref_clip"] = {
        class_type: "CLIPLoader",
        inputs: { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" },
        _meta: { title: "Load Qwen2.5-VL CLIP" },
      };
      g["qwen_ref_vae"] = {
        class_type: "VAELoader",
        inputs: { vae_name: "qwen_image_vae.safetensors" },
        _meta: { title: "Load Qwen Image VAE" },
      };
      g["qwen_ref_lora"] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          model: ["qwen_ref_unet", 0],
          lora_name: "Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors",
          strength_model: 1.0,
        },
        _meta: { title: "Load Lightning LoRA" },
      };
      g["qwen_ref_sampling"] = {
        class_type: "ModelSamplingAuraFlow",
        inputs: { model: ["qwen_ref_lora", 0], shift: 3.0 },
        _meta: { title: "ModelSamplingAuraFlow" },
      };
      g["qwen_ref_cfgnorm"] = {
        class_type: "CFGNorm",
        inputs: { model: ["qwen_ref_sampling", 0], strength: 1.0, pre_cfg: false },
        _meta: { title: "CFGNorm" },
      };
      g["qwen_ref_pos"] = {
        class_type: "TextEncodeQwenImageEditPlus",
        inputs: posInputs,
        _meta: { title: "Positive Reference Conditioning" },
      };
      g["qwen_ref_neg"] = {
        class_type: "TextEncodeQwenImageEditPlus",
        inputs: negInputs,
        _meta: { title: "Negative Reference Conditioning" },
      };

      // Ensure target canvas latent uses EmptyLatentImage (16-channel compatible with Qwen-Image)
      const latentNodeId = app.id === "z-image" ? "57:13" : "18:6";
      if (g[latentNodeId]) {
        g[latentNodeId].class_type = "EmptyLatentImage";
      }
      const targetLatent = g["ff_res"] ? ["ff_res", 0] : [latentNodeId, 0];
      const seedVal = Number(values.seed ?? g["18:7"]?.inputs?.noise_seed ?? g["18:7"]?.inputs?.seed ?? g["57:3"]?.inputs?.seed ?? 42);

      g["qwen_ref_ksampler"] = {
        class_type: "KSampler",
        inputs: {
          model: ["qwen_ref_cfgnorm", 0],
          positive: ["qwen_ref_pos", 0],
          negative: ["qwen_ref_neg", 0],
          latent_image: targetLatent,
          seed: seedVal,
          steps: 4,
          cfg: 1.0,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1.0,
        },
        _meta: { title: "KSampler (Reference Edit)" },
      };
      g["qwen_ref_decode"] = {
        class_type: "VAEDecode",
        inputs: {
          samples: ["qwen_ref_ksampler", 0],
          vae: ["qwen_ref_vae", 0],
        },
        _meta: { title: "VAE Decode" },
      };

      // Only engage ReActor Face Swap if a specific face reference was indicated or if the prompt mentions face/identity
      const targetFaceRef = faceRefEntry || (hasFaceKeyword ? imageRefs[0] : null);
      if (targetFaceRef) {
        g["qwen_ref_faceswap"] = {
          class_type: "ReActorFaceSwap",
          inputs: {
            enabled: true,
            input_image: ["qwen_ref_decode", 0],
            source_image: [targetFaceRef.mappedNode, 0],
            swap_model: "inswapper_128.onnx",
            facedetection: "retinaface_resnet50",
            face_restore_model: "GFPGANv1.4.pth",
            face_restore_visibility: 1.0,
            codeformer_weight: 0.5,
            detect_gender_input: "no",
            detect_gender_source: "no",
            input_faces_index: "0",
            source_faces_index: "0",
            console_log_level: 1,
          },
          _meta: { title: `Identity Lock Face Swap (@${targetFaceRef.key})` },
        };
        if (g["9"]?.inputs) {
          g["9"].inputs.images = ["qwen_ref_faceswap", 0];
        }
      } else {
        if (g["9"]?.inputs) {
          g["9"].inputs.images = ["qwen_ref_decode", 0];
        }
      }

      // Remove old unused T2I model/sampler nodes so ComfyUI only loads Qwen-Image-Edit
      for (const oldNode of [
        "30:10", "30:11", "30:12", "30:13", "30:15", "30:52", "30:53", "30:57", "30:58", "30:59", "30:60", "30:62", "30:64",
        "18:1", "18:2", "18:3", "18:4", "18:5", "18:7", "18:8", "18:11", "18:12", "18:13", "18:14", "18:16",
        "57:3", "57:8", "57:11", "57:28", "57:29", "57:30", "57:33",
      ]) {
        delete g[oldNode];
      }
    }
  } else if (app.id === "create-image" && (wf as any).json) {
    // When create-image runs without references and flux3 is not installed, use Krea 2 Turbo so it works out of the box locally
    const g = (wf as any).json as Record<string, any>;
    if (g["18:1"]?.inputs?.unet_name === "flux3-image-klein-int8-convrot.safetensors") {
      g["18:1"].inputs.unet_name = "krea2_turbo_int8_convrot.safetensors";
      if (g["18:2"]?.inputs) {
        g["18:2"].inputs.clip_name = "qwen3vl_4b_fp8_scaled.safetensors";
        g["18:2"].inputs.type = "krea2";
      }
      if (g["18:3"]?.inputs) {
        g["18:3"].inputs.vae_name = "qwen_image_vae.safetensors";
      }
      if (g["18:6"]) {
        g["18:6"].class_type = "EmptyLatentImage";
      }
      if (g["18:4"]?.inputs) {
        g["18:4"].inputs.text = ["18:17", 0];
      }
      if (g["18:5"]) {
        g["18:5"] = {
          class_type: "ConditioningZeroOut",
          inputs: { conditioning: ["18:4", 0] },
          _meta: { title: "Conditioning Zero Out" },
        };
      }
      if (g["18:7"]?.inputs) {
        g["18:7"].inputs.sampler_name = "euler";
        g["18:7"].inputs.steps = 8;
      }
      delete g["18:11"];
      delete g["18:12"];
      delete g["18:13"];
      delete g["18:14"];
      delete g["18:16"];
    }
  }
}

type NodeError = { type?: string; message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } };
type NodeErrors = Record<string, { class_type?: string; errors?: NodeError[] } | NodeError[]>;

/**
 * Turn ComfyUI's validation errors (relayed by the proxy as details.node_errors) into lines a
 * person can act on. When a loader asks for a model file the backend does not have, say which
 * pack to download. Returns null for errors that are not workflow validation errors.
 */
export function explainSubmitError(app: App, e: unknown): string | null {
  const err = e as { code?: string; details?: { node_errors?: NodeErrors } | null; message?: string };
  if (err?.code !== "invalid_workflow") return null;
  const modelFiles = new Set(app.models.map((m) => m.file.split("/").pop()));
  const lines: string[] = [];
  let missingModel = false;
  for (const [node, entry] of Object.entries(err.details?.node_errors ?? {})) {
    const errors = Array.isArray(entry) ? entry : entry.errors ?? [];
    const cls = Array.isArray(entry) ? "" : entry.class_type ?? "";
    for (const x of errors) {
      const received = x.extra_info?.received_value ?? /'([^']+)' not in/.exec(x.details ?? "")?.[1];
      if (x.type === "value_not_in_list" && typeof received === "string" && modelFiles.has(received)) {
        missingModel = true;
        lines.push(`${cls || "node"} (node ${node}): model file ${received} is not on the backend`);
      } else {
        const detail = (x.details ?? "").replace(/ not in \[.*$/s, " is not one of the allowed values");
        lines.push(`${cls || "node"} (node ${node}): ${x.message ?? x.type ?? "invalid"}${detail ? ` (${detail.slice(0, 200)})` : ""}`);
      }
    }
  }
  if (!lines.length) lines.push(err.message ?? "workflow rejected");
  if (missingModel) {
    lines.push(`Download the "${app.pack}" pack first:  modal run infra/modal_app.py::download --pack ${app.pack}`);
  }
  return `ComfyUI rejected the workflow:\n${lines.map((l) => `  ${l}`).join("\n")}`;
}

export type RunnerOptions = {
  /** Gateway in front of comfy-api-proxy, e.g. https://you--wox-serve.modal.run */
  baseUrl?: string;
  /** Token the gateway expects; sent by the SDK as a bearer token. */
  token?: string;
  /** Let draft apps run too (default: WOX_DRAFTS=1). Drafts have a workflow nobody has run on a GPU yet. */
  allowDrafts?: boolean;
  fetch?: typeof fetch;
};

export class Runner {
  readonly baseUrl: string;
  readonly token?: string;
  readonly allowDrafts: boolean;
  private comfy: Comfy;
  private doFetch: typeof fetch;

  constructor(opts: RunnerOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.COMFY_BASE_URL ?? "").replace(/\/$/, "");
    if (!this.baseUrl) throw new Error("Set COMFY_BASE_URL to the gateway URL");
    this.token = opts.token ?? process.env.WOX_TOKEN ?? process.env.FREEFIELD_TOKEN ?? undefined;
    this.allowDrafts = opts.allowDrafts ?? (process.env.WOX_DRAFTS === "1" || process.env.FREEFIELD_DRAFTS === "1");
    process.env.COMFY_BASE_URL = this.baseUrl; // the SDK reads its base URL from the environment
    this.doFetch = opts.fetch ?? fetch;
    this.comfy = new Comfy({ apiKey: this.token, clientInfo: "wox-cinema-studio-pro", fetch: opts.fetch });
  }

  /**
   * Ask the gateway to make room for this app. It compares the model set with the one
   * loaded last and unloads everything from VRAM when they differ. A backend without the
   * Wox Cinema Studio Pro gateway (a bare comfy-api-proxy, a hosted Comfy API) answers 404 and manages
   * its own memory, so that is not an error.
   */
  async prepare(app: App): Promise<{ freed: boolean; skipped?: boolean }> {
    let res = await this.doFetch(`${this.baseUrl}/wox/prepare`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ app: app.id, models: modelKey(app) }),
    });
    if (res.status === 404 || res.status === 405) {
      res = await this.doFetch(`${this.baseUrl}/freefield/prepare`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ app: app.id, models: modelKey(app) }),
      });
    }
    if (res.status === 404 || res.status === 405) return { freed: false, skipped: true };
    if (!res.ok) throw new Error(`gateway prepare answered ${res.status}`);
    return (await res.json()) as { freed: boolean };
  }

  async submit(app: App, rawValues: Values, presetId?: string) {
    if (!app.workflowPath) throw new InputError(`${app.id} has no workflow yet`);
    if (app.status !== "ready" && !this.allowDrafts) {
      throw new InputError(`${app.id} is a draft; set WOX_DRAFTS=1 (or pass --draft) to run it anyway`);
    }
    const values = resolveValues(app, rawValues);
    await this.prepare(app);
    const wf = await this.comfy.workflows.fromFile(app.workflowPath);
    applyInputs(
      app,
      values,
      wf,
      (f) => this.comfy.assets.fromBytes(f.bytes, { filename: f.name, contentType: f.type || undefined }),
      presetId,
    );
    return this.comfy.submit(wf);
  }

  jobs() {
    return this.comfy.jobs;
  }

  /**
   * The job's event stream (GET /api/v2/jobs/{id}/events) read as it comes, frame by frame, without the SDK's
   * job.events(): that one drops any progress frame lower than the last, and comfy-api-proxy's first frames
   * can say 1.0 (history.ts, Meter). Reconnects while the signal is alive; a stream that answers anything
   * but 200 (the job is gone) ends quietly: the poll decides.
   */
  async *frames(jobId: string, signal: AbortSignal): AsyncIterable<Frame> {
    const url = `${this.baseUrl}/api/v2/jobs/${encodeURIComponent(jobId)}/events`;
    const headers = { accept: "text/event-stream", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) };
    let failures = 0;
    while (!signal.aborted) {
      let res: Response;
      try {
        res = await this.doFetch(url, { headers, signal });
      } catch {
        if (signal.aborted || ++failures > 20) return;
        await new Promise((r) => setTimeout(r, Math.min(10_000, 1000 * failures)));
        continue;
      }
      if (res.status !== 200 || !res.body) return;
      failures = 0;
      try {
        yield* parseSse(res.body);
      } catch {
        if (signal.aborted) return;
      }
      if (!signal.aborted) await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export type Frame = { event: string; data: Record<string, unknown> };

/** Server-sent events, as the spec reads them: `event:` and `data:` lines, a blank line ends a frame. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<Frame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "", event = "message", data: string[] = [];
  const flush = (): Frame | null => {
    const out = data.length ? { event, data: safeJson(data.join("\n")) } : null;
    event = "message"; data = [];
    return out;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? "\n\n" : decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") { const f = flush(); if (f) yield f; }
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (done) return;
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { text };
  }
}
