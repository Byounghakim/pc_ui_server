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

// 백업 목록 조회
export async function GET(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    // URL 쿼리 파라미터 가져오기
    const url = new URL(req.url);
    const backupId = url.searchParams.get('id');
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const action = url.searchParams.get('action');
    
    // 특정 백업 조회
    if (backupId) {
      const backup = await backupService.getBackupById(backupId);
      
      if (!backup) {
        return NextResponse.json({ error: '백업을 찾을 수 없습니다.' }, { status: 404 });
      }
      
      // 백업 내보내기 요청
      if (action === 'export') {
        const jsonData = await backupService.exportBackupToJson(backupId);
        return new NextResponse(jsonData, {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="backup-${backupId}.json"`
          }
        });
      }
      
      return NextResponse.json(backup);
    }
    
    // 무결성 검증 요청
    if (action === 'validate') {
      const validationResult = await backupService.validateDataIntegrity();
      return NextResponse.json(validationResult);
    }
    
    // 백업 목록 조회
    const backups = await backupService.getBackups(limit);
    
    return NextResponse.json({
      backups,
      total: backups.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('백업 조회 중 오류:', error);
    return NextResponse.json({ error: '백업 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 새 백업 생성
export async function POST(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    
    // 백업 가져오기 요청
    if (action === 'import') {
      const body = await req.json();
      
      if (!body.jsonData) {
        return NextResponse.json({ error: 'jsonData 필드가 필요합니다.' }, { status: 400 });
      }
      
      const backupId = await backupService.importBackupFromJson(body.jsonData);
      
      // 백업 가져오기 알림
      await broadcastMessage('backup', {
        action: 'imported',
        backupId,
        timestamp: Date.now()
      });
      
      return NextResponse.json({
        success: true,
        backupId,
        message: '백업을 성공적으로 가져왔습니다.'
      });
    }
    
    // 백업 복원 요청
    if (action === 'restore') {
      const body = await req.json();
      
      if (!body.backupId) {
        return NextResponse.json({ error: 'backupId 필드가 필요합니다.' }, { status: 400 });
      }
      
      const success = await backupService.restoreFromBackup(body.backupId);
      
      if (success) {
        // 백업 복원 알림
        await broadcastMessage('backup', {
          action: 'restored',
          backupId: body.backupId,
          timestamp: Date.now()
        });
        
        return NextResponse.json({
          success: true,
          message: '백업에서 성공적으로 복원되었습니다.'
        });
      } else {
        return NextResponse.json({ 
          error: '백업 복원에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    // 데이터 복구 요청
    if (action === 'recover') {
      const success = await backupService.attemptDataRecovery();
      
      if (success) {
        // 데이터 복구 알림
        await broadcastMessage('backup', {
          action: 'recovered',
          timestamp: Date.now()
        });
        
        return NextResponse.json({
          success: true,
          message: '데이터가 성공적으로 복구되었습니다.'
        });
      } else {
        return NextResponse.json({ 
          error: '데이터 복구에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    // 기본: 새 백업 생성
    const body = await req.json();
    
    const name = body.name || `수동 백업 - ${new Date().toISOString()}`;
    const description = body.description || '사용자가 생성한 수동 백업';
    
    const backup = await backupService.createFullBackup(name, description);
    
    // 백업 생성 알림
    await broadcastMessage('backup', {
      action: 'created',
      backupId: backup.id,
      timestamp: Date.now()
    });
    
    return NextResponse.json({
      success: true,
      backup,
      message: '백업이 성공적으로 생성되었습니다.'
    });
  } catch (error) {
    console.error('백업 생성 중 오류:', error);
    return NextResponse.json({ error: '백업 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 백업 삭제
export async function DELETE(req: NextRequest) {
  try {
    // 인증 확인
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: '인증되지 않은 요청입니다.' }, { status: 401 });
    }
    
    const url = new URL(req.url);
    const backupId = url.searchParams.get('id');
    const action = url.searchParams.get('action');
    
    // 오래된 백업 정리 요청
    if (action === 'cleanup') {
      const keepCount = parseInt(url.searchParams.get('keep') || '10', 10);
      const success = await backupService.cleanupOldBackups(keepCount);
      
      if (success) {
        return NextResponse.json({
          success: true,
          message: `최신 ${keepCount}개의 백업을 제외한 오래된 백업이 정리되었습니다.`
        });
      } else {
        return NextResponse.json({ 
          error: '백업 정리에 실패했습니다.' 
        }, { status: 500 });
      }
    }
    
    if (!backupId) {
      return NextResponse.json({ error: 'id 쿼리 파라미터가 필요합니다.' }, { status: 400 });
    }
    
    // 백업 존재 확인
    const backup = await backupService.getBackupById(backupId);
    if (!backup) {
      return NextResponse.json({ error: '삭제할 백업을 찾을 수 없습니다.' }, { status: 404 });
    }
    
    // 백업 삭제 (여기서는 구현되지 않음, 컬렉션 및 API 서비스에 추가 필요)
    // 미구현 상태에서는 에러 반환
    return NextResponse.json({ 
      error: '백업 삭제 기능이 아직 구현되지 않았습니다.' 
    }, { status: 501 });
  } catch (error) {
    console.error('백업 삭제 중 오류:', error);
    return NextResponse.json({ error: '백업 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 