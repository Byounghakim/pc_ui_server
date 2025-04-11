import { MongoClient, ServerApiVersion, Db } from 'mongodb';

// MongoDB 연결 정보
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'task_management';

// 글로벌 변수로 클라이언트 인스턴스 캐싱
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

// MongoDB 클라이언트 및 DB 연결 함수
export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  // 캐시된 연결이 있으면 재사용
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  // 환경 변수에 MongoDB URI가 설정되어 있지 않은 경우 오류 발생
  if (!MONGODB_URI) {
    throw new Error('MongoDB URI가 환경 변수에 설정되어 있지 않습니다.');
  }

  try {
    // MongoDB 클라이언트 옵션 설정
    const options = {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    };

    // MongoDB 클라이언트 생성 및 연결
    const client = new MongoClient(MONGODB_URI, options);
    await client.connect();
    
    // 연결 확인
    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB에 성공적으로 연결되었습니다!");
    
    const db = client.db(MONGODB_DB);
    
    // 연결 캐싱
    cachedClient = client;
    cachedDb = db;
    
    return { client, db };
  } catch (error) {
    console.error('MongoDB 연결 오류:', error);
    throw error;
  }
}

// 컬렉션 이름 상수
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

// 연결 종료 함수 (필요시)
export async function disconnectFromDatabase(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
    console.log("MongoDB 연결이 종료되었습니다.");
  }
}

// 컬렉션 초기화 함수
export async function initializeCollections(): Promise<void> {
  try {
    const { db } = await connectToDatabase();
    
    // 필요한 컬렉션 생성 (이미 존재하는 경우 무시됨)
    for (const collectionName of Object.values(COLLECTIONS)) {
      const collections = await db.listCollections({ name: collectionName }).toArray();
      if (collections.length === 0) {
        await db.createCollection(collectionName);
        console.log(`컬렉션 생성됨: ${collectionName}`);
      }
    }
    
    // 인덱스 생성
    await db.collection(COLLECTIONS.TASKS).createIndex({ id: 1 }, { unique: true });
    await db.collection(COLLECTIONS.TASKS).createIndex({ deviceId: 1 });
    await db.collection(COLLECTIONS.TASKS).createIndex({ createdAt: 1 });
    
    await db.collection(COLLECTIONS.TASK_VERSIONS).createIndex({ taskId: 1, version: 1 }, { unique: true });
    
    await db.collection(COLLECTIONS.WORK_LOGS).createIndex({ id: 1 }, { unique: true });
    await db.collection(COLLECTIONS.WORK_LOGS).createIndex({ deviceId: 1 });
    await db.collection(COLLECTIONS.WORK_LOGS).createIndex({ taskId: 1 });
    await db.collection(COLLECTIONS.WORK_LOGS).createIndex({ createdAt: 1 });
    
    await db.collection(COLLECTIONS.ACTIVITY_LOGS).createIndex({ taskId: 1 });
    await db.collection(COLLECTIONS.ACTIVITY_LOGS).createIndex({ timestamp: 1 });
    
    // 백업 컬렉션 인덱스
    await db.collection(COLLECTIONS.BACKUPS).createIndex({ id: 1 }, { unique: true });
    await db.collection(COLLECTIONS.BACKUPS).createIndex({ createdAt: 1 });
    
    // 템플릿 컬렉션 인덱스
    await db.collection(COLLECTIONS.TEMPLATES).createIndex({ id: 1 }, { unique: true });
    await db.collection(COLLECTIONS.TEMPLATES).createIndex({ createdBy: 1 });
    await db.collection(COLLECTIONS.TEMPLATES).createIndex({ isPublic: 1 });
    await db.collection(COLLECTIONS.TEMPLATES).createIndex({ updatedAt: 1 });
    
    console.log("데이터베이스 컬렉션 및 인덱스가 초기화되었습니다.");
  } catch (error) {
    console.error('컬렉션 초기화 오류:', error);
    throw error;
  }
}

// 애플리케이션 시작 시 컬렉션 초기화 (선택 사항)
if (process.env.NODE_ENV !== 'development') {
  initializeCollections().catch(console.error);
} 