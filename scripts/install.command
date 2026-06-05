#!/bin/bash
APP_NAME="帳務管理系統.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$SCRIPT_DIR/$APP_NAME"
APP_DEST="/Applications/$APP_NAME"

# 確認 app 存在
if [ ! -d "$APP_SRC" ]; then
  osascript -e 'display dialog "找不到帳務管理系統.app，請確認此腳本與 app 在同一個 DMG 內。" buttons {"確定"} default button "確定" with icon stop'
  exit 1
fi

# 複製到 Applications
cp -R "$APP_SRC" "$APP_DEST"

# 移除隔離標記（解決「已損毀」問題）
xattr -cr "$APP_DEST"

# 完成提示
osascript -e 'display dialog "帳務管理系統安裝完成！" buttons {"開啟程式"} default button "開啟程式" with icon note'
open "$APP_DEST"
