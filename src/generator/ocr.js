const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../utils/config');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
const DEFAULT_MAX_IMAGES = 3;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PREPROCESS_TIMEOUT_MS = 30000;

function isImageAttachment(attachment = {}) {
  const filename = String(attachment.filename || attachment.name || '');
  const ext = path.extname(filename).toLowerCase();
  const mimeType = String(attachment.mimeType || attachment.contentType || '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/');
}

function getImageBuffer(attachment = {}) {
  const encoding = String(attachment.encoding || '').toLowerCase();
  const value = attachment.data ?? attachment.content;
  if (encoding !== 'base64' || typeof value !== 'string' || !value.trim()) return null;

  const base64 = value.includes(',')
    ? value.slice(value.indexOf(',') + 1)
    : value;

  try {
    return Buffer.from(base64, 'base64');
  } catch (_) {
    return null;
  }
}

function getSafeImageExtension(attachment = {}) {
  const filename = String(attachment.filename || attachment.name || '');
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? ext : '.png';
}

function runTesseract(filePath, ocrConfig) {
  return new Promise((resolve) => {
    const command = ocrConfig.command || 'tesseract';
    const lang = ocrConfig.lang || 'kor+eng';
    const timeoutMs = Number(ocrConfig.timeoutMs || DEFAULT_TIMEOUT_MS);
    const args = [filePath, 'stdout', '-l', lang];
    if (ocrConfig.tessdataDir) {
      args.push('--tessdata-dir', path.resolve(ocrConfig.tessdataDir));
    }

    execFile(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          error: stderr?.trim() || err.message,
        });
        return;
      }

      resolve({
        ok: true,
        text: String(stdout || '').trim(),
      });
    });
  });
}

function runImagePreprocess(inputPath, outputPath, ocrConfig) {
  return new Promise((resolve) => {
    if (ocrConfig.preprocess === false) {
      resolve({ ok: false, skipped: true });
      return;
    }

    const command = ocrConfig.preprocessCommand || 'convert';
    const timeoutMs = Number(ocrConfig.preprocessTimeoutMs || DEFAULT_PREPROCESS_TIMEOUT_MS);
    const resize = ocrConfig.preprocessResize || '200%';
    const args = [
      inputPath,
      '-auto-orient',
      '-colorspace', 'Gray',
      '-resize', resize,
      '-normalize',
      '-sharpen', '0x1',
      outputPath,
    ];

    execFile(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          error: stderr?.trim() || err.message,
        });
        return;
      }

      resolve({ ok: true });
    });
  });
}

// [2026-06-19] 방안B — 인라인 base64 가 없으면, 게시판이 서버에 업로드해둔 원본 이미지 파일을
//   직접 읽어 OCR 한다. 클라이언트는 대용량 base64 대신 serverPath(업로드 저장경로)만 보낸다.
//   경로 조작(traversal) 방지: ocr.uploadBaseDir 하위 경로만 허용한다(미설정 시 비활성).
function resolveImageBuffer(attachment, ocrConfig) {
  // 1) 인라인 base64 우선 (기존 동작)
  const inline = getImageBuffer(attachment);
  if (inline) return { buffer: inline, source: 'inline' };

  // 2) 서버 저장 경로에서 읽기 (방안B)
  const serverPath = String(attachment.serverPath || attachment.uploaded_filename || '').trim();
  if (!serverPath) return { buffer: null, reason: 'no_payload' };

  if (!ocrConfig.uploadBaseDir) return { buffer: null, reason: 'uploadBaseDir_not_configured' };
  const baseDir = path.resolve(ocrConfig.uploadBaseDir);
  const resolved = path.resolve(serverPath);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    return { buffer: null, reason: 'path_outside_base' };
  }

  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { buffer: null, reason: 'file_not_found' };
    }
    return { buffer: fs.readFileSync(resolved), source: 'server_file' };
  } catch (err) {
    return { buffer: null, reason: 'read_error', error: err.message };
  }
}

async function ocrAttachment(attachment, ocrConfig, index) {
  const resolved = resolveImageBuffer(attachment, ocrConfig);
  const buffer = resolved.buffer;
  if (!buffer) return { status: 'no_payload', text: '', reason: resolved.reason, error: resolved.error };

  const maxBytes = Number(ocrConfig.maxBytes || DEFAULT_MAX_BYTES);
  if (buffer.length > maxBytes) {
    return { status: 'skipped_oversize', text: '', bytes: buffer.length };
  }

  const ext = getSafeImageExtension(attachment);
  const filePath = path.join(
    os.tmpdir(),
    `techassistant-ocr-${process.pid}-${Date.now()}-${index}${ext}`
  );
  const preprocessedPath = path.join(
    os.tmpdir(),
    `techassistant-ocr-${process.pid}-${Date.now()}-${index}-pre.png`
  );

  try {
    fs.writeFileSync(filePath, buffer);
    const preprocessed = await runImagePreprocess(filePath, preprocessedPath, ocrConfig);
    const targetPath = preprocessed.ok ? preprocessedPath : filePath;
    let result = await runTesseract(targetPath, ocrConfig);
    if (!result.ok && preprocessed.ok) {
      result = await runTesseract(filePath, ocrConfig);
    }
    if (!result.ok) {
      return { status: 'failed', text: '', error: result.error };
    }
    return {
      status: result.text ? 'ok' : 'empty',
      text: result.text,
      bytes: buffer.length,
    };
  } catch (err) {
    return { status: 'failed', text: '', error: err.message };
  } finally {
    try { fs.unlinkSync(filePath); } catch (_) {}
    try { fs.unlinkSync(preprocessedPath); } catch (_) {}
  }
}

async function enrichAttachmentsWithOcr(attachments = [], config = loadConfig()) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const ocrConfig = config.ocr || {};
  if (ocrConfig.enabled === false) return attachments;

  const maxImages = Number(ocrConfig.maxImages || DEFAULT_MAX_IMAGES);
  let processed = 0;
  const out = [];

  for (let i = 0; i < attachments.length; i++) {
    const item = attachments[i];
    if (!isImageAttachment(item) || processed >= maxImages) {
      out.push(item);
      continue;
    }

    processed++;
    let ocr;
    try {
      ocr = await ocrAttachment(item, ocrConfig, i);
    } catch (err) {
      ocr = { status: 'failed', text: '', error: err.message };
    }
    if (ocr.status === 'failed' && ocrConfig.failOpen !== false) {
      const filename = item.filename || item.name || `image-${i + 1}`;
      console.warn(`[OCR] failed for ${filename}; continuing without OCR: ${ocr.error || 'unknown error'}`);
      out.push(item);
      continue;
    }
    out.push({
      ...item,
      ocrText: ocr.text || '',
      ocrStatus: ocr.status,
      ocrError: ocr.error || '',
      ocrReason: ocr.reason || '',
    });
  }

  return out;
}

module.exports = {
  enrichAttachmentsWithOcr,
  getImageBuffer,
  isImageAttachment,
};
