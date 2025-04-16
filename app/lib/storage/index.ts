"use client";

import * as LocalStorage from './local-storage';
import * as IndexedDB from './indexed-db';

/**
 * 스토리지 타입 정의
 */
export enum StorageType {
  LOCAL_STORAGE = 'localStorage',
  INDEXED_DB = 'indexedDB',
  BOTH = 'both'
}

/**
 * 저장 키 상수
 */
export const STORAGE_KEYS = {
  TANK_VALVE_STATE: 'tank_valve_state',
  SYSTEM_STATE: 'system_state',
  TEMPERATURE_DATA: 'temperature_data',
};

/**
 * 데이터 저장 옵션
 */
export interface SaveOptions {
  storageType?: StorageType;
  expiryTime?: number; // 만료 시간 (밀리초)
}

/**
 * 데이터 로드 옵션
 */
export interface LoadOptions {
  storageType?: StorageType;
  defaultValue?: any;
  skipExpiredCheck?: boolean;
}

/**
 * 저장된 데이터 구조
 */
interface StorageData<T> {
  data: T;
  timestamp: number;
  expiryTime?: number;
}

/**
 * 데이터 저장 (기본적으로 두 스토리지에 모두 저장)
 * @param key 저장 키
 * @param data 저장할 데이터
 * @param options 저장 옵션
 * @returns Promise<void>
 */
export async function saveData<T>(key: string, data: T, options: SaveOptions = {}): Promise<void> {
  const { storageType = StorageType.BOTH, expiryTime } = options;
  
  // 저장할 데이터 포맷팅
  const storageData: StorageData<T> = {
    data,
    timestamp: Date.now(),
    expiryTime
  };
  
  try {
    const tasks: Promise<void>[] = [];
    
    // 로컬 스토리지 저장
    if (storageType === StorageType.LOCAL_STORAGE || storageType === StorageType.BOTH) {
      tasks.push(LocalStorage.saveToLocalStorage(key, storageData));
    }
    
    // IndexedDB 저장
    if (storageType === StorageType.INDEXED_DB || storageType === StorageType.BOTH) {
      const storeMapping: Record<string, string> = {
        [STORAGE_KEYS.TANK_VALVE_STATE]: IndexedDB.DB_CONFIG.STORES.VALVE_STATE,
        [STORAGE_KEYS.SYSTEM_STATE]: IndexedDB.DB_CONFIG.STORES.SYSTEM_STATE,
        [STORAGE_KEYS.TEMPERATURE_DATA]: IndexedDB.DB_CONFIG.STORES.TEMPERATURE_DATA
      };
      
      const storeName = storeMapping[key] || IndexedDB.DB_CONFIG.STORES.SYSTEM_STATE;
      tasks.push(IndexedDB.saveToIndexedDB(storeName, key, storageData));
    }
    
    await Promise.all(tasks);
    console.log(`[Storage] 데이터 저장 완료 (${key})`);
  } catch (error) {
    console.error(`[Storage] 데이터 저장 실패 (${key}):`, error);
    throw error;
  }
}

/**
 * 데이터 로드
 * @param key 로드할 키
 * @param options 로드 옵션
 * @returns Promise<T | null>
 */
