// Redis 연결 테스트 스크립트
const { createClient } = require('redis');
require('dotenv').config();

async function testRedis() {
  console.log('Redis 연결 테스트 시작...');
  console.log('환경 변수:');
  console.log('  REDIS_URL:', process.env.REDIS_URL?.replace(/:\/\/.*@/, '://****@')); // 비밀번호 가림
  console.log('  REDISHOST:', process.env.REDISHOST);
  console.log('  REDISPORT:', process.env.REDISPORT);
  console.log('  USE_LOCAL_STORAGE:', process.env.USE_LOCAL_STORAGE);
  
  try {
    // Redis 클라이언트 생성
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          console.log(`재연결 시도 ${retries}...`);
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 10000 // 10초
      }
    });
    
    // 이벤트 리스너 등록
    client.on('error', (err) => {
      console.error('Redis 오류:', err);
    });
    
    client.on('connect', () => {
      console.log('Redis 서버에 연결됨');
    });
    
    client.on('ready', () => {
      console.log('Redis 클라이언트 준비됨');
    });
    
    // 연결
    console.log('Redis 서버에 연결 시도 중...');
    await client.connect();
    
    // 테스트 값 저장
    console.log('테스트 값 저장 중...');
    await client.set('test-key', '연결 테스트 성공: ' + new Date().toISOString());
    
    // 테스트 값 조회
    const value = await client.get('test-key');
    console.log('저장된 값 확인:', value);
    
    // 연결 종료
    await client.quit();
    console.log('Redis 연결 테스트 완료 - 성공');
    return true;
  } catch (error) {
    console.error('Redis 연결 테스트 실패:', error);
    return false;
  }
}

// 스크립트 실행
testRedis()
  .then(success => {
    console.log('테스트 결과:', success ? '성공' : '실패');
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('테스트 중 오류 발생:', err);
    process.exit(1);
  }); 