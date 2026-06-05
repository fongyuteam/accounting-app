// server.js — 帳務管理系統 Web 版
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'src')));

// ── 資料庫 ──
const Database = require('better-sqlite3');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'accounting.db'));

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
  PRAGMA journal_mode=WAL;
`);
try { db.exec("ALTER TABLE customers ADD COLUMN type TEXT DEFAULT 'both'"); } catch(e) {}

const today = () => new Date().toISOString().split('T')[0];

// ── 入帳 ──
app.get('/api/income', (req, res) => {
  res.json(db.prepare('SELECT * FROM income ORDER BY date DESC').all());
});
app.post('/api/income', (req, res) => {
  const d = req.body;
  const r = db.prepare('INSERT INTO income (date,client,title,category,amount,note,source) VALUES (?,?,?,?,?,?,?)')
    .run(d.date, d.client, d.title, d.category, d.amount, d.note||'', d.source||'manual');
  res.json({ id: r.lastInsertRowid, ...d });
});
app.delete('/api/income/:id', (req, res) => {
  db.prepare('DELETE FROM income WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── 出帳 ──
app.get('/api/expense', (req, res) => {
  res.json(db.prepare('SELECT * FROM expense ORDER BY date DESC').all());
});
app.post('/api/expense', (req, res) => {
  const d = req.body;
  const r = db.prepare('INSERT INTO expense (date,vendor,title,category,amount,note,source) VALUES (?,?,?,?,?,?,?)')
    .run(d.date, d.vendor, d.title, d.category||'', d.amount, d.note||'', d.source||'manual');
  res.json({ id: r.lastInsertRowid, ...d });
});
app.put('/api/expense', (req, res) => {
  const d = req.body;
  db.prepare('UPDATE expense SET date=?,vendor=?,title=?,category=?,amount=?,note=? WHERE id=?')
    .run(d.date, d.vendor, d.title, d.category||'其他', d.amount, d.note||'', d.id);
  res.json({ ok: true });
});
app.delete('/api/expense/:id', (req, res) => {
  db.prepare('DELETE FROM expense WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── 應收帳款 ──
app.get('/api/receivables', (req, res) => {
  res.json(db.prepare('SELECT * FROM receivables ORDER BY due_date ASC').all());
});
app.post('/api/receivables', (req, res) => {
  const d = req.body;
  const r = db.prepare('INSERT INTO receivables (issue_date,due_date,client,description,invoice_no,amount) VALUES (?,?,?,?,?,?)')
    .run(d.issue, d.due, d.client, d.desc, d.invoice||'', d.amount);
  res.json({ id: r.lastInsertRowid, ...d });
});
app.post('/api/receivables/mark-paid/:id', (req, res) => {
  db.prepare('UPDATE receivables SET status=?,paid_date=? WHERE id=?').run('paid', today(), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/receivables/:id', (req, res) => {
  db.prepare('DELETE FROM receivables WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/receivables/import-csv', (req, res) => {
  const content = (req.body.content || '').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return res.json({ count: 0, rows: [] });
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/"/g,''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    const amount = parseFloat(row['金額'] || 0);
    const client = row['客戶名稱'] || '';
    if (!client || !amount) continue;
    rows.push({
      issue: row['開立日期'] || today(),
      due: row['應付日期'] || today(),
      client, desc: row['說明'] || '服務費', amount,
      invoice: row['發票號碼'] || '',
      status: row['付款狀態'] === '已付款' ? 'paid' : 'pending'
    });
  }
  res.json({ count: rows.length, rows });
});

// ── 客戶 ──
app.get('/api/customers', (req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY name ASC').all());
});
app.post('/api/customers', (req, res) => {
  const d = req.body;
  try {
    const r = db.prepare('INSERT INTO customers (name,aliases,type,category,contact,note) VALUES (?,?,?,?,?,?)')
      .run(d.name, d.aliases||'', d.type||'both', d.category||'', d.contact||'', d.note||'');
    res.json({ id: r.lastInsertRowid, ...d });
  } catch(e) { res.json({ error: '客戶名稱已存在' }); }
});
app.put('/api/customers', (req, res) => {
  const d = req.body;
  db.prepare('UPDATE customers SET name=?,aliases=?,type=?,category=?,contact=?,note=? WHERE id=?')
    .run(d.name, d.aliases||'', d.type||'both', d.category||'', d.contact||'', d.note||'', d.id);
  res.json({ ok: true });
});
app.delete('/api/customers/:id', (req, res) => {
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/customers/auto-add', (req, res) => {
  const { name, type } = req.body;
  if (!name || name.trim().length < 1) return res.json({ ok: false });
  try {
    const existing = db.prepare('SELECT id FROM customers WHERE name=? AND type=?').get(name.trim(), type);
    if (existing) return res.json({ ok: false });
    const sameNameOther = db.prepare('SELECT id FROM customers WHERE name=?').get(name.trim());
    const insertName = sameNameOther ? name.trim() + (type === 'expense' ? '（廠商）' : '（客戶）') : name.trim();
    db.prepare('INSERT OR IGNORE INTO customers (name,aliases,type,category,contact,note) VALUES (?,?,?,?,?,?)')
      .run(insertName, '', type, '', '', '自動新增');
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});
app.post('/api/customers/import-csv', (req, res) => {
  const content = (req.body.content || '').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return res.json({ count: 0, skipped: 0 });
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
  res.json({ count, skipped });
});

// ── 匯出 CSV ──
app.get('/api/export/csv', (req, res) => {
  const income = db.prepare('SELECT * FROM income ORDER BY date DESC').all();
  const expense = db.prepare('SELECT * FROM expense ORDER BY date DESC').all();
  let csv = '\uFEFF日期,類型,對象,名稱,類別,金額,備註,來源\n';
  income.forEach(e => {
    const src = e.source==='ai'?'AI辨識':e.source==='excel'?'Excel匯入':'手動';
    csv += `${e.date},入帳,${e.client},${e.title},${e.category},${e.amount},${e.note||''},${src}\n`;
  });
  expense.forEach(e => {
    const src = e.source==='ai'?'AI辨識':e.source==='excel'?'Excel匯入':'手動';
    csv += `${e.date},出帳,${e.vendor},${e.title},${e.category},-${e.amount},${e.note||''},${src}\n`;
  });
  const filename = `帳務紀錄_${today()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
});

