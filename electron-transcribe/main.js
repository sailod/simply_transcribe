const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const mic = require('mic');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { exec } = require('child_process');
require('dotenv').config();

// Configuration
const MODEL_NAME = "openai/whisper-large-v3-turbo";
const API_URL = `https://api-inference.huggingface.co/models/${MODEL_NAME}`;
const API_TOKEN = process.env.HUGGINGFACE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_TOKEN;
const USE_OPENAI_API = process.env.USE_OPENAI_API === 'true';

// Global variables
let mainWindow;
let micInstance;
let micInputStream;
let fileStream;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (process.env.DEBUG_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.loadFile('index.html');
  
  // Auto-start recording when app starts (useful for hotkey workflows)
  mainWindow.webContents.once('did-finish-load', () => {
    // Small delay to ensure UI is ready
    setTimeout(async () => {
      try {
        fileStream = fs.createWriteStream('recording.wav', { encoding: 'binary' });

        micInstance = mic({
          rate: '48000',
          channels: '2',
          fileType: 'wav',
          device: 'plughw:0,6'
        });
        
        micInputStream = micInstance.getAudioStream();
        micInputStream.pipe(fileStream);
        micInstance.start();
        
        // Notify renderer that recording started automatically
        mainWindow.webContents.send('recording-started-auto');
        mainWindow.webContents.send('status-update', 'Recording started automatically...');
      } catch (error) {
        console.error('Auto-start recording failed:', error);
        mainWindow.webContents.send('status-update', 'Auto-start recording failed. Click Start Recording to try again.');
      }
    }, 500);
  });
}

// Helper functions
function cleanupFiles(files) {
  files.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
}

function convertAudio(input, output) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i ${input} -ac 1 -ar 16000 -sample_fmt s16 ${output}`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('Audio conversion failed:', error.message);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function transcribeWithOpenAI(audioFile) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioFile));
  form.append('model', 'whisper-1');
  
  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      ...form.getHeaders()
    }
  });
  
  return response.data.text;
}

async function transcribeWithHuggingFace(audioFile) {
  const audioData = fs.readFileSync(audioFile);
  
  const response = await axios.post(API_URL, audioData, {
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'audio/wav'
    }
  });
  
  return response.data.text;
}

// IPC handlers
ipcMain.handle('start-recording', async () => {
  try {
    fileStream = fs.createWriteStream('recording.wav', { encoding: 'binary' });

    micInstance = mic({
      rate: '48000',
      channels: '2',
      fileType: 'wav',
      device: 'plughw:0,6'
    });
    
    micInputStream = micInstance.getAudioStream();
    micInputStream.pipe(fileStream);
    micInstance.start();
    
    return true;
  } catch (error) {
    console.error('Recording start failed:', error.message);
    throw error;
  }
});

ipcMain.handle('stop-recording', async () => {
  const inputFile = 'recording.wav';
  const outputFile = 'converted.wav';
  
  try {
    // Stop recording
    if (micInstance) micInstance.stop();
    if (fileStream) fileStream.end();

    // Wait for file to be written
    await new Promise(resolve => setTimeout(resolve, 500));

    // Validate recorded file
    if (!fs.existsSync(inputFile) || fs.statSync(inputFile).size === 0) {
      throw new Error('No audio data recorded');
    }

    // Convert audio for API compatibility
    await convertAudio(inputFile, outputFile);
    
    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
      throw new Error('Audio conversion failed');
    }

    // Transcribe audio
    let transcribedText;
    try {
      if (USE_OPENAI_API) {
        transcribedText = await transcribeWithOpenAI(outputFile);
      } else {
        transcribedText = await transcribeWithHuggingFace(outputFile);
      }
    } catch (error) {
      const service = USE_OPENAI_API ? 'OpenAI' : 'Hugging Face';
      console.error(`${service} transcription failed:`, error.message);
      mainWindow.webContents.send('status-update', `Error during ${service} transcription.`);
      cleanupFiles([inputFile, outputFile]);
      throw error;
    }

    // Copy to clipboard and cleanup
    clipboard.writeText(transcribedText);
    cleanupFiles([inputFile, outputFile]);
    mainWindow.webContents.send('status-update', 'Transcription copied to clipboard!');
    
    // Auto-close app if environment variable is set (useful for hotkey workflows)
    if (process.env.AUTO_CLOSE_AFTER_TRANSCRIPTION !== 'false') {
      setTimeout(() => {
        app.quit();
      }, 2000); // Wait 2 seconds to show the success message
    }
    
    return true;
  } catch (error) {
    mainWindow.webContents.send('status-update', 'Error during transcription. Please try again.');
    cleanupFiles([inputFile, outputFile]);
    throw error;
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
}); 