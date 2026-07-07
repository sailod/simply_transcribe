import argparse
import json
import signal
import socket
import subprocess
import sys
import time
import wave
import requests
import pyperclip
import os
from dotenv import load_dotenv
from pathlib import Path
load_dotenv()

CONFIG_FILE = Path.home() / ".config" / "simply_transcribe" / "shortcut.json"
DEFAULT_SHORTCUT = "Escape"
LOCK_FILE = "/tmp/simply_transcribe.lock"

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
        self.settings_button = None
        self.shortcut_label = None
        self.shortcut_dialog = None
        self._listening_for_shortcut = False
        self._pending_shortcut = None

    @staticmethod
    def load_shortcut():
        try:
            if CONFIG_FILE.exists():
                with open(CONFIG_FILE) as f:
                    data = json.load(f)
                    return data.get("shortcut", DEFAULT_SHORTCUT)
        except Exception:
            pass
        return DEFAULT_SHORTCUT

    @staticmethod
    def save_shortcut(shortcut):
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump({"shortcut": shortcut}, f)

    @staticmethod
    def _build_combo(keysym, state):
        """Build a shortcut string from Tkinter event keysym and state bitmask."""
        modifiers = []
        if state & 0x0004: modifiers.append("Ctrl")
        if state & 0x0001: modifiers.append("Shift")
        if state & 0x0008: modifiers.append("Alt")
        if state & 0x0040: modifiers.append("Meta")

        key = keysym
        if key == "space": key = "Space"
        elif len(key) == 1 and key.isalpha():
            key = key.upper()

        if modifiers:
            return "+".join(modifiers) + "+" + key
        return key

    def _on_key(self, event):
        if self._listening_for_shortcut and self.shortcut_dialog:
            is_modifier = event.keysym in ("Control_L", "Control_R", "Alt_L",
                                            "Alt_R", "Shift_L", "Shift_R",
                                            "Meta_L", "Meta_R", "Super_L", "Super_R")
            if not is_modifier:
                self._pending_shortcut = self._build_combo(event.keysym, event.state)
                self._close_shortcut_dialog(save=True)
            return

        if self.recording:
            pressed = self._build_combo(event.keysym, event.state)
            if pressed == self.load_shortcut():
                self._on_stop()

    def update_status(self, text):
        if self.status_label:
            self.status_label.config(text=text)
            self.window.update()

    def _open_shortcut_dialog(self):
        import tkinter as tk

        self._listening_for_shortcut = True
        self._pending_shortcut = self.load_shortcut()

        self.shortcut_dialog = tk.Toplevel(self.window)
        self.shortcut_dialog.title("Set Stop Shortcut")
        self.shortcut_dialog.geometry("300x210")
        self.shortcut_dialog.resizable(False, False)
        self.shortcut_dialog.transient(self.window)
        self.shortcut_dialog.grab_set()
        self.shortcut_dialog.protocol("WM_DELETE_WINDOW", lambda: self._close_shortcut_dialog(save=False))

        tk.Label(
            self.shortcut_dialog,
            text="Press the key combination\nyou want to use to stop recording.",
            font=("Arial", 10), fg="#555", justify="center",
        ).pack(pady=(15, 10))

        self.shortcut_display = tk.Label(
            self.shortcut_dialog,
            text=self._pending_shortcut,
            font=("Arial", 14, "bold"), fg="#007AFF",
            relief="solid", borderwidth=1, padx=20, pady=8,
        )
        self.shortcut_display.pack(pady=5)

        tk.Label(
            self.shortcut_dialog,
            text="Press any key combo to save",
            font=("Arial", 9), fg="#999",
        ).pack(pady=(5, 3))

        tk.Label(
            self.shortcut_dialog,
            text="Note: OS-level hotkeys that launch\nthis app cannot be captured here.",
            font=("Arial", 8), fg="#c44",
            wraplength=260,
        ).pack(pady=(0, 10))

    def _close_shortcut_dialog(self, save):
        if save and self._pending_shortcut:
            self.save_shortcut(self._pending_shortcut)
            self.shortcut_label.config(text=f"Stop shortcut: {self._pending_shortcut}")
        self._listening_for_shortcut = False
        self._pending_shortcut = None
        if self.shortcut_dialog:
            self.shortcut_dialog.destroy()
            self.shortcut_dialog = None

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
        self.window.geometry("240x180")
        self.window.protocol("WM_DELETE_WINDOW", self._on_stop)

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

        self.stop_button.pack(expand=True, fill="both", padx=20, pady=(0, 5))

        self.shortcut_label = tk.Label(
            self.window,
            text=f"Stop shortcut: {self.load_shortcut()}",
            font=("Arial", 9), fg="#999",
        )
        self.shortcut_label.pack()

        self.settings_button = ttk.Button(
            self.window, text="⚙ Configure Shortcut",
            command=self._open_shortcut_dialog,
        )
        self.settings_button.pack(pady=(2, 10))

        self.window.bind_all("<Key>", self._on_key)

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

        if not self.recording:
            return

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


def _daemon_port_file(model_dir):
    model_id = os.path.basename(os.path.realpath(model_dir).rstrip("/"))
    return f"/tmp/simply-transcribe-{model_id}.port"


def _daemon_pid_file(model_dir):
    model_id = os.path.basename(os.path.realpath(model_dir).rstrip("/"))
    return f"/tmp/simply-transcribe-{model_id}.pid"


