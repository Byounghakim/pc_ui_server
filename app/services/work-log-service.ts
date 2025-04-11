import { WorkLog, LogRetentionPolicy } from '../types';
import { v4 as uuidv4 } from 'uuid';
import * as apiService from './api';
import dbService from './db-service';

const WORK_LOGS_KEY = 'tank-system-work-logs';
const LOG_RETENTION_POLICY_KEY = 'tank-system-log-retention-policy';

// 기본 로그 보관 정책
const DEFAULT_RETENTION_POLICY: LogRetentionPolicy = {
  maxAgeDays: 30,             // 기본 30일 보관
  maxLogsPerDevice: 1000,     // 장치별 최대 1000개 로그
  autoCleanupEnabled: true,   // 자동 정리 활성화
  retainErrorLogs: true,      // 오류 로그는 보관
  lastCleanupTime: 0          // 마지막 정리 시간
};

const workLogService = {
  // 작업 로그 저장
  saveWorkLog: async (workLog: WorkLog): Promise<void> => {
    try {
      // ID가 없는 경우 새 ID 생성
      if (!workLog.id) {
        workLog.id = uuidv4();
      }
      
      // createdAt 필드가 없으면 추가
      if (!workLog.createdAt) {
        workLog.createdAt = Date.now();
      }
      
      // 클라이언트 IP 주소가 없는 경우 API를 통해 시도
      if (!workLog.clientIp) {
        try {
          const ipInfo = await apiService.getClientIpInfo();
          if (ipInfo && ipInfo.ip) {
            workLog.clientIp = ipInfo.ip;
          }
        } catch (error) {
          console.warn('클라이언트 IP 주소 가져오기 실패:', error);
        }
      }
      
      // 실행 완료된 경우 실행 시간 계산
      if (workLog.status === 'completed' && workLog.startTime && workLog.endTime && !workLog.executionTime) {
        const startTime = new Date(workLog.startTime).getTime();
        const endTime = new Date(workLog.endTime).getTime();
        workLog.executionTime = endTime - startTime;
      }
      
      // 서버 API로 저장 시도
      let serverSaved = false;
      try {
        serverSaved = await apiService.saveWorkLogToServer(workLog);
        
        if (!serverSaved) {
          console.warn('서버 API에 작업 로그 저장 실패, 로컬 스토리지에만 저장됨');
        }
      } catch (serverError) {
        console.warn('서버에 작업 로그 저장 실패, 로컬 스토리지에만 저장됨:', serverError);
      }
      
      // 로컬 스토리지에도 백업으로 저장
      const logs = workLogService.getLogsFromLocalStorage();
      
      // 이미 중복 제거된 로그 사용
      const existingLogIndex = logs.findIndex(log => log.id === workLog.id);
      
      if (existingLogIndex >= 0) {
        logs[existingLogIndex] = workLog;
      } else {
        logs.push(workLog);
      }
      
      // 저장 전 중복 제거 확인
      const uniqueLogs = removeDuplicateLogsById(logs);
      localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(uniqueLogs));
      
      // 로그 자동 정리 (1일 1회)
      await workLogService.performAutoCleanupIfNeeded();
    } catch (error) {
      console.error('작업 로그 저장 중 오류:', error);
      
      // 서버 저장 실패 시 로컬 스토리지에만 저장
      try {
        const logs = workLogService.getLogsFromLocalStorage();
        // 저장 전 중복 제거
        const existingLogIndex = logs.findIndex(log => log.id === workLog.id);
        
        if (existingLogIndex >= 0) {
          logs[existingLogIndex] = workLog;
        } else {
          logs.push(workLog);
        }
        
        // 저장 전 중복 제거 확인
        const uniqueLogs = removeDuplicateLogsById(logs);
        localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(uniqueLogs));
      } catch (localError) {
        console.error('로컬 스토리지에 작업 로그 저장 중 오류:', localError);
      }
    }
    
    return Promise.resolve();
  },
  
  // 작업 로그 목록 불러오기 (중복 ID 처리 추가)
  getWorkLogs: async (options?: {
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
  }> => {
    try {
      // 기본 옵션 설정
      const pageSize = options?.limit || 20;
      const currentPage = options?.page || 1;
      
      // 서버에서 불러오기 시도
      let serverResult = null;
      try {
        serverResult = await apiService.loadWorkLogsFromServer(options);
      } catch (error) {
        console.error('서버에서 작업 로그 불러오기 중 오류:', error);
      }
      
      if (serverResult && serverResult.logs) {
        console.log('서버에서 작업 로그를 불러왔습니다.');
        
        // 중복 ID 필터링 (로그 없이 처리)
        const uniqueLogs = removeDuplicateLogsById(serverResult.logs);
        
        // 로컬 스토리지에도 백업
        localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(uniqueLogs));
        
        return {
          logs: uniqueLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize),
          totalCount: uniqueLogs.length,
          currentPage,
          totalPages: Math.ceil(uniqueLogs.length / pageSize)
        };
      }
    } catch (error) {
      console.error('서버에서 작업 로그 불러오기 중 오류:', error);
    }
    
    // 서버에서 불러오기 실패 시 로컬 스토리지에서 시도
    const allLogs = workLogService.getLogsFromLocalStorage();
    
    // 필터링 적용
    let filteredLogs = allLogs;
    
    if (options) {
      if (options.deviceId) {
        filteredLogs = filteredLogs.filter(log => log.deviceId === options.deviceId);
      }
      
      if (options.taskId) {
        filteredLogs = filteredLogs.filter(log => log.taskId === options.taskId);
      }
      
      if (options.status) {
        filteredLogs = filteredLogs.filter(log => log.status === options.status);
      }
      
      if (options.startDate) {
        const startDate = new Date(options.startDate).getTime();
        filteredLogs = filteredLogs.filter(log => new Date(log.startTime).getTime() >= startDate);
      }
      
      if (options.endDate) {
        const endDate = new Date(options.endDate).getTime();
        filteredLogs = filteredLogs.filter(log => new Date(log.startTime).getTime() <= endDate);
      }
    }
    
    // 최신순 정렬
    filteredLogs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    
    // 페이지네이션 적용
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
    
    return {
      logs: paginatedLogs,
      totalCount: filteredLogs.length,
      currentPage,
      totalPages: Math.ceil(filteredLogs.length / pageSize)
    };
  },
  
  // 장치별 작업 로그 조회
  getLogsByDeviceId: async (deviceId: string, options?: {
    page?: number;
    limit?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    logs: WorkLog[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
  }> => {
    return workLogService.getWorkLogs({
      ...options,
      deviceId
    });
  },
  
  // 작업별 로그 조회
  getLogsByTaskId: async (taskId: string, options?: {
    page?: number;
    limit?: number;
    deviceId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    logs: WorkLog[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
  }> => {
    return workLogService.getWorkLogs({
      ...options,
      taskId
    });
  },
  
  // 로컬 스토리지에서 로그 불러오기 (중복 ID 처리 추가)
  getLogsFromLocalStorage: (): WorkLog[] => {
    const logsJson = localStorage.getItem(WORK_LOGS_KEY);
    if (!logsJson) return [];
    
    try {
      const logs = JSON.parse(logsJson) as WorkLog[];
      
      // 중복 ID 필터링 (로그 없이 처리)
      const uniqueLogs = removeDuplicateLogsById(logs);
      if (uniqueLogs.length !== logs.length) {
        // 필터링된 로그를 다시 저장 (경고 메시지 없이)
        localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(uniqueLogs));
      }
      
      return uniqueLogs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    } catch (error) {
      console.error('작업 로그 파싱 오류:', error);
      return [];
    }
  },
  
  // 작업 로그 업데이트
  updateWorkLog: async (id: string, updates: Partial<WorkLog>): Promise<void> => {
    try {
      // 현재 로그 가져오기
      const logs = await workLogService.getLogsFromLocalStorage();
      const logIndex = logs.findIndex(log => log.id === id);
      
      if (logIndex >= 0) {
        // 로그 업데이트
        const updatedLog = { ...logs[logIndex], ...updates };
        
        // 실행 완료된 경우 실행 시간 계산
        if (updatedLog.status === 'completed' && updatedLog.startTime && updatedLog.endTime && !updatedLog.executionTime) {
          const startTime = new Date(updatedLog.startTime).getTime();
          const endTime = new Date(updatedLog.endTime).getTime();
          updatedLog.executionTime = endTime - startTime;
        }
        
        logs[logIndex] = updatedLog;
        
        // 서버에 저장 시도
        const serverSaved = await apiService.saveWorkLogToServer(updatedLog);
        
        // 로컬 스토리지에도 백업
        localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(logs));
        
        if (!serverSaved) {
          console.warn('서버에 작업 로그 업데이트 실패, 로컬 스토리지에만 저장됨');
        }
      }
    } catch (error) {
      console.error('작업 로그 업데이트 중 오류:', error);
      
      // 서버 저장 실패 시 로컬 스토리지에만 저장
      try {
        const logs = await workLogService.getLogsFromLocalStorage();
        const logIndex = logs.findIndex(log => log.id === id);
        
        if (logIndex >= 0) {
          logs[logIndex] = { ...logs[logIndex], ...updates };
          localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(logs));
        }
      } catch (localError) {
        console.error('로컬 스토리지에 작업 로그 업데이트 중 오류:', localError);
      }
    }
    
    return Promise.resolve();
  },
  
  // 모든 작업 로그 삭제
  clearAllWorkLogs: async (): Promise<void> => {
    try {
      // 서버에서 삭제 시도
      const serverCleared = await apiService.clearWorkLogsFromServer();
      
      // 로컬 스토리지에서도 삭제
      localStorage.removeItem(WORK_LOGS_KEY);
      
      if (!serverCleared) {
        console.warn('서버에서 작업 로그 삭제 실패, 로컬 스토리지에서만 삭제됨');
      }
    } catch (error) {
      console.error('작업 로그 삭제 중 오류:', error);
      
      // 서버 삭제 실패 시 로컬 스토리지에서만 삭제
      localStorage.removeItem(WORK_LOGS_KEY);
    }
    
    return Promise.resolve();
  },
  
  // 오래된 작업 로그 정리
  cleanupOldLogs: async (): Promise<number> => {
    try {
      const policy = await workLogService.getRetentionPolicy();
      const logs = workLogService.getLogsFromLocalStorage();
      
      if (!logs.length) return 0;
      
      const now = Date.now();
      const maxAgeDays = policy.maxAgeDays;
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      
      const deviceLogs: Record<string, WorkLog[]> = {};
      
      // 로그를 장치별로 분류
      logs.forEach(log => {
        const deviceId = log.deviceId || 'unknown';
        if (!deviceLogs[deviceId]) {
          deviceLogs[deviceId] = [];
        }
        deviceLogs[deviceId].push(log);
      });
      
      // 필터링 기준: 날짜와 장치별 최대 개수
      let remainingLogs: WorkLog[] = [];
      let removedCount = 0;
      
      Object.entries(deviceLogs).forEach(([deviceId, deviceLogList]) => {
        // 오류 로그는 별도 처리
        const errorLogs = policy.retainErrorLogs 
          ? deviceLogList.filter(log => log.status === 'error')
          : [];
          
        // 나머지 로그
        const nonErrorLogs = policy.retainErrorLogs
          ? deviceLogList.filter(log => log.status !== 'error')
          : deviceLogList;
        
        // 날짜 기준 필터링
        let filteredLogs = nonErrorLogs.filter(log => {
          // 생성 시간 기준으로 필터링
          if (log.createdAt && now - log.createdAt > maxAgeMs) {
            removedCount++;
            return false;
          }
          
          // 시작 시간 기준으로 필터링 (백업 메커니즘)
          const startTime = new Date(log.startTime).getTime();
          if (now - startTime > maxAgeMs) {
            removedCount++;
            return false;
          }
          
          return true;
        });
        
        // 로그 수 제한
        if (filteredLogs.length > policy.maxLogsPerDevice) {
          // 최신 로그 유지를 위해 날짜 기준 정렬
          filteredLogs.sort((a, b) => 
            (b.createdAt || new Date(b.startTime).getTime()) - 
            (a.createdAt || new Date(a.startTime).getTime())
          );
          
          removedCount += filteredLogs.length - policy.maxLogsPerDevice;
          filteredLogs = filteredLogs.slice(0, policy.maxLogsPerDevice);
        }
        
        // 오류 로그와 필터링된 로그 결합
        remainingLogs = remainingLogs.concat(filteredLogs, errorLogs);
      });
      
      // 로그 저장
      localStorage.setItem(WORK_LOGS_KEY, JSON.stringify(remainingLogs));
      
      // 서버에도 동기화 시도
      try {
        await apiService.syncWorkLogsWithServer(remainingLogs);
      } catch (error) {
        console.warn('서버에 로그 동기화 실패:', error);
      }
      
      // 정책 업데이트
      policy.lastCleanupTime = now;
      await workLogService.saveRetentionPolicy(policy);
      
      console.log(`작업 로그 정리 완료: ${removedCount}개 제거됨, ${remainingLogs.length}개 유지됨`);
      
      return removedCount;
    } catch (error) {
      console.error('작업 로그 정리 중 오류:', error);
      return 0;
    }
  },
  
  // 자동 정리 수행 (필요한 경우)
  performAutoCleanupIfNeeded: async (): Promise<void> => {
    try {
      const policy = await workLogService.getRetentionPolicy();
      
      if (!policy.autoCleanupEnabled) {
        return;
      }
      
      const now = Date.now();
      const lastCleanup = policy.lastCleanupTime || 0;
      const dayInMs = 24 * 60 * 60 * 1000;
      
      // 마지막 정리 후 1일 이상 지났으면 정리 수행
      if (now - lastCleanup > dayInMs) {
        await workLogService.cleanupOldLogs();
      }
    } catch (error) {
      console.error('자동 로그 정리 확인 중 오류:', error);
    }
  },
  
  // 로그 보관 정책 조회
  getRetentionPolicy: async (): Promise<LogRetentionPolicy> => {
    try {
      // 서버에서 불러오기 시도
      let serverPolicy = null;
      try {
        serverPolicy = await apiService.getLogRetentionPolicyFromServer();
      } catch (error) {
        console.warn('서버에서 로그 보관 정책 불러오기 실패:', error);
      }
      
      if (serverPolicy) {
        // 로컬에도 저장
        localStorage.setItem(LOG_RETENTION_POLICY_KEY, JSON.stringify(serverPolicy));
        return serverPolicy;
      }
      
      // 로컬에서 불러오기
      const policyJson = localStorage.getItem(LOG_RETENTION_POLICY_KEY);
      if (policyJson) {
        try {
          return JSON.parse(policyJson);
        } catch (error) {
          console.error('로그 보관 정책 파싱 오류:', error);
        }
      }
      
      // 기본값 반환
      return { ...DEFAULT_RETENTION_POLICY };
    } catch (error) {
      console.error('로그 보관 정책 불러오기 중 오류:', error);
      return { ...DEFAULT_RETENTION_POLICY };
    }
  },
  
  // 로그 보관 정책 저장
  saveRetentionPolicy: async (policy: LogRetentionPolicy): Promise<void> => {
    try {
      // 서버에 저장 시도
      let serverSaved = false;
      try {
        serverSaved = await apiService.saveLogRetentionPolicyToServer(policy);
      } catch (error) {
        console.warn('서버에 로그 보관 정책 저장 실패:', error);
      }
      
      // 로컬에도 저장
      localStorage.setItem(LOG_RETENTION_POLICY_KEY, JSON.stringify(policy));
      
      if (!serverSaved) {
        console.warn('서버에 로그 보관 정책 저장 실패, 로컬 스토리지에만 저장됨');
      }
    } catch (error) {
      console.error('로그 보관 정책 저장 중 오류:', error);
      
      // 서버 저장 실패 시 로컬에만 저장
      try {
        localStorage.setItem(LOG_RETENTION_POLICY_KEY, JSON.stringify(policy));
      } catch (localError) {
        console.error('로컬 스토리지에 로그 보관 정책 저장 중 오류:', localError);
      }
    }
    
    return Promise.resolve();
  },
  
  // 작업 로그 생성 헬퍼 함수
  createWorkLog: (
    sequenceName: string,
    operationMode?: number,
    repeats?: number,
    selectedPumps?: boolean[],
    deviceId?: string
  ): WorkLog => {
    // 현재 시간을 포함하여 거의 고유한 ID 생성
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const uniqueId = `${timestamp}-${randomString}`;
    
    return {
      id: uniqueId, // 커스텀 ID 형식 사용
      sequenceName,
      startTime: new Date().toISOString(),
      status: 'running',
      operationMode,
      repeats,
      selectedPumps,
      deviceId,
      createdAt: timestamp
    };
  },
  
  // 서버에서 로그 불러오기
  getLogsFromServer: async (): Promise<WorkLog[] | null> => {
    try {
      // 서버 API에서 불러오기
      return await apiService.loadWorkLogsFromServer({});
    } catch (error) {
      console.error('서버에서 작업 로그 불러오기 중 오류:', error);
      return null;
    }
  },
  
  // 장치별 서버 로그 불러오기
  getLogsByDeviceIdFromServer: async (deviceId: string): Promise<WorkLog[] | null> => {
    try {
      // 서버 API에서 불러오기
      return await apiService.getDeviceWorkLogs(deviceId, {});
    } catch (error) {
      console.error(`서버에서 장치(${deviceId})의 작업 로그 불러오기 중 오류:`, error);
      return null;
    }
  }
};

