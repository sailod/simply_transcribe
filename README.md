# 🎙️ VoiceType Pro: Speech-to-Text Made Simple ✨
Transform your thoughts into text effortlessly! Save time by speaking instead of typing with this intuitive voice transcription tool.

## 📦 Setup

> **Note:** All commands assume you are in the project root directory.
> Step 1 uses system `python3` to create the venv.
> From step 3 onward, `.venv/bin/python` and `.venv/bin/pip` are the venv's own — no system `pip` or Python packages are touched.

### 1. Create a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

If `python3 -m venv` is unavailable (some Linux distributions), use the standalone zipapp:

```bash
curl -sSLO https://github.com/pypa/virtualenv/releases/download/21.3.3/virtualenv.pyz
python3 virtualenv.pyz .venv
source .venv/bin/activate
rm virtualenv.pyz
```

### 2. Install system dependencies (Linux)

```bash
sudo apt install libportaudio2 python3-tk
```

### 3. Install Python dependencies

**Cloud transcription** (Hugging Face API — default):

```bash
.venv/bin/pip install -r requirements.txt
```

**Local GPU transcription** (OpenVINO — optional):

```bash
.venv/bin/pip install -r requirements-openvino.txt
```

### 4. Run

```bash
# Manual runs:
.venv/bin/python record_process_to_clipboard.py              # cloud (default)
.venv/bin/python record_process_to_clipboard.py --provider openvino  # local GPU

# Or use the standalone launcher (shorter, absolute paths internally):
./transcribe --provider openvino
```

### For local GPU transcription

See the [OpenVINO](#-local-transcription-with-openvino-optional) section below for model download and setup.

---

## 🚀 How to Use

For the most efficient workflow with this tool, follow these steps:

### 1. ⚙️ Setup Hotkey (Recommended)
- Use your operating system's hotkey manager or a third-party tool like AutoHotkey (Windows) or Keyboard Maestro (Mac)
- Create a hotkey combination (e.g., `Ctrl+Alt+R`) to launch the `transcribe` script
- This allows you to start recording instantly from any application

```bash
# Single command — encapsulates venv and all dependencies:
/path/to/simply_transcribe/transcribe --provider openvino
```

The `transcribe` script uses `.venv/bin/python` directly — no activation needed, no PATH concerns.

### 2. 🎤 Recording Process
- When you trigger the hotkey, a simple recording window will appear
- The window contains a single "Stop Recording" button
- Speak clearly into your microphone to record your message

### 3. 🔄 Transcription
- Click the "Stop Recording" button when finished
- The audio will automatically be sent to Whisper Large V3 model for transcription
- Wait a few moments while processing occurs

### 4. 📋 Using the Result
- The transcribed text is automatically copied to your clipboard
- Simply paste (`Ctrl+V` or `Cmd+V`) anywhere you need the text
- No need to manually copy or save - it's ready to use immediately

This workflow allows you to quickly convert speech to text without interrupting your work process. Perfect for note-taking, drafting emails, or any situation where typing might slow you down. ✨

---

## 🧠 Local Transcription with OpenVINO (Optional)

For English-only audio, you can run transcription **locally on your GPU** using Whisper Large v3 via OpenVINO — no internet required after setup.

### 1. Install extra dependencies

```bash
.venv/bin/pip install -r requirements-openvino.txt
```

### 2. Download the model (~1.5 GB)

```bash
.venv/bin/pip install huggingface-hub
.venv/bin/hf download \
  OpenVINO/whisper-large-v3-int8-ov \
  --local-dir models/whisper-large-v3
```

### 3. Run with the OpenVINO provider

```bash
./transcribe --provider openvino
```

Or set the environment variable:

```bash
export TRANSCRIPTION_PROVIDER=openvino
./transcribe
```

### Usage notes

- **Model directory**: customize via `OPENVINO_MODEL_DIR` env var (default: `models/whisper-large-v3`)
- **Device**: customize via `OPENVINO_DEVICE` env var (default: `GPU`; auto-falls back to `CPU` if GPU unavailable)
- **First run**: download the model once with `hf download` (see step 2 above); subsequent runs are instant
- **Provider flag**: use `--provider huggingface` to switch back to the cloud API at any time

### How it works

Instead of sending audio to the Hugging Face Inference API, the `--provider openvino` flag runs Whisper Large v3 locally via OpenVINO GenAI. The model loads into GPU memory, transcribes your audio on-device, and returns the result — all without an internet connection.

https://github.com/user-attachments/assets/482448f6-e253-4dba-bf32-52117424a517


