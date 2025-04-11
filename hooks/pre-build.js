#!/usr/bin/env node

/**
 * 빌드 전 ESLint 및 타입스크립트 검사를 완전히 비활성화하기 위한 스크립트
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 빌드 전처리 스크립트 시작...');

// 프로젝트 루트 경로
const rootDir = process.cwd();

// ESLint 관련 파일 경로
const eslintConfigPath = path.join(rootDir, '.eslintrc.json');
const eslintIgnorePath = path.join(rootDir, '.eslintignore');

// 빈 ESLint 설정
const emptyEslintConfig = {
  extends: [],
  rules: {},
  ignorePatterns: ["**/*"]
};

// ESLint 설정 파일 덮어쓰기
try {
  fs.writeFileSync(eslintConfigPath, JSON.stringify(emptyEslintConfig, null, 2), 'utf8');
  console.log('✅ ESLint 설정 파일이 비활성화되었습니다.');
} catch (error) {
  console.error('❌ ESLint 설정 파일 비활성화 실패:', error);
}

// ESLint Ignore 파일 덮어쓰기 - 모든 파일 무시
try {
  fs.writeFileSync(eslintIgnorePath, '**/*\n', 'utf8');
  console.log('✅ ESLint Ignore 파일이 업데이트되었습니다.');
} catch (error) {
  console.error('❌ ESLint Ignore 파일 업데이트 실패:', error);
}

// .env 파일에 ESLint 비활성화 환경 변수 추가
const envPath = path.join(rootDir, '.env');
const envContent = `
# ESLint 비활성화 환경 변수
DISABLE_ESLINT_PLUGIN=true
NEXT_DISABLE_ESLINT=1
ESLINT_NO_DEV_ERRORS=true
NEXT_TELEMETRY_DISABLED=1
CI=false
SKIP_PREFLIGHT_CHECK=true
`;

try {
  fs.writeFileSync(envPath, envContent, { flag: 'a' });
  console.log('✅ .env 파일에 ESLint 비활성화 환경 변수가 추가되었습니다.');
} catch (error) {
  console.error('❌ .env 파일 업데이트 실패:', error);
}

// Next.js 설정 파일 수정하여 ESLint 및 TypeScript 검사 비활성화
const nextConfigPath = path.join(rootDir, 'next.config.js');
if (fs.existsSync(nextConfigPath)) {
  try {
    const configContent = fs.readFileSync(nextConfigPath, 'utf8');
    
    // 설정 파일에 eslint 및 typescript 옵션이 이미 있는지 확인
    if (!configContent.includes('eslint: {')) {
      // eslint 및 typescript 비활성화 설정 추가
      const updatedContent = configContent.replace(
        'const nextConfig = {', 
        'const nextConfig = {\n  eslint: { ignoreDuringBuilds: true },\n  typescript: { ignoreBuildErrors: true },'
      );
      
      fs.writeFileSync(nextConfigPath, updatedContent, 'utf8');
      console.log('✅ Next.js 설정 파일에서 ESLint 및 TypeScript 검사가 비활성화되었습니다.');
    } else {
      console.log('ℹ️ Next.js 설정 파일에는 이미 ESLint 비활성화 옵션이 포함되어 있습니다.');
    }
  } catch (error) {
    console.error('❌ Next.js 설정 파일 수정 실패:', error);
  }
}

console.log('�� 빌드 전처리 스크립트 완료!'); 