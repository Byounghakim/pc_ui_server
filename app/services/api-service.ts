/**
 * API 서비스 모듈
 * 
 * 애플리케이션의 주요 API 호출 기능 구현.
 * 기존 api.ts 파일의 기능을 api-utils.ts 모듈을 사용하여 리팩토링된 버전.
 */

import { PumpSequence, WorkLog, AutomationProcess, LogRetentionPolicy } from '../types';
import { get, post, put, del, ApiError, HttpStatus, standardizeResponse, standardizeError } from '../../lib/api-utils';
import { debugLog, getEnvironmentConfig } from '../../lib/environment';

// 서버 연결 상태 관리
let isServerConnected = false;
let lastServerCheckTime = 0;
let lastServerErrorLogTime = 0;
let connectionCheckCount = 0;

// 환경 설정에서 가져온 서버 체크 설정
const config = getEnvironmentConfig();
const SERVER_CHECK_INTERVAL = config.serverCheckInterval || 60000; // 60초
const ERROR_LOG_INTERVAL = config.errorLogInterval || 600000; // 10분
const MAX_CHECK_COUNT = config.maxCheckCount || 3;

/**
 * 서버 연결 상태 확인
 * @param forceCheck 강제로 서버 상태를 확인할지 여부
 * @param showLog 로그를 표시할지 여부
 */
export const checkServerConnection = async (forceCheck = false, showLog = false): Promise<boolean> => {
  // 마지막 체크 후 일정 시간이 지났거나 강제 체크인 경우에만 확인
  const now = Date.now();
  if (!forceCheck && now - lastServerCheckTime < SERVER_CHECK_INTERVAL) {
    return isServerConnected;
  }
  
  // 연속 시도 횟수가 MAX_CHECK_COUNT를 초과하고 마지막 체크 후 30분이 지나지 않았으면
  // 이전 결과 반환 (너무 자주 시도하지 않도록)
  if (connectionCheckCount >= MAX_CHECK_COUNT && now - lastServerCheckTime < 1800000) {
    if (showLog) {
      debugLog(`최대 재시도 횟수(${MAX_CHECK_COUNT}) 초과로 이전 상태 반환: ${isServerConnected ? '연결됨' : '연결 안됨'}`);
    }
    return isServerConnected;
  }
  
  try {
    debugLog(`서버 상태 확인 요청: /api/health (시도 ${connectionCheckCount + 1}/${MAX_CHECK_COUNT})`);
    
    // 타임아웃 설정은 api-utils의 get 함수가 내부적으로 처리함
    await get('/health', { 
      timeout: 3000, // 3초 타임아웃
      skipErrorLogging: !showLog // 로그 표시 설정에 따라 에러 로깅 스킵
    });
    
    // 이전 상태와 현재 상태가 다른 경우에만 로그 출력
    const prevStatus = isServerConnected;
    isServerConnected = true;
    lastServerCheckTime = now;
    
    if (prevStatus !== isServerConnected) {
      debugLog('서버 연결됨: API 요청을 다시 시작합니다.');
      connectionCheckCount = 0; // 연결 성공 시 카운터 리셋
    } else if (showLog) {
      debugLog(`서버 연결 상태: 정상`);
    }
    
    return true;
  } catch (error) {
    const prevStatus = isServerConnected;
    isServerConnected = false;
    lastServerCheckTime = now;
    connectionCheckCount++; // 연결 실패 시 카운터 증가
    
    // 상태 변경 또는 지정된 간격마다만 로그 출력
    if (prevStatus || showLog || now - lastServerErrorLogTime > ERROR_LOG_INTERVAL) {
      debugLog(`서버 연결 실패 (/api/health): ${error instanceof Error ? error.message : String(error)}`);
      lastServerErrorLogTime = now;
    }
    
    return false;
  }
};

/**
 * 서버에 시퀀스 저장
 */
export const saveSequencesToServer = async (sequences: any[]): Promise<{ success: boolean; message: string }> => {
  debugLog(`서버에 ${sequences.length}개 시퀀스 저장 시도`);
  
  try {
    // 서버 연결 확인
    const isServerConnected = await checkServerConnection();
    if (!isServerConnected) {
      debugLog('서버 연결 실패, 저장 프로세스 중단');
      return { success: false, message: '서버 연결 실패' };
    }

    // 시퀀스 데이터 검증
    if (!sequences || !Array.isArray(sequences) || sequences.length === 0) {
      debugLog('저장할 시퀀스 데이터가 유효하지 않음');
      return { success: false, message: '저장할 시퀀스 데이터가 유효하지 않습니다' };
    }

    // 시퀀스 정리 (필요한 속성만 포함)
    const cleanedSequences = sequences.map(seq => ({
      id: seq.id,
      name: seq.name,
      steps: seq.steps,
      createdAt: seq.createdAt,
      updatedAt: seq.updatedAt || new Date().toISOString()
    }));

    // api-utils의 post 함수 사용
    const result = await post('/sequences', cleanedSequences, {
      timeout: 10000, // 10초 타임아웃
      retries: 2,     // 2번 재시도
      exponentialBackoff: true
    });

    debugLog(`시퀀스 저장 성공:`, result);
    return { 
      success: true, 
      message: result.message || `${sequences.length}개 시퀀스 저장됨` 
    };
    
  } catch (error) {
    debugLog('시퀀스 저장 중 예외 발생:', error);
    
    if (error instanceof ApiError) {
      return { 
        success: false, 
        message: `서버 응답 오류 (${error.status}): ${error.message}` 
      };
    }
    
    return { 
      success: false, 
      message: error instanceof Error ? error.message : '알 수 없는 오류'
    };
  }
};

