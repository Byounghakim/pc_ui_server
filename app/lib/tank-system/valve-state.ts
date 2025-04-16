// 밸브 상태 관리 모듈
"use client";

// 밸브 상태 관련 인터페이스
export interface ValveState {
  valve1: number;      // 첫 번째 밸브 상태 (0 또는 1)
  valve2: number;      // 두 번째 밸브 상태 (0 또는 1)
  valve1Desc: string;  // 첫 번째 밸브 설명 (추출순환, 전체순환 등)
  valve2Desc: string;  // 두 번째 밸브 설명 (ON, OFF 등)
}

export interface TankValveData {
  valveState: string;
  valveStatusMessage?: string;
  valveADesc?: string;
  valveBDesc?: string;
  [key: string]: any;  // 다른 프로퍼티도 허용
}

// 기본 밸브 상태
export const DEFAULT_VALVE_STATE: ValveState = {
  valve1: 0,
  valve2: 0,
  valve1Desc: '전체순환',
  valve2Desc: 'OFF'
};

/**
 * 밸브 상태 문자열을 파싱하여 ValveState 객체로 변환
 * @param tankData 탱크 데이터 객체
 * @param loadState 저장된 상태를 로드하는 함수
 * @param saveState 상태를 저장하는 함수
 * @returns 파싱된 밸브 상태 객체
 */
