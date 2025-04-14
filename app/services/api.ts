import { PumpSequence, WorkLog, AutomationProcess, LogRetentionPolicy } from '../types';

// API 기본 URL - Next.js API 라우트 사용 (포트가 3000)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 
                    (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? 
                    window.location.origin + '/api' : '/api');

// 서버 연결 상태를 저장하는 변수
let isServerConnected = false; // 기본값을 false로 설정
let lastServerCheckTime = 0;
let lastServerErrorLogTime = 0;
let connectionCheckCount = 0; // 연결 시도 횟수
const SERVER_CHECK_INTERVAL = 60000; // 60초마다 서버 연결 상태 확인 (시간 늘림)
const ERROR_LOG_INTERVAL = 600000; // 10분마다 연결 실패 로그 출력 (시간 늘림)
const MAX_CHECK_COUNT = 3; // 최대 연속 시도 횟수

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
    return isServerConnected;
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5초 타임아웃으로 더 단축
    
    console.log(`서버 상태 확인 요청: ${API_BASE_URL}/health`);
    
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    // 이전 상태와 현재 상태가 다른 경우에만 로그 출력
    const prevStatus = isServerConnected;
    isServerConnected = response.ok;
    lastServerCheckTime = now;
    
    if (prevStatus !== isServerConnected) {
      if (isServerConnected) {
        console.log('서버 연결됨: API 요청을 다시 시작합니다.');
        connectionCheckCount = 0; // 연결 성공 시 카운터 리셋
      } else {
        console.log('서버 연결 해제됨: 로컬 데이터만 사용합니다.');
        connectionCheckCount++; // 연결 실패 시 카운터 증가
      }
    } else if (showLog && isServerConnected) {
      console.log('서버 연결 상태 확인됨');
    }
    
    return isServerConnected;
  } catch (error) {
    const prevStatus = isServerConnected;
    isServerConnected = false;
    lastServerCheckTime = now;
    connectionCheckCount++; // 연결 실패 시 카운터 증가
    
    // 상태 변경 또는 지정된 간격마다만 로그 출력
    if (prevStatus || showLog || now - lastServerErrorLogTime > ERROR_LOG_INTERVAL) {
      console.log(`서버 연결 실패 (${API_BASE_URL}/health): ${error.message}`);
      lastServerErrorLogTime = now;
    }
    
    return false;
  }
};

/**
 * 서버에 시퀀스 저장
 */
export const saveSequencesToServer = async (sequences: PumpSequence[]): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      return false;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/sequences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sequences: sequences }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`서버 응답 오류: ${response.status}`);
      return false;
    }
    
    return true;
  } catch (error) {
    // 로그 출력하지 않음 - 이미 서버 연결 상태 체크에서 로그를 출력함
    return false;
  }
};

/**
 * 서버에서 시퀀스 불러오기
 */
