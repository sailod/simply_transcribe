const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const mic = require('mic');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { exec } = require('child_process');
const wavefile = require('wavefile');
require('dotenv').config();

// Configuration
const MODEL_NAME = "openai/whisper-large-v3-turbo";
const API_URL = `https://api-inference.huggingface.co/models/${MODEL_NAME}`;
const API_TOKEN = process.env.HUGGINGFACE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_TOKEN;

// Legacy configuration (still supported for backward compatibility)
const USE_OPENAI_API = process.env.USE_OPENAI_API === 'true';

// New configuration: Transcription provider: 'local', 'openai', 'huggingface'
const TRANSCRIPTION_PROVIDER = process.env.TRANSCRIPTION_PROVIDER || 'local';

// Local Whisper Models Reference
// Choose based on your needs: speed vs accuracy vs memory
const WHISPER_MODELS = {
  'Xenova/whisper-tiny.en': {
    size: '~40MB',
    speed: '⚡⚡⚡ Fastest',
    accuracy: 'Good',
    languages: 'English only',
    memory: '~500MB RAM',
    transcribeTime: '~2-3s per 10s audio',
    recommended: 'Quick testing, real-time transcription',
    description: 'Smallest and fastest model. Good for quick transcriptions where perfect accuracy is not critical.'
  },
  'Xenova/whisper-tiny': {
    size: '~75MB',
    speed: '⚡⚡⚡ Fastest',
    accuracy: 'Good',
    languages: 'Multilingual (99 languages)',
    memory: '~600MB RAM',
    transcribeTime: '~2-4s per 10s audio',
    recommended: 'Multilingual quick transcription',
    description: 'Fast multilingual model. Supports 99 languages with decent accuracy.'
  },
  'Xenova/whisper-base.en': {
    size: '~75MB',
    speed: '⚡⚡ Fast',
    accuracy: 'Better',
    languages: 'English only',
    memory: '~600MB RAM',
    transcribeTime: '~4-6s per 10s audio',
    recommended: 'Balanced English transcription',
    description: 'Better accuracy than tiny with still fast performance. Good balance for English.'
  },
  'Xenova/whisper-base': {
    size: '~145MB',
    speed: '⚡⚡ Fast',
    accuracy: 'Better',
    languages: 'Multilingual (99 languages)',
    memory: '~800MB RAM',
    transcribeTime: '~4-7s per 10s audio',
    recommended: 'Balanced multilingual transcription',
    description: 'Better multilingual accuracy with reasonable speed.'
  },
  'Xenova/whisper-small.en': {
    size: '~245MB',
    speed: '⚡ Medium',
    accuracy: 'High',
    languages: 'English only',
    memory: '~1.5GB RAM',
    transcribeTime: '~8-12s per 10s audio',
    recommended: 'High-quality English transcription',
    description: 'High accuracy for English. Best choice if you need quality and have time.'
  },
  'Xenova/whisper-small': {
    size: '~485MB',
    speed: '⚡ Slower',
    accuracy: 'High',
    languages: 'Multilingual (99 languages)',
    memory: '~2GB RAM',
    transcribeTime: '~10-15s per 10s audio',
    recommended: 'High-quality multilingual transcription',
    description: 'High accuracy across 99 languages. Use when accuracy is more important than speed.'
  },
  'Xenova/whisper-medium': {
    size: '~1.5GB',
    speed: '🐌 Slow',
    accuracy: 'Very High',
    languages: 'Multilingual (99 languages)',
    memory: '~5GB RAM',
    transcribeTime: '~20-30s per 10s audio',
    recommended: 'Professional-grade transcription',
    description: 'Very high accuracy. Overkill for most use cases but great for professional needs.'
  },
  'Xenova/whisper-large-v2': {
    size: '~3GB',
    speed: '🐌🐌 Very Slow',
    accuracy: 'Best',
    languages: 'Multilingual (99 languages)',
    memory: '~10GB RAM',
    transcribeTime: '~40-60s per 10s audio',
    recommended: 'Maximum accuracy (rarely needed)',
    description: 'Best possible accuracy. Very resource-intensive. Only use if you need perfection.'
  }
};

