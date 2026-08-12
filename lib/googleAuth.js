/* ============================================================
   Google サービスアカウント認証共通モジュール
   秘密鍵はソースコードに書かず、環境変数から読み込む。
   Vercel等のダッシュボードで以下2つを設定すること:
     GOOGLE_SA_PRIVATE_KEY   ... サービスアカウントの秘密鍵(PEM形式)
     GOOGLE_SA_CLIENT_EMAIL  ... サービスアカウントのメールアドレス
   ============================================================ */
const crypto = require('crypto');

function loadPrivateKey() {
    let key = process.env.GOOGLE_SA_PRIVATE_KEY || '';
    // 環境変数に "\n" (バックスラッシュn) で改行を入れている場合は実改行に変換する
    if (key.indexOf('\\n') !== -1 && key.indexOf('\n') === -1) {
        key = key.replace(/\\n/g, '\n');
    }
    return key;
}

function getClientEmail() {
    return process.env.GOOGLE_SA_CLIENT_EMAIL || '';
}

function assertConfigured() {
    if (!loadPrivateKey() || !getClientEmail()) {
        throw new Error('サーバーにGoogleサービスアカウントの環境変数(GOOGLE_SA_PRIVATE_KEY / GOOGLE_SA_CLIENT_EMAIL)が設定されていません。');
    }
}

function signJwt(scope) {
    assertConfigured();
    const rawKey = loadPrivateKey();
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: getClientEmail(),
        scope,
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signatureInput = `${b64(header)}.${b64(payload)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(rawKey, 'base64url');
    return `${signatureInput}.${signature}`;
}

async function getAccessToken(scope) {
    const jwt = signJwt(scope);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(`Google Auth Error: ${JSON.stringify(tokenData)}`);
    return tokenData.access_token;
}

module.exports = { getAccessToken, signJwt };