/**
 * 서버에서 시퀀스 불러오기
 */
export const loadSequencesFromServer = async (): Promise<PumpSequence[] | null> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      return null;
    }
    
    // api-utils의 get 함수 사용
    const data = await get<{ sequences: PumpSequence[] }>('/sequences', {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    return data.sequences || null;
  } catch (error) {
    debugLog('시퀀스 불러오기 실패:', error);
    return null;
  }
};

/**
 * 서버에 상태 저장
 */
export const saveStateToServer = async (state: any): Promise<boolean> => {
  try {
    // 디버깅 로그
    debugLog('saveStateToServer 함수 호출됨');
    debugLog('전달받은 state 객체:', state);
    
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 상태를 로컬에만 저장합니다.');
      return false;
    }
    
    // API 요청 형식 변경: {key, state} 형식으로 수정
    const requestData = {
      key: 'system:state', // 기본 시스템 상태 키
      state: state // 실제 상태 데이터
    };
    
    // api-utils의 post 함수 사용
    await post('/state', requestData, {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    debugLog('상태 저장 성공');
    return true;
  } catch (error) {
    debugLog('상태 저장 실패:', error);
    return false;
  }
};

/**
 * 서버에서 상태 불러오기
 */
export const loadStateFromServer = async (key: string = 'system:state'): Promise<any | null> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 상태를 불러올 수 없습니다.');
      return null;
    }
    
    // api-utils의 get 함수 사용
    const data = await get(`/state?key=${encodeURIComponent(key)}`, {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    return data;
  } catch (error) {
    debugLog('상태 불러오기 실패:', error);
    return null;
  }
};

/**
 * 작업 로그 저장
 */
export const saveWorkLog = async (workLog: WorkLog): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 작업 로그를 저장할 수 없습니다.');
      return false;
    }
    
    // api-utils의 post 함수 사용
    await post('/logs/work', workLog, {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    debugLog('작업 로그 저장 성공');
    return true;
  } catch (error) {
    debugLog('작업 로그 저장 실패:', error);
    return false;
  }
};

/**
 * 작업 로그 불러오기
 */
export const loadWorkLogs = async (limit: number = 100, offset: number = 0): Promise<WorkLog[] | null> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 작업 로그를 불러올 수 없습니다.');
      return null;
    }
    
    // api-utils의 get 함수 사용
    const data = await get<{ logs: WorkLog[] }>(`/logs/work?limit=${limit}&offset=${offset}`, {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    return data.logs || null;
  } catch (error) {
    debugLog('작업 로그 불러오기 실패:', error);
    return null;
  }
};

/**
 * 자동화 공정 저장
 */
export const saveAutomationProcess = async (process: AutomationProcess): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 자동화 공정을 저장할 수 없습니다.');
      return false;
    }
    
    // api-utils의 post 함수 사용
    await post('/automation/processes', process, {
      timeout: 8000, // 8초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    debugLog('자동화 공정 저장 성공');
    return true;
  } catch (error) {
    debugLog('자동화 공정 저장 실패:', error);
    return false;
  }
};

/**
 * 자동화 공정 불러오기
 */
export const loadAutomationProcesses = async (): Promise<AutomationProcess[] | null> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 자동화 공정을 불러올 수 없습니다.');
      return null;
    }
    
    // api-utils의 get 함수 사용
    const data = await get<{ processes: AutomationProcess[] }>('/automation/processes', {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    return data.processes || null;
  } catch (error) {
    debugLog('자동화 공정 불러오기 실패:', error);
    return null;
  }
};

/**
 * 자동화 공정 삭제
 */
export const deleteAutomationProcess = async (processId: string): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 자동화 공정을 삭제할 수 없습니다.');
      return false;
    }
    
    // api-utils의 del 함수 사용
    await del(`/automation/processes?id=${encodeURIComponent(processId)}`, {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    debugLog('자동화 공정 삭제 성공');
    return true;
  } catch (error) {
    debugLog('자동화 공정 삭제 실패:', error);
    return false;
  }
};

/**
 * 로그 보존 정책 저장
 */
export const saveLogRetentionPolicy = async (policy: LogRetentionPolicy): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 로그 보존 정책을 저장할 수 없습니다.');
      return false;
    }
    
    // api-utils의 post 함수 사용
    await post('/settings/log-retention', policy, {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    debugLog('로그 보존 정책 저장 성공');
    return true;
  } catch (error) {
    debugLog('로그 보존 정책 저장 실패:', error);
    return false;
  }
};

/**
 * 로그 보존 정책 불러오기
 */
export const loadLogRetentionPolicy = async (): Promise<LogRetentionPolicy | null> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      debugLog('서버에 연결할 수 없어 로그 보존 정책을 불러올 수 없습니다.');
      return null;
    }
    
    // api-utils의 get 함수 사용
    const data = await get<LogRetentionPolicy>('/settings/log-retention', {
      timeout: 5000, // 5초 타임아웃
      retries: 1     // 1번 재시도
    });
    
    return data;
  } catch (error) {
    debugLog('로그 보존 정책 불러오기 실패:', error);
    return null;
  }
}; 