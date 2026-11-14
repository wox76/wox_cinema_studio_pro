#!/usr/bin/env python3
"""Face detection, high-res face-context cropping, landmark alignment, and ParseNet compositing for Wonderfull."""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import sys
from typing import Any

import cv2
import numpy as np
from PIL import Image


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _get_analyzer(insight_root: str):
    if not insight_root or not os.path.isdir(insight_root):
        return None
    try:
        from insightface.app import FaceAnalysis  # type: ignore

        app = FaceAnalysis(
            name="buffalo_l",
            root=insight_root,
            allowed_modules=["detection"],
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(640, 640))
        return app
    except Exception:
        return None


def _detect_insightface(img_bgr: np.ndarray, insight_root: str) -> list[tuple[float, float, float, float, float]]:
    app = _get_analyzer(insight_root)
    if app is None:
        return []
    faces = app.get(img_bgr)
    out: list[tuple[float, float, float, float, float]] = []
    for f in faces:
        x1, y1, x2, y2 = [float(v) for v in f.bbox]
        score = float(getattr(f, "det_score", 0.9))
        if x2 > x1 and y2 > y1:
            out.append((x1, y1, x2 - x1, y2 - y1, score))
    return out


def _detect_haar(img_bgr: np.ndarray) -> list[tuple[float, float, float, float, float]]:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    cascade = cv2.CascadeClassifier(cascade_path)
    rects = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(36, 36))
    return [(float(x), float(y), float(w), float(h), 0.75) for (x, y, w, h) in rects]


