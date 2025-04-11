import { NextRequest, NextResponse } from 'next/server';
import backupService from '../../../../services/backup-service';
import dbTaskService from '../../../../services/db-task-service';
import { broadcastMessage } from '../../../../api/sync/route';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 작업을 템플릿으로 저장
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
    
    // 템플릿 이름 필요
    if (!body.templateName) {
      return NextResponse.json({ error: 'templateName 필드가 필요합니다.' }, { status: 400 });
    }
    
    // 작업 존재 확인
    const task = await dbTaskService.getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
    }
    
    // 작업을 템플릿으로 변환
    const template = await backupService.createTemplateFromTask(
      taskId,
      body.templateName,
      body.isPublic || false,
      body.createdBy
    );
    
    if (!template) {
      return NextResponse.json({ error: '템플릿 생성에 실패했습니다.' }, { status: 500 });
    }
    
    // 템플릿 생성 알림
    await broadcastMessage('template', {
      action: 'created',
      templateId: template.id,
      timestamp: Date.now()
    });
    
    return NextResponse.json({
      success: true,
      template,
      message: '작업이 템플릿으로 저장되었습니다.'
    });
  } catch (error) {
    console.error(`작업(${params.id})을 템플릿으로 저장 중 오류:`, error);
    return NextResponse.json({ error: '템플릿 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 