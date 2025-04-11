// Next.js 구성에서 정적 내보내기(output: 'export') 설정을 제거하는 스크립트
const fs = require('fs');
const path = require('path');

const nextConfigPath = path.resolve(__dirname, '../next.config.js');

try {
  if (fs.existsSync(nextConfigPath)) {
    let nextConfig = fs.readFileSync(nextConfigPath, 'utf8');
    
    // output: 'export' 설정 제거
    nextConfig = nextConfig.replace(/output:\s*['"]export['"]/g, '// output: export - 정적 내보내기 비활성화됨');
    
    // images.unoptimized 설정 제거
    nextConfig = nextConfig.replace(/unoptimized:\s*true/g, '// unoptimized: true - 정적 내보내기 비활성화됨');
    
    fs.writeFileSync(nextConfigPath, nextConfig, 'utf8');
    console.log('Next.js 설정에서 정적 내보내기 관련 설정이 비활성화되었습니다.');
  } else {
    console.log('Next.js 구성 파일을 찾을 수 없습니다.');
  }
} catch (error) {
  console.error('Next.js 설정 수정 중 오류 발생:', error);
  process.exit(1);
} 