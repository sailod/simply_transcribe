// Get DOM elements
const recordButton = document.getElementById('recordButton');
const statusDiv = document.getElementById('status');
let recording = false;

function updateButtonState() {
    if (recording) {
        recordButton.textContent = '⏹️ Stop Recording';
        statusDiv.classList.add('recording');
    } else {
        recordButton.textContent = '🎤 Start Recording';
        statusDiv.classList.remove('recording');
    }
}

async function startRecording() {
    console.log('Renderer: Starting recording...');
    recording = true;
    updateButtonState();
    statusDiv.textContent = 'Recording...';
    
    try {
        const result = await window.api.startRecording();
        console.log('Renderer: Start recording result:', result);
    } catch (error) {
        console.error('Renderer: Error starting recording:', error);
        statusDiv.textContent = 'Error starting recording';
        recording = false;
        updateButtonState();
    }
}

async function stopRecording() {
    console.log('Renderer: Stopping recording...');
    recording = false;
    updateButtonState();
    statusDiv.textContent = 'Processing...';

    try {
        const result = await window.api.stopRecording();
        console.log('Renderer: Stop recording result:', result);
    } catch (error) {
        console.error('Renderer: Error stopping recording:', error);
        statusDiv.textContent = 'Error during processing';
    }
}

// Listen for status updates from the main process
window.api.onStatusUpdate((status) => {
    console.log('Renderer: Status update:', status);
    statusDiv.textContent = status;
});

// Listen for auto-started recording notification
window.api.onRecordingStartedAuto(() => {
    console.log('Renderer: Recording started automatically');
    recording = true;
    updateButtonState();
});

recordButton.addEventListener('click', () => {
    console.log('Renderer: Button clicked, recording state:', recording);
    if (!recording) {
        startRecording();
    } else {
        stopRecording();
    }
}); 