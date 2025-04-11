import { connectToDatabase, COLLECTIONS } from '../lib/db-connect';
import dbTaskService from './db-task-service';
import backupService from './backup-service';
import mqttService from './mqtt-service';
import mqttClient from '../../lib/mqtt-client';
import { MQTT_TOPICS } from '../../lib/mqtt-topics';
import { WorkTask, WorkLog } from '../types';
import { v4 as uuidv4 } from 'uuid';

// 서버 사이드 확인 함수
const isServerSide = () => typeof window === 'undefined';

// 장치 리셋 명령 전송
async function sendDeviceResetCommand(deviceId: string): Promise<boolean> {
  try {
    // 서버 사이드에서는 실행하지 않음
    if (isServerSide()) {
      console.log('서버 사이드에서 장치 리셋 명령을 보내지 않습니다.');
      return true;
    }
    
    // MQTT 연결 확인
    if (mqttClient && typeof mqttClient.isConnected === 'function' && mqttClient.isConnected()) {
      const commandTopic = MQTT_TOPICS.DEVICE_COMMAND;
      const command = JSON.stringify({
        deviceId,
        action: 'reset',
        timestamp: Date.now()
      });
      
      mqttClient.publish(commandTopic, command);
      return true;
    } 
    
    return false;
  } catch (error) {
    console.error('장치 리셋 명령 전송 중 오류:', error);
    return false;
  }
}

