import os
import json
import shutil
import subprocess
from PIL import Image

SRC_EDIT = "/home/wox76/opt/ComfyUI/output/wox-cinema-studio-pro/edit_00005_.png" if os.path.exists("/home/wox76/opt/ComfyUI/output/wox-cinema-studio-pro/edit_00005_.png") else "/home/wox76/opt/ComfyUI/output/freefield/edit_00005_.png"
SRC_MARIAH = "/home/wox76/Desktop/mariah_carpenter.png"
SRC_VIDEO = "/home/wox76/opt/ComfyUI/output/wox-cinema-studio-pro/speak_00001_.mp4" if os.path.exists("/home/wox76/opt/ComfyUI/output/wox-cinema-studio-pro/speak_00001_.mp4") else "/home/wox76/opt/ComfyUI/output/freefield/speak_00001_.mp4"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMPLES_DIR = os.path.join(BASE_DIR, "web", "examples")
INDEX_JSON = os.path.join(EXAMPLES_DIR, "index.json")

with open(INDEX_JSON, "r") as f:
    data = json.load(f)
apps = data.setdefault("apps", {})

def save_image_assets(app_id, src_path):
    target_dir = os.path.join(EXAMPLES_DIR, app_id)
    os.makedirs(target_dir, exist_ok=True)
    
    img = Image.open(src_path).convert("RGB")
    
    # Save full.jpg
    full_jpg = os.path.join(target_dir, "full.jpg")
    img.save(full_jpg, "JPEG", quality=95)
    
    # Save card.jpg
    w, h = img.size
    max_dim = 640
    if max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        nw, nh = int(round(w * scale)), int(round(h * scale))
        card_img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    else:
        card_img = img
    card_jpg = os.path.join(target_dir, "card.jpg")
    card_img.save(card_jpg, "JPEG", quality=90)
    
    # Also save png if app uses png (like upscale)
    full_png = os.path.join(target_dir, "full.png")
    card_png = os.path.join(target_dir, "card.png")
    shutil.copyfile(src_path, full_png)
    card_img.save(card_png, "PNG")
    
    # Update index.json
    app_entry = apps.setdefault(app_id, {})
    app_entry["type"] = "image"
    app_entry["card"] = f"examples/{app_id}/card.jpg"
    app_entry["poster"] = None
    app_entry["full"] = f"examples/{app_id}/full.jpg"
    print(f"Updated image app: {app_id} using {os.path.basename(src_path)}")

def save_video_assets(app_id, poster_src, video_src):
    target_dir = os.path.join(EXAMPLES_DIR, app_id)
    os.makedirs(target_dir, exist_ok=True)
    
    # Poster
    img = Image.open(poster_src).convert("RGB")
    w, h = img.size
    max_dim = 640
    if max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        nw, nh = int(round(w * scale)), int(round(h * scale))
        card_img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    else:
        card_img = img
    poster_jpg = os.path.join(target_dir, "poster.jpg")
    card_img.save(poster_jpg, "JPEG", quality=90)
    
    # Full MP4
    full_mp4 = os.path.join(target_dir, "full.mp4")
    shutil.copyfile(video_src, full_mp4)
    
    # Card MP4 (compressed for fast web looping)
    card_mp4 = os.path.join(target_dir, "card.mp4")
    cmd = [
        "ffmpeg", "-y", "-i", video_src,
        "-vf", "scale='min(640,iw)':-2",
        "-c:v", "libx264", "-preset", "fast", "-crf", "26",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        card_mp4
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    app_entry = apps.setdefault(app_id, {})
    app_entry["type"] = "video"
    app_entry["card"] = f"examples/{app_id}/card.mp4"
    app_entry["poster"] = f"examples/{app_id}/poster.jpg"
    app_entry["full"] = f"examples/{app_id}/full.mp4"
    print(f"Updated video app: {app_id} with poster {os.path.basename(poster_src)} and video {os.path.basename(video_src)}")

# 1. Image apps (alternating edit_00005_.png and mariah_carpenter.png):
# 1) Create Image: edit_00005_.png (for both create-image and z-image)
save_image_assets("create-image", SRC_EDIT)
save_image_assets("z-image", SRC_EDIT)

# 2) Edit Image: mariah_carpenter.png
save_image_assets("edit", SRC_MARIAH)

# 3) inpaint: edit_00005_.png
save_image_assets("inpaint", SRC_EDIT)

# 4) Relight: mariah_carpenter.png
save_image_assets("relight", SRC_MARIAH)

# 5) Upscale Image: edit_00005_.png
save_image_assets("upscale", SRC_EDIT)

# 6) Face swap: mariah_carpenter.png
save_image_assets("face-swap", SRC_MARIAH)

# 7) Consistent Character: edit_00005_.png (both character and character-studio)
save_image_assets("character", SRC_EDIT)
save_image_assets("character-studio", SRC_EDIT)

# 8) Behind the scene: mariah_carpenter.png
# For behind-the-scenes, generate video loop of mariah_carpenter.png and poster
b_dir = os.path.join(EXAMPLES_DIR, "behind-the-scenes")
os.makedirs(b_dir, exist_ok=True)
poster_b = os.path.join(b_dir, "poster.jpg")
img_m = Image.open(SRC_MARIAH).convert("RGB")
img_m.resize((640, int(640 * img_m.height / img_m.width))).save(poster_b, "JPEG", quality=90)
card_b = os.path.join(b_dir, "card.mp4")
full_b = os.path.join(b_dir, "full.mp4")
cmd_loop = [
    "ffmpeg", "-y", "-loop", "1", "-i", SRC_MARIAH,
    "-c:v", "libx264", "-t", "4", "-pix_fmt", "yuv420p",
    "-vf", "scale='min(640,iw)':-2",
    "-movflags", "+faststart",
    card_b
]
subprocess.run(cmd_loop, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
shutil.copyfile(card_b, full_b)
apps.setdefault("behind-the-scenes", {})["card"] = "examples/behind-the-scenes/card.mp4"
apps.setdefault("behind-the-scenes", {})["poster"] = "examples/behind-the-scenes/poster.jpg"
apps.setdefault("behind-the-scenes", {})["full"] = "examples/behind-the-scenes/full.mp4"
print("Updated behind-the-scenes with mariah_carpenter.png")

# 9) AI Director: edit_00005_.png
save_image_assets("director", SRC_EDIT)

# 2. Video apps (poster: edit_00005_.png, video: speak_00001_.mp4):
save_video_assets("speak", SRC_EDIT, SRC_VIDEO)
save_video_assets("talking", SRC_EDIT, SRC_VIDEO)
save_video_assets("dub", SRC_EDIT, SRC_VIDEO)
save_video_assets("transitions", SRC_EDIT, SRC_VIDEO)

# Save updated index.json
with open(INDEX_JSON, "w") as f:
    json.dump(data, f, indent=2)

print("\nSuccessfully updated index.json and all example assets!")
