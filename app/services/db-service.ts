import { WorkTask } from '../types';

// 로컬 스토리지 데이터 저장/로드 헬퍼 함수
const saveToLocalStorage = (key: string, data: any) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error(`로컬 스토리지 저장 오류 (${key}):`, error);
    }
  }
};

const loadFromLocalStorage = (key: string) => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`로컬 스토리지 로드 오류 (${key}):`, error);
      return null;
    }
  }
  return null;
};

// Vercel KV 또는 MongoDB 사용을 위한 인터페이스
interface KVStore {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  delete: (key: string) => Promise<void>;
  hget: (hash: string, key: string) => Promise<any>;
  hset: (hash: string, key: string, value: any) => Promise<void>;
  hdel: (hash: string, key: string) => Promise<void>;
  hgetall: (hash: string) => Promise<Record<string, any>>;
}

// 로컬 스토리지 기반 KV 스토어 (PC 용)
class LocalKVStore implements KVStore {
  // 싱글톤 패턴을 위한 인스턴스
  private static instance: LocalKVStore;
  
  // 인메모리 저장소
  private storage: Map<string, any> = new Map();
  private hashStorage: Map<string, Map<string, any>> = new Map();
  
  // 로컬 스토리지 키
  private LOCAL_STORAGE_KEY = 'localdb_keyvalues';
  private LOCAL_STORAGE_HASH_KEY = 'localdb_hashes';
  
