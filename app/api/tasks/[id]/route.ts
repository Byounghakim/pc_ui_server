import { NextRequest, NextResponse } from 'next/server';
import dbTaskService from '../../../services/db-task-service';
import mqttService from '../../../services/mqtt-service';
import redisStateManager from '@/lib/redis-client';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 특정 작업 조회
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const taskId = params.id;
    
    // Redis에서 작업 조회
    const task = await redisStateManager.getTask(taskId);
    
    if (!task) {
      return NextResponse.json(
        { success: false, error: '작업을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    // 추가 정보 조회 (실행 상태, 버전 수 등)
    const isRunning = mqttService.getRunningTasks()
      .some(execution => execution.taskId === taskId);
    
    // 버전 수 조회
    const versions = await dbTaskService.getTaskVersions(taskId);
    
    return NextResponse.json({
      success: true,
      data: {
        task,
        isRunning,
        versionCount: versions.length
      }
    });
  } catch (error) {
    console.error(`작업 조회 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '작업을 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 작업 상태 업데이트
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const taskId = params.id;
    const data = await req.json();
    
    // 상태 필드 검증
    if (!data.status) {
      return NextResponse.json(
        { success: false, error: '업데이트할 상태를 지정해야 합니다.' },
        { status: 400 }
      );
    }
    
    // 유효한 상태값인지 확인
    const validStatuses = ['pending', 'running', 'completed', 'failed'];
    if (!validStatuses.includes(data.status)) {
      return NextResponse.json(
        { 
          success: false, 
          error: `잘못된 상태값입니다. 유효한 값: ${validStatuses.join(', ')}` 
        },
        { status: 400 }
      );
    }
    
    // Redis에서 작업 상태 업데이트
    const success = await redisStateManager.updateTaskStatus(
      taskId,
      data.status,
      data.additionalData
    );
    
    if (!success) {
      return NextResponse.json(
        { success: false, error: '작업을 찾을 수 없거나 업데이트할 수 없습니다.' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      message: '작업 상태가 성공적으로 업데이트되었습니다.' 
    });
  } catch (error) {
    console.error(`작업 상태 업데이트 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '작업 상태를 업데이트하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 작업 삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const taskId = params.id;
    
    // Redis에서 작업 삭제
    const success = await redisStateManager.deleteTask(taskId);
    
    if (!success) {
      return NextResponse.json(
        { success: false, error: '작업을 찾을 수 없거나 삭제할 수 없습니다.' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      message: '작업이 성공적으로 삭제되었습니다.' 
    });
  } catch (error) {
    console.error(`작업 삭제 API 오류 (ID: ${params.id}):`, error);
    return NextResponse.json(
      { success: false, error: '작업을 삭제하는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 작업 실행 엔드포인트
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const taskId = params.id;
    const body = await req.json();
    
    // URL로부터 액션 확인
    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1];
    
    // 실행 명령인 경우
    if (lastSegment === 'execute') {
      if (!body.deviceId) {
        return NextResponse.json({ error: 'deviceId가 필요합니다.' }, { status: 400 });
      }
      
      // 작업 실행
      const success = await mqttService.executeTask(taskId, body.deviceId);
      
      if (success) {
        return NextResponse.json({
          success: true,
          message: `장치(${body.deviceId})에서 작업 실행이 시작되었습니다.`
        });
      } else {
        return NextResponse.json({ 
          error: '작업 실행을 시작할 수 없습니다.' 
        }, { status: 500 });
      }
    }
    // 중지 명령인 경우
    else if (lastSegment === 'stop') {
      if (!body.deviceId) {
        return NextResponse.json({ error: 'deviceId가 필요합니다.' }, { status: 400 });
      }
      
      // 작업 중지
      const success = await mqttService.stopTaskExecution(taskId, body.deviceId);
      
      if (success) {
        return NextResponse.json({
          success: true,
          message: `장치(${body.deviceId})에서 작업 실행이 중지되었습니다.`
        });
      } else {
        return NextResponse.json({ 
          error: '작업 실행을 중지할 수 없습니다.' 
        }, { status: 500 });
      }
    }
    
    // 기본적으로 지원하지 않는 작업
    return NextResponse.json({ 
      error: '지원하지 않는 작업입니다.' 
    }, { status: 400 });
  } catch (error) {
    console.error(`작업(${params.id}) 작업 중 오류:`, error);
    return NextResponse.json({ error: '작업 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 