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
# Cap OpenMP / BLAS threads so xatlas UV unwrapping does not lock all 32 CPU cores
os.environ.setdefault("OMP_NUM_THREADS", "8")
os.environ.setdefault("MKL_NUM_THREADS", "8")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "8")

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


def _free_ram_and_vram():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def _patch_naf_cross_attention(naf_model):
    """Patch NAF CrossAttention to use 256-row spatial tiling and per-head bfloat16 interpolation."""
    if naf_model is None or not hasattr(naf_model, "upsampler"):
        return
    import types
    import torch.nn.functional as F

    def _tiled_forward(self, q, k, v, image=None, return_weights=False, **kwargs):
        B, Cq, hq, wq = q.shape
        _, Cv, hk, wk = v.shape
        dilation = (hq // hk, wq // wk)
        self.dilation = dilation

        N = self.num_heads
        Dq = Cq // N
        Dv = Cv // N
        kh, kw = self.kernel_size if isinstance(self.kernel_size, tuple) else (self.kernel_size, self.kernel_size)
        dh, dw = dilation
        pad_h = (kh // 2) * dh
        pad_w = (kw // 2) * dw
        tile_h = 256

        out = torch.empty((B, Cv, hq, wq), device=q.device, dtype=q.dtype)
        for n in range(N):
            kn = F.interpolate(
                k[:, n * Dq : (n + 1) * Dq].to(torch.bfloat16),
                size=(hq, wq),
                mode="nearest-exact",
            )
            kn = F.pad(kn, (pad_w, pad_w, pad_h, pad_h), mode="replicate")
            vn = F.interpolate(
                v[:, n * Dv : (n + 1) * Dv].to(torch.bfloat16),
                size=(hq, wq),
                mode="nearest-exact",
            )
            vn = F.pad(vn, (pad_w, pad_w, pad_h, pad_h), mode="replicate")

            for y_start in range(0, hq, tile_h):
                y_end = min(hq, y_start + tile_h)
                th = y_end - y_start
                qn = (
                    q[:, n * Dq : (n + 1) * Dq, y_start:y_end, :]
                    .to(torch.bfloat16)
                    .contiguous()
                    * self.scale
                )
                m = torch.full((B, 1, th, wq), -float("inf"), device=q.device, dtype=torch.float32)
                l = torch.zeros((B, 1, th, wq), device=q.device, dtype=torch.float32)
                acc = torch.zeros((B, Dv, th, wq), device=q.device, dtype=torch.float32)

                for dy in range(kh):
                    y0 = y_start + dy * dh
                    y1 = y0 + th
                    for dx in range(kw):
                        x0 = dx * dw
                        x1 = x0 + wq
                        ky = kn[:, :, y0:y1, x0:x1]
                        vy = vn[:, :, y0:y1, x0:x1]
                        score = (qn * ky).sum(dim=1, keepdim=True).float()
                        m_new = torch.maximum(m, score)
                        alpha = torch.exp(m - m_new)
                        beta = torch.exp(score - m_new)
                        l.mul_(alpha).add_(beta)
                        acc.mul_(alpha).addcmul_(beta, vy.float())
                        m = m_new

                acc.div_(l)
                out[:, n * Dv : (n + 1) * Dv, y_start:y_end, :] = acc.to(q.dtype)
                del qn, m, l, acc
            del kn, vn
        return out

    naf_model.upsampler.forward = types.MethodType(_tiled_forward, naf_model.upsampler)


def build_image_cond_model(config: dict, shared_dino=None, shared_naf=None):
    from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor
    import inspect
    sig = inspect.signature(DinoV3ProjFeatureExtractor.__init__)
    if "shared_model" in sig.parameters:
        model = DinoV3ProjFeatureExtractor(
            **config,
            shared_model=shared_dino,
            shared_naf_model=shared_naf if config.get("use_naf_upsample") else None,
        )
    else:
        model = DinoV3ProjFeatureExtractor(**config)
        if shared_dino is not None:
            model.model = shared_dino
        if shared_naf is not None and config.get("use_naf_upsample"):
            model.naf_model = shared_naf
    model.eval()
    return model


def _fast_load_stage_model(ckpt_path: str):
    """
    Load a single Pixal3D/TRELLIS.2 checkpoint on-demand without redundant CPU weight
    initialization or float32->bfloat16 CPU copies.
    Flow models use zero-copy safetensors mmap assignment (`assign=True`) and convert
    their transformer blocks to bfloat16 directly on GPU when `.to('cuda')` is called.
    """
    import json
    import types
    import torch.nn as nn
    from safetensors.torch import load_file
    from pixal3d import models

    if os.path.exists(f"{ckpt_path}.json") and os.path.exists(f"{ckpt_path}.safetensors"):
        config_file = f"{ckpt_path}.json"
        model_file = f"{ckpt_path}.safetensors"
    else:
        from huggingface_hub import hf_hub_download
        path_parts = ckpt_path.split("/")
        repo_id = f"{path_parts[0]}/{path_parts[1]}"
        model_name = "/".join(path_parts[2:])
        config_file = hf_hub_download(repo_id, f"{model_name}.json")
        model_file = hf_hub_download(repo_id, f"{model_name}.safetensors")

    with open(config_file, "r") as f:
        cfg = json.load(f)

    cls_name = cfg["name"]
    cls = models.__getattr__(cls_name)
    is_flow = "FlowModel" in cls_name

    orig_init_w = getattr(cls, "initialize_weights", None)
    orig_conv = getattr(cls, "convert_to", None)
    orig_linear_reset = nn.Linear.reset_parameters
    if orig_init_w is not None:
        cls.initialize_weights = lambda self: None
    if is_flow and orig_conv is not None:
        cls.convert_to = lambda self, dtype: setattr(self, "dtype", dtype)
    nn.Linear.reset_parameters = lambda self: None
    try:
        model = cls(**cfg["args"])
    finally:
        nn.Linear.reset_parameters = orig_linear_reset
        if orig_init_w is not None:
            cls.initialize_weights = orig_init_w
        if is_flow and orig_conv is not None:
            cls.convert_to = orig_conv

    sd = load_file(model_file)
    model.load_state_dict(sd, strict=False, assign=is_flow)
    del sd
    model.eval()
    model.requires_grad_(False)
    model._converted_bf16 = False
    model._on_meta = False

    orig_to = model.to

    def _smart_to(self, *args, **kwargs):
        device = args[0] if args else kwargs.get("device", None)
        dev_str = str(device) if device is not None else ""
        if "cuda" in dev_str:
            res = orig_to(*args, **kwargs)
            if is_flow and orig_conv is not None and hasattr(self, "dtype") and not getattr(self, "_converted_bf16", False):
                orig_conv(self, self.dtype)
                self._converted_bf16 = True
                torch.cuda.empty_cache()
            return res
        return orig_to(*args, **kwargs)

    def _smart_cpu(self):
        # Free GPU VRAM immediately by moving tensors to 'meta' instead of allocating
        # 5.2 GB of dirty anonymous CPU RAM for a stage model that is already done.
        orig_to("meta")
        self._on_meta = True
        _free_ram_and_vram()
        return self

    model.to = types.MethodType(_smart_to, model)
    model.cpu = types.MethodType(_smart_cpu, model)
    return model


class LazyStageModelDict(dict):
    """
    On-demand stage model dictionary that keeps at most ONE checkpoint in memory at a time.
    Prevents loading all 22.5 GB of checkpoints into system RAM upfront.
    """

    def __init__(self, base_path: str, model_specs: dict):
        super().__init__()
        self._base_path = base_path
        self._specs = {
            k: v for k, v in model_specs.items() if k != "tex_slat_flow_model_512"
        }
        self._active_key = None
        self._active_model = None

    def evict_all(self):
        if self._active_model is not None:
            try:
                self._active_model.cpu()
            except Exception:
                pass
            self._active_model = None
            self._active_key = None
            _free_ram_and_vram()

    def __contains__(self, key):
        return key in self._specs

    def keys(self):
        return self._specs.keys()

    def __iter__(self):
        return iter(self._specs)

    def __len__(self):
        return len(self._specs)

    def values(self):
        if self._active_model is not None and not getattr(self._active_model, "_on_meta", False):
            return [self._active_model]
        return []

    def items(self):
        if self._active_model is not None and not getattr(self._active_model, "_on_meta", False):
            return [(self._active_key, self._active_model)]
        return []

    def __getitem__(self, key):
        if key not in self._specs:
            raise KeyError(key)
        if self._active_key == key and self._active_model is not None:
            return self._active_model
        self.evict_all()
        rel = self._specs[key]
        full_path = f"{self._base_path}/{rel}"
        t0 = time.time()
        print(f"[TRELLIS-3D] Loading stage model '{key}' on-demand...", flush=True)
        self._active_model = _fast_load_stage_model(full_path)
        self._active_key = key
        print(f"[TRELLIS-3D] Stage model '{key}' ready in {time.time() - t0:.2f}s", flush=True)
        return self._active_model


def init_pipeline(model_path: str, device: str = "cuda", low_vram: bool = True):
    import json
    from pixal3d.pipelines import samplers, rembg

    try:
        torch.set_num_threads(min(8, os.cpu_count() or 8))
    except Exception:
        pass

    print(f"[TRELLIS-3D] Initializing lazy on-demand pipeline from {model_path}...", flush=True)
    config_file = os.path.join(model_path, "pipeline.json")
    with open(config_file, "r") as f:
        args = json.load(f)["args"]

    pipeline = Pixal3DImageTo3DPipeline(models=None)
    pipeline.models = LazyStageModelDict(model_path, args["models"])
    pipeline._pretrained_args = args

    pipeline.sparse_structure_sampler = getattr(samplers, args["sparse_structure_sampler"]["name"])(
        **args["sparse_structure_sampler"]["args"]
    )
    pipeline.sparse_structure_sampler_params = args["sparse_structure_sampler"]["params"]

    pipeline.shape_slat_sampler = getattr(samplers, args["shape_slat_sampler"]["name"])(
        **args["shape_slat_sampler"]["args"]
    )
    pipeline.shape_slat_sampler_params = args["shape_slat_sampler"]["params"]

    pipeline.tex_slat_sampler = getattr(samplers, args["tex_slat_sampler"]["name"])(
        **args["tex_slat_sampler"]["args"]
    )
    pipeline.tex_slat_sampler_params = args["tex_slat_sampler"]["params"]

    pipeline.shape_slat_normalization = args["shape_slat_normalization"]
    pipeline.tex_slat_normalization = args["tex_slat_normalization"]

    pipeline.rembg_model = getattr(rembg, args["rembg_model"]["name"])(**args["rembg_model"]["args"])
    pipeline.low_vram = True
    pipeline.default_pipeline_type = args.get("default_pipeline_type", "1024_cascade")
    pipeline.pbr_attr_layout = {
        "base_color": slice(0, 3),
        "metallic": slice(3, 4),
        "roughness": slice(4, 5),
        "alpha": slice(5, 6),
    }
    pipeline._device = torch.device(device)

    print("[TRELLIS-3D] Building shared DINOv3 + NAF conditioning models (RAM-optimized)...", flush=True)
    from transformers import DINOv3ViTModel
    shared_dino = DINOv3ViTModel.from_pretrained(IMAGE_COND_CONFIGS["ss"]["model_name"])
    shared_dino.eval()
    shared_dino.requires_grad_(False)

    shared_naf = torch.hub.load("valeoai/NAF", "naf", pretrained=True, device="cpu", trust_repo=True)
    shared_naf.eval()
    shared_naf.requires_grad_(False)
    _patch_naf_cross_attention(shared_naf)

    pipeline.image_cond_model_ss = build_image_cond_model(IMAGE_COND_CONFIGS["ss"], shared_dino, shared_naf)
    pipeline.image_cond_model_shape_512 = build_image_cond_model(IMAGE_COND_CONFIGS["shape_512"], shared_dino, shared_naf)
    pipeline.image_cond_model_shape_1024 = build_image_cond_model(IMAGE_COND_CONFIGS["shape_1024"], shared_dino, shared_naf)
    pipeline.image_cond_model_tex_1024 = build_image_cond_model(IMAGE_COND_CONFIGS["tex_1024"], shared_dino, shared_naf)

    print("[TRELLIS-3D] 16GB Low-VRAM + Low-RAM mode enabled (zero-copy single-stage loading + tiled NAF).", flush=True)
    _patch_pipeline_sparse_proj(pipeline)
    _free_ram_and_vram()
    return pipeline


def _patch_pipeline_sparse_proj(pipeline):
    """Patch get_proj_cond_shape so it projects only sparse coordinates instead of a dense 96^3 / 64^3 cube."""
    import types
    from pixal3d.modules.sparse import SparseTensor

    @torch.no_grad()
    def _sparse_get_proj_cond_shape(
        self,
        image_cond_model,
        image: list,
        coords: torch.Tensor,
        camera_angle_x: float = 0.8575560450553894,
        distance: float = 2.0,
        mesh_scale: float = 1.0,
        grid_resolution_override: int = None,
    ) -> dict:
        device = self.device
        if self.low_vram:
            image_cond_model.to(device)

        orig_grid_res = image_cond_model.grid_resolution
        grid_res = grid_resolution_override if grid_resolution_override is not None else orig_grid_res

        cam_angle = torch.tensor([camera_angle_x], device=device)
        dist_tensor = torch.tensor([distance], device=device)
        scale_tensor = torch.tensor([mesh_scale], device=device)

        orig_gp = image_cond_model.proj_grid.grid_points
        pts = (coords[:, 1:4].to(device=device, dtype=torch.float32) / float(grid_res - 1)) * 2.0 - 1.0
        sparse_gp = torch.stack([pts[:, 0], -pts[:, 2], pts[:, 1]], dim=-1).contiguous()
        del pts
        image_cond_model.proj_grid.grid_points = sparse_gp
        try:
            z_global, z_proj = image_cond_model(
                image, camera_angle_x=cam_angle, distance=dist_tensor, mesh_scale=scale_tensor,
            )
        finally:
            image_cond_model.proj_grid.grid_points = orig_gp

        z_proj_sparse = z_proj[0].contiguous()
        del z_proj, sparse_gp
        z_proj_st = SparseTensor(feats=z_proj_sparse, coords=coords)

        if self.low_vram:
            image_cond_model.cpu()
            _free_ram_and_vram()
        return {
            "cond": {"global": z_global, "proj": z_proj_st},
            "neg_cond": {
                "global": torch.zeros_like(z_global),
                "proj": SparseTensor(feats=torch.zeros_like(z_proj_sparse), coords=coords),
            },
        }

    pipeline.get_proj_cond_shape = types.MethodType(_sparse_get_proj_cond_shape, pipeline)

    orig_decode_latent = pipeline.decode_latent

    @torch.no_grad()
    def _low_ram_decode_latent(self, shape_slat, tex_slat, resolution: int):
        # Free DINOv3 + NAF conditioning models and any active flow model before Stage 5 decoding
        self.image_cond_model_ss = None
        self.image_cond_model_shape_512 = None
        self.image_cond_model_shape_1024 = None
        self.image_cond_model_tex_1024 = None
        if hasattr(self.models, "evict_all"):
            self.models.evict_all()
        _free_ram_and_vram()
        out = orig_decode_latent(shape_slat, tex_slat, resolution)
        if hasattr(self.models, "evict_all"):
            self.models.evict_all()
        return out

    pipeline.decode_latent = types.MethodType(_low_ram_decode_latent, pipeline)


def extract_glb_4k_safe(
    vertices: torch.Tensor,
    faces: torch.Tensor,
    attr_volume: torch.Tensor,
    coords: torch.Tensor,
    attr_layout: dict,
    grid_size: int,
    aabb,
    decimation_target: int = 500000,
    texture_size: int = 4096,
    remesh: bool = False,
    remesh_band: float = 1.0,
    remesh_project: float = 0.95,
    mesh_cluster_threshold_cone_half_angle_rad: float = np.radians(85.0),
    mesh_cluster_refine_iterations: int = 4,
):
    """
    4K-safe GLB extractor with chunked BVH & 3D trilinear sampling and fast GPU UV seam dilation.
    Prevents GPU kernel hangs, VRAM spikes, and CPU RAM exhaustion at 4096x4096.
    """
    import trimesh
    import trimesh.visual
    from tqdm import tqdm
    from flex_gemm.ops.grid_sample import grid_sample_3d
    import nvdiffrast.torch as dr
    import cumesh

    aabb_t = torch.tensor(aabb, dtype=torch.float32, device=coords.device)
    grid_size_t = torch.tensor([grid_size, grid_size, grid_size], dtype=torch.int32, device=coords.device)
    voxel_size = (aabb_t[1] - aabb_t[0]) / grid_size_t

    pbar = tqdm(total=6, desc="Extracting GLB")
    vertices = vertices.cuda()
    faces = faces.cuda()

    mesh = cumesh.CuMesh()
    mesh.init(vertices, faces)
    mesh.fill_holes(max_hole_perimeter=3e-2)
    vertices, faces = mesh.read()
    pbar.update(1)

    pbar.set_description("Building BVH")
    bvh = cumesh.cuBVH(vertices, faces)
    pbar.update(1)

    pbar.set_description("Cleaning mesh")
    if not remesh:
        mesh.simplify(decimation_target * 3, verbose=False)
        mesh.remove_duplicate_faces()
        mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5)
        mesh.fill_holes(max_hole_perimeter=3e-2)
        mesh.simplify(decimation_target, verbose=False)
        mesh.remove_duplicate_faces()
        mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5)
        mesh.fill_holes(max_hole_perimeter=3e-2)
        mesh.unify_face_orientations()
    else:
        center = aabb_t.mean(dim=0)
        scale = (aabb_t[1] - aabb_t[0]).max().item()
        resolution = grid_size_t.max().item()
        mesh.init(
            *cumesh.remeshing.remesh_narrow_band_dc(
                vertices,
                faces,
                center=center,
                scale=(resolution + 3 * remesh_band) / resolution * scale,
                resolution=resolution,
                band=remesh_band,
                project_back=remesh_project,
                verbose=False,
                bvh=bvh,
            )
        )
        mesh.simplify(decimation_target, verbose=False)
    pbar.update(1)

    pbar.set_description("Parameterizing new mesh")
    out_vertices, out_faces, out_uvs, out_vmaps = mesh.uv_unwrap(
        compute_charts_kwargs={
            "threshold_cone_half_angle_rad": mesh_cluster_threshold_cone_half_angle_rad,
            "refine_iterations": mesh_cluster_refine_iterations,
            "global_iterations": 1,
            "smooth_strength": 1,
        },
        return_vmaps=True,
        verbose=False,
    )
    out_vertices = out_vertices.cuda()
    out_faces = out_faces.cuda()
    out_uvs = out_uvs.cuda()
    out_vmaps = out_vmaps.cuda()
    mesh.compute_vertex_normals()
    out_normals = mesh.read_vertex_normals()[out_vmaps]

    vertices_np = out_vertices.cpu().numpy()
    faces_np = out_faces.cpu().numpy()
    uvs_np = out_uvs.cpu().numpy()
    normals_np = out_normals.cpu().numpy()
    del out_vmaps, out_normals, mesh
    _free_ram_and_vram()
    pbar.update(1)

    pbar.set_description("Sampling attributes")
    with torch.no_grad():
        ctx = dr.RasterizeCudaContext()
        uvs_rast = torch.cat(
            [out_uvs * 2 - 1, torch.zeros_like(out_uvs[:, :1]), torch.ones_like(out_uvs[:, :1])],
            dim=-1,
        ).unsqueeze(0)
        del out_uvs
        rast = torch.zeros((1, texture_size, texture_size, 4), device="cuda", dtype=torch.float32)

        for i in range(0, out_faces.shape[0], 100000):
            rast_chunk, _ = dr.rasterize(
                ctx,
                uvs_rast,
                out_faces[i : i + 100000],
                resolution=[texture_size, texture_size],
            )
            mask_chunk = rast_chunk[..., 3:4] > 0
            rast_chunk[..., 3:4] += i
            rast = torch.where(mask_chunk, rast_chunk, rast)
            del rast_chunk, mask_chunk
        del uvs_rast, ctx

        mask = rast[0, ..., 3] > 0
        pos = dr.interpolate(out_vertices.unsqueeze(0), rast, out_faces)[0][0]
        valid_pos = pos[mask].contiguous()
        del pos, rast, out_vertices, out_faces
        torch.cuda.empty_cache()

        bvh_chunk = 500000
        for s in range(0, valid_pos.shape[0], bvh_chunk):
            e = min(valid_pos.shape[0], s + bvh_chunk)
            _, face_id_c, uvw_c = bvh.unsigned_distance(valid_pos[s:e].contiguous(), return_uvw=True)
            orig_tri_c = vertices[faces[face_id_c.long()]]
            valid_pos[s:e] = (orig_tri_c * uvw_c.unsqueeze(-1)).sum(dim=1)
            del face_id_c, uvw_c, orig_tri_c
        del bvh, vertices, faces
        torch.cuda.empty_cache()

        num_channels = attr_volume.shape[1]
        coords_4d = torch.cat([torch.zeros_like(coords[:, :1]), coords], dim=-1)
        vol_shape = torch.Size([1, num_channels, *grid_size_t.tolist()])
        sampled_valid = torch.empty((valid_pos.shape[0], num_channels), device="cuda", dtype=attr_volume.dtype)
        sample_chunk = 1000000
        for s in range(0, valid_pos.shape[0], sample_chunk):
            e = min(valid_pos.shape[0], s + sample_chunk)
            grid_c = ((valid_pos[s:e] - aabb_t[0]) / voxel_size).reshape(1, -1, 3)
            sampled_valid[s:e] = grid_sample_3d(
                attr_volume,
                coords_4d,
                shape=vol_shape,
                grid=grid_c,
                mode="trilinear",
            )[0]
            del grid_c
        del valid_pos, attr_volume, coords, coords_4d
        torch.cuda.empty_cache()

        attrs = torch.zeros(texture_size, texture_size, num_channels, device="cuda", dtype=sampled_valid.dtype)
        attrs[mask] = sampled_valid
        del sampled_valid
    pbar.update(1)

    pbar.set_description("Finalizing mesh")
    with torch.no_grad():
        x_dil = attrs.permute(2, 0, 1).unsqueeze(0)
        m_dil = mask.float().unsqueeze(0).unsqueeze(0)
        for _ in range(6):
            sum_x = torch.nn.functional.avg_pool2d(x_dil * m_dil, kernel_size=3, stride=1, padding=1, count_include_pad=False)
            sum_m = torch.nn.functional.avg_pool2d(m_dil, kernel_size=3, stride=1, padding=1, count_include_pad=False)
            newly_filled = (m_dil == 0) & (sum_m > 0)
            x_dil = torch.where(newly_filled, sum_x / sum_m.clamp_min(1e-6), x_dil)
            m_dil = torch.where(newly_filled, torch.ones_like(m_dil), m_dil)
        attrs = x_dil.squeeze(0).permute(1, 2, 0).contiguous()
        del x_dil, m_dil, sum_x, sum_m, newly_filled, mask

    attrs_np = np.clip(attrs.cpu().numpy() * 255, 0, 255).astype(np.uint8)
    del attrs
    _free_ram_and_vram()

    base_color = attrs_np[..., attr_layout["base_color"]]
    metallic = attrs_np[..., attr_layout["metallic"]]
    roughness = attrs_np[..., attr_layout["roughness"]]
    alpha = attrs_np[..., attr_layout["alpha"]]
    del attrs_np

    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=Image.fromarray(np.concatenate([base_color, alpha], axis=-1)),
        baseColorFactor=np.array([255, 255, 255, 255], dtype=np.uint8),
        metallicRoughnessTexture=Image.fromarray(np.concatenate([np.zeros_like(metallic), roughness, metallic], axis=-1)),
        metallicFactor=1.0,
        roughnessFactor=1.0,
        alphaMode="OPAQUE",
        doubleSided=True if not remesh else False,
    )

    vertices_np[:, 1], vertices_np[:, 2] = vertices_np[:, 2], -vertices_np[:, 1]
    normals_np[:, 1], normals_np[:, 2] = normals_np[:, 2], -normals_np[:, 1]
    uvs_np[:, 1] = 1 - uvs_np[:, 1]

    textured_mesh = trimesh.Trimesh(
        vertices=vertices_np,
        faces=faces_np,
        vertex_normals=normals_np,
        process=False,
        visual=trimesh.visual.TextureVisuals(uv=uvs_np, material=material),
    )
    pbar.update(1)
    pbar.close()
    return textured_mesh


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
    if args.low_vram and getattr(pipeline, "rembg_model", None) is not None:
        pipeline.rembg_model = None
        _free_ram_and_vram()

    camera_params = estimate_camera_params(image_preprocessed, manual_fov=args.fov)
    _free_ram_and_vram()

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
        mesh_list, (shape_slat_tmp, tex_slat_tmp, res) = run_with_tokens(args.max_num_tokens)
        del shape_slat_tmp, tex_slat_tmp
    except torch.OutOfMemoryError:
        if args.max_num_tokens <= 49152:
            raise
        print(f"[TRELLIS-3D] CUDA OOM at max_num_tokens={args.max_num_tokens}; retrying safely with 49152...", flush=True)
        _free_ram_and_vram()
        mesh_list, (shape_slat_tmp, tex_slat_tmp, res) = run_with_tokens(49152)
        del shape_slat_tmp, tex_slat_tmp

    print(f"[TRELLIS-3D] Cascade decoded at voxel grid res={res}", flush=True)
    mesh = mesh_list[0]
    pbr_attr_layout = pipeline.pbr_attr_layout

    # Free all diffusion pipeline models from RAM & VRAM immediately after decoding
    del mesh_list, pipeline
    _free_ram_and_vram()

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
    _free_ram_and_vram()

    effective_decimation = int(args.decimation_target)
    if args.low_vram and int(args.texture_size) >= 4096 and effective_decimation > 500000:
        print(
            f"[TRELLIS-3D] 4K Texture Low-VRAM guard: capping UV unwrap faces from {effective_decimation} to 500000 "
            "(4K PBR attributes are still baked from the full-resolution original mesh).",
            flush=True,
        )
        effective_decimation = 500000

    print(
        f"[TRELLIS-3D] Extracting textured PBR GLB (decimation_target={effective_decimation}, "
        f"texture_size={args.texture_size})...",
        flush=True,
    )
    mesh_vertices = mesh.vertices
    mesh_faces = mesh.faces
    mesh_attrs = mesh.attrs
    mesh_coords = mesh.coords
    del mesh
    _free_ram_and_vram()

    glb = extract_glb_4k_safe(
        vertices=mesh_vertices,
        faces=mesh_faces,
        attr_volume=mesh_attrs,
        coords=mesh_coords,
        attr_layout=pbr_attr_layout,
        grid_size=res,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=effective_decimation,
        texture_size=args.texture_size,
        remesh=bool(args.remesh),
        remesh_band=1,
        remesh_project=0.95,
        mesh_cluster_threshold_cone_half_angle_rad=np.radians(85.0),
        mesh_cluster_refine_iterations=int(args.uv_refine_iters),
    )
    del mesh_vertices, mesh_faces, mesh_attrs, mesh_coords
    _free_ram_and_vram()

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
