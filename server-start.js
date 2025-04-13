/**
 * 자동 재시작 기능이 포함된 서버 실행 스크립트
 * pm2 또는 nodemon이 설치되어 있으면 해당 도구를 사용하고,
 * 없는 경우 기본 실행 방식을 사용합니다.
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// 로그 디렉토리 생성
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 현재 날짜 기반 로그 파일명 생성
const getLogFileName = (prefix) => {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return path.join(LOG_DIR, `${prefix}-${dateStr}.log`);
};

// PM2가 설치되어 있는지 확인
function checkPM2Installed() {
  return new Promise((resolve) => {
    exec('pm2 --version', (error) => {
      resolve(!error);
    });
  });
}

// Nodemon이 설치되어 있는지 확인
function checkNodemonInstalled() {
  return new Promise((resolve) => {
    exec('nodemon --version', (error) => {
      resolve(!error);
    });
  });
}

// PM2로 서버 실행
function startWithPM2() {
  console.log('PM2를 사용하여 서버를 실행합니다...');
  
  // 기존 PM2 프로세스 정리
  exec('pm2 delete all', () => {
    // Next.js 서버 실행
    exec('pm2 start npm --name "next-app" -- run next-dev', (error) => {
      if (error) {
        console.error('Next.js 서버 실행 중 오류:', error);
      } else {
        console.log('Next.js 서버가 실행되었습니다 (PM2)');
      }
    });
    
    // API 서버 실행
    exec('pm2 start server/index.js --name "api-server"', (error) => {
      if (error) {
        console.error('API 서버 실행 중 오류:', error);
      } else {
        console.log('API 서버가 실행되었습니다 (PM2)');
      }
    });
    
    // WebSocket 서버 실행
    exec('pm2 start server/websocket.js --name "websocket-server"', (error) => {
      if (error) {
        console.error('WebSocket 서버 실행 중 오류:', error);
      } else {
        console.log('WebSocket 서버가 실행되었습니다 (PM2)');
      }
    });
    
    // PM2 모니터링 실행
    exec('pm2 monit');
  });
}

// Nodemon으로 서버 실행
function startWithNodemon() {
  console.log('Nodemon을 사용하여 서버를 실행합니다...');
  
  // Next.js 서버 실행
  const nextDevLog = fs.openSync(getLogFileName('next-dev'), 'a');
  const nextServer = spawn('nodemon', ['--exec', 'npm', 'run', 'next-dev'], {
    stdio: ['ignore', nextDevLog, nextDevLog],
    detached: true,
    shell: true
  });
  nextServer.unref();
  console.log('Next.js 서버가 실행되었습니다 (Nodemon)');
  
  // API 서버 실행
  const apiLog = fs.openSync(getLogFileName('api-server'), 'a');
  const apiServer = spawn('nodemon', ['server/index.js'], {
    stdio: ['ignore', apiLog, apiLog],
    detached: true,
    shell: true
  });
  apiServer.unref();
  console.log('API 서버가 실행되었습니다 (Nodemon)');
  
  // WebSocket 서버 실행
  const wsLog = fs.openSync(getLogFileName('websocket-server'), 'a');
  const wsServer = spawn('nodemon', ['server/websocket.js'], {
    stdio: ['ignore', wsLog, wsLog],
    detached: true,
    shell: true
  });
  wsServer.unref();
  console.log('WebSocket 서버가 실행되었습니다 (Nodemon)');
}

// 기본 방식으로 서버 실행
function startWithBasic() {
  console.log('기본 방식으로 서버를 실행합니다...');
  
  // 로그 파일 생성
  const nextDevLog = fs.openSync(getLogFileName('next-dev'), 'a');
  const apiLog = fs.openSync(getLogFileName('api-server'), 'a');
  const wsLog = fs.openSync(getLogFileName('websocket-server'), 'a');
  
  // 모든 서버 동시 실행 (npm run dev 명령어 실행)
  const server = spawn('npm', ['run', 'dev'], {
    stdio: ['ignore', fs.openSync(getLogFileName('combined'), 'a'), fs.openSync(getLogFileName('combined-error'), 'a')],
    shell: true
  });
  
  server.on('close', (code) => {
    console.log(`서버가 종료되었습니다. 종료 코드: ${code}`);
    
    // 비정상 종료인 경우 5초 후 재시작
    if (code !== 0) {
      console.log('5초 후 서버를 재시작합니다...');
      setTimeout(() => {
        startWithBasic();
      }, 5000);
    }
  });
  
  console.log('서버가 실행되었습니다 (기본 방식)');
}

// 메인 함수
async function main() {
  console.log('서버 실행 스크립트를 시작합니다...');
  
  // 설치된 도구 확인
  const pm2Installed = await checkPM2Installed();
  const nodemonInstalled = await checkNodemonInstalled();
  
  // 적절한 방식으로 서버 실행
  if (pm2Installed) {
    startWithPM2();
  } else if (nodemonInstalled) {
    startWithNodemon();
  } else {
    startWithBasic();
  }
}

// 스크립트 실행
main().catch(console.error); 