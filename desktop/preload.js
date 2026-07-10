const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('moloptimaDesktop', {
  phase: '5A',
  shell: 'electron',
});
