const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let mainWindow;
let db;

function getDataDir() {
  // 安裝版存在 AppData（Windows）或 Application Support（Mac），開發版存在專案 data/
  const dir = app.isPackaged
    ? app.getPath('userData')
    : path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDataPath() {
  return path.join(getDataDir(), 'accounting.db');
}

function initDatabase() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = getDataPath();
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL, client TEXT NOT NULL, title TEXT NOT NULL,
        category TEXT NOT NULL, amount REAL NOT NULL, note TEXT DEFAULT '',
        source TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL, vendor TEXT NOT NULL, title TEXT NOT NULL,
        category TEXT DEFAULT '', amount REAL NOT NULL, note TEXT DEFAULT '',
        source TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS receivables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_date TEXT NOT NULL, due_date TEXT NOT NULL, client TEXT NOT NULL,
        description TEXT NOT NULL, invoice_no TEXT DEFAULT '', amount REAL NOT NULL,
        status TEXT DEFAULT 'pending', paid_date TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        aliases TEXT DEFAULT '',
        type TEXT DEFAULT 'both',
        category TEXT DEFAULT '',
        contact TEXT DEFAULT '',
        note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );
      -- 舊版資料庫自動補上 type 欄位
      PRAGMA journal_mode=WAL;
    `);
    // 舊版升級：補上 type 欄位
    try { db.exec("ALTER TABLE customers ADD COLUMN type TEXT DEFAULT 'both'"); } catch(e) {}
    console.log('資料庫路徑:', dbPath);
    return true;
  } catch (err) {
    console.error('DB init failed:', err);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 850, minWidth: 960, minHeight: 640,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '帳務管理系統 v2',
    show: false, backgroundColor: '#ffffff'
  });

  // Mac 鏡頭權限
  if (process.platform === 'darwin') {
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') callback(true);
      else callback(false);
    });
  }
  mainWindow.loadFile('src/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  // 安裝版才啟動自動更新
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-available', () => {
      mainWindow?.webContents.send('update-available');
    });
    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update-downloaded');
    });
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── 入帳 ──
ipcMain.handle('income:getAll', () => db.prepare('SELECT * FROM income ORDER BY date DESC').all());
ipcMain.handle('income:add', (_, d) => {
  const r = db.prepare('INSERT INTO income (date,client,title,category,amount,note,source) VALUES (?,?,?,?,?,?,?)').run(d.date,d.client,d.title,d.category,d.amount,d.note||'',d.source||'manual');
  return { id: r.lastInsertRowid, ...d };
});
ipcMain.handle('income:delete', (_, id) => { db.prepare('DELETE FROM income WHERE id=?').run(id); return true; });

// ── 出帳 ──
ipcMain.handle('expense:getAll', () => db.prepare('SELECT * FROM expense ORDER BY date DESC').all());
ipcMain.handle('expense:add', (_, d) => {
  const r = db.prepare('INSERT INTO expense (date,vendor,title,category,amount,note,source) VALUES (?,?,?,?,?,?,?)').run(d.date,d.vendor,d.title,d.category||'',d.amount,d.note||'',d.source||'manual');
  return { id: r.lastInsertRowid, ...d };
});
ipcMain.handle('expense:delete', (_, id) => { db.prepare('DELETE FROM expense WHERE id=?').run(id); return true; });
ipcMain.handle('expense:update', (_, d) => {
  db.prepare('UPDATE expense SET date=?,vendor=?,title=?,category=?,amount=?,note=? WHERE id=?')
    .run(d.date, d.vendor, d.title, d.category||'其他', d.amount, d.note||'', d.id);
  return true;
});

// ── 應收帳款 ──
ipcMain.handle('receivables:getAll', () => db.prepare('SELECT * FROM receivables ORDER BY due_date ASC').all());
ipcMain.handle('receivables:add', (_, d) => {
  const r = db.prepare('INSERT INTO receivables (issue_date,due_date,client,description,invoice_no,amount) VALUES (?,?,?,?,?,?)').run(d.issue,d.due,d.client,d.desc,d.invoice||'',d.amount);
  return { id: r.lastInsertRowid, ...d };
});
ipcMain.handle('receivables:markPaid', (_, id) => {
  const today = new Date().toISOString().split('T')[0];
  db.prepare('UPDATE receivables SET status=?,paid_date=? WHERE id=?').run('paid',today,id);
  return true;
});
ipcMain.handle('receivables:delete', (_, id) => { db.prepare('DELETE FROM receivables WHERE id=?').run(id); return true; });

// ── 客戶管理 ──
ipcMain.handle('customers:getAll', () => db.prepare('SELECT * FROM customers ORDER BY name ASC').all());
ipcMain.handle('customers:add', (_, d) => {
  try {
    const r = db.prepare('INSERT INTO customers (name,aliases,type,category,contact,note) VALUES (?,?,?,?,?,?)').run(d.name,d.aliases||'',d.type||'both',d.category||'',d.contact||'',d.note||'');
    return { id: r.lastInsertRowid, ...d };
  } catch(e) { return { error: '客戶名稱已存在' }; }
});
ipcMain.handle('customers:update', (_, d) => {
  db.prepare('UPDATE customers SET name=?,aliases=?,type=?,category=?,contact=?,note=? WHERE id=?').run(d.name,d.aliases||'',d.type||'both',d.category||'',d.contact||'',d.note||'',d.id);
  return true;
});

// 自動新增客戶（入帳和出帳完全分開，不合併）
ipcMain.handle('customers:autoAdd', (_, { name, type }) => {
  if (!name || name.trim().length < 1) return false;
  try {
    // 找相同名稱且相同類型的
    const existing = db.prepare('SELECT id FROM customers WHERE name=? AND type=?').get(name.trim(), type);
    if (existing) return false; // 已存在，不重複新增

    // 若同名但不同類型，用不同名稱區分（加上類型標記）
    const sameNameOther = db.prepare('SELECT id FROM customers WHERE name=?').get(name.trim());
    const insertName = sameNameOther ? name.trim() + (type === 'expense' ? '（廠商）' : '（客戶）') : name.trim();

    db.prepare('INSERT OR IGNORE INTO customers (name,aliases,type,category,contact,note) VALUES (?,?,?,?,?,?)').run(insertName,'',type,'','','自動新增');
    return true;
  } catch(e) { return false; }
});
ipcMain.handle('customers:delete', (_, id) => { db.prepare('DELETE FROM customers WHERE id=?').run(id); return true; });

// ── 開啟資料夾位置 ──
ipcMain.handle('app:openDataFolder', () => {
  const dbPath = getDataPath();
  shell.showItemInFolder(dbPath);
  return true;
});

// ── 匯出 CSV ──
ipcMain.handle('export:csv', async () => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '匯出帳務紀錄', defaultPath: `帳務紀錄_${new Date().toISOString().split('T')[0]}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (!filePath) return false;
  const income = db.prepare('SELECT * FROM income ORDER BY date DESC').all();
  const expense = db.prepare('SELECT * FROM expense ORDER BY date DESC').all();
  let csv = '\uFEFF日期,類型,對象,名稱,類別,金額,備註,來源\n';
  income.forEach(e => csv += `${e.date},入帳,${e.client},${e.title},${e.category},${e.amount},${e.note||''},${e.source==='ai'?'AI辨識':e.source==='excel'?'Excel匯入':'手動'}\n`);
  expense.forEach(e => csv += `${e.date},出帳,${e.vendor},${e.title},${e.category},-${e.amount},${e.note||''},${e.source==='ai'?'AI辨識':e.source==='excel'?'Excel匯入':'手動'}\n`);
  fs.writeFileSync(filePath, csv, 'utf8');
  shell.showItemInFolder(filePath);
  return true;
});

