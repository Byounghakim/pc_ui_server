import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis-client';
import localStateManager from '@/lib/local-state-manager';

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

// 로컬 스토리지 모드 확인
const isLocalStorageMode = process.env.USE_LOCAL_STORAGE === 'true';

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
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: '상태 키가 필요합니다.' }, { status: 400 });
    }

    // 로컬 스토리지 모드인 경우
    if (isLocalStorageMode) {
      console.log(`로컬 스토리지에서 상태 조회: ${key}`);
      try {
        const state = await localStateManager.getState(key);
        
        // 상태가 없으면 기본 상태 반환
        if (state === null || state === undefined) {
          const defaultState = getDefaultState();
          await localStateManager.setState(key, defaultState);
          return NextResponse.json({ state: defaultState });
        }
        
        return NextResponse.json({ state });
      } catch (error) {
        console.error('로컬 스토리지 상태 조회 오류:', error);
        return NextResponse.json({ 
          error: `로컬 스토리지 상태 조회 오류: ${error instanceof Error ? error.message : String(error)}` 
        }, { status: 500 });
      }
    } 
    // Redis 모드
    else {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      if (!redis || !redis.isOpen) {
        return NextResponse.json({ error: 'Redis 연결 실패' }, { status: 500 });
      }

      try {
        const stateStr = await redis.get(key);
        
        if (!stateStr || stateStr === 'undefined' || stateStr.trim() === '') {
          const defaultState = getDefaultState();
          await redis.set(key, JSON.stringify(defaultState));
          return NextResponse.json({ state: defaultState });
        }
        
        try {
          const state = JSON.parse(stateStr);
          return NextResponse.json({ state });
        } catch (parseError) {
          console.error(`상태 데이터 파싱 오류(${key}):`, parseError, '원본 데이터:', stateStr);
          // 파싱 오류 시 기본 상태 반환
          const defaultState = getDefaultState();
          await redis.set(key, JSON.stringify(defaultState));
          return NextResponse.json({ state: defaultState });
        }
      } catch (error) {
        console.error('Redis 상태 조회 오류:', error);
        return NextResponse.json({
          error: `Redis 상태 조회 오류: ${error instanceof Error ? error.message : String(error)}` 
        }, { status: 500 });
      }
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
    console.log('[DEBUG] POST 요청 처리 시작');
    let body;
    try {
      const rawText = await req.text();
      console.log('[DEBUG] 원본 요청 본문:', rawText);
      
      if (!rawText || rawText.trim() === '') {
        console.error('[DEBUG] 요청 본문이 비어 있습니다.');
        return NextResponse.json({ error: '요청 본문이 비어 있습니다.' }, { status: 400 });
      }
      
      try {
        body = JSON.parse(rawText);
        console.log('[DEBUG] 파싱된 요청 본문:', JSON.stringify(body));
      } catch (parseError) {
        console.error('[DEBUG] JSON 파싱 오류:', parseError);
        return NextResponse.json({ 
          error: '잘못된 JSON 형식', 
          details: parseError instanceof Error ? parseError.message : String(parseError) 
        }, { status: 400 });
      }
    } catch (reqError) {
      console.error('[DEBUG] 요청 처리 오류:', reqError);
      return NextResponse.json({ 
        error: '요청 처리 오류', 
        details: reqError instanceof Error ? reqError.message : String(reqError) 
      }, { status: 400 });
    }
    
    // key와 state 속성 확인
    console.log('[DEBUG] key 속성 확인:', body.key);
    
    // key 속성이 없는 경우 body 자체를 state로 취급하고 기본 키 사용
    let key = body.key;
    let state = body.state;

    // key 속성이 없는 경우 (클라이언트에서 직접 state 데이터만 전송하는 경우)
    if (!key) {
      console.log('[DEBUG] key 속성이 없어 기본값 사용: system:state');
      key = 'system:state';
      state = body; // 전체 body를 state로 사용
    }

    if (!state) {
      console.error('[DEBUG] state 데이터가 없습니다.');
      return NextResponse.json({ error: '상태 데이터가 필요합니다.' }, { status: 400 });
    }

    console.log('[DEBUG] 처리할 상태 데이터:', JSON.stringify(state).substring(0, 200) + '...');

    // 로컬 스토리지 모드인 경우
    if (isLocalStorageMode) {
      console.log(`[DEBUG] 로컬 스토리지 모드로 상태 저장: ${key}`);
      
      try {
        // 기존 상태 조회
        const existingState = await localStateManager.getState(key) || {};
        
        // 새 상태와 깊은 병합
        const mergedState = deepMerge(existingState, state);
        
        // 타임스탬프 추가
        mergedState.timestamp = Date.now();
        
        // 로컬 스토리지에 저장
        await localStateManager.setState(key, mergedState);
        
        console.log('[DEBUG] 상태가 로컬 스토리지에 저장되었습니다.');
        return NextResponse.json({
          success: true,
          message: '상태가 로컬 스토리지에 저장되었습니다.' 
        });
      } catch (error) {
        console.error('[DEBUG] 로컬 스토리지 저장 오류:', error);
        return NextResponse.json({ 
          error: `로컬 스토리지 상태 저장 오류: ${error instanceof Error ? error.message : String(error)}` 
        }, { status: 500 });
      }
    } 
    // Redis 모드
    else {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      if (!redis || !redis.isOpen) {
        return NextResponse.json({ error: 'Redis 연결 실패' }, { status: 500 });
      }

      try {
        // 기존 상태 조회
        const existingStateStr = await redis.get(key);
        let existingState = {};

        if (existingStateStr && existingStateStr !== 'undefined' && existingStateStr.trim() !== '') {
          try {
            existingState = JSON.parse(existingStateStr);
            if (typeof existingState !== 'object' || existingState === null) {
              existingState = {};
            }
          } catch (parseError) {
            console.error(`기존 상태 파싱 오류(${key}):`, parseError);
            existingState = {};
          }
        }

        // 새 상태와 깊은 병합
        const mergedState = deepMerge(existingState, state);
        
        // 타임스탬프 추가
        mergedState.timestamp = Date.now();
        
        // 상태 저장
        await redis.set(key, JSON.stringify(mergedState));
      
        return NextResponse.json({
          success: true,
          message: '상태가 Redis에 저장되었습니다.' 
        });
      } catch (error) {
        console.error('Redis 상태 저장 오류:', error);
        return NextResponse.json({ 
          error: `Redis 상태 저장 오류: ${error instanceof Error ? error.message : String(error)}` 
        }, { status: 500 });
      }
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