def _daemon_is_running(model_dir):
    """Check if a daemon PID exists and process is alive. Cleans stale files."""
    pid_file = _daemon_pid_file(model_dir)
    if not os.path.exists(pid_file):
        return False
    try:
        with open(pid_file) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        # Stale PID — clean up
        port_file = _daemon_port_file(model_dir)
        for f in (pid_file, port_file):
            if os.path.exists(f):
                os.remove(f)
        return False


def _daemon_ready(model_dir):
    """Check if daemon is fully loaded and accepting connections."""
    port_file = _daemon_port_file(model_dir)
    if not os.path.exists(port_file):
        return False
    try:
        with open(port_file) as f:
            port = int(f.read().strip())
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        sock.connect(("127.0.0.1", port))
        sock.close()
        return True
    except (OSError, ValueError):
        return False


def _stop_daemon(model_dir):
    """Send SIGTERM to the daemon for this model.  Returns True if stopped."""
    pid_file = _daemon_pid_file(model_dir)
    port_file = _daemon_port_file(model_dir)
    if not os.path.exists(pid_file):
        return False
    try:
        with open(pid_file) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        os.kill(pid, signal.SIGTERM)
        # Wait a moment for cleanup
        time.sleep(0.5)
        for f in (pid_file, port_file):
            if os.path.exists(f):
                os.remove(f)
        return True
    except OSError:
        return False


def _try_daemon(audio_path, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    try:
        sock.connect(("127.0.0.1", port))
        sock.sendall(audio_path.encode())
        response = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk
        result = json.loads(response)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result["text"]
    finally:
        sock.close()


def _start_daemon_background(model_dir, device):
    if _daemon_is_running(model_dir):
        return  # already serving this model

    log_file = f"/tmp/simply-transcribe-{os.path.basename(os.path.realpath(model_dir).rstrip('/'))}.log"
    log_fd = open(log_file, "a")
    print(f"--- daemon starting at {time.strftime('%Y-%m-%d %H:%M:%S')} ---", file=log_fd, flush=True)

    daemon_script = os.path.join(os.path.dirname(os.path.realpath(__file__)), "model_daemon.py")
    subprocess.Popen(
        [sys.executable, daemon_script, "--model-dir", model_dir, "--device", device],
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=log_fd,
        stderr=log_fd,
    )
    # log_fd intentionally left open — daemon writes to it


def transcribe_audio_openvino(file_path, model_dir=None, device=None):
    model_dir = model_dir or OPENVINO_MODEL_DIR
    device = device or OPENVINO_DEVICE
    t_total = time.time()

    daemon_running = _daemon_is_running(model_dir)
    daemon_ready = _daemon_ready(model_dir)
    print(f"[transcribe] daemon running={daemon_running} ready={daemon_ready}")

    if daemon_ready:
        try:
            with open(_daemon_port_file(model_dir)) as f:
                port = int(f.read().strip())
            t_req = time.time()
            result = _try_daemon(file_path, port)
            print(f"[transcribe] daemon path | total={time.time() - t_total:.1f}s | request={time.time() - t_req:.1f}s")
            return result
        except (ValueError, ConnectionRefusedError, OSError, json.JSONDecodeError) as e:
            print(f"[transcribe] daemon died mid-request ({type(e).__name__}: {e}), falling back to direct")

    print("[transcribe] direct path (cold start)")
    t_load = time.time()
    import transcribe_openvino
    result = transcribe_openvino.transcribe(
        file_path, model_dir=model_dir, device=device,
    )
    print(f"[transcribe] direct path | total={time.time() - t_total:.1f}s | load+infer={time.time() - t_load:.1f}s")
    print(f"Transcribed Text: {result['text']}")

    _start_daemon_background(model_dir, device)

    return result["text"]


def transcribe_audio(file_path, provider="huggingface", model_dir=None, device=None):
    if provider == "openvino":
        return transcribe_audio_openvino(file_path, model_dir=model_dir, device=device)
    return transcribe_audio_huggingface(file_path)


def main():
    import fcntl

    try:
        lock_fd = open(LOCK_FILE, "w")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (IOError, OSError):
        print("Another instance is already running. Exiting.", file=sys.stderr)
        sys.exit(0)

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
    parser.add_argument(
        "--stop-daemon",
        action="store_true",
        help="Stop the running OpenVINO model daemon and exit",
    )
    args = parser.parse_args()

    if args.stop_daemon:
        model_dir = args.model_dir or OPENVINO_MODEL_DIR
        if _daemon_is_running(model_dir):
            _stop_daemon(model_dir)
            print(f"Daemon for {model_dir} stopped.")
        else:
            print(f"No daemon running for {model_dir}.")
        sys.exit(0)

    provider = args.provider
    model_dir = args.model_dir
    device = args.device
    provider_label = "OpenVINO" if provider == "openvino" else "Hugging Face"

    if provider == "openvino":
        daemon_running = _daemon_is_running(model_dir)
        daemon_ready = _daemon_ready(model_dir)
        if daemon_running:
            try:
                with open(_daemon_pid_file(model_dir)) as f:
                    pid = int(f.read().strip())
                print(f"[main] daemon PID={pid} running={daemon_running} ready={daemon_ready}")
            except Exception:
                print(f"[main] daemon running={daemon_running} ready={daemon_ready}")
        else:
            print("[main] no daemon running — will cold start")

    recorder = RecordingGUI()
    recorder.start_recording()

    recorder.update_status(f"Transcribing ({provider_label})...")

    t_transcribe = time.time()
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

    print(f"[main] transcription total time: {time.time() - t_transcribe:.1f}s")

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
