"""
WOX Music Reference Guide Node.
Analyzes an uploaded reference audio snippet (tempo/BPM, dynamic energy, acoustic profile)
and creates an enriched conditioning prompt that takes inspiration from the reference track
while explicitly ensuring that the generated song is fresh, original, and not an identical copy.
"""

import os
import math
import logging
import numpy as np

try:
    import folder_paths
except ImportError:
    folder_paths = None

logger = logging.getLogger("WOXCinemaStudio")

class WOXMusicReferenceGuideNode:
    """
    Analyzes an input reference audio (via file path or AUDIO tensor) and
    synthesizes an enhanced caption and musical structure for MiniMax Music 3.
    Extracts BPM, dynamic energy, and timbre to inspire the song generation
    without cloning or copying the original piece.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "caption": ("STRING", {"multiline": True, "default": "", "tooltip": "Stile, genere, strumenti e direzione musicale."}),
                "lyrics": ("STRING", {"multiline": True, "default": "", "tooltip": "Testo con tag di struttura come [verse] e [chorus]."}),
                "reference_mode": (["vibe_and_tempo", "creative_reimagining", "acoustic_essence", "disabled"], {"default": "vibe_and_tempo"}),
                "creativity": ("FLOAT", {"default": 0.80, "min": 0.40, "max": 0.98, "step": 0.02, "tooltip": "Maggiore creatività (0.80+) assicura una traccia originale ispirata al riferimento, mai una copia identica."}),
                "duration_seconds": ("FLOAT", {"default": 60.0, "min": 10.0, "max": 240.0, "step": 5.0, "tooltip": "Durata della canzone generata (secondi)."}),
            },
            "optional": {
                "audio_file": ("STRING", {"default": "", "tooltip": "Percorso o nome del file audio di riferimento caricato."}),
                "audio": ("AUDIO", {"tooltip": "Traccia audio da LoadAudio (opzionale)"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "FLOAT", "STRING")
    RETURN_NAMES = ("caption", "lyrics", "duration_seconds", "reference_info")
    FUNCTION = "process"
    CATEGORY = "WOX Cinema Studio"
    DESCRIPTION = "Guida la generazione musicale estraendo tempo, groove ed energia da un brano di riferimento, garantendo originalità."

    def process(self, caption, lyrics, reference_mode, creativity, duration_seconds, audio_file="", audio=None):
        clean_caption = (caption or "").strip()
        clean_lyrics = (lyrics or "").strip()
        
        # If reference is disabled or no audio provided, return user values untouched
        if reference_mode == "disabled":
            return (clean_caption, clean_lyrics, float(duration_seconds), "Reference disabled by user.")

        mono = None
        sr = 44100

        # 1. Try audio input tensor
        if isinstance(audio, dict) and "waveform" in audio:
            try:
                wf = audio["waveform"]
                sr = int(audio.get("sample_rate", 44100))
                if hasattr(wf, "cpu"):
                    wf = wf.detach().cpu().numpy()
                if wf.ndim == 3:
                    wf = wf[0]
                if wf.shape[0] > 1:
                    mono = np.mean(wf, axis=0)
                else:
                    mono = wf[0]
            except Exception as e:
                logger.warning(f"Error reading AUDIO tensor: {e}")

        # 2. Try audio_file if no mono tensor yet
        if mono is None and audio_file and str(audio_file).strip() and str(audio_file).strip().lower() not in ("none", "null"):
            audio_path = str(audio_file).strip()
            resolved = None

            if folder_paths is not None and hasattr(folder_paths, "get_annotated_filepath"):
                try:
                    p = folder_paths.get_annotated_filepath(audio_path)
                    if p and os.path.exists(p):
                        resolved = p
                except Exception:
                    pass

            if not resolved and folder_paths is not None and hasattr(folder_paths, "get_input_directory"):
                p = os.path.join(folder_paths.get_input_directory(), audio_path)
                if os.path.exists(p):
                    resolved = p

            if not resolved and os.path.exists(audio_path):
                resolved = audio_path

            if resolved and os.path.exists(resolved):
                try:
                    import av
                    container = av.open(resolved)
                    frames = []
                    total_samples = 0
                    max_samples = 44100 * 90  # analyze first 90 seconds
                    sr = container.streams.audio[0].codec_context.sample_rate or 44100
                    for frame in container.decode(audio=0):
                        arr = frame.to_ndarray()
                        frames.append(arr)
                        total_samples += arr.shape[1]
                        if total_samples >= max_samples:
                            break
                    if frames:
                        audio_arr = np.concatenate(frames, axis=1)
                        if audio_arr.shape[0] > 1:
                            mono = np.mean(audio_arr, axis=0)
                        else:
                            mono = audio_arr[0]
                except Exception as e:
                    logger.warning(f"Error loading audio file {resolved}: {e}")

        # If still no audio detected, pass through safely
        if mono is None or len(mono) == 0:
            return (clean_caption, clean_lyrics, float(duration_seconds), "No reference audio provided or file unreadable.")

        # --- Audio Acoustic Analysis ---
        duration = float(len(mono) / sr)
        rms = float(np.sqrt(np.mean(mono.astype(np.float64)**2)))

        # BPM estimation via onset envelope autocorrelation
        hop = max(1, int(sr * 0.02))  # 20ms window
        if len(mono) > hop * 50:
            envelope = [float(np.sqrt(np.mean(mono[i:i+hop].astype(np.float64)**2))) for i in range(0, len(mono) - hop, hop)]
            envelope = np.array(envelope, dtype=np.float32)
            diff_env = np.maximum(0, np.diff(envelope))
            fps_env = sr / hop
            autocorr = np.correlate(diff_env, diff_env, mode="full")[len(diff_env)-1:]
            min_lag = int(fps_env * 60 / 195)
            max_lag = int(fps_env * 60 / 55)
            if max_lag > min_lag and len(autocorr) > max_lag:
                lag = min_lag + np.argmax(autocorr[min_lag:max_lag])
                raw_bpm = round((fps_env * 60) / max(1, lag))
                bpm = raw_bpm
                while bpm > 175:
                    bpm //= 2
                while bpm < 65:
                    bpm *= 2
            else:
                bpm = 120
        else:
            bpm = 120

        # Energy & dynamic character
        if rms > 0.12:
            energy_desc = "energetic driving pulse, powerful punchy rhythm section"
        elif rms > 0.05:
            energy_desc = "dynamic rhythmic bounce, balanced modern groove"
        else:
            energy_desc = "smooth warm groove, delicate acoustic cadence"

        # Construct non-identical inspirational styling
        if reference_mode == "vibe_and_tempo":
            style_cues = (
                f"inspired by reference tempo around {bpm} bpm, {energy_desc}, "
                f"novel musical composition, original catchy melody, distinct chord progression, "
                f"creative non-identical variation"
            )
        elif reference_mode == "creative_reimagining":
            style_cues = (
                f"creative reimagining inspired by reference mood at {bpm} bpm feel, {energy_desc}, "
                f"distinct harmonic arrangement, fresh melody and novel songwriting, "
                f"original piece with reference sonic inspiration"
            )
        elif reference_mode == "acoustic_essence":
            style_cues = (
                f"reference-inspired acoustic sound design and instrument timbre, {energy_desc}, "
                f"groove around {bpm} bpm, fully original melody and unique structure"
            )
        else:
            style_cues = f"groove inspired by {bpm} bpm tempo, {energy_desc}, distinct original composition"

        # Fine-tune based on creativity slider
        if creativity >= 0.85:
            style_cues += ", completely distinct original interpretation without copying"
        elif creativity <= 0.60:
            style_cues += ", tightly matching reference rhythmic energy and structural feel"

        if clean_caption:
            enriched_caption = f"{clean_caption}, {style_cues}"
        else:
            enriched_caption = style_cues

        summary = (
            f"Reference audio analyzed ({duration:.1f}s): estimated {bpm} BPM, {energy_desc}. "
            f"Prompt enriched with non-identical variation directives ({reference_mode}, creativity {creativity:.2f})."
        )
        logger.info(f"[WOXMusicReferenceGuideNode] {summary}")

        return (enriched_caption, clean_lyrics, float(duration_seconds), summary)
