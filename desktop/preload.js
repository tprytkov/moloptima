const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moloptimaDesktop', {
  phase: '5A',
  shell: 'electron',
  openUserManual: (sectionId) => ipcRenderer.invoke('moloptima:open-user-manual', sectionId),
});
