/**
 * 로컬 스토리지 기반 상태 관리자
 * 
 * 이 파일은 Redis와 유사한 인터페이스를 제공하지만 실제로는 로컬 스토리지를 사용합니다.
 * PC용 독립 실행을 위해 서버 의존성 없이 작동합니다.
 */

import { v4 as uuidv4 } from 'uuid';

// 로컬 스토리지 키 접두사
const LOCAL_STORAGE_PREFIX = 'local_state_';

// 로컬 스토리지 헬퍼 함수
const saveToLocalStorage = (key: string, data: any) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, JSON.stringify(data));
    } catch (error) {
      console.error(`로컬 스토리지 저장 오류 (${key}):`, error);
    }
  }
};

const loadFromLocalStorage = (key: string) => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`로컬 스토리지 로드 오류 (${key}):`, error);
      return null;
    }
  }
  return null;
};

// 싱글톤 인스턴스
let instance: LocalStateManager | null = null;

// 상태 관리자 클래스
class LocalStateManager {
  private tasks: Map<string, any> = new Map();
  private states: Map<string, any> = new Map();
  private eventHandlers: Map<string, Set<Function>> = new Map();
  
  constructor() {
    // 이벤트 핸들러 초기화
    this.eventHandlers.set('stateChange', new Set());
    this.eventHandlers.set('taskChange', new Set());
    
    // 데이터 로드
    this.loadData();
    
    // 페이지 언로드 시 데이터 저장
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.saveData();
      });
      
      // 주기적으로 데이터 저장 (1분마다)
      setInterval(() => this.saveData(), 60000);
    }
    
    console.log('로컬 상태 관리자 초기화 완료');
  }
  
  // 싱글톤 인스턴스 가져오기
  public static getInstance(): LocalStateManager {
    if (!instance) {
      instance = new LocalStateManager();
    }
    return instance;
  }
  
  // 데이터 로드
  private loadData() {
    try {
      // 작업 데이터 로드
      const tasksData = loadFromLocalStorage('tasks');
      if (tasksData && Array.isArray(tasksData)) {
        tasksData.forEach(task => {
          if (task && task.id) {
            this.tasks.set(task.id, task);
          }
        });
      }
      
      // 상태 데이터 로드
      const statesData = loadFromLocalStorage('states');
      if (statesData && typeof statesData === 'object') {
        Object.entries(statesData).forEach(([key, value]) => {
          this.states.set(key, value);
        });
      }
      
      console.log(`로컬 데이터 로드 완료: ${this.tasks.size}개 작업, ${this.states.size}개 상태`);
    } catch (error) {
      console.error('데이터 로드 오류:', error);
    }
  }
  
  // 데이터 저장
  private saveData() {
    try {
      // 작업 데이터 저장
      const tasksArray = Array.from(this.tasks.values());
      saveToLocalStorage('tasks', tasksArray);
      
      // 상태 데이터 저장
      const statesObj: Record<string, any> = {};
      this.states.forEach((value, key) => {
        statesObj[key] = value;
      });
      saveToLocalStorage('states', statesObj);
      
      console.log('로컬 데이터 저장 완료');
    } catch (error) {
      console.error('데이터 저장 오류:', error);
    }
  }
  
  // 이벤트 리스너 등록
  on(event: string, callback: Function) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)?.add(callback);
    }
    return this;
  }
  
  // 이벤트 리스너 제거
  off(event: string, callback: Function) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)?.delete(callback);
    }
    return this;
  }
  
  // 이벤트 발생
  private emit(event: string, ...args: any[]) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)?.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`이벤트 핸들러 오류 (${event}):`, error);
        }
      });
    }
  }
  
  // 작업 생성/업데이트
  async saveTask(task: any): Promise<string> {
    // ID가 없는 경우 생성
    if (!task.id) {
      task.id = uuidv4();
      task.createdAt = Date.now();
    }
    
    // 업데이트 시간 설정
    task.updatedAt = Date.now();
    
    // 작업 저장
    this.tasks.set(task.id, task);
    this.saveData();
    
    // 이벤트 발생
    this.emit('taskChange', task);
    
    return task.id;
  }
  
  // 작업 삭제
  async deleteTask(taskId: string): Promise<boolean> {
    const result = this.tasks.delete(taskId);
    if (result) {
      this.saveData();
      this.emit('taskChange', { id: taskId, deleted: true });
    }
    return result;
  }
  
  // 작업 조회
  async getTask(taskId: string): Promise<any | null> {
    return this.tasks.get(taskId) || null;
  }
  
  // 작업 목록 조회
  async listTasks(status?: string, limit: number = 100): Promise<any[]> {
    let tasks = Array.from(this.tasks.values());
    
    // 상태 필터링
    if (status) {
      tasks = tasks.filter(task => task.status === status);
    }
    
    // 최신순 정렬
    tasks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    
    // 결과 제한
    return tasks.slice(0, limit);
  }
  
  // 상태 저장
  async setState(key: string, value: any): Promise<void> {
    const previousValue = this.states.get(key);
    this.states.set(key, value);
    this.saveData();
    
    // 값이 변경된 경우에만 이벤트 발생
    if (JSON.stringify(previousValue) !== JSON.stringify(value)) {
      this.emit('stateChange', { key, value, previousValue });
    }
  }
  
  // 상태 조회
  async getState(key: string): Promise<any | null> {
    return this.states.get(key) || null;
  }
  
  // 상태 삭제
  async deleteState(key: string): Promise<boolean> {
    const result = this.states.delete(key);
    if (result) {
      this.saveData();
      this.emit('stateChange', { key, deleted: true });
    }
    return result;
  }
  
  // 밸브 상태 저장 (특별 처리)
  async saveValveState(valveState: any): Promise<void> {
    console.log(`[LocalStateManager] 밸브 상태 저장: ${JSON.stringify(valveState)}`);
    
    // valveState가 문자열이 아닌 경우 처리
    let normalizedState = valveState;
    
    // 객체인 경우 문자열(state 속성)로 변환
    if (typeof valveState === 'object' && valveState !== null && valveState.state) {
      normalizedState = valveState.state;
    }
    
    // 숫자인 경우 문자열로 변환
    if (typeof normalizedState === 'number') {
      normalizedState = normalizedState.toString();
    }
    
    // '0'/'1' 형식인 경우 4자리로 패딩
    if (typeof normalizedState === 'string' && /^[01]+$/.test(normalizedState)) {
      // 길이가 4자리보다 짧으면 오른쪽에 0 패딩
      while (normalizedState.length < 4) {
        normalizedState += '0';
      }
      // 길이가 4자리보다 길면 좌측 4자리만 사용
      if (normalizedState.length > 4) {
        normalizedState = normalizedState.slice(0, 4);
      }
    }
    
    // 추가 정보가 있는 경우 함께 저장
    if (typeof valveState === 'object' && valveState !== null) {
      if (valveState.description) {
        await this.setState('valveDescription', valveState.description);
      }
      
      // valveState 객체 그대로도 저장
      await this.setState('valveStateObject', valveState);
    }
    
    // 기본 valveState 문자열 저장
    await this.setState('valveState', normalizedState);
    
    // system:state에도 밸브 상태 업데이트
    const systemState = await this.getState('system:state') || {};
    systemState.valve = {
      state: normalizedState,
      description: await this.getState('valveDescription') || { valveA: "", valveB: "" }
    };
    await this.setState('system:state', systemState);
    
    console.log(`[LocalStateManager] 저장된 밸브 상태: ${normalizedState}`);
  }
  
  // 밸브 상태 조회 (특별 처리)
  async getValveState(): Promise<any | null> {
    const valveState = await this.getState('valveState');
    const valveStateObject = await this.getState('valveStateObject');
    const valveDescription = await this.getState('valveDescription');
    
    // 상세 정보가 있으면 객체로 반환
    if (valveStateObject || valveDescription) {
      return {
        state: valveState,
        description: valveDescription || { valveA: "", valveB: "" },
        ...valveStateObject
      };
    }
    
    // 기본 상태 문자열 반환
    return valveState;
  }
  
  // 펌프 상태 저장 (특별 처리)
  async savePumpState(pumpId: number | string, state: any): Promise<void> {
    const pumpStates = await this.getState('pumpStates') || {};
    
    // 스트링으로 변환 (두 가지 형식 지원)
    let normalizedState = state;
    if (state === 0 || state === "0") normalizedState = "OFF";
    if (state === 1 || state === "1") normalizedState = "ON";
    
    pumpStates[pumpId] = normalizedState;
    await this.setState('pumpStates', pumpStates);
    
    // 탱크 시스템 펌프 상태도 업데이트
    try {
      const systemState = await this.getState('system:state') || {};
      if (!systemState.tanks) {
        systemState.tanks = [];
        for (let i = 1; i <= 6; i++) {
          systemState.tanks.push({
            id: i,
            level: 0,
            status: "empty",
            pumpStatus: "OFF",
            inverter: i
          });
        }
      }
      
      // 펌프 ID에 해당하는 탱크 찾기
      const tankIndex = Array.isArray(systemState.tanks) ? 
        systemState.tanks.findIndex((tank: any) => tank.id === Number(pumpId)) : -1;
      
      if (tankIndex >= 0) {
        // 탱크 펌프 상태 업데이트
        systemState.tanks[tankIndex].pumpStatus = normalizedState;
        await this.setState('system:state', systemState);
        console.log(`탱크 ${pumpId}의 펌프 상태 업데이트: ${normalizedState}`);
      }
      
      // pumps 객체도 업데이트
      if (!systemState.pumps) {
        systemState.pumps = {};
      }
      systemState.pumps[`pump${pumpId}`] = normalizedState;
      await this.setState('system:state', systemState);
      
    } catch (error) {
      console.error(`탱크 시스템 펌프 상태 업데이트 오류:`, error);
    }
  }
  
  // 펌프 상태 조회 (특별 처리)
  async getPumpState(pumpId: number | string): Promise<any | null> {
    const pumpStates = await this.getState('pumpStates') || {};
    return pumpStates[pumpId] || null;
  }
  
  // 모든 펌프 상태 조회
  async getAllPumpStates(): Promise<Record<string, any>> {
    return await this.getState('pumpStates') || {};
  }
  
  // 모든 항목 필터로 검색
  async findItems(pattern: string): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    
    // 정규식 패턴 생성
    const regex = new RegExp(pattern.replace('*', '.*'));
    
    // 상태 데이터 검색
    this.states.forEach((value, key) => {
      if (regex.test(key)) {
        result[key] = value;
      }
    });
    
    return result;
  }
  
  // 디버그용 - 모든 데이터 출력
  async dumpData(): Promise<{ tasks: any[], states: Record<string, any> }> {
    return {
      tasks: Array.from(this.tasks.values()),
      states: Object.fromEntries(this.states.entries())
    };
  }
  
  // 데이터 정리 (오래된 데이터 삭제)
  async cleanupOldData(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let removedCount = 0;
    
    // 오래된 작업 삭제
    this.tasks.forEach((task, id) => {
      if (task.updatedAt && now - task.updatedAt > maxAgeMs) {
        this.tasks.delete(id);
        removedCount++;
      }
    });
    
    if (removedCount > 0) {
      this.saveData();
      console.log(`${removedCount}개의 오래된 데이터 정리 완료`);
    }
    
    return removedCount;
  }
}

// 기본 내보내기
const localStateManager = LocalStateManager.getInstance();

export default localStateManager; 