export function parseValveState(
  tankData: TankValveData, 
  loadState: () => any | null, 
  saveState?: (state: any) => void
): ValveState {
  // 디버깅용 로그 추가
  console.log('[밸브상태] parseValveState 호출됨');
  console.log('[밸브상태] 현재 밸브 상태:', tankData.valveState);
  console.log('[밸브상태] 밸브 상태 메시지:', tankData.valveStatusMessage);

  // tankData의 유효성 검사
  if (!tankData || !tankData.valveState) {
    console.log('[밸브상태] tankData 또는 valveState가 유효하지 않음, 저장된 상태 확인');
    // 저장된 상태 확인
    const savedState = loadState();
    if (savedState && savedState.valveState) {
      console.log('저장된 밸브 상태 발견:', savedState.valveState);
      return {
        valve1: parseInt(savedState.valveState[0]) || 0,
        valve2: parseInt(savedState.valveState[1]) || 0,
        valve1Desc: savedState.valveADesc || (parseInt(savedState.valveState[0]) === 1 ? '추출순환' : '전체순환'),
        valve2Desc: savedState.valveBDesc || (parseInt(savedState.valveState[1]) === 1 ? 'ON' : 'OFF')
      };
    }
    
    // 기본값 반환
    return { ...DEFAULT_VALVE_STATE };
  }
  
  // 특수 케이스: 0100 (밸브2 OFF, 밸브1 ON)
  if (tankData.valveState === '0100') {
    console.log('[밸브상태] 특수 케이스 감지: 0100 - 밸브2 OFF, 밸브1 ON');
    
    // 저장된 상태에서 설명 불러오기 시도
    const savedState = loadState();
    
    // 저장된 설명 또는 현재 설명 사용, 없으면 기본값 사용
    let valveADesc = savedState?.valveADesc || tankData.valveADesc || '전체순환';
    let valveBDesc = savedState?.valveBDesc || tankData.valveBDesc || 'ON';
    
    console.log('[밸브상태] 0100 특수 케이스 설명 텍스트:', valveADesc, valveBDesc);
    
    // 상태 저장 함수가 제공된 경우 저장
    if (saveState) {
      saveState({
        ...tankData,
        valveADesc,
        valveBDesc
      });
    }
    
    return {
      valve1: 0, // 밸브2 OFF (3way)
      valve2: 1, // 밸브1 ON (2way)
      valve1Desc: valveADesc,
      valve2Desc: valveBDesc
    };
  }
  
  // valveStatusMessage를 우선적으로 확인하여 상태 파싱
  if (tankData.valveStatusMessage) {
    console.log('[밸브상태] valveStatusMessage로 상태 파싱:');
    // 'valveA=ON' 또는 'valveA=OFF' 포함 여부 정확히 체크
    const valveAState = tankData.valveStatusMessage.includes('valveA=ON') ? 1 : 0;
    const valveBState = tankData.valveStatusMessage.includes('valveB=ON') ? 1 : 0;
    
    // 밸브 설명 텍스트 - 제공된 값 사용
    let valveADesc = tankData.valveADesc || '';
    let valveBDesc = tankData.valveBDesc || '';
    
    // 설명이 없으면 상태에 따라 기본값 설정
    if (!valveADesc) {
      valveADesc = valveAState === 1 ? '추출순환' : '전체순환';
    }
    if (!valveBDesc) {
      valveBDesc = valveBState === 1 ? 'ON' : 'OFF';
    }
    
    // 디버깅을 위한 로그
    console.log(`[밸브상태] 파싱 결과: valveA=${valveAState} (${valveADesc}), valveB=${valveBState} (${valveBDesc})`);
    
    // 상태 저장 함수가 제공된 경우 저장
    if (saveState) {
      saveState({
        ...tankData,
        valveADesc,
        valveBDesc
      });
    }
    
    return {
      valve1: valveAState,
      valve2: valveBState,
      valve1Desc: valveADesc,
      valve2Desc: valveBDesc
    };
  }
  
  // valveState의 길이 확인
  if (typeof tankData.valveState !== 'string' || tankData.valveState.length < 2) {
    console.warn('[밸브상태] valveState 형식 오류:', tankData.valveState);
    
    // localStorage에 저장된 상태 확인
    const savedState = loadState();
    if (savedState && savedState.valveState && typeof savedState.valveState === 'string' && savedState.valveState.length >= 2) {
      console.log('[밸브상태] localStorage에서 밸브 상태 복원:', savedState.valveState);
      const v1 = parseInt(savedState.valveState[0]) || 0;
      const v2 = parseInt(savedState.valveState[1]) || 0;
      return {
        valve1: v1,
        valve2: v2,
        valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
        valve2Desc: v2 === 1 ? 'ON' : 'OFF'
      };
    }
    
    // 기본값 반환
    return { ...DEFAULT_VALVE_STATE };
  }
  
  // 기존 로직 유지 (fallback)
  if (tankData.valveState.length !== 4) {
    // localStorage에 저장된 상태가 있으면 사용
    const savedState = loadState();
    if (savedState && savedState.valveState && savedState.valveState.length === 4) {
      console.log('[밸브상태] localStorage에서 밸브 상태 복원:', savedState.valveState);
      const v1 = parseInt(savedState.valveState[0]);
      const v2 = parseInt(savedState.valveState[1]);
      return {
        valve1: v1,
        valve2: v2,
        valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
        valve2Desc: v2 === 1 ? 'ON' : 'OFF'
      };
    }
    
    // localStorage에 저장된 밸브 상태 메시지가 있으면 사용
    const savedValveStatusMessage = loadState()?.valveStatusMessage;
    if (savedValveStatusMessage) {
      console.log('[밸브상태] localStorage에서 밸브 상태 메시지 복원:', savedValveStatusMessage);
      const valveAState = savedValveStatusMessage.includes('valveA=ON') ? 1 : 0;
      const valveBState = savedValveStatusMessage.includes('valveB=ON') ? 1 : 0;
      return {
        valve1: valveAState,
        valve2: valveBState,
        valve1Desc: valveAState === 1 ? '추출순환' : '전체순환',
        valve2Desc: valveBState === 1 ? 'ON' : 'OFF'
      };
    }
    
    // 최소 안전 길이 보장
    const safeValveState = (tankData.valveState + '0000').slice(0, 4);
    console.log('[밸브상태] 안전하게 보정된 밸브 상태:', safeValveState);
    
    const v1 = parseInt(safeValveState[0]) || 0;
    const v2 = parseInt(safeValveState[1]) || 0;
    
    return {
      valve1: v1, 
      valve2: v2,
      valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
      valve2Desc: v2 === 1 ? 'ON' : 'OFF'
    };
  }

  const v1 = parseInt(tankData.valveState[0]);
  const v2 = parseInt(tankData.valveState[1]);

  // 상태 저장 함수가 제공된 경우 저장
  if (saveState) {
    saveState(tankData);
  }

  const result: ValveState = {
    valve1: v1,
    valve2: v2,
    valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
    valve2Desc: v2 === 1 ? 'ON' : 'OFF'
  };
  
  console.log('[밸브상태] parseValveState 결과:', result);
  return result;
}

