/**
 * 로컬 스토리지 기반 데이터베이스 연결 모듈
 * 
 * 이 파일은 MongoDB와 동일한 인터페이스를 제공하지만 실제로는 로컬 스토리지를 사용합니다.
 * PC용 독립 실행을 위해 서버 의존성 없이 작동합니다.
 */

// 컬렉션 이름 상수 (MongoDB와 동일한 상수를 사용하여 호환성 유지)
export const COLLECTIONS = {
  TASKS: 'tasks',
  TASK_VERSIONS: 'task_versions',
  WORK_LOGS: 'work_logs',
  USERS: 'users',
  DEVICES: 'devices',
  ACTIVITY_LOGS: 'activity_logs',
  SETTINGS: 'settings',
  BACKUPS: 'backups',
  TEMPLATES: 'templates'
};

// 로컬 스토리지 키 접두사
const LOCAL_STORAGE_PREFIX = 'local_db_';

// 로컬 DB 인터페이스
export interface LocalDb {
  collection: (name: string) => LocalCollection;
  listCollections: (filter?: any) => { toArray: () => Promise<any[]> };
  createCollection: (name: string) => Promise<void>;
}

// 로컬 클라이언트 인터페이스
export interface LocalClient {
  connect: () => Promise<void>;
  close: () => Promise<void>;
  db: (name?: string) => LocalDb;
}

// 로컬 컬렉션 인터페이스
export interface LocalCollection {
  findOne: (filter: any) => Promise<any>;
  find: (filter: any) => LocalCursor;
  insertOne: (doc: any) => Promise<{insertedId: string, acknowledged: boolean}>;
  updateOne: (filter: any, update: any, options?: any) => Promise<{modifiedCount: number, acknowledged: boolean}>;
  deleteOne: (filter: any) => Promise<{deletedCount: number, acknowledged: boolean}>;
  deleteMany: (filter: any) => Promise<{deletedCount: number, acknowledged: boolean}>;
  createIndex: (spec: any, options?: any) => Promise<string>;
}

// 로컬 커서 인터페이스
export interface LocalCursor {
  sort: (spec: any) => LocalCursor;
  toArray: () => Promise<any[]>;
  limit: (n: number) => LocalCursor;
  skip: (n: number) => LocalCursor;
}

// 싱글톤 인스턴스
let localClientInstance: LocalClient | null = null;
let localDbInstance: LocalDb | null = null;

// 필터 조건 처리 함수
function matchesFilter(doc: any, filter: any): boolean {
  // 필터가 비어있으면 모든 문서 반환
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }
  
  // 모든 필터 조건을 확인
  return Object.entries(filter).every(([key, value]) => {
    // ID 필드 특수 처리 (MongoDB _id와 일반 id 모두 지원)
    if (key === '_id') {
      return doc._id === value || doc.id === value;
    }
    
    // 일반적인 필드 일치 확인
    if (typeof value === 'object' && value !== null) {
      // MongoDB 연산자 처리
      const operators = Object.keys(value);
      return operators.every(op => {
        switch (op) {
          case '$eq':
            return doc[key] === value[op];
          case '$ne':
            return doc[key] !== value[op];
          case '$gt':
            return doc[key] > value[op];
          case '$gte':
            return doc[key] >= value[op];
          case '$lt':
            return doc[key] < value[op];
          case '$lte':
            return doc[key] <= value[op];
          case '$in':
            return Array.isArray(value[op]) && value[op].includes(doc[key]);
          case '$nin':
            return Array.isArray(value[op]) && !value[op].includes(doc[key]);
          case '$exists':
            return value[op] ? key in doc : !(key in doc);
          default:
            return false;
        }
      });
    }
    
    // 단순 값 비교
    return doc[key] === value;
  });
}

// 로컬 컬렉션 구현
class LocalCollectionImpl implements LocalCollection {
  private name: string;
  private docs: any[] = [];
  
  constructor(name: string) {
    this.name = name;
    this.loadFromLocalStorage();
  }
  
  // 로컬 스토리지에서 데이터 로드
  private loadFromLocalStorage() {
    if (typeof window !== 'undefined') {
      try {
        const key = `${LOCAL_STORAGE_PREFIX}${this.name}`;
        const data = localStorage.getItem(key);
        this.docs = data ? JSON.parse(data) : [];
        console.log(`컬렉션 로드됨: ${this.name}, 문서 수: ${this.docs.length}`);
      } catch (error) {
        console.error(`컬렉션 로드 오류: ${this.name}`, error);
        this.docs = [];
      }
    }
  }
  