// ── Excel 範本下載 ──
app.get('/api/excel/template', (req, res) => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['日期','客戶名稱','款項名稱','金額','類別','發票號碼','備註'],
    ['2025-01-15','台灣科技股份有限公司','Q1 服務費',50000,'服務費','AA-12345',''],
  ]);
  ws1['!cols'] = [{wch:12},{wch:20},{wch:20},{wch:10},{wch:12},{wch:12},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws1, '入帳');
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['日期','廠商名稱','支出名稱','金額','類別','發票號碼','備註'],
    ['2025-01-05','台北房東','一月辦公室租金',25000,'租金','',''],
  ]);
  ws2['!cols'] = [{wch:12},{wch:20},{wch:20},{wch:10},{wch:12},{wch:12},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws2, '出帳');
  const ws3 = XLSX.utils.aoa_to_sheet([
    ['開立日期','應付日期','客戶名稱','說明','金額','發票號碼','付款狀態'],
    ['2025-01-15','2025-02-15','台灣科技股份有限公司','Q1 服務費',50000,'AA-12345','待付款'],
  ]);
  ws3['!cols'] = [{wch:12},{wch:12},{wch:20},{wch:20},{wch:10},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws3, '應收帳款');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%B8%B3%E5%8B%99%E7%B4%80%E9%8C%84%E7%AF%84%E6%9C%AC.xlsx");
  res.send(buf);
});

// ── Excel 解析 ──
app.post('/api/excel/parse', (req, res) => {
  const { data, fileName } = req.body;
  const XLSX = require('xlsx');
  const buf = Buffer.from(data, 'base64');
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  res.json({ fileName: fileName || 'Excel', rows, sheetName });
});

