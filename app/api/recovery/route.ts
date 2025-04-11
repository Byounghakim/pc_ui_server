import { NextRequest, NextResponse } from 'next/server';
import errorRecoveryService from '../../services/error-recovery-service';
import dbTaskService from '../../services/db-task-service';
import { broadcastMessage } from '../sync/route';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 데이터 복구 API 엔드포인트
export async function POST(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const body = await req.json();
    
    // 데이터베이스 복구 요청
    if (action === 'database') {
      const success = await errorRecoveryService.recoverCorruptedDatabase();
      
      if (success) {
        // 복구 완료 알림
        await broadcastMessage('recovery', {
          action: 'database_recovered',
          timestamp: Date.now()
        });
        
        return NextResponse.json({
          success: true,
          message: '데이터베이스가 성공적으로 복구되었습니다.'
        });
      } else {
        return NextResponse.json({ 
          error: '데이터베이스 복구에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    // 작업 복구 요청
    if (action === 'task') {
      if (!body.taskId) {
        return NextResponse.json({ error: 'taskId 필드가 필요합니다.' }, { status: 400 });
      }
      
      const restoredTask = await errorRecoveryService.recoverCorruptedTaskData(body.taskId);
      
      if (restoredTask) {
        // 복구 완료 알림
        await broadcastMessage('recovery', {
          action: 'task_recovered',
          taskId: body.taskId,
          timestamp: Date.now()
        });
        
        return NextResponse.json({
          success: true,
          task: restoredTask,
          message: '작업이 성공적으로 복구되었습니다.'
        });
      } else {
        return NextResponse.json({ 
          error: '작업 복구에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    // 작업 실행 오류 복구 요청
    if (action === 'execution') {
      if (!body.taskId || !body.deviceId) {
        return NextResponse.json({ 
          error: 'taskId와 deviceId 필드가 필요합니다.' 
        }, { status: 400 });
      }
      
      const errorDetails = body.errorDetails || '알 수 없는 오류';
      
      const success = await errorRecoveryService.recoverFromTaskExecutionError(
        body.taskId,
        body.deviceId,
        errorDetails
      );
      
      if (success) {
        // 복구 완료 알림
        await broadcastMessage('recovery', {
          action: 'execution_recovered',
          taskId: body.taskId,
          deviceId: body.deviceId,
          timestamp: Date.now()
        });
        
        return NextResponse.json({
          success: true,
          message: '작업 실행 오류가 성공적으로 복구되었습니다.'
        });
      } else {
        return NextResponse.json({ 
          error: '작업 실행 오류 복구에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    // 자동 복구 요청
    if (action === 'auto') {
      if (!body.taskId || !body.deviceId) {
        return NextResponse.json({ 
          error: 'taskId와 deviceId 필드가 필요합니다.' 
        }, { status: 400 });
      }
      
      const errorDetails = body.errorDetails || '알 수 없는 오류';
      
      const success = await errorRecoveryService.autoRecoverOnExecutionError(
        body.taskId,
        body.deviceId,
        errorDetails
      );
      
      if (success) {
        // 복구 완료 알림
        await broadcastMessage('recovery', {
          action: 'auto_recovered',
          taskId: body.taskId,
          deviceId: body.deviceId,
          timestamp: Date.now()
        });
        
        return NextResponse.json({
          success: true,
          message: '작업이 자동으로 복구되었습니다.'
        });
      } else {
        return NextResponse.json({ 
          error: '자동 복구에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    // 데이터 무결성 검사 요청
    if (action === 'check') {
      await errorRecoveryService.performIntegrityCheck();
      
      return NextResponse.json({
        success: true,
        message: '데이터 무결성 검사가 시작되었습니다.'
      });
    }
    
    return NextResponse.json({ 
      error: '지원되지 않는 작업입니다.' 
    }, { status: 400 });
  } catch (error) {
    console.error('복구 요청 중 오류:', error);
    return NextResponse.json({ error: '복구 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 데이터 무결성 검사 엔드포인트
export async function GET(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId');
    
    // 특정 작업 분석
    if (taskId) {
      const task = await dbTaskService.getTaskById(taskId);
      
      if (!task) {
        return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
      }
      
      const issues = errorRecoveryService.analyzeTaskForErrors(task);
      
      return NextResponse.json({
        taskId,
        hasIssues: issues.length > 0,
        issues,
        timestamp: Date.now()
      });
    }
    
    // 기본적으로 시스템 상태 반환
    return NextResponse.json({
      message: '복구 서비스가 정상 작동 중입니다.',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('상태 확인 중 오류:', error);
    return NextResponse.json({ error: '상태 확인 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 