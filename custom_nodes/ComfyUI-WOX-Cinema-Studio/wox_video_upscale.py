"""
WOX Video Auto-Length & Upscaler Node.
Automatically adapts to video duration and frame count, snapping to MiniMax H3's
17k+5 frame grid, and provides spatial resolution upscaling.
"""

import math
import logging
import torch
import torch.nn.functional as F
import comfy.utils

logger = logging.getLogger("WOXCinemaStudio")

class WOXVideoAutoLengthNode:
    """
    Analyzes an input video (IMAGE batch and optional metadata/audio),
    automatically calculates the exact frame count, duration, FPS, and
    snaps the length to MiniMax H3's native 17k+5 temporal grid.
    Also provides high-quality batched spatial upscaling (Lanczos, Bicubic, etc.)
    with multiple-of-32 dimension alignment for H3 video generation.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Video frames batch [B, H, W, C]"}),
                "upscale_method": (["lanczos", "bicubic", "bilinear", "nearest-exact", "area"], {"default": "lanczos"}),
                "scale": ("FLOAT", {"default": 2.0, "min": 1.0, "max": 4.0, "step": 0.05}),
                "target_resolution": (["Custom Scale", "720p", "1080p", "4k", "Keep Original"], {"default": "Custom Scale"}),
                "force_h3_grid": ("BOOLEAN", {"default": True, "tooltip": "Snap frame length to MiniMax H3 17k+5 grid (5, 22, 39, ..., 124, 243, 362 frames)"}),
            },
            "optional": {
                "video_info": ("VHS_VIDEOINFO", {"tooltip": "Video metadata from VHS_LoadVideo"}),
                "audio": ("VHS_AUDIO", {"tooltip": "Audio track from VHS_LoadVideo"}),
                "frame_rate_override": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 120.0, "step": 1.0, "tooltip": "0 = use video_info or 24 fps default"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "FLOAT", "FLOAT", "INT", "INT", "IMAGE", "VHS_AUDIO", "VHS_VIDEOINFO", "STRING")
    RETURN_NAMES = ("upscaled_images", "h3_length", "frame_count", "duration_seconds", "fps", "target_width", "target_height", "original_images", "audio", "video_info", "summary")
    FUNCTION = "process"
    CATEGORY = "WOX Cinema Studio"
    DESCRIPTION = "Automatically detects video frame count and duration, snaps length to MiniMax H3 17k+5 grid, and provides spatial upscaling."

    def process(self, images, upscale_method, scale, target_resolution, force_h3_grid, video_info=None, audio=None, frame_rate_override=0.0):
        if not isinstance(images, torch.Tensor) or images.ndim != 4:
            raise ValueError("Input images must be a 4D torch.Tensor batch [B, H, W, C].")

        raw_frames = int(images.shape[0])
        source_h = int(images.shape[1])
        source_w = int(images.shape[2])

        # Resolve FPS
        fps = 24.0
        if frame_rate_override > 0.0:
            fps = float(frame_rate_override)
        elif isinstance(video_info, dict) and "fps" in video_info:
            try:
                fps = float(video_info["fps"])
            except (ValueError, TypeError):
                fps = 24.0
        elif isinstance(video_info, (tuple, list)) and len(video_info) > 0 and isinstance(video_info[0], (int, float)):
            fps = float(video_info[0])

        duration_seconds = float(raw_frames / fps) if fps > 0 else 0.0

        # Calculate MiniMax H3 aligned length (17k + 5 grid)
        if force_h3_grid:
            if raw_frames <= 5:
                h3_length = 5
            else:
                h3_length = int(math.ceil((raw_frames - 5) / 17.0) * 17 + 5)
        else:
            h3_length = raw_frames

        # Calculate target resolution aligned to multiple of 32 (MiniMax H3 patch requirement)
        ratio = source_w / max(1, source_h)
        if target_resolution == "Keep Original":
            target_w = max(32, int(round(source_w / 32.0)) * 32)
            target_h = max(32, int(round(source_h / 32.0)) * 32)
        elif target_resolution == "720p":
            if ratio >= 1.0:
                target_h = 704
                target_w = max(32, int(round((704 * ratio) / 32.0)) * 32)
            else:
                target_w = 704
                target_h = max(32, int(round((704 / ratio) / 32.0)) * 32)
        elif target_resolution == "1080p":
            if ratio >= 1.0:
                target_h = 1088
                target_w = max(32, int(round((1088 * ratio) / 32.0)) * 32)
            else:
                target_w = 1088
                target_h = max(32, int(round((1088 / ratio) / 32.0)) * 32)
        elif target_resolution == "4k":
            if ratio >= 1.0:
                target_h = 2176
                target_w = max(32, int(round((2176 * ratio) / 32.0)) * 32)
            else:
                target_w = 2176
                target_h = max(32, int(round((2176 / ratio) / 32.0)) * 32)
        else:  # Custom Scale
            target_w = max(32, int(round((source_w * float(scale)) / 32.0)) * 32)
            target_h = max(32, int(round((source_h * float(scale)) / 32.0)) * 32)

        # Spatial upscaling
        if target_w == source_w and target_h == source_h:
            upscaled_images = images
        else:
            logger.info(f"WOX Video Upscale: {raw_frames} frames from {source_w}x{source_h} -> {target_w}x{target_h} using {upscale_method}")
            # Chunked upscale to manage VRAM/RAM
            chunk_size = 16
            out_chunks = []
            for i in range(0, raw_frames, chunk_size):
                batch = images[i:i + chunk_size]
                # [B, H, W, C] -> [B, C, H, W]
                b_perm = batch.permute(0, 3, 1, 2).contiguous()
                if upscale_method in ("bicubic", "bilinear"):
                    up = F.interpolate(b_perm, size=(target_h, target_w), mode=upscale_method, align_corners=False)
                elif upscale_method in ("nearest-exact", "nearest"):
                    up = F.interpolate(b_perm, size=(target_h, target_w), mode="nearest")
                elif upscale_method == "area":
                    up = F.interpolate(b_perm, size=(target_h, target_w), mode="area")
                else:  # lanczos
                    try:
                        up = comfy.utils.common_upscale(b_perm, target_w, target_h, upscale_method, "disabled")
                    except Exception:
                        up = F.interpolate(b_perm, size=(target_h, target_w), mode="bicubic", align_corners=False)
                up = up.permute(0, 2, 3, 1).clamp(0.0, 1.0)
                out_chunks.append(up)
            upscaled_images = torch.cat(out_chunks, dim=0)

        summary = (
            f"🎬 Video: {raw_frames} frames ({duration_seconds:.2f}s @ {fps:.1f} fps) | "
            f"H3 Aligned Length: {h3_length} frames | "
            f"Resolution: {source_w}x{source_h} -> {target_w}x{target_h} ({target_w/source_w:.2f}x)"
        )
        logger.info(f"WOXVideoAutoLength: {summary}")

        return (upscaled_images, h3_length, raw_frames, duration_seconds, fps, target_w, target_h, images, audio, video_info, summary)
