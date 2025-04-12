/**
 * Redis 클라이언트 구현
 * 
 * 이 파일은 장치 상태 관리를 위한 Redis 클라이언트를 구현합니다.
 * Redis Cloud 서비스를 사용하며, 상태 관리와 지속성 데이터를 처리합니다.
 */

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

// 클라이언트 싱글톤 인스턴스
let redisClient: RedisClientType | null = null;
let isConnecting = false;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Redis 클라이언트를 가져오는 함수
 * 싱글톤 패턴으로 구현되어 애플리케이션에서 하나의 연결만 사용
 */
export async function getRedisClient(): Promise<RedisClientType> {
  try {
    // 이미 연결 시도 중이면 대기
    if (isConnecting) {
      console.log('Redis 연결 시도 중... 잠시 대기');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return getRedisClient();
    }
    
    // 이미 연결된 클라이언트가 있으면 반환
    if (redisClient && redisClient.isOpen) {
      console.log('기존 Redis 연결 사용');
      return redisClient;
    }
    
    // 연결이 닫혔거나 없는 경우 재연결
    if (redisClient && !redisClient.isOpen) {
      console.log('Redis 연결이 닫혔습니다. 재연결 시도...');
      await redisClient.connect();
      console.log('Redis 재연결 성공');
      return redisClient;
    }
    
    // 재시도 횟수 초과 시 로컬 스토리지 모드로 전환
    if (connectionAttempts >= MAX_RETRY_ATTEMPTS) {
      console.warn(`Redis 연결 시도 ${MAX_RETRY_ATTEMPTS}회 초과. 로컬 스토리지 모드 반환`);
      return createLocalStorageClient();
    }
    
    // 새 클라이언트 생성
    isConnecting = true;
    connectionAttempts++;
    
    console.log(`Redis 연결 시도 (${connectionAttempts}/${MAX_RETRY_ATTEMPTS})...`);
    
    const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI || 'redis://localhost:6379';
    console.log('Redis URL:', REDIS_URL.replace(/:\/\/.*@/, '://****@')); // URL에서 비밀번호 가리기
    
    // 새 Redis 클라이언트 생성
    redisClient = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.error('Redis 최대 재연결 시도 횟수 초과');
            return new Error('Redis 연결 실패');
          }
          const delay = Math.min(retries * 100, 1000);
          console.log(`Redis 재연결 ${retries}회 시도, ${delay}ms 후 재시도`);
          return delay;
        },
        connectTimeout: 5000, // 연결 타임아웃: 5초
      }
    });
    
    // 이벤트 리스너 등록
    redisClient.on('error', (err) => {
      console.error('Redis 클라이언트 오류:', err);
    });
    
    redisClient.on('connect', () => {
      console.log('Redis 서버에 연결됨');
    });
    
    redisClient.on('reconnecting', () => {
      console.log('Redis 서버에 재연결 중...');
    });
    
    redisClient.on('ready', () => {
      console.log('Redis 클라이언트 준비됨');
    });
    
    // 연결 시도
    await redisClient.connect();
    console.log('Redis 연결 성공');
    
    isConnecting = false;
    connectionAttempts = 0;
    
    return redisClient;
  } catch (error) {
    console.error('Redis 연결 오류:', error);
    isConnecting = false;
    
    // 재시도 횟수 초과 시 로컬 스토리지 모드로 전환
    if (connectionAttempts >= MAX_RETRY_ATTEMPTS) {
      console.warn(`Redis 연결 실패 후 로컬 스토리지 모드로 전환`);
      return createLocalStorageClient();
    }
    
    throw error;
  }
}

/**
 * 로컬 스토리지 대체 클라이언트 
 * Redis 연결 실패 시 대체 구현으로 사용
 */