// ── 開啟 Excel ──
ipcMain.handle('excel:openDialog', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '選擇 Excel 檔案', filters: [{ name: 'Excel', extensions: ['xlsx','xls','csv'] }],
    properties: ['openFile']
  });
  if (!filePaths || !filePaths[0]) return null;
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePaths[0]);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return { fileName: path.basename(filePaths[0]), rows, sheetName };
});

// ── AI 分析 Excel ──
ipcMain.handle('ai:analyzeExcel', async (_, { rows, customers, apiKey }) => {
  const https = require('https');
  const customerList = customers.map(c => `${c.name}${c.aliases ? '（別名：'+c.aliases+'）' : ''}`).join('、');
  const sampleRows = rows.slice(0, 50);
  const prompt = `你是帳務分析助理。以下是從 Excel 匯入的帳務資料，以及公司現有客戶名單。
現有客戶名單：${customerList || '（尚無客戶）'}
Excel 資料：${JSON.stringify(sampleRows, null, 2)}
請分析每一筆，回傳 JSON 陣列，每筆包含：
{"rowIndex":索引,"type":"income或expense","date":"YYYY-MM-DD","party":"客戶或廠商名稱","isNewCustomer":true或false,"title":"說明","amount":金額數字,"category":"類別","invoiceNo":"發票號或空字串","note":"備註","status":"paid或pending","confidence":"high/medium/low"}
入帳類別：服務費/產品銷售/顧問費/維護費/其他，出帳類別：租金/薪資/設備/軟體訂閱/行銷/差旅/水電/其他
只回傳JSON陣列。`;
  const body = JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{role:'user',content:prompt}] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body), 'anthropic-version':'2023-06-01', 'x-api-key':apiKey }
    }, (res) => {
      let data='';
      res.on('data', chunk => data+=chunk);
      res.on('end', () => {
        try {
          const parsed=JSON.parse(data);
          const text=parsed.content?.map(c=>c.text||'').join('')||'';
          resolve(JSON.parse(text.replace(/```json|```/g,'').trim()));
        } catch(e) { reject(new Error('AI 回應解析失敗')); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
});

// ── AI 圖片辨識 ──
ipcMain.handle('ai:analyzeImage', async (_, { base64, mimeType, apiKey }) => {
  const https = require('https');
  const systemPrompt = `你是帳務辨識助理，專門辨識公司出帳單據。

重要規則：
1. 廠商名稱必須直接從圖片上的文字讀取，不可以推測或替換成其他名稱。如果圖片上寫「台鑫堆高機有限公司」就填「台鑫堆高機有限公司」，不可以改成其他名稱。
2. 金額請找「總計金額」、「應付金額」、「本期應繳」、「總金額」等欄位，只填數字不含符號。
3. 日期請找單據上的開立日期、帳單日期或製表日期。
4. 如果有多個公司名稱（例如抬頭和對象），請填開立單據的那一方（即廠商/收款方）。

分析圖片中的單據，以JSON格式回傳：
{
  "type": "expense",
  "date": "YYYY-MM-DD",
  "party": "直接從圖片讀取的廠商名稱，不可推測",
  "title": "費用說明（例：堆高機租賃費、3月水費、電費）",
  "amount": 金額數字,
  "category": "類別（水電/設備/租金/運費/軟體訂閱/行銷/差旅/薪資/其他）",
  "note": "帳單編號或其他重要資訊",
  "confidence": "high或medium或low"
}
只回傳JSON，不要任何其他文字。若無法辨識回傳{"error":"無法辨識"}。`;
  const body = JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1000, system:systemPrompt, messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mimeType,data:base64}},{type:'text',text:'請分析這張單據並回傳JSON。'}]}] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body), 'anthropic-version':'2023-06-01', 'x-api-key':apiKey }
    }, (res) => {
      let data='';
      res.on('data', chunk => data+=chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // 檢查 API 錯誤（例如 401 invalid key、429 rate limit）
          if (parsed.error) {
            reject(new Error(`API 錯誤：${parsed.error.message || JSON.stringify(parsed.error)}`));
            return;
          }
          const text = parsed.content?.map(c => c.text || '').join('') || '';
          // 更強健的 JSON 解析：找到第一個 { 到最後一個 }
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error(`AI 回傳格式錯誤：${text.slice(0, 100)}`));
            return;
          }
          resolve(JSON.parse(jsonMatch[0]));
        } catch(e) {
          reject(new Error(`解析失敗：${e.message}`));
        }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
});

