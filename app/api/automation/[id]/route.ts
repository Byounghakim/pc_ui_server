import { NextRequest, NextResponse } from 'next/server';
import redisStateManager from '@/lib/redis-client';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 특정 자동화 공정 조회 (GET)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const processId = params.id;
    
    // Redis에서 자동화 공정 조회
    const process = await redisStateManager.getAutomationProcess(processId);
    
    if (!process) {
      return NextResponse.json(
        { success: false, error: '자동화 공정을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 각 작업에 대한 작업 객체 조회
    const tasks = await Promise.all(process.taskIds.map(async (taskId) => {
      return await redisStateManager.getTask(taskId);
    }));
    
    // 실행 기록 조회 (최근 5개)
    const executions = await redisStateManager.listProcessExecutions(processId, undefined, 5);
    
    // 실행 중인 인스턴스 확인
    const runningExecutions = executions.filter(exec => exec.status === 'running');
    const isRunning = runningExecutions.length > 0;
    
    // 응답 반환
    return NextResponse.json({
      success: true,
      data: {
        ...process,
        tasks: tasks.filter(t => t !== null), // null 값 제거
        executions,
        isRunning,
        activeExecution: isRunning ? runningExecutions[0] : null
      }
    });
  } catch (error) {
    console.error(`자동화 공정 조회 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '자동화 공정을 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 자동화 공정 업데이트 (PUT)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json(
        { success: false, error: '인증되지 않은 요청입니다.' },
        { status: 401 }
      );
    }
    
    const processId = params.id;
    const data = await req.json();
    
    // 공정이 존재하는지 확인
    const existingProcess = await redisStateManager.getAutomationProcess(processId);
    if (!existingProcess) {
      return NextResponse.json(
        { success: false, error: '업데이트할 자동화 공정을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 실행 중인 공정 업데이트 제한
    const runningExecutions = await redisStateManager.listProcessExecutions(processId, 'running', 1);
    if (runningExecutions.length > 0) {
      return NextResponse.json(
        { success: false, error: '실행 중인 자동화 공정은 업데이트할 수 없습니다.' },
        { status: 409 }
      );
    }
    
    // 작업 ID 배열이 있는 경우 모든 ID가 유효한지 확인
    if (data.taskIds && Array.isArray(data.taskIds)) {
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
    }
    
    // Redis에서 자동화 공정 업데이트
    const success = await redisStateManager.updateAutomationProcess(
      processId,
      {
        name: data.name,
        description: data.description,
        taskIds: data.taskIds,
        config: data.config
      }
    );
    
    if (!success) {
      return NextResponse.json(
        { success: false, error: '자동화 공정을 업데이트할 수 없습니다.' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      message: '자동화 공정이 성공적으로 업데이트되었습니다.' 
    });
  } catch (error) {
    console.error(`자동화 공정 업데이트 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '자동화 공정을 업데이트하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 자동화 공정 삭제 (DELETE)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json(
        { success: false, error: '인증되지 않은 요청입니다.' },
        { status: 401 }
      );
    }
    
    const processId = params.id;
    
    // 공정이 존재하는지 확인
    const existingProcess = await redisStateManager.getAutomationProcess(processId);
    if (!existingProcess) {
      return NextResponse.json(
        { success: false, error: '삭제할 자동화 공정을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 실행 중인 공정 삭제 제한
    const runningExecutions = await redisStateManager.listProcessExecutions(processId, 'running', 1);
    if (runningExecutions.length > 0) {
      return NextResponse.json(
        { success: false, error: '실행 중인 자동화 공정은 삭제할 수 없습니다.' },
        { status: 409 }
      );
    }
    
    // Redis에서 자동화 공정 삭제
    const success = await redisStateManager.deleteAutomationProcess(processId);
    
    if (!success) {
      return NextResponse.json(
        { success: false, error: '자동화 공정을 삭제할 수 없습니다.' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      message: '자동화 공정이 성공적으로 삭제되었습니다.' 
    });
  } catch (error) {
    console.error(`자동화 공정 삭제 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '자동화 공정을 삭제하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 