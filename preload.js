const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updater', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', cb),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', cb),
  onUpdateAvailableMac: (cb) => ipcRenderer.on('update-available-mac', cb),
  install: () => ipcRenderer.invoke('updater:install')
});
contextBridge.exposeInMainWorld('api', {
  income: {
    getAll: () => ipcRenderer.invoke('income:getAll'),
    add: (d) => ipcRenderer.invoke('income:add', d),
    update: (d) => ipcRenderer.invoke('income:update', d),
    delete: (id) => ipcRenderer.invoke('income:delete', id)
  },
  expense: {
    getAll: () => ipcRenderer.invoke('expense:getAll'),
    add: (d) => ipcRenderer.invoke('expense:add', d),
    update: (d) => ipcRenderer.invoke('expense:update', d),
    delete: (id) => ipcRenderer.invoke('expense:delete', id)
  },
  receivables: {
    getAll: () => ipcRenderer.invoke('receivables:getAll'),
    add: (d) => ipcRenderer.invoke('receivables:add', d),
    update: (d) => ipcRenderer.invoke('receivables:update', d),
    markPaid: (id) => ipcRenderer.invoke('receivables:markPaid', id),
    delete: (id) => ipcRenderer.invoke('receivables:delete', id),
    importCSV: () => ipcRenderer.invoke('receivables:importCSV')
  },
  customers: {
    getAll: () => ipcRenderer.invoke('customers:getAll'),
    add: (d) => ipcRenderer.invoke('customers:add', d),
    update: (d) => ipcRenderer.invoke('customers:update', d),
    delete: (id) => ipcRenderer.invoke('customers:delete', id),
    importCSV: () => ipcRenderer.invoke('customers:importCSV'),
    autoAdd: (d) => ipcRenderer.invoke('customers:autoAdd', d)
  },
  export: { csv: () => ipcRenderer.invoke('export:csv') },
  db: {
    backup: () => ipcRenderer.invoke('db:backup'),
    restore: () => ipcRenderer.invoke('db:restore')
  },
  excel: {
    openDialog: () => ipcRenderer.invoke('excel:openDialog'),
    downloadTemplate: () => ipcRenderer.invoke('excel:downloadTemplate'),
    importTemplate: () => ipcRenderer.invoke('excel:importTemplate')
  },
  app: { openDataFolder: () => ipcRenderer.invoke('app:openDataFolder') },
  google: {
    checkAuth: () => ipcRenderer.invoke('google:checkAuth'),
    authorize: () => ipcRenderer.invoke('google:authorize'),
    fetchInvoices: (d) => ipcRenderer.invoke('google:fetchInvoices', d),
    revokeAuth: () => ipcRenderer.invoke('google:revokeAuth')
  },
  ai: {
    analyzeImage: (d) => ipcRenderer.invoke('ai:analyzeImage', d),
    analyzeExcel: (d) => ipcRenderer.invoke('ai:analyzeExcel', d)
  }
});
