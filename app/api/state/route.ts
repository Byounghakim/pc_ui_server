import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createClient } from 'redis';
import { env, shouldUseLocalStorage, logger, LogLevel, createLogGroup } from '../../config/environment';

// 시스템 상태 인터페이스
interface SystemState {
  valve?: {
    state: string;
    description: { valveA: string; valveB: string };
  };
  pumps?: {
    [key: string]: string;
  };
  timestamp?: number;
  [key: string]: any;
}

// 펌프 상태 맵핑
const PUMP_STATUS = {
  '0': 'OFF',
  '1': 'ON',
  'ON': 'ON',
  'OFF': 'OFF'
};

// Redis에 저장할 키 이름
const STATE_KEY = 'system:state';

// 캐싱을 위한 상태 및 타임스탬프
let cachedState: any = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 300000; // 5분 캐싱

// CORS 헤더 설정
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

/**
 * 객체 깊은 병합 (Deep Merge) 함수
 * 두 객체를 병합하여 새 객체 반환
 */
function deepMerge(target: any, source: any) {
  // 기본 경우: target이나 source가 객체가 아닌 경우
  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  // 두 객체를 병합
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
      if (!target[key]) Object.assign(target, { [key]: {} });
      deepMerge(target[key], source[key]);
        } else {
      Object.assign(target, { [key]: source[key] });
      }
    });
  
  return target;
}

/**
 * 값이 객체인지 확인하는 함수
 */
function isObject(item: any) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * API 요청 재시도 래퍼 함수
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const config = getApiRetryConfig();
  let lastError: any;
  
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`API 요청 실패 (시도 ${attempt}/${config.maxRetries}):`, error);
      
      if (attempt < config.maxRetries) {
        // 지수 백오프 - 재시도마다 대기 시간 증가
        const delay = config.exponentialBackoff 
          ? config.retryDelay * Math.pow(2, attempt - 1)
          : config.retryDelay;
          
        console.log(`${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * 기본 시스템 상태 생성
 */
function getDefaultState(): SystemState {
  return {
    valve: {
      state: "0000",
      description: { valveA: "닫힘", valveB: "닫힘" }
    },
    pumps: {
      pump1: "OFF", 
      pump2: "OFF", 
      pump3: "OFF",
      pump4: "OFF", 
      pump5: "OFF", 
      pump6: "OFF"
    },
    tankSystem: {
      tanks: {
        tank1: { level: 0, volume: 0 },
        tank2: { level: 0, volume: 0 },
        tank3: { level: 0, volume: 0 }
      }
    },
    timestamp: Date.now()
  };
}

// Redis 클라이언트 설정
const redisClient = shouldUseLocalStorage ? null : createClient({
  url: env.redisUrl || `redis://${env.redisHost}:${env.redisPort}`,
  password: env.redisPassword,
});

// Redis 연결 준비
async function connectRedis() {
  if (shouldUseLocalStorage) {
    logger.info('로컬 스토리지 모드 사용 중: Redis 연결 생략됨');
    return null;
  }

  try {
    if (!redisClient?.isOpen) {
      await redisClient?.connect();
      logger.info('Redis 연결 성공');
    }
    return redisClient;
  } catch (error) {
    logger.error('Redis 연결 실패:', error);
    return null;
  }
}

// 로컬 스토리지 관련 함수
const LOCAL_STORAGE_PATH = env.localStoragePath || 'local-redis-state.json';

// 로컬 스토리지에서 데이터 불러오기
function getLocalRedisData() {
  const logGroup = createLogGroup('getLocalRedisData');
  
  try {
    if (!fs.existsSync(LOCAL_STORAGE_PATH)) {
      logger.debug(`로컬 스토리지 파일 없음: ${LOCAL_STORAGE_PATH}`);
      return {};
    }
    
    const data = fs.readFileSync(LOCAL_STORAGE_PATH, 'utf8');
    const parsedData = JSON.parse(data);
    logger.debug(`로컬 스토리지에서 데이터 로드 성공: ${Object.keys(parsedData).length} 항목`);
    logGroup.end();
    return parsedData;
  } catch (error) {
    logger.error('로컬 스토리지에서 데이터 로드 실패:', error);
    logGroup.end();
    return {};
  }
}

