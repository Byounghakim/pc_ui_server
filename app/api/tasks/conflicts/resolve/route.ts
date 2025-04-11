import { NextRequest, NextResponse } from 'next/server';
import { broadcastMessage } from '../../../sync/route';
import dbService from '../../../../services/db-service';

// 충돌 해결 엔드포인트
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 요청 유효성 검사
    if (!body.taskId || !body.selectedVersion || !body.clientId) {
      return NextResponse.json({ 
        error: 'taskId, selectedVersion, clientId가 필요합니다.' 
      }, { status: 400 });
    }
    
    const { taskId, selectedVersion, clientId, resolution } = body;
    
    // 가능한 해결 방법: 'local', 'remote', 'merge', 'custom'
    const resolutionType = resolution || 'custom';
    
    try {
      // 버전 충돌 해결
      const success = await dbService.resolveConflict(taskId, selectedVersion);
      
      if (!success) {
        return NextResponse.json({ 
          error: '충돌 해결 실패' 
        }, { status: 500 });
      }
      
      // 충돌 해결 알림
      await broadcastMessage('task', {
        action: 'conflict_resolved',
        taskId,
        clientId,
        resolutionType,
        selectedVersion
      });
      
      return NextResponse.json({ 
        success: true,
        message: '충돌이 성공적으로 해결되었습니다.'
      });
    } catch (error) {
      console.error('충돌 해결 중 오류:', error);
      return NextResponse.json({ 
        error: '충돌 해결 중 서버 오류가 발생했습니다.' 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('충돌 해결 요청 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '요청 처리 중 오류가 발생했습니다.' 
    }, { status: 500 });
  }
}

// 작업 버전 목록 가져오기
export async function GET(req: NextRequest) {
  try {
    // URL에서 taskId 파라미터 추출
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId');
    
    if (!taskId) {
      return NextResponse.json({ 
        error: 'taskId 파라미터가 필요합니다.' 
      }, { status: 400 });
    }
    
    try {
      // 작업 버전 목록 가져오기
      const versions = await dbService.getTaskVersions(taskId);
      
      return NextResponse.json({ 
        success: true,
        taskId,
        versions,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('작업 버전 목록 조회 중 오류:', error);
      return NextResponse.json({ 
        error: '작업 버전 목록 조회 중 서버 오류가 발생했습니다.' 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('작업 버전 목록 요청 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '요청 처리 중 오류가 발생했습니다.' 
    }, { status: 500 });
  }
} 