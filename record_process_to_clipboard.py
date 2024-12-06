import pyaudio
import wave
import requests
import pyperclip
import os
import tkinter as tk
from tkinter import ttk
from dotenv import load_dotenv
load_dotenv()

# Constants
WAVE_OUTPUT_FILENAME = "output.wav"
API_URL = "https://api-inference.huggingface.co/models/openai/whisper-large-v3"
API_TOKEN = os.getenv('HUGGINGFACE_API_KEY')

class RecordingGUI:
    def __init__(self):
        self.recording = False
        self.frames = []
        self.audio = None
        self.stream = None
        
    def start_recording(self):
        self.recording = True
        self.frames = []
        
        # Create GUI window
        self.window = tk.Tk()
        self.window.title("Recording")
        self.window.geometry("200x120")  # Increased window size
        
        # Create stop button
        stop_button = ttk.Button(
            self.window,
            text="⏹️ Stop Recording",
            command=self.stop_recording,
            style='Big.TButton'  # Custom style for bigger button
        )
        
        # Configure button style
        style = ttk.Style()
        style.configure('Big.TButton', padding=10, font=('Arial', 12, 'bold'))
        
        stop_button.pack(expand=True, fill='both', padx=15, pady=15)  # Increased padding
        
        # Setup audio recording
        self.audio = pyaudio.PyAudio()
        self.stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=44100,
            input=True,
            frames_per_buffer=1024
        )
        
        print("Recording started...")
        self.record_frame()
        self.window.mainloop()
        
    def record_frame(self):
        if self.recording:
            data = self.stream.read(1024)
            self.frames.append(data)
            self.window.after(1, self.record_frame)
            
    def stop_recording(self):
        self.recording = False
        
        # Stop and close the stream
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
        if self.audio:
            self.audio.terminate()
            
        # Save the recorded data as a WAV file
        with wave.open(WAVE_OUTPUT_FILENAME, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(self.audio.get_sample_size(pyaudio.paInt16))
            wf.setframerate(44100)
            wf.writeframes(b''.join(self.frames))
            
        print("Recording finished.")
        self.window.destroy()

def transcribe_audio(file_path):
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

def main():
    print("Starting recording...")
    recorder = RecordingGUI()
    recorder.start_recording()
    transcribed_text = transcribe_audio(WAVE_OUTPUT_FILENAME)
    if transcribed_text:
        pyperclip.copy(transcribed_text)
        print("Transcribed text copied to clipboard.")
    # Clean up the audio file
    if os.path.exists(WAVE_OUTPUT_FILENAME):
        os.remove(WAVE_OUTPUT_FILENAME)
        print(f"Deleted temporary audio file: {WAVE_OUTPUT_FILENAME}")

if __name__ == "__main__":
    main()