def _make_thumb(pil_img: Image.Image, x1: float, y1: float, bw: float, bh: float, size: int = 176) -> str:
    W, H = pil_img.size
    cx = x1 + bw * 0.5
    cy = y1 + bh * 0.46
    side = max(bw, bh) * 1.48
    tx1 = max(0, int(round(cx - side * 0.5)))
    ty1 = max(0, int(round(cy - side * 0.5)))
    tx2 = min(W, int(round(tx1 + side)))
    ty2 = min(H, int(round(ty1 + side)))
    if tx2 <= tx1 or ty2 <= ty1:
        tx1, ty1, tx2, ty2 = 0, 0, W, H
    crop = pil_img.crop((tx1, ty1, tx2, ty2)).convert("RGB")
    crop = crop.resize((size, size), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def cmd_detect(args: argparse.Namespace) -> dict[str, Any]:
    pil_img = Image.open(args.image).convert("RGB")
    W, H = pil_img.size
    img_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    raw_faces: list[tuple[float, float, float, float, float]] = []
    if args.insightface_root and os.path.isdir(args.insightface_root):
        try:
            raw_faces = _detect_insightface(img_bgr, args.insightface_root)
        except Exception:
            raw_faces = []
    if not raw_faces:
        try:
            raw_faces = _detect_haar(img_bgr)
        except Exception:
            raw_faces = []

    raw_faces.sort(key=lambda r: (round(r[1] / max(1.0, H) * 4), r[0]))

    faces_out: list[dict[str, Any]] = []
    for idx, (fx, fy, fw, fh, score) in enumerate(raw_faces):
        # Generous context crop so Qwen sees hair, ears, chin, neck, and scene lighting naturally
        cx = fx + fw * 0.5
        cy = fy + fh * 0.46
        crop_w = max(fw * 2.1, fh * 1.95)
        crop_h = max(fh * 2.15, fw * 2.15)
        cx1 = max(0.0, cx - crop_w * 0.5)
        cy1 = max(0.0, cy - crop_h * 0.50)
        cx2 = min(float(W), cx + crop_w * 0.5)
        cy2 = min(float(H), cy + crop_h * 0.50)

        faces_out.append({
            "index": idx,
            "score": round(score, 4),
            "bbox": {
                "x": round(_clamp01(fx / W), 5),
                "y": round(_clamp01(fy / H), 5),
                "w": round(_clamp01(fw / W), 5),
                "h": round(_clamp01(fh / H), 5),
            },
            "cropBox": {
                "x": round(_clamp01(cx1 / W), 5),
                "y": round(_clamp01(cy1 / H), 5),
                "w": round(_clamp01((cx2 - cx1) / W), 5),
                "h": round(_clamp01((cy2 - cy1) / H), 5),
            },
            "thumb": _make_thumb(pil_img, fx, fy, fw, fh),
        })

    return {"width": W, "height": H, "faces": faces_out}


def _parse_box(box_str: str, W: int, H: int) -> tuple[int, int, int, int]:
    parts = [float(p.strip()) for p in box_str.split(",")]
    if len(parts) != 4:
        raise ValueError("box must be x,y,w,h")
    nx, ny, nw, nh = parts
    x1 = max(0, min(W - 2, int(round(nx * W))))
    y1 = max(0, min(H - 2, int(round(ny * H))))
    x2 = max(x1 + 2, min(W, int(round((nx + nw) * W))))
    y2 = max(y1 + 2, min(H, int(round((ny + nh) * H))))
    return x1, y1, x2, y2


def _round16(v: float) -> int:
    return max(64, int(round(v / 16.0)) * 16)


def cmd_crop(args: argparse.Namespace) -> dict[str, Any]:
    pil_img = Image.open(args.image).convert("RGB")
    W, H = pil_img.size
    x1, y1, x2, y2 = _parse_box(args.box, W, H)
    crop = pil_img.crop((x1, y1, x2, y2))
    cw, ch = crop.size
    min_side = min(cw, ch)
    if min_side < 768:
        scale = 768.0 / float(min_side)
        nw = min(1344, _round16(cw * scale))
        nh = min(1344, _round16(ch * scale))
        crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    else:
        nw = _round16(cw)
        nh = _round16(ch)
        if abs(nw - cw) > 1 or abs(nh - ch) > 1:
            crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    crop.save(args.out, format="PNG")
    return {"ok": True, "box": [x1, y1, x2 - x1, y2 - y1], "outSize": list(crop.size)}


def _align_patch_to_roi(
    roi_bgr: np.ndarray,
    patch_bgr: np.ndarray,
    analyzer: Any,
    target_center: tuple[float, float],
) -> np.ndarray:
    """Micro-align Qwen's generated patch onto original eye/nose coordinates to stop 1-3px shift."""
    if analyzer is None:
        return patch_bgr
    try:
        bh, bw = roi_bgr.shape[:2]
        roi_faces = analyzer.get(roi_bgr)
        patch_faces = analyzer.get(patch_bgr)
        if not roi_faces or not patch_faces:
            return patch_bgr

        def pick_closest(flist):
            return min(
                flist,
                key=lambda f: ((0.5 * (f.bbox[0] + f.bbox[2]) - target_center[0]) ** 2
                               + (0.5 * (f.bbox[1] + f.bbox[3]) - target_center[1]) ** 2),
            )

        rf = pick_closest(roi_faces)
        pf = pick_closest(patch_faces)
        if getattr(rf, "kps", None) is None or getattr(pf, "kps", None) is None:
            return patch_bgr

        # Anchor strictly on eyes + nose (indices 0,1,2) so Smile edits don't pull the face upward
        dst_pts = np.asarray(rf.kps[:3], dtype=np.float32)
        src_pts = np.asarray(pf.kps[:3], dtype=np.float32)
        M, _ = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.LMEDS)
        if M is None:
            return patch_bgr

        scale = math.hypot(float(M[0, 0]), float(M[0, 1]))
        angle_deg = abs(math.degrees(math.atan2(float(M[1, 0]), float(M[0, 0]))))
        tx = abs(float(M[0, 2]))
        ty = abs(float(M[1, 2]))
        if not (0.93 <= scale <= 1.07 and angle_deg <= 5.0 and tx <= bw * 0.06 and ty <= bh * 0.06):
            return patch_bgr

        return cv2.warpAffine(
            patch_bgr,
            M,
            (bw, bh),
            flags=cv2.INTER_LANCZOS4,
            borderMode=cv2.BORDER_REFLECT_101,
        )
    except Exception:
        return patch_bgr