// ── 下載 Excel 範本 ──
ipcMain.handle('excel:downloadTemplate', async () => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '儲存 Excel 範本',
    defaultPath: '帳務紀錄範本.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (!filePath) return false;
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();

  // 入帳工作表
  const incomeData = [
    ['日期', '客戶名稱', '款項名稱', '金額', '類別', '發票號碼', '備註'],
    ['2025-01-15', '台灣科技股份有限公司', 'Q1 服務費', 50000, '服務費', 'AA-12345', ''],
    ['2025-02-01', '創新數位有限公司', '系統維護費', 30000, '維護費', 'AA-12346', '2月份'],
    ['', '', '', '', '', '', ''],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(incomeData);
  ws1['!cols'] = [{ wch:12 },{ wch:20 },{ wch:20 },{ wch:10 },{ wch:12 },{ wch:12 },{ wch:16 }];
  XLSX.utils.book_append_sheet(wb, ws1, '入帳');

  // 出帳工作表
  const expenseData = [
    ['日期', '廠商名稱', '支出名稱', '金額', '類別', '發票號碼', '備註'],
    ['2025-01-05', '台北房東', '一月辦公室租金', 25000, '租金', '', ''],
    ['2025-01-10', '中華電信', '網路費', 1200, '水電', '', ''],
    ['', '', '', '', '', '', ''],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(expenseData);
  ws2['!cols'] = [{ wch:12 },{ wch:20 },{ wch:20 },{ wch:10 },{ wch:12 },{ wch:12 },{ wch:16 }];
  XLSX.utils.book_append_sheet(wb, ws2, '出帳');

  // 應收帳款工作表
  const recvData = [
    ['開立日期', '應付日期', '客戶名稱', '說明', '金額', '發票號碼', '付款狀態'],
    ['2025-01-15', '2025-02-15', '台灣科技股份有限公司', 'Q1 服務費', 50000, 'AA-12345', '待付款'],
    ['2025-02-01', '2025-03-01', '創新數位有限公司', '系統維護費', 30000, 'AA-12346', '已付款'],
    ['', '', '', '', '', '', ''],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(recvData);
  ws3['!cols'] = [{ wch:12 },{ wch:12 },{ wch:20 },{ wch:20 },{ wch:10 },{ wch:12 },{ wch:10 }];
  XLSX.utils.book_append_sheet(wb, ws3, '應收帳款');

  XLSX.writeFile(wb, filePath);
  shell.showItemInFolder(filePath);
  return true;
});

// ── 直接匯入固定格式 Excel（不需要 AI）──
ipcMain.handle('excel:importTemplate', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '選擇已填好的帳務 Excel',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile']
  });
  if (!filePaths || !filePaths[0]) return null;

  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePaths[0]);
  const today = new Date().toISOString().split('T')[0];
  const result = { income: [], expense: [], receivables: [], errors: [] };

  const parseDate = (val) => {
    if (!val) return today;
    if (typeof val === 'number') {
      // Excel 日期序號
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    // 支援 YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY
    const m1 = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m1) return `${m1[1]}-${m1[2].padStart(2,'0')}-${m1[3].padStart(2,'0')}`;
    const m2 = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
    return today;
  };

  const validIncCats = ['服務費','產品銷售','顧問費','維護費','其他'];
  const validExpCats = ['租金','薪資','設備','軟體訂閱','行銷','差旅','水電','其他'];
  const guessIncCat = (v) => validIncCats.includes(v) ? v : '其他';
  const guessExpCat = (v) => validExpCats.includes(v) ? v : '其他';

  // 入帳工作表
  if (workbook.SheetNames.includes('入帳')) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['入帳'], { defval: '' });
    rows.forEach((r, i) => {
      const amount = parseFloat(r['金額'] || r['amount'] || 0);
      const client = String(r['客戶名稱'] || r['client'] || '').trim();
      if (!client || !amount) return;
      result.income.push({
        date: parseDate(r['日期'] || r['date']),
        client,
        title: String(r['款項名稱'] || r['title'] || '匯入').trim(),
        amount,
        category: guessIncCat(String(r['類別'] || '').trim()),
        note: String(r['備註'] || r['note'] || '').trim(),
        invoice: String(r['發票號碼'] || '').trim(),
        source: 'excel'
      });
    });
  }

  // 出帳工作表
  if (workbook.SheetNames.includes('出帳')) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['出帳'], { defval: '' });
    rows.forEach((r, i) => {
      const amount = parseFloat(r['金額'] || r['amount'] || 0);
      const vendor = String(r['廠商名稱'] || r['vendor'] || '').trim();
      if (!vendor || !amount) return;
      result.expense.push({
        date: parseDate(r['日期'] || r['date']),
        vendor,
        title: String(r['支出名稱'] || r['title'] || '匯入').trim(),
        amount,
        category: guessExpCat(String(r['類別'] || '').trim()),
        note: String(r['備註'] || r['note'] || '').trim(),
        source: 'excel'
      });
    });
  }

  // 應收帳款工作表
  if (workbook.SheetNames.includes('應收帳款')) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['應收帳款'], { defval: '' });
    rows.forEach((r, i) => {
      const amount = parseFloat(r['金額'] || 0);
      const client = String(r['客戶名稱'] || '').trim();
      if (!client || !amount) return;
      const statusRaw = String(r['付款狀態'] || '').trim();
      const status = (statusRaw === '已付款' || statusRaw.toLowerCase() === 'paid') ? 'paid' : 'pending';
      result.receivables.push({
        issue: parseDate(r['開立日期']),
        due: parseDate(r['應付日期']),
        client,
        desc: String(r['說明'] || '').trim(),
        amount,
        invoice: String(r['發票號碼'] || '').trim(),
        status
      });
    });
  }

  return result;
});

