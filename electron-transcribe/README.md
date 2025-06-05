# Electron Transcribe

A simple desktop app for recording audio and transcribing it to text using OpenAI Whisper or Hugging Face APIs. The transcribed text is automatically copied to your clipboard.

## Features

- 🎙️ Real-time audio recording
- 🤖 AI-powered transcription (OpenAI Whisper or Hugging Face)
- 📋 Automatic clipboard integration
- 🖥️ Cross-platform desktop app (Linux, Windows, macOS)
- 🔒 Secure sandboxed environment

## System Dependencies

### Required

1. **Node.js** (v16 or higher)
   ```bash
   # Check version
   node --version
   npm --version
   ```

2. **FFmpeg** (for audio format conversion)
   ```bash
   # Ubuntu/Debian
   sudo apt install ffmpeg
   
   # Or using Snap
   sudo snap install ffmpeg
   
   # macOS (with Homebrew)
   brew install ffmpeg
   
   # Windows (with Chocolatey)
   choco install ffmpeg
   ```

3. **Audio System**
   - Linux: ALSA audio drivers
   - Windows: Standard audio drivers
   - macOS: Core Audio

### Audio Device Requirements

The app currently uses audio device `plughw:0,6`. To check your available audio devices:

```bash
# List audio input devices
arecord -l

# Test recording (Linux)
arecord -D plughw:0,6 -f S32_LE -r 48000 -c 2 test.wav
```

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd electron-transcribe
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the project root:
   ```bash
   # Choose ONE API service:
   
   # Option 1: OpenAI Whisper API (recommended)
   USE_OPENAI_API=true
   OPENAI_API_TOKEN=your_openai_api_key_here
   
   # Option 2: Hugging Face API (free alternative)
   USE_OPENAI_API=false
   HUGGINGFACE_API_KEY=your_huggingface_api_key_here
   
   # Optional: Enable developer tools for debugging
   DEBUG_DEVTOOLS=false
   
   # Optional: Auto-close app after successful transcription (defaults to true for hotkey workflows)
   # Set to 'false' to disable auto-close behavior
   AUTO_CLOSE_AFTER_TRANSCRIPTION=true
   ```

## Getting API Keys

### OpenAI API (Recommended)
1. Visit [OpenAI API Platform](https://platform.openai.com/)
2. Create an account and add billing information
3. Generate an API key from the API Keys section
4. Cost: ~$0.006 per minute of audio

### Hugging Face API (Free Alternative)
1. Visit [Hugging Face](https://huggingface.co/)
2. Create a free account
3. Go to Settings → Access Tokens
4. Create a new token with "Read" permissions
5. Note: May have rate limits and slower processing

## Usage

### Development Mode
```bash
# Start the app
npm start

# Start with debugging enabled
npm run debug

# Start with DevTools open
DEBUG_DEVTOOLS=true npm start
```

### Using the App

**Standard Mode (manual control):**
1. Click **"Start Recording"** to begin audio capture
2. Speak into your microphone
3. Click **"Stop Recording"** to end recording and start transcription
4. Wait for transcription to complete
5. The transcribed text will be automatically copied to your clipboard

**Hotkey Mode (streamlined workflow):**
1. Launch the app (recording starts automatically)
2. Speak into your microphone
3. Click **"Stop Recording"** or use the UI to stop
4. Wait for transcription to complete
5. App automatically closes after copying text to clipboard

### Keyboard Shortcuts
- **Ctrl+V** (or **Cmd+V** on macOS): Paste the transcribed text anywhere

## Hotkey Workflow Setup

For power users who want to integrate transcription into their workflow using global hotkeys:

### **Quick Transcription Workflow:**
1. Set up a global hotkey to launch the app (auto-close is enabled by default)
2. **Streamlined workflow:** Hotkey → App opens & starts recording → Speak → Stop recording → Auto-transcribe → Auto-close → Paste anywhere

### **To disable auto-close (for manual control):**
```bash
# In your .env file:
AUTO_CLOSE_AFTER_TRANSCRIPTION=false
```

### **Setting Up Global Hotkeys (Ubuntu/GNOME):**

```bash
# Method 1: Using gnome-settings (GUI)
gnome-control-center keyboard

# Method 2: Using gsettings (CLI)
# Step 1: Add a new custom keybinding slot
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"

# Step 2: Set the name for this keybinding
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Quick Transcribe'

# Step 3: Set your full command with environment variables
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command 'USE_OPENAI_API=true OPENAI_API_TOKEN="XXXX" /path/to/app/simply_transcribe'

# Step 4: Set the hotkey to Super+[
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding '<Super>bracketleft'
```

### **Workflow Benefits:**
- **Super fast:** Press hotkey → speak → get text in clipboard
- **No manual interaction:** Fully automated workflow
- **Hands-free:** Perfect for dictation while typing in other apps
- **Universal:** Works with any application that accepts pasted text

## Building for Production

```bash
# Build executable for your platform
npm run build

# Output will be in the dist/ folder:
# - Linux: electron-transcribe-1.0.0.AppImage
# - Windows: electron-transcribe Setup 1.0.0.exe
# - macOS: electron-transcribe-1.0.0.dmg
```

## Troubleshooting

### Audio Issues

**"No audio data recorded" error:**
```bash
# Check if your audio device works
arecord -D plughw:0,6 -f S32_LE -r 48000 -c 2 -d 5 test.wav
aplay test.wav

# If no sound, try different device numbers:
arecord -l  # List all devices
arecord -D plughw:0,0 -f cd -d 5 test2.wav  # Try default device
```

**Device not found:**
- Edit `main.js` and change `device: 'plughw:0,6'` to your working device
- Or use `device: 'default'` for auto-detection

