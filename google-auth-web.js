// google-auth-web.js — Google OAuth（Web 版，不依賴 Electron）
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

function getTokenPath(dataDir) {
  return path.join(dataDir, 'google_token.json');
}

function getCredentials(appDir) {
  const p = path.join(appDir, 'credentials.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function getAuthClient(appDir, dataDir) {
  const creds = getCredentials(appDir);
  if (!creds) throw new Error('找不到 credentials.json');
  const { client_id, client_secret } = creds.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3141');
  const tokenPath = getTokenPath(dataDir);
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }
  return null;
}

async function authorize(appDir, dataDir) {
  const creds = getCredentials(appDir);
  if (!creds) throw new Error('找不到 credentials.json，請確認檔案放在程式資料夾內');
  const { client_id, client_secret } = creds.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3141');
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

  // 開啟瀏覽器（Windows）
  exec(`start "" "${authUrl}"`);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3141');
      const code = url.searchParams.get('code');
      if (!code) { res.end('錯誤'); return; }
      res.end('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px">✓ 授權成功！請返回帳務管理系統</h2>');
      server.close();
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        fs.writeFileSync(getTokenPath(dataDir), JSON.stringify(tokens));
        resolve(oAuth2Client);
      } catch(e) { reject(e); }
    });
    server.listen(3141);
    setTimeout(() => { server.close(); reject(new Error('授權逾時（2分鐘）')); }, 120000);
  });
}

module.exports = { getAuthClient, authorize, getTokenPath };
