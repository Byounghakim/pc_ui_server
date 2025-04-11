import { NextRequest, NextResponse } from 'next/server';
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
  tanks?: { id: number; level: number; volume: number; status: string; pumpStatus: string; inverter: number }[];
  tankSystem?: {
    tanks: {
      tank1: { level: number; volume: number };
      tank2: { level: number; volume: number };
      tank3: { level: number; volume: number };
    };
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

// 상태 저장에 사용할 키 이름
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
    tanks: [
      { id: 1, level: 0, volume: 0, status: "empty", pumpStatus: "OFF", inverter: 1 },
      { id: 2, level: 0, volume: 0, status: "empty", pumpStatus: "OFF", inverter: 2 },
      { id: 3, level: 0, volume: 0, status: "empty", pumpStatus: "OFF", inverter: 3 },
      { id: 4, level: 0, volume: 0, status: "empty", pumpStatus: "OFF", inverter: 4 },
      { id: 5, level: 0, volume: 0, status: "empty", pumpStatus: "OFF", inverter: 5 },
      { id: 6, level: 0, volume: 0, status: "empty", pumpStatus: "OFF", inverter: 6 }
    ],
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
    
    // 로컬 상태 관리자에서 상태 가져오기
    console.log('로컬 상태 관리자에서 시스템 상태 조회');
    
    // 기본 상태 생성 및 상태 합치기
    let stateData: SystemState = getDefaultState();
    
    try {
      // 밸브 상태 가져오기
      const valveState = await localStateManager.getValveState();
      if (valveState) {
        // valveState가 문자열이면 객체로 변환
        if (typeof valveState === 'string') {
          stateData.valve = {
            state: valveState,
            description: { valveA: "알 수 없음", valveB: "알 수 없음" } // 기본 설명
          };
          
          // 밸브 상태 코드에 따른 설명 생성
          if (valveState === '0000') {
            stateData.valve.description = { valveA: "본탱크 수집", valveB: "닫힘" };
          } else if (valveState === '0100') {
            stateData.valve.description = { valveA: "전체 순환", valveB: "열림" };
          } else if (valveState === '1000') {
            stateData.valve.description = { valveA: "추출순환", valveB: "닫힘" };
          } else if (valveState === '1100') {
            stateData.valve.description = { valveA: "추출개방", valveB: "열림" };
          }
        } 
        // valveState가 객체인 경우 그대로 사용
        else if (typeof valveState === 'object' && valveState !== null) {
          stateData.valve = {
            state: valveState.state || '0000',
            description: valveState.description || { valveA: "알 수 없음", valveB: "알 수 없음" }
          };
        }
        
        console.log('밸브 상태 로드됨:', stateData.valve);
      }
      
      // 펌프 상태 가져오기
      const pumpStates = await localStateManager.getAllPumpStates();
      if (pumpStates && Object.keys(pumpStates).length > 0) {
        stateData.pumps = {};
        
        // 기존 펌프 상태 유지
        for (let i = 1; i <= 6; i++) {
          const pumpKey = `pump${i}`;
          const pumpState = pumpStates[i] || pumpStates[pumpKey];
          
          // 펌프 상태가 있을 경우 설정, 없으면 기본값 유지
          if (pumpState) {
            // 0/1 또는 ON/OFF 형식 지원
            let status = pumpState;
            if (status === 0 || status === '0') status = 'OFF';
            if (status === 1 || status === '1') status = 'ON';
            
            stateData.pumps[pumpKey] = status;
            
            // tanks 배열에도 펌프 상태 업데이트
            if (Array.isArray(stateData.tanks) && stateData.tanks.length >= i) {
              stateData.tanks[i-1].pumpStatus = status as "ON" | "OFF";
            }
          }
        }
      }
      
      // 기타 시스템 상태 가져오기
      const systemState = await localStateManager.getState(STATE_KEY);
      if (systemState) {
        // 탱크 정보 있으면 병합 (펌프 상태는 이미 설정됨)
        if (systemState.tanks && Array.isArray(systemState.tanks)) {
          // 탱크 정보 병합 (중요: 기존 펌프 상태 유지)
          stateData.tanks = systemState.tanks.map((tank: any, index: number) => {
            // 인덱스가 범위를 벗어나지 않도록 확인
            if (index < stateData.tanks.length) {
              // 기존 pumpStatus 유지하면서 다른 속성 병합
              const existingPumpStatus = stateData.tanks[index].pumpStatus;
              return {
                ...tank,
                pumpStatus: tank.pumpStatus || existingPumpStatus
              };
            }
            return tank;
          });
        }
        
        // 탱크 시스템 등 기타 상태 병합
        if (systemState.tankSystem) {
          stateData.tankSystem = systemState.tankSystem;
        }
        
        // 다른 상태 속성 병합
        Object.entries(systemState).forEach(([key, value]) => {
          if (key !== 'valve' && key !== 'pumps' && key !== 'timestamp' && key !== 'tanks') {
            stateData[key] = value;
          }
        });
      }
    } catch (e) {
      console.error('상태 조회 중 오류:', e);
    }
    
    // 탱크 배열과 펌프 상태 맵의 일관성 확인
    if (stateData.tanks && Array.isArray(stateData.tanks) && stateData.pumps) {
      stateData.tanks.forEach((tank, index) => {
        const pumpId = tank.id;
        const pumpKey = `pump${pumpId}`;
        
        // pumps에 있는 상태로 tanks 배열 업데이트
        if (stateData.pumps[pumpKey]) {
          stateData.tanks[index].pumpStatus = stateData.pumps[pumpKey] as "ON" | "OFF";
        }
        
        // 반대로 tanks 상태가 pumps에 없으면 추가
        if (tank.pumpStatus && !stateData.pumps[pumpKey]) {
          stateData.pumps[pumpKey] = tank.pumpStatus;
        }
      });
    }
    
    // 타임스탬프 설정
    stateData.timestamp = now;
    
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
    
    // 기존 상태 로드
    let currentState = await localStateManager.getState(STATE_KEY) || getDefaultState();
    
    // 펌프 또는 밸브 상태만 업데이트하는 경우
    if (data.pump !== undefined && data.pumpId) {
      // 단일 펌프 상태 업데이트
      if (!currentState.pumps) {
        currentState.pumps = {};
      }
      
      // 0/1 또는 ON/OFF 형식 지원
      let pumpStatus = data.pump;
      if (pumpStatus === 0 || pumpStatus === '0') pumpStatus = 'OFF';
      if (pumpStatus === 1 || pumpStatus === '1') pumpStatus = 'ON';
      
      const pumpId = Number(data.pumpId);
      currentState.pumps[`pump${pumpId}`] = pumpStatus;
      
      // tanks 배열에도 펌프 상태 업데이트
      if (!currentState.tanks) {
        currentState.tanks = [];
        for (let i = 1; i <= 6; i++) {
          currentState.tanks.push({
            id: i,
            level: 0,
            volume: 0,
            status: "empty",
            pumpStatus: "OFF",
            inverter: i
          });
        }
      }
      
      if (Array.isArray(currentState.tanks)) {
        const tankIndex = currentState.tanks.findIndex(t => t.id === pumpId);
        if (tankIndex >= 0) {
          currentState.tanks[tankIndex].pumpStatus = pumpStatus as "ON" | "OFF";
        } else if (pumpId <= 6) {
          // 해당 ID의 탱크가 없는 경우 추가
          currentState.tanks.push({
            id: pumpId,
            level: 0,
            volume: 0,
            status: "empty",
            pumpStatus: pumpStatus as "ON" | "OFF", 
            inverter: pumpId
          });
        }
      }
      
      // 펌프 상태 개별 저장 (세부 제어용)
      await localStateManager.savePumpState(data.pumpId, pumpStatus);
      
      // 캐시 무효화
      cachedState = null;
    } else if (data.valve !== undefined) {
      console.log('밸브 상태 업데이트:', data.valve);
      
      // 문자열 형식인 경우
      if (typeof data.valve === 'string') {
        await localStateManager.saveValveState(data.valve);
      } 
      // 객체 형식인 경우
      else if (typeof data.valve === 'object' && data.valve !== null) {
        const { state, description } = data.valve;
        await localStateManager.saveValveState({
          state: state || '0000',
          description: description || { valveA: "", valveB: "" }
        });
      }
      
      // 캐시 무효화
      cacheTimestamp = 0;
      
      return NextResponse.json({
        success: true,
        message: '밸브 상태가 업데이트되었습니다.'
      });
    } else if (data.tankSystem) {
      // 탱크 시스템 상태 업데이트
      currentState.tankSystem = data.tankSystem;
      
      // 캐시 무효화
      cachedState = null;
    } else if (data.tanks && Array.isArray(data.tanks)) {
      // 탱크 정보 배열 업데이트 (펌프 상태도 함께 업데이트)
      currentState.tanks = data.tanks;
      
      // pumps 객체도 함께 업데이트
      if (!currentState.pumps) {
        currentState.pumps = {};
      }
      
      data.tanks.forEach(tank => {
        if (tank.id && tank.pumpStatus) {
          currentState.pumps[`pump${tank.id}`] = tank.pumpStatus;
        }
      });
      
      // 캐시 무효화
      cachedState = null;
    } else {
      // 전체 상태 업데이트
      currentState = { ...currentState, ...data, timestamp: Date.now() };
      
      // 캐시 무효화
      cachedState = null;
    }
    
    // 로컬 스토리지에 저장
    await localStateManager.setState(STATE_KEY, currentState);
    console.log('시스템 상태 저장 완료');
    
    return NextResponse.json({
      success: true,
      message: '시스템 상태가 성공적으로 저장되었습니다.',
      ...currentState
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