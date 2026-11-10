import os
import sys
import time
import json
import logging
import datetime
import shutil
import subprocess
import torch
import numpy as np
from PIL import Image

from server import PromptServer
import folder_paths

from .api_clients.z_image_client import ZImageClient
from .api_clients.krea_client import KreaClient
from .api_clients.minimax_client import MinimaxClient

logger = logging.getLogger("WOXCinemaStudio.Storyboard")

# Directory di output per WOX Storyboard
WOX_OUTPUT_DIR = os.path.join(folder_paths.get_output_directory(), "wox_cinema")
STORYBOARD_DIR = os.path.join(WOX_OUTPUT_DIR, "storyboard")
os.makedirs(STORYBOARD_DIR, exist_ok=True)


def get_ffmpeg_executable():
    """Restituisce il percorso dell'eseguibile ffmpeg."""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    return shutil.which("ffmpeg") or "ffmpeg"


def calculate_dimensions(aspect_ratio, resolution):
    """Calcola larghezza e altezza in base ad aspect ratio e risoluzione."""
    w, h = 1280, 720
    valid_ratios = ["16:9", "9:16", "1:1", "21:9", "4:3"]
    valid_resolutions = ["480p", "720p", "1080p", "4k"]
    if aspect_ratio not in valid_ratios:
        aspect_ratio = "16:9"
    if resolution not in valid_resolutions:
        resolution = "1080p"

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
    return w, h


def build_enhanced_prompt(prompt, film_setup="Auto", camera="Auto", color_palette="Auto", lighting="Auto"):
    """Costruisce il prompt cinematografico arricchito con stile, camera, palette e luci."""
    film_descriptions = {
        "General": "Film look: Cinematic 35mm practical photography, natural balanced lighting, shallow depth of field, realistic live-action film texture, premium studio grading",
        "Cinematic 35mm": "Film look: Kodak 35mm motion picture film stock, shallow depth of field, natural organic halation, authentic celluloid texture",
        "IMAX 70mm": "Film look: Shot on IMAX 70mm cameras, extreme sharpness, breathtaking dynamic range, majestic scale, pristine visual clarity",
        "NOIR": "Film look: Film Noir aesthetic, deep dramatic shadows, high contrast chiaroscuro lighting, moody monochrome tone, vintage detective texture, cinematic grain",
        "Action": "Film look: High-octane blockbuster action movie style, intense dynamic contrast, kinetic visual texture, anamorphic lens flare",
        "Horror": "Film look: Dark horror movie aesthetic, eerie desaturated tones, deep unsettling shadows, volumetric mist, tense dark grading",
        "Drama": "Film look: Intimate prestige drama cinema style, soft naturalistic lighting, subtle film grain, emotional shallow focus",
        "Anime Style": "Film look: High-end Makoto Shinkai anime aesthetic, lush vibrant lighting, painterly background textures",
        "Hyperrealistic 8k": "Film look: Hyperrealistic 8k digital cinematography, razor-sharp details, lifelike micro-textures",
        "Vintage Super 8": "Film look: Vintage Super 8mm retro film stock, warm nostalgic tones, charming film grain, subtle light leaks"
    }
    style_elements = []
    if film_setup in film_descriptions:
        style_elements.append(film_descriptions[film_setup])
    elif film_setup and film_setup != "Auto":
        style_elements.append(f"Film setup: {film_setup}")

    if camera and camera != "Auto":
        style_elements.append(f"Camera motion: {camera}")
    if color_palette and color_palette != "Auto":
        style_elements.append(f"Palette: {color_palette}")
    if lighting and lighting != "Auto":
        style_elements.append(f"Lighting: {lighting}")

    if style_elements:
        return f"{prompt}\n\n" + ". ".join(style_elements)
    return prompt


