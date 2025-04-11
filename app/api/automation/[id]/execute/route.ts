import { NextRequest, NextResponse } from 'next/server';
import redisStateManager from '@/lib/redis-client';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 자동화 공정 실행 시작 (POST)
export async function POST(
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
    const process = await redisStateManager.getAutomationProcess(processId);
    if (!process) {
      return NextResponse.json(
        { success: false, error: '실행할 자동화 공정을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 이미 실행 중인지 확인
    const runningExecutions = await redisStateManager.listProcessExecutions(processId, 'running', 1);
    if (runningExecutions.length > 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: '이미 실행 중인 자동화 공정입니다.',
          executionId: runningExecutions[0].id
        },
        { status: 409 }
      );
    }
    
    // 실행 객체 생성
    const executionId = await redisStateManager.saveProcessExecution(processId, {
      status: 'running',
      startTime: Date.now(),
      currentTaskIndex: 0,
      results: []
    });
    
    // MQTT 메시지 발행 등의 실제 실행 로직은 외부 서비스로 위임
    // 여기서는 실행 기록만 생성하고 작업 처리는 별도 서비스에서 담당
    
    return NextResponse.json({ 
      success: true, 
      data: {
        executionId,
        message: '자동화 공정 실행이 시작되었습니다.'
      }
    });
  } catch (error) {
    console.error(`자동화 공정 실행 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 실행을 시작하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 자동화 공정 실행 중지 (DELETE)
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
    
    // 실행 중인 인스턴스 조회
    const runningExecutions = await redisStateManager.listProcessExecutions(processId, 'running', 1);
    if (runningExecutions.length === 0) {
      return NextResponse.json(
        { success: false, error: '중지할 실행 중인 자동화 공정이 없습니다.' },
        { status: 404 }
      );
    }
    
    const executionId = runningExecutions[0].id;
    
    // 실행 상태 업데이트
    const success = await redisStateManager.updateProcessExecution(executionId, {
      status: 'stopped',
      endTime: Date.now(),
      error: '사용자에 의해 중지됨'
    });
    
    if (!success) {
      return NextResponse.json(
        { success: false, error: '자동화 공정 실행을 중지할 수 없습니다.' },
        { status: 500 }
      );
    }
    
    // MQTT 메시지 발행 등의 실제 중지 로직은 외부 서비스로 위임
    
    return NextResponse.json({
      success: true,
      message: '자동화 공정 실행이 중지되었습니다.'
    });
  } catch (error) {
    console.error(`자동화 공정 실행 중지 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 실행을 중지하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 자동화 공정 실행 상태 조회 (GET)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const processId = params.id;
    
    // 실행 기록 조회
    const executions = await redisStateManager.listProcessExecutions(processId, undefined, 10);
    
    // 현재 실행 중인 인스턴스 확인
    const runningExecution = executions.find(exec => exec.status === 'running');
    
    // 결과 형식화
    const result = {
      processId,
      isRunning: !!runningExecution,
      currentExecution: runningExecution || null,
      recentExecutions: executions
    };
    
    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error(`자동화 공정 실행 상태 조회 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 실행 상태를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 