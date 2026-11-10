import torch
import comfy.utils
import node_helpers
from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

class ReferenceMultiLatent(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ReferenceMultiLatent",
            display_name="Set Reference Multi Latent",
            category="model/conditioning",
            description="Encodes reference images and appends their latents to positive and optional negative conditioning for edit models.",
            inputs=[
                io.Conditioning.Input("positive"),
                io.DynamicCombo.Input("resolution", options=[
                    io.DynamicCombo.Option("keep resolution", []),
                    io.DynamicCombo.Option("resize", [
                        io.Float.Input("megapixels", default=1.0, min=0.01, max=16.0, step=0.01,
                                       tooltip="Target size of each reference image, preserving aspect ratio. 1.0 is about 1024 x 1024 pixels.")
                    ])
                ]),
                io.Conditioning.Input("negative", optional=True),
                io.Vae.Input("vae", optional=True, tooltip="Reference images are ignored when no VAE is connected."),
                io.Autogrow.Input("images", template=io.Autogrow.TemplatePrefix(
                    io.Image.Input("image", optional=True), prefix="image", min=1, max=100
                ), optional=True)
            ],
            outputs=[
                io.Conditioning.Output(display_name="positive"),
                io.Conditioning.Output(display_name="negative", tooltip="Returns the positive output when negative conditioning is not connected."),
                io.Latent.Output(display_name="empty_latent", tooltip="First reference latent multiplied by 0.0, or a square empty latent at the selected resolution.")
            ]
        )

    @classmethod
    def execute(cls, positive, resolution, negative=None, vae=None, images=None, **kwargs) -> io.NodeOutput:
        res_mode = "resize"
        megapixels = 1.0
        if isinstance(resolution, dict):
            res_mode = resolution.get("resolution", "resize")
            megapixels = float(resolution.get("megapixels", 1.0))
        elif isinstance(resolution, str):
            res_mode = resolution
            megapixels = float(kwargs.get("resolution.megapixels", kwargs.get("megapixels", 1.0)))

        imgs = []
        if images is not None:
            if isinstance(images, dict):
                imgs.extend([v for k, v in sorted(images.items()) if v is not None])
            elif isinstance(images, (list, tuple)):
                imgs.extend([v for v in images if v is not None])
            elif isinstance(images, torch.Tensor):
                imgs.append(images)
        for k, v in kwargs.items():
            if ("image" in k or "images" in k) and isinstance(v, torch.Tensor):
                imgs.append(v)

        ref_latents = []
        if vae is not None and imgs:
            for img in imgs:
                if res_mode == "resize":
                    H, W = img.shape[1], img.shape[2]
                    target_pixels = megapixels * 1024.0 * 1024.0
                    scale = (target_pixels / (H * W)) ** 0.5
                    new_h = max(64, int(round(H * scale / 16.0) * 16))
                    new_w = max(64, int(round(W * scale / 16.0) * 16))
                    permuted = img.movedim(-1, 1)
                    scaled = comfy.utils.common_upscale(permuted, new_w, new_h, "bicubic", "disabled")
                    img = scaled.movedim(1, -1)

                t = vae.encode(img[:, :, :, :3])
                ref_latents.append(t)

        if ref_latents:
            positive = node_helpers.conditioning_set_values(positive, {"reference_latents": ref_latents}, append=True)
            if negative is not None:
                negative = node_helpers.conditioning_set_values(negative, {"reference_latents": ref_latents}, append=True)
            else:
                negative = positive
            empty_latent = {"samples": torch.zeros_like(ref_latents[0])}
        else:
            if negative is None:
                negative = positive
            empty_latent = {"samples": torch.zeros([1, 16, 128, 128])}

        return io.NodeOutput(positive, negative, empty_latent)


class ReferenceMultiLatentExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            ReferenceMultiLatent,
        ]


NODE_CLASS_MAPPINGS = {
    "ReferenceMultiLatent": ReferenceMultiLatent,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ReferenceMultiLatent": "Set Reference Multi Latent",
}


def comfy_entrypoint() -> ReferenceMultiLatentExtension:
    return ReferenceMultiLatentExtension()
