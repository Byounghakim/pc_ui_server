"use client";

export interface IndexedDBConfig {
  dbName: string;
  storeName: string;
  version?: number;
}

/**
 * IndexedDB 연결 및 객체 저장소 생성
 * @param config DB 설정 (이름, 스토어명, 버전)
 * @returns Promise<IDBDatabase>
 */
export function openIndexedDB(config: IndexedDBConfig): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      // 브라우저 환경인지 확인
      if (typeof window === 'undefined' || !window.indexedDB) {
        console.warn('[IndexedDB] IndexedDB를 사용할 수 없습니다.');
        reject(new Error('IndexedDB를 사용할 수 없습니다.'));
        return;
      }

      const { dbName, storeName, version = 1 } = config;
      const request = indexedDB.open(dbName, version);

      request.onerror = (event) => {
        console.error(`[IndexedDB] 데이터베이스 오픈 실패 (${dbName}):`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBRequest).result as IDBDatabase;
        
        // 이미 객체 스토어가 있는지 확인
        if (!db.objectStoreNames.contains(storeName)) {
          // 키 경로가 'id'인 객체 스토어 생성
          db.createObjectStore(storeName, { keyPath: 'id' });
          console.log(`[IndexedDB] 객체 스토어 생성됨 (${storeName})`);
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBRequest).result as IDBDatabase;
        console.log(`[IndexedDB] 데이터베이스 연결 성공 (${dbName})`);
        resolve(db);
      };
    } catch (error) {
      console.error('[IndexedDB] 데이터베이스 오픈 중 오류 발생:', error);
      reject(error);
    }
  });
}

/**
 * IndexedDB에 데이터 저장
 * @param config DB 설정 (이름, 스토어명, 버전)
 * @param id 저장 키 ID
 * @param data 저장할 데이터
 * @returns Promise<void>
 */
export function saveToIndexedDB<T>(
  config: IndexedDBConfig,
  id: string,
  data: T
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    openIndexedDB(config)
      .then((db) => {
        try {
          const transaction = db.transaction(config.storeName, 'readwrite');
          const store = transaction.objectStore(config.storeName);
          
          // id와 실제 데이터를 포함하는 객체 생성
          const record = {
            id,
            data,
            timestamp: new Date().getTime()
          };
          
          const request = store.put(record);
          
          request.onerror = (event) => {
            console.error(`[IndexedDB] 데이터 저장 실패 (${id}):`, (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
          };
          
          request.onsuccess = () => {
            console.log(`[IndexedDB] 데이터 저장 완료 (${id})`);
            resolve();
          };
          
          transaction.oncomplete = () => {
            db.close();
          };
        } catch (error) {
          console.error(`[IndexedDB] 트랜잭션 오류 (${id}):`, error);
          db.close();
          reject(error);
        }
      })
      .catch(reject);
  });
}

/**
 * IndexedDB에서 데이터 로드
 * @param config DB 설정 (이름, 스토어명, 버전)
 * @param id 로드할 키 ID
 * @returns Promise<T | null>
 */
export function loadFromIndexedDB<T>(
  config: IndexedDBConfig,
  id: string
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    openIndexedDB(config)
      .then((db) => {
        try {
          const transaction = db.transaction(config.storeName, 'readonly');
          const store = transaction.objectStore(config.storeName);
          const request = store.get(id);
          
          request.onerror = (event) => {
            console.error(`[IndexedDB] 데이터 로드 실패 (${id}):`, (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
          };
          
          request.onsuccess = (event) => {
            const result = (event.target as IDBRequest).result;
            
            if (result) {
              console.log(`[IndexedDB] 데이터 로드 완료 (${id})`);
              resolve(result.data as T);
            } else {
              console.log(`[IndexedDB] 데이터가 없습니다 (${id})`);
              resolve(null);
            }
          };
          
          transaction.oncomplete = () => {
            db.close();
          };
        } catch (error) {
          console.error(`[IndexedDB] 트랜잭션 오류 (${id}):`, error);
          db.close();
          reject(error);
        }
      })
      .catch(reject);
  });
}

/**
 * IndexedDB에서 데이터 삭제
 * @param config DB 설정 (이름, 스토어명, 버전)
 * @param id 삭제할 키 ID
 * @returns Promise<void>
 */