// ── 固定格式 Excel 匯入 ──
app.post('/api/excel/import-template', (req, res) => {
  const XLSX = require('xlsx');
  const buf = Buffer.from(req.body.data, 'base64');
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const today_ = today();
  const result = { income: [], expense: [], receivables: [] };
  const parseDate = val => {
    if (!val) return today_;
    if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
    const str = String(val).trim();
    const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    return today_;
  };
  const validInc = ['服務費','產品銷售','顧問費','維護費','其他'];
  const validExp = ['租金','薪資','設備','軟體訂閱','行銷','差旅','水電','其他'];
  if (workbook.SheetNames.includes('入帳')) {
    XLSX.utils.sheet_to_json(workbook.Sheets['入帳'], { defval: '' }).forEach(r => {
      const amount = parseFloat(r['金額']||0), client = String(r['客戶名稱']||'').trim();
      if (!client || !amount) return;
      result.income.push({ date: parseDate(r['日期']), client, title: String(r['款項名稱']||'匯入').trim(), amount, category: validInc.includes(String(r['類別']||'').trim()) ? String(r['類別']).trim() : '其他', note: String(r['備註']||'').trim(), source: 'excel' });
    });
  }
  if (workbook.SheetNames.includes('出帳')) {
    XLSX.utils.sheet_to_json(workbook.Sheets['出帳'], { defval: '' }).forEach(r => {
      const amount = parseFloat(r['金額']||0), vendor = String(r['廠商名稱']||'').trim();
      if (!vendor || !amount) return;
      result.expense.push({ date: parseDate(r['日期']), vendor, title: String(r['支出名稱']||'匯入').trim(), amount, category: validExp.includes(String(r['類別']||'').trim()) ? String(r['類別']).trim() : '其他', note: String(r['備註']||'').trim(), source: 'excel' });
    });
  }
  if (workbook.SheetNames.includes('應收帳款')) {
    XLSX.utils.sheet_to_json(workbook.Sheets['應收帳款'], { defval: '' }).forEach(r => {
      const amount = parseFloat(r['金額']||0), client = String(r['客戶名稱']||'').trim();
      if (!client || !amount) return;
      const statusRaw = String(r['付款狀態']||'').trim();
      result.receivables.push({ issue: parseDate(r['開立日期']), due: parseDate(r['應付日期']), client, desc: String(r['說明']||'').trim(), amount, invoice: String(r['發票號碼']||'').trim(), status: (statusRaw==='已付款'||statusRaw.toLowerCase()==='paid') ? 'paid' : 'pending' });
    });
  }
  res.json(result);
});

// ── AI 圖片辨識 ──
app.post('/api/ai/analyze-image', (req, res) => {
  const { base64, mimeType, apiKey } = req.body;
  const systemPrompt = `你是帳務辨識助理，專門辨識公司出帳單據。
重要規則：
1. 廠商名稱必須直接從圖片上的文字讀取，不可以推測或替換成其他名稱。如果圖片上寫「台鑫堆高機有限公司」就填「台鑫堆高機有限公司」，不可以改成其他名稱。
2. 金額請找「總計金額」、「應付金額」、「本期應繳」、「總金額」等欄位，只填數字不含符號。
3. 日期請找單據上的開立日期、帳單日期或製表日期。
4. 如果有多個公司名稱（例如抬頭和對象），請填開立單據的那一方（即廠商/收款方）。
分析圖片中的單據，以JSON格式回傳：
{"type":"expense","date":"YYYY-MM-DD","party":"直接從圖片讀取的廠商名稱，不可推測","title":"費用說明（例：堆高機租賃費、3月水費、電費）","amount":金額數字,"category":"類別（水電/設備/租金/運費/軟體訂閱/行銷/差旅/薪資/其他）","note":"帳單編號或其他重要資訊","confidence":"high或medium或low"}
只回傳JSON，不要任何其他文字。若無法辨識回傳{"error":"無法辨識"}。`;
  const body = JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1000, system:systemPrompt, messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mimeType,data:base64}},{type:'text',text:'請分析這張單據並回傳JSON。'}]}] });
  const apiReq = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'anthropic-version':'2023-06-01','x-api-key':apiKey} }, apiRes => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) { res.json({ error: parsed.error.message || JSON.stringify(parsed.error) }); return; }
        const text = parsed.content?.map(c => c.text||'').join('')||'';
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) { res.json({ error: 'AI 回傳格式錯誤' }); return; }
        res.json(JSON.parse(m[0]));
      } catch(e) { res.json({ error: '解析失敗：' + e.message }); }
    });
  });
  apiReq.on('error', e => res.json({ error: e.message }));
  apiReq.write(body); apiReq.end();
});

