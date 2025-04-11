import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { WorkLog, LogRetentionPolicy } from '@/app/types';

// 메모리 저장소 (서버리스 환경에서는 재시작 시 초기화됨)
let workLogs: WorkLog[] = [];
let retentionPolicy: LogRetentionPolicy = {
  maxAgeDays: 30,
  maxLogsPerDevice: 1000,
  autoCleanupEnabled: true,
  retainErrorLogs: true,
  lastCleanupTime: Date.now()
};

// 작업 로그 저장
export async function POST(request: NextRequest) {
  try {
    const workLog = await request.json() as WorkLog;
    
    // ID가 없는 경우 새 ID 생성
    if (!workLog.id) {
      workLog.id = uuidv4();
    }
    
    // 생성 시간이 없는 경우 추가
    if (!workLog.createdAt) {
      workLog.createdAt = Date.now();
    }
    
    // IP 주소 기록
    if (!workLog.clientIp) {
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';
      workLog.clientIp = ip;
    }
    
    // User-Agent 정보 기록
    if (!workLog.userAgent) {
      workLog.userAgent = request.headers.get('user-agent') || 'unknown';
    }
    
    // 실행 완료된 경우 실행 시간 계산
    if (workLog.status === 'completed' && workLog.startTime && workLog.endTime && !workLog.executionTime) {
      const startTime = new Date(workLog.startTime).getTime();
      const endTime = new Date(workLog.endTime).getTime();
      workLog.executionTime = endTime - startTime;
    }
    
    // 기존 로그 찾기
    const index = workLogs.findIndex(log => log.id === workLog.id);
    
    if (index !== -1) {
      // 기존 로그 업데이트
      workLogs[index] = {
        ...workLogs[index],
        ...workLog
      };
    } else {
      // 새 로그 추가
      workLogs.push(workLog);
    }
    
    // 작업 로그 최신순 정렬
    workLogs.sort((a, b) => {
      const aTime = a.createdAt || new Date(a.startTime).getTime();
      const bTime = b.createdAt || new Date(b.startTime).getTime();
      return bTime - aTime;
    });
    
    // 자동 정리 수행 (필요한 경우)
    await performAutoCleanupIfNeeded();
    
    return NextResponse.json({ success: true, id: workLog.id });
  } catch (error) {
    console.error('작업 로그 저장 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '작업 로그 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 작업 로그 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 페이지네이션 파라미터
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    
    // 필터링 파라미터
    const deviceId = searchParams.get('deviceId');
    const taskId = searchParams.get('taskId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // 필터링 적용
    let filteredLogs = [...workLogs];
    
    if (deviceId) {
      filteredLogs = filteredLogs.filter(log => log.deviceId === deviceId);
    }
    
    if (taskId) {
      filteredLogs = filteredLogs.filter(log => log.taskId === taskId);
    }
    
    if (status) {
      filteredLogs = filteredLogs.filter(log => log.status === status);
    }
    
    if (startDate) {
      const startTimestamp = new Date(startDate).getTime();
      filteredLogs = filteredLogs.filter(log => {
        const logTime = log.createdAt || new Date(log.startTime).getTime();
        return logTime >= startTimestamp;
      });
    }
    
    if (endDate) {
      const endTimestamp = new Date(endDate).getTime();
      filteredLogs = filteredLogs.filter(log => {
        const logTime = log.createdAt || new Date(log.startTime).getTime();
        return logTime <= endTimestamp;
      });
    }
    
    // 총 로그 수
    const totalCount = filteredLogs.length;
    
    // 페이지네이션 적용
    const startIndex = (page - 1) * limit;
    const endIndex = Math.min(startIndex + limit, totalCount);
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
    
    return NextResponse.json({
      logs: paginatedLogs,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit)
    });
  } catch (error) {
    console.error('작업 로그 조회 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '작업 로그 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 작업 로그 일괄 동기화
export async function PUT(request: NextRequest) {
  try {
    const logs = await request.json() as WorkLog[];
    
    if (!Array.isArray(logs)) {
      return NextResponse.json(
        { success: false, message: '유효하지 않은 로그 형식입니다.' },
        { status: 400 }
      );
    }
    
    // 기존 로그와 동기화
    logs.forEach(newLog => {
      if (!newLog.id) {
        newLog.id = uuidv4();
      }
      
      const existingIndex = workLogs.findIndex(log => log.id === newLog.id);
      
      if (existingIndex !== -1) {
        // 더 최신 타임스탬프를 가진 로그 사용
        const existingTimestamp = workLogs[existingIndex].createdAt || 
          new Date(workLogs[existingIndex].startTime).getTime();
        const newTimestamp = newLog.createdAt || 
          new Date(newLog.startTime).getTime();
          
        if (newTimestamp > existingTimestamp) {
          workLogs[existingIndex] = newLog;
        }
      } else {
        workLogs.push(newLog);
      }
    });
    
    // 작업 로그 최신순 정렬
    workLogs.sort((a, b) => {
      const aTime = a.createdAt || new Date(a.startTime).getTime();
      const bTime = b.createdAt || new Date(b.startTime).getTime();
      return bTime - aTime;
    });
    
    return NextResponse.json({ success: true, count: workLogs.length });
  } catch (error) {
    console.error('작업 로그 동기화 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '작업 로그 동기화 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 작업 로그 삭제
export async function DELETE() {
  try {
    workLogs = [];
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('작업 로그 삭제 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '작업 로그 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 자동 정리 수행 (필요한 경우)
async function performAutoCleanupIfNeeded() {
  try {
    if (!retentionPolicy.autoCleanupEnabled) {
      return;
    }
    
    const now = Date.now();
    const lastCleanup = retentionPolicy.lastCleanupTime || 0;
    const dayInMs = 24 * 60 * 60 * 1000;
    
    // 마지막 정리 후 1일 이상 지났으면 정리 수행
    if (now - lastCleanup > dayInMs) {
      await cleanupOldLogs();
      retentionPolicy.lastCleanupTime = now;
    }
  } catch (error) {
    console.error('자동 로그 정리 확인 중 오류:', error);
  }
}

// 오래된 작업 로그 정리
async function cleanupOldLogs() {
  try {
    if (!workLogs.length) return 0;
    
    const now = Date.now();
    const maxAgeDays = retentionPolicy.maxAgeDays;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    
    const deviceLogs: Record<string, WorkLog[]> = {};
    
    // 로그를 장치별로 분류
    workLogs.forEach(log => {
      const deviceId = log.deviceId || 'unknown';
      if (!deviceLogs[deviceId]) {
        deviceLogs[deviceId] = [];
      }
      deviceLogs[deviceId].push(log);
    });
    
    // 필터링 기준: 날짜와 장치별 최대 개수
    let remainingLogs: WorkLog[] = [];
    let removedCount = 0;
    
    Object.entries(deviceLogs).forEach(([deviceId, deviceLogList]) => {
      // 오류 로그는 별도 처리
      const errorLogs = retentionPolicy.retainErrorLogs 
        ? deviceLogList.filter(log => log.status === 'error')
        : [];
        
      // 나머지 로그
      const nonErrorLogs = retentionPolicy.retainErrorLogs
        ? deviceLogList.filter(log => log.status !== 'error')
        : deviceLogList;
      
      // 날짜 기준 필터링
      let filteredLogs = nonErrorLogs.filter(log => {
        // 생성 시간 기준으로 필터링
        if (log.createdAt && now - log.createdAt > maxAgeMs) {
          removedCount++;
          return false;
        }
        
        // 시작 시간 기준으로 필터링 (백업 메커니즘)
        const startTime = new Date(log.startTime).getTime();
        if (now - startTime > maxAgeMs) {
          removedCount++;
          return false;
        }
        
        return true;
      });
      
      // 로그 수 제한
      if (filteredLogs.length > retentionPolicy.maxLogsPerDevice) {
        // 최신 로그 유지를 위해 날짜 기준 정렬
        filteredLogs.sort((a, b) => 
          (b.createdAt || new Date(b.startTime).getTime()) - 
          (a.createdAt || new Date(a.startTime).getTime())
        );
        
        removedCount += filteredLogs.length - retentionPolicy.maxLogsPerDevice;
        filteredLogs = filteredLogs.slice(0, retentionPolicy.maxLogsPerDevice);
      }
      
      // 오류 로그와 필터링된 로그 결합
      remainingLogs = remainingLogs.concat(filteredLogs, errorLogs);
    });
    
    // 업데이트된 로그 저장
    workLogs = remainingLogs;
    
    console.log(`서버 작업 로그 정리 완료: ${removedCount}개 제거됨, ${remainingLogs.length}개 유지됨`);
    
    return removedCount;
  } catch (error) {
    console.error('작업 로그 정리 중 오류:', error);
    return 0;
  }
} 