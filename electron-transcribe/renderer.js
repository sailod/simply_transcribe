// Get DOM elements
const recordButton = document.getElementById('recordButton');
const statusDiv = document.getElementById('status');
let recording = false;

async function startRecording() {
    console.log('Renderer: Starting recording...');
    recording = true;
    recordButton.textContent = '⏹️ Stop Recording';
    statusDiv.textContent = 'Recording...';
    statusDiv.classList.add('recording');
    
    try {
        const result = await window.api.startRecording();
        console.log('Renderer: Start recording result:', result);
    } catch (error) {
        console.error('Renderer: Error starting recording:', error);
        statusDiv.textContent = 'Error starting recording';
        recording = false;
        recordButton.textContent = '🎤 Start Recording';
        statusDiv.classList.remove('recording');
    }
}

async function stopRecording() {
    console.log('Renderer: Stopping recording...');
    recording = false;
    recordButton.textContent = '🎤 Start Recording';
    statusDiv.textContent = 'Processing...';
    statusDiv.classList.remove('recording');

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

recordButton.addEventListener('click', () => {
    console.log('Renderer: Button clicked, recording state:', recording);
    if (!recording) {
        startRecording();
    } else {
        stopRecording();
    }
}); 