// 로컬 스토리지에 데이터 저장하기
function saveLocalRedisData(data: any) {
  const logGroup = createLogGroup('saveLocalRedisData');
  
  try {
    const currentData = getLocalRedisData();
    const newData = { ...currentData, ...data };
    
    // 디렉토리 생성 (없는 경우)
    const directory = path.dirname(LOCAL_STORAGE_PATH);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    
    fs.writeFileSync(LOCAL_STORAGE_PATH, JSON.stringify(newData, null, 2), 'utf8');
    logger.debug(`로컬 스토리지에 데이터 저장 성공: ${Object.keys(data).length} 항목`);
    logGroup.end();
    return true;
  } catch (error) {
    logger.error('로컬 스토리지에 데이터 저장 실패:', error);
    logGroup.end();
    return false;
  }
}

// GET 요청 처리
export async function GET(request: NextRequest) {
  const logGroup = createLogGroup('GET /api/state');
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  
  logger.info(`상태 요청: ${key || '전체'}`);
  
  try {
    // Redis 연결
    const client = await connectRedis();
    
    if (client) {
      // 특정 키 요청인 경우
      if (key) {
        const value = await client.get(key);
        
        if (value) {
          logger.debug(`키 '${key}'에 대한 값 찾음`);
          logGroup.end();
          try {
            return NextResponse.json(JSON.parse(value));
          } catch {
            return NextResponse.json(value);
          }
        }
        
        logger.debug(`키 '${key}'에 대한 값 없음`);
        logGroup.end();
        return NextResponse.json({ error: `키 '${key}'에 대한 값을 찾을 수 없음` }, { status: 404 });
      }
      
      // 모든 키 요청인 경우
      const keys = await client.keys('*');
      const result: Record<string, any> = {};
      
      for (const k of keys) {
        const value = await client.get(k);
        if (value) {
          try {
            result[k] = JSON.parse(value);
          } catch {
            result[k] = value;
          }
        }
      }
      
      logger.debug(`${Object.keys(result).length}개 키 값 로드 성공`);
      logGroup.end();
      return NextResponse.json(result);
    }
    
    // 로컬 스토리지 사용
    if (shouldUseLocalStorage) {
      const localData = getLocalRedisData();
      
      // 특정 키 요청인 경우
      if (key) {
        if (key in localData) {
          logger.debug(`로컬 스토리지에서 키 '${key}'에 대한 값 찾음`);
          logGroup.end();
          return NextResponse.json(localData[key]);
        }
        
        logger.debug(`로컬 스토리지에서 키 '${key}'에 대한 값 없음`);
        logGroup.end();
        return NextResponse.json({ error: `키 '${key}'에 대한 값을 찾을 수 없음` }, { status: 404 });
      }
      
      // 모든 키 요청인 경우
      logger.debug(`로컬 스토리지에서 ${Object.keys(localData).length}개 키 값 로드 성공`);
      logGroup.end();
      return NextResponse.json(localData);
    }
    
    // 저장소에 연결할 수 없는 경우
    logger.error('사용 가능한 저장소 없음');
    logGroup.end();
    return NextResponse.json({ error: '저장소에 연결할 수 없음' }, { status: 500 });
  } catch (error) {
    logger.error('상태 조회 중 오류 발생:', error);
    logGroup.end();
    return NextResponse.json({ error: '상태 조회 중 오류 발생' }, { status: 500 });
  }
}

