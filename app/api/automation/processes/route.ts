import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis-client';
import { v4 as uuidv4 } from 'uuid';

// Redis에 저장할 키 이름
const PROCESS_KEY = 'automation:processes';
const SEQUENCES_KEY = 'automation:sequences';

// 자동화 공정 목록 조회
export async function GET(req: NextRequest) {
  try {
    console.log('[자동화 API] 자동화 공정 목록 조회 시작');
    const redis = await getRedisClient();
    console.log('[자동화 API] Redis 클라이언트 가져옴');
    
    // Redis에서 자동화 공정 목록 가져오기
    const data = await redis.get(PROCESS_KEY);
    console.log('[자동화 API] Redis 데이터 조회 완료:', data ? '데이터 있음' : '데이터 없음');
    
    // 시퀀스 데이터도 함께 조회
    const sequencesData = await redis.get(SEQUENCES_KEY);
    console.log('[자동화 API] 시퀀스 데이터 조회 완료:', sequencesData ? '데이터 있음' : '데이터 없음');
    
    // 연결 종료
    await redis.quit();
    
    // 기본값: 빈 배열
    let processes = [];
    
    // 프로세스 데이터 파싱 및 처리
    if (data) {
      try {
        const parsedData = JSON.parse(data);
        console.log('[자동화 API] 파싱된 데이터 구조:', Object.keys(parsedData));
        
        // 데이터 구조 확인 및 변환
        if (parsedData.processes && Array.isArray(parsedData.processes)) {
          // processes 배열이 있는 경우
          processes = parsedData.processes;
          console.log(`[자동화 API] processes 배열에서 ${processes.length}개 프로세스 추출`);
        } else if (parsedData.sequences && Array.isArray(parsedData.sequences)) {
          // sequences 형식인 경우 processes 형식으로 변환
          processes = [{
            id: uuidv4(),
            name: "자동화 프로세스",
            sequences: parsedData.sequences,
            createdAt: new Date().toISOString()
          }];
          console.log('[자동화 API] sequences 데이터를 프로세스로 변환');
        } else if (Array.isArray(parsedData)) {
          // 단순 배열인 경우
          processes = parsedData;
          console.log(`[자동화 API] 배열에서 ${processes.length}개 프로세스 추출`);
        }
      } catch (e) {
        console.error('[자동화 API] 데이터 파싱 오류:', e);
      }
    }
    
    // 시퀀스 데이터가 있다면 병합
    if (!processes.length && sequencesData) {
      try {
        const parsedSequences = JSON.parse(sequencesData);
        console.log('[자동화 API] 파싱된 시퀀스 데이터 구조:', Object.keys(parsedSequences));
        
        // 시퀀스 데이터를 공정으로 변환
        if (parsedSequences.sequences && Array.isArray(parsedSequences.sequences)) {
          processes = [{
            id: uuidv4(),
            name: "기본 자동화 프로세스",
            sequences: parsedSequences.sequences,
            createdAt: new Date().toISOString()
          }];
          console.log('[자동화 API] 별도 시퀀스 데이터를 프로세스로 변환');
        }
      } catch (e) {
        console.error('[자동화 API] 시퀀스 데이터 파싱 오류:', e);
      }
    }
    
    // ID가 없는 항목에 ID 추가 및 중첩 객체 검사
    processes = processes.map(process => {
      // 프로세스 ID 확인
      if (!process.id) {
        console.log('[자동화 API] 프로세스에 ID 추가');
        process = { ...process, id: uuidv4() };
      }
      
      // 프로세스 내 시퀀스에도 ID 추가
      if (process.sequences && Array.isArray(process.sequences)) {
        process.sequences = process.sequences.map(sequence => {
          if (!sequence || typeof sequence !== 'object') {
            // 유효하지 않은 시퀀스는 기본 구조로 대체
            console.log('[자동화 API] 유효하지 않은 시퀀스 감지, 기본 구조로 대체');
            return { id: uuidv4(), name: "기본 시퀀스", process: [] };
          }
          
          if (!sequence.id) {
            console.log('[자동화 API] 시퀀스에 ID 추가');
            return { ...sequence, id: uuidv4() };
          }
          
          // 프로세스 내부 확인
          if (sequence.process && Array.isArray(sequence.process)) {
            sequence.process = sequence.process.map(step => {
              if (!step || typeof step !== 'object') {
                // 유효하지 않은 단계는 기본 구조로 대체
                return { id: uuidv4(), type: "empty" };
              }
              
              if (!step.id) {
                return { ...step, id: uuidv4() };
              }
              
              return step;
            });
          } else {
            // process 배열이 없거나 유효하지 않으면 초기화
            sequence.process = [];
          }
          
          return sequence;
        });
      } else {
        // sequences 배열이 없거나 유효하지 않으면 초기화
        process.sequences = [];
      }
      
      return process;
    });
    
    console.log(`[자동화 API] 최종 반환할 프로세스 수: ${processes.length}`);
    
    // 항상 비어있더라도 processes 배열 형태로 반환
    return NextResponse.json({
      processes: processes
    });
  } catch (error) {
    console.error('[자동화 API] 자동화 공정 목록 조회 실패 상세:', error);
    
    // 오류 발생해도 빈 processes 배열 반환 (클라이언트 호환성)
    return NextResponse.json({
      processes: []
    }, { status: 500 });
  }
}

