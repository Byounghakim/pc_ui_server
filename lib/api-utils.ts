/**
 * API 유틸리티 모듈
 * 
 * API 호출에 필요한 유틸리티 함수들의 모음입니다.
 * 에러 처리, 타임아웃, 재시도 등 API 호출 관련 기능을 제공합니다.
 */

import { getApiRetryConfig, getApiUrl, debugLog, getEnvironmentConfig } from './environment';

/**
 * 표준 API 에러 클래스
 */
export class ApiError extends Error {
  public status: number;
  public data: any;
  
  constructor(message: string, status: number = 500, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * 타임아웃 에러 클래스
 */
export class TimeoutError extends Error {
  constructor(message: string = '요청이 시간 초과되었습니다.') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * API 요청 옵션 인터페이스
 */
export interface ApiRequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  exponentialBackoff?: boolean;
  skipErrorLogging?: boolean;
}

/**
 * 기본 API 요청 옵션
 */
const defaultRequestOptions: ApiRequestOptions = {
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10초 기본 타임아웃
};

/**
 * API 요청 함수
 * 
 * @param endpoint API 엔드포인트 경로
 * @param options fetch 옵션 및 추가 옵션
 * @returns 응답 데이터
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const config = getEnvironmentConfig();
  const retryConfig = getApiRetryConfig();
  
  // 기본 옵션과 사용자 옵션 합치기
  const mergedOptions: ApiRequestOptions = {
    ...defaultRequestOptions,
    ...options,
  };

  // 재시도 설정
  const maxRetries = options.retries !== undefined ? options.retries : retryConfig.maxRetries;
  const retryDelay = options.retryDelay !== undefined ? options.retryDelay : retryConfig.retryDelay;
  const exponentialBackoff = options.exponentialBackoff !== undefined 
    ? options.exponentialBackoff 
    : retryConfig.exponentialBackoff;

  // 전체 URL 생성
  const url = endpoint.startsWith('http') ? endpoint : getApiUrl(endpoint);
  
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      debugLog(`API 요청 시작 (시도 ${attempt + 1}/${maxRetries + 1}): ${url}`);
      
      // 타임아웃이 포함된 fetch 요청 실행
      const responsePromise = fetch(url, mergedOptions);
      const response = await withTimeout(responsePromise, mergedOptions.timeout || defaultRequestOptions.timeout);
      
      // 요청이 성공적으로 완료되었지만 HTTP 에러 상태인 경우
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: `HTTP 오류: ${response.status} ${response.statusText}` };
        }
        
        throw new ApiError(
          errorData.message || `HTTP 오류: ${response.status} ${response.statusText}`,
          response.status,
          errorData
        );
      }
      
      // 응답이 비어있는 경우 처리
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return {} as T;
      }
      
      // JSON 파싱 시도
      try {
        const data = await response.json();
        debugLog(`API 응답 성공: ${url}`, { status: response.status });
        return data as T;
      } catch (e) {
        // JSON이 아닌 응답을 처리
        debugLog(`API 응답이 JSON 형식이 아닙니다: ${url}`);
        return {} as T;
      }
    } catch (error: any) {
      lastError = error;
      attempt++;
      
      // 더 이상 재시도하지 않을 경우
      if (attempt > maxRetries) {
        break;
      }
      
      // 지수 백오프를 사용하여 재시도 지연 시간 계산
      const delay = exponentialBackoff
        ? retryDelay * Math.pow(2, attempt - 1)
        : retryDelay;
      
      debugLog(`API 요청 실패, ${delay}ms 후 재시도 (${attempt}/${maxRetries}): ${url}`, {
        error: error.message,
        status: error instanceof ApiError ? error.status : undefined,
      });
      
      // 지연 후 재시도
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // 모든 재시도가 실패한 경우
  if (!mergedOptions.skipErrorLogging) {
    console.error(`API 요청 최종 실패: ${url}`, lastError);
  }
  
  throw lastError || new Error('알 수 없는 API 오류가 발생했습니다.');
}

/**
 * GET 요청 헬퍼 함수
 */
export async function get<T = any>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(endpoint, { ...options, method: 'GET' });
}

/**
 * POST 요청 헬퍼 함수
 */
export async function post<T = any>(endpoint: string, data: any, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(endpoint, {
    ...options,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * PUT 요청 헬퍼 함수
 */
export async function put<T = any>(endpoint: string, data: any, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(endpoint, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * DELETE 요청 헬퍼 함수
 */
export async function del<T = any>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(endpoint, { ...options, method: 'DELETE' });
}

/**
 * PATCH 요청 헬퍼 함수
 */
export async function patch<T = any>(endpoint: string, data: any, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(endpoint, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * 타임아웃이 있는 Promise 생성 유틸리티
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(`요청이 ${timeoutMs}ms 후 시간 초과되었습니다.`));
    }, timeoutMs);
    
    promise
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * 표준 HTTP 상태 검사 유틸리티
 */
export const HttpStatus = {
  isSuccess: (status: number) => status >= 200 && status < 300,
  isRedirect: (status: number) => status >= 300 && status < 400,
  isClientError: (status: number) => status >= 400 && status < 500,
  isServerError: (status: number) => status >= 500 && status < 600,
  
  isNotFound: (status: number) => status === 404,
  isUnauthorized: (status: number) => status === 401,
  isForbidden: (status: number) => status === 403,
  isBadRequest: (status: number) => status === 400,
  isInternalServerError: (status: number) => status === 500,
};

/**
 * API 응답 표준화 유틸리티
 */
export function standardizeResponse<T>(data: T): { success: boolean; data: T; error?: null } {
  return {
    success: true,
    data,
    error: null,
  };
}

/**
 * API 에러 응답 표준화 유틸리티
 */
export function standardizeError(error: Error): { success: false; data: null; error: { message: string; code?: number; details?: any } } {
  if (error instanceof ApiError) {
    return {
      success: false,
      data: null,
      error: {
        message: error.message,
        code: error.status,
        details: error.data,
      },
    };
  }
  
  return {
    success: false,
    data: null,
    error: {
      message: error.message || '알 수 없는 오류가 발생했습니다.',
    },
  };
}

/**
 * API 응답 페이지네이션 유틸리티
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 페이지네이션 함수 생성 유틸리티
 */
export function createPagination<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
} 