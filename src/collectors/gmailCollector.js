/**
 * Gmail IMAP 기반 기술문의 자동 크롤러
 *
 * 2-Phase 방식:
 *   Phase 1: UID 경량 검색 (7개 병렬 쿼리)
 *   Phase 2: 30건 배치 본문 다운로드
 *
 * 후처리: 스레드 그룹핑 → Q&A 변환 → 개인정보 마스킹
 */

const Imap = require('imap');
const { google } = require('googleapis');
const { simpleParser } = require('mailparser');
const { maskPersonalInfo } = require('../utils/masking');
const { convertToQA } = require('../utils/converter');
const { loadConfig } = require('../utils/config');
const fs = require('fs').promises;
const path = require('path');

// Gmail X-GM-RAW 확장 검색 쿼리 (7개 병렬)
const SEARCH_QUERIES = [
  'subject:(기술문의)',
  'subject:(기술지원)',
  'subject:(WebSquare)',
  'subject:(웹스퀘어)',
  'subject:(GridView)',
  'subject:(엑셀 다운로드)',
  'subject:(라이선스)',
];

const BATCH_SIZE = 30;
const BLOCKED_ATTACHMENT_EXT = new Set(['.ellicense', '.license', '.lic', '.key']);
const BLOCKED_ATTACHMENT_NAME = /license|licence|라이선스|라이센스/i;

function isBlockedGmailAttachment(filename) {
  const name = String(filename || '');
  const ext = path.extname(name).toLowerCase();
  return BLOCKED_ATTACHMENT_EXT.has(ext) || BLOCKED_ATTACHMENT_NAME.test(name);
}

class GmailCollector {
  constructor(config) {
    this.config = config || loadConfig().gmail;
    this.imap = null;
    this.collectedMails = [];
  }

  /**
   * OAuth2 refresh token으로 access token 발급 후 XOAUTH2 SASL 토큰 생성
   */
  async _getXOAuth2Token() {
    const { clientId, clientSecret, refreshToken } = this.config.oauth || {};

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        'Gmail OAuth 설정 누락 (clientId/clientSecret/refreshToken). ' +
        'node scripts/gmail-oauth-setup.js 를 먼저 실행하세요.'
      );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { token: accessToken } = await oauth2Client.getAccessToken();
    if (!accessToken) {
      throw new Error('Gmail OAuth access token 발급 실패. refresh token 만료 가능성 — 재인증 필요.');
    }