  // 로컬 스토리지에 데이터 저장
  private saveToLocalStorage() {
    if (typeof window !== 'undefined') {
      try {
        const key = `${LOCAL_STORAGE_PREFIX}${this.name}`;
        localStorage.setItem(key, JSON.stringify(this.docs));
      } catch (error) {
        console.error(`컬렉션 저장 오류: ${this.name}`, error);
      }
    }
  }
  
  // 단일 문서 찾기
  async findOne(filter: any): Promise<any> {
    const doc = this.docs.find(doc => matchesFilter(doc, filter)) || null;
    return doc ? {...doc} : null;
  }
  
  // 문서 검색 커서 반환
  find(filter: any): LocalCursor {
    const filteredDocs = this.docs.filter(doc => matchesFilter(doc, filter));
    
    let sortSpec: any = null;
    let limitCount: number | null = null;
    let skipCount: number | null = null;
    
    const cursor: LocalCursor = {
      // 정렬 지정
      sort: (spec: any) => {
        sortSpec = spec;
        return cursor;
      },
      
      // 결과 제한
      limit: (n: number) => {
        limitCount = n;
        return cursor;
      },
      
      // 결과 건너뛰기
      skip: (n: number) => {
        skipCount = n;
        return cursor;
      },
      
      // 배열로 결과 반환
      toArray: async (): Promise<any[]> => {
        let result = [...filteredDocs];
        
        // 정렬 적용
        if (sortSpec) {
          result.sort((a, b) => {
            for (const [key, order] of Object.entries(sortSpec)) {
              if (a[key] < b[key]) return order === 1 ? -1 : 1;
              if (a[key] > b[key]) return order === 1 ? 1 : -1;
            }
            return 0;
          });
        }
        
        // 건너뛰기 적용
        if (skipCount && skipCount > 0) {
          result = result.slice(skipCount);
        }
        
        // 제한 적용
        if (limitCount && limitCount > 0) {
          result = result.slice(0, limitCount);
        }
        
        // 깊은 복사로 반환
        return result.map(doc => ({...doc}));
      }
    };
    
    return cursor;
  }
  
  // 문서 삽입
  async insertOne(doc: any): Promise<{insertedId: string, acknowledged: boolean}> {
    // _id가 없으면 자동 생성
    if (!doc._id && !doc.id) {
      doc._id = Date.now().toString() + Math.random().toString(36).substring(2, 15);
    }
    
    this.docs.push({...doc});
    this.saveToLocalStorage();
    
    return {
      insertedId: doc._id || doc.id,
      acknowledged: true
    };
  }
  
  // 문서 업데이트
  async updateOne(filter: any, update: any, options?: any): Promise<{modifiedCount: number, acknowledged: boolean}> {
    const index = this.docs.findIndex(doc => matchesFilter(doc, filter));
    
    if (index === -1) {
      // upsert 옵션 처리
      if (options?.upsert) {
        const newDoc = {...filter};
        
        if (update.$set) {
          Object.assign(newDoc, update.$set);
        }
        
        if (!newDoc._id && !newDoc.id) {
          newDoc._id = Date.now().toString() + Math.random().toString(36).substring(2, 15);
        }
        
        this.docs.push(newDoc);
        this.saveToLocalStorage();
        
        return {
          modifiedCount: 0,
          acknowledged: true
        };
      }
      
      return {
        modifiedCount: 0,
        acknowledged: true
      };
    }
    
    // $set 연산자 처리
    if (update.$set) {
      Object.assign(this.docs[index], update.$set);
    }
    
    // $unset 연산자 처리
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        delete this.docs[index][key];
      }
    }
    
    // $push 연산자 처리
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        if (!Array.isArray(this.docs[index][key])) {
          this.docs[index][key] = [];
        }
        this.docs[index][key].push(value);
      }
    }
    
    // $pull 연산자 처리
    if (update.$pull) {
      for (const [key, value] of Object.entries(update.$pull)) {
        if (Array.isArray(this.docs[index][key])) {
          this.docs[index][key] = this.docs[index][key].filter((item: any) => item !== value);
        }
      }
    }
    
    // $addToSet 연산자 처리
    if (update.$addToSet) {
      for (const [key, value] of Object.entries(update.$addToSet)) {
        if (!Array.isArray(this.docs[index][key])) {
          this.docs[index][key] = [];
        }
        if (!this.docs[index][key].includes(value)) {
          this.docs[index][key].push(value);
        }
      }
    }
    
    this.saveToLocalStorage();
    
    return {
      modifiedCount: 1,
      acknowledged: true
    };
  }
  
  // 문서 삭제
  async deleteOne(filter: any): Promise<{deletedCount: number, acknowledged: boolean}> {
    const index = this.docs.findIndex(doc => matchesFilter(doc, filter));
    
    if (index === -1) {
      return {
        deletedCount: 0,
        acknowledged: true
      };
    }
    
    this.docs.splice(index, 1);
    this.saveToLocalStorage();
    
    return {
      deletedCount: 1,
      acknowledged: true
    };
  }
  
  // 여러 문서 삭제
  async deleteMany(filter: any): Promise<{deletedCount: number, acknowledged: boolean}> {
    const initialLength = this.docs.length;
    this.docs = this.docs.filter(doc => !matchesFilter(doc, filter));
    const deletedCount = initialLength - this.docs.length;
    
    if (deletedCount > 0) {
      this.saveToLocalStorage();
    }
    
    return {
      deletedCount,
      acknowledged: true
    };
  }
  
  // 인덱스 생성 (로컬에서는 실제로 인덱스를 만들지 않고 성공만 반환)
  async createIndex(spec: any, options?: any): Promise<string> {
    const indexName = Object.keys(spec).join('_');
    console.log(`인덱스 생성 시뮬레이션: ${this.name}.${indexName}`);
    return indexName;
  }
}

