/**
 * Gmail OAuth 2.0 1회 인증 스크립트
 *
 * 실행 절차:
 *   1. config/config.json의 gmail.oauth.clientId, clientSecret 입력
 *   2. node scripts/gmail-oauth-setup.js 실행
 *   3. 브라우저에서 ts-support@inswave.com 으로 로그인 후 권한 승인
 *   4. refresh token이 자동으로 config.json에 저장됨
 *
 * 이후 일반 크롤링(npm run collect:gmail)은 OAuth로 자동 동작.
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '../config/config.json');
const SCOPES = ['https://mail.google.com/'];

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[OAuth] config.json 없음: ${CONFIG_PATH}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const oauth = config.gmail?.oauth || {};
  const { clientId, clientSecret } = oauth;

  if (!clientId || !clientSecret) {
    console.error('[OAuth] config.json의 gmail.oauth.clientId / clientSecret를 먼저 입력하세요.');
    console.error('         Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(데스크톱 앱)');
    process.exit(1);
  }

  // 1) 빈 포트로 로컬 콜백 서버 기동
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    login_hint: config.gmail?.user || undefined,
  });

  console.log('\n[OAuth] 다음 URL을 브라우저에서 여세요 (자동으로 열림):');
  console.log(authUrl);
  console.log('');

  // 2) 브라우저 자동 실행 (Windows: start, macOS: open, Linux: xdg-open)
  const platform = process.platform;
  const opener = platform === 'win32' ? 'start ""' : platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${authUrl}"`, (err) => {
    if (err) {
      console.warn('[OAuth] 브라우저 자동 실행 실패. 위 URL을 수동으로 여세요.');
    }
  });

  // 3) 콜백 대기
  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const { code, error } = parsed.query;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(`<h1>인증 실패</h1><p>${error}</p>`);
        reject(new Error(`OAuth 인증 거부됨: ${error}`));
      } else {
        res.end('<h1>인증 성공</h1><p>이 창을 닫고 터미널로 돌아가세요.</p>');
        resolve(code);
      }
    });

    setTimeout(() => reject(new Error('OAuth 콜백 타임아웃 (5분)')), 5 * 60 * 1000);
  });

  server.close();

  // 4) authorization code → refresh token 교환
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('\n[OAuth] refresh_token을 받지 못했습니다.');
    console.error('         이미 동의한 적이 있어 Google이 재발급을 안 했을 수 있습니다.');
    console.error('         https://myaccount.google.com/permissions 에서 앱 권한을 제거 후 재시도하세요.');
    process.exit(1);
  }

  // 5) config.json에 refresh token 저장
  config.gmail.oauth.refreshToken = tokens.refresh_token;
  config.gmail.authType = 'oauth2';
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

  console.log('\n[OAuth] refresh token이 config.json에 저장되었습니다.');
  console.log('[OAuth] 이제 npm run collect:gmail 으로 크롤링이 가능합니다.');
}

main().catch((err) => {
  console.error('\n[OAuth] 오류:', err.message);
  process.exit(1);
});