// 자동화 공정 저장
export async function POST(req: NextRequest) {
  try {
    console.log('[자동화 API] 자동화 공정 저장 시작');
    const redis = await getRedisClient();
    console.log('[자동화 API] Redis 클라이언트 가져옴');
    
    // 요청 데이터 파싱
    const rawData = await req.json();
    console.log('[자동화 API] 받은 데이터 구조:', Object.keys(rawData));
    
    // 데이터 유효성 검증
    if (!rawData) {
      console.log('[자동화 API] 유효하지 않은 데이터');
      return NextResponse.json({
        processes: []
      }, { status: 400 });
    }
    
    let processesToSave = [];
    
    // 다양한 형식의 데이터 처리
    if (rawData.processes && Array.isArray(rawData.processes)) {
      // processes 배열 형식
      processesToSave = rawData.processes;
      console.log(`[자동화 API] processes 필드에서 ${processesToSave.length}개 프로세스 추출`);
    } else if (rawData.sequences && Array.isArray(rawData.sequences)) {
      // sequences 형식
      processesToSave = [{
        id: uuidv4(),
        name: rawData.name || "자동화 프로세스",
        sequences: rawData.sequences,
        createdAt: new Date().toISOString()
      }];
      console.log('[자동화 API] sequences 데이터를 프로세스로 변환');
    } else if (Array.isArray(rawData)) {
      // 배열 형식
      processesToSave = rawData;
      console.log(`[자동화 API] 배열에서 ${processesToSave.length}개 프로세스 추출`);
    } else {
      // 단일 객체
      processesToSave = [{ ...rawData, id: rawData.id || uuidv4() }];
      console.log('[자동화 API] 단일 객체를 프로세스로 변환');
    }
    
    // ID 확인 및 부여 (중첩 객체 포함)
    processesToSave = processesToSave.map(process => {
      // 프로세스 ID 확인
      const processId = process.id || uuidv4();
      console.log(`[자동화 API] 프로세스 ID: ${processId}`);
      
      // 프로세스 내 시퀀스에도 ID 추가
      let sequences = [];
      if (process.sequences && Array.isArray(process.sequences)) {
        sequences = process.sequences.map(sequence => {
          if (!sequence || typeof sequence !== 'object') {
            // 유효하지 않은 시퀀스는 기본 구조로 대체
            return { id: uuidv4(), name: "기본 시퀀스", process: [] };
          }
          
          const sequenceId = sequence.id || uuidv4();
          
          // 시퀀스의 process 배열 확인
          let processSteps = [];
          if (sequence.process && Array.isArray(sequence.process)) {
            processSteps = sequence.process.map(step => {
              if (!step || typeof step !== 'object') {
                // 유효하지 않은 단계는 기본 구조로 대체
                return { id: uuidv4(), type: "empty" };
              }
              
              return { ...step, id: step.id || uuidv4() };
            });
          }
          
          return { 
            ...sequence, 
            id: sequenceId,
            process: processSteps,
            updatedAt: new Date().toISOString()
          };
        });
        console.log(`[자동화 API] ${sequences.length}개 시퀀스 처리 완료`);
      }
      
      return { 
        ...process, 
        id: processId,
        sequences,
        updatedAt: new Date().toISOString(),
        createdAt: process.createdAt || new Date().toISOString()
      };
    });
    
    // Redis 연결 확인
    console.log('[자동화 API] Redis 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
    
    // Redis에 자동화 공정 목록 저장
    console.log('[자동화 API] Redis에 저장 시작');
    
    // 값을 직접 저장하지 않고 기존 데이터와 병합
    const existingData = await redis.get(PROCESS_KEY);
    let dataToSave = { processes: processesToSave };
    
    if (existingData) {
      try {
        const parsed = JSON.parse(existingData);
        if (parsed.processes && Array.isArray(parsed.processes)) {
          // 기존 processes에 새 processes 추가 또는 업데이트
          const existingIds = new Set(parsed.processes.map(p => p.id));
          const newProcesses = processesToSave.filter(p => !existingIds.has(p.id));
          const updatedExistingProcesses = parsed.processes.map(existing => {
            const updateProcess = processesToSave.find(p => p.id === existing.id);
            return updateProcess || existing;
          });
          
          dataToSave = { 
            processes: [...updatedExistingProcesses, ...newProcesses] 
          };
          console.log(`[자동화 API] 기존 프로세스와 병합: 총 ${dataToSave.processes.length}개`);
        }
      } catch (e) {
        console.error('[자동화 API] 기존 데이터 파싱 오류:', e);
      }
    }
    
    await redis.set(PROCESS_KEY, JSON.stringify(dataToSave));
    console.log('[자동화 API] Redis에 저장 완료');
    
    // 연결 종료
    await redis.quit();
    
    // 최종 확인 - processes 배열이 유효한지
    if (!dataToSave.processes || !Array.isArray(dataToSave.processes)) {
      dataToSave.processes = [];
    }
    
    // 클라이언트에서 기대하는 형식으로 변환
    return NextResponse.json({
      processes: dataToSave.processes
    });
  } catch (error) {
    console.error('[자동화 API] 자동화 공정 저장 실패 상세:', error);
    
    // 오류 발생해도 빈 processes 배열 반환 (클라이언트 호환성)
    return NextResponse.json({
      processes: []
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

/**
 * 자동화 공정 삭제 API - ID로 특정 공정 삭제 또는 모든 공정 삭제
 */
export async function DELETE(req: NextRequest) {
  try {
    console.log('[자동화 API] 자동화 공정 삭제 시작');
    
    // 요청이 없는 경우 (직접 API 호출 시) 모든 프로세스 삭제
    if (!req || !req.url) {
      console.log('[자동화 API] 직접 호출을 통한 모든 프로세스 삭제 시작');
      try {
        const client = await getRedisClient();
        await client.del(PROCESS_KEY);
        
        console.log('Redis에서 모든 자동화 프로세스 삭제 성공');
        
        return NextResponse.json({ 
          success: true, 
          message: '모든 자동화 프로세스가 삭제되었습니다.' 
        });
      } catch (error) {
        console.error('자동화 프로세스 삭제 중 오류 발생:', error);
        
        return NextResponse.json(
          { 
            success: false, 
            error: '자동화 프로세스 삭제 중 오류가 발생했습니다.', 
            details: error instanceof Error ? error.message : String(error) 
          }, 
          { status: 500 }
        );
      }
    }
    
    // URL에서 삭제할 공정 ID 추출
    const url = new URL(req.url);
    const processId = url.searchParams.get('id');
    const deleteAll = url.searchParams.get('all') === 'true';
    
    console.log(`[자동화 API] 삭제 요청 유형: ${processId ? '특정 ID 삭제' : (deleteAll ? '전체 삭제' : '삭제 대상 불명')}`);
    
    // 삭제 대상이 없으면 오류 반환
    if (!processId && !deleteAll) {
      console.log('[자동화 API] 삭제할 공정 ID가 지정되지 않음');
      return NextResponse.json({
        success: false,
        error: '삭제할 자동화 공정 ID가 지정되지 않았습니다. id 쿼리 파라미터를 사용하세요.',
        processes: []
      }, { status: 400 });
    }
    
    try {
      // Redis 클라이언트 가져오기
      const redis = await getRedisClient();
      console.log('[자동화 API] Redis 클라이언트 가져옴, 연결 상태:', redis.isOpen ? '연결됨' : '연결 안됨');
      
      // 기존 데이터 가져오기
      const existingData = await redis.get(PROCESS_KEY);
      let processesData = { processes: [] };
      
      if (existingData) {
        try {
          processesData = JSON.parse(existingData);
          console.log('[자동화 API] 기존 데이터 파싱 성공');
        } catch (e) {
          console.error('[자동화 API] 기존 데이터 파싱 오류:', e);
          return NextResponse.json({
            success: false,
            error: '데이터 파싱 오류',
            processes: []
          }, { status: 500 });
        }
      } else {
        console.log('[자동화 API] 저장된 공정이 없음');
        return NextResponse.json({
          success: true,
          message: '저장된 자동화 공정이 없습니다.',
          deletedCount: 0,
          processes: []
        });
      }
      
      // 모든 공정을 삭제하는 경우
      if (deleteAll) {
        console.log('[자동화 API] 모든 공정 삭제 요청');
        
        const deletedCount = processesData.processes.length;
        processesData.processes = [];
        
        // Redis에 저장
        await redis.set(PROCESS_KEY, JSON.stringify(processesData));
        console.log(`[자동화 API] 모든 공정 삭제 완료, 총 ${deletedCount}개 삭제됨`);
        
        // 연결 종료
        await redis.quit();
        
        return NextResponse.json({
          success: true,
          message: `모든 자동화 공정이 삭제되었습니다.`,
          deletedCount,
          processes: []
        });
      }
      
      // 특정 ID의 공정 삭제
      console.log(`[자동화 API] 공정 ID:${processId} 삭제 요청`);
      
      // 해당 ID를 가진 공정 제외
      const originalLength = processesData.processes.length;
      let deletedProcess = null;
      
      processesData.processes = processesData.processes.filter(process => {
        if (process.id === processId) {
          deletedProcess = {...process};
          return false; // 해당 ID 공정 제거
        }
        return true; // 다른 공정 유지
      });
      
      // 공정이 삭제되지 않은 경우
      if (originalLength === processesData.processes.length) {
        console.log(`[자동화 API] 공정 ID:${processId}를 찾을 수 없음`);
        
        // 연결 종료
        await redis.quit();
        
        return NextResponse.json({
          success: false,
          error: `ID가 ${processId}인 자동화 공정을 찾을 수 없습니다.`,
          processes: processesData.processes
        }, { status: 404 });
      }
      
      // Redis에 저장
      await redis.set(PROCESS_KEY, JSON.stringify(processesData));
      console.log(`[자동화 API] 공정 ID:${processId} 삭제 저장 완료`);
      
      // 연결 종료
      await redis.quit();
      
      return NextResponse.json({
        success: true,
        message: `ID가 ${processId}인 자동화 공정이 삭제되었습니다.`,
        deletedProcess,
        processes: processesData.processes
      });
    } catch (redisError) {
      console.error('[자동화 API] Redis 처리 중 오류:', redisError);
      
      return NextResponse.json({
        success: false,
        error: `자동화 공정 삭제 중 오류가 발생했습니다: ${redisError instanceof Error ? redisError.message : String(redisError)}`,
        processes: []
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[자동화 API] 자동화 공정 삭제 실패 상세:', error);
    
    return NextResponse.json({
      success: false,
      error: '자동화 공정 삭제 실패',
      details: error instanceof Error ? error.message : String(error),
      processes: []
    }, { status: 500 });
  }
} 