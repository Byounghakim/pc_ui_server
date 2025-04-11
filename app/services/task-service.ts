import { WorkTask, SequenceStep } from '../types';
import { v4 as uuidv4 } from 'uuid';
import * as apiService from './api';
import dbService from './db-service';
import syncService from './sync-service';

const TASKS_STORAGE_KEY = 'tank-system-work-tasks';
const TASK_VERSIONS_KEY = 'tank-system-task-versions:';

// 로컬 스토리지 상태 저장 래퍼 함수
const saveToLocalStorage = (tasks: WorkTask[]): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    console.log('작업 목록이 로컬 스토리지에 저장됨:', tasks.length);
  }
};

// 로컬 스토리지에서 상태 복구 래퍼 함수
const loadFromLocalStorage = (): WorkTask[] => {
  if (typeof window !== 'undefined') {
    const savedTasks = localStorage.getItem(TASKS_STORAGE_KEY);
    if (savedTasks) {
      try {
        return JSON.parse(savedTasks);
      } catch (e) {
        console.error('로컬 스토리지 작업 목록 파싱 오류:', e);
      }
    }
  }
  return [];
};

// 중복 ID 제거 유틸리티 함수
const removeDuplicateTasks = (tasks: WorkTask[]): WorkTask[] => {
  const uniqueMap = new Map<string, WorkTask>();
  
  tasks.forEach(task => {
    // ID가 없는 경우 새 ID 할당
    if (!task.id) {
      task.id = uuidv4();
    }
    
    const existingTask = uniqueMap.get(task.id);
    if (!existingTask) {
      uniqueMap.set(task.id, task);
    } else {
      // 더 최신 버전인 경우에만 교체
      if (task.updatedAt > existingTask.updatedAt) {
        uniqueMap.set(task.id, task);
      }
    }
  });
  
  return Array.from(uniqueMap.values());
};