// Local model options: Choose from WHISPER_MODELS above
// Default to tiny.en for fastest initial experience
const LOCAL_MODEL = process.env.LOCAL_MODEL || 'Xenova/whisper-tiny.en';

// Validate and log model info
if (TRANSCRIPTION_PROVIDER === 'local') {
  const modelInfo = WHISPER_MODELS[LOCAL_MODEL];
  if (modelInfo) {
    console.log(`\n🎤 Local Whisper Model: ${LOCAL_MODEL}`);
    console.log(`   Size: ${modelInfo.size} | Speed: ${modelInfo.speed} | Accuracy: ${modelInfo.accuracy}`);
    console.log(`   Languages: ${modelInfo.languages}`);
    console.log(`   ${modelInfo.description}\n`);
  } else {
    console.warn(`⚠️  Unknown model: ${LOCAL_MODEL}. Using anyway...`);
  }
}

// Global variables
let mainWindow;
let micInstance;
let micInputStream;
let fileStream;
let transcriber = null; // Cache the transcriber pipeline

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
          device: 'default'
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

async function transcribeWithLocalWhisper(audioFile) {
  try {
    console.log(`Loading local Whisper model: ${LOCAL_MODEL}`);
    
    // Dynamically import transformers.js (ES Module)
    const { pipeline } = await import('@xenova/transformers');
    
    // Initialize the pipeline (cached after first use)
    if (!transcriber) {
      transcriber = await pipeline('automatic-speech-recognition', LOCAL_MODEL);
      console.log('Model loaded successfully');
    }
    
    // Read and process the audio file for Node.js environment
    console.log('Reading audio file...');
    const audioBuffer = fs.readFileSync(audioFile);
    const wav = new wavefile.WaveFile(audioBuffer);
    
    // Convert to the format expected by transformers.js
    // Whisper expects 16kHz mono audio
    wav.toSampleRate(16000);
    
    // Convert to mono if stereo
    if (wav.fmt.numChannels > 1) {
      wav.toMono();
    }
    
    // Get the audio samples
    let audioData = wav.getSamples();
    
    // Convert to Float32Array normalized between -1 and 1
    const bitDepth = wav.bitDepth === '32f' ? 32 : parseInt(wav.bitDepth);
    const maxValue = bitDepth === 32 ? 1.0 : Math.pow(2, bitDepth - 1);
    
    const float32Audio = new Float32Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      float32Audio[i] = audioData[i] / maxValue;
    }
    
    // Transcribe the audio data
    console.log('Transcribing audio...');
    const result = await transcriber(float32Audio);
    
    console.log('Transcription completed');
    return result.text;
  } catch (error) {
    console.error('Local transcription error:', error);
    throw new Error(`Local transcription failed: ${error.message}`);
  }
}

// IPC handlers
ipcMain.handle('start-recording', async () => {
  try {
    fileStream = fs.createWriteStream('recording.wav', { encoding: 'binary' });

    micInstance = mic({
      rate: '48000',
      channels: '2',
      fileType: 'wav',
      device: 'default'
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
    // Priority order: local > openai (new or legacy) > huggingface (default)
    // This maintains backward compatibility with USE_OPENAI_API flag
    let transcribedText;
    let serviceName;
    try {
      if (TRANSCRIPTION_PROVIDER === 'local') {
        serviceName = 'Local Whisper';
        mainWindow.webContents.send('status-update', 'Transcribing with local Whisper model...');
        transcribedText = await transcribeWithLocalWhisper(outputFile);
      } else if (TRANSCRIPTION_PROVIDER === 'openai' || USE_OPENAI_API) {
        // Supports both new (TRANSCRIPTION_PROVIDER=openai) and legacy (USE_OPENAI_API=true)
        serviceName = 'OpenAI';
        mainWindow.webContents.send('status-update', 'Transcribing with OpenAI...');
        transcribedText = await transcribeWithOpenAI(outputFile);
      } else {
        // Default: Hugging Face (maintains backward compatibility)
        serviceName = 'Hugging Face';
        mainWindow.webContents.send('status-update', 'Transcribing with Hugging Face...');
        transcribedText = await transcribeWithHuggingFace(outputFile);
      }
    } catch (error) {
      console.error(`${serviceName} transcription failed:`, error.message);
      mainWindow.webContents.send('status-update', `Error during ${serviceName} transcription.`);
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