import { NextResponse } from 'next/server';
import dbService from '@/app/services/db-service';
import authService from '@/app/services/auth-service';

// 작업의 버전 기록 조회 API
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인 - 사용자 이상의 권한 필요
    const authResult = authService.requireRole(request as any, 'user');
    if (!authResult.allowed) {
      return NextResponse.json(
        { success: false, message: authResult.error },
        { status: 401 }
      );
    }
    
    const taskId = params.id;
    
    if (!taskId) {
      return NextResponse.json(
        { success: false, message: '작업 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 현재 작업 확인
    const currentTask = await dbService.getTaskById(taskId);
    if (!currentTask) {
      return NextResponse.json(
        { success: false, message: '작업을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 버전 기록 조회
    const versions = await dbService.getTaskVersions(taskId);
    
    console.log(`[API] 작업(${taskId}) 버전 기록 조회: ${versions.length}개 버전 반환`);
    
    return NextResponse.json({
      success: true,
      taskId,
      currentVersion: currentTask.updatedAt,
      versions: versions.map(v => ({
        version: v.version,
        updatedAt: v.task.updatedAt,
        task: v.task
      }))
    });
  } catch (error) {
    console.error('[API] 작업 버전 기록 조회 오류:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: '작업 버전 기록 조회 중 오류가 발생했습니다.' 
      },
      { status: 500 }
    );
  }
}

// 특정 버전으로 작업 복원 API
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인 - 사용자 이상의 권한 필요
    const authResult = authService.requireRole(request as any, 'user');
    if (!authResult.allowed) {
      return NextResponse.json(
        { success: false, message: authResult.error },
        { status: 401 }
      );
    }
    
    const taskId = params.id;
    
    if (!taskId) {
      return NextResponse.json(
        { success: false, message: '작업 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 요청 바디에서 버전 정보 추출
    const body = await request.json();
    if (!body.version) {
      return NextResponse.json(
        { success: false, message: '복원할 버전 정보가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 버전 기록 조회
    const versions = await dbService.getTaskVersions(taskId);
    const targetVersion = versions.find(v => v.version === body.version);
    
    if (!targetVersion) {
      return NextResponse.json(
        { success: false, message: '해당 버전을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 현재 작업 백업 (현재 작업도 버전 기록에 추가)
    const currentTask = await dbService.getTaskById(taskId);
    if (currentTask) {
      // 현재 작업을 버전 기록에 추가
      await dbService.saveTask(currentTask);
    }
    
    // 선택한 버전 작업으로 복원
    // 복원된 작업의 updatedAt은 현재 시간으로 업데이트
    const restoredTask = {
      ...targetVersion.task,
      updatedAt: Date.now()
    };
    
    const success = await dbService.saveTask(restoredTask);
    
    if (!success) {
      return NextResponse.json(
        { success: false, message: '작업 버전 복원 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    
    console.log(`[API] 작업(${taskId}) 버전(${body.version}) 복원 성공`);
    
    return NextResponse.json({
      success: true,
      message: '작업이 이전 버전으로 복원되었습니다.',
      taskId,
      version: body.version,
      task: restoredTask
    });
  } catch (error) {
    console.error('[API] 작업 버전 복원 오류:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: '작업 버전 복원 중 오류가 발생했습니다.' 
      },
      { status: 500 }
    );
  }
} 