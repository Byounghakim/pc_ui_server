import { MQTT_TOPICS, MQTT_SERVER_CONFIG } from '../../lib/mqtt-topics';
import dbTaskService from './db-task-service';
import { broadcastMessage } from '../api/sync/route';
import { v4 as uuidv4 } from 'uuid';
import { WorkTask, WorkLog } from '../types';
import { connectToDatabase, COLLECTIONS } from '../lib/local-db-connect';
import localStateManager from '../../lib/local-state-manager';
import MqttClient from '../../lib/mqtt-client';

// MQTT 서버 설정
const MQTT_CONFIG = {
  server: typeof process !== 'undefined' && process.env.NODE_ENV === 'development' 
    ? process.env.NEXT_PUBLIC_MQTT_DEV_URL || 'ws://192.168.0.26:8080'
    : process.env.NEXT_PUBLIC_MQTT_PROD_URL || 'ws://203.234.35.54:8080',
  username: process.env.NEXT_PUBLIC_MQTT_USERNAME || 'dnature',
  password: process.env.NEXT_PUBLIC_MQTT_PASSWORD || '8210'
};

// MqttClient 인스턴스 생성
const mqttClient = new MqttClient();

// 작업 실행 상태 인터페이스
interface TaskExecutionStatus {
  taskId: string;
  deviceId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  startTime?: number;
  endTime?: number;
  progress?: number;
  errorMessage?: string;
  executionId: string;
}

// 장치 상태 인터페이스
interface DeviceStatus {
  deviceId: string;
  status: 'online' | 'offline' | 'busy' | 'idle' | 'error';
  lastSeen: number;
  currentTaskId?: string;
  batteryLevel?: number;
  networkStrength?: number;
  ipAddress?: string;
  error?: string;
}

// MQTT 서비스 초기화 및 메시지 처리
class MqttService {
  private taskExecutions: Map<string, TaskExecutionStatus> = new Map();
  private deviceStatuses: Map<string, DeviceStatus> = new Map();
  private initialized: boolean = false;
  
  constructor() {
    this.init();
  }
  
  // MQTT 서비스 초기화
  init(): void {
    if (this.initialized) return;
    
    try {
      // 서버 사이드에서는 MQTT 연결 시도하지 않음
      if (typeof window === 'undefined') {
        console.log('서버 사이드에서는 MQTT 서비스를 초기화하지 않습니다.');
        return;
      }
      
      // 로컬 상태 관리자는 자동으로 초기화되므로 별도 초기화가 필요 없음
      console.log('로컬 상태 관리자 사용 준비됨');
      
      // MQTT 클라이언트가 연결되지 않았으면 연결
      if (mqttClient && typeof mqttClient.isConnected === 'function' && !mqttClient.isConnected()) {
        mqttClient.connect(MQTT_CONFIG.server, MQTT_CONFIG.username, MQTT_CONFIG.password);
      }
      
      // 장치 상태 메시지 구독
      mqttClient.subscribe(MQTT_TOPICS.DEVICE_STATUS);
      mqttClient.on('message', (topic: string, message: Buffer) => {
        if (topic === MQTT_TOPICS.DEVICE_STATUS) {
          this.handleDeviceStatusMessage(topic, message).catch(err => {
            console.error('장치 상태 메시지 처리 오류:', err);
          });
        }
      });
      
      // 에러 메시지 구독
      mqttClient.subscribe(MQTT_TOPICS.ERROR_TOPIC);
      mqttClient.on('message', (topic: string, message: Buffer) => {
        if (topic === MQTT_TOPICS.ERROR_TOPIC) {
          this.handleErrorMessage(topic, message).catch(err => {
            console.error('에러 메시지 처리 오류:', err);
          });
        }
      });
      
      // 밸브 상태 메시지 구독
      mqttClient.subscribe(MQTT_TOPICS.VALVE_STATE_TOPIC);
      mqttClient.on('message', (topic: string, message: Buffer) => {
        if (topic === MQTT_TOPICS.VALVE_STATE_TOPIC) {
          this.handleValveStateMessage(topic, message).catch(err => {
            console.error('밸브 상태 메시지 처리 오류:', err);
          });
        }
      });
      
      // 펌프 상태 메시지 구독 (인버터 1-6)
      for (let i = 1; i <= 6; i++) {
        const pumpStateTopic = MQTT_TOPICS.getPumpStateTopic(i);
        mqttClient.subscribe(pumpStateTopic);
        mqttClient.on('message', (topic: string, message: Buffer) => {
          if (topic === pumpStateTopic) {
            this.handlePumpStateMessage(i, topic, message).catch(err => {
              console.error(`펌프 ${i} 상태 메시지 처리 오류:`, err);
            });
          }
        });
      }
      
      this.initialized = true;
      console.log('MQTT 서비스가 초기화되었습니다.');
    } catch (error) {
      console.error('MQTT 서비스 초기화 오류:', error);
    }
  }
  
