import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis-client';
import { v4 as uuidv4 } from 'uuid';

// Redis에 저장할 키 이름 - 자동화 공정과 동일한 키를 사용하고 processes 배열 내에 저장
const PROCESS_KEY = 'automation:processes';
const DEFAULT_PROCESS_NAME = '기본 작업목록 프로세스';

// 기본 자동화 공정 데이터
const DEFAULT_PROCESS = {
  id: '',
  name: DEFAULT_PROCESS_NAME,
  sequences: [],
  createdAt: '',
  updatedAt: ''
};

// 브라우저에서 로컬 스토리지 대신 메모리 캐시 사용 (서버에서 실행 시)
const memoryCache = {
  data: null as string | null,
};

// API 응답 로깅 함수
function logResponse(method: string, success: boolean, message: string) {
  const timestamp = new Date().toISOString();
  const status = success ? '성공' : '실패';
  console.log(`[${timestamp}] [${method}] [${status}] ${message}`);
}

/**
 * 로컬 캐시에서 시퀀스 가져오기
 */
function getSequencesFromCache() {
  try {
    if (memoryCache.data) {
      return JSON.parse(memoryCache.data);
    }
  } catch (e) {
    console.error('캐시 데이터 파싱 오류:', e);
  }
  return { sequences: [] };
}

/**
 * 로컬 캐시에 시퀀스 저장
 */
function saveSequencesToCache(data: any) {
  try {
    memoryCache.data = JSON.stringify(data);
    return true;
  } catch (e) {
    console.error('캐시 데이터 저장 오류:', e);
    return false;
  }
}

// 내부 백엔드 API URL (동일 서버의 다른 포트)
const BACKEND_API_URL = '/api/sequences';

