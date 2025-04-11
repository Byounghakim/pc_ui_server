import { NextRequest, NextResponse } from 'next/server';
import dbTaskService from '../../../../services/db-task-service';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 장치별 작업 목록 조회
export async function GET(
  req: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const deviceId = params.deviceId;
    
    // 장치별 작업 목록 조회
    const tasks = await dbTaskService.getTasksByDeviceId(deviceId);
    
    return NextResponse.json({
      deviceId,
      tasks,
      count: tasks.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`장치(${params.deviceId})의 작업 목록 조회 중 오류:`, error);
    return NextResponse.json({ error: '작업 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 작업을 장치에 할당
export async function POST(
  req: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const deviceId = params.deviceId;
    const body = await req.json();
    
    // 요청 유효성 검사
    if (!body.taskId) {
      return NextResponse.json({ error: 'taskId가 필요합니다.' }, { status: 400 });
    }
    
    // 작업을 장치에 할당
    const success = await dbTaskService.assignTaskToDevice(body.taskId, deviceId);
    
    if (success) {
      return NextResponse.json({
        success: true,
        message: `작업(${body.taskId})이 장치(${deviceId})에 할당되었습니다.`
      });
    } else {
      return NextResponse.json({ 
        error: '작업 할당에 실패했습니다. 작업이 존재하지 않습니다.' 
      }, { status: 404 });
    }
  } catch (error) {
    console.error(`장치(${params.deviceId})에 작업 할당 중 오류:`, error);
    return NextResponse.json({ error: '작업 할당 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 장치에서 작업 제거
export async function DELETE(
  req: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const deviceId = params.deviceId;
    
    // URL 쿼리 파라미터에서 taskId 가져오기
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId');
    
    if (!taskId) {
      return NextResponse.json({ error: 'taskId 쿼리 파라미터가 필요합니다.' }, { status: 400 });
    }
    
    // 장치에서 작업 제거
    const success = await dbTaskService.removeTaskFromDevice(taskId, deviceId);
    
    if (success) {
      return NextResponse.json({
        success: true,
        message: `작업(${taskId})이 장치(${deviceId})에서 제거되었습니다.`
      });
    } else {
      return NextResponse.json({ 
        error: '작업 제거에 실패했습니다. 작업이 존재하지 않거나 장치에 할당되지 않았습니다.' 
      }, { status: 404 });
    }
  } catch (error) {
    console.error(`장치(${params.deviceId})에서 작업 제거 중 오류:`, error);
    return NextResponse.json({ error: '작업 제거 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 