/**
 * 환경 설정 및 감지 모듈
 * 
 * 애플리케이션의 다양한 환경(개발, 테스트, 프로덕션)에 따른
 * 설정을 관리하고 현재 실행 환경을 감지하는 기능을 제공합니다.
 */

// 브라우저 환경인지 확인
export const isBrowser = typeof window !== 'undefined';

// 서버 환경인지 확인
export const isServer = !isBrowser;

// 개발 환경인지 확인
export const isDevelopment = process.env.NODE_ENV === 'development';

// 프로덕션 환경인지 확인
export const isProduction = process.env.NODE_ENV === 'production';

// 테스트 환경인지 확인
export const isTest = process.env.NODE_ENV === 'test';

// 클라우드 환경인지 확인 (Railway, Vercel, Netlify 등)
export const isCloudEnvironment = () => {
  if (isServer) {
    return Boolean(
      process.env.RAILWAY_ENVIRONMENT || 
      process.env.VERCEL || 
      process.env.NETLIFY ||
      process.env.RENDER ||
      process.env.HEROKU_APP_NAME
    );
  }
  return false; // 브라우저에서는 확인 불가능
};

// 로컬 개발 환경인지 확인
export const isLocalDevelopment = isServer && isDevelopment && !isCloudEnvironment();

/**
 * 스토리지 전략 타입 정의
 */
export type StorageStrategy = 'redis' | 'local' | 'hybrid';

/**
 * 최적의 스토리지 전략 결정
 * 환경 설정과 가용성에 따라 적절한 스토리지 전략을 반환
 */
export function getOptimalStorageStrategy(): StorageStrategy {
  // 강제 스토리지 전략이 설정된 경우 우선 사용
  const forcedStrategy = process.env.FORCE_STORAGE_STRATEGY as StorageStrategy;
  if (forcedStrategy && ['redis', 'local', 'hybrid'].includes(forcedStrategy)) {
    return forcedStrategy;
  }

  // 로컬 저장소 사용이 명시적으로 활성화된 경우
  if (process.env.USE_LOCAL_STORAGE === 'true') {
    return 'local';
  }

  // 클라우드 환경에서는 기본적으로 Redis 사용
  if (isCloudEnvironment()) {
    return process.env.ALLOW_HYBRID_STORAGE === 'true' ? 'hybrid' : 'redis';
  }

  // 로컬 개발 환경에서는 기본적으로 로컬 스토리지 사용
  if (isLocalDevelopment) {
    return 'local';
  }

  // 기본값 - 하이브리드 모드 (Redis 우선, 실패 시 로컬 스토리지 사용)
  return 'hybrid';
}

/**
 * 환경 설정 인터페이스
 */
export interface EnvironmentConfig {
  apiBaseUrl: string;
  mqttBrokerUrl: string;
  mqttUsername?: string;
  mqttPassword?: string;
  localStoragePath: string;
  maxUploadSize: number;
  debugMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  apiRetryConfig: ApiRetryConfig;
}

/**
 * API 재시도 설정 인터페이스
 */
export interface ApiRetryConfig {
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
}

/**
 * 기본 환경 설정 값
 */
const defaultConfig: EnvironmentConfig = {
  apiBaseUrl: '/api',
  mqttBrokerUrl: 'mqtt://localhost:1883',
  mqttUsername: 'dnature',
  mqttPassword: '8210',
  localStoragePath: './local-storage',
  maxUploadSize: 10 * 1024 * 1024, // 10MB
  debugMode: false,
  logLevel: 'info',
  apiRetryConfig: {
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true
  }
};

/**
 * 개발 환경 설정
 */
const developmentConfig: Partial<EnvironmentConfig> = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || '/api',
  mqttBrokerUrl: process.env.NEXT_PUBLIC_MQTT_DEV_SERVER || 'mqtt://203.234.35.54:1883',
  mqttUsername: process.env.MQTT_USERNAME || 'dnature',
  mqttPassword: process.env.MQTT_PASSWORD || '8210',
  debugMode: true,
  logLevel: 'debug',
  apiRetryConfig: {
    maxRetries: 2,
    retryDelay: 500,
    exponentialBackoff: false
  }
};

/**
 * 프로덕션 환경 설정
 */
const productionConfig: Partial<EnvironmentConfig> = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || '/api',
  mqttBrokerUrl: process.env.NEXT_PUBLIC_MQTT_PROD_SERVER || 'mqtt://203.234.35.54:',
  mqttUsername: process.env.MQTT_USERNAME || 'dnature',
  mqttPassword: process.env.MQTT_PASSWORD || '8210',
  debugMode: process.env.DEBUG_MODE === 'true',
  logLevel: 'warn',
  apiRetryConfig: {
    maxRetries: 5,
    retryDelay: 1000,
    exponentialBackoff: true
  }
};

/**
 * 테스트 환경 설정
 */
const testConfig: Partial<EnvironmentConfig> = {
  apiBaseUrl: '/api',
  mqttBrokerUrl: 'mqtt://203.234.35.54:1883',
  mqttUsername: 'dnature',
  mqttPassword: '8210',
  localStoragePath: './test-storage',
  debugMode: true,
  logLevel: 'debug',
  apiRetryConfig: {
    maxRetries: 1,
    retryDelay: 100,
    exponentialBackoff: false
  }
};

/**
 * 현재 환경에 대한 설정 가져오기
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  // 기본 설정으로 시작
  let config = { ...defaultConfig };

  // 환경에 맞는 설정 적용
  if (isDevelopment) {
    config = { ...config, ...developmentConfig };
  } else if (isProduction) {
    config = { ...config, ...productionConfig };
  } else if (isTest) {
    config = { ...config, ...testConfig };
  }

  // 환경 변수로 설정 덮어쓰기
  if (process.env.LOCAL_STORAGE_PATH) {
    config.localStoragePath = process.env.LOCAL_STORAGE_PATH;
  }

  if (process.env.DEBUG_MODE === 'true') {
    config.debugMode = true;
  } else if (process.env.DEBUG_MODE === 'false') {
    config.debugMode = false;
  }

  // 로그 레벨 설정
  if (process.env.LOG_LEVEL) {
    const logLevel = process.env.LOG_LEVEL.toLowerCase();
    if (['debug', 'info', 'warn', 'error'].includes(logLevel)) {
      config.logLevel = logLevel as any;
    }
  }

  return config;
}

/**
 * API 재시도 설정 가져오기
 */
export function getApiRetryConfig(): ApiRetryConfig {
  return getEnvironmentConfig().apiRetryConfig;
}

/**
 * 현재 애플리케이션의 URL 기반 경로 가져오기
 */
export function getBasePath(): string {
  if (isBrowser) {
    return window.location.pathname.split('/').slice(0, -1).join('/') || '/';
  }
  return '';
}

/**
 * 전체 API URL 생성
 */
export function getApiUrl(endpoint: string): string {
  const baseUrl = getEnvironmentConfig().apiBaseUrl;
  const formattedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${formattedEndpoint}`;
}

/**
 * 디버그 로그
 */
export function debugLog(...args: any[]): void {
  if (getEnvironmentConfig().debugMode) {
    console.log('[DEBUG]', ...args);
  }
} 