/**
 * 시퀀스 목록 조회 API
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[시퀀스 API] GET 요청 시작');
    
    // 로컬 캐시 사용 또는 Redis 직접 조회
    try {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      console.log('[시퀀스 API] Redis 클라이언트 가져옴, 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
      
      // 기존 데이터 가져오기
      const existingData = await redis.get(PROCESS_KEY);
      let processesData = { processes: [] };
      
      if (existingData) {
        try {
          processesData = JSON.parse(existingData);
          console.log('[시퀀스 API] 기존 데이터 파싱 성공');
        } catch (e) {
          console.error('[시퀀스 API] 기존 데이터 파싱 오류:', e);
          return NextResponse.json({
            sequences: []
          });
        }
      }
      
      // 모든 프로세스에서 시퀀스 추출
      const allSequences = [];
      if (processesData.processes && Array.isArray(processesData.processes)) {
        for (const process of processesData.processes) {
          if (process.sequences && Array.isArray(process.sequences)) {
            allSequences.push(...process.sequences);
          }
        }
      }
      
      // 캐시 업데이트
      saveSequencesToCache({ sequences: allSequences });
      
      // 연결 종료
      await redis.quit();
      
      return NextResponse.json({ sequences: allSequences });
    } catch (redisError) {
      console.error('[시퀀스 API] Redis 조회 오류, 캐시 사용:', redisError);
      // Redis 연결 실패시 캐시 사용
      const cachedData = getSequencesFromCache();
      return NextResponse.json(cachedData);
    }
  } catch (error) {
    console.error('[시퀀스 API] 시퀀스 조회 중 오류:', error);
    return NextResponse.json({ sequences: [] }, { status: 200 });
  }
}

/**
 * 시퀀스 저장 API - 자동화 공정 내부에 저장
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[시퀀스 API] POST 요청 시작');
    
    // 요청 본문 처리 로직 개선
    let sequences = [];
    try {
      // 요청 본문 가져오기
      const requestText = await request.text();
      console.log('[시퀀스 API] 요청 본문 텍스트:', requestText.substring(0, 200) + (requestText.length > 200 ? '...' : ''));
      
      if (!requestText || requestText.trim() === '') {
        console.error('[시퀀스 API] 빈 요청 본문');
        return NextResponse.json({ 
          success: false, 
          error: '시퀀스 데이터가 없습니다.' 
        }, { status: 400 });
      }

      // JSON 파싱
      const body = JSON.parse(requestText);
      console.log('[시퀀스 API] 요청 본문 객체 타입:', typeof body, Array.isArray(body) ? 'array' : 'object');
      
      // 다양한 형식 지원: 배열, {sequences: [...]} 또는 {data: {sequences: [...]}}
      if (Array.isArray(body)) {
        sequences = body;
      } else if (body.sequences && Array.isArray(body.sequences)) {
        sequences = body.sequences;
      } else if (body.data && body.data.sequences && Array.isArray(body.data.sequences)) {
        sequences = body.data.sequences;
      } else {
        // 단일 객체인 경우 배열로 변환
        sequences = [body];
      }
      
      console.log('[시퀀스 API] 추출된 시퀀스 갯수:', sequences.length);
    } catch (parseError) {
      console.error('[시퀀스 API] 요청 본문 파싱 오류:', parseError);
      return NextResponse.json({ 
        success: false, 
        error: '유효하지 않은 JSON 형식입니다.' 
      }, { status: 400 });
    }
    
    // 시퀀스 배열 기본 검증
    if (!sequences || sequences.length === 0) {
      console.error('[시퀀스 API] 비어있는 시퀀스 배열');
      return NextResponse.json({ 
        success: false, 
        error: '저장할 시퀀스가 없습니다.' 
      }, { status: 400 });
    }

    try {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      console.log('[시퀀스 API] Redis 클라이언트 가져옴, 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
      
      // 기존 데이터 가져오기
      const existingData = await redis.get(PROCESS_KEY);
      let processesData = { 
        processes: [] 
      };
      
      if (existingData) {
        try {
          processesData = JSON.parse(existingData);
          console.log('[시퀀스 API] 기존 데이터 파싱 성공');
        } catch (e) {
          console.error('[시퀀스 API] 기존 데이터 파싱 오류:', e);
          // 파싱 오류 시 새 데이터 구조 생성
          processesData = { processes: [] };
        }
      }
      
      // 기본 프로세스 확인 (없으면 생성)
      let defaultProcess = processesData.processes.find(p => p.name === DEFAULT_PROCESS_NAME);
      
      if (!defaultProcess) {
        defaultProcess = {
          ...DEFAULT_PROCESS,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sequences: []
        };
        processesData.processes.push(defaultProcess);
        console.log('[시퀀스 API] 기본 프로세스 생성됨');
      }
      
      // 시퀀스 업데이트
      defaultProcess.sequences = sequences;
      defaultProcess.updatedAt = new Date().toISOString();
      
      // Redis에 저장
      await redis.set(PROCESS_KEY, JSON.stringify(processesData));
      console.log('[시퀀스 API] 시퀀스 저장 완료');
      
      // 캐시 업데이트
      saveSequencesToCache({ sequences: sequences });
      
      // 연결 종료
      await redis.quit();
      
      return NextResponse.json({ 
        success: true, 
        message: '시퀀스가 저장되었습니다.' 
      });
    } catch (redisError) {
      console.error('[시퀀스 API] Redis 저장 오류:', redisError);
      // Redis 연결 실패 시 캐시에만 저장
      const saved = saveSequencesToCache({ sequences: sequences });
      
      if (saved) {
        console.log('[시퀀스 API] 시퀀스가 로컬 캐시에 저장됨');
        return NextResponse.json({ 
          success: true, 
          message: '시퀀스가 로컬 캐시에 저장되었습니다. (Redis 사용 불가)' 
        });
      } else {
        return NextResponse.json({ 
          success: false, 
          error: '시퀀스 저장에 실패했습니다. (로컬 캐시 저장 실패)' 
        }, { status: 500 });
      }
    }
  } catch (error) {
    console.error('[시퀀스 API] 시퀀스 저장 중 오류:', error);
    return NextResponse.json({ 
      success: false, 
      error: '시퀀스 저장 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}

/**
 * 시퀀스 삭제 API - ID로 특정 시퀀스 삭제 또는 모든 시퀀스 삭제
 */