def convert_image_to_video_clip(image_path, output_video_path, duration=5.0, fps=24):
    """Converte un'immagine fissa in una breve clip video MP4 usando ffmpeg."""
    ffmpeg_exe = get_ffmpeg_executable()
    cmd = [
        ffmpeg_exe, "-y",
        "-loop", "1",
        "-i", image_path,
        "-c:v", "libx264",
        "-t", f"{duration:.2f}",
        "-r", str(fps),
        "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        output_video_path
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return output_video_path
    except Exception as e:
        logger.warning(f"Errore conversione immagine in video clip: {e}")
        return None


def concatenate_video_clips(clip_paths, final_output_path, target_fps=24):
    """Concatena una lista di file video in un unico montaggio finale con normalizzazione."""
    if not clip_paths:
        return None
    if len(clip_paths) == 1:
        shutil.copyfile(clip_paths[0], final_output_path)
        return final_output_path

    ffmpeg_exe = get_ffmpeg_executable()
    list_file_path = final_output_path + ".txt"

    # Creazione file elenco per concat demuxer
    try:
        with open(list_file_path, "w", encoding="utf-8") as f:
            for p in clip_paths:
                clean_p = os.path.abspath(p).replace("\\", "/")
                f.write(f"file '{clean_p}'\n")

        # Concat con re-encoding per garantire sincronia e compatibilità di risoluzioni
        cmd = [
            ffmpeg_exe, "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", list_file_path,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-r", str(target_fps),
            final_output_path
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if os.path.exists(list_file_path):
            os.remove(list_file_path)
        return final_output_path
    except Exception as e:
        logger.error(f"Errore nella concatenazione video storyboard: {e}")
        if os.path.exists(list_file_path):
            try: os.remove(list_file_path)
            except: pass
        return clip_paths[0]


class WOXStoryboardSceneNode:
    """
    Nodo Scena per Storyboard Cinematico (WOX Cinema Studio).
    Permette di definire singole scene con prompt, impostazioni visive e camera,
    e di collegarle in serie (entrata/uscita) per formare lo Storyboard completo.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "multiline": True,
                    "default": "Scena: Inquadratura cinematografica in campo medio, luci volumetriche soffuse, atmosfera avvolgente e dettagli ultra definiti",
                    "placeholder": "Descrivi il prompt della scena..."
                }),
                "mode": (["Video (Minimax H3)", "Image (Z-Image Turbo)", "Image (Krea 2)"], {"default": "Video (Minimax H3)"}),
                "film_setup": (["General", "Cinematic 35mm", "IMAX 70mm", "NOIR", "Action", "Horror", "Drama", "Anime Style", "Hyperrealistic 8k", "Vintage Super 8"], {"default": "Cinematic 35mm"}),
                "camera": (["Auto", "Static Tripod", "Pan Left to Right", "Tilt Up", "Slow Zoom In", "Drone FPV", "360 Orbit", "Handheld Shake"], {"default": "Auto"}),
                "aspect_ratio": (["16:9", "9:16", "1:1", "21:9", "4:3"], {"default": "16:9"}),
                "resolution": (["480p", "720p", "1080p", "4k"], {"default": "1080p"}),
                "fps": ([24, 25, 30, 60], {"default": 24}),
                "duration": ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {"default": 5}),
            },
            "optional": {
                "storyboard_in": ("WOX_STORYBOARD",),
                "reference_image": ("IMAGE",),
            }
        }

    OUTPUT_NODE = False
    RETURN_TYPES = ("WOX_STORYBOARD",)
    RETURN_NAMES = ("STORYBOARD OUT",)
    FUNCTION = "accumulate_scene"
    CATEGORY = "WOX Cinema Studio/Storyboard"
    DESCRIPTION = "Definisce una scena dello Storyboard. Connetti l'uscita STORYBOARD OUT alla scena successiva o al nodo 'WOX Storyboard Render'."

    def accumulate_scene(self, prompt, mode, film_setup, camera, aspect_ratio, resolution, fps, duration,
                         storyboard_in=None, reference_image=None, color_palette="Auto", lighting="Auto"):
        # Recupera la catena esistente o crea una nuova lista
        scenes = []
        if storyboard_in is not None and isinstance(storyboard_in, list):
            scenes = [dict(s) for s in storyboard_in]

        scene_index = len(scenes) + 1
        scene_item = {
            "index": scene_index,
            "title": f"Scene {scene_index}",
            "prompt": prompt,
            "mode": mode,
            "film_setup": film_setup,
            "camera": camera,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "fps": int(fps),
            "duration": float(duration),
            "color_palette": color_palette,
            "lighting": lighting,
            "reference_image": reference_image,
            "rendered_url": None,
            "rendered_file": None,
        }
        scenes.append(scene_item)

        logger.info(f"WOX Storyboard: Aggiunta Scena {scene_index} ('{prompt[:35]}...') | Totale nella catena: {len(scenes)}")

        # Notifica aggiornamento al frontend per la card visuale
        try:
            PromptServer.instance.send_sync("wox_storyboard_scene_registered", {
                "scene_index": scene_index,
                "total_scenes": len(scenes),
                "prompt": prompt,
                "mode": mode,
                "resolution": resolution,
                "fps": fps,
                "duration": duration,
                "aspect_ratio": aspect_ratio
            })
        except Exception:
            pass

        return (scenes,)


class WOXStoryboardOutputNode:
    """
    Nodo Storyboard Out. Riceve la sequenza dello Storyboard e rende visibile
    il flusso STORYBOARD OUT per collegare o ispezionare la sequenza.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "storyboard": ("WOX_STORYBOARD",),
            }
        }

    OUTPUT_NODE = True
    RETURN_TYPES = ("WOX_STORYBOARD", "STRING")
    RETURN_NAMES = ("STORYBOARD OUT", "LAST_PROMPT")
    FUNCTION = "output_storyboard"
    CATEGORY = "WOX Cinema Studio/Storyboard"
    DESCRIPTION = "Nodo di output per la sequenza dello Storyboard."

    def output_storyboard(self, storyboard):
        last_prompt = ""
        if storyboard and isinstance(storyboard, list) and len(storyboard) > 0:
            last_prompt = storyboard[-1].get("prompt", "")
        return (storyboard, last_prompt)



