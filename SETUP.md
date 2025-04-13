# 서버 설정 및 배포 가이드

이 문서는 로컬 PC 서버와 Railway 배포 환경을 연결하는 방법을 안내합니다.

## 1. 로컬 PC 서버 설정

### 필수 도구 설치

#### PM2 설치 (권장)
PM2는 Node.js 애플리케이션을 관리하고 항상 실행 상태를 유지하는 프로세스 매니저입니다.

```bash
npm install -g pm2
```

#### Nodemon 설치 (대안)
PM2를 사용하지 않는 경우 Nodemon을 설치하여 서버 자동 재시작 기능을 활용할 수 있습니다.

```bash
npm install -g nodemon
```

### 환경 변수 설정 (.env 파일)

`.env` 파일에서 다음 설정을 확인하세요:

```
# Redis 연결 모드 (로컬에서 필요에 따라 설정)
USE_LOCAL_STORAGE=false  # Redis 서버 사용
# USE_LOCAL_STORAGE=true  # 로컬 스토리지 모드 사용
```

### 서버 실행

서버를 실행하는 방법은 두 가지가 있습니다:

1. 자동 재시작 스크립트 사용 (권장)
```bash
node server-start.js
```

2. 기본 실행 방법
```bash
npm run dev
```

## 2. Railway 배포 설정

### Railway CLI 설치

```bash
npm install -g @railway/cli
```

### Railway에 로그인

```bash
railway login
```

### 프로젝트 연결

```bash
railway link
```

### 환경 변수 설정

Railway 대시보드에서 `railway-env-example.txt` 파일의 내용을 참고하여 환경 변수를 설정합니다.

**중요: Railway 환경에서는 반드시 `USE_LOCAL_STORAGE=false`로 설정해야 합니다.**

### 배포

```bash
railway up
```

## 3. Redis 연결 테스트

Redis 연결이 제대로 작동하는지 확인하려면 다음 명령을 실행하세요:

```bash
node -e "
const { createClient } = require('redis');
require('dotenv').config();

async function testRedis() {
  const client = createClient({
    url: process.env.REDIS_URL
  });
  
  client.on('error', (err) => console.error('Redis 오류:', err));
  client.on('connect', () => console.log('Redis에 연결됨'));
  
  await client.connect();
  await client.set('test', 'Redis 연결 테스트');
  const value = await client.get('test');
  console.log('Redis 값:', value);
  await client.quit();
}

testRedis().catch(console.error);
"
```

## 4. 문제 해결

### Redis 연결 문제
- Redis 서버 URL과 자격 증명이 올바른지 확인
- 네트워크 설정 문제가 있는지 확인 (방화벽 등)
- Railway 설정에서 Redis 서비스가 올바르게 연결되어 있는지 확인

### Railway 배포 문제
- `railway logs` 명령어로 로그 확인
- 환경 변수가 올바르게 설정되었는지 확인
- `PORT` 환경 변수가 설정되었는지 확인

### 로컬 서버 문제
- 로그 파일 확인 (`logs` 디렉토리)
- Redis 연결 모드 설정 확인 (`USE_LOCAL_STORAGE` 환경 변수)
- 포트 충돌 여부 확인 