def _load_parsenet(models_dir: str):
    if not models_dir:
        return None
    weights = os.path.join(models_dir, "facedetection", "parsing_parsenet.pth")
    if not os.path.isfile(weights):
        return None
    comfy_root = os.path.dirname(os.path.abspath(models_dir))
    reactor_dir = os.path.join(comfy_root, "custom_nodes", "ComfyUI-ReActor")
    if os.path.isdir(reactor_dir) and reactor_dir not in sys.path:
        sys.path.insert(0, reactor_dir)
    try:
        import torch  # type: ignore
        from r_facelib.parsing.parsenet import ParseNet  # type: ignore

        model = ParseNet(in_size=512, out_size=512, parsing_ch=19)
        ckpt = torch.load(weights, map_location="cpu")
        model.load_state_dict(ckpt, strict=True)
        model.eval()
        return (model, torch)
    except Exception:
        return None


def _run_parsenet(parsenet_bundle: tuple[Any, Any], bgr: np.ndarray) -> np.ndarray:
    model, torch = parsenet_bundle
    bh, bw = bgr.shape[:2]
    inp = cv2.resize(bgr, (512, 512), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    ten = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
    ten = (ten - 0.5) / 0.5
    with torch.no_grad():
        logits = model(ten)[0]
    cls = logits.argmax(dim=1).squeeze().cpu().numpy().astype(np.uint8)
    return cv2.resize(cls, (bw, bh), interpolation=cv2.INTER_NEAREST)


def _build_semantic_mask(
    roi_bgr: np.ndarray,
    patch_bgr: np.ndarray,
    face_rel: tuple[float, float, float, float],
    mode: str,
    models_dir: str,
    keep_glasses: bool = True,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    bh, bw = roi_bgr.shape[:2]
    fx, fy, fw, fh = face_rel
    cx = int(round(fx + fw * 0.5))
    cy = int(round(fy + fh * (0.44 if mode == "head" else 0.49)))

    # Spatial containment gate around the chosen face so stray masks or adjacent faces never bleed
    gate = np.zeros((bh, bw), dtype=np.float32)
    rx = max(12, int(round(fw * (0.95 if mode == "head" else 0.72))))
    ry = max(12, int(round(fh * (1.02 if mode == "head" else 0.74))))
    cv2.ellipse(gate, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)
    gate_blur = max(11, int(round(min(fw, fh) * 0.14)) | 1)
    gate = cv2.GaussianBlur(gate, (gate_blur, gate_blur), 0)

    # Fallback anatomical skin reference mask (cheeks, forehead, nose, chin; excluding eye & mouth slots)
    fallback_skin = np.zeros((bh, bw), dtype=np.float32)
    cv2.ellipse(
        fallback_skin,
        (cx, int(round(fy + fh * 0.48))),
        (max(8, int(round(fw * 0.44))), max(8, int(round(fh * 0.46)))),
        0, 0, 360, 1.0, -1,
    )
    ey1, ey2 = max(0, int(round(fy + fh * 0.22))), min(bh, int(round(fy + fh * 0.45)))
    ex1, ex2 = max(0, int(round(fx + fw * 0.12))), min(bw, int(round(fx + fw * 0.88)))
    fallback_skin[ey1:ey2, ex1:ex2] = 0.0
    my1, my2 = max(0, int(round(fy + fh * 0.62))), min(bh, int(round(fy + fh * 0.88)))
    mx1, mx2 = max(0, int(round(fx + fw * 0.22))), min(bw, int(round(fx + fw * 0.78)))
    fallback_skin[my1:my2, mx1:mx2] = 0.0
    skin_ref = fallback_skin > 0.5
    bg_wall = np.zeros((bh, bw), dtype=np.float32)

    bundle = _load_parsenet(models_dir)
    if bundle is not None:
        try:
            cls_roi = _run_parsenet(bundle, roi_bgr)
            cls_patch = _run_parsenet(bundle, patch_bgr)

            # ParseNet CelebAMask-HQ IDs:
            # 0=bg, 1=skin, 2=nose, 3=glasses, 4=l_eye, 5=r_eye, 6=l_brow, 7=r_brow,
            # 8=l_ear, 9=r_ear, 10=mouth, 11=u_lip, 12=l_lip, 13=hair, 14=hat, 17=neck, 18=cloth
            face_ids = (1, 2, 4, 5, 6, 7, 10, 11, 12) + (() if keep_glasses else (3,))
            active_ids = face_ids + ((8, 9, 13, 14) if mode == "head" else ())

            # Pure skin pixels present in BOTH original and edited patch (skin=1, nose=2, neck=17)
            skin_ids = (1, 2, 17)
            parsed_skin = np.isin(cls_roi, skin_ids) & np.isin(cls_patch, skin_ids) & (gate > 0.20)
            if np.count_nonzero(parsed_skin) >= 120:
                skin_ref = parsed_skin

            raw = np.zeros((bh, bw), dtype=np.float32)
            for cid in active_ids:
                raw[(cls_roi == cid) | (cls_patch == cid)] = 1.0

            # Gentle chin-to-neck fade (stronger near jaw, tapering to 0 before shirt/collar)
            neck_mask = ((cls_roi == 17) | (cls_patch == 17)).astype(np.float32)
            jaw_y = fy + fh * 0.92
            y_coords = np.arange(bh, dtype=np.float32)[:, None]
            taper = np.clip(1.0 - (y_coords - jaw_y) / max(12.0, fh * 0.42), 0.0, 1.0)
            raw = np.maximum(raw, neck_mask * taper * 0.55)

            # Preserve original eyeglass frames intact unless the user asked for new glasses
            if keep_glasses:
                raw[cls_roi == 3] = 0.0
                raw[cls_patch == 3] = 0.0

            # Never bleed Qwen's background/clothes pixels onto the original photo
            if mode == "face":
                raw[(cls_patch == 0) | (cls_patch == 18)] = 0.0
                shield = ((cls_roi == 0) | (cls_roi == 18)) & (~np.isin(cls_patch, active_ids))
                raw[shield] = 0.0
            else:
                raw[cls_patch == 18] = 0.0

            # Clean tiny speckles & gently close small gaps
            k_close = max(5, int(round(min(fw, fh) * 0.04)) | 1)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_close, k_close))
            raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, kernel)
            if mode == "face":
                raw[(cls_patch == 0) | (cls_patch == 18)] = 0.0

            mask = raw * gate
            blur_r = max(9, int(round(min(fw, fh) * 0.06)) | 1)
            mask = cv2.GaussianBlur(mask, (blur_r, blur_r), 0)
            if mode == "face":
                # Hard-shield any background pixels so cheek/jaw boundaries never halo onto the wall
                bg_wall = ((cls_roi == 0) & (cls_patch == 0)).astype(np.float32)
                mask = mask * (1.0 - bg_wall)
            if keep_glasses:
                rim = cv2.dilate(((cls_roi == 3) | (cls_patch == 3)).astype(np.float32), np.ones((3, 3), np.uint8))
                rim = cv2.GaussianBlur(rim, (5, 5), 0)
                mask = mask * (1.0 - rim * 0.90)
        except Exception:
            mask = gate
    else:
        mask = gate

    # Zero outermost 2% border of cropBox cleanly
    pad_x = max(2, int(round(bw * 0.02)))
    pad_y = max(2, int(round(bh * 0.02)))
    mask[:pad_y, :] = 0.0
    mask[-pad_y:, :] = 0.0
    mask[:, :pad_x] = 0.0
    mask[:, -pad_x:] = 0.0
    return np.clip(mask, 0.0, 1.0), skin_ref, bg_wall


