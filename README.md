# 帳務管理系統

## 下載安裝

前往 [Releases 頁面](../../releases/latest) 下載最新版本：

- **Windows**：下載 `帳務管理系統 Setup x.x.x.exe`，點兩下安裝即可
- **Mac（M1/M2/M3）**：下載 `帳務管理系統-x.x.x-arm64.dmg`
- **Mac（Intel）**：下載 `帳務管理系統-x.x.x.dmg`

安裝完成後直接開啟使用，無需其他設定。

---

## AI 拍照辨識功能

需要 Anthropic API Key 才能使用：

1. 前往 https://console.anthropic.com 申請 API Key
2. 開啟程式後在「拍照辨識」頁面設定 API Key

---

## 常見問題

**Mac 顯示「已損毀，無法開啟」？**
開啟「終端機」App，貼上以下指令並按 Enter：
```
xattr -cr /Applications/帳務管理系統.app
```
執行完成後再重新開啟程式即可。

**Mac 顯示「無法開啟，因為它來自未識別的開發者」？**
在 Finder 對著程式按右鍵 → 選「開啟」→ 點「開啟」

**程式更新後資料會消失嗎？**
不會，資料存在本機，更新程式不影響資料。