    const authString = `user=${this.config.user}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString).toString('base64');
  }

  /**
   * IMAP 연결 생성 (OAuth2 또는 App Password)
   */
  async _createConnection() {
    const useOAuth =
      this.config.authType === 'oauth2' ||
      (this.config.oauth && this.config.oauth.refreshToken);

    const opts = {
      user: this.config.user,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 15000,
    };

    if (useOAuth) {
      opts.xoauth2 = await this._getXOAuth2Token();
    } else {
      opts.password = this.config.appPassword;
    }

    return new Imap(opts);
  }

  /**
   * IMAP 연결 및 메일박스 오픈
   */
  async connect() {
    this.imap = await this._createConnection();
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => {
        this.imap.openBox('INBOX', true, (err) => {
          if (err) return reject(err);
          console.log('[Gmail] IMAP 연결 성공');
          resolve();
        });
      });
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  /**
   * Phase 1: UID 일괄 검색 (7개 쿼리 병렬 실행)
   * @param {Object} [options] - 검색 옵션
   * @param {string} [options.rawQuery] - 단일 검색 쿼리 (지정 시 SEARCH_QUERIES 대신 사용)
   */
  async searchUIDs(options = {}) {
    const allUIDs = new Set();
    const { rawQuery } = options;

    const queries = rawQuery ? [rawQuery] : SEARCH_QUERIES;

    const searchPromises = queries.map((query) => {
      return new Promise((resolve, reject) => {
        this.imap.search([['X-GM-RAW', query]], (err, uids) => {
          if (err) return reject(err);
          resolve(uids || []);
        });
      });
    });

    const results = await Promise.allSettled(searchPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        result.value.forEach((uid) => allUIDs.add(uid));
      } else {
        console.warn('[Gmail] 검색 쿼리 실패:', result.reason?.message);
      }
    }

    console.log(`[Gmail] Phase 1 완료: ${allUIDs.size}건 UID 확보`);
    return Array.from(allUIDs);
  }

  /**
   * Phase 2: 배치 단위 본문 다운로드
   * @param {Object} [options] - 옵션
   * @param {Function} [options.onBatch] - 배치 완료 콜백 (parsedMails) => void. 메모리 절약용.
   */
  async fetchBatch(uids, options = {}) {
    const mails = [];

    for (let i = 0; i < uids.length; i += BATCH_SIZE) {
      const batch = uids.slice(i, i + BATCH_SIZE);

      // IMAP 연결 상태 확인
      if (!this.imap || this.imap.state !== 'authenticated') {
        throw new Error('IMAP 연결 끊김 (batch ' + i + ')');
      }

      const batchMails = await this._fetchMailBatch(batch);

      // 빈 결과 = 연결 끊김 가능성
      if (batchMails.length === 0 && batch.length > 0) {
        throw new Error('IMAP 빈 응답 - 연결 끊김 의심 (batch ' + i + ')');
      }

      if (options.onBatch) {
        const parsed = await this.parseMails(batchMails);
        options.onBatch(parsed);
      } else {
        mails.push(...batchMails);
      }

      console.log(`[Gmail] Phase 2 진행: ${Math.min(i + BATCH_SIZE, uids.length)}/${uids.length}`);
    }

    return mails;
  }

  /**
   * 단일 배치 메일 다운로드
   */
  async _fetchMailBatch(uids) {
    return new Promise((resolve, reject) => {
      const mails = [];
      const fetch = this.imap.fetch(uids, { bodies: '', struct: true });

      fetch.on('message', (msg) => {
        let buffer = '';
        msg.on('body', (stream) => {
          stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
        });
        msg.once('end', () => {
          mails.push(buffer);
        });
      });

      fetch.once('error', reject);
      fetch.once('end', () => resolve(mails));
    });
  }

  /**
   * 메일 파싱 및 구조화 (첨부파일 포함)
   */
  async parseMails(rawMails) {
    const parsed = [];

    for (const raw of rawMails) {
      try {
        const mail = await simpleParser(raw);
        const attachments = (mail.attachments || [])
          .filter((att) => !isBlockedGmailAttachment(att.filename || 'unknown'))
          .map((att) => ({
            filename: att.filename || 'unknown',
            contentType: att.contentType || '',
            size: att.size || 0,
            content: att.content, // Buffer
          }));

        parsed.push({
          subject: mail.subject || '',
          from: mail.from?.text || '',
          to: mail.to?.text || '',
          date: mail.date?.toISOString() || '',
          text: mail.text || '',
          html: mail.html || '',
          messageId: mail.messageId || '',
          inReplyTo: mail.inReplyTo || '',
          references: mail.references || [],
          attachments,
        });
      } catch (err) {
        console.warn('[Gmail] 메일 파싱 실패:', err.message);
      }
    }

    return parsed;
  }

  /**
   * 첨부파일 저장
   */
  async saveAttachments(mails, outputDir) {
    const attachDir = path.join(outputDir, 'gmail_attachments');
    await fs.mkdir(attachDir, { recursive: true });

    let count = 0;
    for (const mail of mails) {
      if (!mail.attachments || mail.attachments.length === 0) continue;

      // 메일별 폴더: 날짜_제목 (파일명 안전 처리)
      const dateStr = mail.date ? mail.date.split('T')[0] : 'unknown';
      const safeSubject = (mail.subject || 'no-subject')
        .replace(/[<>:"/\\|?*\[\]]/g, '_')
        .substring(0, 50)
        .trim();
      const mailDir = path.join(attachDir, `${dateStr}_${safeSubject}`);
      await fs.mkdir(mailDir, { recursive: true });

      for (const att of mail.attachments) {
        if (!att.content) continue;
        if (isBlockedGmailAttachment(att.filename)) continue;
        const filePath = path.join(mailDir, att.filename);
        await fs.writeFile(filePath, att.content);
        count++;
      }
    }

    console.log(`[Gmail] 첨부파일 저장 완료: ${count}건 → ${attachDir}`);
    return count;
  }

  /**
   * 스레드 그룹핑: inReplyTo/references 기반
   */
  groupByThread(mails) {
    const threads = new Map();

    for (const mail of mails) {
      const threadId = mail.references?.[0] || mail.inReplyTo || mail.messageId;
      if (!threads.has(threadId)) {
        threads.set(threadId, []);
      }
      threads.get(threadId).push(mail);
    }

    // 시간순 정렬
    for (const [, thread] of threads) {
      thread.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    console.log(`[Gmail] 스레드 그룹핑 완료: ${threads.size}개 스레드`);
    return threads;
  }

  /**
   * 전체 크롤링 실행
   * @param {Object} [searchOptions] - searchUIDs에 전달할 옵션
   */
  async collect(searchOptions) {
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 30000; // 30초 대기 후 재시도
    const CHECKPOINT_PATH = path.join(__dirname, '../../data/raw/.gmail_checkpoint.json');
    const QA_PARTIAL_PATH = path.join(__dirname, '../../data/raw/.gmail_qa_partial.json');

    let uids = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.connect();

        // Phase 1: UID 검색 (첫 시도에만)
        if (!uids) {
          uids = await this.searchUIDs(searchOptions);
          if (uids.length === 0) {
            console.log('[Gmail] 수집할 메일 없음');
            return [];
          }
        }

        // 체크포인트 복원
        let doneUIDs = new Set();
        let savedQA = [];
        try {
          const cp = JSON.parse(await fs.readFile(CHECKPOINT_PATH, 'utf8'));
          doneUIDs = new Set(cp.doneUIDs || []);
          console.log(`[Gmail] 체크포인트 복원: ${doneUIDs.size}건 건너뜀`);
        } catch {}
        try {
          savedQA = JSON.parse(await fs.readFile(QA_PARTIAL_PATH, 'utf8'));
          console.log(`[Gmail] 중간 저장분 복원: ${savedQA.length}건 Q&A`);
        } catch {}

        const remainingUIDs = uids.filter(uid => !doneUIDs.has(uid));
        if (remainingUIDs.length === 0) {
          console.log('[Gmail] 모든 UID 처리 완료');
          // 최종 Q&A 중복 제거
          const seen = new Set();
          const qaData = savedQA.filter(qa => {
            const key = (qa.question || '').substring(0, 100);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          try { await fs.unlink(CHECKPOINT_PATH); } catch {}
          try { await fs.unlink(QA_PARTIAL_PATH); } catch {}
          console.log(`[Gmail] 수집 완료: ${qaData.length}건 Q&A 변환`);
          this.collectedMails = qaData;
          return qaData;
        }

        console.log(`[Gmail] 다운로드 대상: ${remainingUIDs.length}/${uids.length}건 (시도 ${attempt}/${MAX_RETRIES})`);

        let batchCount = 0;
        const allParsed = [];

        await this.fetchBatch(remainingUIDs, {
          onBatch: async (parsed) => {
            allParsed.push(...parsed);
            batchCount++;

            const threads = this.groupByThread(parsed);
            for (const [, thread] of threads) {
              const qa = convertToQA(thread);
              if (qa) {
                qa.question = maskPersonalInfo(qa.question);
                qa.answer = maskPersonalInfo(qa.answer);
                qa.source = 'Gmail 기술문의';
                savedQA.push(qa);
              }
            }

            // 매 10배치(300건)마다 체크포인트 + Q&A 중간 저장
            if (batchCount % 10 === 0) {
              const processedUIDs = [...doneUIDs, ...remainingUIDs.slice(0, batchCount * BATCH_SIZE)];
              await fs.writeFile(CHECKPOINT_PATH, JSON.stringify({ doneUIDs: processedUIDs }), 'utf8');
              await fs.writeFile(QA_PARTIAL_PATH, JSON.stringify(savedQA, null, 2), 'utf8');
              console.log(`[Gmail] 중간 저장: ${savedQA.length}건 Q&A, ${processedUIDs.length}건 UID`);
            }
          }
        });

        // 배치 완료 후 최종 체크포인트 저장
        const finalUIDs = [...doneUIDs, ...remainingUIDs.slice(0, batchCount * BATCH_SIZE)];
        await fs.writeFile(CHECKPOINT_PATH, JSON.stringify({ doneUIDs: finalUIDs }), 'utf8');
        await fs.writeFile(QA_PARTIAL_PATH, JSON.stringify(savedQA, null, 2), 'utf8');

        this._parsedMails = allParsed;

        // 최종 Q&A 중복 제거
        const seen = new Set();
        const qaData = savedQA.filter(qa => {
          const key = (qa.question || '').substring(0, 100);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        try { await fs.unlink(CHECKPOINT_PATH); } catch {}
        try { await fs.unlink(QA_PARTIAL_PATH); } catch {}

        console.log(`[Gmail] 수집 완료: ${qaData.length}건 Q&A 변환`);
        this.collectedMails = qaData;
        return qaData;

      } catch (err) {
        this.disconnect();
        console.error(`[Gmail] 연결 끊김 (시도 ${attempt}/${MAX_RETRIES}): ${err.message}`);

        // 끊기기 전 처리분 체크포인트 저장
        try {
          let doneUIDs = new Set();
          let savedQA = [];
          try { doneUIDs = new Set(JSON.parse(await fs.readFile(CHECKPOINT_PATH, 'utf8')).doneUIDs || []); } catch {}
          try { savedQA = JSON.parse(await fs.readFile(QA_PARTIAL_PATH, 'utf8')); } catch {}
          console.log(`[Gmail] 현재까지: ${doneUIDs.size}건 UID, ${savedQA.length}건 Q&A 저장됨`);
        } catch {}

        if (attempt < MAX_RETRIES) {
          console.log(`[Gmail] ${RETRY_DELAY / 1000}초 후 재시도...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        } else {
          console.error('[Gmail] 최대 재시도 횟수 초과');
          // 중간 저장분이라도 반환
          let savedQA = [];
          try { savedQA = JSON.parse(await fs.readFile(QA_PARTIAL_PATH, 'utf8')); } catch {}
          this.collectedMails = savedQA;
          return savedQA;
        }
      } finally {
        this.disconnect();
      }
    }
  }

  /**
   * 수집 결과 저장 (Q&A + 첨부파일)
   */
  async save(outputDir) {
    const outputPath = path.join(outputDir, 'gmail_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(this.collectedMails, null, 2), 'utf8');
    console.log(`[Gmail] 저장 완료: ${outputPath}`);

    // 첨부파일 저장
    if (this._parsedMails) {
      await this.saveAttachments(this._parsedMails, outputDir);
    }
  }

  disconnect() {
    if (this.imap) {
      this.imap.end();
      this.imap = null;
    }
  }
}

module.exports = GmailCollector;