class WOXStoryboardRenderNode:
    """
    Nodo Render per Storyboard (WOX Cinema Studio).
    Riceve la catena completa di tutte le scene collegate, le renderizza in sequenza
    scena per scena e opzionalmente genera il montaggio video finale concatenato.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "storyboard": ("WOX_STORYBOARD",),
                "export_combined_video": (["True", "False"], {"default": "True"}),
                "render_images_as_video": (["True", "False"], {"default": "True"}),
                "steps": ([20, 25, 30, 35, 40, 50], {"default": 20}),
            },
            "optional": {
                "minimax_api_key": ("STRING", {"default": ""}),
                "z_image_api_key": ("STRING", {"default": ""}),
                "krea_api_key": ("STRING", {"default": ""}),
                "negative_prompt": ("STRING", {"multiline": True, "default": "low quality, blurry, distorted, watermarks"}),
            }
        }

    OUTPUT_NODE = True
    RETURN_TYPES = ("IMAGE", "VHS_FILENAMES", "STRING")
    RETURN_NAMES = ("RENDERED_IMAGES", "VIDEO_FILENAMES", "STORYBOARD_SUMMARY")
    FUNCTION = "render_storyboard"
    CATEGORY = "WOX Cinema Studio/Storyboard"
    DESCRIPTION = "Renderizza l'intera sequenza dello Storyboard scena per scena fino alla fine."

    def render_storyboard(self, storyboard, export_combined_video="True", render_images_as_video="True",
                          steps=20, minimax_api_key="", z_image_api_key="", krea_api_key="", negative_prompt=""):
        if not storyboard or not isinstance(storyboard, list):
            logger.warning("WOX Storyboard Render: Nessuna scena presente nello Storyboard!")
            dummy_tensor = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (dummy_tensor, ([],), "Nessuna scena trovata nello Storyboard.")

        total_scenes = len(storyboard)
        logger.info(f"WOX Storyboard Render: Avvio rendering di {total_scenes} scene in sequenza...")

        all_image_tensors = []
        scene_video_paths = []
        summary_records = []
        timestamp_now = int(time.time())

        for idx, sc in enumerate(storyboard):
            scene_num = idx + 1
            prompt = sc.get("prompt", "")
            mode = sc.get("mode", "Video (Minimax H3)")
            film_setup = sc.get("film_setup", "Cinematic 35mm")
            camera = sc.get("camera", "Auto")
            color_palette = sc.get("color_palette", "Auto")
            lighting = sc.get("lighting", "Auto")
            aspect_ratio = sc.get("aspect_ratio", "16:9")
            resolution = sc.get("resolution", "1080p")
            fps = sc.get("fps", 24)
            duration = sc.get("duration", 5.0)
            ref_image = sc.get("reference_image", None)

            w, h = calculate_dimensions(aspect_ratio, resolution)
            enhanced_prompt = build_enhanced_prompt(prompt, film_setup, camera, color_palette, lighting)

            # Notifica progresso inizio scena
            try:
                PromptServer.instance.send_sync("wox_storyboard_progress", {
                    "current": scene_num,
                    "total": total_scenes,
                    "title": f"Scena {scene_num}",
                    "prompt": prompt,
                    "mode": mode,
                    "percent": int(((idx) / total_scenes) * 100),
                    "status": f"Elaborazione Scena {scene_num} di {total_scenes}..."
                })
            except Exception:
                pass

            logger.info(f"--- [WOX Storyboard] Rendering Scena {scene_num}/{total_scenes} ({mode}) ---")

            rendered_img_path = None
            rendered_vid_path = None

            if "Image" in mode:
                # Generazione Immagine (Z-Image Turbo o Krea)
                api_key = z_image_api_key or krea_api_key or os.environ.get("Z_IMAGE_API_KEY", "") or os.environ.get("KREA_API_KEY", "")
                client = ZImageClient(api_key=api_key)
                try:
                    pil_images = client.generate_image(
                        prompt=enhanced_prompt,
                        negative_prompt=negative_prompt,
                        width=w,
                        height=h,
                        style=film_setup,
                        num_images=1
                    )
                    if pil_images:
                        img = pil_images[0]
                        img_fn = f"Storyboard_Scene_{scene_num}_{timestamp_now}.png"
                        img_out_path = os.path.join(STORYBOARD_DIR, img_fn)
                        img.save(img_out_path)
                        rendered_img_path = img_out_path

                        # Converte in tensore PyTorch
                        np_img = np.array(img).astype(np.float32) / 255.0
                        all_image_tensors.append(torch.from_numpy(np_img))

                        # Se abilitato, crea una clip video MP4 fissa per il montaggio finale
                        if render_images_as_video == "True":
                            clip_fn = f"Storyboard_Scene_{scene_num}_{timestamp_now}.mp4"
                            clip_out_path = os.path.join(STORYBOARD_DIR, clip_fn)
                            vid_clip = convert_image_to_video_clip(img_out_path, clip_out_path, duration=duration, fps=fps)
                            if vid_clip and os.path.exists(vid_clip):
                                scene_video_paths.append(vid_clip)
                                rendered_vid_path = vid_clip
                except Exception as img_err:
                    logger.error(f"Errore generazione immagine Scena {scene_num}: {img_err}")
                    dummy = torch.zeros((h, w, 3), dtype=torch.float32)
                    all_image_tensors.append(dummy)
            else:
                # Generazione Video (Minimax H3)
                api_key = minimax_api_key or os.environ.get("MINIMAX_API_KEY", "")
                if api_key and api_key.strip():
                    try:
                        client = MinimaxClient(api_key=api_key)
                        video_path = client.generate_video(
                            prompt=enhanced_prompt,
                            model="video-01",
                            camera=camera,
                            lighting=lighting,
                            duration=int(duration),
                            aspect_ratio=aspect_ratio,
                            output_dir=STORYBOARD_DIR
                        )
                        if video_path and os.path.exists(video_path):
                            rendered_vid_path = video_path
                            scene_video_paths.append(video_path)

                            # Estrazione frame per output tensore
                            try:
                                import cv2
                                cap = cv2.VideoCapture(video_path)
                                frames_extracted = 0
                                while frames_extracted < int(fps * duration):
                                    ret, frame = cap.read()
                                    if not ret: break
                                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
                                    all_image_tensors.append(torch.from_numpy(frame_rgb))
                                    frames_extracted += 1
                                cap.release()
                            except Exception as cv_err:
                                logger.warning(f"Errore lettura frame video Scena {scene_num}: {cv_err}")
                    except Exception as vid_err:
                        logger.error(f"Errore generazione video Minimax Scena {scene_num}: {vid_err}")
                else:
                    # Modalità locale senza chiave API: genera preview/clip segnaposto elegante
                    logger.info(f"Scena {scene_num}: Minimax API key non impostata, creazione clip segnaposto locale.")
                    placeholder_img = Image.new("RGB", (w, h), color=(15, 20, 28))
                    img_fn = f"Storyboard_Scene_{scene_num}_{timestamp_now}_preview.png"
                    img_out = os.path.join(STORYBOARD_DIR, img_fn)
                    placeholder_img.save(img_out)
                    rendered_img_path = img_out

                    clip_fn = f"Storyboard_Scene_{scene_num}_{timestamp_now}.mp4"
                    clip_out = os.path.join(STORYBOARD_DIR, clip_fn)
                    vid_clip = convert_image_to_video_clip(img_out, clip_out, duration=duration, fps=fps)
                    if vid_clip:
                        scene_video_paths.append(vid_clip)
                        rendered_vid_path = vid_clip

                    np_img = np.array(placeholder_img).astype(np.float32) / 255.0
                    all_image_tensors.append(torch.from_numpy(np_img))

            # Notifica WebSocket con l'anteprima della scena renderizzata per aggiornare la thumbnail nel nodo
            preview_url = ""
            if rendered_vid_path:
                vid_rel = os.path.basename(rendered_vid_path)
                preview_url = f"/view?filename={vid_rel}&subfolder=wox_cinema/storyboard&type=output"
            elif rendered_img_path:
                img_rel = os.path.basename(rendered_img_path)
                preview_url = f"/view?filename={img_rel}&subfolder=wox_cinema/storyboard&type=output"

            try:
                PromptServer.instance.send_sync("wox_storyboard_scene_rendered", {
                    "scene_index": scene_num,
                    "url": preview_url,
                    "filename": os.path.basename(rendered_vid_path or rendered_img_path or ""),
                    "prompt": prompt,
                    "mode": mode
                })
            except Exception:
                pass

            summary_records.append({
                "scene": scene_num,
                "prompt": prompt,
                "mode": mode,
                "duration": f"{duration}s",
                "resolution": f"{w}x{h}",
                "file": os.path.basename(rendered_vid_path or rendered_img_path or "N/A")
            })

        # ======================================================================
        # Concatenazione Montaggio Finale (Final Film Assembly)
        # ======================================================================
        final_montage_path = None
        if export_combined_video == "True" and scene_video_paths:
            final_name = f"Storyboard_Film_Montage_{timestamp_now}.mp4"
            final_out = os.path.join(os.path.join(WOX_OUTPUT_DIR, "video"), final_name)
            os.makedirs(os.path.dirname(final_out), exist_ok=True)
            logger.info(f"WOX Storyboard: Creazione montaggio finale concatenando {len(scene_video_paths)} scene in '{final_name}'...")
            final_montage_path = concatenate_video_clips(scene_video_paths, final_out, target_fps=24)
            if final_montage_path and os.path.exists(final_montage_path):
                scene_video_paths.insert(0, final_montage_path)

        # Costruzione del sommario testuale
        summary_lines = [
            f"# 🎬 WOX Cinema Studio - Storyboard Rendering Completato",
            f"- **Totale Scene:** {total_scenes}",
            f"- **Data:** {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"- **Montaggio Finale:** {os.path.basename(final_montage_path) if final_montage_path else 'Non richiesto'}\n",
            "### Elenco Scene Renderizzate:"
        ]
        for rec in summary_records:
            summary_lines.append(f"1. **Scena {rec['scene']}** ({rec['mode']} - {rec['duration']} - {rec['resolution']})")
            summary_lines.append(f"   - *Prompt:* {rec['prompt']}")
            summary_lines.append(f"   - *File Generato:* `{rec['file']}`")

        summary_text = "\n".join(summary_lines)

        # Notifica completamento finale al client
        try:
            final_url = ""
            if final_montage_path and os.path.exists(final_montage_path):
                final_fn = os.path.basename(final_montage_path)
                final_url = f"/view?filename={final_fn}&subfolder=video&type=output"

            PromptServer.instance.send_sync("wox_storyboard_complete", {
                "total_scenes": total_scenes,
                "final_video_url": final_url,
                "summary": summary_text
            })
        except Exception:
            pass

        # Preparazione tensore immagini di ritorno
        if all_image_tensors:
            final_images_tensor = torch.stack(all_image_tensors, dim=0)
        else:
            final_images_tensor = torch.zeros((1, 512, 512, 3), dtype=torch.float32)

        return (final_images_tensor, (scene_video_paths,), summary_text)

# ==============================================================================
# Server API Routes per WOX Storyboard (Generate Thumb & Salva Progetto)
# ==============================================================================
THUMBS_DIR = os.path.join(STORYBOARD_DIR, "thumbs")
os.makedirs(THUMBS_DIR, exist_ok=True)

PROJECTS_DIR = os.path.join(WOX_OUTPUT_DIR, "storyboard_projects")
os.makedirs(PROJECTS_DIR, exist_ok=True)

try:
    from aiohttp import web
    if hasattr(PromptServer, "instance") and PromptServer.instance is not None:
        routes = PromptServer.instance.routes

        @routes.post("/wox_cinema/storyboard/generate_thumb")
        async def generate_storyboard_thumb_route(request):
            """Genera un rendering ultra-veloce a bassissima risoluzione per la thumbnail della scena."""
            try:
                data = await request.json()
                prompt_text = (data.get("prompt") or "").strip()
                if not prompt_text:
                    prompt_text = "Cinematic film frame, high quality, studio lighting"

                film_setup = data.get("film_setup", "Cinematic 35mm")
                aspect_ratio = data.get("aspect_ratio", "16:9")

                # Dimensioni a bassissima risoluzione per velocità massima
                tw, th = 384, 216
                if aspect_ratio == "9:16":
                    tw, th = 216, 384
                elif aspect_ratio == "1:1":
                    tw, th = 256, 256
                elif aspect_ratio == "21:9":
                    tw, th = 420, 180
                elif aspect_ratio == "4:3":
                    tw, th = 320, 240

                enhanced = build_enhanced_prompt(prompt_text, film_setup=film_setup)
                timestamp_id = int(time.time() * 1000)
                thumb_fn = f"thumb_{timestamp_id}.png"
                thumb_out_path = os.path.join(THUMBS_DIR, thumb_fn)

                # Tentativo di generazione ultra-rapida con Z-Image Turbo
                z_key = os.environ.get("Z_IMAGE_API_KEY", "") or os.environ.get("KREA_API_KEY", "")
                generated = False
                if z_key:
                    try:
                        client = ZImageClient(api_key=z_key)
                        imgs = client.generate_image(
                            prompt=enhanced,
                            negative_prompt="blurry, distorted",
                            width=tw,
                            height=th,
                            style=film_setup,
                            num_images=1
                        )
                        if imgs:
                            imgs[0].save(thumb_out_path)
                            generated = True
                    except Exception as ze:
                        logger.warning(f"ZImageClient thumb generation fallback: {ze}")

                # Fallback locale ad alta velocità (PIL) se offline o senza API key
                if not generated:
                    from PIL import ImageDraw, ImageFont
                    img = Image.new("RGB", (tw, th), color=(14, 18, 25))
                    draw = ImageDraw.Draw(img)
                    # Sfumatura di fondo cinematografica
                    for y in range(th):
                        r = int(14 + (y / th) * 16)
                        g = int(18 + (y / th) * 22)
                        b = int(25 + (y / th) * 35)
                        draw.line([(0, y), (tw, y)], fill=(r, g, b))

                    # Bordo elegante neon
                    draw.rectangle([(2, 2), (tw - 3, th - 3)], outline=(212, 255, 50), width=1)
                    # Scritta e badge
                    draw.text((12, 12), "🎬 STORYBOARD THUMB", fill=(212, 255, 50))
                    draw.text((12, 32), f"Setup: {film_setup}", fill=(148, 163, 184))
                    snippet = prompt_text[:50] + ("..." if len(prompt_text) > 50 else "")
                    draw.text((12, th - 24), f"\"{snippet}\"", fill=(226, 232, 240))
                    img.save(thumb_out_path)

                thumb_url = f"/view?filename={thumb_fn}&subfolder=wox_cinema/storyboard/thumbs&type=output"
                return web.json_response({
                    "success": True,
                    "url": thumb_url,
                    "filename": thumb_fn
                })
            except Exception as e:
                logger.error(f"Errore generazione thumb storyboard: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/wox_cinema/storyboard/save_project")
        async def save_storyboard_project_route(request):
            """Salva l'intero progetto Storyboard con tutte le scene, prompt, impostazioni e metadati."""
            try:
                data = await request.json()
                scenes = data.get("scenes", [])
                if not scenes:
                    return web.json_response({"success": False, "error": "Nessuna scena presente nello storyboard"}, status=400)

                title = data.get("title") or f"Storyboard_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"
                clean_title = "".join(c for c in title if c.isalnum() or c in (" ", "_", "-")).rstrip()
                clean_title = clean_title.replace(" ", "_")

                ts = int(time.time())
                project_fn = f"{clean_title}_{ts}.json"
                project_path = os.path.join(PROJECTS_DIR, project_fn)

                project_payload = {
                    "project_id": f"sb_proj_{ts}",
                    "title": title,
                    "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "total_scenes": len(scenes),
                    "scenes": scenes,
                    "notes": data.get("notes", "")
                }

                with open(project_path, "w", encoding="utf-8") as f:
                    json.dump(project_payload, f, indent=2, ensure_ascii=False)

                # Aggiornamento indice progetti salvati
                index_path = os.path.join(PROJECTS_DIR, "projects_index.json")
                index_data = []
                if os.path.exists(index_path):
                    try:
                        with open(index_path, "r", encoding="utf-8") as f:
                            index_data = json.load(f)
                    except:
                        index_data = []

                index_data.insert(0, {
                    "project_id": project_payload["project_id"],
                    "title": title,
                    "filename": project_fn,
                    "total_scenes": len(scenes),
                    "created_at": project_payload["created_at"],
                    "url": f"/view?filename={project_fn}&subfolder=wox_cinema/storyboard_projects&type=output"
                })

                with open(index_path, "w", encoding="utf-8") as f:
                    json.dump(index_data, f, indent=2, ensure_ascii=False)

                logger.info(f"WOX Storyboard: Salvato progetto completo '{title}' con {len(scenes)} scene in {project_fn}")
                return web.json_response({
                    "success": True,
                    "project_id": project_payload["project_id"],
                    "filename": project_fn,
                    "url": f"/view?filename={project_fn}&subfolder=wox_cinema/storyboard_projects&type=output",
                    "scenes_count": len(scenes)
                })
            except Exception as e:
                logger.error(f"Errore salvataggio progetto storyboard: {e}")
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.get("/wox_cinema/storyboard/saved_projects")
        async def get_saved_storyboard_projects_route(request):
            """Restituisce l'elenco di tutti i progetti Storyboard salvati su disco."""
            try:
                index_path = os.path.join(PROJECTS_DIR, "projects_index.json")
                if os.path.exists(index_path):
                    with open(index_path, "r", encoding="utf-8") as f:
                        projects = json.load(f)
                        return web.json_response({"success": True, "projects": projects})
                return web.json_response({"success": True, "projects": []})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

except Exception as err:
    logger.warning(f"Errore registrazione route storyboard: {err}")