function createLocalStorageClient(): RedisClientType {
  console.log('로컬 스토리지 클라이언트 생성 (Redis 대체)');
  
  const storageMap = new Map<string, string>();
  
  // 로컬 스토리지에서 이전 상태 로드
  const loadFromLocalStorage = () => {
    if (typeof window !== 'undefined') {
      try {
        const savedState = localStorage.getItem('redisClientState');
        if (savedState) {
          const parsed = JSON.parse(savedState);
          Object.entries(parsed).forEach(([key, value]) => {
            storageMap.set(key, value as string);
          });
          console.log('로컬 스토리지에서 이전 상태 로드됨');
        }
      } catch (error) {
        console.error('로컬 스토리지 로드 오류:', error);
      }
    }
  };
  
  // 로컬 스토리지에 현재 상태 저장
  const saveToLocalStorage = () => {
    if (typeof window !== 'undefined') {
      try {
        const state: Record<string, string> = {};
        storageMap.forEach((value, key) => {
          state[key] = value;
        });
        localStorage.setItem('redisClientState', JSON.stringify(state));
      } catch (error) {
        console.error('로컬 스토리지 저장 오류:', error);
      }
    }
  };
  
  // 초기 상태 로드
  loadFromLocalStorage();
  
  // 자동 저장을 위한 타이머 설정
  if (typeof window !== 'undefined') {
    // 페이지 언로드 시 저장
    window.addEventListener('beforeunload', saveToLocalStorage);
    
    // 30초마다 자동 저장
    setInterval(saveToLocalStorage, 30000);
  }
  
  // Redis 클라이언트와 유사한 인터페이스를 가진 객체 반환
  const localClient = {
    isOpen: true,
    isReady: true,
    
    connect: async () => Promise.resolve(),
    disconnect: async () => Promise.resolve(),
    quit: async () => {
      saveToLocalStorage();
      return Promise.resolve();
    },
    
    get: async (key: string) => {
      console.log(`[LocalStorage] GET ${key}`);
      const value = storageMap.get(key);
      if (value === undefined) {
        console.log(`[LocalStorage] 키 ${key}에 대한 값이 없습니다.`);
        return null; // undefined 대신 null 반환
      }
      return value;
    },
    
    set: async (key: string, value: string) => {
      console.log(`[LocalStorage] SET ${key}`);
      storageMap.set(key, value);
      
      // 특정 키에 대해 즉시 로컬 스토리지에 저장
      if (key === 'system:state' || key.includes('pump') || key.includes('valve')) {
        saveToLocalStorage();
      }
      
      return 'OK';
    },
    
    del: async (key: string) => {
      console.log(`[LocalStorage] DEL ${key}`);
      const result = storageMap.delete(key) ? 1 : 0;
      
      // 키가 삭제되었으면 로컬 스토리지 업데이트
      if (result > 0) {
        saveToLocalStorage();
      }
      
      return result;
    },
    
    // 기타 메서드들은 기본 구현으로 대체
    on: () => localClient,
    off: () => localClient,
  } as unknown as RedisClientType;
  
  return localClient;
}

/**
 * Redis 연결 상태 확인 함수
 */
export async function checkRedisConnection(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    return client.isOpen;
  } catch (error) {
    console.error('Redis 연결 상태 확인 실패:', error);
    return false;
  }
}

/**
 * Redis 연결 종료 함수
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    console.log('Redis 연결 종료됨');
  }
}

// 기본 내보내기
export default {
  getRedisClient,
  checkRedisConnection,
  closeRedisConnection,
  listAutomationProcesses: async () => {
    try {
      const client = await getRedisClient();
      // 자동화 공정 목록 키
      const key = 'automation:processes';
      const data = await client.get(key);
      
      if (!data) return [];
      
      try {
        const parsed = JSON.parse(data);
        // Redis에 저장된 형식이 {"processes": [...]} 형태이므로
        return parsed.processes || [];
      } catch (parseError) {
        console.error('자동화 공정 데이터 파싱 오류:', parseError);
        return [];
      }
    } catch (error) {
      console.error('자동화 공정 목록 조회 오류:', error);
      return [];
    }
  },
}; 