  // 밸브 상태 메시지 처리
  private async handleValveStateMessage(topic: string, message: Buffer): Promise<void> {
    try {
      const messageStr = message.toString();
      console.log('밸브 상태 메시지 수신:', messageStr);
      
      // 로컬 상태 관리자에 밸브 상태 저장
      await localStateManager.saveValveState(messageStr);
      
      // 클라이언트에 실시간 상태 알림
      await broadcastMessage('valve', {
        action: 'state_update',
        state: messageStr,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('밸브 상태 메시지 처리 오류:', error);
    }
  }
  
  // 펌프 상태 메시지 처리
  private async handlePumpStateMessage(pumpId: number, topic: string, message: Buffer): Promise<void> {
    try {
      const messageStr = message.toString();
      console.log(`펌프 ${pumpId} 상태 메시지 수신:`, messageStr);
      
      // 로컬 상태 관리자에 펌프 상태 저장
      await localStateManager.savePumpState(pumpId, messageStr);
      
      // 클라이언트에 실시간 상태 알림
      await broadcastMessage('pump', {
        action: 'state_update',
        pumpId,
        state: messageStr,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`펌프 ${pumpId} 상태 메시지 처리 오류:`, error);
    }
  }
  
  // 장치 상태 메시지 처리
  private handleDeviceStatusMessage = async (topic: string, message: Buffer): Promise<void> => {
    try {
      const payload = JSON.parse(message.toString());
      console.log('MQTT 장치 상태 메시지 수신:', payload);
      
      if (!payload.deviceId) {
        console.warn('유효하지 않은 장치 상태 메시지:', payload);
        return;
      }
      
      // 장치 상태 업데이트
      const deviceStatus: DeviceStatus = {
        deviceId: payload.deviceId,
        status: payload.status || 'online',
        lastSeen: Date.now(),
        currentTaskId: payload.currentTaskId,
        batteryLevel: payload.batteryLevel,
        networkStrength: payload.networkStrength,
        ipAddress: payload.ipAddress,
        error: payload.error
      };
      
      // 상태 맵에 저장
      this.deviceStatuses.set(payload.deviceId, deviceStatus);
      
      // 데이터베이스에 장치 상태 저장
      this.saveDeviceStatus(deviceStatus);
      
      // 클라이언트에 실시간 장치 상태 알림
      await broadcastMessage('device', {
        action: 'status_update',
        deviceStatus,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('MQTT 장치 상태 메시지 처리 오류:', error);
    }
  }
  
  // 에러 메시지 처리
  private handleErrorMessage = async (topic: string, message: Buffer): Promise<void> => {
    try {
      const payload = JSON.parse(message.toString());
      console.error('MQTT 에러 메시지 수신:', payload);
      
      if (!payload.deviceId) {
        console.warn('유효하지 않은 에러 메시지:', payload);
        return;
      }
      
      // 장치 상태 업데이트
      const deviceStatus = this.deviceStatuses.get(payload.deviceId) || {
        deviceId: payload.deviceId,
        status: 'error',
        lastSeen: Date.now()
      };
      
      deviceStatus.status = 'error';
      deviceStatus.error = payload.message;
      deviceStatus.lastSeen = Date.now();
      
      this.deviceStatuses.set(payload.deviceId, deviceStatus);
      
      // 관련 작업 상태 업데이트
      if (payload.taskId) {
        // 해당 taskId와 deviceId로 실행 중인 작업 찾기
        for (const [executionId, execution] of this.taskExecutions.entries()) {
          if (execution.taskId === payload.taskId && execution.deviceId === payload.deviceId && execution.status === 'running') {
            execution.status = 'failed';
            execution.endTime = Date.now();
            execution.errorMessage = payload.message;
            
            // 작업 로그 저장
            await this.saveWorkLog(execution);
            
            // 클라이언트에 실시간 상태 알림
            await broadcastMessage('task', {
              action: 'execution_status',
              taskExecution: execution,
              timestamp: Date.now()
            });
            
            break;
          }
        }
      }
      
      // 클라이언트에 실시간 장치 상태 알림
      await broadcastMessage('device', {
        action: 'status_update',
        deviceStatus,
        timestamp: Date.now()
      });
      
      // 에러 이벤트 브로드캐스트
      await broadcastMessage('error', {
        action: 'device_error',
        deviceId: payload.deviceId,
        taskId: payload.taskId,
        message: payload.message,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('MQTT 에러 메시지 처리 오류:', error);
    }
  }
  
  // 작업 로그 저장
  private async saveWorkLog(execution: TaskExecutionStatus): Promise<void> {
    try {
      const { db } = await connectToDatabase();
      
      // 작업 정보 가져오기
      const task = await dbTaskService.getTaskById(execution.taskId);
      if (!task) {
        console.warn(`작업 로그 저장 실패: 작업(${execution.taskId})을 찾을 수 없습니다.`);
        return;
      }
      
      // 작업 로그 생성
      const workLog: WorkLog = {
        id: uuidv4(),
        taskId: execution.taskId,
        deviceId: execution.deviceId,
        status: execution.status === 'completed' ? 'completed' : 
               execution.status === 'failed' ? 'error' : 'aborted',
        startTime: execution.startTime || Date.now(),
        endTime: execution.endTime || Date.now(),
        executionTime: execution.endTime && execution.startTime ? 
                      execution.endTime - execution.startTime : undefined,
        sequence: task.sequence,
        errorDetails: execution.errorMessage,
        createdAt: Date.now(),
        valveState: 'closed' // 기본값
      };
      
      // 데이터베이스에 저장
      await db.collection(COLLECTIONS.WORK_LOGS).insertOne(workLog);
      
      // 클라이언트에 작업 로그 생성 알림
      await broadcastMessage('workLog', {
        action: 'created',
        workLog,
        timestamp: Date.now()
      });
      
      console.log(`작업 로그가 저장되었습니다: ${workLog.id}`);
    } catch (error) {
      console.error('작업 로그 저장 중 오류:', error);
    }
  }
  
  // 장치 상태 저장
  private async saveDeviceStatus(deviceStatus: DeviceStatus): Promise<void> {
    try {
      const { db } = await connectToDatabase();
      
      // 데이터베이스에 저장 또는 업데이트
      await db.collection(COLLECTIONS.DEVICES).updateOne(
        { deviceId: deviceStatus.deviceId },
        { 
          $set: {
            ...deviceStatus,
            updatedAt: Date.now()
          }
        },
        { upsert: true }
      );
      
    } catch (error) {
      console.error('장치 상태 저장 중 오류:', error);
    }
  }
  
  // 장치 목록 가져오기
  async getDevices(): Promise<DeviceStatus[]> {
    try {
      const { db } = await connectToDatabase();
      
      // 데이터베이스에서 장치 목록 조회
      const devices = await db.collection(COLLECTIONS.DEVICES)
        .find({})
        .sort({ lastSeen: -1 })
        .toArray();
      
      // 최신 메모리 상태로 업데이트
      return devices.map(device => {
        const memoryStatus = this.deviceStatuses.get(device.deviceId);
        if (memoryStatus) {
          return { ...device, ...memoryStatus };
        }
        return device;
      }) as DeviceStatus[];
    } catch (error) {
      console.error('장치 목록 조회 중 오류:', error);
      // 메모리에 있는 상태만 반환
      return Array.from(this.deviceStatuses.values());
    }
  }
  
  // 특정 장치 상태 가져오기
  async getDeviceStatus(deviceId: string): Promise<DeviceStatus | null> {
    // 메모리에서 먼저 확인
    const memoryStatus = this.deviceStatuses.get(deviceId);
    if (memoryStatus) {
      return memoryStatus;
    }
    
    try {
      const { db } = await connectToDatabase();
      
      // 데이터베이스에서 조회
      const device = await db.collection(COLLECTIONS.DEVICES).findOne({ deviceId });
      
      return device as DeviceStatus | null;
    } catch (error) {
      console.error(`장치(${deviceId}) 상태 조회 중 오류:`, error);
      return null;
    }
  }
  
  // 작업 실행 명령 전송
  async executeTask(taskId: string, deviceId: string): Promise<boolean> {
    try {
      // 작업 정보 가져오기
      const task = await dbTaskService.getTaskById(taskId);
      if (!task) {
        console.error(`작업 실행 실패: 작업(${taskId})을 찾을 수 없습니다.`);
        return false;
      }
      
      // 장치 상태 확인
      const deviceStatus = await this.getDeviceStatus(deviceId);
      if (!deviceStatus || deviceStatus.status === 'offline') {
        console.error(`작업 실행 실패: 장치(${deviceId})가 오프라인 상태입니다.`);
        return false;
      }
      
      if (deviceStatus.status === 'busy') {
        console.error(`작업 실행 실패: 장치(${deviceId})가 다른 작업을 실행 중입니다.`);
        return false;
      }
      
      // 실행 ID 생성
      const executionId = uuidv4();
      
      // 작업 실행 상태 초기화
      const taskExecution: TaskExecutionStatus = {
        taskId,
        deviceId,
        status: 'running',
        startTime: Date.now(),
        executionId
      };
      
      this.taskExecutions.set(executionId, taskExecution);
      
      // 장치 상태 업데이트
      const updatedDeviceStatus: DeviceStatus = {
        ...deviceStatus,
        status: 'busy',
        currentTaskId: taskId,
        lastSeen: Date.now()
      };
      
      this.deviceStatuses.set(deviceId, updatedDeviceStatus);
      
      // 장치 상태 저장
      await this.saveDeviceStatus(updatedDeviceStatus);
      
      // 클라이언트에 실시간 상태 알림
      await broadcastMessage('task', {
        action: 'execution_started',
        taskExecution,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error(`작업(${taskId}) 실행 명령 전송 중 오류:`, error);
      return false;
    }
  }
  
  // 작업 실행 중단 명령 전송
  async stopTaskExecution(taskId: string, deviceId: string): Promise<boolean> {
    try {
      // 실행 중인 작업 찾기
      let executionToStop: TaskExecutionStatus | undefined;
      let executionId: string | undefined;
      
      for (const [id, execution] of this.taskExecutions.entries()) {
        if (execution.taskId === taskId && 
            execution.deviceId === deviceId && 
            execution.status === 'running') {
          executionToStop = execution;
          executionId = id;
          break;
        }
      }
      
      if (!executionToStop || !executionId) {
        console.error(`작업 중단 실패: 실행 중인 작업(${taskId})을 찾을 수 없습니다.`);
        return false;
      }
      
      // 작업 실행 상태 업데이트
      executionToStop.status = 'aborted';
      executionToStop.endTime = Date.now();
      this.taskExecutions.set(executionId, executionToStop);
      
      // 작업 로그 저장
      await this.saveWorkLog(executionToStop);
      
      // 장치 상태 업데이트
      const deviceStatus = this.deviceStatuses.get(deviceId);
      if (deviceStatus) {
        deviceStatus.status = 'idle';
        deviceStatus.currentTaskId = undefined;
        deviceStatus.lastSeen = Date.now();
        
        this.deviceStatuses.set(deviceId, deviceStatus);
        
        // 장치 상태 저장
        await this.saveDeviceStatus(deviceStatus);
      }
      
      // 클라이언트에 실시간 상태 알림
      await broadcastMessage('task', {
        action: 'execution_stopped',
        taskExecution: executionToStop,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error(`작업(${taskId}) 중단 명령 전송 중 오류:`, error);
      return false;
    }
  }
  
  // 현재 실행 중인 작업 목록 가져오기
  getRunningTasks(): TaskExecutionStatus[] {
    return Array.from(this.taskExecutions.values())
      .filter(execution => execution.status === 'running');
  }
  
  // 특정 장치의 실행 중인 작업 가져오기
  getDeviceRunningTask(deviceId: string): TaskExecutionStatus | null {
    for (const execution of this.taskExecutions.values()) {
      if (execution.deviceId === deviceId && execution.status === 'running') {
        return execution;
      }
    }
    return null;
  }
  
  // 서비스 종료 시 정리
  cleanup(): void {
    // 연결 종료
    if (mqttClient && typeof mqttClient.disconnect === 'function') {
      mqttClient.disconnect();
    }
    
    this.initialized = false;
    console.log('MQTT 서비스가 정리되었습니다.');
  }
}

// 싱글톤 인스턴스
const mqttService = new MqttService();
export default mqttService; 