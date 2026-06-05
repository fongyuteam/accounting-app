const { google } = require('googleapis');
const XLSX = require('xlsx');

const SKIP_FOLDERS = ['已結案', '請款單總表'];
const SKIP_FILES = ['請款單總表', '倉儲收入報表', '廠商資料', '歷史紀錄'];
const SKIP_SHEETS = ['說明', 'template', '範例'];
const TARGET_FOLDER = '豐裕請款單';

function cleanVal(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function parseAmount(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g,'').replace(/\$/g,'').replace(/NT/g,'').trim();
  const f = parseFloat(s);
  return (!isNaN(f) && f > 100) ? f : null;
}

function twToDate(s) {
  s = String(s || '').trim();
  const m = s.match(/(1[01]\d)\/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    const year = parseInt(m[1]) + 1911;
    return `${year}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  return s;
}

// 從計費期間字串判斷月份，支援任意民國年份
function getPeriodMonth(period, twYear) {
  if (!period || !String(period).includes(String(twYear))) return null;
  const re = new RegExp(String(twYear) + '\\/0?(\\d{1,2})\\/');
  const m = String(period).match(re);
  if (m) return parseInt(m[1]);
  return null;
}

// 從工作表名稱判斷月份，支援任意民國年份
function getSheetMonth(sheetName, twYear) {
  const re = new RegExp(String(twYear) + '\\s*0?([1-9]\\d?)\\b');
  const m = String(sheetName).match(re);
  if (m) return parseInt(m[1]);
  return null;
}

function extractFromSheet(data) {
  let client = null, periods = [], invoiceDate = null;
  let amount = null;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const vals = Object.values(row).map(cleanVal);
    const fullText = vals.join(' ');

    // 客戶名稱
    if (fullText.includes('客戶名稱')) {
      for (let j = 0; j < vals.length; j++) {
        if ((vals[j].includes('客戶名稱：') || vals[j].includes('客戶名稱:'))) {
          const c = vals[j].replace('客戶名稱：','').replace('客戶名稱:','').trim();
          if (c) { client = c; break; }
          if (j + 1 < vals.length && vals[j+1].trim()) { client = vals[j+1].trim(); break; }
        }
      }
    }

    // 計費期間
    if (fullText.includes('計費期間')) {
      for (const v of vals) {
        const p = v.replace('計費期間：','').replace('計費期間:','').trim();
        if (p && p.includes('/') && p.match(/\d{3}\/\d/)) { periods.push(p); break; }
      }
    }

    // 請款日期
    if (fullText.includes('請款日期')) {
      for (const v of vals) {
        const d = v.replace('請款日期：','').replace('請款日期:','').trim();
        if (d && d.match(/\d{3}\/\d/)) { invoiceDate = d; break; }
      }
    }

    // 只抓應付總金額
    if (fullText.includes('應付總金額') || fullText.includes('應付金額')) {
      // 找同行最大的數字
      for (const v of vals) {
        const amt = parseAmount(v);
        if (amt && amt > 100) { amount = amt; break; }
      }
      // 找下一行
      if (!amount && i + 1 < data.length) {
        const nextVals = Object.values(data[i+1]).map(cleanVal);
        for (const v of nextVals) {
          const amt = parseAmount(v);
          if (amt && amt > 100) { amount = amt; break; }
        }
      }
    }
  }

  return { client, periods, invoiceDate, amount };
}

async function findTargetFolder(drive) {
  const res = await drive.files.list({
    q: `name='${TARGET_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  if (!res.data.files.length) throw new Error(`找不到「${TARGET_FOLDER}」資料夾`);
  return res.data.files[0].id;
}

async function listFilesInFolder(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 200
  });
  return res.data.files || [];
}

async function downloadAndParse(drive, file, targetMonths, twYear) {
  const results = [];

  if (SKIP_FILES.some(k => file.name.includes(k))) return results;

  // 子資料夾
  if (file.mimeType === 'application/vnd.google-apps.folder') {
    if (SKIP_FOLDERS.some(k => file.name.includes(k))) return results;
    const subFiles = await listFilesInFolder(drive, file.id);
    for (const f of subFiles) {
      const sub = await downloadAndParse(drive, f, targetMonths, twYear);
      results.push(...sub);
    }
    return results;
  }

  const isXlsx = file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                 file.mimeType === 'application/vnd.ms-excel' ||
                 file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  const isGSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
  if (!isXlsx && !isGSheet) return results;

  try {
    let buffer;
    if (isGSheet) {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { responseType: 'arraybuffer' }
      );
      buffer = Buffer.from(res.data);
    } else {
      const res = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      buffer = Buffer.from(res.data);
    }

    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    for (const sheetName of wb.SheetNames) {
      if (SKIP_SHEETS.some(k => sheetName.includes(k))) continue;
      const ws = wb.Sheets[sheetName];
      if (!ws['!ref']) continue;

      const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      if (data.length < 3) continue;

      const { client, periods, invoiceDate, amount } = extractFromSheet(data);
      if (!client || !amount) continue;

      // 判斷月份：優先從計費期間，其次工作表名稱
      let month = null;
      let matchedPeriod = '';

      for (const p of periods) {
        const m = getPeriodMonth(p, twYear);
        if (targetMonths.includes(m)) { month = m; matchedPeriod = p; break; }
      }

      if (!month) {
        const m = getSheetMonth(sheetName, twYear);
        if (targetMonths.includes(m)) { month = m; matchedPeriod = periods[0] || ''; }
      }

      if (!month) continue;

      const dueDate = twToDate(invoiceDate || '');
      const issueRaw = matchedPeriod ? matchedPeriod.split('-')[0] : (invoiceDate || '');
      const issueDate = twToDate(issueRaw);

      results.push({
        client, month, year: twYear, matchedPeriod,
        issueDate, dueDate, amount,
        fileName: file.name, sheetName
      });
    }
  } catch(e) {
    console.error(`解析失敗 ${file.name}:`, e.message);
  }
  return results;
}

async function fetchInvoices(auth, targetMonths, twYear) {
  const drive = google.drive({ version: 'v3', auth });
  const folderId = await findTargetFolder(drive);
  const files = await listFilesInFolder(drive, folderId);
  const allResults = [];

  for (const file of files) {
    const res = await downloadAndParse(drive, file, targetMonths, twYear);
    allResults.push(...res);
  }

  // 同一客戶同月份只保留一筆（取金額較大的）
  const seen = new Map();
  for (const r of allResults) {
    const key = `${r.client}_${r.month}`;
    if (!seen.has(key) || r.amount > seen.get(key).amount) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.client < b.client) return -1;
    if (a.client > b.client) return 1;
    return a.month - b.month;
  });
}

module.exports = { fetchInvoices };
