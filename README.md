# 帳務管理系統 — 安裝說明

## 📋 環境需求
- Node.js 18 以上（https://nodejs.org 下載 LTS 版本）
- Windows 10/11 或 macOS 11+

---

## 🚀 快速開始（三步驟）

### 第一步：安裝 Node.js
1. 前往 https://nodejs.org
2. 下載「LTS」版本
3. 點兩下安裝，全部按「Next」即可

### 第二步：安裝程式依賴套件
打開「命令提示字元」（Windows）或「終端機」（Mac），進入本資料夾：

```bash
cd 帳務管理系統
npm install
```

等待安裝完成（約 1-2 分鐘）

### 第三步：打包成 .exe 安裝檔

**Windows：**
```bash
npm run build-win
```

**Mac：**
```bash
npm run build-mac
```

打包完成後，安裝檔會出現在 `dist/` 資料夾內：
- Windows：`dist/帳務管理系統 Setup 1.0.0.exe`
- Mac：`dist/帳務管理系統-1.0.0.dmg`

---

## 🔑 AI 拍照辨識功能設定
1. 前往 https://console.anthropic.com
2. 登入後點選「API Keys」→「Create Key」
3. 複製 API Key（格式：sk-ant-...）
4. 開啟程式後，在彈出視窗貼上 API Key 即可

---

## 💾 資料儲存位置
資料儲存在本機 SQLite 資料庫，位置：
- Windows：`C:\Users\你的帳號\AppData\Roaming\accounting-app\accounting.db`
- Mac：`~/Library/Application Support/accounting-app/accounting.db`

程式更新後資料不會消失。

---

## 🧪 開發模式（不打包直接執行）
```bash
npm start
```

---

## ❓ 常見問題

**Q：安裝時出現「better-sqlite3」錯誤？**
A：執行 `npm install --build-from-source` 重新安裝

**Q：Mac 顯示「無法開啟，因為它來自未識別的開發者」？**
A：在 Finder 對著 .app 按右鍵 → 選「開啟」→ 點「開啟」

**Q：資料可以備份嗎？**
A：直接複製上面的 .db 檔案即可備份，也可以從程式內匯出 CSV
