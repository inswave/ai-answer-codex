/**
 * 설정 로드 유틸리티
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config/config.json');

let _config = null;

/**
 * 설정 파일 로드
 * @returns {object} 설정 객체
 */
function loadConfig() {
  if (_config) return _config;

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[Config] 설정 파일 없음: ${CONFIG_PATH}`);
    console.error('[Config] config/config.example.json을 복사하여 config/config.json을 생성하세요.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  _config = JSON.parse(raw);
  return _config;
}

/**
 * 설정 캐시 초기화
 */
function reloadConfig() {
  _config = null;
  return loadConfig();
}

module.exports = { loadConfig, reloadConfig };
