import { NextRequest, NextResponse } from 'next/server';
import { WorkLog } from '@/app/types';

// 메모리 저장소 (경로 파라미터 접근을 위한 별도 라우트)
// 실제 구현에서는 메인 라우터와 데이터 저장소 공유 필요
let workLogs: WorkLog[] = [];

// 특정 ID의 작업 로그 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    
    // 검증
    if (!id) {
      return NextResponse.json(
        { success: false, message: '로그 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 로그 찾기
    const log = workLogs.find(log => log.id === id);
    
    if (!log) {
      return NextResponse.json(
        { success: false, message: '해당 ID의 작업 로그를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 응답
    return NextResponse.json({
      success: true,
      log
    });
  } catch (error) {
    console.error(`작업 로그(${params.id}) 조회 중 오류:`, error);
    return NextResponse.json(
      { success: false, message: '작업 로그 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 특정 ID의 작업 로그 업데이트
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    
    // 검증
    if (!id) {
      return NextResponse.json(
        { success: false, message: '로그 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 요청 본문 파싱
    const updates = await request.json() as Partial<WorkLog>;
    
    // ID 변경 시도 방지
    if (updates.id && updates.id !== id) {
      return NextResponse.json(
        { success: false, message: '로그 ID는 변경할 수 없습니다.' },
        { status: 400 }
      );
    }
    
    // 로그 찾기
    const index = workLogs.findIndex(log => log.id === id);
    
    if (index === -1) {
      return NextResponse.json(
        { success: false, message: '해당 ID의 작업 로그를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 로그 업데이트
    workLogs[index] = {
      ...workLogs[index],
      ...updates
    };
    
    // 실행 완료된 경우 실행 시간 계산
    if (updates.status === 'completed' || (workLogs[index].status === 'completed' && !workLogs[index].executionTime)) {
      const startTime = new Date(workLogs[index].startTime).getTime();
      const endTime = new Date(workLogs[index].endTime || Date.now()).getTime();
      workLogs[index].executionTime = endTime - startTime;
    }
    
    // 응답
    return NextResponse.json({
      success: true,
      log: workLogs[index]
    });
  } catch (error) {
    console.error(`작업 로그(${params.id}) 업데이트 중 오류:`, error);
    return NextResponse.json(
      { success: false, message: '작업 로그 업데이트 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 특정 ID의 작업 로그 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    
    // 검증
    if (!id) {
      return NextResponse.json(
        { success: false, message: '로그 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 로그 찾기 및 삭제
    const initialCount = workLogs.length;
    workLogs = workLogs.filter(log => log.id !== id);
    
    // 삭제 실패 (로그가 존재하지 않음)
    if (initialCount === workLogs.length) {
      return NextResponse.json(
        { success: false, message: '해당 ID의 작업 로그를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 응답
    return NextResponse.json({
      success: true,
      message: `작업 로그 ${id}가 삭제되었습니다.`
    });
  } catch (error) {
    console.error(`작업 로그(${params.id}) 삭제 중 오류:`, error);
    return NextResponse.json(
      { success: false, message: '작업 로그 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 