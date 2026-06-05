// renderer.js v2 — 含客戶管理 + Excel 智慧匯入

let apiKey = localStorage.getItem('anthropic_api_key') || '';
let excelRows = null;
let analyzedRows = null;

// ── 類別自訂輸入 helper ──
function toggleCatCustom(selectId, inputId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (inp) inp.style.display = sel && sel.value === '其他' ? '' : 'none';
}

function getCatVal(selectId, inputId) {
  const sel = document.getElementById(selectId);
  if (sel && sel.value === '其他') {
    const inp = document.getElementById(inputId);
    return (inp && inp.value.trim()) ? inp.value.trim() : '其他';
  }
  return sel ? sel.value : '其他';
}

// ── Web API（替換 Electron preload）──
function _b64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}
function _pickFile(id) {
  return new Promise(resolve => {
    const input = document.getElementById(id);
    const handler = e => {
      input.removeEventListener('change', handler);
      const f = e.target.files[0]; input.value = '';
      resolve(f || null);
    };
    input.addEventListener('change', handler);
    input.click();
  });
}
const _get  = url => fetch(url).then(r => r.json());
const _post = (url, d) => fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) }).then(r => r.json());
const _put  = (url, d) => fetch(url, { method:'PUT',  headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) }).then(r => r.json());
const _del  = url => fetch(url, { method:'DELETE' }).then(r => r.json());

window.api = {
  income: {
    getAll: () => _get('/api/income'),
    add:    d  => _post('/api/income', d),
    delete: id => _del(`/api/income/${id}`)
  },
  expense: {
    getAll: () => _get('/api/expense'),
    add:    d  => _post('/api/expense', d),
    update: d  => _put('/api/expense', d),
    delete: id => _del(`/api/expense/${id}`)
  },
  receivables: {
    getAll:    () => _get('/api/receivables'),
    add:       d  => _post('/api/receivables', d),
    markPaid:  id => _post(`/api/receivables/mark-paid/${id}`, {}),
    delete:    id => _del(`/api/receivables/${id}`),
    importCSV: async () => {
      const f = await _pickFile('_csvRecvInput'); if (!f) return null;
      return _post('/api/receivables/import-csv', { content: await f.text() });
    }
  },
  customers: {
    getAll:    () => _get('/api/customers'),
    add:       d  => _post('/api/customers', d),
    update:    d  => _put('/api/customers', d),
    delete:    id => _del(`/api/customers/${id}`),
    autoAdd:   d  => _post('/api/customers/auto-add', d),
    importCSV: async () => {
      const f = await _pickFile('_csvCustInput'); if (!f) return null;
      return _post('/api/customers/import-csv', { content: await f.text() });
    }
  },
  export: {
    csv: () => { window.location.href = '/api/export/csv'; return Promise.resolve(); }
  },
  excel: {
    openDialog: async () => {
      const f = await _pickFile('_excelInput'); if (!f) return null;
      return _post('/api/excel/parse', { data: _b64(await f.arrayBuffer()), fileName: f.name });
    },
    downloadTemplate: () => { window.location.href = '/api/excel/template'; return Promise.resolve(); },
    importTemplate: async () => {
      const f = await _pickFile('_templateInput'); if (!f) return null;
      return _post('/api/excel/import-template', { data: _b64(await f.arrayBuffer()) });
    }
  },
  app: {
    openDataFolder: () => _post('/api/app/open-data-folder', {})
  },
  google: {
    checkAuth:     () => _get('/api/google/check-auth'),
    authorize:     () => _post('/api/google/authorize', {}),
    fetchInvoices: d  => _post('/api/google/fetch-invoices', d),
    revokeAuth:    () => _post('/api/google/revoke', {})
  },
  ai: {
    analyzeImage: d => _post('/api/ai/analyze-image', d),
    analyzeExcel: d => _post('/api/ai/analyze-excel', d)
  }
};

// ── 初始化 ──
window.addEventListener('DOMContentLoaded', async () => {
  setDates();
  updateApiKeyUI();
  await loadAll();
});

function setDates() {
  const t = new Date().toISOString().split('T')[0];
  ['in-date','ex-date','cl-issue','cl-due'].forEach(id => { const el = document.getElementById(id); if (el) el.value = t; });
}

