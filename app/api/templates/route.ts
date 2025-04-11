import { NextRequest, NextResponse } from 'next/server';
import backupService from '../../services/backup-service';
import { broadcastMessage } from '../sync/route';

// 인증 확인 함수 (간단한 API 키 확인)
function isAuthenticated(req: NextRequest): boolean {
  const apiKey = req.headers.get('x-api-key');
  // 실제 구현에서는 데이터베이스나 환경 변수에서 API 키 확인
  const validApiKey = process.env.API_KEY || 'test-api-key';
  return apiKey === validApiKey;
}

// 템플릿 목록 조회
export async function GET(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    // URL 쿼리 파라미터 가져오기
    const url = new URL(req.url);
    const includePrivate = url.searchParams.get('includePrivate') === 'true';
    const createdBy = url.searchParams.get('createdBy') || undefined;
    
    // 템플릿 목록 조회
    const templates = await backupService.getAllTemplates(includePrivate, createdBy);
    
    return NextResponse.json({
      templates,
      total: templates.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('템플릿 목록 조회 중 오류:', error);
    return NextResponse.json({ error: '템플릿 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 새 템플릿 생성
export async function POST(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    
    // 작업에서 템플릿 생성 요청
    if (action === 'createFromTask') {
      const body = await req.json();
      
      if (!body.taskId || !body.templateName) {
        return NextResponse.json({ 
          error: 'taskId와 templateName 필드가 필요합니다.' 
        }, { status: 400 });
      }
      
      const template = await backupService.createTemplateFromTask(
        body.taskId,
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
        message: '템플릿이 성공적으로 생성되었습니다.'
      });
    }
    
    // 기본: 새 템플릿 생성
    const body = await req.json();
    
    if (!body.name || !body.sequence) {
      return NextResponse.json({ error: '템플릿 이름과 시퀀스는 필수 항목입니다.' }, { status: 400 });
    }
    
    const template = await backupService.createTaskTemplate({
      name: body.name,
      description: body.description,
      sequence: body.sequence,
      tags: body.tags,
      createdBy: body.createdBy,
      isPublic: body.isPublic || false
    });
    
    // 템플릿 생성 알림
    await broadcastMessage('template', {
      action: 'created',
      templateId: template.id,
      timestamp: Date.now()
    });
    
    return NextResponse.json({
      success: true,
      template,
      message: '템플릿이 성공적으로 생성되었습니다.'
    });
  } catch (error) {
    console.error('템플릿 생성 중 오류:', error);
    return NextResponse.json({ error: '템플릿 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 템플릿 공유 상태 변경
export async function PUT(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const body = await req.json();
    
    if (!body.templateId) {
      return NextResponse.json({ error: 'templateId 필드가 필요합니다.' }, { status: 400 });
    }
    
    // 공유 상태가 명시되지 않은 경우 기본값으로 true 설정
    const isPublic = body.isPublic !== undefined ? body.isPublic : true;
    
    const success = await backupService.setTemplatePublic(body.templateId, isPublic);
    
    if (!success) {
      return NextResponse.json({ 
        error: '템플릿 공유 상태 변경에 실패했습니다. 템플릿이 존재하지 않습니다.' 
      }, { status: 404 });
    }
    
    // 템플릿 업데이트 알림
    await broadcastMessage('template', {
      action: 'updated',
      templateId: body.templateId,
      isPublic,
      timestamp: Date.now()
    });
    
    return NextResponse.json({
      success: true,
      message: `템플릿이 ${isPublic ? '공개' : '비공개'}로 설정되었습니다.`
    });
  } catch (error) {
    console.error('템플릿 공유 상태 변경 중 오류:', error);
    return NextResponse.json({ error: '템플릿 공유 상태 변경 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 