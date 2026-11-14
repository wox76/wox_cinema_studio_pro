#!/usr/bin/env python3
"""
TRELLIS.2 / Pixal3D 16GB VRAM Studio Worker for Wox Cinema Studio [PRO].
Executed inside `/home/wox76/Documents/pixar3d/.pixi/envs/default/bin/python`.
Generates a high-quality PBR 3D asset (.glb) + 360° turntable frames from an input image.
"""
import argparse
import gc
import math
import os
import sys
import time

os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ.setdefault("ATTN_BACKEND", "sdpa")

def _resolve_pixar3d_root() -> str:
    candidates = [
        os.environ.get("PIXAR3D_ROOT", ""),
        os.path.join(os.path.expanduser("~"), "Documents", "pixar3d"),
        os.path.join(os.path.expanduser("~"), "pixar3d"),
        "/home/wox76/Documents/pixar3d",
    ]
    for c in candidates:
        if c and os.path.isdir(c):
            return c
    return candidates[1]


PIXAR3D_ROOT = _resolve_pixar3d_root()
os.environ["FLEX_GEMM_AUTOTUNE_CACHE_PATH"] = os.path.join(PIXAR3D_ROOT, "autotune_cache.json")
os.environ["FLEX_GEMM_AUTOTUNER_VERBOSE"] = "1"

if os.path.isdir(PIXAR3D_ROOT) and PIXAR3D_ROOT not in sys.path:
    sys.path.insert(0, PIXAR3D_ROOT)

import cv2
import numpy as np
import torch
from PIL import Image
import o_voxel
from pixal3d.pipelines import Pixal3DImageTo3DPipeline
from pixal3d.renderers import EnvMap
from pixal3d.utils import render_utils

MOGE_MODEL_NAME = "Ruicheng/moge-2-vitl"
IMAGE_COND_CONFIGS = {
    "ss": {
        "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
        "image_size": 512,
        "grid_resolution": 16,
    },
    "shape_512": {
        "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
        "image_size": 512,
        "grid_resolution": 32,
        "use_naf_upsample": True,
        "naf_target_size": 512,
    },
    "shape_1024": {
        "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
        "image_size": 1024,
        "grid_resolution": 64,
        "use_naf_upsample": True,
        "naf_target_size": 512,
    },
    "tex_1024": {
        "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
        "image_size": 1024,
        "grid_resolution": 64,
        "use_naf_upsample": True,
        "naf_target_size": 1024,
    },
}


def build_image_cond_model(config: dict):
    from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor
    model = DinoV3ProjFeatureExtractor(**config)
    model.eval()
    return model


def init_pipeline(model_path: str, device: str = "cuda", low_vram: bool = True):
    print(f"[TRELLIS-3D] Loading pipeline from {model_path}...", flush=True)
    pipeline = Pixal3DImageTo3DPipeline.from_pretrained(model_path)

    print("[TRELLIS-3D] Building DinoV3ProjFeatureExtractor conditioning models...", flush=True)
    pipeline.image_cond_model_ss = build_image_cond_model(IMAGE_COND_CONFIGS["ss"])
    pipeline.image_cond_model_shape_512 = build_image_cond_model(IMAGE_COND_CONFIGS["shape_512"])
    pipeline.image_cond_model_shape_1024 = build_image_cond_model(IMAGE_COND_CONFIGS["shape_1024"])
    pipeline.image_cond_model_tex_1024 = build_image_cond_model(IMAGE_COND_CONFIGS["tex_1024"])

    if low_vram:
        for attr in [
            "image_cond_model_ss",
            "image_cond_model_shape_512",
            "image_cond_model_shape_1024",
            "image_cond_model_tex_1024",
        ]:
            m = getattr(pipeline, attr, None)
            if m is not None and getattr(m, "use_naf_upsample", False):
                m._load_naf()
        pipeline._device = torch.device(device)
        pipeline.low_vram = True
        print("[TRELLIS-3D] 16GB Low-VRAM mode enabled (stage-by-stage GPU offload).", flush=True)
    else:
        pipeline.low_vram = False
        pipeline.cuda()
        pipeline.image_cond_model_ss.cuda()
        pipeline.image_cond_model_shape_512.cuda()
        pipeline.image_cond_model_shape_1024.cuda()
        pipeline.image_cond_model_tex_1024.cuda()
        for attr in [
            "image_cond_model_ss",
            "image_cond_model_shape_512",
            "image_cond_model_shape_1024",
            "image_cond_model_tex_1024",
        ]:
            m = getattr(pipeline, attr, None)
            if m is not None and getattr(m, "use_naf_upsample", False):
                m._load_naf()

    return pipeline


