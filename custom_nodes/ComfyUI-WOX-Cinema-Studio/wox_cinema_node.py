import os
import glob
import json
import logging
import re
import time
import uuid
import torch
import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer
import folder_paths

from .api_clients.z_image_client import ZImageClient
from .api_clients.krea_client import KreaClient
from .api_clients.minimax_client import MinimaxClient

logger = logging.getLogger("WOXCinemaStudio")

__version__ = "1.2.0"

# Directory di output per WOX Cinema Studio
WOX_OUTPUT_DIR = os.path.join(folder_paths.get_output_directory(), "wox_cinema")
os.makedirs(WOX_OUTPUT_DIR, exist_ok=True)

class WOXCinemaStudioNode:
    """
    WOX Cinema Studio Node for ComfyUI.
    Emulates the cinematic AI Generation interface with Krea 2 Turbo for images and Minimax H3 for videos.
    """
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "A cinematic shot of a cyberpunk city street with neon lights reflecting in puddles, 8k resolution, ultra detailed"}),
                "mode": (["Video (Minimax H3)", "Image (Krea 2 Turbo)", "Image (Z-Image Turbo)", "Video Upscale (JR MiniMax H3)"], {"default": "Video (Minimax H3)"}),
                "film_setup": (["General", "NOIR", "Comedy", "Horror", "Action", "Epic", "Drama", "Auto", "Cinematic 35mm", "IMAX 70mm", "Vintage Super 8", "Anime Style", "Hyperrealistic 8k", "Noir Classic"], {"default": "General"}),
                "camera": (["Auto", "Static Tripod", "Pan Left to Right", "Tilt Up", "Slow Zoom In", "Drone FPV", "360 Orbit", "Handheld Shake"], {"default": "Auto"}),
                "color_palette": (["Auto", "Neon Rain at Midnight", "Home Is the Next Gas Station", "The Crimson Ballet", "The Morning After Rain", "Turquoise Mirage", "Yellow Room", "Teal & Orange", "Cyberpunk Neon", "B&W Monochrome", "Warm Sunset", "Cool Moonlight", "Pastel Aesthetic"], {"default": "Auto"}),
                "lighting": (["Auto", "Studio Softbox", "Golden Hour", "Dramatic Rim Light", "Volumetric Fog Light", "Cyber Neon Glow", "Low Key Dark"], {"default": "Auto"}),
                "aspect_ratio": (["16:9", "9:16", "1:1", "21:9", "4:3"], {"default": "16:9"}),
                "resolution": (["480p", "720p", "1080p", "4k"], {"default": "480p"}),
                "duration": ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {"default": 5}),
                "steps": ([20, 25, 30, 35, 40, 45, 50, 55, 60], {"default": 20}),
                "audio": (["On", "Off"], {"default": "On"}),
                "variations": ([1, 2, 4], {"default": 1}),
            },
            "optional": {
                "reference_image": ("IMAGE",),
                "reference_video": ("IMAGE",),
                "z_image_api_key": ("STRING", {"default": ""}),
                "krea_api_key": ("STRING", {"default": ""}),
                "minimax_api_key": ("STRING", {"default": ""}),
                "negative_prompt": ("STRING", {"multiline": True, "default": "low quality, blurry, distorted, watermarks"}),
            }
        }

    OUTPUT_NODE = False
    RETURN_TYPES = ("IMAGE", "VHS_FILENAMES", "STRING")
    RETURN_NAMES = ("IMAGE", "VIDEO_FILENAMES", "PROMPT_OUT")
    FUNCTION = "generate"
    CATEGORY = "WOX Cinema Studio"
    SEARCH_ALIASES = ["wox", "wox cinema", "wox cinema studio", "higgsfield", "z-image", "z_image", "zimage", "krea", "minimax", "cinema studio"]

    def generate(self, prompt, mode, film_setup, camera, color_palette, lighting, aspect_ratio, resolution, duration, audio, variations, steps=20, reference_image=None, reference_video=None, z_image_api_key="", krea_api_key="", minimax_api_key="", negative_prompt=""):
        logger.info(f"WOXCinemaStudio: Avvio generazione mode='{mode}' | prompt='{prompt[:40]}...'")

        # Parsing width and height based on aspect ratio
        w, h = 1280, 720
        valid_ratios = ["16:9", "9:16", "1:1", "21:9", "4:3"]
        valid_resolutions = ["480p", "720p", "1080p", "4k"]
        if aspect_ratio not in valid_ratios:
            aspect_ratio = "16:9"
        if resolution not in valid_resolutions:
            resolution = "480p"

        if aspect_ratio == "16:9":
            if resolution == "4k": w, h = (3840, 2160)
            elif resolution == "1080p": w, h = (1920, 1080)
            elif resolution == "480p": w, h = (854, 480)
            else: w, h = (1280, 720)
        elif aspect_ratio == "9:16":
            if resolution == "4k": w, h = (2160, 3840)
            elif resolution == "1080p": w, h = (1080, 1920)
            elif resolution == "480p": w, h = (480, 854)
            else: w, h = (720, 1280)
        elif aspect_ratio == "1:1":
            if resolution == "480p": w, h = (512, 512)
            elif resolution == "4k": w, h = (2048, 2048)
            elif resolution == "1080p": w, h = (1024, 1024)
            else: w, h = (768, 768)
        elif aspect_ratio == "21:9":
            if resolution == "4k": w, h = (3840, 1600)
            elif resolution == "1080p": w, h = (2560, 1080)
            elif resolution == "480p": w, h = (1120, 480)
            else: w, h = (1680, 720)
        elif aspect_ratio == "4:3":
            if resolution == "4k": w, h = (2880, 2160)
            elif resolution == "1080p": w, h = (1440, 1080)
            elif resolution == "480p": w, h = (640, 480)
            else: w, h = (960, 720)

        # Style compilation
        film_descriptions = {
            "General": "Film look: Cinematic 35mm practical photography, natural balanced lighting, shallow depth of field, realistic live-action film texture, premium studio grading",
            "Cinematic 35mm": "Film look: Kodak 35mm motion picture film stock, shallow depth of field, natural organic halation, authentic celluloid texture",
            "IMAX 70mm": "Film look: Shot on IMAX 70mm cameras, extreme sharpness, breathtaking dynamic range, majestic scale, pristine visual clarity",
            "NOIR": "Film look: Film Noir aesthetic, deep dramatic shadows, high contrast chiaroscuro lighting, moody monochrome tone, vintage detective texture, cinematic grain",
            "Noir Classic": "Film look: Classic 1940s Film Noir, deep Venetian blind shadows, dramatic chiaroscuro contrast, authentic monochrome celluloid texture",
            "Action": "Film look: High-octane blockbuster action movie style, intense dynamic contrast, kinetic visual texture, subtle motion blur, anamorphic lens flare, gritty grading",
            "Horror": "Film look: Dark horror movie aesthetic, eerie desaturated tones, deep unsettling shadows, volumetric mist, creepy suspenseful atmosphere, tense dark grading",
            "Comedy": "Film look: Bright vibrant comedy film aesthetic, warm high-key lighting, crisp framing, vivid colors, playful cinematic atmosphere",
            "Epic": "Film look: Grand cinematic epic scale, IMAX 70mm aesthetic, sweeping majestic lighting, rich volumetric haze, breathtaking wide scope, dramatic heroic contrast",
            "Drama": "Film look: Intimate prestige drama cinema style, soft naturalistic lighting, subtle film grain, emotional shallow focus, realistic nuanced palette, character-focused mood",
            "Vintage Super 8": "Film look: Vintage Super 8mm retro film stock, warm nostalgic tones, charming film grain, subtle light leaks, retro 1970s color palette",
            "Anime Style": "Film look: High-end Makoto Shinkai anime aesthetic, lush vibrant lighting, painterly background textures, beautiful particle effects",
            "Hyperrealistic 8k": "Film look: Hyperrealistic 8k digital cinematography, razor-sharp details, lifelike micro-textures, photorealistic rendering"
        }

        style_elements = []
        if film_setup in film_descriptions:
            style_elements.append(film_descriptions[film_setup])
        elif film_setup != "Auto":
            style_elements.append(f"Film setup: {film_setup}")

        if camera != "Auto": style_elements.append(f"Camera motion: {camera}")
        if color_palette != "Auto": style_elements.append(f"Palette: {color_palette}")
        if lighting != "Auto": style_elements.append(f"Lighting: {lighting}")

        enhanced_prompt = prompt
        if style_elements:
            enhanced_prompt = f"{prompt}\n\n" + ". ".join(style_elements)

        video_path = None
        images_tensor = None

        if "Image" in mode:
            # Image generation (Krea 2 Turbo / Z-Image Turbo)
            api_key = krea_api_key or z_image_api_key
            if "Krea" in mode:
                client = KreaClient(api_key=api_key)
                img_prefix = "Krea2_Turbo"
                tag_prefix = "krea2"
            else:
                client = ZImageClient(api_key=api_key)
                img_prefix = "Z_Image_Turbo"
                tag_prefix = "zimage"

            pil_images = client.generate_image(
                prompt=enhanced_prompt,
                negative_prompt=negative_prompt,
                width=w,
                height=h,
                style=film_setup,
                num_images=variations
            )
            tensor_list = []
            ref_dir = os.path.join(folder_paths.get_input_directory(), "woxcinema")
            os.makedirs(ref_dir, exist_ok=True)
            meta_path = os.path.join(ref_dir, "metadata.json")
            meta = {}
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except Exception:
                    pass

            for i, img in enumerate(pil_images):
                np_img = np.array(img).astype(np.float32) / 255.0
                tensor_list.append(torch.from_numpy(np_img))
                try:
                    img_fn = f"{img_prefix}_{int(time.time())}_{i+1}.png"
                    img_out_path = os.path.join(WOX_OUTPUT_DIR, img_fn)
                    img.save(img_out_path)
                    
                    # Copia in input/woxcinema per renderla subito disponibile come Reference
                    ref_copy_path = os.path.join(ref_dir, img_fn)
                    img.save(ref_copy_path)
                    
                    clean_tag = f"@{tag_prefix}_{int(time.time())}_{i+1}"
                    meta[img_fn] = {
                        "tag": clean_tag,
                        "original_name": img_fn,
                        "time": time.time(),
                        "category": "Generations",
                        "prompt": prompt
                    }
                    with open(meta_path, "w", encoding="utf-8") as f:
                        json.dump(meta, f, indent=2, ensure_ascii=False)
                        
                    PromptServer.instance.send_sync("wox_cinema_image_generated", {
                        "image_path": img_out_path,
                        "filename": img_fn,
                        "subfolder": "wox_cinema",
                        "url": f"/view?filename={img_fn}&subfolder=woxcinema&type=input",
                        "tag": clean_tag,
                        "prompt": prompt
                    })
                except Exception as save_err:
                    logger.warning(f"Errore salvataggio immagine generata: {save_err}")

            images_tensor = torch.stack(tensor_list, dim=0) if tensor_list else torch.zeros((1, h, w, 3), dtype=torch.float32)
            video_files = ([],)
        elif "Upscale" in mode:
            # Video Upscale Mode
            target_source = reference_video if reference_video is not None else reference_image
            if target_source is not None and isinstance(target_source, torch.Tensor):
                raw_frames = target_source.shape[0]
                logger.info(f"WOXCinemaStudio: Upscaling video tensor {raw_frames} frames to {w}x{h}...")
                chunk_size = 16
                out_chunks = []
                for i in range(0, raw_frames, chunk_size):
                    batch = target_source[i:i + chunk_size]
                    b_perm = batch[..., :3].permute(0, 3, 1, 2).contiguous()
                    up = F.interpolate(b_perm, size=(h, w), mode="bicubic", align_corners=False)
                    out_chunks.append(up.permute(0, 2, 3, 1).clamp(0.0, 1.0))
                images_tensor = torch.cat(out_chunks, dim=0)
            else:
                images_tensor = torch.zeros((1, h, w, 3), dtype=torch.float32)
            video_files = ([],)
        else:
            # Minimax H3 Video generation (Local ComfyUI native pipeline handles generation when offline/local)
            if minimax_api_key and minimax_api_key.strip():
                client = MinimaxClient(api_key=minimax_api_key)
                video_path = client.generate_video(
                    prompt=enhanced_prompt,
                    model="video-01",
                    camera=camera,
                    lighting=lighting,
                    duration=duration,
                    aspect_ratio=aspect_ratio,
                    output_dir=WOX_OUTPUT_DIR
                )
                
                # Read all frames from video into images tensor (N, H, W, 3)
                frames_list = []
                try:
                    import cv2
                    cap = cv2.VideoCapture(video_path)
                    while True:
                        ret, frame = cap.read()
                        if not ret:
                            break
                        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
                        frames_list.append(torch.from_numpy(frame_rgb))
                    cap.release()
                except Exception as e:
                    logger.warning(f"Failed to read frames from video: {e}")

                if frames_list:
                    images_tensor = torch.stack(frames_list, dim=0)
                else:
                    images_tensor = torch.zeros((1, h, w, 3), dtype=torch.float32)

                video_files = ([video_path],)

                try:
                    PromptServer.instance.send_sync("wox_cinema_video_generated", {
                        "video_path": video_path,
                        "filename": os.path.basename(video_path),
                        "prompt": prompt
                    })
                except Exception:
                    pass
            else:
                images_tensor = torch.zeros((1, h, w, 3), dtype=torch.float32)
                video_files = ([],)

        return (images_tensor, video_files, enhanced_prompt)