// 중복 ID를 제거하는 유틸리티 함수
const removeDuplicateLogsById = (logs: WorkLog[]): WorkLog[] => {
  const uniqueMap = new Map<string, WorkLog>();
  
  logs.forEach(log => {
    // 중복된 ID가 있으면 가장 최신 로그(수정 시간이 가장 나중인 로그)를 유지
    // ID가 있는지 확인
    if (!log.id) {
      // ID가 없는 로그는 새 ID 할당 (실제로는 발생하지 않아야 함)
      log.id = uuidv4();
    }
    
    const existingLog = uniqueMap.get(log.id);
    if (!existingLog) {
      uniqueMap.set(log.id, log);
    } else {
      // 더 최신 로그인 경우에만 교체 (endTime이 있거나 startTime이 더 최신인 경우)
      const existingTime = existingLog.endTime ? 
        new Date(existingLog.endTime).getTime() : 
        new Date(existingLog.startTime).getTime();
        
      const newTime = log.endTime ? 
        new Date(log.endTime).getTime() : 
        new Date(log.startTime).getTime();
        
      if (newTime > existingTime) {
        uniqueMap.set(log.id, log);
      }
    }
  });
  
  return Array.from(uniqueMap.values());
};

// KV 스토어 인스턴스 가져오기
const getKVStore = () => {
  // 클라이언트 사이드에서는 Mock 스토어 사용
  return {
    get: async (key: string): Promise<any> => null,
    set: async (key: string, value: any): Promise<void> => {},
    hget: async (hash: string, key: string): Promise<any> => null,
    hset: async (hash: string, key: string, value: any): Promise<void> => {}
  };
};

export default workLogService; 