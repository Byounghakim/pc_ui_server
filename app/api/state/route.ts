import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis-client';

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

/**
 * 객체 깊은 병합 함수
 */
function deepMerge(target: any, source: any): any {
  const output = Object.assign({}, target);
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

/**
 * 객체 타입 확인 함수
 */
function isObject(item: any): boolean {
  return (item && typeof item === 'object' && !Array.isArray(item));
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

/**
 * 시스템 상태 조회 API
 * 펌프 및 밸브 상태를 조회합니다.
 * 클라이언트가 처음 로드될 때 초기 상태를 빠르게 가져오기 위한 용도입니다.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'state key가 필요합니다.' }, { status: 400 });
    }

    // Redis 클라이언트 가져오기
    const redis = await getRedisClient();
    if (!redis || !redis.isOpen) {
      return NextResponse.json({ error: 'Redis 연결 실패' }, { status: 500 });
    }

    const stateStr = await redis.get(key);
    
    if (!stateStr) {
      return NextResponse.json({ state: null });
    }
    
    // 'undefined' 문자열이거나 빈 문자열인 경우 처리
    if (stateStr === 'undefined' || stateStr.trim() === '') {
      console.warn(`유효하지 않은 상태 데이터 조회(${key}):`, stateStr);
      return NextResponse.json({ state: null });
    }
    
    try {
      const state = JSON.parse(stateStr);
      return NextResponse.json({ state });
    } catch (parseError) {
      console.error(`상태 데이터 파싱 오류(${key}):`, parseError, '원본 데이터:', stateStr);
    return NextResponse.json({
        error: '상태 데이터 파싱 오류', 
        details: parseError instanceof Error ? parseError.message : String(parseError) 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('상태 조회 중 오류 발생:', error);
    return NextResponse.json({
      error: `상태 조회 오류: ${error instanceof Error ? error.message : String(error)}` 
    }, { status: 500 });
  }
}

/**
 * 시스템 상태 변경 API
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, state } = body;

    if (!key) {
      return NextResponse.json({ error: 'state key가 필요합니다.' }, { status: 400 });
    }

    if (!state) {
      return NextResponse.json({ error: 'state 데이터가 필요합니다.' }, { status: 400 });
    }

    // Redis 클라이언트 가져오기
    const redis = await getRedisClient();
    if (!redis || !redis.isOpen) {
      return NextResponse.json({ error: 'Redis 연결 실패' }, { status: 500 });
    }

    // 기존 상태와 병합
    try {
      const existingStateStr = await redis.get(key);
      let existingState = {};

      if (existingStateStr) {
        // 'undefined' 문자열이거나 빈 문자열인 경우 처리
        if (existingStateStr === 'undefined' || existingStateStr.trim() === '') {
          console.warn(`유효하지 않은 상태 데이터(${key}):`, existingStateStr);
        } else {
          try {
            existingState = JSON.parse(existingStateStr);
            if (typeof existingState !== 'object' || existingState === null) {
              console.warn(`파싱된 상태가 객체가 아님(${key}):`, existingState);
              existingState = {};
            }
          } catch (parseError) {
            console.error(`기존 상태 파싱 오류(${key}):`, parseError, '원본 데이터:', existingStateStr);
          }
        }
      }

      // 새 상태와 깊은 병합
      const mergedState = deepMerge(existingState, state);
      
      // 상태 저장
      await redis.set(key, JSON.stringify(mergedState));
    
    return NextResponse.json({
      success: true,
        message: 'State saved successfully' 
      });
    } catch (error) {
      console.error('상태 저장 중 오류 발생:', error);
      return NextResponse.json({ 
        error: `상태 저장 중 오류: ${error instanceof Error ? error.message : String(error)}` 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('요청 처리 중 오류 발생:', error);
    return NextResponse.json({
      error: `요청 처리 오류: ${error instanceof Error ? error.message : String(error)}` 
    }, { status: 500 });
  }
}

// OPTIONS 메서드 추가 (CORS preflight 요청 처리)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
} 