# ==============================================================================
# Server API Routes for WOX Cinema Studio
# ==============================================================================
try:
    if hasattr(PromptServer, "instance") and PromptServer.instance is not None:
        routes = PromptServer.instance.routes

        @routes.get("/wox_cinema/recent_videos")
        @routes.get("/api/wox_cinema/recent_videos")
        async def get_recent_videos(request):
            """Restituisce gli ultimi video generati prendendoli direttamente da output/video."""
            out_dir = folder_paths.get_output_directory()
            
            # Apertura cartella se richiesta via query param
            if request.query.get("open_folder") == "1" or request.query.get("action") == "open_folder":
                video_dir = os.path.join(out_dir, "video")
                target = video_dir if os.path.exists(video_dir) else out_dir
                import subprocess
                import sys
                try:
                    if os.name == 'nt':
                        subprocess.Popen(f'explorer "{os.path.normpath(target)}"', shell=True)
                    elif sys.platform == 'darwin':
                        subprocess.Popen(['open', target])
                    else:
                        subprocess.Popen(['xdg-open', target])
                    return web.json_response({"success": True, "path": target})
                except Exception as e:
                    return web.json_response({"success": False, "error": str(e)})

            video_dir = os.path.join(out_dir, "video")
            wox_dir = os.path.join(out_dir, "wox_cinema")
            
            target_dirs = []
            if os.path.exists(video_dir):
                target_dirs.append((video_dir, "video"))
            if os.path.exists(wox_dir):
                target_dirs.append((wox_dir, "wox_cinema"))
            target_dirs.append((out_dir, ""))
            
            vids = []
            seen_files = set()
            valid_exts = (".mp4", ".webm", ".mov", ".mkv", ".gif")
            
            for d_path, subf in target_dirs:
                if not os.path.exists(d_path):
                    continue
                for f in os.listdir(d_path):
                    if f.lower() in seen_files:
                        continue
                    if f.lower().endswith(valid_exts):
                        fp = os.path.join(d_path, f)
                        if os.path.isfile(fp) and os.path.getsize(fp) > 1024:
                            seen_files.add(f.lower())
                            vids.append({
                                "filename": f,
                                "subfolder": subf,
                                "time": os.path.getmtime(fp),
                                "size": os.path.getsize(fp)
                            })

            # Ordina per data decrescente (i più recenti per primi)
            vids.sort(key=lambda x: x["time"], reverse=True)

            recent = []
            for i, v in enumerate(vids[:10]):
                sub = f"&subfolder={v['subfolder']}" if v['subfolder'] else ""
                url = f"/view?filename={v['filename']}{sub}&type=output"
                tag = "MiniMax H3 Video" if "minimax" in v['filename'].lower() else "WOX Video • MP4"
                recent.append({
                    "id": i + 1,
                    "filename": v["filename"],
                    "url": url,
                    "name": v["filename"],
                    "tag": tag,
                    "time": v["time"]
                })

            return web.json_response({
                "recent_videos": recent,
                "total_found": len(recent)
            })

        @routes.get("/wox_cinema/view_video")
        async def view_video(request):
            out_dir = folder_paths.get_output_directory()
            
            # Se richiesta apertura cartella
            if request.query.get("open_folder") == "1" or request.query.get("action") == "open_folder":
                video_dir = os.path.join(out_dir, "video")
                target = video_dir if os.path.exists(video_dir) else out_dir
                import subprocess
                import sys
                try:
                    if os.name == 'nt':
                        subprocess.Popen(['explorer', os.path.normpath(target)])
                    elif sys.platform == 'darwin':
                        subprocess.Popen(['open', target])
                    else:
                        subprocess.Popen(['xdg-open', target])
                    return web.json_response({"success": True, "path": target})
                except Exception as e:
                    return web.json_response({"success": False, "error": str(e)})

            file_param = request.query.get("file", "")
            safe_path = os.path.abspath(os.path.join(out_dir, file_param))
            if not safe_path.startswith(os.path.abspath(out_dir)) or not os.path.exists(safe_path):
                return web.Response(status=404, text="Video non trovato")
            
            return web.FileResponse(safe_path)

        @routes.get("/wox_cinema/open_output_folder")
        @routes.post("/wox_cinema/open_output_folder")
        @routes.get("/api/wox_cinema/open_output_folder")
        @routes.post("/api/wox_cinema/open_output_folder")
        async def open_output_folder(request):
            """Apre la cartella dei video output in Esplora Risorse di Windows."""
            try:
                out_dir = folder_paths.get_output_directory()
                video_dir = os.path.join(out_dir, "video")
                target = video_dir if os.path.exists(video_dir) else out_dir
                
                import subprocess
                import sys
                if os.name == 'nt':
                    subprocess.Popen(f'explorer "{os.path.normpath(target)}"', shell=True)
                elif sys.platform == 'darwin':
                    subprocess.Popen(['open', target])
                else:
                    subprocess.Popen(['xdg-open', target])
                return web.json_response({"success": True, "path": target})
            except Exception as e:
                logger.error(f"Errore apertura cartella output: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/export_montage")
        @routes.get("/wox_cinema/export_montage")
        @routes.post("/api/wox_cinema/export_montage")
        @routes.get("/api/wox_cinema/export_montage")
        async def export_montage(request):
            """Unisce / concatena i video della timeline in un unico video finale in output/video."""
            try:
                clips = []
                if request.method == "POST":
                    try:
                        data = await request.json()
                        clips = data.get("clips", [])
                    except:
                        pass
                if not clips:
                    clips_param = request.query.get("clips")
                    if clips_param:
                        import json
                        try:
                            clips = json.loads(clips_param)
                        except:
                            pass

                if not clips or len(clips) == 0:
                    return web.json_response({"success": False, "error": "Nessuna clip presente nella timeline"}, status=400)

                out_dir = folder_paths.get_output_directory()
                video_dir = os.path.join(out_dir, "video")
                os.makedirs(video_dir, exist_ok=True)

                # Trova i percorsi fisici dei file sorgente e parametri di trim (taglio)
                input_files = []
                ref_dir = os.path.join(folder_paths.get_input_directory(), "woxcinema")
                for c in clips:
                    fn = c.get("filename", "")
                    url = c.get("url", "")
                    found_path = None

                    # Strip "woxcinema/" prefix to get the bare filename
                    bare_fn = fn.replace("woxcinema/", "").lstrip("/") if fn else ""

                    if bare_fn:
                        for candidate in [
                            os.path.join(video_dir, bare_fn),
                            os.path.join(out_dir, bare_fn),
                            os.path.join(ref_dir, bare_fn),
                        ]:
                            if os.path.exists(candidate):
                                found_path = candidate
                                break

                    if not found_path and "filename=" in url:
                        import urllib.parse
                        parsed = urllib.parse.urlparse(url)
                        qs = urllib.parse.parse_qs(parsed.query)
                        if "filename" in qs and len(qs["filename"]) > 0:
                            q_fn = qs["filename"][0]
                            subf = qs.get("subfolder", [""])[0]
                            # /view with type=input → look in input_dir
                            if qs.get("type", [""])[0] == "input":
                                base = folder_paths.get_input_directory()
                            else:
                                base = out_dir
                            p_url = os.path.join(base, subf, q_fn)
                            if os.path.exists(p_url):
                                found_path = p_url

                    if found_path and os.path.exists(found_path):
                        start_offset = float(c.get("startOffset") or c.get("start_offset") or 0.0)
                        dur = float(c.get("duration") or 0.0)
                        input_files.append({
                            "path": found_path,
                            "startOffset": max(0.0, start_offset),
                            "duration": dur if dur > 0 else None
                        })

                if not input_files or len(input_files) == 0:
                    return web.json_response({"success": False, "error": "Nessun file sorgente valido trovato su disco"}, status=404)

                import subprocess
                import datetime
                import shutil

                try:
                    import imageio_ffmpeg
                    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
                except Exception:
                    ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"
                timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                out_filename = f"WOX_Montage_{timestamp_str}.mp4"
                final_out_path = os.path.join(video_dir, out_filename)

                # Pre-processing dei segmenti tagliati se necessario
                temp_segment_paths = []
                ready_file_paths = []

                for idx, item in enumerate(input_files):
                    fp = item["path"]
                    s_off = item["startOffset"]
                    c_dur = item["duration"]

                    # Verifica durata originale del file per capire se il file necessita di trim
                    needs_trim = (s_off > 0.02)
                    if not needs_trim and c_dur is not None and c_dur > 0:
                        try:
                            probe_proc = subprocess.run([ffmpeg_exe, "-i", fp], capture_output=True, text=True)
                            import re
                            m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", probe_proc.stderr)
                            if m:
                                h, m_, s = m.groups()
                                total_fp_dur = int(h) * 3600 + int(m_) * 60 + float(s)
                                if (total_fp_dur - c_dur) > 0.2:
                                    needs_trim = True
                            else:
                                needs_trim = True
                        except Exception:
                            needs_trim = True

                    if needs_trim:
                        temp_seg = os.path.join(video_dir, f"seg_{timestamp_str}_{idx}.mp4")
                        cut_cmd = [ffmpeg_exe, "-y", "-ss", f"{s_off:.3f}", "-i", fp]
                        if c_dur is not None and c_dur > 0:
                            cut_cmd.extend(["-t", f"{c_dur:.3f}"])
                        cut_cmd.extend([
                            "-c:v", "libx264",
                            "-preset", "veryfast",
                            "-pix_fmt", "yuv420p",
                            "-c:a", "aac",
                            temp_seg
                        ])
                        cut_res = subprocess.run(cut_cmd, capture_output=True, text=True)
                        if cut_res.returncode == 0 and os.path.exists(temp_seg) and os.path.getsize(temp_seg) > 50:
                            temp_segment_paths.append(temp_seg)
                            ready_file_paths.append(temp_seg)
                        else:
                            logger.error(f"[WOX Cinema] Errore taglio segmento {fp}: {cut_res.stderr}")
                            # Se il taglio con aac fallisce (es. video senza traccia audio), ritenta con -an
                            retry_cmd = [ffmpeg_exe, "-y", "-ss", f"{s_off:.3f}", "-i", fp]
                            if c_dur is not None and c_dur > 0:
                                retry_cmd.extend(["-t", f"{c_dur:.3f}"])
                            retry_cmd.extend([
                                "-c:v", "libx264",
                                "-preset", "veryfast",
                                "-pix_fmt", "yuv420p",
                                "-an",
                                temp_seg
                            ])
                            retry_res = subprocess.run(retry_cmd, capture_output=True, text=True)
                            if retry_res.returncode == 0 and os.path.exists(temp_seg) and os.path.getsize(temp_seg) > 50:
                                temp_segment_paths.append(temp_seg)
                                ready_file_paths.append(temp_seg)
                            else:
                                logger.error(f"[WOX Cinema] Fallito anche retry taglio: {retry_res.stderr}")
                                ready_file_paths.append(fp)
                    else:
                        ready_file_paths.append(fp)

                # Se c'è solo un segmento ed è già pronto, copialo direttamente
                if len(ready_file_paths) == 1:
                    shutil.copyfile(ready_file_paths[0], final_out_path)
                else:
                    # File temporaneo concat list
                    concat_txt_path = os.path.join(video_dir, f"concat_{timestamp_str}.txt")
                    with open(concat_txt_path, "w", encoding="utf-8") as txt_f:
                        for fp in ready_file_paths:
                            safe_fp = fp.replace("\\", "/")
                            txt_f.write(f"file '{safe_fp}'\n")

                    # Concat demuxer ultra-rapido
                    concat_cmd = [
                        ffmpeg_exe, "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_txt_path,
                        "-c", "copy",
                        final_out_path
                    ]
                    proc = subprocess.run(concat_cmd, capture_output=True, text=True)

                    if proc.returncode != 0 or not os.path.exists(final_out_path) or os.path.getsize(final_out_path) < 100:
                        # Fallback re-encode per compatibilità codec
                        v_filter = "".join([f"[{i}:v:0]" for i in range(len(ready_file_paths))])
                        v_only_cmd = [ffmpeg_exe, "-y"]
                        for fp in ready_file_paths:
                            v_only_cmd.extend(["-i", fp])
                        v_only_cmd.extend([
                            "-filter_complex", f"{v_filter}concat=n={len(ready_file_paths)}:v=1:a=0[outv]",
                            "-map", "[outv]",
                            "-c:v", "libx264",
                            "-pix_fmt", "yuv420p",
                            final_out_path
                        ])
                        subprocess.run(v_only_cmd, capture_output=True, text=True)

                    if os.path.exists(concat_txt_path):
                        try: os.remove(concat_txt_path)
                        except: pass

                for seg in temp_segment_paths:
                    if os.path.exists(seg):
                        try: os.remove(seg)
                        except: pass

                if os.path.exists(final_out_path) and os.path.getsize(final_out_path) > 0:
                    out_url = f"/view?filename={out_filename}&subfolder=video&type=output"
                    return web.json_response({
                        "success": True,
                        "filename": out_filename,
                        "url": out_url,
                        "path": final_out_path,
                        "size": os.path.getsize(final_out_path)
                    })
                else:
                    return web.json_response({"success": False, "error": "Errore durante il rendering del video montato"}, status=500)

            except Exception as e:
                logger.error(f"Errore export_montage: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        # ======================================================================
        # Reference Management Endpoints
        # ======================================================================
        # Gestione Reference Directory Esclusiva: input/woxcinema
        # ======================================================================
        def get_ref_dir():
            ref_dir = os.path.join(folder_paths.get_input_directory(), "woxcinema")
            os.makedirs(ref_dir, exist_ok=True)
            
            # Migrazione automatica da vecchia directory wox_references se esistente
            old_dir = os.path.join(folder_paths.get_input_directory(), "wox_references")
            if os.path.exists(old_dir):
                try:
                    for item in os.listdir(old_dir):
                        src = os.path.join(old_dir, item)
                        dst = os.path.join(ref_dir, item)
                        if not os.path.exists(dst):
                            import shutil
                            shutil.copy2(src, dst)
                except Exception as e:
                    logger.warning(f"Errore migrazione wox_references -> woxcinema: {e}")
                    
            return ref_dir

        def load_ref_metadata():
            meta_path = os.path.join(get_ref_dir(), "metadata.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        return json.load(f)
                except Exception:
                    pass
            return {}

        def save_ref_metadata(meta):
            meta_path = os.path.join(get_ref_dir(), "metadata.json")
            try:
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.warning(f"Failed to save reference metadata: {e}")

        def load_saved_prompts():
            f_path = os.path.join(get_ref_dir(), "saved_prompts.json")
            if os.path.exists(f_path):
                try:
                    with open(f_path, "r", encoding="utf-8") as fp:
                        data = json.load(fp)
                        if isinstance(data, list):
                            return data
                except Exception:
                    pass
            return []

        def save_saved_prompts(prompts_list):
            f_path = os.path.join(get_ref_dir(), "saved_prompts.json")
            try:
                with open(f_path, "w", encoding="utf-8") as fp:
                    json.dump(prompts_list, fp, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.warning(f"Failed to save saved_prompts: {e}")

        def get_ffmpeg_executable():
            # Trova l'eseguibile ffmpeg su qualsiasi macchina o ambiente virtuale ComfyUI
            try:
                import imageio_ffmpeg
                exe = imageio_ffmpeg.get_ffmpeg_exe()
                if exe and os.path.exists(exe):
                    return exe
            except Exception:
                pass
            import shutil
            sys_ffmpeg = shutil.which("ffmpeg")
            if sys_ffmpeg:
                return sys_ffmpeg
            # Fallback path comuni su Linux / Windows / Mac
            for cand in ["ffmpeg", "ffmpeg.exe", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe"]:
                if os.path.isfile(cand):
                    return os.path.abspath(cand)
            return None

        def ensure_video_thumb(filepath):
            if not filepath or not os.path.isfile(filepath):
                return None
            ref_dir = get_ref_dir()
            thumbs_dir = os.path.join(ref_dir, ".thumbs")
            os.makedirs(thumbs_dir, exist_ok=True)
            base = os.path.basename(filepath)
            thumb_path = os.path.join(thumbs_dir, f"{base}.jpg")
            if os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 100:
                return thumb_path

            # Metodo 1: PyAV (nativo in Python, non richiede binario ffmpeg esterno nel PATH di sistema)
            try:
                import av
                with av.open(filepath) as container:
                    stream = next((s for s in container.streams if s.type == 'video'), None)
                    if stream is not None:
                        for frame in container.decode(stream):
                            img = frame.to_image()
                            img.thumbnail((360, 360), Image.Resampling.LANCZOS)
                            img.convert("RGB").save(thumb_path, "JPEG", quality=85)
                            if os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 100:
                                return thumb_path
                            break
            except Exception as e:
                logger.debug(f"PyAV thumbnail extraction skipped for {filepath}: {e}")

            # Metodo 2: Eseguibile FFmpeg (da imageio_ffmpeg o PATH)
            ffmpeg_exe = get_ffmpeg_executable()
            if ffmpeg_exe:
                try:
                    import subprocess
                    subprocess.run(
                        [ffmpeg_exe, "-y", "-ss", "0.05", "-i", filepath,
                         "-frames:v", "1", "-q:v", "3", "-vf", "scale=360:-1", thumb_path],
                        capture_output=True, timeout=10
                    )
                    if os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 100:
                        return thumb_path
                except Exception as e:
                    logger.warning(f"Error generating thumbnail via ffmpeg for {filepath}: {e}")

            # Metodo 3: Placeholder grafico per non dare errore 404 e mostrare la card
            try:
                from PIL import ImageDraw
                ph = Image.new("RGB", (360, 202), color=(22, 26, 34))
                draw = ImageDraw.Draw(ph)
                draw.rectangle([(0, 0), (359, 201)], outline=(50, 60, 75), width=2)
                # Disegna icona play al centro
                draw.polygon([(165, 80), (165, 120), (205, 100)], fill=(212, 255, 50))
                ph.save(thumb_path, "JPEG", quality=80)
                return thumb_path
            except Exception:
                pass

            return None

        @routes.get("/wox_cinema/references")
        @routes.get("/api/wox_cinema/references")
        async def get_references(request):
            """Restituisce l'elenco delle reference e delle immagini generate (Generations)."""
            ref_dir = get_ref_dir()
            meta = load_ref_metadata()
            
            results = []
            seen_files = set()
            seen_tags = set()
            valid_exts = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".wav", ".mp3")
            meta_updated = False
            deleted_files = set(str(f).lower() for f in meta.get("_deleted_files", []))
            
            # 0. Includi i prompt salvati (categoria Prompts)
            saved_prompts = load_saved_prompts()
            for p in saved_prompts:
                p_id = p.get("id") or p.get("filename", "")
                if p_id.lower() in deleted_files or p.get("filename", "").lower() in deleted_files:
                    continue
                results.append({
                    "id": p.get("id"),
                    "filename": p.get("filename"),
                    "raw_filename": p.get("raw_filename"),
                    "tag": p.get("tag"),
                    "title": p.get("title") or (p.get("prompt", "")[:40]),
                    "url": p.get("thumb_url") or "",
                    "thumb_url": p.get("thumb_url") or "",
                    "media_type": "prompt",
                    "time": p.get("time", time.time()),
                    "size": len(p.get("prompt", "")),
                    "category": "Prompts",
                    "prompt": p.get("prompt", ""),
                    "references": p.get("references", []),
                    "film_setup": p.get("film_setup", "Auto"),
                    "camera": p.get("camera", "Auto"),
                    "color_palette": p.get("color_palette", "Auto"),
                    "lighting": p.get("lighting", "Auto"),
                    "mode": p.get("mode", "")
                })

            # 1. Scansiona input/woxcinema (Uploads e Generations già salvate)
            if os.path.exists(ref_dir):
                for f in sorted(os.listdir(ref_dir)):
                    if f.lower() == "metadata.json" or f.lower() in seen_files or f.lower() in deleted_files:
                        continue
                    if f.lower().endswith(valid_exts):
                        filepath = os.path.join(ref_dir, f)
                        if not os.path.isfile(filepath):
                            continue
                        mtime = os.path.getmtime(filepath)
                        size = os.path.getsize(filepath)
                        
                        clean_name = os.path.splitext(f)[0]
                        clean_tag = "@" + re.sub(r"[^a-zA-Z0-9_]", "_", clean_name.lower())
                        
                        item_meta = meta.get(f, {})
                        tag = item_meta.get("tag", clean_tag)
                        if not tag.startswith("@"):
                            tag = f"@{tag}"
                        
                        media_type = "image"
                        thumb_url = None
                        if f.lower().endswith((".mp4", ".webm", ".mov")):
                            media_type = "video"
                            ensure_video_thumb(filepath)
                            thumb_url = f"/wox_cinema/video_thumb?filename={f}"
                            # Ensure accessible in input root for VHS_LoadVideo / LoadVideo
                            input_root = folder_paths.get_input_directory()
                            input_dst = os.path.join(input_root, f)
                            if not os.path.exists(input_dst):
                                try:
                                    os.symlink(filepath, input_dst)
                                except Exception:
                                    try:
                                        import shutil
                                        shutil.copy2(filepath, input_dst)
                                    except Exception:
                                        pass
                        elif f.lower().endswith((".wav", ".mp3", ".ogg")):
                            media_type = "audio"
                            
                        seen_files.add(f.lower())
                        seen_tags.add(tag.lower())
                        category = item_meta.get("category")
                        if not category:
                            category = "Generations" if any(k in f.lower() for k in ("z_image", "zimage", "krea", "wox_cinema")) else "Uploads"
                            item_meta["category"] = category
                            meta[f] = item_meta
                            meta_updated = True

                        results.append({
                            "id": f,
                            "filename": f"woxcinema/{f}",
                            "raw_filename": f,
                            "tag": tag,
                            "url": f"/view?filename={f}&subfolder=woxcinema&type=input",
                            "thumb_url": thumb_url,
                            "media_type": media_type,
                            "time": mtime,
                            "size": size,
                            "category": category,
                            "prompt": item_meta.get("prompt", "")
                        })

            # 2. Scansiona anche output/ per importare automaticamente generazioni Z-Image Turbo, Krea 2, MiniMax Video e WOX Cinema
            out_dir = folder_paths.get_output_directory()
            target_dirs = [
                (os.path.join(out_dir, "wox_cinema"), "wox_cinema"),
                (os.path.join(out_dir, "video"), "video"),
                (os.path.join(out_dir, "z_image_turbo"), "z_image_turbo"),
                (os.path.join(out_dir, "krea2"), "krea2"),
                (out_dir, "")
            ]
            for d_path, subf in target_dirs:
                if not os.path.exists(d_path):
                    continue
                for f in os.listdir(d_path):
                    f_lower = f.lower()
                    if f_lower in seen_files or f_lower == "metadata.json" or f_lower in deleted_files or not f_lower.endswith(valid_exts):
                        continue
                    if f_lower.startswith(("z_image", "zimage", "krea2", "wox_cinema", "assets", "minimax", "wox_montage", "comfyui_")):
                        filepath = os.path.join(d_path, f)
                        if not os.path.isfile(filepath) or os.path.getsize(filepath) < 1024:
                            continue
                        mtime = os.path.getmtime(filepath)
                        size = os.path.getsize(filepath)
                        
                        # Copia in input/woxcinema così è usabile come Reference nativa da LoadImage
                        dst_path = os.path.join(ref_dir, f)
                        if not os.path.exists(dst_path):
                            try:
                                import shutil
                                shutil.copy2(filepath, dst_path)
                            except Exception:
                                pass
                        
                        clean_name = os.path.splitext(f)[0]
                        clean_tag = "@" + re.sub(r"[^a-zA-Z0-9_]", "_", clean_name.lower())
                        item_meta = meta.get(f, {})
                        tag = item_meta.get("tag", clean_tag)
                        if not tag.startswith("@"):
                            tag = f"@{tag}"
                            
                        item_meta["category"] = "Generations"
                        item_meta["tag"] = tag
                        item_meta["time"] = mtime
                        meta[f] = item_meta
                        meta_updated = True
                        seen_files.add(f_lower)
                        
                        is_vid = f_lower.endswith((".mp4", ".webm", ".mov"))
                        thumb_url = None
                        if is_vid:
                            src_file = dst_path if os.path.exists(dst_path) else filepath
                            ensure_video_thumb(src_file)
                            thumb_url = f"/wox_cinema/video_thumb?filename={f}"
                            input_root = folder_paths.get_input_directory()
                            input_dst = os.path.join(input_root, f)
                            if not os.path.exists(input_dst):
                                try:
                                    os.symlink(src_file, input_dst)
                                except Exception:
                                    pass

                        results.append({
                            "id": f,
                            "filename": f"woxcinema/{f}",
                            "raw_filename": f,
                            "tag": tag,
                            "url": f"/view?filename={f}&subfolder=woxcinema&type=input",
                            "thumb_url": thumb_url,
                            "media_type": "video" if is_vid else "image",
                            "time": mtime,
                            "size": size,
                            "category": "Generations",
                            "prompt": item_meta.get("prompt", "")
                        })

            if meta_updated:
                save_ref_metadata(meta)
                        
            # Ordina per data decrescente (i più recenti in alto)
            results.sort(key=lambda x: x["time"], reverse=True)
            return web.json_response({"references": results})

        @routes.get("/wox_cinema/video_thumb")
        @routes.get("/api/wox_cinema/video_thumb")
        @routes.post("/wox_cinema/create_video_thumb")
        async def get_video_thumb(request):
            """Restituisce il thumbnail JPEG del primo frame del video."""
            filename = request.rel_url.query.get("filename", "")
            if not filename and request.method == "POST":
                try:
                    body = await request.json()
                    filename = body.get("filename", "")
                except Exception:
                    pass
            if not filename:
                return web.Response(status=400)
            base = os.path.basename(filename)
            ref_dir = get_ref_dir()
            thumbs_dir = os.path.join(ref_dir, ".thumbs")
            thumb_path = os.path.join(thumbs_dir, f"{base}.jpg")
            if not (os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 100):
                filepath = os.path.join(ref_dir, base)
                if not os.path.isfile(filepath):
                    out_dir = folder_paths.get_output_directory()
                    for d in [os.path.join(out_dir, "wox_cinema"), os.path.join(out_dir, "video"), out_dir]:
                        cand = os.path.join(d, base)
                        if os.path.isfile(cand):
                            filepath = cand
                            break
                if os.path.isfile(filepath):
                    thumb_path = ensure_video_thumb(filepath)
            
            if thumb_path and os.path.isfile(thumb_path):
                return web.FileResponse(thumb_path, headers={"Cache-Control": "public, max-age=86400"})
            return web.Response(status=404)

        @routes.get("/wox_cinema/video_info")
        @routes.get("/api/wox_cinema/video_info")
        @routes.post("/wox_cinema/video_info")
        @routes.post("/api/wox_cinema/video_info")
        async def get_video_info(request):
            """Restituisce metadati, risoluzione, fps, frame count e lunghezza H3 (17k+5) del video."""
            filename = request.rel_url.query.get("filename", "")
            if not filename and request.method == "POST":
                try:
                    body = await request.json()
                    filename = body.get("filename", "")
                except Exception:
                    pass
            if not filename:
                return web.json_response({"success": False, "error": "Parametro filename mancante"})
            
            base = os.path.basename(filename)
            ref_dir = get_ref_dir()
            out_dir = folder_paths.get_output_directory()
            in_dir = folder_paths.get_input_directory()
            
            filepath = None
            for d in [ref_dir, in_dir, os.path.join(out_dir, "wox_cinema"), os.path.join(out_dir, "video"), out_dir]:
                cand = os.path.join(d, base)
                if os.path.isfile(cand):
                    filepath = cand
                    break
            
            if not filepath:
                if os.path.isfile(filename):
                    filepath = filename
            
            if not filepath or not os.path.isfile(filepath):
                return web.json_response({"success": False, "error": "File video non trovato", "filename": filename})
            
            w, h, fps, frame_count = 1280, 720, 24.0, 124
            try:
                import cv2
                cap = cv2.VideoCapture(filepath)
                if cap.isOpened():
                    cfps = cap.get(cv2.CAP_PROP_FPS)
                    if cfps and cfps > 0:
                        fps = float(cfps)
                    cframes = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                    if cframes and cframes > 0:
                        frame_count = int(cframes)
                    cw = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
                    if cw and cw > 0:
                        w = int(cw)
                    ch = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
                    if ch and ch > 0:
                        h = int(ch)
                    cap.release()
            except Exception as e:
                logger.warning(f"Errore lettura video con cv2: {e}")
            
            import math
            if frame_count <= 5:
                h3_length = 5
            else:
                h3_length = int(math.ceil((frame_count - 5) / 17.0) * 17 + 5)
            
            duration = round(frame_count / fps, 3) if fps > 0 else 0.0

            return web.json_response({
                "success": True,
                "filename": base,
                "filepath": filepath,
                "width": w,
                "height": h,
                "fps": round(fps, 2),
                "frame_count": frame_count,
                "duration": duration,
                "h3_length": h3_length,
                "h3_aligned_length": h3_length
            })

        @routes.get("/wox_cinema/recent_images")
        @routes.get("/api/wox_cinema/recent_images")
        async def get_recent_images(request):
            """Restituisce le ultime immagini generate in output/ o woxcinema."""
            out_dir = folder_paths.get_output_directory()
            target_dirs = [
                (os.path.join(out_dir, "wox_cinema"), "wox_cinema"),
                (os.path.join(out_dir, "z_image_turbo"), "z_image_turbo"),
                (os.path.join(out_dir, "krea2"), "krea2"),
                (out_dir, "")
            ]
            imgs = []
            seen_files = set()
            valid_exts = (".png", ".jpg", ".jpeg", ".webp")
            meta = load_ref_metadata()
            deleted_files = set(str(f).lower() for f in meta.get("_deleted_files", []))
            
            for d_path, subf in target_dirs:
                if not os.path.exists(d_path):
                    continue
                for f in os.listdir(d_path):
                    f_lower = f.lower()
                    if f_lower in seen_files or f_lower in deleted_files or not f_lower.endswith(valid_exts):
                        continue
                    if f_lower.startswith(("z_image", "zimage", "krea2", "wox_cinema", "assets", "comfyui")):
                        fp = os.path.join(d_path, f)
                        if os.path.isfile(fp) and os.path.getsize(fp) > 1024:
                            seen_files.add(f_lower)
                            imgs.append({
                                "filename": f,
                                "subfolder": subf,
                                "time": os.path.getmtime(fp),
                                "size": os.path.getsize(fp)
                            })
                            
            imgs.sort(key=lambda x: x["time"], reverse=True)
            
            recent = []
            for i, item in enumerate(imgs[:20]):
                sub = f"&subfolder={item['subfolder']}" if item['subfolder'] else ""
                url = f"/view?filename={item['filename']}{sub}&type=output"
                clean_tag = "@" + re.sub(r"[^a-zA-Z0-9_]", "_", os.path.splitext(item['filename'])[0].lower())
                recent.append({
                    "id": i + 1,
                    "filename": item["filename"],
                    "url": url,
                    "name": item["filename"],
                    "tag": clean_tag,
                    "media_type": "image",
                    "time": item["time"]
                })
                
            return web.json_response({
                "recent_images": recent,
                "total_found": len(recent)
            })

        @routes.post("/wox_cinema/register_generation")
        @routes.post("/api/wox_cinema/register_generation")
        async def register_generation_route(request):
            """Registra un'immagine appena generata come Reference nella categoria Generations."""
            try:
                data = await request.json()
                filename = data.get("filename", "")
                subfolder = data.get("subfolder", "")
                prompt = data.get("prompt", "")
                
                if not filename:
                    return web.json_response({"success": False, "error": "filename required"}, status=400)
                    
                out_dir = folder_paths.get_output_directory()
                src_path = os.path.join(out_dir, subfolder, filename) if subfolder else os.path.join(out_dir, filename)
                if not os.path.exists(src_path):
                    if os.path.exists(os.path.join(out_dir, filename)):
                        src_path = os.path.join(out_dir, filename)
                    elif os.path.exists(os.path.join(out_dir, "wox_cinema", filename)):
                        src_path = os.path.join(out_dir, "wox_cinema", filename)
                        
                ref_dir = get_ref_dir()
                dst_path = os.path.join(ref_dir, filename)
                
                if os.path.exists(src_path):
                    import shutil
                    if not os.path.exists(dst_path):
                        shutil.copy2(src_path, dst_path)
                
                clean_tag = "@" + re.sub(r"[^a-zA-Z0-9_]", "_", os.path.splitext(filename)[0].lower())
                meta = load_ref_metadata()
                # Rimuovi dai file cancellati se era stato segnato come cancellato in precedenza
                if "_deleted_files" in meta and isinstance(meta["_deleted_files"], list):
                    fn_lowers = {filename.lower(), f"woxcinema/{filename.lower()}", os.path.basename(filename).lower()}
                    meta["_deleted_files"] = [x for x in meta["_deleted_files"] if str(x).lower() not in fn_lowers]
                meta[filename] = {
                    "tag": clean_tag,
                    "original_name": filename,
                    "time": time.time(),
                    "category": "Generations",
                    "prompt": prompt
                }
                save_ref_metadata(meta)
                
                return web.json_response({
                    "success": True,
                    "reference": {
                        "id": filename,
                        "filename": f"woxcinema/{filename}",
                        "raw_filename": filename,
                        "tag": clean_tag,
                        "url": f"/view?filename={filename}&subfolder=woxcinema&type=input",
                        "media_type": "video" if filename.lower().endswith((".mp4", ".webm", ".mov", ".mkv")) else "image",
                        "time": time.time(),
                        "size": os.path.getsize(dst_path) if os.path.exists(dst_path) else 0,
                        "category": "Generations",
                        "prompt": prompt
                    }
                })
            except Exception as e:
                logger.error(f"Errore register_generation: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/save_prompt")
        @routes.post("/api/wox_cinema/save_prompt")
        async def save_prompt_route(request):
            """Salva un prompt completo con relative reference (immagini e video) nella Media Gallery."""
            try:
                data = await request.json()
                prompt_text = (data.get("prompt") or "").strip()
                if not prompt_text:
                    return web.json_response({"success": False, "error": "Prompt non può essere vuoto"}, status=400)
                
                prompts = load_saved_prompts()
                prompt_id = f"prompt_{int(time.time())}_{len(prompts)+1}"
                
                thumb_url = data.get("thumb_url") or ""
                if not thumb_url:
                    thumb_url = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='202' viewBox='0 0 360 202'><rect width='100%' height='100%' fill='%230f141f'/><rect x='8' y='8' width='344' height='186' rx='8' fill='%23181f2f' stroke='%2338bdf8' stroke-width='2' stroke-dasharray='4'/><text x='180' y='95' fill='%2338bdf8' font-size='32' text-anchor='middle' font-family='sans-serif'>🎬</text><text x='180' y='130' fill='%23e2e8f0' font-size='15' font-weight='bold' text-anchor='middle' font-family='sans-serif'>PROMPT SALVATO</text></svg>"
                
                entry = {
                    "id": prompt_id,
                    "filename": f"{prompt_id}.json",
                    "raw_filename": f"{prompt_id}.json",
                    "tag": f"@{prompt_id}",
                    "title": data.get("title") or prompt_text[:40],
                    "prompt": prompt_text,
                    "references": data.get("references", []),
                    "thumb_url": thumb_url,
                    "media_type": "prompt",
                    "category": "Prompts",
                    "film_setup": data.get("film_setup", "Auto"),
                    "camera": data.get("camera", "Auto"),
                    "color_palette": data.get("color_palette", "Auto"),
                    "lighting": data.get("lighting", "Auto"),
                    "mode": data.get("mode", ""),
                    "time": time.time()
                }
                
                prompts.insert(0, entry)
                save_saved_prompts(prompts)
                
                logger.info(f"WOX Cinema: Salvato prompt {prompt_id} con {len(entry['references'])} reference")
                return web.json_response({"success": True, "prompt": entry})
            except Exception as e:
                logger.error(f"Errore save_prompt_route: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.get("/wox_cinema/saved_prompts")
        @routes.get("/api/wox_cinema/saved_prompts")
        async def get_saved_prompts_route(request):
            """Restituisce l'elenco dei prompt salvati."""
            prompts = load_saved_prompts()
            return web.json_response({"prompts": prompts})

        @routes.post("/wox_cinema/prepare_edit_input")
        @routes.post("/api/wox_cinema/prepare_edit_input")
        async def prepare_edit_input_route(request):
            """Prepara un'immagine per Qwen-Image-Edit copiandola nella cartella input/ di ComfyUI."""
            try:
                data = await request.json()
                filename = data.get("filename", "")
                url = data.get("url", "")
                
                input_dir = folder_paths.get_input_directory()
                out_dir = folder_paths.get_output_directory()
                
                clean_name = os.path.basename(filename) if filename else ""
                if not clean_name and url:
                    import urllib.parse
                    parsed = urllib.parse.urlparse(url)
                    qs = urllib.parse.parse_qs(parsed.query)
                    if "filename" in qs:
                        clean_name = qs["filename"][0]
                    else:
                        clean_name = os.path.basename(parsed.path)
                
                if not clean_name:
                    clean_name = f"edit_input_{int(time.time())}.png"
                
                src_path = None
                candidates = [
                    os.path.join(input_dir, clean_name),
                    os.path.join(input_dir, "woxcinema", clean_name),
                    os.path.join(out_dir, clean_name),
                    os.path.join(out_dir, "wox_cinema", clean_name),
                    os.path.join(out_dir, "z_image_turbo", clean_name),
                ]
                if filename and os.path.isabs(filename) and os.path.exists(filename):
                    src_path = filename
                else:
                    for cand in candidates:
                        if os.path.exists(cand):
                            src_path = cand
                            break
                            
                target_filename = f"qwen_edit_source_{int(time.time())}.png"
                dst_path = os.path.join(input_dir, target_filename)
                
                import shutil
                if src_path and os.path.exists(src_path):
                    shutil.copy2(src_path, dst_path)
                else:
                    if clean_name:
                        for r, d, fs in os.walk(input_dir):
                            if clean_name in fs:
                                src_path = os.path.join(r, clean_name)
                                shutil.copy2(src_path, dst_path)
                                break
                        if not os.path.exists(dst_path):
                            for r, d, fs in os.walk(out_dir):
                                if clean_name in fs:
                                    src_path = os.path.join(r, clean_name)
                                    shutil.copy2(src_path, dst_path)
                                    break
                
                final_name = target_filename if os.path.exists(dst_path) else clean_name
                return web.json_response({
                    "success": True,
                    "input_filename": final_name,
                    "src_path": src_path
                })
            except Exception as e:
                logger.error(f"Errore prepare_edit_input: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/capture_frame")
        @routes.post("/api/wox_cinema/capture_frame")
        async def capture_frame(request):
            """Salva un fotogramma JPEG inviato dal browser in input/woxcinema/ con categoria Generations."""
            try:
                ref_dir = get_ref_dir()
                meta = load_ref_metadata()
                reader = await request.multipart()
                result = None
                source_tag = ""
                while True:
                    field = await reader.next()
                    if field is None:
                        break
                    if field.name == "source_tag":
                        source_tag = (await field.read()).decode("utf-8", errors="ignore").strip()
                    elif field.name == "frame":
                        content_bytes = await field.read()
                        src_name = re.sub(r"[^a-zA-Z0-9_]", "_", source_tag.lstrip("@")) if source_tag else "frame"
                        ts = int(time.time() * 1000)
                        safe_fn = f"frame_{src_name}_{ts}.jpg"
                        filepath = os.path.join(ref_dir, safe_fn)
                        with open(filepath, "wb") as f:
                            f.write(content_bytes)
                        clean_tag = "@frame_" + re.sub(r"[^a-zA-Z0-9_]", "_", src_name.lower()) + f"_{ts % 100000}"
                        meta[safe_fn] = {
                            "tag": clean_tag,
                            "original_name": safe_fn,
                            "time": time.time(),
                            "category": "Generations"
                        }
                        result = {
                            "filename": f"woxcinema/{safe_fn}",
                            "raw_filename": safe_fn,
                            "tag": clean_tag,
                            "url": f"/view?filename={safe_fn}&subfolder=woxcinema&type=input"
                        }
                if result is None:
                    return web.json_response({"success": False, "error": "Nessun fotogramma ricevuto"}, status=400)
                save_ref_metadata(meta)
                return web.json_response({"success": True, **result})
            except Exception as e:
                logger.error(f"Errore capture_frame: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/references/upload")
        @routes.post("/api/wox_cinema/references/upload")
        async def upload_reference(request):
            """Carica una nuova reference ESCLUSIVAMENTE dentro woxcinema."""
            ref_dir = get_ref_dir()
            meta = load_ref_metadata()
            
            reader = await request.multipart()
            uploaded = []
            
            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name in ("image", "file", "media"):
                    filename = field.filename
                    if not filename:
                        continue
                    
                    base, ext = os.path.splitext(filename)
                    safe_base = re.sub(r"[^a-zA-Z0-9_\-]", "_", base)
                    clean_tag = "@" + re.sub(r"[^a-zA-Z0-9_]", "_", safe_base.lower())
                    existing_tags = {v.get("tag") for k, v in meta.items() if isinstance(v, dict)}
                    unique_tag = clean_tag
                    counter = 1
                    while unique_tag in existing_tags:
                        unique_tag = f"{clean_tag}_{counter}"
                        counter += 1
                    clean_tag = unique_tag
                    safe_filename = f"{safe_base}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}{ext}"
                    filepath = os.path.join(ref_dir, safe_filename)
                    
                    file_content = bytearray()
                    while True:
                        chunk = await field.read_chunk()
                        if not chunk:
                            break
                        file_content.extend(chunk)
                        
                    with open(filepath, "wb") as f:
                        f.write(file_content)
                            
                    if ext.lower() in (".mp4", ".webm", ".mov", ".mkv"):
                        ensure_video_thumb(filepath)
                        input_root = folder_paths.get_input_directory()
                        input_dst = os.path.join(input_root, safe_filename)
                        if not os.path.exists(input_dst):
                            try:
                                os.symlink(filepath, input_dst)
                            except Exception:
                                pass

                    if "_deleted_files" in meta and isinstance(meta["_deleted_files"], list):
                        fn_lowers = {safe_filename.lower(), f"woxcinema/{safe_filename.lower()}", filename.lower()}
                        meta["_deleted_files"] = [x for x in meta["_deleted_files"] if str(x).lower() not in fn_lowers]

                    meta[safe_filename] = {
                        "tag": clean_tag,
                        "original_name": filename,
                        "time": time.time(),
                        "category": "Uploads"
                    }
                    uploaded.append({
                        "filename": f"woxcinema/{safe_filename}",
                        "raw_filename": safe_filename,
                        "tag": clean_tag,
                        "url": f"/view?filename={safe_filename}&subfolder=woxcinema&type=input"
                    })
                    
            save_ref_metadata(meta)
            return web.json_response({"success": True, "uploaded": uploaded})

        @routes.post("/wox_cinema/references/update_tag")
        @routes.post("/api/wox_cinema/references/update_tag")
        async def update_reference_tag(request):
            """Aggiorna il tag associato a una reference."""
            try:
                data = await request.json()
                filename = data.get("filename")
                tag = data.get("tag", "").strip()
                if not tag.startswith("@"):
                    tag = f"@{tag}"
                tag = re.sub(r"[^a-zA-Z0-9_@]", "_", tag)
                
                meta = load_ref_metadata()
                if filename not in meta:
                    meta[filename] = {}
                meta[filename]["tag"] = tag
                save_ref_metadata(meta)
                return web.json_response({"success": True, "tag": tag})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=400)

        @routes.post("/wox_cinema/enhance_prompt")
        @routes.post("/api/wox_cinema/enhance_prompt")
        async def enhance_prompt_route(request):
            """Migliora e traduce il prompt in inglese cinematografico via LLM / Ollama."""
            try:
                data = await request.json()
                raw_prompt = data.get("prompt", "").strip()
                film_setup = data.get("film_setup", "Auto")
                
                if not raw_prompt:
                    return web.json_response({"success": True, "enhanced_prompt": ""})
                
                enhanced = None
                system_instruction = (
                    "You are a master Hollywood director and cinematographer. "
                    "Translate the user's prompt to vivid, professional English (if not already in English), "
                    "and enrich it with cinematic visual details, camera perspective, lighting, mood, and atmosphere. "
                    "CRITICAL: Keep any reference tags like @person or <Picture 1> intact and in place. "
                    "Do NOT add conversational fluff, intro, outro, or quotes. Output ONLY the improved cinematic prompt."
                )
                
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    model_to_use = None
                    try:
                        async with session.get("http://127.0.0.1:11434/api/tags", timeout=aiohttp.ClientTimeout(total=3)) as tag_res:
                            if tag_res.status == 200:
                                tags_data = await tag_res.json()
                                models_list = [m.get("name", "") for m in tags_data.get("models", [])]
                                preferred = ["qwen3.8:27b", "bonsai:latest", "qwen2.5:7b", "gemma4:26b", "qwen3-coder:latest"]
                                for p in preferred:
                                    if p in models_list:
                                        model_to_use = p
                                        break
                                if not model_to_use and models_list:
                                    for m in models_list:
                                        if "qwen" in m.lower() or "gemma" in m.lower() or "bonsai" in m.lower():
                                            model_to_use = m
                                            break
                                    if not model_to_use:
                                        model_to_use = models_list[0]
                    except Exception as tag_err:
                        logger.warning(f"Ollama tags lookup failed: {tag_err}")

                    if model_to_use:
                        try:
                            payload = {
                                "model": model_to_use,
                                "prompt": f"{system_instruction}\n\nUser Prompt: {raw_prompt}",
                                "stream": False,
                                "options": {
                                    "temperature": 0.7,
                                    "num_predict": 250
                                }
                            }
                            async with session.post("http://127.0.0.1:11434/api/generate", json=payload, timeout=aiohttp.ClientTimeout(total=20)) as gen_res:
                                if gen_res.status == 200:
                                    gen_data = await gen_res.json()
                                    res_text = gen_data.get("response", "").strip()
                                    if res_text:
                                        res_text = re.sub(r'<think>.*?</think>', '', res_text, flags=re.DOTALL).strip()
                                        res_text = re.sub(r'^["\']|["\']$', '', res_text).strip()
                                        if len(res_text) > 5:
                                            enhanced = res_text
                        except Exception as gen_err:
                            logger.warning(f"Ollama generation with {model_to_use} failed: {gen_err}")

                if not enhanced:
                    enhanced = raw_prompt
                    
                logger.info(f"WOX Cinema Prompt Enhanced: '{raw_prompt}' -> '{enhanced}'")
                return web.json_response({"success": True, "enhanced_prompt": enhanced})
            except Exception as e:
                logger.error(f"Error enhancing prompt: {e}")
                return web.json_response({"success": False, "enhanced_prompt": data.get("prompt", ""), "error": str(e)})

        @routes.post("/wox_cinema/describe_reference")
        @routes.post("/api/wox_cinema/describe_reference")
        async def describe_reference_route(request):
            """Analizza visivamente la reference image e genera una descrizione cinematografica intelligente con AI per il template."""
            try:
                data = await request.json()
                filename = data.get("filename", "")
                role = data.get("role", "Reference Stile")
                current_prompt = data.get("current_prompt", "")
                clean_fn = os.path.basename(filename)

                if not clean_fn:
                    return web.json_response({"success": False, "error": "Nome file reference non specificato"}, status=400)

                # Trova il file su disco
                ref_dir = get_ref_dir()
                input_dir = folder_paths.get_input_directory()
                output_dir = folder_paths.get_output_directory()
                
                candidate_paths = [
                    os.path.join(ref_dir, clean_fn),
                    os.path.join(input_dir, clean_fn),
                    os.path.join(output_dir, "wox_cinema", clean_fn),
                    os.path.join(output_dir, clean_fn)
                ]
                filepath = None
                for cp in candidate_paths:
                    if os.path.exists(cp) and os.path.isfile(cp):
                        filepath = cp
                        break

                meta = load_ref_metadata()
                meta_item = meta.get(clean_fn, {})
                embedded_prompt = meta_item.get("prompt", "")

                # Analisi visiva con PIL
                brightness = 120
                sat = 0.4
                temp_desc = "natural balanced studio"
                contrast_desc = "clean photographic tonal gradation"
                
                if filepath:
                    try:
                        from PIL import Image, ImageStat
                        import numpy as np

                        img = Image.open(filepath)
                        # Estrai eventuale prompt incorporato nei metadati PNG ComfyUI
                        if not embedded_prompt and "prompt" in img.info:
                            try:
                                p_data = json.loads(img.info["prompt"])
                                for node_id, node_val in p_data.items():
                                    inputs = node_val.get("inputs", {})
                                    for k, v in inputs.items():
                                        if isinstance(v, str) and len(v) > 20 and not v.endswith(".safetensors"):
                                            if "negative" not in k.lower():
                                                embedded_prompt = v
                                                break
                            except Exception:
                                pass

                        rgb = img.convert("RGB")
                        stat = ImageStat.Stat(rgb)
                        mr, mg, mb = stat.mean[:3]
                        brightness = (mr * 299 + mg * 587 + mb * 114) / 1000

                        small = rgb.resize((32, 32))
                        arr = np.array(small, dtype=float)
                        r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
                        max_c = np.maximum(np.maximum(r, g), b)
                        min_c = np.minimum(np.minimum(r, g), b)
                        delta = max_c - min_c
                        non_zero = max_c > 0
                        sat = float(np.mean(np.where(non_zero, delta / (max_c + 1e-6), 0)))

                        mr_pix = np.mean(r)
                        mb_pix = np.mean(b)
                        if mr_pix > mb_pix + 16:
                            temp_desc = "warm amber and golden cinematic"
                        elif mb_pix > mr_pix + 16:
                            temp_desc = "cool cyan and atmospheric blue"
                        else:
                            temp_desc = "natural balanced studio"

                        std_dev = np.mean(stat.stddev[:3])
                        if std_dev > 65:
                            contrast_desc = "high dynamic contrast with crisp micro-textures"
                        elif std_dev < 35:
                            contrast_desc = "soft diffused low-contrast tones"
                        else:
                            contrast_desc = "clean photographic tonal gradation"
                    except Exception as img_err:
                        logger.warning(f"describe_reference_route PIL analysis error: {img_err}")

                # Illuminazione
                if brightness < 65:
                    light_desc = "moody low-key chiaroscuro with deep atmospheric shadows"
                elif brightness > 155:
                    light_desc = "luminous high-key lighting with soft radiant highlights"
                else:
                    light_desc = "natural cinematic lighting with soft directional fill"

                # Palette
                if sat > 0.45:
                    palette_desc = f"rich vibrant {temp_desc} palette"
                elif sat < 0.2:
                    palette_desc = f"muted desaturated {temp_desc} grading"
                else:
                    palette_desc = f"harmonious {temp_desc} grading"

                # Soggetto identificato
                subject = ""
                if embedded_prompt:
                    clean_p = re.sub(r"^(a cinematic shot of|film look:|photo of|extreme close up of)\s*", "", embedded_prompt, flags=re.I).strip()
                    subject = clean_p.split(",")[0].strip()
                if not subject:
                    base_name = os.path.splitext(clean_fn)[0]
                    base_name = re.sub(r"_\d{8,14}", "", base_name)
                    base_name = re.sub(r"_\d+$", "", base_name)
                    base_name = base_name.replace("_", " ").strip().lower()
                    it_map = {
                        "gatto": "feline cat subject",
                        "cane": "canine dog subject",
                        "automobili": "cinematic sports car vehicle",
                        "auto": "vehicle",
                        "donna": "female subject",
                        "uomo": "male subject",
                        "città": "futuristic cityscape",
                        "citta": "futuristic cityscape",
                        "ragazza": "young woman subject",
                        "ragazzo": "young man subject",
                        "leo": "character portrait Leo",
                        "beauty": "high-fashion aesthetic model",
                        "batmobile": "custom tactical combat vehicle",
                        "bat": "tactical vehicle",
                        "city": "modern metropolitan architecture"
                    }
                    for k, v in it_map.items():
                        if k in base_name:
                            base_name = v
                            break
                    subject = base_name if len(base_name) > 2 else "visual subject from reference"

                # Composizione direttiva cinematografica ad-hoc per ruolo
                if role == "Reference Stile":
                    desc = f"Visual art style and atmospheric aesthetic derived from the reference: {subject if embedded_prompt else 'cinematic photography'}, featuring {palette_desc}, {light_desc}, and {contrast_desc}. Maintain strict chromatic harmony and texture fidelity."
                elif role == "Protagonista":
                    desc = f"Protagonist character guided by the reference: {subject}, presenting an authentic heroic presence with distinctive styling, illuminated by {light_desc}. Strictly preserve facial likeness, anatomy, and key costume details from this reference."
                elif role == "Antagonista":
                    desc = f"Antagonist character guided by the reference: {subject}, distinguished by an imposing silhouette, formidable gaze, and {light_desc}. Preserve distinct facial traits, sharp wardrobe styling, and sinister demeanor."
                elif role == "Persone normali":
                    desc = f"Grounded civilian character guided by the reference: {subject}, featuring everyday wardrobe, natural posture, and {light_desc}, blending naturally into the scene."
                elif role == "Soggetto principale":
                    desc = f"Primary focal subject guided by the reference: {subject}, featuring {palette_desc}, {contrast_desc}, and directional {light_desc}. Preserve key geometry and iconic appearance."
                elif role in ["Scenografia / Ambiente", "Scenografia"]:
                    desc = f"Cinematic architecture and environmental setting derived from the reference: {subject}, showcasing {palette_desc}, expansive perspective, tactile materials, and {light_desc}."
                elif role in ["Oggetto di scena / Prop", "Prop"]:
                    desc = f"Hero prop item designed after the reference: {subject}, highlighting authentic material craft, realistic surface wear, and tactile presence under {light_desc}."
                elif role in ["Guida Movimento / Posa", "Posa"]:
                    desc = f"Kinetic body pose and motion framing guided by the reference: dynamic spatial alignment, balanced anatomical weight, and composition matching the reference frame."
                else:
                    desc = f"Cinematic reference element ({role}): {subject}, integrated with {palette_desc}, {light_desc}, and faithful visual identity derived strictly from the reference image."

                # Raffinamento opzionale via Ollama locale se attivo
                import aiohttp
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.get("http://127.0.0.1:11434/api/tags", timeout=aiohttp.ClientTimeout(total=1.2)) as tag_res:
                            if tag_res.status == 200:
                                tags_data = await tag_res.json()
                                models_list = [m.get("name", "") for m in tags_data.get("models", [])]
                                chosen_model = models_list[0] if models_list else None
                                if chosen_model:
                                    ollama_prompt = (
                                        f"You are a film director assistant. Polish this reference directive into one ultra-concise, high-impact English sentence for AI video generation:\n{desc}"
                                    )
                                    payload = {
                                        "model": chosen_model,
                                        "prompt": ollama_prompt,
                                        "stream": False,
                                        "options": { "temperature": 0.5, "num_predict": 120 }
                                    }
                                    async with session.post("http://127.0.0.1:11434/api/generate", json=payload, timeout=aiohttp.ClientTimeout(total=4)) as gen_res:
                                        if gen_res.status == 200:
                                            g_data = await gen_res.json()
                                            r_text = g_data.get("response", "").strip()
                                            r_text = re.sub(r'<think>.*?</think>', '', r_text, flags=re.DOTALL).strip()
                                            r_text = re.sub(r'^["\']|["\']$', '', r_text).strip()
                                            if len(r_text) > 20:
                                                desc = r_text
                except Exception:
                    pass

                logger.info(f"WOX Cinema Describe Reference ({role}) for '{clean_fn}': {desc[:60]}...")
                return web.json_response({
                    "success": True,
                    "description": desc,
                    "role": role,
                    "filename": clean_fn
                })
            except Exception as e:
                logger.error(f"Errore describe_reference_route: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/references/delete")
        @routes.post("/api/wox_cinema/references/delete")
        async def delete_reference(request):
            """Elimina una reference o generazione sia da input che da output."""
            try:
                data = await request.json()
                filename = data.get("filename", "")
                raw_filename = data.get("raw_filename") or os.path.basename(filename)
                
                ref_dir = get_ref_dir()
                input_dir = folder_paths.get_input_directory()
                output_dir = folder_paths.get_output_directory()
                
                candidate_paths = [
                    os.path.join(ref_dir, raw_filename),
                    os.path.join(input_dir, raw_filename),
                    os.path.join(input_dir, "woxcinema", raw_filename),
                    os.path.join(output_dir, raw_filename),
                    os.path.join(output_dir, "wox_cinema", raw_filename),
                    os.path.join(output_dir, "z_image_turbo", raw_filename),
                    os.path.join(output_dir, "krea2", raw_filename)
                ]
                
                for p in candidate_paths:
                    if os.path.exists(p) and os.path.isfile(p):
                        try:
                            os.remove(p)
                        except Exception as rem_err:
                            logger.warning(f"Could not remove {p}: {rem_err}")

                # Deep scan to remove any other copy in output or input
                for root in [output_dir, input_dir]:
                    for r, dirs, files in os.walk(root):
                        if raw_filename in files:
                            try:
                                os.remove(os.path.join(r, raw_filename))
                            except Exception:
                                pass
                
                meta = load_ref_metadata()
                if raw_filename in meta:
                    del meta[raw_filename]
                if filename in meta:
                    del meta[filename]
                if f"woxcinema/{raw_filename}" in meta:
                    del meta[f"woxcinema/{raw_filename}"]
                    
                # Blacklist to prevent re-importing by get_references
                if "_deleted_files" not in meta:
                    meta["_deleted_files"] = []
                if raw_filename.lower() not in meta["_deleted_files"]:
                    meta["_deleted_files"].append(raw_filename.lower())
                if filename.lower() not in meta["_deleted_files"]:
                    meta["_deleted_files"].append(filename.lower())
                    
                save_ref_metadata(meta)

                # Rimuovi anche da saved_prompts.json se corrisponde a un prompt
                saved_prompts = load_saved_prompts()
                filt_prompts = [p for p in saved_prompts if p.get("filename") != filename and p.get("raw_filename") != raw_filename and p.get("id") != raw_filename and p.get("id") != filename]
                if len(filt_prompts) != len(saved_prompts):
                    save_saved_prompts(filt_prompts)

                logger.info(f"WOX Cinema: Successfully deleted reference {raw_filename}")
                return web.json_response({"success": True, "filename": raw_filename})
            except Exception as e:
                logger.error(f"Error in delete_reference: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=400)

        @routes.post("/wox_cinema/prepare_edit_input")
        @routes.post("/api/wox_cinema/prepare_edit_input")
        async def prepare_edit_input(request):
            """Prepares an image for editing by ensuring it exists in ComfyUI's input directory for LoadImage."""
            try:
                import shutil
                data = await request.json()
                filename = data.get("filename", "")
                subfolder = data.get("subfolder", "")
                
                input_dir = folder_paths.get_input_directory()
                output_dir = folder_paths.get_output_directory()
                temp_dir = folder_paths.get_temp_directory()
                
                # Check potential candidate locations
                search_paths = []
                if subfolder:
                    search_paths.append(os.path.join(output_dir, subfolder, filename))
                search_paths.append(os.path.join(output_dir, "wox_cinema", filename))
                search_paths.append(os.path.join(output_dir, filename))
                search_paths.append(os.path.join(input_dir, "wox_cinema_refs", filename))
                search_paths.append(os.path.join(input_dir, filename))
                search_paths.append(os.path.join(temp_dir, filename))
                
                found_src = None
                for p in search_paths:
                    if p and os.path.exists(p) and os.path.isfile(p):
                        found_src = p
                        break
                        
                # Deep search if still not found
                if not found_src:
                    base_name = os.path.basename(filename)
                    for root in [output_dir, input_dir]:
                        matches = glob.glob(os.path.join(root, "**", base_name), recursive=True)
                        if matches:
                            found_src = matches[0]
                            break
                            
                if not found_src:
                    return web.json_response({"success": False, "error": f"File non trovato: {filename}"}, status=404)
                    
                ext = os.path.splitext(found_src)[1] or ".png"
                target_filename = f"wox_edit_{int(time.time())}{ext}"
                target_path = os.path.join(input_dir, target_filename)
                shutil.copy2(found_src, target_path)
                
                logger.info(f"WOX Cinema: Prepared image for edit '{found_src}' -> '{target_path}'")
                return web.json_response({"success": True, "input_filename": target_filename})
            except Exception as e:
                logger.error(f"WOX Cinema prepare_edit_input error: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.get("/wox_cinema/system_status")
        @routes.get("/api/wox_cinema/system_status")
        async def get_system_status(request):
            """Restituisce lo stato di installazione dei nodi custom e dei moduli python necessari."""
            try:
                import sys
                import importlib.util
                
                # Check ComfyUI custom nodes
                custom_nodes_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                required_nodes = [
                    {
                        "id": "ComfyUI-VideoHelperSuite",
                        "name": "ComfyUI-VideoHelperSuite",
                        "description": "Elaborazione e salvataggio video/audio (CreateVideo, SaveVideo, VHS)",
                        "repo": "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite",
                        "folder": "ComfyUI-VideoHelperSuite"
                    },
                    {
                        "id": "ComfyUI-KJNodes",
                        "name": "ComfyUI-KJNodes",
                        "description": "Selettore di risoluzione e utility cinematografiche (ResolutionSelector)",
                        "repo": "https://github.com/kijai/ComfyUI-KJNodes",
                        "folder": "ComfyUI-KJNodes"
                    },
                    {
                        "id": "ComfyUI-Manager",
                        "name": "ComfyUI-Manager",
                        "description": "Gestore globale di estensioni e modelli per ComfyUI",
                        "repo": "https://github.com/ltdrdata/ComfyUI-Manager",
                        "folder": "ComfyUI-Manager"
                    },
                    {
                        "id": "ComfyUI_JR_MiniMaxH3Node",
                        "name": "ComfyUI_JR_MiniMaxH3Node",
                        "description": "Suite MiniMax H3: Neural Latent Upscaler, Director Desk, Auto-Length, Enhanced Video Combine",
                        "repo": "https://github.com/Goldlionren/ComfyUI_JR_MiniMaxH3Node",
                        "folder": "ComfyUI_JR_MiniMaxH3Node"
                    },
                    {
                        "id": "comfyui-inpaint-cropandstitch",
                        "name": "ComfyUI-Inpaint-CropAndStitch",
                        "description": "Strumenti di ritaglio contestuale, inpainting di precisione e stitching fotografico",
                        "repo": "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch",
                        "folder": "comfyui-inpaint-cropandstitch"
                    },
                    {
                        "id": "ComfyUI-Multiband",
                        "name": "ComfyUI-Multiband",
                        "description": "Fusione a multibanda di frequenza per inpainting e montaggi senza stacchi",
                        "repo": "https://github.com/blepping/ComfyUI-Multiband",
                        "folder": "ComfyUI-Multiband"
                    }
                ]
                
                for node_item in required_nodes:
                    node_path = os.path.join(custom_nodes_dir, node_item["folder"])
                    node_item["installed"] = os.path.exists(node_path) and os.path.isdir(node_path)

                # Check Python packages
                required_modules = [
                    {"id": "requests", "name": "requests", "package": "requests", "description": "Comunicazione HTTP e API client REST"},
                    {"id": "aiohttp", "name": "aiohttp", "package": "aiohttp", "description": "Server asincrono e WebSocket integrati"},
                    {"id": "imageio", "name": "imageio", "package": "imageio", "description": "Caricamento e manipolazione frame grafici"},
                    {"id": "imageio-ffmpeg", "name": "imageio-ffmpeg", "package": "imageio-ffmpeg", "description": "Codec e compressione video MP4/H.264"},
                    {"id": "pillow", "name": "Pillow (PIL)", "package": "Pillow", "description": "Elaborazione immagini ad alte prestazioni"}
                ]

                for mod_item in required_modules:
                    mod_pkg = mod_item["package"].lower().replace("-", "_")
                    if mod_pkg == "pillow":
                        mod_pkg = "PIL"
                    mod_item["installed"] = importlib.util.find_spec(mod_pkg) is not None

                # Check Models (diffusion_models, text_encoders, vae)
                base_models_dir = folder_paths.models_dir
                required_models = [
                    # 1. Diffusion Models / UNET
                    {
                        "id": "krea2-turbo",
                        "name": "Krea 2 Turbo UNET (INT8 / FP8)",
                        "filename": "krea2_turbo_int8_convrot.safetensors",
                        "aliases": ["krea2_turbo_fp8_scaled.safetensors"],
                        "folder": "diffusion_models",
                        "description": "UNET neurale Krea 2 Turbo per generazione immagini ad alta velocità",
                        "url": "https://huggingface.co/Andyhere/Z-images_models/resolve/main/z-image-turbo-fp8-e4m3fn.safetensors"
                    },
                    {
                        "id": "z-image-turbo",
                        "name": "Z-Image Turbo UNET (FP8 / INT8)",
                        "filename": "z-image-turbo-fp8-e4m3fn.safetensors",
                        "aliases": ["z_image_turbo_int8_convrot.safetensors"],
                        "folder": "diffusion_models",
                        "description": "UNET neurale per la generazione di immagini ad altissima velocità (Z-Image Turbo)",
                        "url": "https://huggingface.co/Andyhere/Z-images_models/resolve/main/z-image-turbo-fp8-e4m3fn.safetensors"
                    },
                    {
                        "id": "qwen_image_edit",
                        "name": "Qwen Image Edit UNET (FP8)",
                        "filename": "qwen_image_edit_fp8_e4m3fn.safetensors",
                        "aliases": [],
                        "folder": "diffusion_models",
                        "description": "UNET per l'editing contestuale e modifica selettiva delle immagini",
                        "url": "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_fp8_e4m3fn.safetensors"
                    },
                    {
                        "id": "minimax_h3_fl2va",
                        "name": "MiniMax H3 First-Last to Video UNET (INT8)",
                        "filename": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                        "aliases": [],
                        "folder": "diffusion_models",
                        "description": "UNET cinematografico MiniMax H3 per generazione video da prompt e frame iniziale (Load Diffusion Model)",
                        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
                    },
                    {
                        "id": "minimax_h3_ref2va",
                        "name": "MiniMax H3 Ref to Video UNET (INT8)",
                        "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
                        "aliases": [],
                        "folder": "diffusion_models",
                        "description": "UNET cinematografico MiniMax H3 con supporto reference images (Load Diffusion Model)",
                        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors"
                    },
                    # 2. Text Encoders / CLIP
                    {
                        "id": "qwen3vl_4b",
                        "name": "Qwen3-VL 4B Text Encoder (Krea 2)",
                        "filename": "qwen3vl_4b_fp8_scaled.safetensors",
                        "aliases": ["qwen_3_4b_fp8_mixed.safetensors", "qwen_3_4b.safetensors"],
                        "folder": "text_encoders",
                        "description": "Text Encoder a 12 layer (Qwen3-VL 4B) specifico per la pipeline Krea 2 Turbo",
                        "url": "https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors"
                    },
                    {
                        "id": "qwen_3_4b",
                        "name": "Qwen 3 4B Text Encoder (Lumina 2)",
                        "filename": "qwen_3_4b.safetensors",
                        "aliases": ["qwen_3_4b_fp8_mixed.safetensors"],
                        "folder": "text_encoders",
                        "description": "Text Encoder per Z-Image Turbo per interpretazione cinematografica",
                        "url": "https://huggingface.co/Andyhere/Z-images_models/resolve/main/qwen_3_4b.safetensors"
                    },
                    {
                        "id": "qwen_2_5_vl_7b",
                        "name": "Qwen 2.5 VL 7B Text/Vision Encoder",
                        "filename": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                        "aliases": [],
                        "folder": "text_encoders",
                        "description": "Vision Language Text Encoder per Image Editing con Qwen",
                        "url": "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"
                    },
                    {
                        "id": "qwen3vl_32b_minimax_h3",
                        "name": "MiniMax H3 Text/Vision CLIP (Qwen3-VL 32B NVFP4)",
                        "filename": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                        "aliases": [],
                        "folder": "text_encoders",
                        "description": "Text/Vision Encoder avanzato per MiniMax H3 Cinema Video (Load CLIP)",
                        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
                    },
                    # 3. VAEs (Image, Video & Audio)
                    {
                        "id": "ae_vae",
                        "name": "AE VAE Decoder (Flux / Z-Image)",
                        "filename": "ae.safetensors",
                        "aliases": [],
                        "folder": "vae",
                        "description": "Autoencoder latente a 16 canali per rendering nitido ad alta risoluzione",
                        "url": "https://huggingface.co/camenduru/FLUX.1-dev/resolve/main/ae.safetensors"
                    },
                    {
                        "id": "qwen_image_vae",
                        "name": "Qwen Image VAE Decoder",
                        "filename": "qwen_image_vae.safetensors",
                        "aliases": [],
                        "folder": "vae",
                        "description": "Autoencoder latente dedicato al pipeline di Qwen Image Edit",
                        "url": "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors"
                    },
                    {
                        "id": "minimax_h3_video_vae",
                        "name": "MiniMax H3 Video VAE (FP16)",
                        "filename": "minimax_h3_video_vae_fp16.safetensors",
                        "aliases": [],
                        "folder": "vae",
                        "description": "Decoder video ad alta definizione spaziotemporale (Video VAE)",
                        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors"
                    },
                    {
                        "id": "minimax_h3_audio_vae",
                        "name": "MiniMax H3 Audio VAE (FP32)",
                        "filename": "minimax_h3_audio_vae_fp32.safetensors",
                        "aliases": [],
                        "folder": "vae",
                        "description": "Autoencoder per la sintesi e decodifica dell'audio integrato (Audio VAE)",
                        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors"
                    },
                    # 4. LoRAs & Lightning Accelerators
                    {
                        "id": "qwen_edit_lightning",
                        "name": "Qwen Image Edit Lightning 4-Steps LoRA",
                        "filename": "Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors",
                        "aliases": [],
                        "folder": "loras",
                        "description": "Acceleratore a 4 passi di inferenza per generazione istantanea",
                        "url": "https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors"
                    },
                    {
                        "id": "minimax_h3_turbo_lora",
                        "name": "MiniMax H3 Video Turbo 4-Step LoRA (768p)",
                        "filename": "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
                        "aliases": [],
                        "folder": "loras",
                        "description": "Acceleratore Turbo a 4 step per la suite MiniMax H3 Video",
                        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
                    },
                    # 5. Upscale Models (Super-Resolution & Cinema Sharpening)
                    {
                        "id": "realesrgan_x4plus",
                        "name": "RealESRGAN x4 Plus (Upscale Model)",
                        "filename": "RealESRGAN_x4plus.pth",
                        "aliases": ["realesrgan-x4plus.pth", "realesrgan_x4plus.safetensors"],
                        "folder": "upscale_models",
                        "description": "Modello di upscaling e super-risoluzione ad altissima definizione per video e immagini",
                        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
                    },
                    {
                        "id": "4x_nmkd_superscale",
                        "name": "4x-UltraSharp / NMKD Superscale",
                        "filename": "4x-UltraSharp.pth",
                        "aliases": ["4x_ultrasharp.pth", "4x-ultrasharp.pth", "4x_nmkd-superscale_sp_178000_g.pth"],
                        "folder": "upscale_models",
                        "description": "Modello neurale UltraSharp per dettagli cinematografici estremi e de-blurring",
                        "url": "https://huggingface.co/lokcx/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth"
                    }
                ]

                def is_model_file_valid(file_path):
                    if not os.path.exists(file_path):
                        return False
                    if file_path.endswith(".safetensors"):
                        try:
                            import safetensors
                            with safetensors.safe_open(file_path, framework="pt") as f_chk:
                                _ = f_chk.keys()
                            return True
                        except Exception:
                            return False
                    return os.path.getsize(file_path) > 1024

                for model_item in required_models:
                    model_path = os.path.join(base_models_dir, model_item["folder"], model_item["filename"])
                    is_inst = is_model_file_valid(model_path)
                    if not is_inst:
                        # Controlla gli alias autorizzati e la cartella del modello
                        aliases_to_check = [a.lower() for a in model_item.get("aliases", [])]
                        subfolder_path = os.path.join(base_models_dir, model_item["folder"])
                        if os.path.exists(subfolder_path):
                            for fname in os.listdir(subfolder_path):
                                if fname.startswith("_") or fname.startswith("."):
                                    continue
                                fname_lower = fname.lower()
                                if fname_lower == model_item["filename"].lower() or fname_lower in aliases_to_check:
                                    alias_path = os.path.join(subfolder_path, fname)
                                    if is_model_file_valid(alias_path):
                                        is_inst = True
                                        break
                    model_item["installed"] = is_inst

                return web.json_response({
                    "success": True,
                    "nodes": required_nodes,
                    "modules": required_modules,
                    "models": required_models
                })
            except Exception as e:
                logger.error(f"WOX Cinema system_status error: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/install_items")
        @routes.post("/api/wox_cinema/install_items")
        async def install_system_items(request):
            """Installa i moduli python, custom nodes o scarica i modelli AI richiesti con progresso in tempo reale."""
            def send_progress(item_id, item_name, item_type, percent, log="", speed_str="", eta_str="", step="in_progress"):
                try:
                    if PromptServer.instance:
                        PromptServer.instance.send_sync("wox_cinema_install_progress", {
                            "id": item_id,
                            "name": item_name,
                            "type": item_type,
                            "percent": float(percent),
                            "log": log,
                            "speed_str": speed_str,
                            "eta_str": eta_str,
                            "step": step
                        })
                except Exception as ex:
                    logger.debug(f"Failed to send install progress: {ex}")

            def run_sync_install(item_type, item_id, item_name, target, folder, filename):
                import sys
                import subprocess
                import urllib.request
                import time

                python_exe = sys.executable
                custom_nodes_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

                if item_type == "module":
                    send_progress(item_id, item_name, "module", 10, log=f"Avvio installazione pip di '{target}'...", step="starting")
                    cmd = [python_exe, "-m", "pip", "install", target]
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
                    send_progress(item_id, item_name, "module", 35, log=f"Scaricamento e installazione '{target}' in corso...", step="installing")
                    stdout_lines = []
                    if proc.stdout:
                        for line in iter(proc.stdout.readline, ''):
                            if not line:
                                break
                            stdout_lines.append(line)
                            clean = line.strip()
                            if clean:
                                send_progress(item_id, item_name, "module", 65, log=clean[:90], step="installing")
                    proc.wait()
                    if proc.returncode == 0:
                        send_progress(item_id, item_name, "module", 100, log=f"Modulo '{target}' installato con successo.", step="done")
                        return {"success": True, "message": f"Modulo '{target}' installato con successo."}
                    else:
                        send_progress(item_id, item_name, "module", 100, log=f"Errore pip install: {target}", step="error")
                        return {"success": False, "error": f"Errore pip install: {''.join(stdout_lines[-10:])}"}

                elif item_type == "node":
                    target_dir = os.path.join(custom_nodes_dir, folder or os.path.basename(target).replace(".git", ""))
                    if os.path.exists(target_dir):
                        send_progress(item_id, item_name, "node", 100, log=f"Nodo '{folder}' già presente sul disco.", step="done")
                        return {"success": True, "message": f"Nodo già installato in {folder}."}

                    send_progress(item_id, item_name, "node", 15, log=f"Clonazione repository git da '{target}'...", step="cloning")
                    cmd = ["git", "clone", "--depth", "1", target, target_dir]
                    proc = subprocess.run(cmd, capture_output=True, text=True)
                    if proc.returncode == 0:
                        req_file = os.path.join(target_dir, "requirements.txt")
                        if os.path.exists(req_file):
                            send_progress(item_id, item_name, "node", 65, log=f"Installazione requisiti per '{folder}'...", step="requirements")
                            subprocess.run([python_exe, "-m", "pip", "install", "-r", req_file], capture_output=True, text=True)
                        send_progress(item_id, item_name, "node", 100, log=f"Nodo '{folder}' installato e configurato con successo.", step="done")
                        return {"success": True, "message": f"Nodo '{folder}' clonato e configurato con successo."}
                    else:
                        send_progress(item_id, item_name, "node", 100, log=f"Errore git clone per '{folder}'", step="error")
                        return {"success": False, "error": f"Errore git clone: {proc.stderr[-500:] or proc.stdout[-500:]}"}

                elif item_type == "model":
                    base_models_dir = folder_paths.models_dir
                    dest_folder = os.path.join(base_models_dir, folder)
                    os.makedirs(dest_folder, exist_ok=True)
                    dest_file = os.path.join(dest_folder, filename or os.path.basename(target))

                    def is_file_valid(file_path):
                        if not os.path.exists(file_path):
                            return False
                        if file_path.endswith(".safetensors"):
                            try:
                                import safetensors
                                with safetensors.safe_open(file_path, framework="pt") as f_test:
                                    _ = f_test.keys()
                                return True
                            except Exception:
                                return False
                        return os.path.getsize(file_path) > 1024

                    if is_file_valid(dest_file):
                        send_progress(item_id, item_name, "model", 100, log=f"Modello '{filename}' valido e già presente nella cartella {folder}.", step="done")
                        return {"success": True, "message": f"Modello già presente e integro in {dest_file}."}

                    logger.info(f"WOX Cinema: Downloading/resuming model from {target} to {dest_file}...")
                    send_progress(item_id, item_name, "model", 0, log=f"Connessione a {target}...", step="connecting")
                    try:
                        # Supporto HTTP Range per ripresa (resume) del download
                        existing_bytes = os.path.getsize(dest_file) if os.path.exists(dest_file) else 0
                        req_headers = {'User-Agent': 'Mozilla/5.0'}
                        if existing_bytes > 0:
                            req_headers['Range'] = f"bytes={existing_bytes}-"

                        req = urllib.request.Request(target, headers=req_headers)
                        try:
                            resp = urllib.request.urlopen(req)
                        except urllib.error.HTTPError as http_err:
                            if http_err.code == 416: # Range not satisfiable (file già scaricato o riparti da zero)
                                existing_bytes = 0
                                req_headers.pop('Range', None)
                                req = urllib.request.Request(target, headers=req_headers)
                                resp = urllib.request.urlopen(req)
                            else:
                                raise http_err

                        is_range_response = (resp.status == 206)
                        content_len = resp.getheader('Content-Length')
                        remaining_size = int(content_len) if content_len and content_len.isdigit() else 0
                        total_size = (existing_bytes + remaining_size) if is_range_response else remaining_size

                        file_mode = 'ab' if (is_range_response and existing_bytes > 0) else 'wb'
                        downloaded = existing_bytes if (is_range_response and existing_bytes > 0) else 0

                        with open(dest_file, file_mode) as out_f:
                            chunk_size = 1024 * 1024  # 1 MB chunk
                            start_time = time.time()
                            last_emit_time = start_time
                            last_downloaded = downloaded

                            while True:
                                chunk = resp.read(chunk_size)
                                if not chunk:
                                    break
                                out_f.write(chunk)
                                downloaded += len(chunk)
                                now = time.time()

                                if now - last_emit_time >= 0.2:
                                    dt = now - last_emit_time
                                    speed = (downloaded - last_downloaded) / dt if dt > 0 else 0
                                    last_emit_time = now
                                    last_downloaded = downloaded

                                    speed_mb = speed / (1024 * 1024)
                                    speed_str = f"{speed_mb:.1f} MB/s" if speed_mb >= 0.1 else f"{speed / 1024:.0f} KB/s"

                                    if total_size > 0:
                                        pct = (downloaded / total_size) * 100.0
                                        rem = max(0, total_size - downloaded)
                                        eta_sec = int(rem / speed) if speed > 0 else 0
                                        eta_str = f"{eta_sec}s rimanenti" if eta_sec < 60 else f"{eta_sec // 60}m {eta_sec % 60}s"
                                        dl_mb = downloaded / (1024 * 1024)
                                        tot_mb = total_size / (1024 * 1024)
                                        if tot_mb >= 1024:
                                            size_text = f"{dl_mb / 1024:.2f} GB / {tot_mb / 1024:.2f} GB"
                                        else:
                                            size_text = f"{dl_mb:.1f} MB / {tot_mb:.1f} MB"
                                        log_text = f"Download: {size_text} ({pct:.1f}%)"
                                    else:
                                        pct = 50.0
                                        eta_str = ""
                                        dl_mb = downloaded / (1024 * 1024)
                                        log_text = f"Download: {dl_mb:.1f} MB scaricati"

                                    send_progress(item_id, item_name, "model", pct, log=log_text, speed_str=speed_str, eta_str=eta_str, step="downloading")

                        # Verifica finale integrità
                        if not is_file_valid(dest_file):
                            raise Exception("Il file scaricato non ha superato la verifica di integrità safetensors.")

                        send_progress(item_id, item_name, "model", 100, log=f"Modello '{filename}' verificato e scaricato con successo.", step="done")
                        return {"success": True, "message": f"Modello '{filename}' scaricato con successo in {dest_folder}."}
                    except Exception as dl_err:
                        send_progress(item_id, item_name, "model", 100, log=f"Errore download: {dl_err}", step="error")
                        return {"success": False, "error": f"Errore download modello: {dl_err}"}

                else:
                    return {"success": False, "error": f"Tipo sconosciuto: {item_type}"}

            try:
                import asyncio
                data = await request.json()
                item_type = data.get("type", "")  # 'module', 'node' o 'model'
                item_id = data.get("id", "")
                item_name = data.get("name", "") or data.get("filename", "") or item_id
                target = data.get("target", "")    # package name, git repo url, o model download url
                folder = data.get("folder", "")    # cartella di destinazione
                filename = data.get("filename", "")

                res = await asyncio.to_thread(
                    run_sync_install, item_type, item_id, item_name, target, folder, filename
                )
                status_code = 200 if res.get("success") else 400
                return web.json_response(res, status=status_code)
            except Exception as e:
                logger.error(f"WOX Cinema install_items error: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.get("/wox_cinema/thermal_status")
        @routes.get("/api/wox_cinema/thermal_status")
        async def get_thermal_status(request):
            """Restituisce le temperature di CPU e GPU per monitoraggio e modalità Safe (Win, Linux, Mac)."""
            try:
                import sys
                import platform
                import subprocess
                import shutil
                import glob

                gpu_temp = None
                cpu_temp = None
                gpu_name = ""
                details = []

                plat = platform.system().lower()

                # 1. GPU TEMPERATURE (NVIDIA / Apple Silicon / Linux AMD/Intel)
                # Check NVIDIA (Win / Linux)
                nv_smi = shutil.which("nvidia-smi")
                if not nv_smi and plat == "windows":
                    # Fallback standard paths
                    for p in [r"C:\Windows\System32\nvidia-smi.exe", r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]:
                        if os.path.exists(p):
                            nv_smi = p
                            break

                if nv_smi:
                    try:
                        res = subprocess.run(
                            [nv_smi, "--query-gpu=name,temperature.gpu", "--format=csv,noheader,nounits"],
                            capture_output=True, text=True, timeout=2
                        )
                        if res.returncode == 0 and res.stdout.strip():
                            line = res.stdout.strip().split("\n")[0]
                            parts = [p.strip() for p in line.split(",")]
                            if len(parts) >= 2:
                                gpu_name = parts[0]
                                gpu_temp = float(parts[1])
                            elif len(parts) == 1 and parts[0].isdigit():
                                gpu_temp = float(parts[0])
                            details.append(f"NVIDIA GPU: {gpu_temp}°C")
                    except Exception as e:
                        pass

                # Check Linux DRM/hwmon for GPU if still not found
                if gpu_temp is None and plat == "linux":
                    try:
                        hwmon_paths = glob.glob("/sys/class/drm/card*/device/hwmon/hwmon*/temp1_input") + glob.glob("/sys/class/hwmon/hwmon*/temp*_input")
                        for hp in hwmon_paths:
                            try:
                                with open(hp, "r") as f:
                                    val = float(f.read().strip()) / 1000.0
                                    if 15.0 <= val <= 115.0:
                                        gpu_temp = val
                                        details.append(f"Linux hwmon GPU: {gpu_temp}°C")
                                        break
                            except Exception:
                                pass
                    except Exception:
                        pass

                # 2. CPU TEMPERATURE
                # A. Linux thermal_zone or hwmon
                if plat == "linux":
                    try:
                        tzone_files = glob.glob("/sys/class/thermal/thermal_zone*/temp")
                        temps = []
                        for tf in tzone_files:
                            try:
                                with open(tf, "r") as f:
                                    t_val = float(f.read().strip()) / 1000.0
                                    if 15.0 <= t_val <= 115.0:
                                        temps.append(t_val)
                            except Exception:
                                pass
                        if temps:
                            cpu_temp = round(max(temps), 1)
                            details.append(f"Linux ThermalZone CPU: {cpu_temp}°C")
                    except Exception:
                        pass

                # B. macOS (socpowerbudgets / sysctl / osx-cpu-temp)
                elif plat == "darwin":
                    # Check osx-cpu-temp or powermetrics if available
                    for cmd in ["osx-cpu-temp", "istats"]:
                        bin_p = shutil.which(cmd)
                        if bin_p:
                            try:
                                r = subprocess.run([bin_p], capture_output=True, text=True, timeout=2)
                                txt = r.stdout.strip()
                                import re
                                match = re.search(r"(\d+(\.\d+)?)°?C", txt)
                                if match:
                                    cpu_temp = float(match.group(1))
                                    details.append(f"macOS {cmd}: {cpu_temp}°C")
                                    break
                            except Exception:
                                pass
                    if gpu_temp is None and cpu_temp is not None:
                        # Unified SoC Apple Silicon: GPU is part of CPU package
                        gpu_temp = cpu_temp
                        gpu_name = "Apple Silicon SoC"

                # C. Windows (WMI MSAcpi_ThermalZoneTemperature or OHMR/LHM if present)
                elif plat == "windows":
                    try:
                        ps_cmd = "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature"
                        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, timeout=2)
                        if r.returncode == 0 and r.stdout.strip():
                            lines = r.stdout.strip().split()
                            temps = []
                            for l in lines:
                                try:
                                    k = float(l)
                                    c = round((k - 2732) / 10.0, 1)
                                    if 15.0 <= c <= 115.0:
                                        temps.append(c)
                                except Exception:
                                    pass
                            if temps:
                                cpu_temp = max(temps)
                                details.append(f"Win WMI ACPI: {cpu_temp}°C")
                    except Exception:
                        pass

                # D. psutil fallback for platforms where sensors_temperatures exists
                try:
                    import psutil
                    if cpu_temp is None and hasattr(psutil, "sensors_temperatures"):
                        temps_dict = psutil.sensors_temperatures()
                        if temps_dict:
                            max_t = None
                            for key in ["coretemp", "k10temp", "cpu_thermal", "soc_thermal", "acpitz"]:
                                if key in temps_dict:
                                    for entry in temps_dict[key]:
                                        if entry.current and (max_t is None or entry.current > max_t):
                                            max_t = entry.current
                            if max_t is not None:
                                cpu_temp = round(float(max_t), 1)
                                details.append(f"psutil: {cpu_temp}°C")
                except Exception:
                    pass

                # Status assessment:
                # Normal < 75°C, Warning >= 75°C, Critical >= 83°C (GPU throttles, computer shuts down at 90-100°C)
                highest_temp = max([t for t in [gpu_temp, cpu_temp] if t is not None], default=None)
                thermal_level = "normal"
                should_throttle = False
                
                if highest_temp is not None:
                    if highest_temp >= 82.0:
                        thermal_level = "critical"
                        should_throttle = True
                    elif highest_temp >= 75.0:
                        thermal_level = "warning"
                        should_throttle = True

                return web.json_response({
                    "success": True,
                    "platform": plat,
                    "gpu_temp": gpu_temp,
                    "cpu_temp": cpu_temp,
                    "gpu_name": gpu_name,
                    "highest_temp": highest_temp,
                    "thermal_level": thermal_level,
                    "should_throttle": should_throttle,
                    "details": details
                })
            except Exception as e:
                logger.error(f"WOX Cinema thermal_status error: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

except Exception as e:
    logger.warning(f"WOXCinemaStudio: Failed to register HTTP routes: {e}")