// ── 匯入應收帳款 CSV ──
ipcMain.handle('receivables:importCSV', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '選擇應收帳款 CSV 檔案',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (!filePaths || !filePaths[0]) return null;

  const content = fs.readFileSync(filePaths[0], 'utf-8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { count: 0, rows: [] };

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/"/g,''));
    if (vals.length < 3) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

    const amount = parseFloat(row['金額'] || 0);
    const client = row['客戶名稱'] || '';
    if (!client || !amount) continue;

    rows.push({
      issue: row['開立日期'] || new Date().toISOString().split('T')[0],
      due: row['應付日期'] || new Date().toISOString().split('T')[0],
      client,
      desc: row['說明'] || '服務費',
      amount,
      invoice: row['發票號碼'] || '',
      status: (row['付款狀態'] === '已付款') ? 'paid' : 'pending'
    });
  }

  return { count: rows.length, rows };
});

// ── 匯入客戶名單 CSV ──
ipcMain.handle('customers:importCSV', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '選擇客戶名單 CSV 檔案',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (!filePaths || !filePaths[0]) return null;

  const content = fs.readFileSync(filePaths[0], 'utf-8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { count: 0, skipped: 0 };

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  let count = 0, skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/"/g,''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

    const name = row['客戶名稱'] || '';
    if (!name) continue;

    try {
      db.prepare('INSERT OR IGNORE INTO customers (name,aliases,category,contact,note) VALUES (?,?,?,?,?)')
        .run(name, row['別名']||'', row['分類']||'', row['聯絡人']||'', row['備註']||'');
      count++;
    } catch(e) { skipped++; }
  }

  return { count, skipped };
});

