import { NextRequest, NextResponse } from 'next/server';
import redisStateManager from '@/lib/redis-client';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 자동화 공정 목록 조회 (GET)
export async function GET(req: NextRequest) {
  try {
    // URL에서 쿼리 매개변수 추출
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 100;
    
    // Redis에서 자동화 공정 목록 조회
    const processes = await redisStateManager.listAutomationProcesses(limit);
    
    // 각 공정에 대한 추가 정보 로드 (파이프라인을 사용할 수 있지만 간결성을 위해 생략)
    const enhancedProcesses = await Promise.all(processes.map(async (process) => {
      // 각 작업 ID에 대한 작업 객체 조회
      const tasks = await Promise.all(process.taskIds.map(async (taskId) => {
        return await redisStateManager.getTask(taskId);
      }));
      
      // 실행 중인 인스턴스가 있는지 확인
      const executions = await redisStateManager.listProcessExecutions(process.id, 'running', 1);
      const isRunning = executions.length > 0;
      
      return {
        ...process,
        tasks: tasks.filter(t => t !== null), // null 값 제거
        isRunning,
        activeExecution: isRunning ? executions[0] : null
      };
    }));
    
    return NextResponse.json({ 
      success: true, 
      data: enhancedProcesses 
    });
  } catch (error) {
    console.error('자동화 공정 목록 조회 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 목록을 불러오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 새 자동화 공정 생성 (POST)
export async function POST(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json(
        { success: false, error: '인증되지 않은 요청입니다.' },
        { status: 401 }
      );
    }
    
    // 요청 본문 파싱
    const data = await req.json();
    
    // 필수 필드 검증
    if (!data.name || !data.taskIds || !Array.isArray(data.taskIds) || data.taskIds.length === 0) {
      return NextResponse.json(
        { success: false, error: '작업 이름 및 최소 하나 이상의 작업 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 모든 작업 ID가 유효한지 확인
    const validTasks = await Promise.all(data.taskIds.map(async (taskId) => {
      const task = await redisStateManager.getTask(taskId);
      return !!task; // true/false로 변환
    }));
    
    // 하나라도 유효하지 않은 작업 ID가 있으면 오류
    if (validTasks.includes(false)) {
      return NextResponse.json(
        { success: false, error: '하나 이상의 작업 ID가 유효하지 않습니다.' },
        { status: 400 }
      );
    }
    
    // Redis에 자동화 공정 저장
    const processId = await redisStateManager.saveAutomationProcess({
      name: data.name,
      description: data.description || '',
      taskIds: data.taskIds,
      config: data.config || {}
    });
    
    return NextResponse.json({ 
      success: true, 
      data: { 
        id: processId,
        message: '자동화 공정이 성공적으로 생성되었습니다.' 
      } 
    }, { status: 201 });
  } catch (error) {
    console.error('자동화 공정 생성 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '자동화 공정을 생성하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 