export function removeFromIndexedDB(
  config: IndexedDBConfig,
  id: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    openIndexedDB(config)
      .then((db) => {
        try {
          const transaction = db.transaction(config.storeName, 'readwrite');
          const store = transaction.objectStore(config.storeName);
          const request = store.delete(id);
          
          request.onerror = (event) => {
            console.error(`[IndexedDB] 데이터 삭제 실패 (${id}):`, (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
          };
          
          request.onsuccess = () => {
            console.log(`[IndexedDB] 데이터 삭제 완료 (${id})`);
            resolve();
          };
          
          transaction.oncomplete = () => {
            db.close();
          };
        } catch (error) {
          console.error(`[IndexedDB] 트랜잭션 오류 (${id}):`, error);
          db.close();
          reject(error);
        }
      })
      .catch(reject);
  });
}

/**
 * IndexedDB 스토어의 모든 데이터 로드
 * @param config DB 설정 (이름, 스토어명, 버전)
 * @returns Promise<Record<string, any>>
 */
export function getAllFromIndexedDB(
  config: IndexedDBConfig
): Promise<Record<string, any>> {
  return new Promise<Record<string, any>>((resolve, reject) => {
    openIndexedDB(config)
      .then((db) => {
        try {
          const transaction = db.transaction(config.storeName, 'readonly');
          const store = transaction.objectStore(config.storeName);
          const request = store.getAll();
          
          request.onerror = (event) => {
            console.error('[IndexedDB] 전체 데이터 로드 실패:', (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
          };
          
          request.onsuccess = (event) => {
            const results = (event.target as IDBRequest).result;
            const data: Record<string, any> = {};
            
            if (results && results.length > 0) {
              results.forEach((item) => {
                data[item.id] = item.data;
              });
              console.log(`[IndexedDB] ${results.length}개의 항목 로드 완료`);
            } else {
              console.log('[IndexedDB] 로드할 데이터가 없습니다');
            }
            
            resolve(data);
          };
          
          transaction.oncomplete = () => {
            db.close();
          };
        } catch (error) {
          console.error('[IndexedDB] 트랜잭션 오류:', error);
          db.close();
          reject(error);
        }
      })
      .catch(reject);
  });
}

/**
 * IndexedDB 스토어의 모든 데이터 삭제
 * @param config DB 설정 (이름, 스토어명, 버전)
 * @returns Promise<void>
 */
export function clearIndexedDBStore(
  config: IndexedDBConfig
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    openIndexedDB(config)
      .then((db) => {
        try {
          const transaction = db.transaction(config.storeName, 'readwrite');
          const store = transaction.objectStore(config.storeName);
          const request = store.clear();
          
          request.onerror = (event) => {
            console.error('[IndexedDB] 스토어 초기화 실패:', (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
          };
          
          request.onsuccess = () => {
            console.log(`[IndexedDB] 스토어 초기화 완료 (${config.storeName})`);
            resolve();
          };
          
          transaction.oncomplete = () => {
            db.close();
          };
        } catch (error) {
          console.error('[IndexedDB] 트랜잭션 오류:', error);
          db.close();
          reject(error);
        }
      })
      .catch(reject);
  });
}

/**
 * IndexedDB 데이터베이스 삭제
 * @param dbName 삭제할 데이터베이스 이름
 * @returns Promise<void>
 */
export function deleteIndexedDB(dbName: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // 브라우저 환경인지 확인
      if (typeof window === 'undefined' || !window.indexedDB) {
        console.warn('[IndexedDB] IndexedDB를 사용할 수 없습니다.');
        reject(new Error('IndexedDB를 사용할 수 없습니다.'));
        return;
      }

      const request = indexedDB.deleteDatabase(dbName);
      
      request.onerror = (event) => {
        console.error(`[IndexedDB] 데이터베이스 삭제 실패 (${dbName}):`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };
      
      request.onsuccess = () => {
        console.log(`[IndexedDB] 데이터베이스 삭제 완료 (${dbName})`);
        resolve();
      };
    } catch (error) {
      console.error(`[IndexedDB] 데이터베이스 삭제 중 오류 발생 (${dbName}):`, error);
      reject(error);
    }
  });
} 