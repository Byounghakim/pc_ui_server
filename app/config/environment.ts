import { z } from 'zod';

// 환경 설정 스키마 정의
const environmentSchema = z.object({
  // Redis 연결 정보
  redisUrl: z.string().optional(),
  redisPassword: z.string().optional(),
  redisHost: z.string().optional(),
  redisPort: z.string().optional(),
  
  // API 서버 설정
  apiUrl: z.string().default('/api'),
  apiKey: z.string().default('test-api-key'),
  
  // 백엔드 API URL 설정
  backendApiUrl: z.string().default('/api/health'),
  
  // 저장소 전략 설정 (redis, local, hybrid)
  storageStrategy: z.enum(['redis', 'local', 'hybrid']).default('hybrid'),
  
  // 로컬 스토리지 설정
  useLocalStorage: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(true)
  ),
  localStoragePath: z.string().default('local-redis-state.json'),
  
  // 디버그 모드
  debugMode: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(false)
  ),
  
  // MQTT 서버 설정
  mqttDevUrl: z.string().default('ws://192.168.0.26:8080'), //1차 수정(내부 ip)
  mqttProdUrl: z.string().default('ws://203.234.35.54:8080'), //1차 수정(외부 ip)
  mqttUsername: z.string().default('dnature'),
  mqttPassword: z.string().default('8210'),
});

// 환경 변수 타입 정의
export type Environment = z.infer<typeof environmentSchema>;

// 환경 변수 로드 및 검증
export const env: Environment = environmentSchema.parse({
  // Redis 연결 정보
  redisUrl: process.env.REDIS_URL,
  redisPassword: process.env.REDIS_PASSWORD,
  redisHost: process.env.REDISHOST,
  redisPort: process.env.REDISPORT,
  
  // API 서버 설정
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  apiKey: process.env.API_KEY,
  
  // 백엔드 API URL 설정
  backendApiUrl: process.env.BACKEND_API_URL,
  
  // 저장소 전략 설정
  storageStrategy: process.env.FORCE_STORAGE_STRATEGY,
  
  // 로컬 스토리지 설정
  useLocalStorage: process.env.USE_LOCAL_STORAGE,
  localStoragePath: process.env.LOCAL_STORAGE_PATH,
  
  // 디버그 모드
  debugMode: process.env.DEBUG_MODE,
  
  // MQTT 서버 설정
  mqttDevUrl: process.env.NEXT_PUBLIC_MQTT_DEV_URL,
  mqttProdUrl: process.env.NEXT_PUBLIC_MQTT_PROD_URL,
  mqttUsername: process.env.NEXT_PUBLIC_MQTT_USERNAME,
  mqttPassword: process.env.NEXT_PUBLIC_MQTT_PASSWORD,
});

// 현재 환경이 개발 환경인지 체크
export const isDevelopment = process.env.NODE_ENV === 'development';

// 현재 환경이 프로덕션 환경인지 체크
export const isProduction = process.env.NODE_ENV === 'production';

// MQTT URL 선택 (개발 또는 프로덕션)
export const activeMqttUrl = isDevelopment ? env.mqttDevUrl : env.mqttProdUrl;

// 로컬 스토리지 사용 여부
export const shouldUseLocalStorage = env.useLocalStorage || (env.storageStrategy === 'local');

// 로깅 타입 정의
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// 로깅 함수 - 디버그 모드일 때만 출력
export const debugLog = (...args: any[]) => {
  if (env.debugMode) {
    console.log('[DEBUG]', ...args);
  }
};

// 로깅 함수 - 로그 레벨에 따라 출력
export const logger = {
  debug: (...args: any[]) => {
    if (env.debugMode) {
      console.log('[DEBUG]', ...args);
    }
  },
  info: (...args: any[]) => {
    console.log('[INFO]', ...args);
  },
  warn: (...args: any[]) => {
    console.warn('[WARN]', ...args);
  },
  error: (...args: any[]) => {
    console.error('[ERROR]', ...args);
  },
  log: (level: LogLevel, ...args: any[]) => {
    switch (level) {
      case LogLevel.DEBUG:
        if (env.debugMode) console.log('[DEBUG]', ...args);
        break;
      case LogLevel.INFO:
        console.log('[INFO]', ...args);
        break;
      case LogLevel.WARN:
        console.warn('[WARN]', ...args);
        break;
      case LogLevel.ERROR:
        console.error('[ERROR]', ...args);
        break;
    }
  }
};

// 로그 그룹 생성 함수 (로깅 시작과 종료를 표시)
export const createLogGroup = (groupName: string) => {
  const startTime = Date.now();
  
  console.group(`[GROUP] ${groupName}`);
  logger.debug(`시작: ${new Date(startTime).toISOString()}`);
  
  return {
    end: () => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      logger.debug(`종료: ${new Date(endTime).toISOString()} (소요시간: ${duration}ms)`);
      console.groupEnd();
    },
    log: (level: LogLevel, ...args: any[]) => {
      logger.log(level, ...args);
    }
  };
};

// 환경 설정 로깅
if (isDevelopment) {
  console.log('===== 환경 설정 =====');
  console.log(`- 환경: ${isDevelopment ? '개발' : '프로덕션'}`);
  console.log(`- 저장소 전략: ${env.storageStrategy}`);
  console.log(`- 로컬 스토리지 사용: ${shouldUseLocalStorage}`);
  console.log(`- 디버그 모드: ${env.debugMode}`);
  console.log(`- API URL: ${env.apiUrl}`);
  console.log(`- 활성화된 MQTT URL: ${activeMqttUrl}`);
  console.log('====================');
} 