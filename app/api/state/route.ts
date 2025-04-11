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
    console.log('시스템 상태 조회 시작');
    
    // 캐시 확인
    const now = Date.now();
    if (cachedState && (now - cacheTimestamp) < CACHE_TTL_MS) {
      console.log('캐시된 상태 반환');
      return NextResponse.json({
        ...cachedState,
        fromCache: true
      });
    }
    
    const redis = await getRedisClient();
    console.log('Redis 클라이언트 가져옴');
    
    // Redis에서 상태 가져오기
    const data = await redis.get(STATE_KEY);
    console.log('Redis 데이터 조회 완료:', data ? '데이터 있음' : '데이터 없음');
    
    // 연결 종료
    await redis.quit();
    
    let stateData: SystemState = getDefaultState();
    
    if (data) {
      try {
        const parsedData = JSON.parse(data);
        
        // 데이터 병합
        stateData = {
          ...stateData,
          ...parsedData,
          timestamp: now
        };
        
        // 펌프 상태가 문자열 형식(ON/OFF)인지 확인
        if (stateData.pumps) {
          Object.keys(stateData.pumps).forEach(pumpKey => {
            const status = stateData.pumps[pumpKey];
            stateData.pumps[pumpKey] = PUMP_STATUS[status] || status;
          });
        }
      } catch (e) {
        console.error('데이터 파싱 오류:', e);
      }
    }
    
    // 캐시 업데이트
    cachedState = { ...stateData };
    cacheTimestamp = now;
    
    return NextResponse.json({
      success: true,
      ...stateData,
      timestamp: now
    });
  } catch (error) {
    console.error('시스템 상태 조회 실패 상세:', error);
    
    // 기본 상태 반환
    const defaultState = getDefaultState();
    
    return NextResponse.json({
      success: false,
      error: '시스템 상태 조회 실패',
      details: error instanceof Error ? error.message : String(error),
      ...defaultState
    }, { status: 500 });
  }
}

/**
 * 시스템 상태 변경 API
 */
export async function POST(req: NextRequest) {
  try {
    console.log('시스템 상태 저장 시작');
    const redis = await getRedisClient();
    console.log('Redis 클라이언트 가져옴');
    
    // 요청 데이터 파싱
    const data = await req.json();
    console.log('받은 데이터:', JSON.stringify(data).substring(0, 200) + '...');
    
    // 데이터 유효성 검증
    if (!data) {
      console.log('유효하지 않은 데이터');
      return NextResponse.json({
        success: false,
        error: '유효하지 않은 상태 데이터입니다.'
      }, { status: 400 });
    }
    
    // Redis 연결 확인
    console.log('Redis 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
    
    // Redis에 상태 저장
    console.log('Redis에 저장 시작');
    
    // 펌프 또는 밸브 상태만 업데이트하는 경우 기존 데이터와 병합
    const existingData = await redis.get(STATE_KEY);
    let mergedData: SystemState = getDefaultState();
    
    if (existingData) {
      try {
        mergedData = JSON.parse(existingData);
      } catch (e) {
        console.error('기존 데이터 파싱 오류:', e);
      }
    }
    
    // 새 데이터 병합
    if (data.pump !== undefined && data.pumpId) {
      // 단일 펌프 상태 업데이트
      if (!mergedData.pumps) {
        mergedData.pumps = {};
      }
      // 0/1 또는 ON/OFF 형식 지원
      let pumpStatus = data.pump;
      if (pumpStatus === 0 || pumpStatus === '0') pumpStatus = 'OFF';
      if (pumpStatus === 1 || pumpStatus === '1') pumpStatus = 'ON';
      
      mergedData.pumps[`pump${data.pumpId}`] = pumpStatus;
      // 캐시 무효화
      cachedState = null;
    } else if (data.valve) {
      // 밸브 상태 업데이트
      mergedData.valve = {
        state: data.valve,
        description: data.description || { valveA: "알 수 없음", valveB: "알 수 없음" }
      };
      // 캐시 무효화
      cachedState = null;
    } else if (data.tankSystem) {
      // 탱크 시스템 상태 업데이트
      mergedData.tankSystem = data.tankSystem;
      // 캐시 무효화
      cachedState = null;
    } else {
      // 전체 상태 업데이트
      mergedData = { ...mergedData, ...data, timestamp: Date.now() };
      // 캐시 무효화
      cachedState = null;
    }
    
    await redis.set(STATE_KEY, JSON.stringify(mergedData));
    console.log('Redis에 저장 완료');
    
    // 연결 종료
    await redis.quit();
    
    return NextResponse.json({
      success: true,
      message: '시스템 상태가 성공적으로 저장되었습니다.',
      ...mergedData
    });
  } catch (error) {
    console.error('시스템 상태 저장 실패 상세:', error);
    return NextResponse.json({
      success: false,
      error: '시스템 상태 저장 실패',
      details: error instanceof Error ? error.message : String(error)
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