export async function DELETE(req: NextRequest) {
  try {
    console.log('[시퀀스 API] 시퀀스 삭제 시작');
    
    // URL에서 삭제할 시퀀스 ID 추출
    const url = new URL(req.url);
    const sequenceId = url.searchParams.get('id');
    const deleteAll = url.searchParams.get('all') === 'true';
    
    console.log(`[시퀀스 API] 삭제 요청 유형: ${sequenceId ? '특정 ID 삭제' : (deleteAll ? '전체 삭제' : '삭제 대상 불명')}`);
    
    // 삭제 대상이 없으면 오류 반환
    if (!sequenceId && !deleteAll) {
      console.log('[시퀀스 API] 삭제할 시퀀스 ID가 지정되지 않음');
      return NextResponse.json({
        success: false,
        error: '삭제할 시퀀스 ID가 지정되지 않았습니다. id 쿼리 파라미터를 사용하세요.'
      }, { status: 400 });
    }
    
    try {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      console.log('[시퀀스 API] Redis 클라이언트 가져옴, 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
      
      // 기존 데이터 가져오기
      const existingData = await redis.get(PROCESS_KEY);
      let processesData = { processes: [] };
      
      if (existingData) {
        try {
          processesData = JSON.parse(existingData);
          console.log('[시퀀스 API] 기존 데이터 파싱 성공');
        } catch (e) {
          console.error('[시퀀스 API] 기존 데이터 파싱 오류:', e);
          return NextResponse.json({
            success: false,
            error: '데이터 파싱 오류'
          }, { status: 500 });
        }
      } else {
        console.log('[시퀀스 API] 저장된 데이터가 없음');
        return NextResponse.json({
          success: true,
          message: '저장된 시퀀스가 없습니다.',
          deletedCount: 0
        });
      }
      
      // 모든 시퀀스를 삭제하는 경우
      if (deleteAll) {
        console.log('[시퀀스 API] 모든 시퀀스 삭제 요청');
        
        // 각 프로세스의 시퀀스 배열을 비움
        let totalDeleted = 0;
        
        processesData.processes.forEach(process => {
          if (process.sequences && Array.isArray(process.sequences)) {
            totalDeleted += process.sequences.length;
            process.sequences = [];
            process.updatedAt = new Date().toISOString();
          }
        });
        
        // Redis에 저장
        await redis.set(PROCESS_KEY, JSON.stringify(processesData));
        console.log(`[시퀀스 API] 모든 시퀀스 삭제 완료, 총 ${totalDeleted}개 삭제됨`);
        
        // 캐시 업데이트
        saveSequencesToCache({ sequences: [] });
        
        // 연결 종료
        await redis.quit();
        
        return NextResponse.json({
          success: true,
          message: `모든 시퀀스가 삭제되었습니다.`,
          deletedCount: totalDeleted
        });
      }
      
      // 특정 ID의 시퀀스 삭제
      console.log(`[시퀀스 API] 시퀀스 ID:${sequenceId} 삭제 요청`);
      
      let found = false;
      let deletedSequence = null;
      
      // 각 프로세스를 확인하여 해당 ID의 시퀀스 찾기
      for (const process of processesData.processes) {
        if (process.sequences && Array.isArray(process.sequences)) {
          const originalLength = process.sequences.length;
          
          // 시퀀스 ID로 필터링하여 제거
          const filteredSequences = process.sequences.filter(seq => {
            if (seq.id === sequenceId) {
              deletedSequence = {...seq};
              found = true;
              return false; // 해당 ID 시퀀스 제거
            }
            return true; // 다른 시퀀스 유지
          });
          
          // 시퀀스가 삭제되었다면 프로세스 업데이트
          if (originalLength !== filteredSequences.length) {
            process.sequences = filteredSequences;
            process.updatedAt = new Date().toISOString();
            console.log(`[시퀀스 API] 프로세스(${process.id})에서 시퀀스 삭제됨`);
          }
        }
      }
      
      if (!found) {
        console.log(`[시퀀스 API] 시퀀스 ID:${sequenceId}를 찾을 수 없음`);
        
        // 연결 종료
        await redis.quit();
        
        return NextResponse.json({
          success: false,
          error: `ID가 ${sequenceId}인 시퀀스를 찾을 수 없습니다.`
        }, { status: 404 });
      }
      
      // Redis에 저장
      await redis.set(PROCESS_KEY, JSON.stringify(processesData));
      console.log(`[시퀀스 API] 시퀀스 ID:${sequenceId} 삭제 저장 완료`);
      
      // 캐시 업데이트
      const allSequences = [];
      processesData.processes.forEach(process => {
        if (process.sequences && Array.isArray(process.sequences)) {
          const processSequences = process.sequences.map(seq => ({
            ...seq,
            processId: process.id,
            processName: process.name
          }));
          allSequences.push(...processSequences);
        }
      });
      
      saveSequencesToCache({ sequences: allSequences });
      
      // 연결 종료
      await redis.quit();
      
      return NextResponse.json({
        success: true,
        message: `ID가 ${sequenceId}인 시퀀스가 삭제되었습니다.`,
        deletedSequence,
        remainingCount: allSequences.length
      });
    } catch (redisError) {
      console.error('[시퀀스 API] Redis 처리 중 오류:', redisError);
      
      return NextResponse.json({
        success: false,
        error: `시퀀스 삭제 중 오류가 발생했습니다: ${redisError instanceof Error ? redisError.message : String(redisError)}`
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[시퀀스 API] 시퀀스 삭제 실패 상세:', error);
    
    return NextResponse.json({
      success: false,
      error: '시퀀스 삭제 실패',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// OPTIONS 메서드 추가 (CORS preflight 요청 처리)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
} 