function updateApiKeyUI() {
  const statusEl = document.getElementById('apiKeyStatus');
  const toggleBtn = document.getElementById('apiToggleBtn');
  const clearBtn = document.getElementById('clearApiBtn');
  if (!statusEl) return;
  if (apiKey) {
    statusEl.textContent = '✓ 已設定，AI 功能可使用';
    statusEl.style.color = 'var(--ok)';
    if (toggleBtn) toggleBtn.textContent = '修改';
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  } else {
    statusEl.textContent = '尚未設定，AI 功能無法使用';
    statusEl.style.color = 'var(--muted)';
    if (toggleBtn) toggleBtn.textContent = '設定 API Key';
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

function toggleApiForm() {
  const form = document.getElementById('apiKeyForm');
  if (!form) return;
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden') && apiKey) {
    document.getElementById('apiKeyInput').value = apiKey;
  }
}

function saveApi() {
  const k = document.getElementById('apiKeyInput').value.trim();
  if (!k.startsWith('sk-ant-')) { alert('格式不正確，應以 sk-ant- 開頭'); return; }
  apiKey = k; localStorage.setItem('anthropic_api_key', k);
  document.getElementById('apiKeyForm').classList.add('hidden');
  updateApiKeyUI();
}

function clearApi() {
  if (!confirm('確定要清除 API Key？')) return;
  apiKey = ''; localStorage.removeItem('anthropic_api_key');
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('apiKeyForm').classList.add('hidden');
  updateApiKeyUI();
}

function skipApi() {}

// ── Tab ──
const titles = { scan:'拍照辨識', excel:'Excel 匯入', clients:'客戶付款追蹤', income:'入帳管理', expense:'出帳管理', records:'所有紀錄', gdrive:'Google Drive 同步', customers:'客戶名單' };
function showTab(name) {
  Object.keys(titles).forEach(t => {
    document.getElementById('nav-'+t)?.classList.toggle('active', t===name);
    document.getElementById('tab-'+t)?.classList.toggle('hidden', t!==name);
  });
  document.getElementById('pageTitle').textContent = titles[name];
  if (name==='records') renderAll();
  if (name==='clients') renderReceivables();
  if (name==='scan') renderAiHist();
  if (name==='customers') renderCustomers();
  if (name==='gdrive') { initGoogleAuth(); updateMonthOptions(); }
}

async function loadAll() {
  await Promise.all([renderIncome(), renderExpense(), renderReceivables(), renderAiHist(), renderCustomers()]);
  updateSummary();
}

const today = () => new Date().toISOString().split('T')[0];
const fmt = n => 'NT$' + Number(n).toLocaleString();
const v = id => document.getElementById(id)?.value?.trim() || '';
const clr = id => { const el = document.getElementById(id); if(el) el.value=''; };

function srcBadge(src) {
  if (src==='ai') return '<span class="badge b-ai">✦ AI</span>';
  if (src==='excel') return '<span class="badge b-excel">📊 Excel</span>';
  if (src==='recv') return '<span class="badge b-paid">✓ 付款確認</span>';
  return '<span class="badge b-manual">手動</span>';
}

// ── 入帳 ──
async function renderIncome() {
  const rows = await window.api.income.getAll();
  document.getElementById('incTbody').innerHTML = rows.length ? rows.map(e=>`
    <tr><td>${e.date}</td><td>${e.client}</td><td>${e.title}</td>
    <td><span class="badge b-inc">${e.category}</span></td>
    <td class="amount-pos">${fmt(e.amount)}</td>
    <td style="color:var(--hint);font-size:12px">${e.note||'—'}</td>
    <td>${srcBadge(e.source)}</td>
    <td><button class="btn btn-sm btn-danger" onclick="delInc(${e.id})">刪除</button></td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="8">尚無入帳紀錄</td></tr>`;
  updateSummary();
}

async function addIncome() {
  const d=v('in-date'),client=v('in-client'),amount=parseFloat(v('in-amount')),title=v('in-title');
  if(!d||!client||!amount||!title){alert('請填寫日期、客戶、款項名稱和金額');return;}
  await window.api.income.add({date:d,client,amount,title,category:getCatVal('in-cat','in-cat-custom'),note:v('in-note'),source:'manual'});
  await window.api.customers.autoAdd({name:client, type:'income'});
  ['in-client','in-amount','in-title','in-note'].forEach(clr);
  const inCatCustom = document.getElementById('in-cat-custom');
  if (inCatCustom) { inCatCustom.value=''; inCatCustom.style.display='none'; }
  await renderIncome();
  await renderCustomers();
}

async function delInc(id) {
  if(!confirm('確定刪除？'))return;
  await window.api.income.delete(id); await renderIncome();
}

// ── 出帳 ──
async function renderExpense() {
  const rows = await window.api.expense.getAll();
  document.getElementById('expTbody').innerHTML = rows.length ? rows.map(e=>`
    <tr>
      <td>${e.date}</td>
      <td>${e.vendor}</td>
      <td>${e.title}</td>
      <td><span class="badge b-exp">${e.category||'其他'}</span></td>
      <td class="amount-neg">${fmt(e.amount)}</td>
      <td style="color:var(--hint);font-size:12px">${e.note||'—'}</td>
      <td>${srcBadge(e.source)}</td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-sm" onclick="openExpEdit(${e.id},'${esc(e.date)}','${esc(e.vendor)}','${esc(e.title)}','${esc(e.category||'')}',${e.amount},'${esc(e.note||'')}')">編輯</button>
        <button class="btn btn-sm btn-danger" onclick="delExp(${e.id})">刪除</button>
      </td>
    </tr>`).join('')
    : `<tr class="empty-row"><td colspan="8">尚無出帳紀錄</td></tr>`;
  updateSummary();
}

function openExpEdit(id, date, vendor, title, category, amount, note) {
  document.getElementById('exp-edit-id').value = id;
  document.getElementById('exp-edit-date').value = date;
  document.getElementById('exp-edit-vendor').value = vendor;
  document.getElementById('exp-edit-title').value = title;
  document.getElementById('exp-edit-amount').value = amount;
  document.getElementById('exp-edit-note').value = note;
  const catEl = document.getElementById('exp-edit-cat');
  const catCustomEl = document.getElementById('exp-edit-cat-custom');
  if (catEl) {
    const opts = Array.from(catEl.options).map(o => o.value);
    if (opts.includes(category)) {
      catEl.value = category;
      if (catCustomEl) { catCustomEl.style.display='none'; catCustomEl.value=''; }
    } else {
      catEl.value = '其他';
      if (catCustomEl) { catCustomEl.style.display=''; catCustomEl.value=category; }
    }
  }
  document.getElementById('expEditModal').classList.remove('hidden');
}

function closeExpEdit() {
  document.getElementById('expEditModal').classList.add('hidden');
}

async function saveExpEdit() {
  const id = parseInt(document.getElementById('exp-edit-id').value);
  const date = document.getElementById('exp-edit-date').value;
  const vendor = document.getElementById('exp-edit-vendor').value.trim();
  const title = document.getElementById('exp-edit-title').value.trim();
  const amount = parseFloat(document.getElementById('exp-edit-amount').value);
  const category = getCatVal('exp-edit-cat', 'exp-edit-cat-custom');
  const note = document.getElementById('exp-edit-note').value.trim();

  if (!date || !vendor || !amount) { alert('請填寫日期、廠商和金額'); return; }

  await window.api.expense.update({ id, date, vendor, title, category, amount, note });
  closeExpEdit();
  await renderExpense();
  updateSummary();
}

async function addExpense() {
  const d=v('ex-date'),vendor=v('ex-vendor'),amount=parseFloat(v('ex-amount')),title=v('ex-title');
  if(!d||!vendor||!amount||!title){alert('請填寫日期、廠商、支出名稱和金額');return;}
  await window.api.expense.add({date:d,vendor,amount,title,category:getCatVal('ex-cat','ex-cat-custom'),note:v('ex-note'),source:'manual'});
  await window.api.customers.autoAdd({name:vendor, type:'expense'});
  ['ex-vendor','ex-amount','ex-title','ex-note'].forEach(clr);
  const exCatCustom = document.getElementById('ex-cat-custom');
  if (exCatCustom) { exCatCustom.value=''; exCatCustom.style.display='none'; }
  await renderExpense();
  await renderCustomers();
}

async function delExp(id) {
  if(!confirm('確定刪除？'))return;
  await window.api.expense.delete(id); await renderExpense();
}

// ── CSV 匯入應收帳款 ──
async function importReceivablesCSV() {
  const result = await window.api.receivables.importCSV();
  if (!result) return;

  const { rows } = result;
  if (!rows || rows.length === 0) {
    alert('找不到有效資料，請確認 CSV 格式正確');
    return;
  }

  // 顯示預覽確認
  const statusEl = document.getElementById('csvImportStatus');
  
  // 建立預覽表格
  const previewRows = rows.slice(0, 5).map(r =>
    `<tr>
      <td>${r.client}</td>
      <td>${r.desc}</td>
      <td>${r.due}</td>
      <td style="font-weight:500">NT$${Number(r.amount).toLocaleString()}</td>
      <td><span class="badge ${r.status==='paid'?'b-paid':'b-pending'}">${r.status==='paid'?'已付款':'待付款'}</span></td>
    </tr>`
  ).join('');

  statusEl.innerHTML = `
    <div class="tbl-wrap" style="margin-bottom:12px">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;font-weight:500">
        預覽前 ${Math.min(5, rows.length)} 筆（共 ${rows.length} 筆）
      </div>
      <table>
        <thead><tr><th>客戶</th><th>說明</th><th>應付日期</th><th>金額</th><th>狀態</th></tr></thead>
        <tbody>${previewRows}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px">
      <button class="btn" onclick="document.getElementById('csvImportStatus').innerHTML=''">取消</button>
      <button class="btn btn-primary" onclick="confirmCSVImport(${JSON.stringify(rows).replace(/"/g,'&quot;')})">
        ✓ 確認匯入全部 ${rows.length} 筆
      </button>
    </div>`;
}

async function confirmCSVImport(rows) {
  if (typeof rows === 'string') rows = JSON.parse(rows.replace(/&quot;/g,'"'));
  let count = 0;
  for (const r of rows) {
    await window.api.receivables.add(r);
    count++;
  }
  await renderReceivables();
  updateSummary();
  document.getElementById('csvImportStatus').innerHTML = `
    <div class="status-msg" style="color:var(--ok);margin-bottom:12px">
      ✓ 成功匯入 ${count} 筆應收帳款！
    </div>`;
  setTimeout(() => {
    const el = document.getElementById('csvImportStatus');
    if (el) el.innerHTML = '';
  }, 4000);
}

// ── 應收帳款 ──
function getStatus(r) {
  if(r.status==='paid') return 'paid';
  if(r.due_date < today()) return 'overdue';
  return 'pending';
}

async function renderReceivables() {
  const filter = document.getElementById('cl-filter')?.value||'all';
  const rows = await window.api.receivables.getAll();
  const bm={paid:'b-paid',pending:'b-pending',overdue:'b-overdue'};
  const lm={paid:'已付款',pending:'待付款',overdue:'已逾期'};
  const filtered = rows.filter(r=>filter==='all'||getStatus(r)===filter);
  document.getElementById('recvTbody').innerHTML = filtered.length ? filtered.map(r=>{
    const s=getStatus(r);
    return `<tr><td>${r.issue_date}</td><td>${r.due_date}${s==='overdue'?' ⚠':''}</td>
    <td>${r.client}</td><td>${r.description}</td>
    <td style="font-size:12px;color:var(--hint)">${r.invoice_no||'—'}</td>
    <td style="font-weight:500">${fmt(r.amount)}</td>
    <td><span class="badge ${bm[s]}">${lm[s]}</span>${s==='paid'&&r.paid_date?`<br><span style="font-size:10px;color:var(--hint)">${r.paid_date}</span>`:''}</td>
    <td style="display:flex;gap:4px;flex-wrap:wrap">
      ${s!=='paid'?`<button class="btn btn-sm btn-success" onclick="markPaid(${r.id})">✓ 確認收款</button>`:''}
      <button class="btn btn-sm btn-danger" onclick="delRecv(${r.id})">刪除</button>
    </td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="8">尚無應收帳款</td></tr>`;
  updateSummary();
}

async function addReceivable() {
  const issue=v('cl-issue'),due=v('cl-due'),amount=parseFloat(v('cl-amount')),client=v('cl-client'),desc=v('cl-desc');
  if(!issue||!due||!amount||!client||!desc){alert('請填寫所有必填欄位');return;}
  await window.api.receivables.add({issue,due,client,desc,invoice:v('cl-inv'),amount});
  ['cl-amount','cl-client','cl-inv','cl-desc'].forEach(clr);
  await renderReceivables();
}

async function markPaid(id) {
  // 取得這筆應收帳款資料
  const rows = await window.api.receivables.getAll();
  const recv = rows.find(r => r.id === id);
  if (!recv) return;

  // 確認付款
  await window.api.receivables.markPaid(id);

  // 自動同步新增到入帳管理
  const paidDate = new Date().toISOString().split('T')[0];
  await window.api.income.add({
    date: paidDate,
    client: recv.client,
    amount: recv.amount,
    title: recv.description || '客戶付款',
    category: '服務費',
    note: `來自客戶付款追蹤${recv.invoice_no ? '，發票：'+recv.invoice_no : ''}`,
    source: 'recv'
  });

  await renderReceivables();
  await renderIncome();
  updateSummary();

  // 提示
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:fixed;top:20px;right:20px;background:#EAF3DE;color:#3B6D11;padding:10px 16px;border-radius:8px;font-size:13px;border:1px solid rgba(59,109,17,0.3);z-index:999;';
  statusEl.textContent = `✓ 已確認收款並同步至入帳管理：${recv.client} / NT$${Number(recv.amount).toLocaleString()}`;
  document.body.appendChild(statusEl);
  setTimeout(() => statusEl.remove(), 4000);
}
async function delRecv(id) { if(!confirm('確定刪除？'))return; await window.api.receivables.delete(id); await renderReceivables(); }

// ── 所有紀錄 ──
async function renderAll() {
  const tf=document.getElementById('rec-type')?.value||'all';
  const mf=document.getElementById('rec-month')?.value||'';
  const kw=(document.getElementById('rec-search')?.value||'').trim().toLowerCase();
  const [inc,exp] = await Promise.all([window.api.income.getAll(),window.api.expense.getAll()]);
  let rows=[];
  if(tf!=='expense') inc.forEach(e=>rows.push({...e,_t:'income',_p:e.client}));
  if(tf!=='income') exp.forEach(e=>rows.push({...e,_t:'expense',_p:e.vendor}));
  if(mf) rows=rows.filter(r=>r.date.startsWith(mf));
  if(kw) rows=rows.filter(r=>[r._p,r.title,r.category,r.note].some(v=>String(v||'').toLowerCase().includes(kw)));
  rows.sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('allTbody').innerHTML = rows.length ? rows.map(r=>`
    <tr><td>${r.date}</td>
    <td><span class="badge ${r._t==='income'?'b-inc':'b-exp'}">${r._t==='income'?'入帳':'出帳'}</span></td>
    <td>${r._p}</td><td>${r.title}</td>
    <td style="font-size:12px;color:var(--hint)">${r.category||'—'}</td>
    <td class="${r._t==='income'?'amount-pos':'amount-neg'}">${r._t==='income'?'+':'-'}${fmt(r.amount)}</td>
    <td>${srcBadge(r.source)}</td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="7">尚無紀錄</td></tr>`;
}

// ── Summary ──
async function updateSummary() {
  const [inc,exp,recv] = await Promise.all([window.api.income.getAll(),window.api.expense.getAll(),window.api.receivables.getAll()]);
  const ti=inc.reduce((s,e)=>s+e.amount,0);
  const te=exp.reduce((s,e)=>s+e.amount,0);
  const tp=recv.filter(r=>getStatus(r)!=='paid').reduce((s,r)=>s+r.amount,0);
  const net=ti-te;
  document.getElementById('sb-inc').textContent=fmt(ti);
  document.getElementById('sb-exp').textContent=fmt(te);
  const nel=document.getElementById('sb-net');
  nel.textContent=(net>=0?'+':'')+fmt(net); nel.style.color=net>=0?'var(--income)':'var(--expense)';
  document.getElementById('sb-pend').textContent=fmt(tp);
  document.getElementById('summaryCards').innerHTML=`
    <div class="s-card"><div class="s-label">📥 總入帳</div><div class="s-val inc">${fmt(ti)}</div></div>
    <div class="s-card"><div class="s-label">📤 總出帳</div><div class="s-val exp">${fmt(te)}</div></div>
    <div class="s-card"><div class="s-label">📊 淨收支</div><div class="s-val ${net>=0?'inc':'exp'}">${net>=0?'+':''}${fmt(net)}</div></div>
    <div class="s-card"><div class="s-label">⏳ 待收款</div><div class="s-val warn">${fmt(tp)}</div></div>`;
}

async function exportCSV() { await window.api.export.csv(); }

async function dbBackup() {
  const ok = await window.api.db.backup();
  if (ok) alert('備份完成！');
}

async function dbRestore() {
  if (!confirm('還原後目前所有資料將被備份檔覆蓋，確定繼續？')) return;
  const ok = await window.api.db.restore();
  if (ok) { alert('還原成功，請重新整理頁面。'); location.reload(); }
}

// ── 客戶管理 ──
async function importCustomersCSV() {
  const result = await window.api.customers.importCSV();
  if (!result) return;
  const { count, skipped } = result;
  await renderCustomers();
  const el = document.getElementById('custImportStatus');
  if (el) {
    el.innerHTML = `<div class="status-msg" style="color:var(--ok);margin-bottom:12px">
      ✓ 成功匯入 ${count} 筆客戶${skipped > 0 ? `，${skipped} 筆已存在略過` : ''}
    </div>`;
    setTimeout(() => { el.innerHTML = ''; }, 4000);
  }
}

async function renderCustomers() {
  const custs = await window.api.customers.getAll();
  const grid = document.getElementById('custGrid');
  if (!grid) return;

  const typeLabel = { income:'入帳客戶', expense:'出帳廠商', both:'兩者' };
  const typeBadge = { income:'b-inc', expense:'b-exp', both:'b-ai' };

  const makeCard = (c) => `
    <div class="cust-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div class="cust-name" style="margin-bottom:0">${c.name}</div>
        <span class="badge ${typeBadge[c.type]||'b-inc'}" style="font-size:10px">${typeLabel[c.type]||'入帳客戶'}</span>
      </div>
      <div class="cust-alias">${c.aliases ? '別名：'+c.aliases : '無別名'}</div>
      <div class="cust-meta">
        ${c.category?`<span>📁 ${c.category}</span>`:''}
        ${c.contact?`<span>👤 ${c.contact}</span>`:''}
        ${c.note&&c.note!=='自動新增'?`<span>📝 ${c.note}</span>`:''}
      </div>
      <div class="cust-actions">
        <button class="btn btn-sm" onclick="openEditCust(${c.id},'${esc(c.name)}','${esc(c.aliases)}','${esc(c.type||'income')}','${esc(c.category)}','${esc(c.contact)}','${esc(c.note)}')">編輯</button>
        <button class="btn btn-sm btn-danger" onclick="delCust(${c.id})">刪除</button>
      </div>
    </div>`;

  if (!custs.length) {
    grid.innerHTML = `<div style="padding:24px;color:var(--hint);font-size:13px">尚未建立任何客戶，點右上角「新增客戶」開始</div>`;
    return;
  }

  const incomeList = custs.filter(c => c.type === 'income' || (!c.type));
  const expenseList = custs.filter(c => c.type === 'expense');
  const bothList = custs.filter(c => c.type === 'both');

  let html = '';

  if (incomeList.length) {
    html += `<div style="grid-column:1/-1;font-size:12px;font-weight:500;color:var(--income);padding:6px 0 4px;border-bottom:1px solid var(--border);margin-bottom:8px">
      📥 入帳客戶（${incomeList.length} 家）
    </div>`;
    html += incomeList.map(makeCard).join('');
  }

  if (expenseList.length) {
    html += `<div style="grid-column:1/-1;font-size:12px;font-weight:500;color:var(--expense);padding:6px 0 4px;border-bottom:1px solid var(--border);margin-top:12px;margin-bottom:8px">
      📤 出帳廠商（${expenseList.length} 家）
    </div>`;
    html += expenseList.map(makeCard).join('');
  }

  if (bothList.length) {
    html += `<div style="grid-column:1/-1;font-size:12px;font-weight:500;color:var(--accent);padding:6px 0 4px;border-bottom:1px solid var(--border);margin-top:12px;margin-bottom:8px">
      🔄 兩者（${bothList.length} 家）
    </div>`;
    html += bothList.map(makeCard).join('');
  }

  grid.innerHTML = html;
}

function esc(s){ return (s||'').replace(/'/g,"\\'"); }

function openAddCust() {
  document.getElementById('custModalTitle').textContent='新增客戶／廠商';
  document.getElementById('cust-edit-id').value='';
  ['cust-name','cust-aliases','cust-category','cust-contact','cust-note'].forEach(clr);
  const typeEl = document.getElementById('cust-type');
  if (typeEl) typeEl.value = 'income';
  document.getElementById('custModal').classList.remove('hidden');
}

function openEditCust(id,name,aliases,type,category,contact,note) {
  document.getElementById('custModalTitle').textContent='編輯客戶／廠商';
  document.getElementById('cust-edit-id').value=id;
  document.getElementById('cust-name').value=name;
  document.getElementById('cust-aliases').value=aliases;
  document.getElementById('cust-category').value=category;
  document.getElementById('cust-contact').value=contact;
  document.getElementById('cust-note').value=note;
  const typeEl = document.getElementById('cust-type');
  if (typeEl) typeEl.value = type || 'both';
  document.getElementById('custModal').classList.remove('hidden');
}

function closeCustModal() { document.getElementById('custModal').classList.add('hidden'); }

async function saveCust() {
  const name=v('cust-name');
  if(!name){alert('請輸入客戶名稱');return;}
  const id=document.getElementById('cust-edit-id').value;
  const typeEl=document.getElementById('cust-type');
  const data={name,aliases:v('cust-aliases'),type:typeEl?typeEl.value:'both',category:v('cust-category'),contact:v('cust-contact'),note:v('cust-note')};
  if(id) { await window.api.customers.update({...data,id:parseInt(id)}); }
  else {
    const r=await window.api.customers.add(data);
    if(r.error){alert(r.error);return;}
  }
  closeCustModal();
  await renderCustomers();
}

async function delCust(id) {
  if(!confirm('確定刪除此客戶？'))return;
  await window.api.customers.delete(id); await renderCustomers();
}

// ── 下載範本 ──
async function downloadTemplate() {
  await window.api.excel.downloadTemplate();
}

// ── 直接匯入固定格式 ──
async function importTemplate() {
  const result = await window.api.excel.importTemplate();
  if (!result) return;

  const { income, expense, receivables } = result;
  let incCount = 0, expCount = 0, recvCount = 0;

  for (const r of income) {
    await window.api.income.add(r);
    incCount++;
  }
  for (const r of expense) {
    await window.api.expense.add(r);
    expCount++;
  }
  for (const r of receivables) {
    await window.api.receivables.add({ ...r, desc: r.desc || r.description || '' });
    recvCount++;
  }

  await loadAll();

  const statusEl = document.getElementById('importStatus');
  if (statusEl) {
    statusEl.innerHTML = `
      <div class="status-msg" style="margin-top:10px;color:var(--ok)">
        ✓ 匯入完成！入帳 ${incCount} 筆、出帳 ${expCount} 筆、應收帳款 ${recvCount} 筆
      </div>`;
    setTimeout(() => { statusEl.innerHTML = ''; }, 5000);
  }
}

// ── Excel 匯入 ──
async function openExcel() {
  const result = await window.api.excel.openDialog();
  if (!result) return;
  excelRows = result.rows;
  analyzedRows = null;
  document.getElementById('excelStatus').innerHTML=`
    <div class="status-msg" style="margin-top:10px;color:var(--ok)">
      ✓ 已載入「${result.fileName}」，共 ${result.rows.length} 筆資料（工作表：${result.sheetName}）
    </div>`;
  document.getElementById('btnAnalyze').classList.remove('hidden');
  document.getElementById('excelPreview').innerHTML='';
  document.getElementById('excelImportBtn').innerHTML='';
}

async function analyzeExcel() {
  if (!apiKey) { alert('請先設定 API Key 才能使用 AI 分析功能'); return; }
  if (!excelRows) return;
  const customers = await window.api.customers.getAll();
  document.getElementById('excelStatus').innerHTML=`
    <div class="status-msg" style="margin-top:10px">
      <span class="spin"></span> AI 正在分析 ${excelRows.length} 筆資料，比對 ${customers.length} 位客戶...
    </div>`;
  document.getElementById('excelPreview').innerHTML='';
  document.getElementById('excelImportBtn').innerHTML='';
  try {
    analyzedRows = await window.api.ai.analyzeExcel({ rows: excelRows, customers, apiKey });
    document.getElementById('excelStatus').innerHTML=`
      <div class="status-msg" style="margin-top:10px;color:var(--ok)">
        ✓ 分析完成，共 ${analyzedRows.length} 筆，請確認後點「確認匯入」
      </div>`;
    renderExcelPreview();
  } catch(e) {
    document.getElementById('excelStatus').innerHTML=`
      <div class="status-msg" style="margin-top:10px;color:var(--danger)">⚠ 分析失敗：${e.message}</div>`;
  }
}

function renderExcelPreview() {
  if (!analyzedRows) return;
  const confDot = c => `<span class="conf-dot ${c==='high'?'conf-high':c==='medium'?'conf-mid':'conf-low'}"></span>`;
  const rows = analyzedRows.map((r,i) => `
    <div class="preview-row">
      <input type="checkbox" class="row-check" id="chk-${i}" checked />
      ${confDot(r.confidence)}
      <span><span class="badge ${r.type==='income'?'b-inc':'b-exp'}" style="font-size:10px">${r.type==='income'?'入帳':'出帳'}</span></span>
      <span>${r.date||'—'}</span>
      <span>${r.party||'—'}${r.isNewCustomer?` <span class="badge b-new" style="font-size:9px">新客戶</span>`:''}</span>
      <span style="color:var(--muted);font-size:12px">${r.title||'—'}</span>
      <span style="font-weight:500">${fmt(r.amount||0)}</span>
      <span style="font-size:11px;color:var(--hint)">${r.invoiceNo||'—'}</span>
      <span><span class="badge ${r.status==='paid'?'b-paid':'b-pending'}" style="font-size:10px">${r.status==='paid'?'已付款':'待付款'}</span></span>
    </div>`).join('');

  document.getElementById('excelPreview').innerHTML=`
    <div class="excel-preview">
      <div class="excel-preview-header">
        <h3>預覽（共 ${analyzedRows.length} 筆）— 不勾選的列不會匯入</h3>
        <div style="display:flex;gap:6px;font-size:12px;color:var(--muted);align-items:center">
          <span class="conf-dot conf-high"></span>高信心
          <span class="conf-dot conf-mid"></span>中
          <span class="conf-dot conf-low"></span>低
        </div>
      </div>
      <div class="preview-row header">
        <span>✓</span><span>信心</span><span>類型</span><span>日期</span><span>客戶/廠商</span><span>說明</span><span>金額</span><span>發票</span><span>付款</span>
      </div>
      ${rows}
    </div>`;

  document.getElementById('excelImportBtn').innerHTML=`
    <div style="display:flex;justify-content:flex-end;margin-top:12px;gap:8px">
      <button class="btn" onclick="document.getElementById('excelPreview').innerHTML='';document.getElementById('excelImportBtn').innerHTML=''">取消</button>
      <button class="btn btn-primary" onclick="confirmImport()">✓ 確認匯入選取的資料</button>
    </div>`;
}

async function confirmImport() {
  if (!analyzedRows) return;
  let importedInc=0, importedExp=0, skipped=0;
  for (let i=0; i<analyzedRows.length; i++) {
    const chk = document.getElementById('chk-'+i);
    if (!chk || !chk.checked) { skipped++; continue; }
    const r = analyzedRows[i];
    if (r.type==='income') {
      await window.api.income.add({ date:r.date||today(), client:r.party||'未知', amount:r.amount||0, title:r.title||'匯入', category:r.category||'其他', note:r.note||'', source:'excel' });
      importedInc++;
    } else {
      await window.api.expense.add({ date:r.date||today(), vendor:r.party||'未知', amount:r.amount||0, title:r.title||'匯入', category:r.category||'其他', note:r.note||'', source:'excel' });
      importedExp++;
    }
  }
  await loadAll();
  document.getElementById('excelStatus').innerHTML=`
    <div class="status-msg" style="margin-top:10px;color:var(--ok)">
      ✓ 匯入完成！入帳 ${importedInc} 筆、出帳 ${importedExp} 筆，略過 ${skipped} 筆
    </div>`;
  document.getElementById('excelPreview').innerHTML='';
  document.getElementById('excelImportBtn').innerHTML='';
  document.getElementById('btnAnalyze').classList.add('hidden');
  excelRows=null; analyzedRows=null;
}

// ── AI 拍照辨識 ──
let cameraStream = null;

async function openCamera() {
  const cameraArea = document.getElementById('cameraArea');
  const video = document.getElementById('cameraVideo');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = cameraStream;
    cameraArea.style.display = 'block';
    document.getElementById('previewArea').innerHTML = '';
    document.getElementById('aiResultArea').innerHTML = '';
    document.getElementById('aiStatus').innerHTML = '';
  } catch(err) {
    if (err.name === 'NotAllowedError') {
      alert('請允許程式使用鏡頭。\n\nMac 請到「系統設定」→「隱私權與安全性」→「相機」，確認帳務管理系統已勾選。');
    } else {
      alert('無法開啟鏡頭：' + err.message);
    }
  }
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  document.getElementById('cameraArea').style.display = 'none';
}

async function takePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  closeCamera();

  // 轉成 base64
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64 = dataUrl.split(',')[1];

  // 顯示預覽
  document.getElementById('previewArea').innerHTML = `<img src="${dataUrl}" class="preview-img" alt="拍照預覽" style="max-height:200px;margin-top:10px" />`;
  document.getElementById('aiResultArea').innerHTML = '';
  document.getElementById('aiStatus').innerHTML = `<div class="status-msg"><span class="spin"></span> AI 正在分析，請稍候...</div>`;

  try {
    const result = await window.api.ai.analyzeImage({ base64, mimeType: 'image/jpeg', apiKey });
    document.getElementById('aiStatus').innerHTML = '';
    if (result.error) {
      document.getElementById('aiStatus').innerHTML = `<div class="status-msg" style="color:var(--danger)">⚠ ${result.error}</div>`;
      return;
    }
    showAiResult(result);
  } catch(err) {
    document.getElementById('aiStatus').innerHTML = `<div class="status-msg" style="color:var(--danger)">⚠ 辨識失敗：${err.message}</div>`;
  }
}

async function handleFile(e) {
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async(ev)=>{
    const dataUrl=ev.target.result, base64=dataUrl.split(',')[1], mimeType=file.type||'image/jpeg';
    document.getElementById('previewArea').innerHTML=`<img src="${dataUrl}" class="preview-img" alt="單據預覽"/>`;
    document.getElementById('aiResultArea').innerHTML='';
    document.getElementById('aiStatus').innerHTML=`<div class="status-msg"><span class="spin"></span> AI 正在分析，請稍候...</div>`;
    try {
      const result=await window.api.ai.analyzeImage({base64,mimeType,apiKey});
      document.getElementById('aiStatus').innerHTML='';
      if(result.error){document.getElementById('aiStatus').innerHTML=`<div class="status-msg" style="color:var(--danger)">⚠ ${result.error}</div>`;return;}
      showAiResult(result);
    } catch(err){
      document.getElementById('aiStatus').innerHTML=`<div class="status-msg" style="color:var(--danger)">⚠ 辨識失敗：${err.message}</div>`;
    }
  };
  reader.readAsDataURL(file);
}

function showAiResult(r) {
  const cl={high:'高 ✓',medium:'中',low:'低 ⚠'}[r.confidence]||'—';
  const ic=['服務費','產品銷售','顧問費','維護費','其他'];
  const ec=['水電','租金','薪資','設備','軟體訂閱','行銷','差旅','其他'];
  // 拍照辨識預設為出帳
  const type = r.type || 'expense';
  const cats = type==='income' ? ic : ec;
  const aiCat = r.category || '';
  const isCustomCat = aiCat && !cats.includes(aiCat);
  const selectedCat = isCustomCat ? '其他' : (cats.includes(aiCat) ? aiCat : cats[0]);
  const customCatVal = isCustomCat ? aiCat : '';
  document.getElementById('aiResultArea').innerHTML=`
    <div class="ai-box">
      <div class="ai-box-title">✦ AI 辨識結果 &nbsp;<span class="badge b-ai">信心：${cl}</span></div>
      <div class="ai-field"><label>類型</label><select id="ai-type" onchange="updateAiCats()"><option value="expense" ${type==='expense'?'selected':''}>出帳（支出）</option><option value="income" ${type==='income'?'selected':''}>入帳（收款）</option></select></div>
      <div class="ai-field"><label>日期</label><input type="date" id="ai-date" value="${r.date||today()}"/></div>
      <div class="ai-field"><label>${r.type==='income'?'客戶':'廠商'}</label><input type="text" id="ai-party" value="${r.party||''}"/></div>
      <div class="ai-field"><label>款項說明</label><input type="text" id="ai-title" value="${r.title||''}"/></div>
      <div class="ai-field"><label>金額</label><input type="number" id="ai-amount" value="${r.amount||''}" min="0"/></div>
      <div class="ai-field"><label>類別</label><div style="display:flex;flex-direction:column;gap:4px;flex:1">
        <select id="ai-cat" onchange="toggleCatCustom('ai-cat','ai-cat-custom')">${cats.map(c=>`<option value="${c}" ${c===selectedCat?'selected':''}>${c==='其他'?'其他（自訂）':c}</option>`).join('')}</select>
        <input type="text" id="ai-cat-custom" placeholder="請輸入自訂類別" style="display:${isCustomCat?'':'none'}" value="${customCatVal}"/>
      </div></div>
      <div class="ai-field"><label>備註</label><input type="text" id="ai-note" value="${r.note||''}"/></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn" onclick="cancelAi()">取消</button>
        <button class="btn btn-ai" onclick="confirmAi()">✓ 確認並新增</button>
      </div>
    </div>`;
}

function updateAiCats() {
  const t=document.getElementById('ai-type').value;
  const ic=['服務費','產品銷售','顧問費','維護費','其他'];
  const ec=['水電','租金','薪資','設備','軟體訂閱','行銷','差旅','其他'];
  document.getElementById('ai-cat').innerHTML=(t==='income'?ic:ec).map(c=>`<option value="${c}">${c==='其他'?'其他（自訂）':c}</option>`).join('');
  const customInp = document.getElementById('ai-cat-custom');
  if (customInp) { customInp.style.display='none'; customInp.value=''; }
}

async function confirmAi() {
  const type=document.getElementById('ai-type').value;
  const date=document.getElementById('ai-date').value;
  const party=document.getElementById('ai-party').value.trim();
  const title=document.getElementById('ai-title').value.trim();
  const amount=parseFloat(document.getElementById('ai-amount').value);
  const category=getCatVal('ai-cat','ai-cat-custom');
  const note=document.getElementById('ai-note').value.trim();
  if(!date||!party||!title||!amount){alert('請確認所有必填欄位');return;}
  if(type==='income') {
    await window.api.income.add({date,client:party,amount,title,category,note,source:'ai'});
    await window.api.customers.autoAdd({name:party, type:'income'});
    await renderIncome();
  } else {
    await window.api.expense.add({date,vendor:party,amount,title,category,note,source:'ai'});
    await window.api.customers.autoAdd({name:party, type:'expense'});
    await renderExpense();
  }
  await renderCustomers();
  document.getElementById('aiResultArea').innerHTML=`<div class="status-msg" style="color:var(--ok)">✓ 已成功新增${type==='income'?'入帳':'出帳'}：${party} / ${fmt(amount)}</div>`;
  document.getElementById('previewArea').innerHTML='';
  document.getElementById('fileInput').value='';
  await renderAiHist(); updateSummary();
  setTimeout(()=>{document.getElementById('aiResultArea').innerHTML='';document.getElementById('aiStatus').innerHTML='';},3000);
}

function cancelAi() {
  document.getElementById('aiResultArea').innerHTML='';
  document.getElementById('previewArea').innerHTML='';
  document.getElementById('aiStatus').innerHTML='';
  document.getElementById('fileInput').value='';
}

async function renderAiHist() {
  const [inc,exp]=await Promise.all([window.api.income.getAll(),window.api.expense.getAll()]);
  const rows=[
    ...inc.filter(e=>e.source==='ai').map(e=>({...e,_t:'income',_p:e.client})),
    ...exp.filter(e=>e.source==='ai').map(e=>({...e,_t:'expense',_p:e.vendor}))
  ].sort((a,b)=>b.id-a.id).slice(0,10);
  const tb=document.getElementById('aiHistTbody');
  if(tb) tb.innerHTML=rows.length?rows.map(r=>`
    <tr><td>${r.date}</td>
    <td><span class="badge ${r._t==='income'?'b-inc':'b-exp'}">${r._t==='income'?'入帳':'出帳'}</span></td>
    <td>${r._p}</td><td>${r.title}</td>
    <td class="${r._t==='income'?'amount-pos':'amount-neg'}">${r._t==='income'?'+':'-'}${fmt(r.amount)}</td>
    <td><span class="badge b-ai" style="font-size:10px">${r.category}</span></td></tr>`).join('')
    :`<tr class="empty-row"><td colspan="6">尚未透過 AI 新增任何紀錄</td></tr>`;
}

// ── Google Drive ──
function updateMonthOptions() {
  const year = parseInt(document.getElementById('sel-year')?.value || '115');
  const box = document.getElementById('monthCheckboxes');
  if (!box) return;
  box.innerHTML = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => `
    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" class="month-chk" value="${m}" />
      ${m}月
    </label>`).join('');
}

function selectAllMonths(checked) {
  document.querySelectorAll('.month-chk').forEach(el => el.checked = checked);
}

async function initGoogleAuth() {
  const r = await window.api.google.checkAuth();
  const statusEl = document.getElementById('gAuthStatus');
  const authBtn = document.getElementById('gAuthBtn');
  const revokeBtn = document.getElementById('gRevokeBtn');
  if (!statusEl) return;

  if (r.status === 'authorized') {
    statusEl.textContent = '✓ 已授權，可以開始抓取';
    statusEl.style.color = 'var(--ok)';
    if (authBtn) authBtn.textContent = '重新授權';
    if (revokeBtn) revokeBtn.classList.remove('hidden');
  } else if (r.status === 'no_credentials') {
    statusEl.textContent = '⚠ 找不到 credentials.json，請把檔案放到程式資料夾內（與 server.js 同層）';
    statusEl.style.color = 'var(--danger)';
    if (authBtn) authBtn.disabled = true;
  } else {
    statusEl.textContent = '尚未授權，請點「登入 Google 帳號」';
    statusEl.style.color = 'var(--muted)';
    if (revokeBtn) revokeBtn.classList.add('hidden');
  }
}

async function googleAuthorize() {
  const statusEl = document.getElementById('gAuthStatus');
  if (statusEl) { statusEl.textContent = '正在開啟瀏覽器授權，請在瀏覽器完成登入...'; statusEl.style.color = 'var(--warn)'; }
  const r = await window.api.google.authorize();
  if (r.success) {
    if (statusEl) { statusEl.textContent = '✓ 授權成功！'; statusEl.style.color = 'var(--ok)'; }
    await initGoogleAuth();
  } else {
    if (statusEl) { statusEl.textContent = `⚠ 授權失敗：${r.message}`; statusEl.style.color = 'var(--danger)'; }
  }
}

async function googleRevoke() {
  if (!confirm('確定要取消 Google 授權嗎？')) return;
  await window.api.google.revokeAuth();
  await initGoogleAuth();
}

async function googleFetch() {
  const year = parseInt(document.getElementById('sel-year')?.value || '115');
  const months = [];
  document.querySelectorAll('.month-chk').forEach(el => {
    if (el.checked) months.push(parseInt(el.value));
  });
  if (!months.length) { alert('請至少選擇一個月份'); return; }

  const statusEl = document.getElementById('gFetchStatus');
  const previewEl = document.getElementById('gFetchPreview');
  const importEl = document.getElementById('gFetchImportBtn');
  previewEl.innerHTML = '';
  importEl.innerHTML = '';

  statusEl.innerHTML = `<div class="status-msg" style="margin-top:10px"><span class="spin"></span> 正在掃描 Google Drive 中的請款單，請稍候...</div>`;

  const r = await window.api.google.fetchInvoices({ months, year });

  if (!r.success) {
    statusEl.innerHTML = `<div class="status-msg" style="margin-top:10px;color:var(--danger)">⚠ ${r.message}</div>`;
    return;
  }

  const data = r.data;
  if (!data.length) {
    statusEl.innerHTML = `<div class="status-msg" style="margin-top:10px;color:var(--warn)">⚠ 找不到符合月份的請款資料</div>`;
    return;
  }

  // 取得現有應收帳款，用於重複判斷
  const existingRecvs = await window.api.receivables.getAll();
  const existingRecvSet = new Set(existingRecvs.map(r => `${r.client}__${r.description}`));

  function isDuplicate(r) {
    const desc = `${r.matchedPeriod || (r.year||115)+'年'+r.month+'月'} 服務費`;
    return existingRecvSet.has(`${r.client}__${desc}`);
  }

  const dupCount = data.filter(r => isDuplicate(r)).length;
  statusEl.innerHTML = `<div class="status-msg" style="margin-top:10px;color:var(--ok)">✓ 找到 ${data.length} 筆資料${dupCount > 0 ? `，其中 ${dupCount} 筆已存在（自動取消勾選）` : ''}，請確認後匯入</div>`;

  const rows = data.map((r,i) => {
    const dup = isDuplicate(r);
    return `
    <tr style="${dup ? 'opacity:0.5' : ''}">
      <td><input type="checkbox" class="row-check" id="gchk-${i}" ${dup ? '' : 'checked'} /></td>
      <td>${r.client}</td>
      <td>${r.year || 115}年${r.month}月</td>
      <td style="font-size:12px;color:var(--muted)">${r.matchedPeriod || '—'}</td>
      <td style="font-weight:500">NT$${Number(r.amount).toLocaleString()}</td>
      <td>${dup ? '<span class="badge" style="background:var(--muted);color:#fff;font-size:11px">已存在</span>' : ''}</td>
    </tr>`;
  }).join('');

  previewEl.innerHTML = `
    <div class="tbl-wrap" style="margin-top:14px">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;font-weight:500">
        預覽（共 ${data.length} 筆）— 不勾選的不會匯入
      </div>
      <table>
        <thead><tr><th>✓</th><th>客戶</th><th>月份</th><th>計費期間</th><th>金額</th><th>狀態</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  importEl.innerHTML = `
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick="document.getElementById('gFetchPreview').innerHTML='';document.getElementById('gFetchImportBtn').innerHTML=''">取消</button>
      <button class="btn btn-primary" onclick="confirmGoogleImport(${JSON.stringify(data).replace(/"/g,'&quot;')})">
        ✓ 確認匯入
      </button>
    </div>`;
}

async function confirmGoogleImport(data) {
  if (typeof data === 'string') data = JSON.parse(data.replace(/&quot;/g,'"'));
  let count = 0, newCustCount = 0;

  // 取得現有客戶名單
  const existingCusts = await window.api.customers.getAll();
  const existingNames = new Set(existingCusts.map(c => c.name));

  for (let i = 0; i < data.length; i++) {
    const chk = document.getElementById(`gchk-${i}`);
    if (!chk || !chk.checked) continue;
    const r = data[i];

    // 自動新增客戶（若不在名單中）
    if (r.client && !existingNames.has(r.client)) {
      await window.api.customers.add({ name: r.client, aliases: '', category: '', contact: '', note: '由 Google Drive 同步自動新增' });
      existingNames.add(r.client);
      newCustCount++;
    }

    // 匯入應收帳款
    await window.api.receivables.add({
      issue: r.issueDate || new Date().toISOString().split('T')[0],
      due: r.dueDate || new Date().toISOString().split('T')[0],
      client: r.client,
      desc: `${r.matchedPeriod || (r.year||115)+'年'+r.month+'月'} 服務費`,
      amount: r.amount,
      invoice: '',
      status: 'pending'
    });
    count++;
  }

  await renderReceivables();
  await renderCustomers();
  updateSummary();

  const skippedCount = data.length - count;
  let msg = `✓ 成功匯入 ${count} 筆到客戶付款追蹤！`;
  if (skippedCount > 0) msg += ` 略過 ${skippedCount} 筆（未勾選或已存在）。`;
  if (newCustCount > 0) msg += ` 並自動新增 ${newCustCount} 位新客戶到客戶名單。`;
  document.getElementById('gFetchStatus').innerHTML = `<div class="status-msg" style="color:var(--ok);margin-top:10px">${msg}</div>`;
  document.getElementById('gFetchPreview').innerHTML = '';
  document.getElementById('gFetchImportBtn').innerHTML = '';
}
