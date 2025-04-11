import { NextResponse } from 'next/server';
import { WorkTask } from '@/app/types';
import dbService from '@/app/services/db-service';
import authService from '@/app/services/auth-service';

// 작업 저장 API
export async function POST(request: Request) {
  try {
    // 인증 확인
    const authResult = authService.requireAuth(request as any);
    if (!authResult.allowed) {
      return NextResponse.json(
        { success: false, message: authResult.error },
        { status: 401 }
      );
    }
    
    const task = await request.json() as WorkTask;
    
    if (!task || !task.id) {
      return NextResponse.json(
        { success: false, message: '유효하지 않은 작업 데이터입니다.' },
        { status: 400 }
      );
    }
    
    // 충돌 해결
    const resolvedTask = await dbService.resolveConflict(task.id, task);
    
    // 작업 저장
    const success = await dbService.saveTask(resolvedTask);
    
    if (!success) {
      return NextResponse.json(
        { success: false, message: '작업 저장 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    
    // 만약 장치 ID가, API 요청에서 인증으로 제공된 장치 ID와 관련이 있으면
    // 해당 장치의 작업으로 자동 할당
    if (authResult.deviceId) {
      await dbService.assignTaskToDevice(task.id, authResult.deviceId);
    }
    
    console.log(`[API] 작업 저장: ${task.id}, ${task.name}`);
    
    return NextResponse.json({
      success: true,
      message: '작업이 저장되었습니다.',
      taskId: task.id,
      version: resolvedTask.updatedAt
    });
  } catch (error) {
    console.error('[API] 작업 저장 오류:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: '작업 저장 중 오류가 발생했습니다.' 
      },
      { status: 500 }
    );
  }
} 