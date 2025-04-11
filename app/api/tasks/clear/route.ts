import { NextResponse } from 'next/server';
import dbService from '@/app/services/db-service';
import authService from '@/app/services/auth-service';

// 모든 작업 삭제 API
export async function DELETE(request: Request) {
  try {
    // 인증 확인 - 관리자 권한 필요
    const authResult = authService.requireRole(request as any, 'admin');
    if (!authResult.allowed) {
      return NextResponse.json(
        { success: false, message: authResult.error || '이 작업을 수행할 권한이 없습니다.' },
        { status: 401 }
      );
    }
    
    // 모든 작업을 DB에서 삭제
    const success = await dbService.clearAllTasks();
    
    if (!success) {
      return NextResponse.json(
        { success: false, message: '작업 삭제 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    
    console.log('[API] 모든 작업 삭제됨');
    
    return NextResponse.json({
      success: true,
      message: '모든 작업이 삭제되었습니다.'
    });
  } catch (error) {
    console.error('[API] 작업 목록 삭제 오류:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: '작업 목록 삭제 중 오류가 발생했습니다.' 
      },
      { status: 500 }
    );
  }
} 