// ── AI 分析 Excel ──
app.post('/api/ai/analyze-excel', (req, res) => {
  const { rows, customers, apiKey } = req.body;
  const customerList = customers.map(c => `${c.name}${c.aliases?'（別名：'+c.aliases+'）':''}`).join('、');
  const prompt = `你是帳務分析助理。以下是從 Excel 匯入的帳務資料，以及公司現有客戶名單。
現有客戶名單：${customerList||'（尚無客戶）'}
Excel 資料：${JSON.stringify(rows.slice(0,50), null, 2)}
請分析每一筆，回傳 JSON 陣列，每筆包含：
{"rowIndex":索引,"type":"income或expense","date":"YYYY-MM-DD","party":"客戶或廠商名稱","isNewCustomer":true或false,"title":"說明","amount":金額數字,"category":"類別","invoiceNo":"發票號或空字串","note":"備註","status":"paid或pending","confidence":"high/medium/low"}
入帳類別：服務費/產品銷售/顧問費/維護費/其他，出帳類別：租金/薪資/設備/軟體訂閱/行銷/差旅/水電/其他
只回傳JSON陣列。`;
  const body = JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{role:'user',content:prompt}] });
  const apiReq = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'anthropic-version':'2023-06-01','x-api-key':apiKey} }, apiRes => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const text = parsed.content?.map(c => c.text||'').join('')||'';
        res.json(JSON.parse(text.replace(/```json|```/g,'').trim()));
      } catch(e) { res.status(500).json({ error: 'AI 回應解析失敗' }); }
    });
  });
  apiReq.on('error', e => res.status(500).json({ error: e.message }));
  apiReq.write(body); apiReq.end();
});

// ── Google Drive ──
app.get('/api/google/check-auth', (req, res) => {
  try {
    const { getTokenPath } = require('./google-auth-web');
    const credPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(credPath)) return res.json({ status: 'no_credentials' });
    if (!fs.existsSync(getTokenPath(dataDir))) return res.json({ status: 'not_authorized' });
    res.json({ status: 'authorized' });
  } catch(e) { res.json({ status: 'error', message: e.message }); }
});
app.post('/api/google/authorize', async (req, res) => {
  try {
    const { authorize } = require('./google-auth-web');
    await authorize(__dirname, dataDir);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});
app.post('/api/google/fetch-invoices', async (req, res) => {
  try {
    const { getAuthClient } = require('./google-auth-web');
    const { fetchInvoices } = require('./google-drive');
    const auth = await getAuthClient(__dirname, dataDir);
    if (!auth) return res.json({ success: false, message: '尚未授權，請先登入 Google 帳號' });
    const results = await fetchInvoices(auth, req.body.months, req.body.year);
    res.json({ success: true, data: results });
  } catch(e) { res.json({ success: false, message: e.message }); }
});
app.post('/api/google/revoke', (req, res) => {
  try {
    const { getTokenPath } = require('./google-auth-web');
    const tp = getTokenPath(dataDir);
    if (fs.existsSync(tp)) fs.unlinkSync(tp);
    res.json({ success: true });
  } catch(e) { res.json({ success: false }); }
});

// ── 開啟資料夾 ──
app.post('/api/app/open-data-folder', (req, res) => {
  exec(`explorer "${dataDir}"`);
  res.json({ ok: true });
});

// ── 啟動 ──
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('========================================');
  console.log('  帳務管理系統 已啟動！');
  console.log('========================================');
  console.log(`  本機：http://localhost:${PORT}`);
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  區網：http://${iface.address}:${PORT}  ← Mac 用這個`);
      }
    }
  }
  console.log('========================================');
  console.log('  關閉此視窗會停止伺服器');
  console.log('');
  setTimeout(() => exec(`start http://localhost:${PORT}`), 800);
});