def _trimmed_stats(arr: np.ndarray) -> tuple[float, float]:
    if arr.size == 0:
        return 0.0, 1.0
    lo, hi = np.percentile(arr, [10.0, 90.0])
    trimmed = arr[(arr >= lo) & (arr <= hi)]
    if trimmed.size < 16:
        trimmed = arr
    return float(np.mean(trimmed)), max(1.0, float(np.std(trimmed)))


def _harmonize_and_blend_face(
    roi_bgr: np.ndarray,
    patch_bgr: np.ndarray,
    mask: np.ndarray,
    skin_ref: np.ndarray,
    bg_wall: np.ndarray,
    face_rel: tuple[float, float, float, float],
) -> np.ndarray:
    """3-stage perceptual color & lighting matcher + 2-band Laplacian pyramid blend."""
    bh, bw = roi_bgr.shape[:2]
    _, _, fw, fh = face_rel

    roi_lab = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    patch_lab = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

    # Exclude pixels where structural content changed drastically (e.g. added beard, opened teeth/eyes)
    l_diff = np.abs(roi_lab[:, :, 0] - patch_lab[:, :, 0])
    valid_skin = skin_ref & (l_diff < 38.0)
    if np.count_nonzero(valid_skin) < 80:
        valid_skin = (mask > 0.06) & (mask < 0.78) & (l_diff < 42.0)
    if np.count_nonzero(valid_skin) < 40:
        valid_skin = mask > 0.10

    # Stage 1: CIE LAB Reinhard color transfer on invariant skin pixels
    matched_lab = patch_lab.copy()
    if np.any(valid_skin):
        # L* channel (luminance & contrast)
        mean_r_l, std_r_l = _trimmed_stats(roi_lab[:, :, 0][valid_skin])
        mean_p_l, std_p_l = _trimmed_stats(patch_lab[:, :, 0][valid_skin])
        gain_l = float(np.clip(std_r_l / std_p_l, 0.82, 1.18))
        alpha_l = 0.86
        matched_lab[:, :, 0] = (
            (patch_lab[:, :, 0] - mean_p_l) * (1.0 + alpha_l * (gain_l - 1.0))
            + mean_p_l
            + alpha_l * (mean_r_l - mean_p_l)
        )

        # a* and b* chrominance channels (skin warmth, redness/magenta, yellow/tan undertone)
        for c in (1, 2):
            mean_r_c, std_r_c = _trimmed_stats(roi_lab[:, :, c][valid_skin])
            mean_p_c, std_p_c = _trimmed_stats(patch_lab[:, :, c][valid_skin])
            gain_c = float(np.clip(std_r_c / std_p_c, 0.78, 1.24))
            alpha_c = 0.95
            matched_lab[:, :, c] = (
                (patch_lab[:, :, c] - mean_p_c) * (1.0 + alpha_c * (gain_c - 1.0))
                + mean_p_c
                + alpha_c * (mean_r_c - mean_p_c)
            )

    matched_lab = np.clip(matched_lab, 0.0, 255.0).astype(np.uint8)
    patch_f = cv2.cvtColor(matched_lab, cv2.COLOR_LAB2BGR).astype(np.float32)
    roi_f = roi_bgr.astype(np.float32)

    # Stage 2: Smooth spatial illumination & seam field (normalized convolution)
    seam_ring = np.clip(1.0 - np.abs(mask - 0.28) / 0.28, 0.0, 1.0)
    color_jump = np.max(np.abs(roi_f - patch_f), axis=2)
    no_struct_jump = np.clip(1.0 - (color_jump - 28.0) / 24.0, 0.0, 1.0)
    w_illum = np.maximum(seam_ring, valid_skin.astype(np.float32) * 0.55) * no_struct_jump

    if float(np.sum(w_illum)) > 25.0:
        k_illum = max(31, int(round(min(bw, bh) * 0.22)) | 1)
        den = cv2.GaussianBlur(w_illum, (k_illum, k_illum), 0) + 1e-4
        for c in range(3):
            res = (roi_f[:, :, c] - patch_f[:, :, c]) * w_illum
            num = cv2.GaussianBlur(res, (k_illum, k_illum), 0)
            field = np.clip(num / den, -24.0, 24.0)
            patch_f[:, :, c] = np.clip(patch_f[:, :, c] + field * 0.88, 0.0, 255.0)

    # Stage 3: 2-Band Laplacian Pyramid Blend (wide smooth color transition + crisp high-frequency details)
    k_pyr = max(7, int(round(min(fw, fh) * 0.05)) | 1)
    roi_lo = cv2.GaussianBlur(roi_f, (k_pyr, k_pyr), 0)
    patch_lo = cv2.GaussianBlur(patch_f, (k_pyr, k_pyr), 0)
    roi_hi = roi_f - roi_lo
    patch_hi = patch_f - patch_lo

    k_lo_mask = max(19, int(round(min(fw, fh) * 0.14)) | 1)
    mask_lo = cv2.GaussianBlur(mask, (k_lo_mask, k_lo_mask), 0)
    mask_lo = mask_lo * (1.0 - bg_wall)
    pad_x = max(2, int(round(bw * 0.02)))
    pad_y = max(2, int(round(bh * 0.02)))
    mask_lo[:pad_y, :] = 0.0
    mask_lo[-pad_y:, :] = 0.0
    mask_lo[:, :pad_x] = 0.0
    mask_lo[:, -pad_x:] = 0.0
    mask_lo = np.clip(mask_lo, 0.0, 1.0)

    alpha_lo = mask_lo[:, :, None]
    alpha_hi = mask[:, :, None]
    blend_lo = patch_lo * alpha_lo + roi_lo * (1.0 - alpha_lo)
    blend_hi = patch_hi * alpha_hi + roi_hi * (1.0 - alpha_hi)
    return np.clip(blend_lo + blend_hi, 0.0, 255.0)


