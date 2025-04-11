const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

// 데이터 저장 경로
const DATA_DIR = path.join(__dirname, '..', 'data');
const SEQUENCES_FILE = path.join(DATA_DIR, 'sequences.json');
const STATE_FILE = path.join(DATA_DIR, 'system-state.json');

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());

// 헬스 체크 엔드포인트 추가
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: '서버가 정상적으로 실행 중입니다.' });
});

// JSON 문자열 정제 함수 추가
function sanitizeJsonString(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') {
    return '{}';
  }
  
  try {
    // 기본 문자열 정리 (시작과 끝의 공백 제거)
    let sanitized = jsonString.trim();
    
    // JSON 시작과 끝 검사
    if (!sanitized.startsWith('{') && !sanitized.startsWith('[')) {
      return '{}';
    }
    
    // 불필요한 문자 제거를 위한 정규식
    const validJsonRegex = /([\[\{].*?[\]\}])/s;
    const match = sanitized.match(validJsonRegex);
    if (match && match[1]) {
      sanitized = match[1];
    }
    
    // 문자열이 유효한 JSON인지 테스트
    JSON.parse(sanitized);
    return sanitized;
  } catch (e) {
    console.warn('JSON 정제 중 오류, 빈 객체 반환:', e);
    return '{}';
  }
}

// 데이터 디렉토리 확인 및 생성
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch (error) {
    // 디렉토리가 없으면 생성
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`데이터 디렉토리 생성됨: ${DATA_DIR}`);
  }
}

// 시퀀스 저장 API
app.post('/api/sequences', async (req, res) => {
  try {
    await ensureDataDir();
    const sequences = req.body;
    await fs.writeFile(SEQUENCES_FILE, JSON.stringify(sequences, null, 2));
    res.status(200).json({ success: true, message: '시퀀스가 성공적으로 저장되었습니다.' });
  } catch (error) {
    console.error('시퀀스 저장 중 오류:', error);
    res.status(500).json({ success: false, message: '시퀀스 저장 중 오류가 발생했습니다.' });
  }
});

// 시퀀스 불러오기 API
app.get('/api/sequences', async (req, res) => {
  try {
    await ensureDataDir();
    try {
      const data = await fs.readFile(SEQUENCES_FILE, 'utf8');
      // 데이터가 비어있거나 유효하지 않은 경우 처리
      if (!data || data.trim() === '') {
        res.status(200).json([]);
        return;
      }
      
      try {
        const sequences = JSON.parse(data);
        res.status(200).json(sequences);
      } catch (parseError) {
        console.error('시퀀스 JSON 파싱 오류:', parseError);
        // 파싱 오류 발생 시 빈 배열 반환
        res.status(200).json([]);
      }
    } catch (readError) {
      // 파일이 없거나 읽을 수 없는 경우 빈 배열 반환
      if (readError.code === 'ENOENT') {
        res.status(200).json([]);
      } else {
        throw readError;
      }
    }
  } catch (error) {
    console.error('시퀀스 불러오기 중 오류:', error);
    res.status(500).json({ success: false, message: '시퀀스 불러오기 중 오류가 발생했습니다.' });
  }
});

// 상태 저장 API
app.post('/api/state', async (req, res) => {
  try {
    await ensureDataDir();
    const state = req.body;
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    res.status(200).json({ success: true, message: '상태가 성공적으로 저장되었습니다.' });
  } catch (error) {
    console.error('상태 저장 중 오류:', error);
    res.status(500).json({ success: false, message: '상태 저장 중 오류가 발생했습니다.' });
  }
});

// 상태 불러오기 API
app.get('/api/system-state', async (req, res) => {
  try {
    await ensureDataDir();
    try {
      const data = await fs.readFile(STATE_FILE, 'utf8');
      // 데이터가 비어있거나 유효하지 않은 경우 처리
      if (!data || data.trim() === '') {
        res.status(200).json(null);
        return;
      }
      
      try {
        // 데이터 정제 후 파싱
        const sanitizedData = sanitizeJsonString(data);
        const state = JSON.parse(sanitizedData);
        res.status(200).json(state);
      } catch (parseError) {
        console.error('JSON 파싱 오류:', parseError);
        // 파싱 오류 발생 시 null 반환
        res.status(200).json(null);
      }
    } catch (readError) {
      // 파일이 없거나 읽을 수 없는 경우 null 반환
      if (readError.code === 'ENOENT') {
        res.status(200).json(null);
      } else {
        throw readError;
      }
    }
  } catch (error) {
    console.error('상태 불러오기 중 오류:', error);
    res.status(500).json({ success: false, message: '상태 불러오기 중 오류가 발생했습니다.' });
  }
});

