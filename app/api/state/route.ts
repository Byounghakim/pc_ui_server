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

// 내부 백엔드 API URL (동일 서버의 다른 포트)
const BACKEND_API_URL = 'http://localhost:3003/api/state';

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
export async function GET(request: NextRequest) {
  try {
    // 백엔드 API로 요청 전달
    const response = await fetch(BACKEND_API_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store', // 캐싱 방지
    });

    // 응답 데이터
    const data = await response.json();
    
    // NextResponse로 응답 반환
    return NextResponse.json(data);
  } catch (error) {
    console.error('상태 조회 중 오류:', error);
    return NextResponse.json({ error: '상태 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/**
 * 시스템 상태 변경 API
 */
export async function POST(request: NextRequest) {
  try {
    // 요청 본문 가져오기
    const body = await request.json();
    
    // 백엔드 API로 요청 전달
    const response = await fetch(BACKEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // 응답 데이터
    const data = await response.json();
    
    // 응답 상태 코드 가져오기
    const status = response.status;
    
    // NextResponse로 응답 반환
    return NextResponse.json(data, { status });
  } catch (error) {
    console.error('상태 저장 중 오류:', error);
    return NextResponse.json({ error: '상태 저장 중 오류가 발생했습니다.' }, { status: 500 });
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