def cmd_composite(args: argparse.Namespace) -> dict[str, Any]:
    base_pil = Image.open(args.base).convert("RGB")
    patch_pil = Image.open(args.patch).convert("RGB")
    W, H = base_pil.size
    x1, y1, x2, y2 = _parse_box(args.box, W, H)
    bw, bh = x2 - x1, y2 - y1

    patch_resized = patch_pil.resize((bw, bh), Image.Resampling.LANCZOS)
    base_bgr = cv2.cvtColor(np.array(base_pil), cv2.COLOR_RGB2BGR)
    roi_bgr = base_bgr[y1:y2, x1:x2]
    patch_bgr = cv2.cvtColor(np.array(patch_resized), cv2.COLOR_RGB2BGR)

    # Determine face box inside crop coordinates
    if args.face_box:
        fx1, fy1, fx2, fy2 = _parse_box(args.face_box, W, H)
        face_rel = (float(fx1 - x1), float(fy1 - y1), float(max(8, fx2 - fx1)), float(max(8, fy2 - fy1)))
    else:
        face_rel = (bw * 0.25, bh * 0.22, bw * 0.50, bh * 0.54)

    face_center = (face_rel[0] + face_rel[2] * 0.5, face_rel[1] + face_rel[3] * 0.5)
    models_dir = args.models_dir or (os.path.dirname(os.path.abspath(args.insightface_root)) if args.insightface_root else "")
    insight_root = args.insightface_root or (os.path.join(models_dir, "insightface") if models_dir else "")

    analyzer = _get_analyzer(insight_root)
    patch_aligned_bgr = _align_patch_to_roi(roi_bgr, patch_bgr, analyzer, face_center)

    mask, skin_ref, bg_wall = _build_semantic_mask(
        roi_bgr,
        patch_aligned_bgr,
        face_rel,
        args.mode,
        models_dir,
        keep_glasses=not args.no_keep_glasses,
    )

    blended = _harmonize_and_blend_face(
        roi_bgr,
        patch_aligned_bgr,
        mask,
        skin_ref,
        bg_wall,
        face_rel,
    )
    out_bgr = base_bgr.astype(np.float32)
    out_bgr[y1:y2, x1:x2] = np.clip(blended, 0.0, 255.0)
    out_rgb = cv2.cvtColor(out_bgr.astype(np.uint8), cv2.COLOR_BGR2RGB)
    Image.fromarray(out_rgb).save(args.out, format="PNG")
    return {"ok": True, "width": W, "height": H, "mode": args.mode}


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("detect")
    d.add_argument("--image", required=True)
    d.add_argument("--insightface-root", default="")

    c = sub.add_parser("crop")
    c.add_argument("--image", required=True)
    c.add_argument("--box", required=True)
    c.add_argument("--out", required=True)

    m = sub.add_parser("composite")
    m.add_argument("--base", required=True)
    m.add_argument("--patch", required=True)
    m.add_argument("--box", required=True)
    m.add_argument("--face-box", default="")
    m.add_argument("--mode", choices=["face", "head"], default="face")
    m.add_argument("--no-keep-glasses", action="store_true")
    m.add_argument("--models-dir", default="")
    m.add_argument("--insightface-root", default="")
    m.add_argument("--out", required=True)

    args = p.parse_args()
    if args.cmd == "detect":
        res = cmd_detect(args)
    elif args.cmd == "crop":
        res = cmd_crop(args)
    else:
        res = cmd_composite(args)
    print(json.dumps(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
