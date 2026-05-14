const { app, BrowserWindow, ipcMain, clipboard } = require('electron');

// Disable GPU acceleration to prevent system-wide freezes on Linux/GNOME/Wayland.
// Chromium's VSync query (GetVSyncParametersIfAvailable()) fragments GPU contexts when it
// fails, which combined with rapid spawn/exit cycles saturates the compositor's frame-sync
// queue. This must execute before app.whenReady() and any BrowserWindow creation.
app.disableHardwareAcceleration();

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
const LOCAL_MODEL = process.env.LOCAL_MODEL || 'Xenova/whisper-base.en';

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
    // Increase maxBuffer for longer audio files (default is 1MB, we need more for 3+ minute recordings)
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Audio conversion failed:', error.message);
        reject(error);
      } else {
        console.log(`Audio converted: ${input} → ${output}`);
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
    
    // Find min/max to check audio levels
    let min = float32Audio[0], max = float32Audio[0];
    for (let i = 1; i < float32Audio.length; i++) {
      if (float32Audio[i] < min) min = float32Audio[i];
      if (float32Audio[i] > max) max = float32Audio[i];
    }
    
    const durationSeconds = float32Audio.length / 16000;
    console.log(`Audio: ${float32Audio.length} samples (${durationSeconds.toFixed(1)} seconds)`);
    console.log(`Audio range: min=${min.toFixed(3)}, max=${max.toFixed(3)}`);
    
    // Normalize audio levels if too quiet (common issue with some microphones)
    // Whisper works best with audio levels around -0.5 to 0.5
    const peakLevel = Math.max(Math.abs(min), Math.abs(max));
    if (peakLevel < 0.1) {
      console.log(`⚠ Audio is very quiet (peak: ${peakLevel.toFixed(3)}). Amplifying...`);
      const amplificationFactor = 0.5 / peakLevel; // Target peak of 0.5
      for (let i = 0; i < float32Audio.length; i++) {
        float32Audio[i] = Math.max(-1, Math.min(1, float32Audio[i] * amplificationFactor));
      }
      // Recalculate after amplification
      min = float32Audio[0];
      max = float32Audio[0];
      for (let i = 1; i < float32Audio.length; i++) {
        if (float32Audio[i] < min) min = float32Audio[i];
        if (float32Audio[i] > max) max = float32Audio[i];
      }
      console.log(`After amplification: min=${min.toFixed(3)}, max=${max.toFixed(3)}`);
    }
    
    // For longer audio (>30s), process in chunks to ensure complete transcription
    // This prevents the model from skipping content in longer recordings
    let transcribedText = '';
    
    if (durationSeconds <= 30) {
      // Short audio - process in one go
      console.log('Transcribing audio (single pass)...');
      const result = await transcriber(float32Audio);
      console.log('Raw result:', JSON.stringify(result, null, 2));
      transcribedText = result.text || result || '';
      console.log('Transcription completed');
    } else {
      // Long audio - process in 30-second overlapping chunks
      console.log(`Transcribing long audio (${durationSeconds.toFixed(1)}s) in chunks...`);
      const chunkSize = 30 * 16000; // 30 seconds worth of samples
      const overlapSize = 2 * 16000; // 2 seconds overlap
      const chunks = [];
      const chunkStep = chunkSize - overlapSize;
      const totalChunks = Math.ceil((float32Audio.length - overlapSize) / chunkStep);
      
      // Process chunks with retry logic for reliability
      for (let i = 0; i < float32Audio.length; i += chunkStep) {
        const chunkStart = i;
        const chunkEnd = Math.min(i + chunkSize, float32Audio.length);
        const chunk = float32Audio.slice(chunkStart, chunkEnd);
        const chunkNum = Math.floor(i / chunkStep) + 1;
        const chunkDuration = chunk.length / 16000;
        const chunkStartTime = chunkStart / 16000;
        const chunkEndTime = chunkEnd / 16000;
        
        console.log(`\nChunk ${chunkNum}/${totalChunks}: ${chunkStartTime.toFixed(1)}s - ${chunkEndTime.toFixed(1)}s (${chunkDuration.toFixed(1)}s)`);
        
        // Retry logic: try up to 3 times per chunk
        let chunkText = '';
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && !chunkText.trim()) {
          attempts++;
          try {
            console.log(`  Attempt ${attempts}/${maxAttempts}...`);
            const result = await transcriber(chunk);
            
            chunkText = result.text || result || '';
            if (chunkText.trim()) {
              chunks.push(chunkText.trim());
              console.log(`  ✓ Success: "${chunkText.substring(0, 50)}${chunkText.length > 50 ? '...' : ''}"`);
              break;
            } else {
              console.log(`  ⚠ Empty result (attempt ${attempts})`);
              if (attempts < maxAttempts) {
                console.log(`  Retrying in 1 second...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } catch (chunkError) {
            console.error(`  ✗ Error (attempt ${attempts}):`, chunkError.message);
            if (attempts < maxAttempts) {
              console.log(`  Retrying in 1 second...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        if (!chunkText.trim()) {
          console.error(`  ✗✗✗ FAILED: Chunk ${chunkNum} could not be transcribed after ${maxAttempts} attempts`);
          // Add placeholder so we know something is missing
          chunks.push(`[Chunk ${chunkNum} transcription failed]`);
        }
      }
      
      // Deduplicate overlapping text from chunks
      // The overlap causes words at boundaries to appear in multiple chunks
      let deduplicatedText = chunks[0] || '';
      
      for (let i = 1; i < chunks.length; i++) {
        const prevChunk = chunks[i - 1];
        const currentChunk = chunks[i];
        
        if (!currentChunk || currentChunk.includes('transcription failed')) {
          continue;
        }
        
        // Find overlap: look for common words at the end of prev and start of current
        // Simple approach: find the longest matching suffix/prefix
        const prevWords = prevChunk.trim().split(/\s+/);
        const currentWords = currentChunk.trim().split(/\s+/);
        
        // Try to find overlap (up to 10 words, roughly 2 seconds of speech)
        let overlapLength = 0;
        for (let len = Math.min(10, Math.min(prevWords.length, currentWords.length)); len > 0; len--) {
          const prevSuffix = prevWords.slice(-len).join(' ');
          const currentPrefix = currentWords.slice(0, len).join(' ');
          
          // Check if they match (case-insensitive, allow for punctuation differences)
          const normalizedPrev = prevSuffix.toLowerCase().replace(/[^\w\s]/g, '');
          const normalizedCurr = currentPrefix.toLowerCase().replace(/[^\w\s]/g, '');
          
          if (normalizedPrev === normalizedCurr && normalizedPrev.length > 5) {
            overlapLength = len;
            break;
          }
        }
        
        if (overlapLength > 0) {
          // Remove overlapping words from current chunk
          const newText = currentWords.slice(overlapLength).join(' ');
          deduplicatedText += ' ' + newText;
          console.log(`  Removed ${overlapLength} overlapping words between chunks ${i} and ${i+1}`);
        } else {
          // No clear overlap, just append
          deduplicatedText += ' ' + currentChunk;
        }
      }
      
      transcribedText = deduplicatedText.trim();
      const successfulChunks = chunks.filter(c => !c.includes('transcription failed')).length;
      console.log(`\nTranscription completed: ${successfulChunks}/${totalChunks} chunks successful`);
      
      if (successfulChunks < totalChunks) {
        console.warn(`⚠ WARNING: ${totalChunks - successfulChunks} chunks failed! Transcription may be incomplete.`);
      }
      
      console.log(`Chunk lengths: ${chunks.map(c => c.length).join(', ')} chars`);
      console.log(`After deduplication: ${transcribedText.length} chars (was ${chunks.join(' ').length})`);
    }
    
    console.log(`\nFinal result: ${transcribedText.length} characters`);
    console.log(`Text preview: ${transcribedText.substring(0, 200)}${transcribedText.length > 200 ? '...' : ''}`);
    
    return transcribedText;
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