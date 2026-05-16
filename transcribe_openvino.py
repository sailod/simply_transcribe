"""OpenVINO GenAI Whisper transcription module.

Usage:
    from transcribe_openvino import transcribe

    result = transcribe("audio.wav", model_dir="models/whisper-large-v3")

The model must be downloaded separately (~1.5 GB):
    pip install huggingface-hub
    hf download OpenVINO/whisper-large-v3-int8-ov --local-dir models/whisper-large-v3
"""

import argparse
import json
import os
import sys


def transcribe(
    audio_path: str,
    model_dir: str = "models/whisper-large-v3",
    device: str = "GPU",
    return_timestamps: bool = True,
) -> dict:
    """Transcribe audio using OpenVINO GenAI Distil-Whisper.

    Args:
        audio_path: Path to audio file (any format librosa supports).
        model_dir: Path to the downloaded OpenVINO model directory.
        device: Inference device ('GPU', 'CPU', 'AUTO').
        return_timestamps: Include per-chunk timestamps in output.

    Returns:
        dict with keys:
            - text (str): Full transcription text.
            - chunks (list[dict], optional): Timestamped segments with
              start, end, text.

    Raises:
        FileNotFoundError: If model_dir or audio_path doesn't exist.
        ImportError: If openvino-genai or librosa is not installed.
        RuntimeError: If transcription fails.
    """
    if not os.path.exists(model_dir):
        raise FileNotFoundError(
            f"Model directory not found: {model_dir}\n\n"
            "Download the model (~1.5 GB):\n"
            "  pip install huggingface-hub\n"
            "  hf download OpenVINO/whisper-large-v3-int8-ov --local-dir models/whisper-large-v3"
        )

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    try:
        import openvino_genai
    except ImportError:
        raise ImportError(
            "openvino_genai not installed.\n"
            "Install with: pip install openvino-genai"
        )

    try:
        import librosa
    except ImportError:
        raise ImportError(
            "librosa not installed.\n"
            "Install with: pip install librosa soundfile"
        )

    def load_pipeline(dev):
        return openvino_genai.WhisperPipeline(model_dir, device=dev)

    try:
        pipe = load_pipeline(device)
    except Exception:
        if device.upper() == "GPU":
            print("GPU failed, falling back to CPU...", file=sys.stderr)
            pipe = load_pipeline("CPU")
        else:
            raise

    try:
        audio, _ = librosa.load(audio_path, sr=16000, mono=True)

        result = pipe.generate(
            audio.tolist(),
            return_timestamps=return_timestamps,
        )

        output: dict = {"text": str(result).strip()}

        if return_timestamps:
            chunks = []
            for chunk in result.chunks:
                chunks.append({
                    "start": chunk.start_ts,
                    "end": chunk.end_ts,
                    "text": chunk.text,
                })
            output["chunks"] = chunks

        return output

    except Exception as e:
        raise RuntimeError(f"OpenVINO transcription failed: {e}") from e


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio using OpenVINO Whisper Large v3"
    )
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument(
        "--model-dir",
        default="models/whisper-large-v3",
        help="Path to OpenVINO model directory (default: models/whisper-large-v3)",
    )
    parser.add_argument(
        "--device",
        default="GPU",
        help="Inference device: GPU, CPU, AUTO (default: GPU; falls back to CPU if GPU unavailable)",
    )
    parser.add_argument(
        "--no-timestamps",
        action="store_false",
        dest="return_timestamps",
        help="Skip per-segment timestamps in output",
    )

    args = parser.parse_args()

    try:
        result = transcribe(
            audio_path=args.audio_file,
            model_dir=args.model_dir,
            device=args.device,
            return_timestamps=args.return_timestamps,
        )
        print(json.dumps(result, indent=2))
    except (FileNotFoundError, ImportError, RuntimeError) as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
