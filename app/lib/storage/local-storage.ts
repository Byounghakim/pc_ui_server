"use client";

/**
 * 로컬 스토리지 키 상수 정의
 */
export const LOCAL_STORAGE_KEYS = {
  TANK_VALVE_STATE: 'tank_valve_state',
  TEMPERATURE_DATA: 'temperature_data',
  // 필요한 다른 키를 여기에 추가
};

/**
 * 로컬 스토리지에 데이터 저장
 * @param key 저장 키
 * @param data 저장할 데이터
 * @returns Promise<void>
 */
export function saveToLocalStorage<T>(key: string, data: T): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // 브라우저 환경인지 확인
      if (typeof window === 'undefined' || !window.localStorage) {
        console.warn('[LocalStorage] 로컬 스토리지를 사용할 수 없습니다.');
        resolve();
        return;
      }
      
      // 데이터를 JSON 문자열로 변환
      const jsonData = JSON.stringify(data);
      
      // 로컬 스토리지에 저장
      localStorage.setItem(key, jsonData);
      console.log(`[LocalStorage] 데이터 저장 완료 (${key})`);
      resolve();
    } catch (error) {
      console.error(`[LocalStorage] 데이터 저장 실패 (${key}):`, error);
      reject(error);
    }
  });
}

/**
 * 로컬 스토리지에서 데이터 로드
 * @param key 로드할 키
 * @returns T | null
 */
export function loadFromLocalStorage<T>(key: string): T | null {
  try {
    // 브라우저 환경인지 확인
    if (typeof window === 'undefined' || !window.localStorage) {
      console.warn('[LocalStorage] 로컬 스토리지를 사용할 수 없습니다.');
      return null;
    }
    
    // 로컬 스토리지에서 데이터 가져오기
    const jsonData = localStorage.getItem(key);
    
    // 데이터가 없는 경우
    if (!jsonData) {
      console.log(`[LocalStorage] 데이터가 없습니다 (${key})`);
      return null;
    }
    
    // JSON 파싱
    try {
      const data = JSON.parse(jsonData) as T;
      console.log(`[LocalStorage] 데이터 로드 완료 (${key})`);
      return data;
    } catch (parseError) {
      console.error(`[LocalStorage] JSON 파싱 실패 (${key}):`, parseError);
      return null;
    }
  } catch (error) {
    console.error(`[LocalStorage] 데이터 로드 실패 (${key}):`, error);
    return null;
  }
}

/**
 * 로컬 스토리지에서 특정 키의 데이터 삭제
 * @param key 삭제할 키
 * @returns Promise<void>
 */
export function removeFromLocalStorage(key: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // 브라우저 환경인지 확인
      if (typeof window === 'undefined' || !window.localStorage) {
        console.warn('[LocalStorage] 로컬 스토리지를 사용할 수 없습니다.');
        resolve();
        return;
      }
      
      // 로컬 스토리지에서 항목 삭제
      localStorage.removeItem(key);
      console.log(`[LocalStorage] 데이터 삭제 완료 (${key})`);
      resolve();
    } catch (error) {
      console.error(`[LocalStorage] 데이터 삭제 실패 (${key}):`, error);
      reject(error);
    }
  });
}

/**
 * 로컬 스토리지 전체 삭제
 * @returns Promise<void>
 */
export function clearLocalStorage(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // 브라우저 환경인지 확인
      if (typeof window === 'undefined' || !window.localStorage) {
        console.warn('[LocalStorage] 로컬 스토리지를 사용할 수 없습니다.');
        resolve();
        return;
      }
      
      // 로컬 스토리지 전체 삭제
      localStorage.clear();
      console.log('[LocalStorage] 로컬 스토리지 전체 삭제 완료');
      resolve();
    } catch (error) {
      console.error('[LocalStorage] 로컬 스토리지 전체 삭제 실패:', error);
      reject(error);
    }
  });
}

/**
 * 로컬 스토리지의 모든 키 가져오기
 * @returns Promise<string[]>
 */
export function getAllLocalStorageKeys(): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    try {
      // 브라우저 환경인지 확인
      if (typeof window === 'undefined' || !window.localStorage) {
        console.warn('[LocalStorage] 로컬 스토리지를 사용할 수 없습니다.');
        resolve([]);
        return;
      }
      
      // 모든 키 가져오기
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          keys.push(key);
        }
      }
      
      console.log(`[LocalStorage] ${keys.length}개의 키를 찾았습니다.`);
      resolve(keys);
    } catch (error) {
      console.error('[LocalStorage] 키 목록 가져오기 실패:', error);
      reject(error);
    }
  });
}

/**
 * 로컬 스토리지에 특정 키가 존재하는지 확인
 * @param key 확인할 키
 * @returns boolean
 */
export function hasLocalStorageKey(key: string): boolean {
  try {
    // 브라우저 환경인지 확인
    if (typeof window === 'undefined' || !window.localStorage) {
      console.warn('[LocalStorage] 로컬 스토리지를 사용할 수 없습니다.');
      return false;
    }
    
    // 키가 존재하는지 확인
    return localStorage.getItem(key) !== null;
  } catch (error) {
    console.error(`[LocalStorage] 키 확인 실패 (${key}):`, error);
    return false;
  }
}

/**
 * 특정 함수를 감싸서 로컬 스토리지에서 데이터를 가져오고 저장하는 기능 추가
 * @param key 사용할 로컬 스토리지 키
 * @param originalFn 원본 함수
 * @returns 로컬 스토리지 지원이 추가된 함수
 */
export function withLocalStorage<T, R>(
  key: string,
  originalFn: (data: T) => R
): (data: T) => R {
  return (data: T) => {
    try {
      // 저장된 데이터 로드
      const savedData = loadFromLocalStorage<T>(key);
      
      // 원본 함수 실행 (저장된 데이터와 함께)
      const result = originalFn(savedData !== null ? { ...data, savedData } : data);
      
      // 결과 저장
      saveToLocalStorage(key, result);
      
      return result;
    } catch (error) {
      console.error(`[localStorage] withLocalStorage 오류 (${key}):`, error);
      return originalFn(data);
    }
  };
} 