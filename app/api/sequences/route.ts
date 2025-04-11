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

/**
 * 시퀀스 목록 조회 API
 */
export async function GET(req: NextRequest) {
  try {
    console.log('[시퀀스 API] 시퀀스 목록 조회 시작');
    
    // 클라이언트 IP 확인
    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
    console.log(`[시퀀스 API] 클라이언트 IP: ${clientIp}`);
    
    try {
      // Redis 클라이언트 가져오기 시도
      const redis = await getRedisClient();
      console.log('[시퀀스 API] Redis 클라이언트 가져옴, 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
      
      // Redis에서 자동화 공정 목록 가져오기 (자동화 공정과 동일한 키 사용)
      const data = await redis.get(PROCESS_KEY);
      console.log('[시퀀스 API] Redis 데이터 조회 완료:', data ? '데이터 있음' : '데이터 없음');
      
      // 연결 종료
      await redis.quit();
      
      // 기본값: 빈 배열
      let sequences = [];
      
      if (data) {
        try {
          const parsedData = JSON.parse(data);
          console.log('[시퀀스 API] 파싱된 데이터 구조:', Object.keys(parsedData));
          
          // 자동화 공정 데이터에서 시퀀스 추출
          if (parsedData.processes && Array.isArray(parsedData.processes)) {
            // 모든 프로세스에서 시퀀스 추출
            const allSequences = [];
            parsedData.processes.forEach(process => {
              if (process.sequences && Array.isArray(process.sequences)) {
                // 각 시퀀스에 프로세스 정보 추가
                const processSequences = process.sequences.map(seq => {
                  if (typeof seq === 'object' && seq !== null) {
                    return {
                      ...seq,
                      processId: process.id,
                      processName: process.name
                    };
                  }
                  return seq;
                });
                allSequences.push(...processSequences);
              }
            });
            sequences = allSequences;
          }
          
          // 캐시에 저장
          saveSequencesToCache({ sequences });
        } catch (e) {
          console.error('[시퀀스 API] 데이터 파싱 오류:', e);
        }
      }
      
      // 각 시퀀스에 ID 추가 
      sequences = sequences.map(seq => {
        if (!seq.id) {
          return { ...seq, id: uuidv4() };
        }
        return seq;
      });
      
      // 유효성 검사 - 필수 필드 확인 (client와 호환성)
      sequences = sequences.filter(seq => {
        // 기본적인 객체 형태 확인
        if (!seq || typeof seq !== 'object') return false;
        
        // 필수 필드가 없으면 기본값 설정
        if (typeof seq.operation_mode !== 'number') seq.operation_mode = 0;
        if (!Array.isArray(seq.process)) seq.process = [];
        if (!seq.name) seq.name = "이름 없음";
        if (typeof seq.repeats !== 'number') seq.repeats = 1;
        
        return true;
      });
      
      logResponse('GET', true, `${sequences.length}개의 시퀀스 조회됨`);
      
      // 응답 형식 변경: 클라이언트 기대 형식에 맞게 직접 sequences 배열 반환 
      return NextResponse.json(sequences);
    } catch (redisError) {
      console.error('[시퀀스 API] Redis 처리 중 오류:', redisError);
      logResponse('GET', false, `Redis 오류: ${redisError instanceof Error ? redisError.message : String(redisError)}`);
      
      // Redis 실패 시 캐시에서 데이터 가져오기
      console.log('[시퀀스 API] 로컬 캐시에서 데이터 가져오기 시도');
      const cachedData = getSequencesFromCache();
      
      logResponse('GET', true, `캐시에서 ${cachedData.sequences ? cachedData.sequences.length : 0}개의 시퀀스 조회됨`);
      
      // 캐시 데이터도 배열 형태로 반환
      return NextResponse.json(
        cachedData.sequences || []
      );
    }
  } catch (error) {
    console.error('[시퀀스 API] 시퀀스 목록 조회 실패 상세:', error);
    
    logResponse('GET', false, `오류: ${error instanceof Error ? error.message : String(error)}`);
    
    // 오류 발생 시에도 빈 배열 반환 (클라이언트 호환성)
    return NextResponse.json([], { status: 500 });
  }
}

/**
 * 시퀀스 저장 API - 자동화 공정 내부에 저장
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[시퀀스 API] 시퀀스 저장 시작');
    
    // 클라이언트 IP 확인
    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
    console.log(`[시퀀스 API] 클라이언트 IP: ${clientIp}`);
    
    // 요청 데이터 파싱
    const rawData = await req.json();
    console.log('[시퀀스 API] 받은 데이터 유형:', typeof rawData);
    console.log('[시퀀스 API] 받은 데이터 키:', Object.keys(rawData));
    
    // 데이터 유효성 검증
    if (!rawData) {
      console.log('[시퀀스 API] 유효하지 않은 데이터');
      
      logResponse('POST', false, '유효하지 않은 데이터');
      
      return NextResponse.json({
        success: false,
        error: '유효하지 않은 데이터입니다.'
      }, { status: 400 });
    }
    
    // 새로운 시퀀스 추출
    let newSequences = [];
    
    if (rawData.sequences && Array.isArray(rawData.sequences)) {
      // sequences 배열이 있는 경우
      newSequences = rawData.sequences;
      console.log(`[시퀀스 API] 'sequences' 필드에서 ${newSequences.length}개 시퀀스 발견`);
    } else if (Array.isArray(rawData)) {
      // 배열인 경우
      newSequences = rawData;
      console.log(`[시퀀스 API] 배열에서 ${newSequences.length}개 시퀀스 발견`);
    } else {
      // 단일 객체인 경우
      newSequences = [rawData];
      console.log('[시퀀스 API] 단일 객체 시퀀스 발견');
    }
    
    // 유효성 검사 - 필수 필드 확인
    newSequences = newSequences.filter(seq => {
      return seq && typeof seq === 'object';
    });
    
    if (newSequences.length === 0) {
      console.log('[시퀀스 API] 유효한 시퀀스가 없음');
      
      logResponse('POST', false, '유효한 시퀀스가 없음');
      
      return NextResponse.json({
        success: false,
        error: '유효한 시퀀스가 없습니다.'
      }, { status: 400 });
    }
    
    // ID 추가
    newSequences = newSequences.map(seq => {
      if (!seq.id) {
        return { ...seq, id: uuidv4() };
      }
      return seq;
    });
    
    try {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      console.log('[시퀀스 API] Redis 클라이언트 가져옴, 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
      
      // 기존 데이터 가져오기 (자동화 공정에서)
      const existingData = await redis.get(PROCESS_KEY);
      let processesData = { processes: [] };
      
      if (existingData) {
        try {
          processesData = JSON.parse(existingData);
          console.log('[시퀀스 API] 기존 데이터 파싱 성공');
        } catch (e) {
          console.error('[시퀀스 API] 기존 데이터 파싱 오류:', e);
        }
      }
      
      // 프로세스 배열이 없으면 생성
      if (!Array.isArray(processesData.processes)) {
        processesData.processes = [];
        console.log('[시퀀스 API] 프로세스 배열 초기화');
      }
      
      // 시퀀스 저장을 위한 프로세스 찾기 또는 생성
      let targetProcess = processesData.processes.find(p => p.name === DEFAULT_PROCESS_NAME);
      
      if (!targetProcess) {
        // 기본 프로세스가 없으면 새로 생성
        targetProcess = {
          ...DEFAULT_PROCESS,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        processesData.processes.push(targetProcess);
        console.log('[시퀀스 API] 새 프로세스 생성:', targetProcess.id);
      } else {
        // 기존 프로세스 업데이트 시간 갱신
        targetProcess.updatedAt = new Date().toISOString();
        console.log('[시퀀스 API] 기존 프로세스 사용:', targetProcess.id);
      }
      
      // 새 시퀀스 저장 - 덮어쓰기 방식으로 변경
      if (!Array.isArray(targetProcess.sequences)) {
        targetProcess.sequences = [];
      }
      
      // 새 시퀀스 목록 생성 (덮어쓰기 방식)
      let updatedSequences = [];
      
      // 1. 새 시퀀스에 없는 이름의 기존 시퀀스는 유지
      if (targetProcess.sequences && targetProcess.sequences.length > 0) {
        // 새 시퀀스들의 이름 목록
        const newSequenceNames = newSequences.map(seq => seq.name);
        
        // 이름이 겹치지 않는 기존 시퀀스만 유지
        updatedSequences = targetProcess.sequences.filter(seq => 
          !newSequenceNames.includes(seq.name)
        );
        
        console.log(`[시퀀스 API] 이름 중복 없는 기존 시퀀스 ${updatedSequences.length}개 유지`);
      }
      
      // 2. 모든 새 시퀀스 추가 (이름이 같은 시퀀스는 기존 것을 위에서 걸러냄)
      for (const newSeq of newSequences) {
        // 업데이트 시간 추가
        newSeq.updatedAt = new Date().toISOString();
        newSeq.createdAt = newSeq.createdAt || new Date().toISOString();
        
        // 시퀀스 추가 (이름이 같은 기존 시퀀스는 이미 제외되어 있음)
        updatedSequences.push(newSeq);
        console.log(`[시퀀스 API] 시퀀스 추가/덮어쓰기: ${newSeq.name} (ID: ${newSeq.id})`);
      }
      
      // 업데이트된 시퀀스 배열 저장
      targetProcess.sequences = updatedSequences;
      
      // Redis에 저장
      await redis.set(PROCESS_KEY, JSON.stringify(processesData));
      console.log(`[시퀀스 API] Redis에 ${updatedSequences.length}개 시퀀스 저장 완료 (덮어쓰기 모드)`);
      
      // 로컬 캐시 업데이트
      const allSequences = [];
      processesData.processes.forEach(process => {
        if (process.sequences && Array.isArray(process.sequences)) {
          // 각 시퀀스에 프로세스 정보 추가
          const processSequences = process.sequences.map(seq => ({
            ...seq,
            processId: process.id,
            processName: process.name
          }));
          allSequences.push(...processSequences);
        }
      });
      
      saveSequencesToCache({ sequences: allSequences });
      console.log(`[시퀀스 API] 캐시에 ${allSequences.length}개 시퀀스 저장`);
      
      // 연결 종료
      await redis.quit();
      
      logResponse('POST', true, `${newSequences.length}개 시퀀스 저장됨 (덮어쓰기 모드)`);
      
      return NextResponse.json({
        success: true,
        message: `${newSequences.length}개의 시퀀스가 저장되었습니다 (덮어쓰기 모드).`,
        savedCount: newSequences.length,
        sequences: newSequences
      });
    } catch (redisError) {
      console.error('[시퀀스 API] Redis 처리 중 오류:', redisError);
      
      // 오류 발생 시 로컬 캐시에만 저장
      logResponse('POST', false, `Redis 오류: ${redisError instanceof Error ? redisError.message : String(redisError)}`);
      
      // 로컬 캐시에 백업 - 덮어쓰기 모드 적용
      const cachedData = getSequencesFromCache();
      const cachedSequences = cachedData.sequences || [];
      
      // 새 시퀀스 이름 목록
      const newSequenceNames = newSequences.map(seq => seq.name);
      
      // 이름이 겹치지 않는 기존 시퀀스만 유지
      let mergedSequences = cachedSequences.filter(seq => 
        !newSequenceNames.includes(seq.name)
      );
      
      // 새 시퀀스 추가
      for (const newSeq of newSequences) {
        // 업데이트 시간 추가
        newSeq.updatedAt = new Date().toISOString();
        newSeq.createdAt = newSeq.createdAt || new Date().toISOString();
        
        // 시퀀스 추가
        mergedSequences.push(newSeq);
      }
      
      // 캐시 업데이트
      saveSequencesToCache({ sequences: mergedSequences });
      console.log(`[시퀀스 API] Redis 저장 실패로 캐시에만 ${mergedSequences.length}개 시퀀스 저장 (덮어쓰기 모드)`);
      
      return NextResponse.json({
        success: true,
        message: `${newSequences.length}개의 시퀀스가 로컬에 저장되었습니다 (Redis 저장 실패, 덮어쓰기 모드).`,
        savedCount: newSequences.length,
        fromCache: true,
        redisError: `${redisError instanceof Error ? redisError.message : String(redisError)}`,
        sequences: newSequences
      });
    }
  } catch (error) {
    console.error('[시퀀스 API] 시퀀스 저장 실패 상세:', error);
    
    logResponse('POST', false, `오류: ${error instanceof Error ? error.message : String(error)}`);
    
    return NextResponse.json({
      success: false,
      error: '시퀀스 저장 실패',
      details: error instanceof Error ? error.message : String(error)
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