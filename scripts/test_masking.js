#!/usr/bin/env node

const assert = require('assert');
const { maskSensitiveInfo, maskObjectSensitiveInfo } = require('../src/utils/masking');

const cases = [
  {
    input: 'vendor user@example.com websquare_5_0_5_feature_20250916_1128.x86_64_B.zip plugin delivery request',
    expected: 'vendor [이메일] [첨부파일] plugin delivery request',
  },
  {
    input: '회사명/프로젝트명 가상은행 차세대 시스템 구축',
    expected: '회사명/프로젝트명 [고객/프로젝트]',
  },
  {
    input: '작성자 홍길동 010-1234-5678',
    expected: '작성자 [이름] [전화번호]',
  },
  {
    input: 'apiKey: abc123 password=secret clientSecret xyz',
    expected: 'apiKey: [비밀값] password: [비밀값] clientSecret: [비밀값]',
  },
  {
    input: 'GridView spanAll rowIndex expression 문의',
    expected: 'GridView spanAll rowIndex expression 문의',
  },
  {
    input: '속성명 설명 showDepth 초기 로딩 시 펼쳐질 Depth를 설정',
    expected: '속성명 설명 showDepth 초기 로딩 시 펼쳐질 Depth를 설정',
  },
  {
    input: '성명 홍길동',
    expected: '성명 [이름]',
  },
];

for (const { input, expected } of cases) {
  assert.strictEqual(maskSensitiveInfo(input), expected);
}

assert.deepStrictEqual(
  maskObjectSensitiveInfo({
    query: '회사명/프로젝트명 가상은행 차세대 시스템 구축',
    nested: { author: '작성자 홍길동' },
  }),
  {
    query: '회사명/프로젝트명 [고객/프로젝트]',
    nested: { author: '작성자 [이름]' },
  }
);

console.log('masking tests ok');
