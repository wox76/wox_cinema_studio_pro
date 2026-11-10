# 🎬 WOX Cinema Studio for ComfyUI

**Language / Lingua**: [🇮🇹 Versione Italiana](DOCUMENTAZIONE.md) | [🇬🇧 English Version](DOCUMENTATION.md)

---

Welcome to the official documentation of **WOX Cinema Studio**, the next-generation node for ComfyUI designed to bring the complete experience of AI cinematic directing, generation, and post-production directly onto the ComfyUI canvas.

Inspired by the renowned **Higgsfield AI** platform, **WOX Cinema Studio** delivers visual, stylistic, and motion results **virtually 1:1 with Higgsfield**, combining cinephile controls, a powerful **internal video editing suite with timeline sequencer**, a comprehensive **Multimedia Manager / Asset Gallery**, and fully integrated support for ultra-high fidelity video and image generation.

---

## 📌 Table of Contents
1. [What is WOX Cinema Studio?](#-what-is-wox-cinema-studio)
2. [Higgsfield Inspiration & 1:1 Cinematic Fidelity](#-higgsfield-inspiration--11-cinematic-fidelity)
3. [AI Engines & 100% Local Architecture (16GB VRAM)](#-ai-engines--100-local-architecture-16gb-vram)
4. [Key Features](#-key-features)
5. [Interface & Feature Guide](#-interface--feature-guide)
   - [Directing Bar & Cinephile Controls](#directing-bar--cinephile-controls)
   - [Internal Video Montage (Timeline Sequencer)](#internal-video-montage-timeline-sequencer)
   - [Multimedia Manager & Asset Gallery](#multimedia-manager--asset-gallery)
   - [Top 3 Video Carousel & Drag and Drop](#top-3-video-carousel--drag-and-drop)
   - [Qwen Image Edit UNET (FP8): Natural Prompt Image Editing](#qwen-image-edit-unet-fp8-natural-prompt-image-editing)
   - [Settings Panel & Built-in Auto-Installer (Gear Icon)](#settings-panel--built-in-auto-installer-gear-icon)
6. [Quick Installation Guide](#-quick-installation-guide)
7. [Node Inputs, Parameters & Outputs](#-node-inputs-parameters--outputs)
8. [Changelog & Recent Updates](#-changelog--recent-updates)

---

## 🌟 What is WOX Cinema Studio?

**WOX Cinema Studio** is not just a simple prompt-passing node: it is a comprehensive, **all-in-one cinematic production suite** embedded as a native Custom Node inside ComfyUI.

It eliminates node spaghetti and fractured workflows by consolidating everything needed to turn a written script into an exported, edited short film within a single dark, ergonomic, and reactive interface: camera movement, optical film stock recipes, volumetric lighting setups, reference tags, instant prompt-based image corrections, and non-linear video editing with a timeline.

![WOX Cinema Studio Main Interface](documents/Screenshot_20260918_200615.png)

---

## 🎯 Higgsfield Inspiration & 1:1 Cinematic Fidelity

WOX Cinema Studio was engineered modeling the workflow, ergonomics, and visual richness of **Higgsfield AI**:
- **Structured Cinematic Prompting**: Visual syntax and automatic style injection emulate virtual film directors, inserting Kodak 35mm film grain, organic halation, true celluloid texture, and analog color palettes.
- **Virtually 1:1 Visual Quality**: By synergizing state-of-the-art models (**Minimax H3** and **Z-Image Turbo**) with curated visual presets, you achieve rock-solid camera motion consistency, realistic skin micro-textures, volumetric atmosphere, and temporal stability identical to Higgsfield's flagship generations.
- **Sleek Dark Interface with Fluo Accents & Pill Controls**: High-contrast dark styling, monochromatic SVG iconography, and responsive pill toggles deliver an exhilarating, distraction-free creative session.

---

## ⚡ AI Engines & 100% Local Architecture (16GB VRAM)

The entire pipeline is built to **run 100% locally** on consumer hardware equipped with **16 GB of VRAM** (such as NVIDIA RTX 30-series / 40-series 16GB GPUs), completely offline without requiring recurring subscription costs:

### 1. 🎥 MINIMAX H3 (Cinematic Video Generation)
- Dedicated engine for photorealistic **cinematic video generation**, both from pure text (*Text-to-Video*) and guided by reference images (*Image-to-Video*).
- Quantized INT8/FP8 diffusion UNETs (*MiniMax H3 FL2VA / Ref2VA*) combined with high-capacity text encoders yield smooth temporal motion, complex multi-object choreography, and cinematic lighting on 16GB VRAM.

### 2. 🖼️ Z-IMAGE (Image & Keyframe Generation)
- Blazing-fast diffusion engine for ultra-high-definition cinematic **stills and keyframes**.
- Based on an optimized UNET FP8 pipeline and 16-channel autoencoder VAE, generating razor-sharp images in seconds.

### 3. 🎨 QWEN IMAGE EDIT UNET (FP8) (Natural Prompt Image Editing)
- Cutting-edge solution for **contextual image editing guided entirely by natural language text prompts**.
- Powered by the **Qwen Image Edit UNET FP8**, the *Qwen 2.5 VL 7B FP8* Vision-Language encoder, and the *Lightning 4-Steps LoRA*, allowing users to describe what to alter (e.g., *"add sunglasses"*, *"change expression to a wide joyful smile"*, *"turn lighting into golden sunset"*). Generates edits in only **4 inference steps** with minimal VRAM overhead.

---

## 🚀 Key Features

| Feature | Description |
| :--- | :--- |
| **Native ComfyUI Node** | Operates directly within the ComfyUI canvas, feeding standard IMAGE, VIDEO, and PROMPT types to downstream nodes. |
| **100% Local Execution** | Optimized with FP8/INT8 precision to run entirely on a single **16GB VRAM GPU**. |
| **Built-in Auto-Installer (⚙️)** | One-click installation wizard in the **Gear icon** that checks, downloads, and configures missing nodes, pip modules, and HuggingFace models. |
| **MINIMAX H3 & Z-IMAGE** | The definitive dual-engine pair for cinematic video synthesis and pristine still images. |
| **Qwen Image Edit UNET (FP8)** | Text-guided selective image modifications in 4 instant inference steps. |
| **Internal Video Montage (Timeline)** | Multi-clip NLE timeline sequencer to cut, trim, arrange, preview, and export joined MP4 videos without leaving ComfyUI. |
| **Multimedia Manager & Gallery** | Visual asset repository to browse, inspect, filter, and reuse generations, videos, images, and audio tracks. |
| **Top 3 Video Carousel** | Persistent carousel displaying the latest 3 generated clips with live playback and drag-and-drop. |
| **Direct Drag & Drop** | Drag generated media cards directly into ComfyUI canvas nodes (Load Video, Preview Image) or to your desktop. |
| **Smart Reference System (@tags)** | Link character, style, or camera references using concise `@ref_tag` mentions in the prompt. |
| **Cinematic Template Library** | Directorial guided workflows with 3D untextured blockout videos, keyframe continuity, and casting setups. |
| **AI Visual Reference Analysis** | Real-time tonal & color analysis (brightness, saturation, contrast) with automatic prompt directives (Ollama-ready). |
| **Complete Prompt & Reference Bundles** | Save full prompt setups, directing presets, and linked media assets directly to the Media Gallery *Prompts* archive. |
| **Sampling Steps Control (20-60)** | Interactive chip and widget for direct canvas-synchronized control of sampling step counts. |

---

## 🎬 Interface & Feature Guide

### Directing Bar & Cinephile Controls

WOX Cinema Studio includes 4 interactive directing categories accessible via pill buttons with rich visual card catalogs:

1. **Film Setup (Film Stocks & Genres)**:
   - *General (35mm Standard)*, *Cinematic 35mm (Kodak Celluloid)*, *IMAX 70mm*, *NOIR & Noir Classic*, *High-Octane Action*, *Horror*, *Comedy*, *Epic*, *Drama*, *Vintage Super 8*, *Anime Style*.
   
   ![Film Setup Gallery](documents/Screenshot_20260918_200736.png)

2. **Lighting (Cinematic & Atmospheric Schemes)**:
   - *Studio Softbox*, *Golden Hour*, *Dramatic Rim Light*, *Volumetric Fog*, *Cyber Neon Glow*, *Low Key Dark*, *Auto (Intelligent)*.
   
   ![Cinematic Lighting Schemes](documents/Screenshot_20260918_200804.png)

3. **Camera Motion**:
   - *Pan Left/Right*, *Tilt Up/Down*, *Slow Zoom In*, *Drone FPV*, *360 Orbit*, *Static Tripod*, *Handheld Shake*.

4. **Color Palette**:
   - *Teal & Orange*, *Neon Rain at Midnight*, *Cyberpunk Neon*, *B&W Monochrome*, *Warm Sunset*, *Cool Moonlight*, *Pastel Aesthetic*.

---

### Internal Video Montage (Timeline Sequencer)

The lower section **WOX CINEMA STUDIO • MONTAGGIO VIDEO** embeds a fully functioning non-linear editor (NLE) right into the node:

- **Add Clips Effortlessly**: Click `+ Aggiungi Clip` to load generations from your catalog or import video files from your disk.
- **Trim & Arrange (Cut & Move)**:
  - Scrub the red playhead and click **Taglia (Cut)** to slice clips at the exact desired timestamp.
  - Switch to **Sposta (Move)** mode to reorder clips along the timeline via drag-and-drop.
  - Delete unwanted segments with **Cancella (Delete)**.
- **Real-Time Preview Monitor**: Built-in player with **Play**, **Stop**, timecode tracker `00:00.0 / Total Duration`, and fluid playback.
- **One-Click Export (⚡ Esporta Video)**:
  - Automatically joins, trims, and concatenates the timeline sequence via the internal FFmpeg backend into a master MP4 saved to `output/video`.

![Internal Video Montage Timeline](documents/Screenshot_20260918_201238.png)

![Export Video Button Detail](documents/Screenshot_20260918_201221.png)

---

### Multimedia Manager & Asset Gallery

Clicking the grid icon in the top right opens the full-screen **Media Manager**:

- **Quick Scope Filters**: Switch between *Generations*, *Uploads*, *Elements*, and *Liked*.
- **Media Type Filter**: Isolate *Images*, *Videos*, or *Audio*.
- **Detailed Clip Inspector**: Selecting any card opens an interactive player displaying the original prompt and instant action buttons:
  - `Aggiungi a Timeline`: Appends the clip to your montage project.
  - `Usa come Reference`: Sets the item as an active `@tag` reference.
  - `Apri Originale`: Opens the uncompressed source file.

![Multimedia Manager](documents/Screenshot_20260918_200706.png)

![Media Inspector View](documents/Screenshot_20260918_200647.png)

---

### Top 3 Video Carousel & Drag and Drop

Directly above the prompt composer, the top carousel maintains immediate access to your 3 most recent video renders:
- Live animated video previews.
- File labels and engine metadata (e.g. *MiniMax H3 Video*).
- **Universal Drag & Drop**: Grab any video card and drop it onto the ComfyUI canvas (into a *Load Video* or *VHS Video Combine* node) or directly onto your OS desktop.
- One-click icons to **Refresh** the list and **Open the output directory**.

---

### Qwen Image Edit UNET (FP8): Natural Prompt Image Editing

WOX Cinema Studio includes a dedicated interface for prompt-guided image modifications:
- **Describe the Modification**: Type changes in plain natural language (e.g., *"add classic sunglasses"*, *"remove background signs and logos"*, *"shift scene into a rainy night with neon reflections"*).
- **Quick Preset Pills**: One-click prompt chips (*Happy expression*, *Sunglasses*, *Formal suit*, *Remove text/logos*, *Rain & Neon*, *Golden sunset*).
- **Multi-Reference Tagging**: Attach supplementary guidance references via `+ Scegli Reference`.
- **Lightning 4-Steps Acceleration**: Realizes changes in only 4 inference steps using the FP8 UNET and LoRA accelerator.

![Qwen Image Edit Window](documents/Screenshot_20260918_200835.png)

---

### ⚙️ Settings Panel & Built-in Auto-Installer (Gear Icon)

No manual script hunting or tedious HuggingFace downloads are required:

1. Click the **Gear icon (⚙️)** in the top right corner of the WOX Cinema Studio node.
2. The **System Status & Model Manager** modal opens.
3. The wizard audits your ComfyUI setup:
   - **ComfyUI Custom Nodes**: *ComfyUI-VideoHelperSuite*, *ComfyUI-KJNodes*, *ComfyUI-Manager*.
   - **Python Libraries**: *requests*, *aiohttp*, *imageio*, *imageio-ffmpeg*, *Pillow*.
   - **AI Models & Weights**:
     - *MiniMax H3 Video UNET (INT8)*, *CLIP Qwen3-VL 32B*, and *Video VAE*.
     - *Z-Image Turbo UNET (FP8)*, *Qwen 3 4B Text Encoder*, and *AE VAE*.
     - *Qwen Image Edit UNET (FP8)*, *Qwen 2.5 VL 7B Encoder*, and *Lightning 4-Steps LoRA*.
4. **One-Click Auto-Installer**: If anything is missing, hit the install button. The background installer clones repositories, installs pip dependencies, and downloads model weights directly into their appropriate directories (`diffusion_models`, `text_encoders`, `vae`, `loras`) with real-time percentage progress and live logs.

---

## 📦 Quick Installation Guide

Setting up WOX Cinema Studio takes less than two minutes:

### Step 1: Unzip the Package
Extract the archive file `ComfyUI-WOX-Cinema-Studio.zip`.

### Step 2: Move to `custom_nodes`
Place the extracted `ComfyUI-WOX-Cinema-Studio` folder inside your ComfyUI `custom_nodes` directory:
```bash
ComfyUI/custom_nodes/ComfyUI-WOX-Cinema-Studio/
```

### Step 3: Launch ComfyUI & Search the Node
1. Launch (or restart) ComfyUI.
2. Double-click on an empty canvas spot (or press `Spacebar` / right-click -> *Add Node*).
3. Search for:
   ```text
   WOX CINEMA STUDIO
   ```
4. Place the node: **🎬 WOX CINEMA STUDIO (Z-Image Turbo & Minimax H3)**.
5. Click the **Gear icon (⚙️)** to run the auto-installer for any required models or libraries.

![AI Prompt and Generate Buttons](documents/Screenshot_20260918_201212.png)

---

## 🔌 Node Inputs, Parameters & Outputs

### Main Inputs & Widgets
- **`prompt`**: Multiline text prompt describing the scene.
- **`mode`**: Choose between `Video (Minimax H3)`, `Image (Z-Image Turbo)`, and `Image (Krea 2)`.
- **`film_setup`**: Cinematographic stock & genre (*General, 35mm, IMAX, Noir, Horror, Action, etc.*).
- **`camera`**: Camera motion path (*Auto, Static, Pan, Tilt, Zoom, Drone, 360 Orbit, Handheld*).
- **`color_palette`**: Color grade preset (*Teal & Orange, Cyberpunk, Noir, Sunset, etc.*).
- **`lighting`**: Lighting scheme (*Softbox, Golden Hour, Rim Light, Volumetric Fog, etc.*).
- **`aspect_ratio`**: Aspect ratio selection (`16:9`, `9:16`, `1:1`, `21:9`, `4:3`).
- **`resolution`**: Output rendering resolution (`1080p`, `720p`, `480p`, `4k`).
- **`duration`**: Video clip length in seconds (`5s` or `10s`).
- **`steps`**: Sampling steps count (`20` to `60` steps, default 20).
- **`audio`**: Ambient and background audio generation (`On` / `Off`).
- **`variations`**: Batch generation count (`1`, `2`, `4`).
- **`reference_image` (optional)**: Input image connection from canvas for Image-to-Video or reference guidance.

### Outputs
- **`IMAGE`**: Outputs the rendered primary frame or still image (compatible with *Preview Image* or *Save Image*).
- **`VIDEO_FILENAMES`**: Path to the generated MP4 clip or exported montage video (compatible with *VHS Video Combine* or ComfyUI video players).
- **`PROMPT_OUT`**: Full compiled cinematographic prompt for downstream text-based nodes.

---

## 🏆 Cinematic Visual Results

By pairing widescreen aspect ratios with Kodak film emulations and local FP8/INT8 neural rendering, WOX Cinema Studio produces studio-grade results entirely on local hardware.

![WOX Cinematic Frame Example](documents/Screenshot_20260906_124808.png)

---

*Designed for filmmakers, directors, concept artists, and AI creators seeking uncompromising cinematic control inside ComfyUI, 100% locally on 16GB VRAM.*

---

## 🔄 Changelog & Recent Updates

### 🆕 Version 1.2.0 (October 2026)

- **🎬 Cinematic Template Library & Guided Workflows**: New dedicated **Template** button in the main top bar for instant access to pre-configured directorial workflows:
  - **3D Blockout to Cinematic (`VIDEO REFERENCE as BLOCK OUT`)**: Steer Minimax H3 video generations using camera motion, framing, pacing, and staging from an untextured 3D blockout video, turning basic geometric shapes into fully realized scenes guided by reference images. Features dedicated slots for Video Blockout, Style Reference, Primary Character/Subject, and dynamic slots for unlimited Extra References.
  - **In/Out Keyframes + Style (`First/Last Frame Continuity`)**: Precisely control temporal transitions by locking starting and ending keyframes while enforcing visual style fidelity.
  - **Multi-Character Ensemble (`Protagonist vs Antagonist`)**: Effortlessly stage multi-character scenes with clear visual identities, wardrobe, and facial fidelity for hero, villain, and background extras.
- **✨ Intelligent AI Visual Analysis & Reference Directives (`describe_reference`)**:
  - Integrated tonal and chromatic computer vision analysis (PIL): computes real-time brightness, saturation, contrast, and color temperature.
  - Automatic subject extraction (from embedded ComfyUI PNG workflow metadata or filename heuristics) paired with tailored film directives for each cinematic role (*Style Reference*, *Protagonist*, *Antagonist*, *Civilians*, *Main Subject*, *Environment / Set*, *Hero Prop*, *Action / Pose*).
  - Optional local LLM polishing via **Ollama** (`/api/generate`) to transform visual traits into concise, high-impact English prompt directives.
- **💾 Save Prompt & Reference Bundles to Media Gallery (`Save Prompt`)**:
  - New dedicated button in the generation toolbar to save complete prompts, camera/lighting/film presets, thumbnails, and all linked reference media with one click.
  - Automatically indexed under a new **Prompts** category in the Media Gallery for rapid scene recall and reusable setups.
- **⚡ Interactive Sampling Steps Control (20-60 Steps Chip)**:
  - Added a dedicated sampling steps widget and interactive chip (`20` - `60 steps`, default 20) with live synchronization to canvas KSampler / ModelSampling nodes.
- **🎥 Resilient Multi-Tier Video Thumbnail Engine (PyAV + FFmpeg + Canvas Fallback)**:
  - Automatic FFmpeg binary discovery via `imageio_ffmpeg`, system PATH, and common Linux/Windows/Mac executable locations.
  - Three-tier thumbnail extraction: native PyAV decoding (no external binary required) -> FFmpeg subprocess -> procedural graphical placeholder, guaranteeing zero 404 broken image cards in the gallery and timeline.
- **🏷️ Collision-Free Automatic Reference Tagging**:
  - Smart anti-collision mechanism when uploading references: automatically increments duplicate tag names (`@tag_1`, `@tag_2`) ensuring every reference remains strictly unique.

### 🆕 Version 1.1.0 (September 2026)

- **📸 Export Current Frame (Capture Frame)**: Added a dedicated button in the Media Gallery video preview player to capture and export the current video frame as a high-quality `.jpg` (93%). The frame is automatically saved into `input/woxcinema/`, indexed under *Generations* with a `@frame_...` tag, and made immediately accessible as a visual reference in the prompt and gallery.
- **⚡ Timeline Montage Export Fix & Normalization**: Completely resolved the source file lookup bug during FFmpeg export (*"No valid source file found on disk"*). File path resolution now seamlessly handles normalized relative paths, subfolder structures, and preview endpoints.
- **💾 Automatic Browser Download on Export**: Once video montage concatenation completes, in addition to writing the MP4 master into `output/video`, the browser automatically triggers a file download so you can save it anywhere on your machine.
- **🏷️ Cursor-Aware `@` Reference Tag Insertion**: Clicking the `@` tag chip or choosing a reference card from the Media Gallery modal now inserts the tag precisely at the current text cursor position inside the prompt textarea, instead of always appending at the end.
- **🧹 Gallery Visibility Refresh (Tombstone Fix)**: Fixed local cache tombstone logic (`localStorage`) ensuring newly generated videos and images always show up immediately in the Media Gallery without being masked by stale deletion records.
