import { v4 as uuidv4 } from 'uuid';
import { 
  connectToDatabase, 
  COLLECTIONS 
} from '../lib/db-connect';
import { WorkTask, SequenceStep } from '../types';

// 작업 데이터베이스 서비스
const dbTaskService = {
  // 모든 작업 목록 조회
  getAllTasks: async (): Promise<WorkTask[]> => {
    try {
      const { db } = await connectToDatabase();
      const tasks = await db.collection(COLLECTIONS.TASKS)
        .find({})
        .sort({ updatedAt: -1 })
        .toArray();
      
      return tasks as WorkTask[];
    } catch (error) {
      console.error('작업 목록 조회 중 오류:', error);
      throw error;
    }
  },
  
  // 특정 작업 조회
  getTaskById: async (id: string): Promise<WorkTask | null> => {
    try {
      const { db } = await connectToDatabase();
      const task = await db.collection(COLLECTIONS.TASKS).findOne({ id });
      
      return task as WorkTask | null;
    } catch (error) {
      console.error(`작업(${id}) 조회 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업 저장 (생성 또는 업데이트)
  saveTask: async (task: WorkTask): Promise<WorkTask> => {
    try {
      const { db } = await connectToDatabase();
      
      // ID가 없는 경우 새 ID 할당
      if (!task.id) {
        task.id = uuidv4();
        task.createdAt = Date.now();
      }
      
      // 업데이트 시간 갱신
      task.updatedAt = Date.now();
      
      // 기존 작업이 있는지 확인
      const existingTask = await dbTaskService.getTaskById(task.id);
      
      if (existingTask) {
        // 기존 작업 업데이트
        await db.collection(COLLECTIONS.TASKS).updateOne(
          { id: task.id },
          { $set: task }
        );
      } else {
        // 새 작업 생성
        await db.collection(COLLECTIONS.TASKS).insertOne(task);
      }
      
      // 작업 버전 저장
      await dbTaskService.saveTaskVersion(task);
      
      return task;
    } catch (error) {
      console.error('작업 저장 중 오류:', error);
      throw error;
    }
  },
  
  // 작업 삭제
  deleteTask: async (id: string): Promise<boolean> => {
    try {
      const { db } = await connectToDatabase();
      
      // 삭제 전 작업 가져오기 (존재 확인)
      const task = await dbTaskService.getTaskById(id);
      if (!task) {
        return false;
      }
      
      // 작업 삭제
      const result = await db.collection(COLLECTIONS.TASKS).deleteOne({ id });
      
      return result.deletedCount === 1;
    } catch (error) {
      console.error(`작업(${id}) 삭제 중 오류:`, error);
      throw error;
    }
  },
  
  // 모든 작업 삭제
  clearAllTasks: async (): Promise<boolean> => {
    try {
      const { db } = await connectToDatabase();
      const result = await db.collection(COLLECTIONS.TASKS).deleteMany({});
      
      return result.acknowledged;
    } catch (error) {
      console.error('모든 작업 삭제 중 오류:', error);
      throw error;
    }
  },
  
  // 특정 장치의 작업 목록 조회
  getTasksByDeviceId: async (deviceId: string): Promise<WorkTask[]> => {
    try {
      const { db } = await connectToDatabase();
      const tasks = await db.collection(COLLECTIONS.TASKS)
        .find({ assignedDevices: deviceId })
        .sort({ updatedAt: -1 })
        .toArray();
      
      return tasks as WorkTask[];
    } catch (error) {
      console.error(`장치(${deviceId})의 작업 목록 조회 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업을 장치에 할당
  assignTaskToDevice: async (taskId: string, deviceId: string): Promise<boolean> => {
    try {
      const { db } = await connectToDatabase();
      
      // 작업이 존재하는지 확인
      const task = await dbTaskService.getTaskById(taskId);
      if (!task) {
        return false;
      }
      
      // 할당된 장치 목록 업데이트
      const result = await db.collection(COLLECTIONS.TASKS).updateOne(
        { id: taskId },
        { 
          $addToSet: { assignedDevices: deviceId },
          $set: { updatedAt: Date.now() }
        }
      );
      
      return result.modifiedCount === 1;
    } catch (error) {
      console.error(`작업(${taskId})을 장치(${deviceId})에 할당 중 오류:`, error);
      throw error;
    }
  },
  
  // 장치에서 작업 할당 해제
  removeTaskFromDevice: async (taskId: string, deviceId: string): Promise<boolean> => {
    try {
      const { db } = await connectToDatabase();
      
      // 작업이 존재하는지 확인
      const task = await dbTaskService.getTaskById(taskId);
      if (!task) {
        return false;
      }
      
      // 할당된 장치 목록에서 제거
      const result = await db.collection(COLLECTIONS.TASKS).updateOne(
        { id: taskId },
        { 
          $pull: { assignedDevices: deviceId },
          $set: { updatedAt: Date.now() }
        }
      );
      
      return result.modifiedCount === 1;
    } catch (error) {
      console.error(`작업(${taskId})을 장치(${deviceId})에서 제거 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업 버전 저장
  saveTaskVersion: async (task: WorkTask): Promise<boolean> => {
    try {
      if (!task || !task.id) {
        return false;
      }
      
      const { db } = await connectToDatabase();
      const versionTimestamp = Date.now().toString();
      
      // 작업의 현재 버전 저장
      await db.collection(COLLECTIONS.TASK_VERSIONS).insertOne({
        taskId: task.id,
        version: versionTimestamp,
        task: { ...task },
        createdAt: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error(`작업(${task?.id}) 버전 저장 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업의 모든 버전 조회
  getTaskVersions: async (taskId: string): Promise<{ version: string, task: WorkTask }[]> => {
    try {
      const { db } = await connectToDatabase();
      
      const versions = await db.collection(COLLECTIONS.TASK_VERSIONS)
        .find({ taskId })
        .sort({ createdAt: -1 })
        .toArray();
      
      return versions.map(v => ({
        version: v.version,
        task: v.task
      }));
    } catch (error) {
      console.error(`작업(${taskId}) 버전 목록 조회 중 오류:`, error);
      throw error;
    }
  },
  
  // 특정 버전의 작업 복원
  restoreTaskVersion: async (taskId: string, version: string): Promise<WorkTask | null> => {
    try {
      const { db } = await connectToDatabase();
      
      // 해당 버전 조회
      const versionDoc = await db.collection(COLLECTIONS.TASK_VERSIONS).findOne({
        taskId,
        version
      });
      
      if (!versionDoc) {
        return null;
      }
      
      // 복원할 작업
      const restoredTask: WorkTask = {
        ...versionDoc.task,
        updatedAt: Date.now()
      };
      
      // 작업 업데이트
      await db.collection(COLLECTIONS.TASKS).updateOne(
        { id: taskId },
        { $set: restoredTask },
        { upsert: true }
      );
      
      // 복원 버전 기록
      await dbTaskService.saveTaskVersion(restoredTask);
      
      return restoredTask;
    } catch (error) {
      console.error(`작업(${taskId}) 버전(${version}) 복원 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업 충돌 해결
  resolveConflict: async (taskId: string, selectedVersion: string): Promise<boolean> => {
    try {
      // 선택한 버전으로 복원
      const result = await dbTaskService.restoreTaskVersion(taskId, selectedVersion);
      return !!result;
    } catch (error) {
      console.error(`작업(${taskId}) 충돌 해결 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업 페이징 조회
  getTasksPaginated: async (page: number = 1, limit: number = 10): Promise<{
    tasks: WorkTask[],
    totalCount: number,
    totalPages: number,
    currentPage: number
  }> => {
    try {
      const { db } = await connectToDatabase();
      
      // 전체 작업 수 계산
      const totalCount = await db.collection(COLLECTIONS.TASKS).countDocuments();
      const totalPages = Math.ceil(totalCount / limit);
      
      // 페이지 계산
      const skip = (page - 1) * limit;
      
      // 작업 조회
      const tasks = await db.collection(COLLECTIONS.TASKS)
        .find({})
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      return {
        tasks: tasks as WorkTask[],
        totalCount,
        totalPages,
        currentPage: page
      };
    } catch (error) {
      console.error('작업 페이징 조회 중 오류:', error);
      throw error;
    }
  },
  
  // 작업 검색
  searchTasks: async (
    query: string, 
    page: number = 1, 
    limit: number = 10
  ): Promise<{
    tasks: WorkTask[],
    totalCount: number,
    totalPages: number,
    currentPage: number
  }> => {
    try {
      const { db } = await connectToDatabase();
      
      // 검색 조건 생성
      const searchFilter = {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      };
      
      // 전체 검색 결과 수 계산
      const totalCount = await db.collection(COLLECTIONS.TASKS).countDocuments(searchFilter);
      const totalPages = Math.ceil(totalCount / limit);
      
      // 페이지 계산
      const skip = (page - 1) * limit;
      
      // 작업 검색
      const tasks = await db.collection(COLLECTIONS.TASKS)
        .find(searchFilter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      return {
        tasks: tasks as WorkTask[],
        totalCount,
        totalPages,
        currentPage: page
      };
    } catch (error) {
      console.error('작업 검색 중 오류:', error);
      throw error;
    }
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
  }
};

export default dbTaskService; 