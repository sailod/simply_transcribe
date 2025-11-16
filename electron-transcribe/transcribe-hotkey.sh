#!/bin/bash
# this is script to allow injection of the right needed env variables for the hotkey trigger
# youll need to run those after extracting the AppImage (./electron-transcribe-1.0.0.AppImage --appimage-extract)
# sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox
export LOCAL_MODEL="Xenova/whisper-tiny.en"
export USE_OPENAI_API=false
export OPENAI_API_TOKEN="REPLACE_WITH_YOUR_OPENAI_API_TOKEN"
./squashfs-root/AppRun
