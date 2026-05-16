import argparse
import time
import wave
import requests
import pyperclip
import os
from dotenv import load_dotenv
load_dotenv()

# Constants
WAVE_OUTPUT_FILENAME = "output.wav"
MODEL_NAME = "openai/whisper-large-v3-turbo"
# MODEL_NAME = "openai/whisper-large-v3"
API_URL = f"https://api-inference.huggingface.co/models/{MODEL_NAME}"
API_TOKEN = os.getenv('HUGGINGFACE_API_KEY')
OPENVINO_MODEL_DIR = os.getenv('OPENVINO_MODEL_DIR', 'models/whisper-large-v3')
OPENVINO_DEVICE = os.getenv('OPENVINO_DEVICE', 'GPU')

class RecordingGUI:
    def __init__(self):
        self.recording = False
        self.frames = []
        self.stream = None
        self.samplerate = 44100
        self.window = None
        self.status_label = None
        self.stop_button = None

    def update_status(self, text):
        if self.status_label:
            self.status_label.config(text=text)
            self.window.update()

    def finish(self):
        if self.window:
            self.window.destroy()

    def start_recording(self):
        import numpy as np
        import sounddevice as sd
        try:
            import tkinter as tk
            from tkinter import ttk
        except ModuleNotFoundError:
            raise ModuleNotFoundError(
                "tkinter is not installed. On Ubuntu/Debian: sudo apt install python3-tk"
            )

        self.recording = True
        self.frames = []

        self.window = tk.Tk()
        self.window.title("Simply Transcribe")
        self.window.geometry("240x130")

        self.status_label = tk.Label(
            self.window, text="Recording...",
            font=("Arial", 11), fg="#333"
        )
        self.status_label.pack(pady=(15, 5))

        self.stop_button = ttk.Button(
            self.window,
            text="⏹️ Stop Recording",
            command=self._on_stop,
            style="Big.TButton",
        )

        style = ttk.Style()
        style.configure("Big.TButton", padding=10, font=("Arial", 12, "bold"))

        self.stop_button.pack(expand=True, fill="both", padx=20, pady=(0, 15))

        # Audio callback
        def callback(indata, frames, time, status):
            if self.recording:
                self.frames.append(indata.copy())

        self.stream = sd.InputStream(
            samplerate=self.samplerate,
            channels=1,
            callback=callback,
            blocksize=1024,
            dtype=np.float32,
        )
        self.stream.start()

        # Manual event loop — exits when recording stops
        while self.recording:
            try:
                self.window.update()
            except Exception:
                break

    def _on_stop(self):
        import numpy as np

        self.recording = False

        if self.stop_button:
            self.stop_button.config(state="disabled")

        if self.stream:
            self.stream.stop()
            self.stream.close()

        # Save recorded audio to WAV
        if not self.frames:
            # No audio recorded — cleanup and let main() handle the empty WAV
            self.stream = None
            return

        audio_data = np.concatenate(self.frames, axis=0)
        int_data = (audio_data * 32767).clip(-32768, 32767).astype(np.int16)

        with wave.open(WAVE_OUTPUT_FILENAME, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.samplerate)
            wf.writeframes(int_data.tobytes())

def transcribe_audio_huggingface(file_path):
    headers = {
        "Authorization": f"Bearer {API_TOKEN}"
    }

    with open(file_path, "rb") as f:
        data = f.read()

    response = requests.post(API_URL, headers=headers, data=data)

    if response.status_code == 200:
        result = response.json()
        transcribed_text = result["text"]
        print(f"Transcribed Text: {transcribed_text}")
        return transcribed_text
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return None


def transcribe_audio_openvino(file_path, model_dir=None, device=None):
    import transcribe_openvino
    result = transcribe_openvino.transcribe(
        file_path,
        model_dir=model_dir or OPENVINO_MODEL_DIR,
        device=device or OPENVINO_DEVICE,
    )
    print(f"Transcribed Text: {result['text']}")
    return result["text"]


def transcribe_audio(file_path, provider="huggingface", model_dir=None, device=None):
    if provider == "openvino":
        return transcribe_audio_openvino(file_path, model_dir=model_dir, device=device)
    return transcribe_audio_huggingface(file_path)


def main():
    parser = argparse.ArgumentParser(
        description="Record audio and transcribe it to clipboard."
    )
    parser.add_argument(
        "--provider",
        choices=["huggingface", "openvino"],
        default=os.getenv("TRANSCRIPTION_PROVIDER", "huggingface"),
        help="Transcription provider (default: huggingface)",
    )
    parser.add_argument(
        "--model-dir",
        default=OPENVINO_MODEL_DIR,
        help=f"OpenVINO model directory (default: {OPENVINO_MODEL_DIR})",
    )
    parser.add_argument(
        "--device",
        default=OPENVINO_DEVICE,
        choices=["CPU", "GPU", "AUTO"],
        help=f"Inference device (default: {OPENVINO_DEVICE})",
    )
    args = parser.parse_args()

    provider = args.provider
    model_dir = args.model_dir
    device = args.device
    provider_label = "OpenVINO" if provider == "openvino" else "Hugging Face"

    recorder = RecordingGUI()
    recorder.start_recording()

    recorder.update_status(f"Transcribing ({provider_label})...")

    try:
        transcribed_text = transcribe_audio(
            WAVE_OUTPUT_FILENAME, provider=provider,
            model_dir=model_dir, device=device,
        )
    except Exception as e:
        recorder.update_status(f"Error: {e}")
        time.sleep(2)
        recorder.finish()
        cleanup(WAVE_OUTPUT_FILENAME)
        return

    if transcribed_text:
        pyperclip.copy(transcribed_text)
        recorder.update_status("Copied to clipboard!")
    else:
        recorder.update_status("No text transcribed.")

    time.sleep(1.5)
    recorder.finish()
    cleanup(WAVE_OUTPUT_FILENAME)


def cleanup(file_path):
    if os.path.exists(file_path):
        os.remove(file_path)


if __name__ == "__main__":
    main()
