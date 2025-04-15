import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createClient } from 'redis';
import { env, shouldUseLocalStorage, logger, LogLevel, createLogGroup } from '../../config/environment';

// Redis 클라이언트 설정
const redisClient = shouldUseLocalStorage ? null : createClient({
  url: env.redisUrl || `redis://${env.redisHost}:${env.redisPort}`,
  password: env.redisPassword,
});

// Redis 연결 준비
async function connectRedis() {
  if (shouldUseLocalStorage) {
    logger.info('로컬 스토리지 모드 사용 중: Redis 연결 생략됨');
    return null;
  }

  try {
    if (!redisClient?.isOpen) {
      await redisClient?.connect();
      logger.info('Redis 연결 성공');
    }
    return redisClient;
  } catch (error) {
    logger.error('Redis 연결 실패:', error);
    return null;
  }
}

// 로컬 스토리지 관련 함수
const LOCAL_STORAGE_PATH = env.localStoragePath || 'local-redis-state.json';

// 로컬 스토리지에서 데이터 불러오기
function getLocalRedisData() {
  const logGroup = createLogGroup('getLocalRedisData');
  
  try {
    if (!fs.existsSync(LOCAL_STORAGE_PATH)) {
      logger.debug(`로컬 스토리지 파일 없음: ${LOCAL_STORAGE_PATH}`);
      return {};
    }
    
    const data = fs.readFileSync(LOCAL_STORAGE_PATH, 'utf8');
    const parsedData = JSON.parse(data);
    logger.debug(`로컬 스토리지에서 데이터 로드 성공: ${Object.keys(parsedData).length} 항목`);
    logGroup.end();
    return parsedData;
  } catch (error) {
    logger.error('로컬 스토리지에서 데이터 로드 실패:', error);
    logGroup.end();
    return {};
  }
}

// 로컬 스토리지에 데이터 저장하기
function saveLocalRedisData(data: any) {
  const logGroup = createLogGroup('saveLocalRedisData');
  
  try {
    const currentData = getLocalRedisData();
    const newData = { ...currentData, ...data };
    
    // 디렉토리 생성 (없는 경우)
    const directory = path.dirname(LOCAL_STORAGE_PATH);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    
    fs.writeFileSync(LOCAL_STORAGE_PATH, JSON.stringify(newData, null, 2), 'utf8');
    logger.debug(`로컬 스토리지에 데이터 저장 성공: ${Object.keys(data).length} 항목`);
    logGroup.end();
    return true;
  } catch (error) {
    logger.error('로컬 스토리지에 데이터 저장 실패:', error);
    logGroup.end();
    return false;
  }
}

// GET 요청 처리
export async function GET(request: NextRequest) {
  const logGroup = createLogGroup('GET /api/sequences');
  
  try {
    // Redis 연결
    const client = await connectRedis();
    
    if (client) {
      // Redis에서 시퀀스 데이터 불러오기
      const sequences = await client.get('sequences');
      if (sequences) {
        logGroup.log(LogLevel.INFO, '시퀀스 데이터 Redis에서 로드 성공');
        logGroup.end();
        return NextResponse.json(JSON.parse(sequences));
      }
    }
    
    // Redis에 연결할 수 없거나 데이터가 없는 경우 로컬 스토리지 사용
    if (shouldUseLocalStorage) {
      const localData = getLocalRedisData();
      const sequences = localData.sequences || [];
      
      logGroup.log(LogLevel.INFO, '시퀀스 데이터 로컬 스토리지에서 로드 성공');
      logGroup.end();
      return NextResponse.json(sequences);
    }
    
    // 데이터를 찾을 수 없는 경우
    logGroup.log(LogLevel.WARN, '시퀀스 데이터를 찾을 수 없음');
    logGroup.end();
    return NextResponse.json([]);
  } catch (error) {
    logger.error('시퀀스 데이터 로드 중 오류 발생:', error);
    logGroup.end();
    return NextResponse.json({ error: '시퀀스 데이터 로드 중 오류 발생' }, { status: 500 });
  }
}