// 로컬 DB 구현
class LocalDbImpl implements LocalDb {
  private collections: Map<string, LocalCollectionImpl> = new Map();
  
  constructor() {
    console.log('로컬 DB 인스턴스 생성됨');
  }
  
  // 컬렉션 가져오기 (없으면 생성)
  collection(name: string): LocalCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new LocalCollectionImpl(name));
    }
    return this.collections.get(name)!;
  }
  
  // 모든 컬렉션 목록 가져오기
  listCollections(filter?: any): { toArray: () => Promise<any[]> } {
    return {
      toArray: async () => {
        return Array.from(this.collections.keys()).map(name => ({
          name,
          type: 'collection'
        }));
      }
    };
  }
  
  // 컬렉션 생성 (이미 존재하면 무시)
  async createCollection(name: string): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new LocalCollectionImpl(name));
      console.log(`컬렉션 생성됨: ${name}`);
    }
  }
}

// 로컬 클라이언트 구현
class LocalClientImpl implements LocalClient {
  private db: LocalDbImpl;
  
  constructor() {
    this.db = new LocalDbImpl();
    console.log('로컬 클라이언트 생성됨');
  }
  
  // 연결 시뮬레이션 (로컬이므로 항상 성공)
  async connect(): Promise<void> {
    console.log('로컬 DB에 연결됨');
  }
  
  // 연결 종료 시뮬레이션
  async close(): Promise<void> {
    console.log('로컬 DB 연결 종료됨');
  }
  
  // DB 객체 반환
  db(name?: string): LocalDb {
    return this.db;
  }
}

// 데이터베이스 연결 함수
export async function connectToDatabase(): Promise<{ client: LocalClient; db: LocalDb }> {
  // 이미 인스턴스가 있으면 재사용
  if (localClientInstance && localDbInstance) {
    return { client: localClientInstance, db: localDbInstance };
  }
  
  // 새 인스턴스 생성
  localClientInstance = new LocalClientImpl();
  await localClientInstance.connect();
  localDbInstance = localClientInstance.db();
  
  return { client: localClientInstance, db: localDbInstance };
}

// 연결 종료 함수
export async function disconnectFromDatabase(): Promise<void> {
  if (localClientInstance) {
    await localClientInstance.close();
    localClientInstance = null;
    localDbInstance = null;
  }
}

// 컬렉션 초기화 함수
export async function initializeCollections(): Promise<void> {
  try {
    const { db } = await connectToDatabase();
    
    // 필요한 컬렉션 생성
    for (const collectionName of Object.values(COLLECTIONS)) {
      await db.createCollection(collectionName);
    }
    
    // 인덱스 시뮬레이션 (로컬에서는 실제로 인덱스가 생성되지 않음)
    await db.collection(COLLECTIONS.TASKS).createIndex({ id: 1 }, { unique: true });
    await db.collection(COLLECTIONS.TASKS).createIndex({ deviceId: 1 });
    await db.collection(COLLECTIONS.TASKS).createIndex({ createdAt: 1 });
    
    console.log("로컬 데이터베이스 컬렉션 초기화 완료");
  } catch (error) {
    console.error('로컬 컬렉션 초기화 오류:', error);
  }
}

// 초기화
if (typeof window !== 'undefined') {
  initializeCollections().catch(console.error);
} 