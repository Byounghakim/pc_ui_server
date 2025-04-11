import { connectToDatabase, COLLECTIONS } from '../lib/db-connect';
import { v4 as uuidv4 } from 'uuid';
import dbTaskService from './db-task-service';
import { WorkTask, SequenceStep } from '../types';

// 백업 인터페이스
interface BackupData {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  data: {
    tasks: WorkTask[];
    templates?: TaskTemplate[];
    settings?: any;
  };
  version: string;
  size: number;
}

// 템플릿 인터페이스
export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  sequence: SequenceStep[];
  tags?: string[];
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  usageCount: number;
}

// 백업 서비스
const backupService = {
  // 전체 시스템 백업 생성
  createFullBackup: async (name: string, description?: string): Promise<BackupData> => {
    try {
      const { db } = await connectToDatabase();
      
      // 모든 작업 가져오기
      const tasks = await dbTaskService.getAllTasks();
      
      // 모든 템플릿 가져오기
      const templates = await db.collection(COLLECTIONS.TEMPLATES)
        .find({})
        .toArray() as TaskTemplate[];
      
      // 설정 데이터 가져오기
      const settingsDoc = await db.collection(COLLECTIONS.SETTINGS)
        .findOne({ id: 'system-settings' });
      const settings = settingsDoc || { id: 'system-settings', createdAt: Date.now() };
      
      // 백업 데이터 생성
      const backupData: BackupData = {
        id: uuidv4(),
        name,
        description,
        createdAt: Date.now(),
        data: {
          tasks,
          templates,
          settings
        },
        version: '1.0',
        size: JSON.stringify(tasks).length + JSON.stringify(templates).length + JSON.stringify(settings).length
      };
      
      // 백업 저장
      await db.collection(COLLECTIONS.BACKUPS).insertOne(backupData);
      
      console.log(`백업이 생성되었습니다: ${backupData.id}, 데이터 크기: ${backupData.size} 바이트`);
      return backupData;
    } catch (error) {
      console.error('백업 생성 중 오류:', error);
      throw error;
    }
  },
  
  // 정기 백업 스케줄링 (서버 시작 시 호출)
  scheduleBackups: async (intervalHours: number = 24): Promise<void> => {
    try {
      if (typeof setInterval === 'undefined') return;
      
      const backupName = `자동 백업 - ${new Date().toISOString().split('T')[0]}`;
      console.log(`정기 백업 일정이 ${intervalHours}시간 간격으로 설정되었습니다.`);
      
      // 첫 번째 백업 즉시 실행
      await backupService.createFullBackup(backupName, '자동 생성된 정기 백업');
      
      // 정기 백업 스케줄링
      setInterval(async () => {
        const currentDate = new Date().toISOString().split('T')[0];
        const newBackupName = `자동 백업 - ${currentDate}`;
        
        try {
          await backupService.createFullBackup(newBackupName, '자동 생성된 정기 백업');
          
          // 오래된 백업 정리 (최근 7개만 유지)
          await backupService.cleanupOldBackups(7);
        } catch (error) {
          console.error('정기 백업 중 오류:', error);
        }
      }, intervalHours * 60 * 60 * 1000);
    } catch (error) {
      console.error('백업 스케줄링 중 오류:', error);
    }
  },
  
  // 백업 목록 조회
  getBackups: async (limit: number = 20): Promise<BackupData[]> => {
    try {
      const { db } = await connectToDatabase();
      
      const backups = await db.collection(COLLECTIONS.BACKUPS)
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray() as BackupData[];
      
      return backups;
    } catch (error) {
      console.error('백업 목록 조회 중 오류:', error);
      throw error;
    }
  },
  
  // 특정 백업 조회
  getBackupById: async (backupId: string): Promise<BackupData | null> => {
    try {
      const { db } = await connectToDatabase();
      
      const backup = await db.collection(COLLECTIONS.BACKUPS)
        .findOne({ id: backupId }) as BackupData | null;
      
      return backup;
    } catch (error) {
      console.error(`백업(${backupId}) 조회 중 오류:`, error);
      throw error;
    }
  },
  
  // 백업에서 복원
  restoreFromBackup: async (backupId: string): Promise<boolean> => {
    try {
      // 백업 데이터 가져오기
      const backup = await backupService.getBackupById(backupId);
      if (!backup) {
        console.error(`복원 실패: 백업(${backupId})을 찾을 수 없습니다.`);
        return false;
      }
      
      const { db } = await connectToDatabase();
      
      // 복원 전 현재 상태 백업 (안전장치)
      const preRestoreBackupName = `복원 전 자동 백업 - ${new Date().toISOString()}`;
      await backupService.createFullBackup(preRestoreBackupName, '복원 작업 전 자동 생성된 백업');
      
      // 복원 작업 시작 - 트랜잭션 사용 (MongoDB 4.0 이상 필요)
      const session = db.client.startSession();
      
      try {
        await session.withTransaction(async () => {
          // 1. 작업 복원
          if (backup.data.tasks && backup.data.tasks.length > 0) {
            // 기존 작업 삭제
            await db.collection(COLLECTIONS.TASKS).deleteMany({}, { session });
            
            // 백업 작업 삽입
            await db.collection(COLLECTIONS.TASKS).insertMany(backup.data.tasks, { session });
          }
          
          // 2. 템플릿 복원
          if (backup.data.templates && backup.data.templates.length > 0) {
            // 기존 템플릿 삭제
            await db.collection(COLLECTIONS.TEMPLATES).deleteMany({}, { session });
            
            // 백업 템플릿 삽입
            await db.collection(COLLECTIONS.TEMPLATES).insertMany(backup.data.templates, { session });
          }
          
          // 3. 설정 복원
          if (backup.data.settings) {
            await db.collection(COLLECTIONS.SETTINGS).updateOne(
              { id: 'system-settings' },
              { $set: backup.data.settings },
              { upsert: true, session }
            );
          }
        });
        
        console.log(`백업(${backupId})에서 성공적으로 복원되었습니다.`);
        return true;
      } catch (error) {
        console.error('트랜잭션 중 오류:', error);
        return false;
      } finally {
        await session.endSession();
      }
    } catch (error) {
      console.error(`백업(${backupId})에서 복원 중 오류:`, error);
      return false;
    }
  },
  
  // 오래된 백업 정리
  cleanupOldBackups: async (keepCount: number = 10): Promise<boolean> => {
    try {
      const { db } = await connectToDatabase();
      
      // 보존할 최신 백업 ID 목록 가져오기
      const recentBackups = await db.collection(COLLECTIONS.BACKUPS)
        .find({})
        .sort({ createdAt: -1 })
        .limit(keepCount)
        .project({ id: 1 })
        .toArray();
      
      const recentBackupIds = recentBackups.map(b => b.id);
      
      // 오래된 백업 삭제
      const result = await db.collection(COLLECTIONS.BACKUPS).deleteMany({
        id: { $nin: recentBackupIds }
      });
      
      console.log(`${result.deletedCount}개의 오래된 백업이 정리되었습니다.`);
      return true;
    } catch (error) {
      console.error('백업 정리 중 오류:', error);
      return false;
    }
  },
  
  // 백업 내보내기 (JSON 형식)
  exportBackupToJson: async (backupId: string): Promise<string> => {
    try {
      const backup = await backupService.getBackupById(backupId);
      if (!backup) {
        throw new Error(`백업(${backupId})을 찾을 수 없습니다.`);
      }
      
      return JSON.stringify(backup, null, 2);
    } catch (error) {
      console.error(`백업(${backupId}) 내보내기 중 오류:`, error);
      throw error;
    }
  },
  
  // 백업 가져오기 (JSON 형식)
  importBackupFromJson: async (jsonData: string): Promise<string> => {
    try {
      const backup = JSON.parse(jsonData) as BackupData;
      
      // ID와 생성 시간 업데이트
      backup.id = uuidv4();
      backup.createdAt = Date.now();
      backup.name = `가져온 백업 - ${new Date().toISOString().split('T')[0]}`;
      
      const { db } = await connectToDatabase();
      await db.collection(COLLECTIONS.BACKUPS).insertOne(backup);
      
      console.log(`백업이 가져와졌습니다: ${backup.id}`);
      return backup.id;
    } catch (error) {
      console.error('백업 가져오기 중 오류:', error);
      throw error;
    }
  },
  
  // 작업 템플릿 생성
  createTaskTemplate: async (template: Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>): Promise<TaskTemplate> => {
    try {
      const { db } = await connectToDatabase();
      
      // 새 템플릿 생성
      const now = Date.now();
      const newTemplate: TaskTemplate = {
        ...template,
        id: uuidv4(),
        createdAt: now,
        updatedAt: now,
        usageCount: 0
      };
      
      // 데이터베이스에 저장
      await db.collection(COLLECTIONS.TEMPLATES).insertOne(newTemplate);
      
      return newTemplate;
    } catch (error) {
      console.error('템플릿 생성 중 오류:', error);
      throw error;
    }
  },
  
  // 템플릿으로부터 작업 생성
  createTaskFromTemplate: async (templateId: string, customName?: string): Promise<WorkTask | null> => {
    try {
      const { db } = await connectToDatabase();
      
      // 템플릿 조회
      const template = await db.collection(COLLECTIONS.TEMPLATES).findOne({ id: templateId }) as TaskTemplate | null;
      if (!template) {
        console.error(`템플릿(${templateId})을 찾을 수 없습니다.`);
        return null;
      }
      
      // 템플릿 사용 횟수 증가
      await db.collection(COLLECTIONS.TEMPLATES).updateOne(
        { id: templateId },
        { $inc: { usageCount: 1 }, $set: { updatedAt: Date.now() } }
      );
      
      // 새 작업 생성
      const task = dbTaskService.createTask(
        customName || `${template.name} 복사본`,
        template.sequence,
        template.description
      );
      
      // 작업 저장
      const savedTask = await dbTaskService.saveTask(task);
      
      return savedTask;
    } catch (error) {
      console.error(`템플릿(${templateId})으로부터 작업 생성 중 오류:`, error);
      throw error;
    }
  },
  
  // 모든 템플릿 조회
  getAllTemplates: async (includePrivate: boolean = false, createdBy?: string): Promise<TaskTemplate[]> => {
    try {
      const { db } = await connectToDatabase();
      
      // 필터 생성
      const filter: any = {};
      if (!includePrivate) {
        filter.isPublic = true;
      }
      if (createdBy) {
        filter.createdBy = createdBy;
      }
      
      // 템플릿 조회
      const templates = await db.collection(COLLECTIONS.TEMPLATES)
        .find(filter)
        .sort({ updatedAt: -1 })
        .toArray() as TaskTemplate[];
      
      return templates;
    } catch (error) {
      console.error('템플릿 목록 조회 중 오류:', error);
      throw error;
    }
  },
  
  // 템플릿 공유 상태 변경
  setTemplatePublic: async (templateId: string, isPublic: boolean): Promise<boolean> => {
    try {
      const { db } = await connectToDatabase();
      
      // 템플릿 업데이트
      const result = await db.collection(COLLECTIONS.TEMPLATES).updateOne(
        { id: templateId },
        { $set: { isPublic, updatedAt: Date.now() } }
      );
      
      return result.modifiedCount === 1;
    } catch (error) {
      console.error(`템플릿(${templateId}) 공유 상태 변경 중 오류:`, error);
      throw error;
    }
  },
  
  // 작업에서 템플릿 생성
  createTemplateFromTask: async (taskId: string, templateName: string, isPublic: boolean = false, createdBy?: string): Promise<TaskTemplate | null> => {
    try {
      // 작업 조회
      const task = await dbTaskService.getTaskById(taskId);
      if (!task) {
        console.error(`작업(${taskId})을 찾을 수 없습니다.`);
        return null;
      }
      
      // 템플릿 생성
      const template: Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'> = {
        name: templateName,
        description: task.description,
        sequence: task.sequence,
        isPublic,
        createdBy
      };
      
      // 템플릿 저장
      return await backupService.createTaskTemplate(template);
    } catch (error) {
      console.error(`작업(${taskId})에서 템플릿 생성 중 오류:`, error);
      throw error;
    }
  },
  
  // 데이터 무결성 검증
  validateDataIntegrity: async (): Promise<{ valid: boolean; issues: string[] }> => {
    try {
      const { db } = await connectToDatabase();
      const issues: string[] = [];
      
      // 1. 작업 검증
      const tasks = await dbTaskService.getAllTasks();
      for (const task of tasks) {
        if (!task.id || !task.name || !task.sequence) {
          issues.push(`작업 ID ${task.id || '알 수 없음'}: 필수 필드 누락`);
        }
        
        // 시퀀스 단계 검증
        if (task.sequence && Array.isArray(task.sequence)) {
          task.sequence.forEach((step, index) => {
            if (!step.type || step.duration === undefined) {
              issues.push(`작업 ID ${task.id}: 시퀀스 단계 ${index}에 필수 필드 누락`);
            }
          });
        } else {
          issues.push(`작업 ID ${task.id}: 유효하지 않은 시퀀스 형식`);
        }
      }
      
      // 2. 템플릿 검증
      const templates = await db.collection(COLLECTIONS.TEMPLATES).find({}).toArray() as TaskTemplate[];
      for (const template of templates) {
        if (!template.id || !template.name || !template.sequence) {
          issues.push(`템플릿 ID ${template.id || '알 수 없음'}: 필수 필드 누락`);
        }
      }
      
      // 검증 결과 반환
      return {
        valid: issues.length === 0,
        issues
      };
    } catch (error) {
      console.error('데이터 무결성 검증 중 오류:', error);
      return {
        valid: false,
        issues: [`검증 중 오류 발생: ${error}`]
      };
    }
  },
  
  // 데이터 복구 시도
  attemptDataRecovery: async (): Promise<boolean> => {
    try {
      // 가장 최근의 백업 조회
      const backups = await backupService.getBackups(1);
      if (backups.length === 0) {
        console.error('복구를 위한 백업을 찾을 수 없습니다.');
        return false;
      }
      
      // 최근 백업에서 복원
      const latestBackup = backups[0];
      await backupService.restoreFromBackup(latestBackup.id);
      
      console.log(`최근 백업(${latestBackup.id})에서 데이터를 복구했습니다.`);
      return true;
    } catch (error) {
      console.error('데이터 복구 시도 중 오류:', error);
      return false;
    }
  }
};

// 서버리스 환경에서 백업 초기화
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
  backupService.scheduleBackups()
    .catch(error => console.error('백업 스케줄링 중 오류:', error));
}

export default backupService; 