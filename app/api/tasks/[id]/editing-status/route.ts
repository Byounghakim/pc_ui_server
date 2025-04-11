import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { broadcastMessage } from '../../../sync/route';

// 편집 상태 저장 (실제로는 Redis나 다른 데이터베이스를 사용하는 것이 좋음)
// 서버리스 환경에서는 인메모리 저장이 제한적이므로 실제 구현에서는 Redis나 다른 저장소 사용 권장
interface EditingInfo {
  taskId: string;
  clientId: string;
  timestamp: number;
}

// 편집 중인 작업 목록
const editingTasks = new Map<string, EditingInfo>();

// 편집 상태 타임아웃 (10분)
const EDITING_TIMEOUT = 10 * 60 * 1000;

// 주기적으로 오래된 편집 상태 정리
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [taskId, info] of editingTasks.entries()) {
      if (now - info.timestamp > EDITING_TIMEOUT) {
        editingTasks.delete(taskId);
        
        // 편집 상태 종료 알림
        broadcastMessage('task', {
          action: 'editing_ended',
          taskId,
          clientId: info.clientId,
          automatic: true
        });
      }
    }
  }, 60000); // 1분마다 체크
}

// 편집 상태 확인 엔드포인트
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    
    // 작업 편집 상태 확인
    const isBeingEdited = editingTasks.has(taskId);
    let editorClientId = null;
    let editingTimestamp = null;
    
    if (isBeingEdited) {
      const info = editingTasks.get(taskId);
      if (info) {
        editorClientId = info.clientId;
        editingTimestamp = info.timestamp;
      }
    }
    
    return NextResponse.json({
      isBeingEdited,
      editorClientId,
      editingTimestamp,
      now: Date.now()
    });
  } catch (error) {
    console.error('편집 상태 확인 중 오류:', error);
    return NextResponse.json({ error: '편집 상태 확인 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 편집 상태 설정 엔드포인트
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    const body = await req.json();
    
    // 요청 유효성 검사
    if (body.clientId === undefined) {
      return NextResponse.json({ error: '클라이언트 ID가 필요합니다.' }, { status: 400 });
    }
    
    const isEditing = !!body.isEditing;
    const clientId = body.clientId;
    
    if (isEditing) {
      // 다른 클라이언트가 이미 편집 중인지 확인
      if (editingTasks.has(taskId)) {
        const currentEditor = editingTasks.get(taskId);
        
        // 같은 클라이언트면 타임스탬프만 업데이트
        if (currentEditor && currentEditor.clientId === clientId) {
          editingTasks.set(taskId, {
            taskId,
            clientId,
            timestamp: Date.now()
          });
          
          return NextResponse.json({ 
            success: true, 
            isBeingEdited: true, 
            editorClientId: clientId 
          });
        }
        
        // 다른 클라이언트가 편집 중이고 시간이 충분히 지났다면 강제로 해제
        if (currentEditor && (Date.now() - currentEditor.timestamp > EDITING_TIMEOUT)) {
          editingTasks.set(taskId, {
            taskId,
            clientId,
            timestamp: Date.now()
          });
          
          // 강제 해제 알림
          await broadcastMessage('task', {
            action: 'editing_forced_end',
            taskId,
            previousClientId: currentEditor.clientId,
            newClientId: clientId
          });
          
          return NextResponse.json({ 
            success: true, 
            isBeingEdited: true, 
            editorClientId: clientId,
            wasForced: true
          });
        }
        
        // 다른 클라이언트가 편집 중이고 시간이 충분히 지나지 않았다면 거부
        return NextResponse.json({ 
          success: false, 
          isBeingEdited: true, 
          editorClientId: currentEditor?.clientId
        }, { status: 409 }); // 409 Conflict
      }
      
      // 편집 시작
      editingTasks.set(taskId, {
        taskId,
        clientId,
        timestamp: Date.now()
      });
      
      // 편집 시작 알림
      await broadcastMessage('task', {
        action: 'editing_started',
        taskId,
        clientId
      });
      
      return NextResponse.json({ 
        success: true, 
        isBeingEdited: true, 
        editorClientId: clientId 
      });
    } else {
      // 편집 종료
      // 편집 중인 클라이언트와 종료 요청 클라이언트가 일치하는지 확인
      const currentEditor = editingTasks.get(taskId);
      
      if (currentEditor && currentEditor.clientId !== clientId) {
        return NextResponse.json({ 
          success: false, 
          error: '다른 클라이언트가 편집 중입니다.'
        }, { status: 403 }); // 403 Forbidden
      }
      
      // 편집 상태 제거
      editingTasks.delete(taskId);
      
      // 편집 종료 알림
      await broadcastMessage('task', {
        action: 'editing_ended',
        taskId,
        clientId
      });
      
      return NextResponse.json({ 
        success: true, 
        isBeingEdited: false 
      });
    }
  } catch (error) {
    console.error('편집 상태 설정 중 오류:', error);
    return NextResponse.json({ error: '편집 상태 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 