// 작업 목록 관리 서비스
const taskService = {
  // 작업 목록 저장
  saveTask: async (task: WorkTask): Promise<boolean> => {
    try {
      // 생성/업데이트 시간 설정
      if (!task.createdAt) {
        task.createdAt = Date.now();
      }
      task.updatedAt = Date.now();
      
      // 서버에 저장 시도
      let serverSaved = false;
      try {
        // 서버 API로 저장 시도 (클라이언트 측에서 사용 가능)
        await apiService.saveTaskToServer(task);
        serverSaved = true;
        
        // 실시간 동기화 - 다른 클라이언트에 변경 알림
        await syncService.publish('task', {
          action: 'save',
          task,
          clientId: localStorage.getItem('sync_client_id')
        });
      } catch (serverError) {
        console.warn('서버에 작업 저장 실패. 로컬에만 저장됩니다.', serverError);
      }
      
      // 로컬 스토리지에 저장
      const tasks = await taskService.getAllTasks();
      const existingIndex = tasks.findIndex(t => t.id === task.id);
      
      if (existingIndex >= 0) {
        tasks[existingIndex] = task;
      } else {
        tasks.push(task);
      }
      
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
      
      return serverSaved;
    } catch (error) {
      console.error('작업 저장 중 오류:', error);
      return false;
    }
  },
  
  // 모든 작업 목록 조회
  getAllTasks: async (): Promise<WorkTask[]> => {
    try {
      // 서버에서 조회 시도
      try {
        // 서버 API에서 불러오기 시도 (클라이언트 측에서 사용 가능)
        const apiTasks = await apiService.loadTasksFromServer();
        if (apiTasks && apiTasks.length > 0) {
          // 로컬 저장소에 동기화
          localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(apiTasks));
          return apiTasks;
        }
      } catch (serverError) {
        console.warn('서버에서 작업 불러오기 실패. 로컬 저장소를 사용합니다.', serverError);
      }
      
      // 로컬 저장소에서 불러오기
      return loadFromLocalStorage();
    } catch (error) {
      console.error('작업 불러오기 중 오류:', error);
      return [];
    }
  },
  
  // 특정 작업 조회
  getTaskById: async (id: string): Promise<WorkTask | null> => {
    try {
      // 서버에서 조회 시도
      try {
        const serverTask = await dbService.getTaskById(id);
        if (serverTask) {
          return serverTask;
        }
      } catch (serverError) {
        console.warn(`서버에서 작업(${id}) 불러오기 실패.`, serverError);
      }
      
      // 로컬 저장소에서 불러오기
      const tasks = taskService.getAllTasks();
      return tasks.find(task => task.id === id) || null;
    } catch (error) {
      console.error(`작업(${id}) 불러오기 중 오류:`, error);
      return null;
    }
  },
  
  // 작업 삭제
  deleteTask: async (taskId: string): Promise<boolean> => {
    try {
      // 서버에서 삭제 시도
      let serverDeleted = false;
      try {
        // 서버 API에서 삭제 시도
        await apiService.deleteTaskFromServer(taskId);
        serverDeleted = true;
        
        // 실시간 동기화 - 다른 클라이언트에 삭제 알림
        await syncService.publish('task', {
          action: 'delete',
          taskId,
          clientId: localStorage.getItem('sync_client_id')
        });
      } catch (serverError) {
        console.warn(`서버에서 작업(${taskId}) 삭제 실패.`, serverError);
      }
      
      // 로컬 저장소에서 삭제
      const tasks = await taskService.getAllTasks();
      const updatedTasks = tasks.filter(task => task.id !== taskId);
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updatedTasks));
      
      return serverDeleted;
    } catch (error) {
      console.error(`작업(${taskId}) 삭제 중 오류:`, error);
      return false;
    }
  },
  
  // 작업 업데이트
  updateTask: async (id: string, updates: Partial<WorkTask>): Promise<WorkTask | null> => {
    try {
      // 현재 작업 조회
      const currentTask = await taskService.getTaskById(id);
      if (!currentTask) {
        console.error(`작업(ID: ${id})이 존재하지 않아 업데이트할 수 없습니다.`);
        return null;
      }
      
      // 업데이트 적용
      const updatedTask: WorkTask = {
        ...currentTask,
        ...updates,
        updatedAt: Date.now() // 항상 업데이트 시간 갱신
      };
      
      // 저장
      return await taskService.saveTask(updatedTask);
    } catch (error) {
      console.error('작업 업데이트 중 오류:', error);
      return null;
    }
  },
  
  // 작업 목록 비우기
  clearAllTasks: async (): Promise<boolean> => {
    try {
      // 서버에서 삭제 시도
      let serverCleared = false;
      try {
        // 서버 API에서 모든 작업 삭제 시도
        await apiService.clearTasksFromServer();
        serverCleared = true;
        
        // 실시간 동기화 - 다른 클라이언트에 모든 작업 삭제 알림
        await syncService.publish('task', {
          action: 'clear_all',
          clientId: localStorage.getItem('sync_client_id')
        });
      } catch (serverError) {
        console.warn('서버에서 모든 작업 삭제 실패.', serverError);
      }
      
      // 로컬 저장소에서 삭제
      localStorage.removeItem(TASKS_STORAGE_KEY);
      
      return serverCleared;
    } catch (error) {
      console.error('모든 작업 삭제 중 오류:', error);
      return false;
    }
  },
  
  // 작업 활성화/비활성화
  toggleTaskActive: async (id: string, isActive: boolean): Promise<WorkTask | null> => {
    return taskService.updateTask(id, { isActive });
  },
  
  // 작업 생성 헬퍼 함수
  createTask: (name: string, sequence: SequenceStep[], description?: string): WorkTask => {
    const now = Date.now();
    
    return {
      id: uuidv4(),
      name,
      description,
      sequence,
      createdAt: now,
      updatedAt: now,
      isActive: true
    };
  },
  
  // 작업의 버전 기록 저장
  saveTaskVersion: async (task: WorkTask): Promise<boolean> => {
    try {
      if (!task || !task.id) return false;
      
      const versionKey = `${TASK_VERSIONS_KEY}${task.id}`;
      const versionTimestamp = Date.now().toString();
      
      // 현재 버전 기록 불러오기
      const versionsJson = localStorage.getItem(versionKey);
      let versions: Record<string, WorkTask> = {};
      
      if (versionsJson) {
        try {
          versions = JSON.parse(versionsJson);
        } catch (e) {
          console.error('작업 버전 기록 파싱 오류:', e);
        }
      }
      
      // 새 버전 추가
      versions[versionTimestamp] = { ...task };
      
      // 버전 기록 저장
      localStorage.setItem(versionKey, JSON.stringify(versions));
      
      // 서버에도 버전 저장 시도
      try {
        await apiService.saveTaskVersionToServer(task.id, versionTimestamp, task);
      } catch (error) {
        console.warn('서버에 작업 버전 저장 실패, 로컬 스토리지에만 저장됨');
      }
      
      return true;
    } catch (error) {
      console.error('작업 버전 저장 중 오류:', error);
      return false;
    }
  },
  
  // 작업의 버전 기록 불러오기
  getTaskVersions: async (taskId: string): Promise<{version: string, task: WorkTask}[]> => {
    try {
      // 서버에서 불러오기 시도
      const serverVersions = await apiService.getTaskVersionsFromServer(taskId);
      
      if (serverVersions && serverVersions.length > 0) {
        // 로컬 스토리지에도 백업
        const versionKey = `${TASK_VERSIONS_KEY}${taskId}`;
        const versionsObj: Record<string, WorkTask> = {};
        
        serverVersions.forEach(v => {
          versionsObj[v.version] = v.task;
        });
        
        localStorage.setItem(versionKey, JSON.stringify(versionsObj));
        
        return serverVersions;
      }
    } catch (error) {
      console.error('서버에서 작업 버전 불러오기 중 오류:', error);
    }
    
    // 로컬 스토리지에서 불러오기
    const versionKey = `${TASK_VERSIONS_KEY}${taskId}`;
    const versionsJson = localStorage.getItem(versionKey);
    
    if (!versionsJson) return [];
    
    try {
      const versions = JSON.parse(versionsJson) as Record<string, WorkTask>;
      
      return Object.entries(versions).map(([version, task]) => ({
        version,
        task
      })).sort((a, b) => Number(b.version) - Number(a.version)); // 최신 버전 순으로 정렬
    } catch (error) {
      console.error('작업 버전 기록 파싱 오류:', error);
      return [];
    }
  },
  
  // 특정 버전의 작업 복원
  restoreTaskVersion: async (taskId: string, versionTimestamp: string): Promise<WorkTask | null> => {
    try {
      // 현재 작업 상태를 백업
      const currentTask = await taskService.getTaskById(taskId);
      if (currentTask) {
        await taskService.saveTaskVersion(currentTask);
      }
      
      // 서버에서 복원 시도
      const restoredTask = await apiService.restoreTaskVersionFromServer(taskId, versionTimestamp);
      
      if (restoredTask) {
        // 복원 성공, 로컬에 저장
        await taskService.saveTask(restoredTask);
        return restoredTask;
      }
      
      // 서버 복원 실패, 로컬에서 시도
      const versions = await taskService.getTaskVersions(taskId);
      const targetVersion = versions.find(v => v.version === versionTimestamp);
      
      if (!targetVersion) {
        return null;
      }
      
      // 복원된 작업의 updatedAt 업데이트
      const restored: WorkTask = {
        ...targetVersion.task,
        updatedAt: Date.now()
      };
      
      // 로컬 저장
      await taskService.saveTask(restored);
      
      return restored;
    } catch (error) {
      console.error('작업 버전 복원 중 오류:', error);
      return null;
    }
  },
  
  // 장치별 작업 가져오기
  getTasksByDeviceId: async (deviceId: string): Promise<WorkTask[]> => {
    try {
      // 서버에서 불러오기 시도
      try {
        // 서버 API에서 장치별 작업 불러오기 시도
        const deviceTasks = await apiService.getDeviceTasksFromServer(deviceId);
        if (deviceTasks && deviceTasks.length > 0) {
          return deviceTasks;
        }
      } catch (serverError) {
        console.warn(`서버에서 장치(${deviceId}) 작업 불러오기 실패.`, serverError);
      }
      
      // 로컬 저장소에서 불러오기는 장치별로 구현하기 어려우므로
      // 모든 작업 중 해당 장치에 할당된 작업 필터링
      const allTasks = await taskService.getAllTasks();
      return allTasks.filter(task => task.assignedDevices?.includes(deviceId));
    } catch (error) {
      console.error(`장치(${deviceId}) 작업 불러오기 중 오류:`, error);
      return [];
    }
  },
  
  // 작업의 동시 편집 여부 확인
  isTaskBeingEdited: async (taskId: string): Promise<boolean> => {
    try {
      // 서버에서 작업의 편집 상태 확인
      const response = await fetch(`/api/tasks/${taskId}/editing-status`);
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.isBeingEdited || false;
    } catch (error) {
      console.error(`작업(${taskId})의 편집 상태 확인 중 오류:`, error);
      return false;
    }
  },
  
  // 작업 편집 시작 알림
  notifyTaskEditingStarted: async (taskId: string): Promise<boolean> => {
    try {
      // 서버에 작업 편집 시작 알림
      await fetch(`/api/tasks/${taskId}/editing-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          isEditing: true,
          clientId: localStorage.getItem('sync_client_id')
        })
      });
      
      // 실시간 동기화 - 다른 클라이언트에 편집 시작 알림
      await syncService.publish('task', {
        action: 'editing_started',
        taskId,
        clientId: localStorage.getItem('sync_client_id')
      });
      
      return true;
    } catch (error) {
      console.error(`작업(${taskId})의 편집 시작 알림 중 오류:`, error);
      return false;
    }
  },
  
  // 작업 편집 종료 알림
  notifyTaskEditingEnded: async (taskId: string): Promise<boolean> => {
    try {
      // 서버에 작업 편집 종료 알림
      await fetch(`/api/tasks/${taskId}/editing-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          isEditing: false,
          clientId: localStorage.getItem('sync_client_id')
        })
      });
      
      // 실시간 동기화 - 다른 클라이언트에 편집 종료 알림
      await syncService.publish('task', {
        action: 'editing_ended',
        taskId,
        clientId: localStorage.getItem('sync_client_id')
      });
      
      return true;
    } catch (error) {
      console.error(`작업(${taskId})의 편집 종료 알림 중 오류:`, error);
      return false;
    }
  }
};