/**
 * 특정 경로가 활성화되었는지 확인
 * @param path 확인할 경로
 * @param valveState 밸브 상태 객체
 */
export function isPathActive(
  path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1", 
  valveState: ValveState
): boolean {
  console.log(`[밸브상태] isPathActive 호출: ${path}, valve1=${valveState.valve1}, valve2=${valveState.valve2}`);
  
  if (path === "tank6ToMain") return valveState.valve1 === 0;
  if (path === "tank6ToTank1") return valveState.valve1 === 1;
  if (path === "mainToTank1") return valveState.valve2 === 1;
  
  return false;
}

/**
 * 라인 표시 여부 결정
 * @param path 확인할 경로
 * @param valveState 밸브 상태 객체
 */
export function shouldShowLine(
  path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1", 
  valveState: ValveState
): boolean {
  console.log(`[밸브상태] shouldShowLine 호출: ${path}, valve1=${valveState.valve1}, valve2=${valveState.valve2}`);
  
  if (path === "tank6ToMain") {
    const result = valveState.valve1 === 0;
    console.log(`[밸브상태] tank6ToMain 라인 표시 여부: ${result}`);
    return result;
  }
  if (path === "tank6ToTank1") {
    const result = valveState.valve1 === 1;
    console.log(`[밸브상태] tank6ToTank1 라인 표시 여부: ${result}`);
    return result;
  }
  if (path === "mainToTank1") {
    const result = valveState.valve2 === 1;
    console.log(`[밸브상태] mainToTank1 라인 표시 여부: ${result}`);
    return result;
  }
  
  return false;
}

/**
 * 밸브 상태에 따른 파이프 색상 가져오기
 * @param path 확인할 경로
 * @param valveState 밸브 상태 객체
 */
export function getValvePipeColor(
  path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1", 
  valveState: ValveState
): string {
  const isActive = isPathActive(path, valveState);
  console.log(`[밸브상태] getValvePipeColor: ${path}, 활성화=${isActive}`);
  
  return isActive ? "stroke-blue-500" : "stroke-gray-300";
}

/**
 * 밸브 상태 텍스트 가져오기
 * @param valveState 밸브 상태 객체
 */
export function getValveStateText(valveState: ValveState): string {
  return `${valveState.valve1Desc} / ${valveState.valve2Desc}`;
}

/**
 * 다음 밸브 상태 계산 (순환 로직)
 * @param currentValveState 현재 밸브 상태 문자열
 */
export function getNextValveState(currentValveState: string): string {
  // 현재 상태가 없거나 유효하지 않은 경우 기본값
  if (!currentValveState || typeof currentValveState !== 'string' || currentValveState.length < 2) {
    return "0000";
  }
  
  // 일반적인 경우 (첫번째 자리만 토글)
  const v1 = parseInt(currentValveState[0]) || 0;
  const v2 = parseInt(currentValveState[1]) || 0;
  
  // 새 상태: 첫 번째 자리 토글 (0 -> 1, 1 -> 0)
  const newV1 = v1 === 1 ? 0 : 1;
  
  // 새 상태 문자열 생성 (남은 자리는 그대로 유지)
  let newState = "";
  if (currentValveState.length >= 4) {
    newState = `${newV1}${v2}${currentValveState[2]}${currentValveState[3]}`;
  } else {
    // 4자리가 아닌 경우 부족한 자릿수는 0으로 채움
    newState = `${newV1}${v2}${'0'.repeat(Math.max(0, 4 - currentValveState.length))}`;
  }
  
  console.log(`[밸브상태] 밸브 상태 변경: ${currentValveState} -> ${newState}`);
  return newState;
} 