export const loadSequencesFromServer = async (): Promise<PumpSequence[] | null> => {
  try {
    // 서버 연결 상태 확인 - 로그 표시 안 함
    const connected = await checkServerConnection();
    if (!connected) {
      return null;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/sequences`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
};

/**
 * 서버에 상태 저장
 */
export const saveStateToServer = async (state: any): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      console.log('서버에 연결할 수 없어 상태를 로컬에만 저장합니다.');
      return false;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(state),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`서버 응답 오류: ${response.status}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('서버에 상태 저장 중 오류:', error);
    return false;
  }
};

/**
 * 서버에서 상태 불러오기
 */
export const loadStateFromServer = async (): Promise<any | null> => {
  try {
    // 서버 연결 상태 확인 - 로그 표시 안 함
    const connected = await checkServerConnection();
    if (!connected) {
      return null;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/state`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
};

/**
 * 서버에 작업 로그 저장
 */
export const saveWorkLogToServer = async (log: WorkLog): Promise<boolean> => {
  try {
    const response = await fetch('/api/work-logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(log),
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('서버에 작업 로그 저장 실패:', error);
    return false;
  }
};

/**
 * 서버에 여러 작업 로그 저장
 */
export const saveWorkLogsToServer = async (logs: WorkLog[]): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      console.log('서버에 연결할 수 없어 작업 로그를 로컬에만 저장합니다.');
      return false;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/work-logs/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logs),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`서버 응답 오류: ${response.status}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('서버에 작업 로그 저장 중 오류:', error);
    return false;
  }
};

/**
 * 서버에서 작업 로그 불러오기
 */
export const loadWorkLogsFromServer = async (options?: {
  page?: number;
  limit?: number;
  deviceId?: string;
  taskId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{
  logs: WorkLog[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
} | null> => {
  try {
    // 쿼리 파라미터 구성
    const params = new URLSearchParams();
    
    if (options) {
      if (options.page) params.append('page', options.page.toString());
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.deviceId) params.append('deviceId', options.deviceId);
      if (options.taskId) params.append('taskId', options.taskId);
      if (options.status) params.append('status', options.status);
      if (options.startDate) params.append('startDate', options.startDate);
      if (options.endDate) params.append('endDate', options.endDate);
    }
    
    const queryString = params.toString();
    const url = `/api/work-logs${queryString ? `?${queryString}` : ''}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('서버에서 작업 로그 불러오기 실패:', error);
    return null;
  }
};

/**
 * 서버에서 작업 로그 삭제
 */
export const clearWorkLogsFromServer = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/work-logs', {
      method: 'DELETE',
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('서버에서 작업 로그 삭제 실패:', error);
    return false;
  }
};

/**
 * 서버에 자동화 공정 저장
 */
export const saveAutomationProcessesToServer = async (processes: AutomationProcess[]): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      console.log('서버에 연결할 수 없어 자동화 공정을 로컬에만 저장합니다.');
      return false;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/automation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(processes),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`서버 응답 오류: ${response.status}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('서버에 자동화 공정 저장 중 오류:', error);
    return false;
  }
};

/**
 * 서버에서 자동화 공정 불러오기
 */
export const loadAutomationProcessesFromServer = async (): Promise<AutomationProcess[] | null> => {
  try {
    // 서버 연결 상태 확인 - 로그 표시 안 함
    const connected = await checkServerConnection();
    if (!connected) {
      return null;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/automation`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
};

/**
 * 서버에서 자동화 공정 삭제
 */
export const deleteAutomationProcessFromServer = async (processId: string): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      console.log('서버에 연결할 수 없어 자동화 공정 삭제를 건너뜁니다.');
      return false;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/automation/${processId}`, {
      method: 'DELETE',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`서버 응답 오류: ${response.status}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('서버에서 자동화 공정 삭제 중 오류:', error);
    return false;
  }
};

/**
 * 서버에서 자동화 공정 업데이트
 */
export const updateAutomationProcessOnServer = async (process: AutomationProcess): Promise<boolean> => {
  try {
    // 서버 연결 상태 확인
    const connected = await checkServerConnection();
    if (!connected) {
      console.log('서버에 연결할 수 없어 자동화 공정 업데이트를 건너뜁니다.');
      return false;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${API_BASE_URL}/automation/${process.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(process),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`서버 응답 오류: ${response.status}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('서버에서 자동화 공정 업데이트 중 오류:', error);
    return false;
  }
};

// 작업 목록 관련 API 함수
export const saveTaskToServer = async (task) => {
  try {
    // Vercel 서버리스 함수 호출
    const response = await fetch('/api/tasks/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(task)
    });

    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }

    const result = await response.json();
    return true;
  } catch (error) {
    console.error('작업 저장 API 오류:', error);
    return false;
  }
};

export const loadTasksFromServer = async () => {
  try {
    const response = await fetch('/api/tasks/all');
    
    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }
    
    const tasks = await response.json();
    return tasks;
  } catch (error) {
    console.error('작업 목록 로드 API 오류:', error);
    return null;
  }
};

export const getTaskByIdFromServer = async (id) => {
  try {
    const response = await fetch(`/api/tasks/${id}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null; // 작업이 존재하지 않음
      }
      throw new Error(`서버 오류: ${response.status}`);
    }
    
    const task = await response.json();
    return task;
  } catch (error) {
    console.error(`작업(ID: ${id}) 로드 API 오류:`, error);
    return null;
  }
};

export const deleteTaskFromServer = async (id) => {
  try {
    const response = await fetch(`/api/tasks/${id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error(`작업(ID: ${id}) 삭제 API 오류:`, error);
    return false;
  }
};

export const clearAllTasksFromServer = async () => {
  try {
    const response = await fetch('/api/tasks/clear', {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error('작업 목록 비우기 API 오류:', error);
    return false;
  }
};

// 작업 버전 관련 API 함수
export const saveTaskVersionToServer = async (taskId: string, version: string, task) => {
  try {
    // Vercel 서버리스 함수 호출
    const response = await fetch(`/api/tasks/versions/${taskId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version,
        task
      })
    });

    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }

    const result = await response.json();
    return true;
  } catch (error) {
    console.error('작업 버전 저장 API 오류:', error);
    return false;
  }
};

export const getTaskVersionsFromServer = async (taskId: string) => {
  try {
    const response = await fetch(`/api/tasks/versions/${taskId}`);
    
    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || '작업 버전 조회 실패');
    }
    
    return result.versions;
  } catch (error) {
    console.error(`작업(ID: ${taskId}) 버전 조회 API 오류:`, error);
    return null;
  }
};

export const restoreTaskVersionFromServer = async (taskId: string, version: string) => {
  try {
    const response = await fetch(`/api/tasks/versions/${taskId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version
      })
    });
    
    if (!response.ok) {
      throw new Error(`서버 오류: ${response.status}`);
    }
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || '작업 버전 복원 실패');
    }
    
    return result.task;
  } catch (error) {
    console.error(`작업(ID: ${taskId}) 버전(${version}) 복원 API 오류:`, error);
    return null;
  }
};

// 특정 장치의 작업 로그 조회
export const getDeviceWorkLogs = async (
  deviceId: string,
  options?: {
    page?: number;
    limit?: number;
    taskId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<{
  logs: WorkLog[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
} | null> => {
  try {
    // 쿼리 파라미터 구성
    const params = new URLSearchParams();
    
    if (options) {
      if (options.page) params.append('page', options.page.toString());
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.taskId) params.append('taskId', options.taskId);
      if (options.status) params.append('status', options.status);
      if (options.startDate) params.append('startDate', options.startDate);
      if (options.endDate) params.append('endDate', options.endDate);
    }
    
    const queryString = params.toString();
    const url = `/api/devices/${deviceId}/work-logs${queryString ? `?${queryString}` : ''}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`장치(${deviceId})의 작업 로그 조회 실패:`, error);
    return null;
  }
};

// 특정 작업의 로그 조회
export const getTaskWorkLogs = async (
  taskId: string,
  options?: {
    page?: number;
    limit?: number;
    deviceId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<{
  logs: WorkLog[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
} | null> => {
  try {
    // taskId를 포함한 일반 로그 검색 엔드포인트 사용
    const params = new URLSearchParams();
    params.append('taskId', taskId);
    
    if (options) {
      if (options.page) params.append('page', options.page.toString());
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.deviceId) params.append('deviceId', options.deviceId);
      if (options.status) params.append('status', options.status);
      if (options.startDate) params.append('startDate', options.startDate);
      if (options.endDate) params.append('endDate', options.endDate);
    }
    
    const queryString = params.toString();
    const url = `/api/work-logs?${queryString}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`작업(${taskId})의 로그 조회 실패:`, error);
    return null;
  }
};

// 단일 작업 로그 조회
export const getWorkLogById = async (logId: string): Promise<WorkLog | null> => {
  try {
    const response = await fetch(`/api/work-logs/${logId}`);
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    const data = await response.json();
    return data.success ? data.log : null;
  } catch (error) {
    console.error(`작업 로그(${logId}) 조회 실패:`, error);
    return null;
  }
};

// 작업 로그 업데이트
export const updateWorkLog = async (logId: string, updates: Partial<WorkLog>): Promise<boolean> => {
  try {
    const response = await fetch(`/api/work-logs/${logId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error(`작업 로그(${logId}) 업데이트 실패:`, error);
    return false;
  }
};

// 작업 로그 삭제
export const deleteWorkLog = async (logId: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/work-logs/${logId}`, {
      method: 'DELETE',
    });
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error(`작업 로그(${logId}) 삭제 실패:`, error);
    return false;
  }
};

// 작업 로그 일괄 동기화
export const syncWorkLogsWithServer = async (logs: WorkLog[]): Promise<boolean> => {
  try {
    const response = await fetch('/api/work-logs', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logs),
    });
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('작업 로그 동기화 실패:', error);
    return false;
  }
};

// 로그 보관 정책 조회
export const getLogRetentionPolicyFromServer = async (): Promise<LogRetentionPolicy | null> => {
  try {
    const response = await fetch('/api/work-logs/retention-policy');
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    const data = await response.json();
    return data.success ? data.policy : null;
  } catch (error) {
    console.error('로그 보관 정책 조회 실패:', error);
    return null;
  }
};

// 로그 보관 정책 저장
export const saveLogRetentionPolicyToServer = async (policy: LogRetentionPolicy): Promise<boolean> => {
  try {
    const response = await fetch('/api/work-logs/retention-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(policy),
    });
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('로그 보관 정책 저장 실패:', error);
    return false;
  }
};

// 클라이언트 IP 주소 정보 가져오기
export const getClientIpInfo = async (): Promise<{ ip: string } | null> => {
  try {
    // 외부 서비스 또는 내부 API를 통해 IP 정보 가져오기
    const response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('IP 정보 가져오기 실패:', error);
    return null;
  }
}; 