// POST 요청 처리
export async function POST(request: NextRequest) {
  const logGroup = createLogGroup('POST /api/state');
  
  try {
    let body;
    let rawText;
    
    try {
      // 원시 텍스트로 요청 본문 저장
      rawText = await request.text();
      logger.debug(`요청 본문 길이: ${rawText.length} 바이트`);
      
      // 요청 본문이 비어 있는 경우
      if (!rawText || rawText.trim() === '') {
        logger.warn('요청 본문이 비어 있음');
        logGroup.end();
        return NextResponse.json({ error: '요청 본문이 비어 있음' }, { status: 400 });
      }
      
      // JSON 파싱 시도
      body = JSON.parse(rawText);
      logger.debug(`요청 본문 타입: ${typeof body}, ${Array.isArray(body) ? '배열' : '객체'}`);
    } catch (error) {
      logger.error('요청 본문 파싱 실패:', error);
      logGroup.end();
      return NextResponse.json({ error: '유효하지 않은 JSON 데이터' }, { status: 400 });
    }
    
    // 키 파라미터 확인
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    
    // 키가 제공된 경우
    if (key) {
      logger.info(`상태 저장: 키 '${key}'에 값 저장 중`);
      
      // Redis 연결
      const client = await connectRedis();
      
      if (client) {
    // Redis에 상태 저장
        const value = typeof body === 'string' ? body : JSON.stringify(body);
        await client.set(key, value);
        
        logger.info(`상태가 키 '${key}'에 성공적으로 저장됨`);
        logGroup.end();
        return NextResponse.json({ message: `상태가 키 '${key}'에 성공적으로 저장됨` });
      }
      
      // 로컬 스토리지에 저장
      if (shouldUseLocalStorage) {
        const data = { [key]: body };
        const success = saveLocalRedisData(data);
        
        if (success) {
          logger.info(`상태가 키 '${key}'에 로컬 스토리지에 성공적으로 저장됨`);
          logGroup.end();
          return NextResponse.json({ message: `상태가 키 '${key}'에 로컬 스토리지에 성공적으로 저장됨` });
        } else {
          logger.error(`키 '${key}'에 대한 상태 저장 실패`);
          logGroup.end();
          return NextResponse.json({ error: '상태 저장 실패' }, { status: 500 });
        }
      }
      
      logger.error('사용 가능한 저장소 없음');
      logGroup.end();
      return NextResponse.json({ error: '저장소에 연결할 수 없음' }, { status: 500 });
    } 
    // 키가 제공되지 않은 경우, 본문 자체를 상태로 처리
    else if (typeof body === 'object' && !Array.isArray(body)) {
      logger.info(`전체 상태 저장: ${Object.keys(body).length}개 키`);
      
      // Redis 연결
      const client = await connectRedis();
      
      if (client) {
        // 각 키/값 쌍을 Redis에 저장
        for (const [k, v] of Object.entries(body)) {
          const value = typeof v === 'string' ? v : JSON.stringify(v);
          await client.set(k, value);
        }
        
        logger.info(`${Object.keys(body).length}개 키에 대한 상태가 성공적으로 저장됨`);
        logGroup.end();
        return NextResponse.json({ message: `${Object.keys(body).length}개 키에 대한 상태가 성공적으로 저장됨` });
      }
      
      // 로컬 스토리지에 저장
      if (shouldUseLocalStorage) {
        const success = saveLocalRedisData(body);
        
        if (success) {
          logger.info(`${Object.keys(body).length}개 키에 대한 상태가 로컬 스토리지에 성공적으로 저장됨`);
          logGroup.end();
          return NextResponse.json({ message: `${Object.keys(body).length}개 키에 대한 상태가 로컬 스토리지에 성공적으로 저장됨` });
    } else {
          logger.error('상태 저장 실패');
          logGroup.end();
          return NextResponse.json({ error: '상태 저장 실패' }, { status: 500 });
        }
      }
      
      logger.error('사용 가능한 저장소 없음');
      logGroup.end();
      return NextResponse.json({ error: '저장소에 연결할 수 없음' }, { status: 500 });
    }
    
    // 키도 없고 객체도 아닌 경우
    logger.warn('유효하지 않은 요청 형식: 키 파라미터가 없고 요청 본문이 객체가 아님');
    logGroup.end();
    return NextResponse.json({ error: '유효하지 않은 요청 형식' }, { status: 400 });
    
  } catch (error) {
    logger.error('상태 저장 중 오류 발생:', error);
    logGroup.end();
    return NextResponse.json({ error: '상태 저장 중 오류 발생' }, { status: 500 });
  }
}

// OPTIONS 메서드 추가 (CORS preflight 요청 처리)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders
  });
} 