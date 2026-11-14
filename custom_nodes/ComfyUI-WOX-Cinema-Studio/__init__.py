__version__ = "1.5.0"

from .wox_cinema_node import WOXCinemaStudioNode
from .wox_storyboard import WOXStoryboardSceneNode, WOXStoryboardRenderNode, WOXStoryboardOutputNode
from .wox_video_upscale import WOXVideoAutoLengthNode
from .wox_music_reference import WOXMusicReferenceGuideNode
from .wox_trellis_3d import WOXTrellis3DNode

NODE_CLASS_MAPPINGS = {
    "WOXCinemaStudioNode": WOXCinemaStudioNode,
    "WOXStoryboardSceneNode": WOXStoryboardSceneNode,
    "WOXStoryboardOutputNode": WOXStoryboardOutputNode,
    "WOXStoryboardRenderNode": WOXStoryboardRenderNode,
    "WOXVideoAutoLengthNode": WOXVideoAutoLengthNode,
    "WOXMusicReferenceGuideNode": WOXMusicReferenceGuideNode,
    "WOXTrellis3DNode": WOXTrellis3DNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WOXCinemaStudioNode": "WOX Cinema Studio (Krea 2 Turbo & Minimax H3)",
    "WOXStoryboardSceneNode": "🎬 WOX Storyboard Scene",
    "WOXStoryboardOutputNode": "📤 WOX Storyboard Out",
    "WOXStoryboardRenderNode": "🎥 WOX Storyboard Render",
    "WOXVideoAutoLengthNode": "⚡ WOX Video Auto-Length & Upscaler",
    "WOXMusicReferenceGuideNode": "🎵 WOX Music Reference Guide",
    "WOXTrellis3DNode": "🧊 WOX TRELLIS.2 3D Object Generator (16GB VRAM)",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]