export async function loadData<T>(key: string, options: LoadOptions = {}): Promise<T | null> {
  const { 
    storageType = StorageType.BOTH, 
    defaultValue = null,
    skipExpiredCheck = false
  } = options;
  
  try {
    let storageData: StorageData<T> | null = null;
    
    // IndexedDB에서 우선 시도
    if (storageType === StorageType.INDEXED_DB || storageType === StorageType.BOTH) {
      const storeMapping: Record<string, string> = {
        [STORAGE_KEYS.TANK_VALVE_STATE]: IndexedDB.DB_CONFIG.STORES.VALVE_STATE,
        [STORAGE_KEYS.SYSTEM_STATE]: IndexedDB.DB_CONFIG.STORES.SYSTEM_STATE,
        [STORAGE_KEYS.TEMPERATURE_DATA]: IndexedDB.DB_CONFIG.STORES.TEMPERATURE_DATA
      };
      
      const storeName = storeMapping[key] || IndexedDB.DB_CONFIG.STORES.SYSTEM_STATE;
      storageData = await IndexedDB.loadFromIndexedDB<StorageData<T>>(storeName, key);
    }
    
    // IndexedDB에서 찾지 못했고 LocalStorage 옵션이 활성화된 경우
    if (!storageData && (storageType === StorageType.LOCAL_STORAGE || storageType === StorageType.BOTH)) {
      storageData = LocalStorage.loadFromLocalStorage<StorageData<T>>(key);
    }
    
    // 데이터를 찾지 못한 경우
    if (!storageData) {
      return defaultValue;
    }
    
    // 만료 시간 확인 (skipExpiredCheck가 false인 경우에만)
    if (!skipExpiredCheck && storageData.expiryTime) {
      const currentTime = Date.now();
      const expiryTimestamp = storageData.timestamp + storageData.expiryTime;
      
      if (currentTime > expiryTimestamp) {
        console.log(`[Storage] 데이터 만료됨 (${key})`);
        await removeData(key, { storageType });
        return defaultValue;
      }
    }
    
    console.log(`[Storage] 데이터 로드 완료 (${key})`);
    return storageData.data;
  } catch (error) {
    console.error(`[Storage] 데이터 로드 실패 (${key}):`, error);
    return defaultValue;
  }
}

/**
 * 데이터 삭제
 * @param key 삭제할 키
 * @param options 삭제 옵션
 * @returns Promise<void>
 */
export async function removeData(key: string, options: { storageType?: StorageType } = {}): Promise<void> {
  const { storageType = StorageType.BOTH } = options;
  
  try {
    const tasks: Promise<void>[] = [];
    
    // 로컬 스토리지 삭제
    if (storageType === StorageType.LOCAL_STORAGE || storageType === StorageType.BOTH) {
      tasks.push(LocalStorage.removeFromLocalStorage(key));
    }
    
    // IndexedDB 삭제
    if (storageType === StorageType.INDEXED_DB || storageType === StorageType.BOTH) {
      const storeMapping: Record<string, string> = {
        [STORAGE_KEYS.TANK_VALVE_STATE]: IndexedDB.DB_CONFIG.STORES.VALVE_STATE,
        [STORAGE_KEYS.SYSTEM_STATE]: IndexedDB.DB_CONFIG.STORES.SYSTEM_STATE,
        [STORAGE_KEYS.TEMPERATURE_DATA]: IndexedDB.DB_CONFIG.STORES.TEMPERATURE_DATA
      };
      
      const storeName = storeMapping[key] || IndexedDB.DB_CONFIG.STORES.SYSTEM_STATE;
      tasks.push(IndexedDB.removeFromIndexedDB(storeName, key));
    }
    
    await Promise.all(tasks);
    console.log(`[Storage] 데이터 삭제 완료 (${key})`);
  } catch (error) {
    console.error(`[Storage] 데이터 삭제 실패 (${key}):`, error);
    throw error;
  }
}

/**
 * 모든 데이터 삭제
 * @param options 삭제 옵션
 * @returns Promise<void>
 */
export async function clearAllData(options: { storageType?: StorageType } = {}): Promise<void> {
  const { storageType = StorageType.BOTH } = options;
  
  try {
    const tasks: Promise<void>[] = [];
    
    // 로컬 스토리지 전체 삭제
    if (storageType === StorageType.LOCAL_STORAGE || storageType === StorageType.BOTH) {
      tasks.push(LocalStorage.clearLocalStorage());
    }
    
    // IndexedDB 전체 삭제
    if (storageType === StorageType.INDEXED_DB || storageType === StorageType.BOTH) {
      const storeNames = Object.values(IndexedDB.DB_CONFIG.STORES);
      const storeCleanupTasks = storeNames.map(storeName => 
        IndexedDB.clearIndexedDBStore(storeName)
      );
      tasks.push(...storeCleanupTasks);
    }
    
    await Promise.all(tasks);
    console.log('[Storage] 모든 데이터 삭제 완료');
  } catch (error) {
    console.error('[Storage] 모든 데이터 삭제 실패:', error);
    throw error;
  }
}

// 편의를 위한 내보내기
export { 
  LocalStorage,
  IndexedDB 
}; 