// 시스템 상태 저장 API
app.post('/api/system-state', async (req, res) => {
  try {
    await ensureDataDir();
    
    // 요청 본문 검증
    const stateData = req.body;
    if (!stateData) {
      res.status(400).json({ success: false, message: '유효하지 않은 데이터입니다.' });
      return;
    }
    
    try {
      // 저장할 데이터에 타임스탬프 추가
      const dataToSave = {
        ...stateData,
        timestamp: new Date().toISOString()
      };
      
      // 데이터 저장
      await fs.writeFile(STATE_FILE, JSON.stringify(dataToSave, null, 2));
      res.status(200).json({ success: true, message: '시스템 상태가 성공적으로 저장되었습니다.' });
    } catch (writeError) {
      console.error('상태 저장 중 오류:', writeError);
      res.status(500).json({ success: false, message: '상태 저장 중 오류가 발생했습니다.' });
    }
  } catch (error) {
    console.error('상태 저장 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '상태 저장 처리 중 오류가 발생했습니다.' });
  }
});

// 작업 로그 파일 경로 설정
const WORK_LOGS_FILE = path.join(DATA_DIR, 'work-logs.json');

// 작업 로그 저장 API
app.post('/api/work-logs', async (req, res) => {
  try {
    await ensureDataDir();
    // 기존 로그 불러오기
    let logs = [];
    try {
      const data = await fs.readFile(WORK_LOGS_FILE, 'utf8');
      // 데이터가 비어있거나 유효하지 않은 경우 처리
      if (data && data.trim() !== '') {
        try {
          // 데이터 정제 후 파싱
          const sanitizedData = sanitizeJsonString(data);
          logs = JSON.parse(sanitizedData);
          // logs가 배열이 아니면 초기화
          if (!Array.isArray(logs)) {
            console.warn('작업 로그 파일이 배열 형식이 아닙니다. 초기화합니다.');
            logs = [];
          }
        } catch (parseError) {
          console.error('작업 로그 JSON 파싱 오류:', parseError);
          // 파싱 오류 발생 시 빈 배열 사용
          logs = [];
        }
      }
    } catch (readError) {
      // 파일이 없는 경우 새로운 배열 사용
      if (readError.code !== 'ENOENT') {
        throw readError;
      }
    }
    
    // 새 로그 추가
    const newLog = req.body;
    logs.push(newLog);
    
    // 저장
    await fs.writeFile(WORK_LOGS_FILE, JSON.stringify(logs, null, 2));
    res.status(200).json({ success: true, message: '작업 로그가 성공적으로 저장되었습니다.' });
  } catch (error) {
    console.error('작업 로그 저장 중 오류:', error);
    res.status(500).json({ success: false, message: '작업 로그 저장 중 오류가 발생했습니다.' });
  }
});

// 작업 로그 불러오기 API
app.get('/api/work-logs', async (req, res) => {
  try {
    await ensureDataDir();
    try {
      const data = await fs.readFile(WORK_LOGS_FILE, 'utf8');
      // 데이터가 비어있거나 유효하지 않은 경우 처리
      if (!data || data.trim() === '') {
        res.status(200).json([]);
        return;
      }
      
      try {
        // 데이터 정제 후 파싱
        const sanitizedData = sanitizeJsonString(data);
        const logs = JSON.parse(sanitizedData);
        
        // logs가 배열인지 확인
        if (!Array.isArray(logs)) {
          console.warn('작업 로그 파일이 배열 형식이 아닙니다. 빈 배열을 반환합니다.');
          res.status(200).json([]);
          return;
        }
        
        res.status(200).json(logs);
      } catch (parseError) {
        console.error('작업 로그 JSON 파싱 오류:', parseError);
        // 파싱 오류 발생 시 빈 배열 반환
        res.status(200).json([]);
      }
    } catch (readError) {
      // 파일이 없거나 읽을 수 없는 경우 빈 배열 반환
      if (readError.code === 'ENOENT') {
        res.status(200).json([]);
      } else {
        throw readError;
      }
    }
  } catch (error) {
    console.error('작업 로그 불러오기 중 오류:', error);
    res.status(500).json({ success: false, message: '작업 로그 불러오기 중 오류가 발생했습니다.' });
  }
});

// 작업 로그 삭제 API (전체 삭제)
app.delete('/api/work-logs', async (req, res) => {
  try {
    await ensureDataDir();
    try {
      // 빈 배열로 파일을 덮어씁니다
      await fs.writeFile(WORK_LOGS_FILE, JSON.stringify([], null, 2));
      res.status(200).json({ success: true, message: '모든 작업 로그가 성공적으로 삭제되었습니다.' });
    } catch (error) {
      console.error('작업 로그 삭제 중 오류:', error);
      res.status(500).json({ success: false, message: '작업 로그 삭제 중 오류가 발생했습니다.' });
    }
  } catch (error) {
    console.error('작업 로그 삭제 중 오류:', error);
    res.status(500).json({ success: false, message: '작업 로그 삭제 중 오류가 발생했습니다.' });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
}); 