import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { WorkLog } from '@/app/types';

// 메모리 저장소 (경로 파라미터 접근을 위한 별도 라우트)
let workLogs: WorkLog[] = [];

// 장치별 작업 로그 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const deviceId = params.deviceId;
    const { searchParams } = new URL(request.url);
    
    // 검증
    if (!deviceId) {
      return NextResponse.json(
        { success: false, message: '장치 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 페이지네이션 파라미터
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    
    // 필터링 파라미터
    const taskId = searchParams.get('taskId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // 전체 로그에서 장치 로그 필터링
    let deviceLogs = workLogs.filter(log => log.deviceId === deviceId);
    
    // 추가 필터링
    if (taskId) {
      deviceLogs = deviceLogs.filter(log => log.taskId === taskId);
    }
    
    if (status) {
      deviceLogs = deviceLogs.filter(log => log.status === status);
    }
    
    if (startDate) {
      const startTimestamp = new Date(startDate).getTime();
      deviceLogs = deviceLogs.filter(log => {
        const logTime = log.createdAt || new Date(log.startTime).getTime();
        return logTime >= startTimestamp;
      });
    }
    
    if (endDate) {
      const endTimestamp = new Date(endDate).getTime();
      deviceLogs = deviceLogs.filter(log => {
        const logTime = log.createdAt || new Date(log.startTime).getTime();
        return logTime <= endTimestamp;
      });
    }
    
    // 최신순 정렬
    deviceLogs.sort((a, b) => {
      const aTime = a.createdAt || new Date(a.startTime).getTime();
      const bTime = b.createdAt || new Date(b.startTime).getTime();
      return bTime - aTime;
    });
    
    // 총 개수
    const totalCount = deviceLogs.length;
    
    // 페이지네이션 적용
    const startIndex = (page - 1) * limit;
    const endIndex = Math.min(startIndex + limit, totalCount);
    const paginatedLogs = deviceLogs.slice(startIndex, endIndex);
    
    // 응답
    return NextResponse.json({
      logs: paginatedLogs,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      deviceId
    });
  } catch (error) {
    console.error(`장치(${params.deviceId}) 작업 로그 조회 중 오류:`, error);
    return NextResponse.json(
      { success: false, message: '장치 작업 로그 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 장치별 작업 로그 생성/업데이트
export async function POST(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const deviceId = params.deviceId;
    
    // 검증
    if (!deviceId) {
      return NextResponse.json(
        { success: false, message: '장치 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 요청 본문 파싱
    const workLog = await request.json() as WorkLog;
    
    // 장치 ID 설정
    workLog.deviceId = deviceId;
    
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
    
    // 응답
    return NextResponse.json({ 
      success: true, 
      id: workLog.id,
      deviceId
    });
  } catch (error) {
    console.error(`장치(${params.deviceId}) 작업 로그 저장 중 오류:`, error);
    return NextResponse.json(
      { success: false, message: '장치 작업 로그 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 장치별 작업 로그 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const deviceId = params.deviceId;
    
    // 검증
    if (!deviceId) {
      return NextResponse.json(
        { success: false, message: '장치 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 장치 로그 필터링
    const initialCount = workLogs.length;
    workLogs = workLogs.filter(log => log.deviceId !== deviceId);
    const deletedCount = initialCount - workLogs.length;
    
    // 응답
    return NextResponse.json({ 
      success: true, 
      message: `장치(${deviceId})의 작업 로그 ${deletedCount}개가 삭제되었습니다.`, 
      deletedCount,
      deviceId
    });
  } catch (error) {
    console.error(`장치(${params.deviceId}) 작업 로그 삭제 중 오류:`, error);
    return NextResponse.json(
      { success: false, message: '장치 작업 로그 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 