// POST 요청 처리
export async function POST(request: NextRequest) {
  const logGroup = createLogGroup('POST /api/sequences');
  
  try {
    // 요청 본문 파싱
    let body;
    try {
      // 원시 텍스트로 요청 본문 저장
      const rawText = await request.text();
      logger.debug(`요청 본문 길이: ${rawText.length} 바이트`);
      
      // 요청 본문이 비어 있는 경우
      if (!rawText || rawText.trim() === '') {
        logger.warn('요청 본문이 비어 있음');
        logGroup.end();
        return NextResponse.json({ error: '요청 본문이 비어 있음' }, { status: 400 });
      }
      
      // JSON 파싱 시도
      body = JSON.parse(rawText);
      logger.debug(`요청 본문 타입: ${typeof body}, ${Array.isArray(body) ? '배열' : '객체'}`);
    } catch (error) {
      logger.error('요청 본문 파싱 실패:', error);
      logGroup.end();
      return NextResponse.json({ error: '유효하지 않은 JSON 데이터' }, { status: 400 });
    }
    
    // 요청 본문 유효성 검사 및 시퀀스 추출
    let sequences = [];
    
    // 배열인 경우 직접 사용
    if (Array.isArray(body)) {
      sequences = body;
      logger.debug(`배열 형식의 시퀀스 수신: ${sequences.length}개`);
    } 
    // 객체인 경우 데이터 추출 시도
    else if (body && typeof body === 'object') {
      // 다양한 속성 구조 처리를 시도
      if (body.sequences && Array.isArray(body.sequences)) {
        // {sequences: [...]} 형식
        sequences = body.sequences;
        logger.debug(`객체 내 sequences 속성에서 ${sequences.length}개 시퀀스 발견`);
      } else if (body.data && Array.isArray(body.data)) {
        // {data: [...]} 형식
        sequences = body.data;
        logger.debug(`객체 내 data 속성에서 ${sequences.length}개 시퀀스 발견`);
      } else if (Object.values(body).length > 0 && Array.isArray(Object.values(body)[0])) {
        // {someKey: [...]} 형식 (첫 번째 속성이 배열인 경우)
        sequences = Object.values(body)[0] as any[];
        logger.debug(`객체 내 첫 번째 배열 속성에서 ${sequences.length}개 시퀀스 발견`);
    } else {
        // 단일 객체를 배열로 변환 (예: 단일 시퀀스만 전송된 경우)
        sequences = [body];
        logger.debug(`단일 객체를 시퀀스 배열로 변환`);
      }
    }
    
    // 시퀀스 데이터 검증
    if (!Array.isArray(sequences) || sequences.length === 0) {
      logger.warn('유효한 시퀀스 데이터가 없음');
      logGroup.end();
      return NextResponse.json({ error: '유효한 시퀀스 데이터가 없음' }, { status: 400 });
    }
    
    // 시퀀스 데이터 로깅
    logger.info(`${sequences.length}개 시퀀스 저장 시작`);
    logger.debug(`첫 번째 시퀀스 샘플: ${JSON.stringify(sequences[0]).substring(0, 200)}...`);
      
      // Redis에 저장
    const client = await connectRedis();
    
    if (client) {
      await client.set('sequences', JSON.stringify(sequences));
      logger.info('시퀀스 Redis에 저장 성공');
      logGroup.end();
      return NextResponse.json({
        success: true,
        message: '시퀀스가 성공적으로 저장되었습니다.', 
        count: sequences.length 
      });
    }
    
    // Redis 연결 실패 시 로컬 스토리지에 저장
    if (shouldUseLocalStorage) {
      const success = saveLocalRedisData({ sequences });
      
      if (success) {
        logger.info('시퀀스 로컬 스토리지에 저장 성공');
        logGroup.end();
        return NextResponse.json({
          success: true,
          message: '시퀀스가 로컬 스토리지에 저장되었습니다.', 
          count: sequences.length 
        });
      } else {
        logger.error('시퀀스 로컬 스토리지 저장 실패');
        logGroup.end();
        return NextResponse.json({ error: '로컬 스토리지 저장 실패' }, { status: 500 });
      }
    }
    
    logger.error('Redis 및 로컬 스토리지 모두 사용할 수 없음');
    logGroup.end();
    return NextResponse.json({ error: '저장소에 저장할 수 없음' }, { status: 500 });
  } catch (error) {
    logger.error('시퀀스 저장 중 오류 발생:', error);
    logGroup.end();
    return NextResponse.json({ error: '시퀀스 저장 중 오류 발생' }, { status: 500 });
  }
}

// OPTIONS 핸들러 (CORS)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
} 