  constructor() {
    console.log('로컬 KV 스토어 초기화...');
    this.loadFromLocalStorage();
    
    // 페이지 언로드 시 데이터 저장
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.saveToLocalStorage();
      });
      
      // 주기적으로 데이터 저장 (1분마다)
      setInterval(() => this.saveToLocalStorage(), 60000);
    }
  }
  
  // 싱글톤 인스턴스 가져오기
  public static getInstance(): LocalKVStore {
    if (!LocalKVStore.instance) {
      LocalKVStore.instance = new LocalKVStore();
    }
    return LocalKVStore.instance;
  }
  
  // 로컬 스토리지로부터 데이터 로드
  private loadFromLocalStorage() {
    if (typeof window !== 'undefined') {
      try {
        // 키-값 데이터 로드
        const keyValueData = localStorage.getItem(this.LOCAL_STORAGE_KEY);
        if (keyValueData) {
          const parsed = JSON.parse(keyValueData);
          Object.entries(parsed).forEach(([key, value]) => {
            this.storage.set(key, value);
          });
        }
        
        // 해시 데이터 로드
        const hashData = localStorage.getItem(this.LOCAL_STORAGE_HASH_KEY);
        if (hashData) {
          const parsed = JSON.parse(hashData);
          Object.entries(parsed).forEach(([hash, values]: [string, any]) => {
            const hashMap = new Map<string, any>();
            Object.entries(values).forEach(([key, value]) => {
              hashMap.set(key, value);
            });
            this.hashStorage.set(hash, hashMap);
          });
        }
        
        console.log('로컬 스토리지에서 데이터 로드 완료');
      } catch (error) {
        console.error('로컬 스토리지에서 데이터 로드 오류:', error);
      }
    }
  }
  
  // 로컬 스토리지에 데이터 저장
  private saveToLocalStorage() {
    if (typeof window !== 'undefined') {
      try {
        // 키-값 데이터 저장
        const keyValueData: Record<string, any> = {};
        this.storage.forEach((value, key) => {
          keyValueData[key] = value;
        });
        localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(keyValueData));
        
        // 해시 데이터 저장
        const hashData: Record<string, Record<string, any>> = {};
        this.hashStorage.forEach((hashMap, hash) => {
          hashData[hash] = {};
          hashMap.forEach((value, key) => {
            hashData[hash][key] = value;
          });
        });
        localStorage.setItem(this.LOCAL_STORAGE_HASH_KEY, JSON.stringify(hashData));
        
        console.log('로컬 스토리지에 데이터 저장 완료');
      } catch (error) {
        console.error('로컬 스토리지에 데이터 저장 오류:', error);
      }
    }
  }
  
  async get(key: string): Promise<any> {
    console.log(`[로컬DB] GET ${key}`);
    return this.storage.get(key) || null;
  }

  async set(key: string, value: any): Promise<void> {
    console.log(`[로컬DB] SET ${key}`);
    this.storage.set(key, value);
    this.saveToLocalStorage();
  }

  async delete(key: string): Promise<void> {
    console.log(`[로컬DB] DELETE ${key}`);
    this.storage.delete(key);
    this.saveToLocalStorage();
  }

  async hget(hash: string, key: string): Promise<any> {
    console.log(`[로컬DB] HGET ${hash}:${key}`);
    const hashMap = this.hashStorage.get(hash);
    if (!hashMap) return null;
    return hashMap.get(key) || null;
  }

  async hset(hash: string, key: string, value: any): Promise<void> {
    console.log(`[로컬DB] HSET ${hash}:${key}`);
    if (!this.hashStorage.has(hash)) {
      this.hashStorage.set(hash, new Map());
    }
    const hashMap = this.hashStorage.get(hash)!;
    hashMap.set(key, value);
    this.saveToLocalStorage();
  }

  async hdel(hash: string, key: string): Promise<void> {
    console.log(`[로컬DB] HDEL ${hash}:${key}`);
    const hashMap = this.hashStorage.get(hash);
    if (hashMap) {
      hashMap.delete(key);
      this.saveToLocalStorage();
    }
  }

  async hgetall(hash: string): Promise<Record<string, any>> {
    console.log(`[로컬DB] HGETALL ${hash}`);
    const hashMap = this.hashStorage.get(hash);
    if (!hashMap) return {};
    
    const result: Record<string, any> = {};
    hashMap.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

// 서버리스 환경에서 mock KV 스토어 (개발 환경용)
class MockKVStore implements KVStore {
  private storage: Map<string, any> = new Map();
  private hashStorage: Map<string, Map<string, any>> = new Map();

  async get(key: string): Promise<any> {
    return this.storage.get(key) || null;
  }

  async set(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async hget(hash: string, key: string): Promise<any> {
    const hashMap = this.hashStorage.get(hash);
    if (!hashMap) return null;
    return hashMap.get(key) || null;
  }

  async hset(hash: string, key: string, value: any): Promise<void> {
    if (!this.hashStorage.has(hash)) {
      this.hashStorage.set(hash, new Map());
    }
    const hashMap = this.hashStorage.get(hash)!;
    hashMap.set(key, value);
  }

  async hdel(hash: string, key: string): Promise<void> {
    const hashMap = this.hashStorage.get(hash);
    if (hashMap) {
      hashMap.delete(key);
    }
  }

  async hgetall(hash: string): Promise<Record<string, any>> {
    const hashMap = this.hashStorage.get(hash);
    if (!hashMap) return {};
    
    const result: Record<string, any> = {};
    hashMap.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

// MongoDB 타입만 import (실제 구현은 서버 측에서만 사용)
type MongoClient = any;
type Db = any;
type Collection = any;

// MongoDB 클라이언트 및 연결 관리 (서버 컴포넌트에서만 동작)
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

// MongoDB 어댑터 - 서버 컴포넌트에서만 사용
const createMongoDBStore = async (): Promise<KVStore> => {
  if (typeof window !== 'undefined') {
    console.log('클라이언트 환경에서는 MockKVStore를 사용합니다.');
    return new MockKVStore();
  }
  
  try {
    // 서버 측에서만 MongoDB 모듈 가져오기
    const { MongoClient } = await import('mongodb');
    
    // MongoDB URI 환경 변수에서 가져오기
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn('MONGODB_URI 환경 변수가 설정되지 않았습니다.');
      return new MockKVStore();
    }
    
    // 이미 연결되어 있으면 기존 인스턴스 재사용
    if (mongoClient && mongoDb) {
      return createMongoDBStoreAdapter(mongoClient, mongoDb);
    }
    
    // MongoDB 클라이언트 생성 및 연결
    mongoClient = new MongoClient(uri, {
      // MongoDB 드라이버 옵션 설정
      connectTimeoutMS: 10000, // 연결 타임아웃 (10초)
      socketTimeoutMS: 30000,  // 소켓 타임아웃 (30초)
      maxPoolSize: 10,         // 최대 연결 풀 크기
      minPoolSize: 5,          // 최소 연결 풀 크기
    });
    
    await mongoClient.connect();
    console.log('MongoDB에 성공적으로 연결되었습니다.');
    
    // 데이터베이스 선택
    const dbName = process.env.MONGODB_DB_NAME || 'tank-system';
    mongoDb = mongoClient.db(dbName);
    
    return createMongoDBStoreAdapter(mongoClient, mongoDb);
  } catch (error) {
    console.error('MongoDB 연결 오류:', error);
    return new MockKVStore();
  }
};

// MongoDB 어댑터 생성 함수
const createMongoDBStoreAdapter = (client: MongoClient, db: Db): KVStore => {
  return {
    async get(key: string): Promise<any> {
      try {
        const collection = db.collection('kv_store');
        const doc = await collection.findOne({ _id: key });
        return doc ? doc.value : null;
      } catch (error) {
        console.error(`MongoDB get 오류 (${key}):`, error);
        return null;
      }
    },
    
    async set(key: string, value: any): Promise<void> {
      try {
        const collection = db.collection('kv_store');
        await collection.updateOne(
          { _id: key },
          { $set: { value, updatedAt: new Date() } },
          { upsert: true }
        );
      } catch (error) {
        console.error(`MongoDB set 오류 (${key}):`, error);
        throw error;
      }
    },
    
    async delete(key: string): Promise<void> {
      try {
        const collection = db.collection('kv_store');
        await collection.deleteOne({ _id: key });
      } catch (error) {
        console.error(`MongoDB delete 오류 (${key}):`, error);
        throw error;
      }
    },
    
    async hget(hash: string, key: string): Promise<any> {
      try {
        const collection = db.collection(hash);
        const doc = await collection.findOne({ _id: key });
        return doc ? doc.value : null;
      } catch (error) {
        console.error(`MongoDB hget 오류 (${hash}:${key}):`, error);
        return null;
      }
    },
    
    async hset(hash: string, key: string, value: any): Promise<void> {
      try {
        const collection = db.collection(hash);
        await collection.updateOne(
          { _id: key },
          { $set: { value, updatedAt: new Date() } },
          { upsert: true }
        );
      } catch (error) {
        console.error(`MongoDB hset 오류 (${hash}:${key}):`, error);
        throw error;
      }
    },
    
    async hdel(hash: string, key: string): Promise<void> {
      try {
        const collection = db.collection(hash);
        await collection.deleteOne({ _id: key });
      } catch (error) {
        console.error(`MongoDB hdel 오류 (${hash}:${key}):`, error);
        throw error;
      }
    },
    
    async hgetall(hash: string): Promise<Record<string, any>> {
      try {
        const collection = db.collection(hash);
        const docs = await collection.find({}).toArray();
        const result: Record<string, any> = {};
        docs.forEach(doc => {
          result[doc._id] = doc.value;
        });
        return result;
      } catch (error) {
        console.error(`MongoDB hgetall 오류 (${hash}):`, error);
        return {};
      }
    }
  };
};

// KV 스토어 인스턴스
let kvStore: KVStore;

// 초기화 함수
const initKVStore = async (): Promise<KVStore> => {
  // 클라이언트 측에서는 로컬 스토리지 기반 스토어 사용
  if (typeof window !== 'undefined') {
    console.log('PC 환경에서 로컬 스토리지 기반 스토어를 사용합니다.');
    return LocalKVStore.getInstance();
  }
  
  // 서버 측에서는 간단한 Mock 스토어 사용
  console.log('서버 환경에서 Mock 스토어를 사용합니다.');
  return new MockKVStore();
};

// 레이지 초기화
const getKVStore = async (): Promise<KVStore> => {
  if (!kvStore) {
    kvStore = await initKVStore();
  }
  return kvStore;
};

// 다양한 데이터 유형에 대한 키 접두사
const KeyPrefix = {
  TASKS: 'tasks',
  DEVICE_TASKS: 'device_tasks',
  VERSIONS: 'versions',
};

// DB 서비스
const dbService = {
  // 모든 작업 불러오기
  getAllTasks: async (): Promise<WorkTask[]> => {
    try {
      const store = await getKVStore();
      const tasksData = await store.get(KeyPrefix.TASKS);
      return tasksData ? JSON.parse(tasksData) : [];
    } catch (error) {
      console.error('DB에서 작업 목록 로드 오류:', error);
      return [];
    }
  },

  // 특정 작업 불러오기
  getTaskById: async (taskId: string): Promise<WorkTask | null> => {
    try {
      const store = await getKVStore();
      const taskData = await store.hget(KeyPrefix.TASKS, taskId);
      return taskData ? JSON.parse(taskData) : null;
    } catch (error) {
      console.error(`DB에서 작업(${taskId}) 로드 오류:`, error);
      return null;
    }
  },

  // 작업 저장하기
  saveTask: async (task: WorkTask): Promise<boolean> => {
    try {
      const store = await getKVStore();
      
      // 버전 관리를 위한 이전 버전 저장
      const existingTask = await store.hget(KeyPrefix.TASKS, task.id);
      if (existingTask) {
        await store.hset(
          `${KeyPrefix.VERSIONS}:${task.id}`, 
          Date.now().toString(), 
          existingTask
        );
      }
      
      // 새 작업 저장
      await store.hset(KeyPrefix.TASKS, task.id, JSON.stringify(task));
      
      // 전체 목록 업데이트
      const allTasks = await dbService.getAllTasks();
      const taskIndex = allTasks.findIndex(t => t.id === task.id);
      
      if (taskIndex >= 0) {
        allTasks[taskIndex] = task;
      } else {
        allTasks.push(task);
      }
      
      await store.set(KeyPrefix.TASKS, JSON.stringify(allTasks));
      
      return true;
    } catch (error) {
      console.error(`DB에 작업(${task.id}) 저장 오류:`, error);
      return false;
    }
  },

  // 특정 장치의 작업 목록 불러오기
  getTasksByDeviceId: async (deviceId: string): Promise<WorkTask[]> => {
    try {
      const store = await getKVStore();
      const deviceTasksData = await store.hget(KeyPrefix.DEVICE_TASKS, deviceId);
      return deviceTasksData ? JSON.parse(deviceTasksData) : [];
    } catch (error) {
      console.error(`DB에서 장치(${deviceId})의 작업 목록 로드 오류:`, error);
      return [];
    }
  },

  // 장치의 작업 목록 업데이트
  updateDeviceTasks: async (deviceId: string, tasks: WorkTask[]): Promise<boolean> => {
    try {
      const store = await getKVStore();
      await store.hset(KeyPrefix.DEVICE_TASKS, deviceId, JSON.stringify(tasks));
      return true;
    } catch (error) {
      console.error(`DB에서 장치(${deviceId})의 작업 목록 업데이트 오류:`, error);
      return false;
    }
  },

  // 특정 장치에 작업 할당
  assignTaskToDevice: async (taskId: string, deviceId: string): Promise<boolean> => {
    try {
      // 기존 장치 작업 목록 불러오기
      const deviceTasks = await dbService.getTasksByDeviceId(deviceId);
      
      // 작업 ID가 아직 없는 경우에만 추가
      if (!deviceTasks.some(t => t.id === taskId)) {
        const task = await dbService.getTaskById(taskId);
        if (task) {
          deviceTasks.push(task);
          return await dbService.updateDeviceTasks(deviceId, deviceTasks);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`DB에서 장치(${deviceId})에 작업(${taskId}) 할당 오류:`, error);
      return false;
    }
  },

  // 작업 삭제
  deleteTask: async (taskId: string): Promise<boolean> => {
    try {
      const store = await getKVStore();
      
      // 작업 삭제
      await store.hdel(KeyPrefix.TASKS, taskId);
      
      // 전체 목록 업데이트
      const allTasks = await dbService.getAllTasks();
      const updatedTasks = allTasks.filter(t => t.id !== taskId);
      await store.set(KeyPrefix.TASKS, JSON.stringify(updatedTasks));
      
      return true;
    } catch (error) {
      console.error(`DB에서 작업(${taskId}) 삭제 오류:`, error);
      return false;
    }
  },

  // 모든 작업 삭제
  clearAllTasks: async (): Promise<boolean> => {
    try {
      const store = await getKVStore();
      await store.set(KeyPrefix.TASKS, JSON.stringify([]));
      return true;
    } catch (error) {
      console.error('DB에서 모든 작업 삭제 오류:', error);
      return false;
    }
  },

  // 작업 이전 버전 불러오기
  getTaskVersions: async (taskId: string): Promise<{version: string, task: WorkTask}[]> => {
    try {
      const store = await getKVStore();
      const versions = await store.hgetall(`${KeyPrefix.VERSIONS}:${taskId}`);
      
      return Object.entries(versions).map(([version, taskData]) => ({
        version,
        task: JSON.parse(taskData)
      })).sort((a, b) => Number(b.version) - Number(a.version)); // 최신 버전부터 정렬
    } catch (error) {
      console.error(`DB에서 작업(${taskId})의 버전 기록 로드 오류:`, error);
      return [];
    }
  },

  // 버전 충돌 해결
  resolveConflict: async (taskId: string, selectedVersion: string): Promise<boolean> => {
    try {
      const versions = await dbService.getTaskVersions(taskId);
      const selectedVersionData = versions.find(v => v.version === selectedVersion);
      
      if (selectedVersionData) {
        return await dbService.saveTask(selectedVersionData.task);
      }
      
      return false;
    } catch (error) {
      console.error(`버전 충돌 해결 오류(${taskId}, ${selectedVersion}):`, error);
      return false;
    }
  }
};

export default dbService; 