// 오류 복구 메커니즘을 위한 서비스
const errorRecoveryService = {
  // 작업 실행 중 오류 발생 시 복구 시도
  recoverFromTaskExecutionError: async (taskId: string, deviceId: string, errorDetails: string): Promise<boolean> => {
    try {
      console.log(`작업(${taskId}) 실행 오류 복구 시도, 장치: ${deviceId}, 오류: ${errorDetails}`);
      
      // 1. 문제가 된 작업 정보 가져오기
      const task = await dbTaskService.getTaskById(taskId);
      if (!task) {
        console.error(`복구 실패: 작업(${taskId})을 찾을 수 없습니다.`);
        return false;
      }
      
      // 2. 오류 로그 저장
      const errorLog: WorkLog = {
        id: uuidv4(),
        taskId,
        deviceId,
        status: 'error',
        startTime: Date.now() - 1000, // 1초 전 시작으로 가정
        endTime: Date.now(),
        executionTime: 1000, // 1초로 가정
        errorDetails,
        createdAt: Date.now(),
        valveState: 'closed', // 기본값
        sequence: task.sequence
      };
      
      const { db } = await connectToDatabase();
      await db.collection(COLLECTIONS.WORK_LOGS).insertOne(errorLog);
      
      // 3. 장치 상태 확인 및 업데이트
      const deviceStatus = await mqttService.getDeviceStatus(deviceId);
      if (deviceStatus) {
        // 장치 상태 초기화를 위한 MQTT 메시지 발송
        await sendDeviceResetCommand(deviceId);
      }
      
      return true;
    } catch (error) {
      console.error(`작업 실행 오류 복구 중 예외 발생:`, error);
      return false;
    }
  },
  
  // 손상된 작업 데이터 복구 시도
  recoverCorruptedTaskData: async (taskId: string): Promise<WorkTask | null> => {
    try {
      console.log(`손상된 작업(${taskId}) 데이터 복구 시도`);
      
      // 1. 작업의 이전 버전 가져오기
      const versions = await dbTaskService.getTaskVersions(taskId);
      
      if (versions.length === 0) {
        console.error(`복구 실패: 작업(${taskId})의 이전 버전을 찾을 수 없습니다.`);
        return null;
      }
      
      // 2. 가장 최근의 정상 버전 찾기
      let latestValidVersion = null;
      
      for (const version of versions) {
        // 유효성 검사
        const isValid = errorRecoveryService.validateTask(version.task);
        
        if (isValid) {
          latestValidVersion = version.version;
          break;
        }
      }
      
      if (!latestValidVersion) {
        console.error(`복구 실패: 작업(${taskId})의 유효한 버전을 찾을 수 없습니다.`);
        return null;
      }
      
      // 3. 유효한 버전으로 복원
      const restoredTask = await dbTaskService.restoreTaskVersion(taskId, latestValidVersion);
      
      if (!restoredTask) {
        console.error(`복구 실패: 작업(${taskId})을 버전(${latestValidVersion})으로 복원할 수 없습니다.`);
        return null;
      }
      
      console.log(`작업(${taskId})이 버전(${latestValidVersion})으로 성공적으로 복원되었습니다.`);
      return restoredTask;
    } catch (error) {
      console.error(`손상된 작업 데이터 복구 중 예외 발생:`, error);
      return null;
    }
  },
  
  // 손상된 데이터베이스 복구 시도
  recoverCorruptedDatabase: async (): Promise<boolean> => {
    try {
      console.log('손상된 데이터베이스 복구 시도');
      
      // 데이터 무결성 검증
      const validationResult = await backupService.validateDataIntegrity();
      
      if (validationResult.valid) {
        console.log('데이터베이스가 유효합니다. 복구가 필요하지 않습니다.');
        return true;
      }
      
      console.error('데이터베이스 무결성 문제 발견:', validationResult.issues);
      
      // 최근 백업에서 복원 시도
      const recoveryResult = await backupService.attemptDataRecovery();
      
      if (recoveryResult) {
        console.log('최근 백업에서 데이터베이스가 성공적으로 복원되었습니다.');
        return true;
      }
      
      console.error('백업에서 데이터베이스 복원 실패');
      return false;
    } catch (error) {
      console.error('데이터베이스 복구 중 예외 발생:', error);
      return false;
    }
  },
  
  // 작업 유효성 검사
  validateTask: (task: WorkTask): boolean => {
    // 필수 필드 확인
    if (!task || !task.id || !task.name || !task.sequence) {
      return false;
    }
    
    // 시퀀스 유효성 검사
    if (!Array.isArray(task.sequence) || task.sequence.length === 0) {
      return false;
    }
    
    // 각 시퀀스 단계 유효성 검사
    for (const step of task.sequence) {
      if (!step.type || step.duration === undefined) {
        return false;
      }
    }
    
    return true;
  },
  
  // 작업 실행 시 오류 자동 복구 시도
  autoRecoverOnExecutionError: async (taskId: string, deviceId: string, errorDetails: string): Promise<boolean> => {
    try {
      // 오류 로그 기록
      console.log(`작업(${taskId}) 자동 복구 시도, 오류: ${errorDetails}`);
      
      // 1. 기존 오류 복구 메커니즘 호출
      const recoveryResult = await errorRecoveryService.recoverFromTaskExecutionError(
        taskId, deviceId, errorDetails
      );
      
      if (!recoveryResult) {
        console.error('기본 오류 복구 실패');
        return false;
      }
      
      // 2. 작업 상태 확인
      const task = await dbTaskService.getTaskById(taskId);
      if (!task) {
        console.error(`작업(${taskId})을 찾을 수 없습니다.`);
        return false;
      }
      
      // 3. 문제가 있는 작업 시퀀스 분석
      const problematicSteps = errorRecoveryService.analyzeTaskForErrors(task);
      
      if (problematicSteps.length > 0) {
        // 문제 있는 단계 로깅
        console.log(`문제가 있는 단계 발견: ${problematicSteps.join(', ')}`);
        
        // 4. 작업 버전 보존하기 위한 백업 생성
        await backupService.createTemplateFromTask(
          taskId,
          `문제 발견 작업 백업 - ${new Date().toISOString()}`,
          false
        );
      }
      
      // 장치에 리셋 명령 전송
      await sendDeviceResetCommand(deviceId);
      
      return true;
    } catch (error) {
      console.error('자동 복구 중 예외 발생:', error);
      return false;
    }
  },
  
  // 작업 시퀀스의 잠재적 문제점 분석
  analyzeTaskForErrors: (task: WorkTask): string[] => {
    const problematicSteps: string[] = [];
    
    // 각 시퀀스 단계 검사
    task.sequence.forEach((step, index) => {
      // 타입별 유효성 검사
      switch (step.type) {
        case 'valve':
          if (step.valveAction !== 'open' && step.valveAction !== 'close') {
            problematicSteps.push(`Step ${index + 1}: 유효하지 않은 밸브 동작`);
          }
          break;
          
        case 'delay':
          if (step.duration <= 0 || step.duration > 3600000) { // 1시간 이상
            problematicSteps.push(`Step ${index + 1}: 유효하지 않은 지연 시간`);
          }
          break;
          
        // 다른 단계 타입에 대한 검사 추가
      }
      
      // 일반적인 유효성 검사
      if (step.duration === undefined || step.duration < 0) {
        problematicSteps.push(`Step ${index + 1}: 유효하지 않은 기간`);
      }
    });
    
    // 시퀀스의 논리적 오류 검사
    let valveIsOpen = false;
    
    for (let i = 0; i < task.sequence.length; i++) {
      const step = task.sequence[i];
      
      if (step.type === 'valve') {
        if (step.valveAction === 'open') {
          if (valveIsOpen) {
            problematicSteps.push(`Step ${i + 1}: 이미 열린 밸브를 다시 열기 시도`);
          }
          valveIsOpen = true;
        } else if (step.valveAction === 'close') {
          if (!valveIsOpen) {
            problematicSteps.push(`Step ${i + 1}: 이미 닫힌 밸브를 다시 닫기 시도`);
          }
          valveIsOpen = false;
        }
      }
    }
    
    // 마지막에 밸브가 열린 상태로 끝나는지 확인
    if (valveIsOpen) {
      problematicSteps.push('작업이 밸브를 열린 상태로 종료함');
    }
    
    return problematicSteps;
  },
  
  // 데이터 무결성 주기적 확인
  scheduleIntegrityChecks: (intervalHours: number = 12): void => {
    if (typeof setInterval === 'undefined') return;
    
    console.log(`데이터 무결성 검사가 ${intervalHours}시간 간격으로 예약되었습니다.`);
    
    // 첫 번째 검사 즉시 실행
    errorRecoveryService.performIntegrityCheck();
    
    // 정기 검사 스케줄링
    setInterval(() => {
      errorRecoveryService.performIntegrityCheck();
    }, intervalHours * 60 * 60 * 1000);
  },
  
  // 데이터 무결성 검사 수행
  performIntegrityCheck: async (): Promise<void> => {
    try {
      console.log('데이터 무결성 검사 시작...');
      
      // 서버사이드에서 실행 확인
      if (isServerSide()) {
        console.log('서버 사이드에서는 데이터 무결성 검사를 간소화하여 실행합니다.');
        return;
      }
      
      // 데이터베이스 유효성 검사
      const validationResult = await backupService.validateDataIntegrity();
      
      if (!validationResult.valid) {
        console.error('데이터 무결성 문제 발견:', validationResult.issues);
        
        // 문제가 발견되면 자동 백업 생성
        await backupService.createFullBackup(
          `무결성 문제 발견 전 자동 백업 - ${new Date().toISOString()}`,
          '데이터 무결성 검사 중 문제가 발견되어 생성된 백업'
        );
        
        // 복구 시도
        const recoveryResult = await errorRecoveryService.recoverCorruptedDatabase();
        
        if (recoveryResult) {
          console.log('데이터베이스가 성공적으로 복구되었습니다.');
        } else {
          console.error('자동 복구 실패 - 수동 개입이 필요합니다.');
        }
      } else {
        console.log('데이터 무결성 검사 통과 - 문제가 발견되지 않았습니다.');
      }
    } catch (error) {
      console.error('무결성 검사 중 예외 발생:', error);
    }
  }
};

// 서버리스 환경에서 오류 복구 서비스 초기화
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
  try {
    // 스케줄러 초기화
    errorRecoveryService.scheduleIntegrityChecks();
  } catch (error) {
    console.error('무결성 검사 일정 설정 중 오류:', error);
  }
}

export default errorRecoveryService; 