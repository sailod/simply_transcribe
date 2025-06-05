const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'api', {
        startRecording: () => ipcRenderer.invoke('start-recording'),
        stopRecording: () => ipcRenderer.invoke('stop-recording'),
        onStatusUpdate: (callback) => {
            ipcRenderer.on('status-update', (event, ...args) => callback(...args));
        }
    }
); 