def compute_f_pixels(camera_angle_x: float, resolution: int) -> float:
    focal_length = 16.0 / torch.tan(torch.tensor(camera_angle_x / 2.0))
    f_pixels = focal_length * resolution / 32.0
    return float(f_pixels.item())


def distance_from_fov(camera_angle_x, grid_point, target_point, mesh_scale, image_resolution):
    rotation_matrix = torch.tensor([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
    gp = grid_point.to(torch.float32) @ rotation_matrix.T
    gp = gp / mesh_scale / 2
    xw, yw, _ = gp[0].item(), gp[1].item(), gp[2].item()
    xt, yt = float(target_point[0].item()), float(target_point[1].item())
    f_pixels = compute_f_pixels(camera_angle_x, image_resolution)
    x_ndc = xt - image_resolution / 2.0
    distance_x = f_pixels * xw / x_ndc - yw
    return {"distance_from_x": float(distance_x), "f_pixels": float(f_pixels)}


def estimate_camera_params(pil_image: Image.Image, manual_fov: float = -1.0, mesh_scale: float = 1.0, extend_pixel: int = 0, image_resolution: int = 512):
    if manual_fov > 0:
        camera_angle_x = float(manual_fov)
        grid_point = torch.tensor([-1.0, 0.0, 0.0])
        distance = distance_from_fov(
            camera_angle_x,
            grid_point,
            torch.tensor([0 - extend_pixel, image_resolution - 1 + extend_pixel]),
            mesh_scale,
            image_resolution,
        )["distance_from_x"]
        return {"camera_angle_x": camera_angle_x, "distance": distance, "mesh_scale": mesh_scale}

    print("[TRELLIS-3D] Estimating camera FOV with MoGe-2...", flush=True)
    from moge.model.v2 import MoGeModel
    moge_model = MoGeModel.from_pretrained(MOGE_MODEL_NAME).to("cuda").eval()
    rgb_img = pil_image.convert("RGB")
    width, _ = rgb_img.size
    image_np = np.array(rgb_img).astype(np.float32) / 255.0
    image_tensor = torch.from_numpy(image_np).permute(2, 0, 1).to("cuda")
    with torch.no_grad():
        output = moge_model.infer(image_tensor)
    intrinsics = output["intrinsics"].squeeze().cpu().numpy()
    fx_normalized = intrinsics[0, 0]
    fx = fx_normalized * width
    raw_angle_x = 2 * math.atan(width / (2 * fx))
    # Clamp extreme MoGe FOV outliers on tight portraits so facial proportions stay natural
    camera_angle_x = max(0.22, min(1.05, float(raw_angle_x)))

    moge_model.cpu()
    del moge_model
    torch.cuda.empty_cache()

    grid_point = torch.tensor([-1.0, 0.0, 0.0])
    distance = distance_from_fov(
        camera_angle_x,
        grid_point,
        torch.tensor([0 - extend_pixel, image_resolution - 1 + extend_pixel]),
        mesh_scale,
        image_resolution,
    )["distance_from_x"]
    print(f"[TRELLIS-3D] Camera angle_x={camera_angle_x:.4f} rad (raw={raw_angle_x:.4f}), distance={distance:.4f}", flush=True)
    return {"camera_angle_x": camera_angle_x, "distance": distance, "mesh_scale": mesh_scale}


def make_studio_envmap(height: int = 256, width: int = 512, device: str = "cuda") -> EnvMap:
    """
    Load the studio HDRI from pixar3d/assets/hdri/studio.exr if available,
    falling back to a procedural 3-point Cinema Studio HDR environment map on GPU.
    """
    studio_exr = os.path.join(PIXAR3D_ROOT, "assets", "hdri", "studio.exr")
    if os.path.exists(studio_exr):
        try:
            hdri = cv2.imread(studio_exr, cv2.IMREAD_UNCHANGED)
            if hdri is not None:
                hdri = cv2.cvtColor(hdri, cv2.COLOR_BGR2RGB)
                return EnvMap(torch.tensor(hdri, dtype=torch.float32, device=device))
        except Exception:
            pass

    v = torch.linspace(0.0, 1.0, height, device=device, dtype=torch.float32).unsqueeze(1).expand(height, width)
    u = torch.linspace(0.0, 1.0, width, device=device, dtype=torch.float32).unsqueeze(0).expand(height, width)
    theta = v * np.pi
    phi = (u - 0.5) * 2.0 * np.pi
    dx = torch.sin(theta) * torch.cos(phi)
    dy = torch.cos(theta)
    dz = torch.sin(theta) * torch.sin(phi)

    sky = torch.tensor([0.75, 0.80, 0.90], device=device).view(1, 1, 3)
    ground = torch.tensor([0.22, 0.20, 0.18], device=device).view(1, 1, 3)
    t_up = torch.clamp(dy * 0.5 + 0.5, 0.0, 1.0).unsqueeze(-1)
    hdr = ground * (1.0 - t_up) + sky * t_up

    def add_softbox(dir_vec, color, intensity, sharpness):
        d = torch.tensor(dir_vec, device=device, dtype=torch.float32)
        d = d / torch.norm(d)
        dot = torch.clamp(dx * d[0] + dy * d[1] + dz * d[2], 0.0, 1.0)
        lobe = (dot ** sharpness).unsqueeze(-1) * intensity
        c = torch.tensor(color, device=device, dtype=torch.float32).view(1, 1, 3)
        return lobe * c

    hdr = hdr + add_softbox([0.6, 0.65, 0.45], [1.0, 0.96, 0.90], 4.8, 14.0)
    hdr = hdr + add_softbox([0.5, 0.25, -0.8], [0.82, 0.90, 1.0], 2.2, 8.0)
    hdr = hdr + add_softbox([-0.75, 0.55, -0.35], [0.95, 0.97, 1.0], 3.8, 18.0)
    hdr = hdr + add_softbox([0.0, 1.0, 0.0], [1.0, 1.0, 1.0], 1.8, 6.0)
    return EnvMap(hdr.contiguous())


def render_turntable_frames(
    mesh,
    camera_params: dict,
    output_dir: str,
    num_frames: int = 36,
    resolution: int = 768,
    bg_color=(0.07, 0.07, 0.09),
):
    os.makedirs(output_dir, exist_ok=True)
    frames = None

    try:
        envmap = make_studio_envmap(device="cuda")
        rendered = render_utils.render_proj_aligned_video(
            mesh,
            camera_angle_x=camera_params["camera_angle_x"],
            distance=camera_params["distance"],
            mesh_scale=camera_params.get("mesh_scale", 1.0),
            num_frames=num_frames,
            resolution=resolution,
            bg_color=bg_color,
            envmap=envmap,
            verbose=True,
        )
        frames = rendered.get("shaded", None)
        if frames is None:
            frames = rendered.get("normal", None)
    except Exception as e:
        print(f"[TRELLIS-3D] PBR turntable render fallback to normal render: {e}", flush=True)
        try:
            rendered = render_utils.render_video(
                mesh,
                num_frames=num_frames,
                resolution=resolution,
                bg_color=bg_color,
                r=2.1,
                fov=40,
                pitch=15,
                verbose=True,
            )
            frames = rendered.get("normal", None)
        except Exception as e2:
            print(f"[TRELLIS-3D] Normal render also failed: {e2}", flush=True)
            frames = None

    saved_paths = []
    if frames:
        for idx, frame in enumerate(frames):
            out_path = os.path.join(output_dir, f"frame_{idx:04d}.png")
            Image.fromarray(frame).save(out_path)
            saved_paths.append(out_path)
    return saved_paths


def main():
    parser = argparse.ArgumentParser(description="Wox Cinema Studio TRELLIS.2 3D Worker")
    parser.add_argument("--image", type=str, required=True, help="Path to input image")
    parser.add_argument("--output_glb", type=str, required=True, help="Path to output .glb file")
    parser.add_argument("--output_frames_dir", type=str, required=True, help="Directory for turntable PNG frames")
    parser.add_argument("--weights_dir", type=str, default="/home/wox76/Documents/pixar3d/model_weights")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resolution", type=str, default="1536", choices=["512", "1024", "1536"])
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--guidance_strength", type=float, default=7.5)
    parser.add_argument("--tex_guidance_strength", type=float, default=2.5)
    parser.add_argument("--shape_guidance_min", type=float, default=0.4)
    parser.add_argument("--decimation_target", type=int, default=1000000)
    parser.add_argument("--texture_size", type=int, default=4096)
    parser.add_argument("--max_num_tokens", type=int, default=65536)
    parser.add_argument("--remesh", action="store_true", default=False, help="Enable Dual Contouring remesh (blurs sharp facial details unless needed for 3D printing)")
    parser.add_argument("--uv_refine_iters", type=int, default=4)
    parser.add_argument("--fov", type=float, default=-1.0, help="Camera FOV in radians (-1 for MoGe-2 auto)")
    parser.add_argument("--num_frames", type=int, default=36)
    parser.add_argument("--render_res", type=int, default=768)
    parser.add_argument("--low_vram", action="store_true", default=True)
    args = parser.parse_args()

    t0 = time.time()
    print(
        f"[TRELLIS-3D] Starting 3D generation (res={args.resolution}, steps={args.steps}, cfg={args.guidance_strength}, "
        f"tex_cfg={args.tex_guidance_strength}, max_tokens={args.max_num_tokens}, faces={args.decimation_target}, "
        f"tex={args.texture_size}, remesh={args.remesh}, low_vram={args.low_vram})",
        flush=True,
    )

    pipeline = init_pipeline(args.weights_dir, low_vram=args.low_vram)

    raw_image = Image.open(args.image)
    image_preprocessed = pipeline.preprocess_image(raw_image)

    camera_params = estimate_camera_params(image_preprocessed, manual_fov=args.fov)

    ss_params = {
        "steps": args.steps,
        "guidance_strength": args.guidance_strength,
        "guidance_rescale": 0.7,
        "guidance_interval": [0.5, 1.0],
        "rescale_t": 5.0,
    }
    shape_params = {
        "steps": args.steps,
        "guidance_strength": args.guidance_strength,
        "guidance_rescale": 0.55,
        "guidance_interval": [max(0.1, min(0.9, float(args.shape_guidance_min))), 1.0],
        "rescale_t": 3.0,
    }
    tex_params = {
        "steps": args.steps,
        "guidance_strength": args.tex_guidance_strength,
        "guidance_rescale": 0.5 if args.tex_guidance_strength > 1.0 else 0.0,
        "guidance_interval": [0.4, 0.95],
        "rescale_t": 3.0,
    }

    pipeline_type = "1536_cascade" if args.resolution == "1536" else "1024_cascade"

    def run_with_tokens(tok_limit: int):
        return pipeline.run(
            image_preprocessed,
            camera_params=camera_params,
            seed=args.seed,
            sparse_structure_sampler_params=ss_params,
            shape_slat_sampler_params=shape_params,
            tex_slat_sampler_params=tex_params,
            preprocess_image=False,
            return_latent=True,
            pipeline_type=pipeline_type,
            max_num_tokens=tok_limit,
        )

    try:
        mesh_list, (_, _, res) = run_with_tokens(args.max_num_tokens)
    except torch.OutOfMemoryError:
        if args.max_num_tokens <= 49152:
            raise
        print(f"[TRELLIS-3D] CUDA OOM at max_num_tokens={args.max_num_tokens}; retrying safely with 49152...", flush=True)
        gc.collect()
        torch.cuda.empty_cache()
        mesh_list, (_, _, res) = run_with_tokens(49152)

    print(f"[TRELLIS-3D] Cascade decoded at voxel grid res={res}", flush=True)
    mesh = mesh_list[0]
    pbr_attr_layout = pipeline.pbr_attr_layout

    # Cap face density before turntable rendering and UV extraction
    mesh.simplify(16777216)

    print("[TRELLIS-3D] Rendering 360° Studio PBR turntable frames...", flush=True)
    frame_paths = render_turntable_frames(
        mesh,
        camera_params=camera_params,
        output_dir=args.output_frames_dir,
        num_frames=args.num_frames,
        resolution=args.render_res,
    )

    # Free diffusion pipeline models from RAM & VRAM before UV unwrapping / baking
    del pipeline
    gc.collect()
    torch.cuda.empty_cache()

    print(
        f"[TRELLIS-3D] Extracting textured PBR GLB (decimation_target={args.decimation_target}, "
        f"texture_size={args.texture_size})...",
        flush=True,
    )
    glb = o_voxel.postprocess.to_glb(
        vertices=mesh.vertices,
        faces=mesh.faces,
        attr_volume=mesh.attrs,
        coords=mesh.coords,
        attr_layout=pbr_attr_layout,
        grid_size=res,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=args.decimation_target,
        texture_size=args.texture_size,
        remesh=bool(args.remesh),
        remesh_band=1,
        remesh_project=0.95,
        mesh_cluster_threshold_cone_half_angle_rad=np.radians(85.0),
        mesh_cluster_refine_iterations=int(args.uv_refine_iters),
        use_tqdm=True,
    )

    rot = np.array(
        [
            [-1, 0, 0, 0],
            [0, 0, -1, 0],
            [0, -1, 0, 0],
            [0, 0, 0, 1],
        ],
        dtype=np.float64,
    )
    glb.apply_transform(rot)

    os.makedirs(os.path.dirname(os.path.abspath(args.output_glb)), exist_ok=True)
    glb.export(args.output_glb)

    if not frame_paths:
        os.makedirs(args.output_frames_dir, exist_ok=True)
        fallback_img = image_preprocessed.convert("RGB").resize((args.render_res, args.render_res))
        for idx in range(max(12, args.num_frames)):
            p = os.path.join(args.output_frames_dir, f"frame_{idx:04d}.png")
            fallback_img.save(p)

    elapsed = time.time() - t0
    peak_gb = torch.cuda.max_memory_allocated() / (1024 ** 3) if torch.cuda.is_available() else 0.0
    print(
        f"[TRELLIS-3D] Done in {elapsed:.1f}s! Peak VRAM: {peak_gb:.2f} GB. Saved GLB to {args.output_glb}",
        flush=True,
    )


if __name__ == "__main__":
    main()
