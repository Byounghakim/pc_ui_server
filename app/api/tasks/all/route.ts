import { NextResponse } from 'next/server';
import dbService from '@/app/services/db-service';
import authService from '@/app/services/auth-service';

// 모든 작업 조회 API
export async function GET(request: Request) {
  try {
    // 인증 확인 - 사용자 이상의 권한 필요
    const authResult = authService.requireRole(request as any, 'user');
    if (!authResult.allowed) {
      return NextResponse.json(
        { success: false, message: authResult.error },
        { status: 401 }
      );
    }
    
    // 데이터베이스에서 모든 작업 가져오기
    const tasks = await dbService.getAllTasks();
    
    console.log(`[API] 모든 작업 조회: ${tasks.length}개 작업 반환`);
    
    // 최신순으로 정렬하여 반환
    return NextResponse.json(
      tasks.sort((a, b) => b.updatedAt - a.updatedAt)
    );
  } catch (error) {
    console.error('[API] 작업 목록 조회 오류:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: '작업 목록 조회 중 오류가 발생했습니다.' 
      },
      { status: 500 }
    );
  }
} 