import { NextRequest, NextResponse } from 'next/server';
import dbTaskService from '../../services/db-task-service';
import { WorkTask } from '../../types';
import redisStateManager from '@/lib/redis-client';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 작업 목록 조회 (GET)
export async function GET(request: Request) {
  try {
    // URL에서 쿼리 매개변수 추출
    const url = new URL(request.url);
    const status = url.searchParams.get('status') as 'pending' | 'running' | 'completed' | 'failed' | undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 100;
    
    // Redis에서 작업 목록 조회
    const tasks = await redisStateManager.listTasks(status, limit);
    
    return NextResponse.json({ 
      success: true, 
      data: tasks 
    });
  } catch (error) {
    console.error('작업 목록 조회 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '작업 목록을 불러오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 새 작업 생성 (POST)
export async function POST(request: Request) {
  try {
    // 요청 본문 파싱
    const data = await request.json();
    
    // 필수 필드 검증
    if (!data.name) {
      return NextResponse.json(
        { success: false, error: '작업 이름은 필수입니다.' },
        { status: 400 }
      );
    }
    
    // Redis에 작업 저장
    const taskId = await redisStateManager.saveTask({
      name: data.name,
      data: data.data || {},
      status: data.status || 'pending'
    });
    
    return NextResponse.json({ 
      success: true, 
      data: { 
        id: taskId,
        message: '작업이 성공적으로 생성되었습니다.' 
      } 
    }, { status: 201 });
  } catch (error) {
    console.error('작업 생성 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '작업을 생성하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 모든 작업 삭제
export async function DELETE(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    // 확인을 위한 쿼리 파라미터 확인
    const url = new URL(req.url);
    const confirm = url.searchParams.get('confirm');
    
    if (confirm !== 'true') {
      return NextResponse.json({ 
        error: '작업을 모두 삭제하려면 ?confirm=true 쿼리 파라미터가 필요합니다.' 
      }, { status: 400 });
    }
    
    // 모든 작업 삭제
    await dbTaskService.clearAllTasks();
    
    return NextResponse.json({
      success: true,
      message: '모든 작업이 삭제되었습니다.'
    });
  } catch (error) {
    console.error('모든 작업 삭제 중 오류:', error);
    return NextResponse.json({ error: '모든 작업 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 