// ── Google Drive 相關 ──
function getAppDir() {
  // credentials.json 的位置：安裝版用 app.getAppPath()（支援 asar），開發版用 __dirname
  return app.getAppPath();
}

ipcMain.handle('google:checkAuth', async () => {
  try {
    const { getAuthClient, getTokenPath } = require('./google-auth');
    const credPath = path.join(getAppDir(), 'credentials.json');
    if (!fs.existsSync(credPath)) return { status: 'no_credentials' };
    const tokenPath = getTokenPath(getDataDir());
    if (!fs.existsSync(tokenPath)) return { status: 'not_authorized' };
    return { status: 'authorized' };
  } catch(e) { return { status: 'error', message: e.message }; }
});

ipcMain.handle('google:authorize', async () => {
  try {
    const { authorize } = require('./google-auth');
    await authorize(getAppDir(), getDataDir());
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('google:fetchInvoices', async (_, { months, year }) => {
  try {
    const { getAuthClient } = require('./google-auth');
    const { fetchInvoices } = require('./google-drive');
    const auth = await getAuthClient(getAppDir(), getDataDir());
    if (!auth) return { success: false, message: '尚未授權，請先登入 Google 帳號' };
    const results = await fetchInvoices(auth, months, year);
    return { success: true, data: results };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('google:revokeAuth', async () => {
  try {
    const { getTokenPath } = require('./google-auth');
    const tokenPath = getTokenPath(getDataDir());
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    return { success: true };
  } catch(e) { return { success: false }; }
});

// ── 自動更新 ──
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});
