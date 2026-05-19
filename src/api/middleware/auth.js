/**
 * API 키 인증 미들웨어
 */

const { loadConfig } = require('../../utils/config');

function apiKeyAuth(req, res, next) {
  const config = loadConfig();
  const apiKey = config.api?.apiKey;

  // API 키가 설정되지 않으면 인증 건너뜀 (개발용)
  if (!apiKey) return next();

  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== apiKey) {
    return res.status(401).json({ error: '인증 실패: 유효하지 않은 API 키' });
  }

  next();
}

module.exports = apiKeyAuth;