// 동기화 이벤트 리스너 초기화
if (typeof window !== 'undefined') {
  // 페이지 로드 시 동기화 서비스 연결
  window.addEventListener('load', () => {
    syncService.connect();
    
    // 오프라인 메시지 처리 시도
    syncService.processOfflineMessages();
  });
  
  // 작업 변경 이벤트 리스너
  syncService.on('task', async (data) => {
    // 자신이 보낸 메시지는 무시
    if (data.clientId === localStorage.getItem('sync_client_id')) {
      return;
    }
    
    try {
      switch (data.action) {
        case 'save':
          // 다른 클라이언트가 저장한 작업 업데이트
          const tasks = await taskService.getAllTasks();
          const existingIndex = tasks.findIndex(t => t.id === data.task.id);
          
          if (existingIndex >= 0) {
            // 로컬의 변경 사항이 서버의 변경보다 최신인 경우 충돌 가능성
            const localTask = tasks[existingIndex];
            if (localTask.updatedAt > data.task.updatedAt) {
              // 충돌 감지 - 로컬 변경이 더 최신
              syncService.publish('conflict', {
                taskId: data.task.id,
                localVersion: localTask,
                remoteVersion: data.task
              });
              return;
            }
            
            tasks[existingIndex] = data.task;
          } else {
            tasks.push(data.task);
          }
          
          localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
          console.log(`다른 클라이언트에서 작업이 업데이트됨: ${data.task.id}`);
          break;
          
        case 'delete':
          // 다른 클라이언트가 삭제한 작업 제거
          const currentTasks = await taskService.getAllTasks();
          const updatedTasks = currentTasks.filter(task => task.id !== data.taskId);
          localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updatedTasks));
          console.log(`다른 클라이언트에서 작업이 삭제됨: ${data.taskId}`);
          break;
          
        case 'clear_all':
          // 다른 클라이언트가 모든 작업 삭제
          localStorage.removeItem(TASKS_STORAGE_KEY);
          console.log('다른 클라이언트에서 모든 작업이 삭제됨');
          break;
          
        case 'editing_started':
          // 다른 클라이언트가 작업 편집 시작
          console.log(`다른 클라이언트에서 작업(${data.taskId}) 편집 시작`);
          // UI에 편집 중 표시 등의 처리 가능
          break;
          
        case 'editing_ended':
          // 다른 클라이언트가 작업 편집 종료
          console.log(`다른 클라이언트에서 작업(${data.taskId}) 편집 종료`);
          // UI에 편집 종료 표시 등의 처리 가능
          break;
      }
      
      // 이벤트 발생 - UI 업데이트를 위한 이벤트 발생
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('task-sync-update', { detail: data }));
      }
    } catch (error) {
      console.error('작업 동기화 이벤트 처리 중 오류:', error);
    }
  });
  
  // 충돌 이벤트 리스너
  syncService.on('conflict', (data) => {
    console.warn('작업 충돌 감지:', data);
    // UI에 충돌 해결 대화상자 표시 등의 처리 가능
  });
}

export default taskService; 