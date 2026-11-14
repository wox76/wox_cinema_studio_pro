import os
import sys
import json
import time
import shutil
import tempfile
import subprocess
import numpy as np
import torch
from PIL import Image
import comfy.model_management as mm
import comfy.utils


class WOXTrellis3DNode:
    """
    WOX Cinema Studio [PRO] - TRELLIS.2 / Pixal3D Image-to-3D Generator (16GB VRAM Optimized).
    Generates a full PBR textured .glb 3D mesh ready for ActionForge rigging + 360° turntable frames.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Reference image of the character or object to convert into 3D."}),
                "resolution": (
                    [
                        "1536 (Ultra High-Res)",
                        "1024 (16GB VRAM Recommended)",
                        "512 (Fast Preview)",
                    ],
                    {"default": "1536 (Ultra High-Res)"},
                ),
                "poly_preset": (
                    [
                        "Face & Detail Sculpt (1M faces)",
                        "Cinema Sculpt (800k faces)",
                        "Ultra High-Poly (500k faces)",
                        "Balanced HD (250k faces)",
                        "Rig-Ready / ActionForge (100k faces)",
                    ],
                    {"default": "Face & Detail Sculpt (1M faces)"},
                ),
                "texture_size": (
                    [
                        "4096 (4K Ultra PBR)",
                        "2048 (2K Fast & Rig-Ready)",
                    ],
                    {"default": "4096 (4K Ultra PBR)"},
                ),
                "steps": (
                    "INT",
                    {"default": 20, "min": 8, "max": 36, "step": 1},
                ),
                "guidance_strength": (
                    "FLOAT",
                    {"default": 7.5, "min": 1.0, "max": 15.0, "step": 0.5},
                ),
                "camera_fov": (
                    "FLOAT",
                    {
                        "default": -1.0,
                        "min": -1.0,
                        "max": 1.8,
                        "step": 0.05,
                        "tooltip": "-1.0 uses automatic MoGe-2 camera FOV estimation.",
                    },
                ),
                "turntable_frames": (
                    "INT",
                    {"default": 36, "min": 12, "max": 72, "step": 6},
                ),
                "low_vram": (
                    "BOOLEAN",
                    {"default": True, "tooltip": "Sequential stage offloading so TRELLIS.2 fits comfortably in 16GB VRAM."},
                ),
                "seed": (
                    "INT",
                    {"default": 42, "min": 0, "max": 0xFFFFFFFFFFFFFFFF},
                ),
            },
            "optional": {
                "tex_guidance_strength": (
                    "FLOAT",
                    {"default": 2.5, "min": 1.0, "max": 8.0, "step": 0.5, "tooltip": "Texture CFG strength (>1.0 sharpens eyes, lips and facial skin micro-detail)."},
                ),
                "surface_mode": (
                    [
                        "Native Sharp (Massimo Dettaglio Volto)",
                        "Watertight Remesh (Stampa 3D)",
                    ],
                    {"default": "Native Sharp (Massimo Dettaglio Volto)"},
                ),
                "max_tokens": (
                    [
                        "65536 (1536 Reale · Consigliato Volti)",
                        "81920 (Massimo Dettaglio · 16GB Tight)",
                        "49152 (Standard · Risparmio VRAM)",
                    ],
                    {"default": "65536 (1536 Reale · Consigliato Volti)"},
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("turntable_images", "preview_image", "glb_path")
    FUNCTION = "generate_3d"
    CATEGORY = "WOX Cinema Studio/3D"

    def generate_3d(
        self,
        image,
        resolution="1536 (Ultra High-Res)",
        poly_preset="Face & Detail Sculpt (1M faces)",
        texture_size="4096 (4K Ultra PBR)",
        steps=20,
        guidance_strength=7.5,
        camera_fov=-1.0,
        turntable_frames=36,
        low_vram=True,
        seed=42,
        tex_guidance_strength=2.5,
        surface_mode="Native Sharp (Massimo Dettaglio Volto)",
        max_tokens="65536 (1536 Reale · Consigliato Volti)",
    ):
        # 1. Unload any active ComfyUI models so all 16GB VRAM is free for TRELLIS.2
        print("\n[WOX TRELLIS 3D] Unloading ComfyUI models from VRAM before launching TRELLIS.2 (16GB VRAM Mode)...")
        mm.unload_all_models()
        mm.soft_empty_cache()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        res_code = "1536"
        if str(resolution).startswith("1024"):
            res_code = "1024"
        elif str(resolution).startswith("512"):
            res_code = "512"

        decimation_target = 1000000
        if "500k" in str(poly_preset):
            decimation_target = 500000
        elif "800k" in str(poly_preset):
            decimation_target = 800000
        elif "250k" in str(poly_preset):
            decimation_target = 250000
        elif "100k" in str(poly_preset):
            decimation_target = 100000

        token_limit = 65536
        if "81920" in str(max_tokens):
            token_limit = 81920
        elif "49152" in str(max_tokens):
            token_limit = 49152

        use_remesh = "Remesh" in str(surface_mode)
        tex_size = 4096 if "4096" in str(texture_size) else 2048
        safe_seed = int(seed) % 2147483647

        # Output directory for 3D GLB files in Wox Cinema Studio Pro
        out_3d_dir = "/home/wox76/opt/freefield/out/3d"
        os.makedirs(out_3d_dir, exist_ok=True)
        ts = int(time.time())
        glb_filename = f"trellis_{ts}_{safe_seed}.glb"
        output_glb_path = os.path.join(out_3d_dir, glb_filename)
        latest_glb_path = os.path.join(out_3d_dir, "latest.glb")

        worker_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trellis_worker.py")
        pixi_python = "/home/wox76/Documents/pixar3d/.pixi/envs/default/bin/python"
        if not os.path.exists(pixi_python):
            raise RuntimeError(f"TRELLIS.2 Pixi environment not found at {pixi_python}")

        with tempfile.TemporaryDirectory(prefix="wox_trellis3d_") as tmp_dir:
            input_img_path = os.path.join(tmp_dir, "input.png")
            frames_dir = os.path.join(tmp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            # Save first image from ComfyUI tensor batch [B, H, W, C]
            img_np = (image[0].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            Image.fromarray(img_np).save(input_img_path)

            cmd = [
                pixi_python,
                worker_script,
                "--image",
                input_img_path,
                "--output_glb",
                output_glb_path,
                "--output_frames_dir",
                frames_dir,
                "--seed",
                str(safe_seed),
                "--resolution",
                res_code,
                "--steps",
                str(int(steps)),
                "--guidance_strength",
                str(float(guidance_strength)),
                "--tex_guidance_strength",
                str(float(tex_guidance_strength)),
                "--shape_guidance_min",
                "0.4",
                "--decimation_target",
                str(int(decimation_target)),
                "--texture_size",
                str(int(tex_size)),
                "--max_num_tokens",
                str(int(token_limit)),
                "--uv_refine_iters",
                "4",
                "--fov",
                str(float(camera_fov)),
                "--num_frames",
                str(int(turntable_frames)),
                "--render_res",
                "768",
            ]
            if use_remesh:
                cmd.append("--remesh")
            if low_vram:
                cmd.append("--low_vram")

            pbar = comfy.utils.ProgressBar(6)
            pbar.update_absolute(1, 6)

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            stage = 1
            for line in proc.stdout:
                sys.stdout.write(line)
                sys.stdout.flush()
                if "Sampling sparse structure" in line:
                    stage = max(stage, 2)
                    pbar.update_absolute(stage, 6)
                elif "Sampling shape SLat" in line:
                    stage = max(stage, 3)
                    pbar.update_absolute(stage, 6)
                elif "Sampling tex SLat" in line:
                    stage = max(stage, 4)
                    pbar.update_absolute(stage, 6)
                elif "Rendering 360" in line or "Extracting textured PBR GLB" in line:
                    stage = max(stage, 5)
                    pbar.update_absolute(stage, 6)

            ret = proc.wait()
            if ret != 0:
                raise RuntimeError(f"TRELLIS.2 3D worker exited with code {ret}")

            pbar.update_absolute(6, 6)

            if not os.path.exists(output_glb_path):
                raise RuntimeError(f"TRELLIS.2 did not produce expected GLB file at {output_glb_path}")

            shutil.copy2(output_glb_path, latest_glb_path)
            meta_path = os.path.join(out_3d_dir, "latest.json")
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "glb": output_glb_path,
                        "filename": glb_filename,
                        "timestamp": ts,
                        "seed": safe_seed,
                        "resolution": res_code,
                        "decimation_target": decimation_target,
                        "texture_size": tex_size,
                    },
                    f,
                    indent=2,
                )

            frame_files = sorted(
                [
                    os.path.join(frames_dir, fn)
                    for fn in os.listdir(frames_dir)
                    if fn.endswith(".png")
                ]
            )
            tensors = []
            for fp in frame_files:
                pil_img = Image.open(fp).convert("RGB")
                arr = np.asarray(pil_img, dtype=np.float32) / 255.0
                tensors.append(torch.from_numpy(arr))

            if not tensors:
                tensors = [image[0].detach().cpu()]

            turntable_batch = torch.stack(tensors, dim=0)
            preview_single = turntable_batch[0:1]

        return (turntable_batch, preview_single, output_glb_path)
