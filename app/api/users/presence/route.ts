import { NextRequest, NextResponse } from 'next/server';
import { broadcastMessage } from '../../sync/route';

// 현재 사용자의 활동 정보를 저장하는 맵
interface UserPresence {
  clientId: string;
  location: string; // 현재 페이지 또는 작업 중인 문서 ID
  action: 'viewing' | 'editing' | 'idle';
  taskId?: string; // 작업 중인 태스크 ID
  lastUpdated: number;
}

// 사용자 활동 정보 저장소
const userPresenceMap = new Map<string, UserPresence>();

// 오래된 활동 정보 제거 (10분)
const PRESENCE_TIMEOUT = 10 * 60 * 1000;

// 주기적으로 오래된 활동 정보 정리
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    let updates = false;
    
    for (const [clientId, presence] of userPresenceMap.entries()) {
      if (now - presence.lastUpdated > PRESENCE_TIMEOUT) {
        userPresenceMap.delete(clientId);
        updates = true;
      }
    }
    
    if (updates) {
      // 활동 정보가 변경되었으므로 알림
      broadcastMessage('presence', {
        action: 'presence_update',
        presences: Array.from(userPresenceMap.values())
      });
    }
  }, 60000); // 1분마다 체크
}

// 모든 사용자의 활동 정보 조회
export async function GET(req: NextRequest) {
  try {
    // URL에서 현재 클라이언트 ID 가져오기
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    const location = url.searchParams.get('location');
    
    // 현재 사용자가 정보 업데이트를 같이 요청한 경우
    if (clientId && location) {
      await updateUserPresence(clientId, location, 'viewing');
    }
    
    return NextResponse.json({
      presences: Array.from(userPresenceMap.values()),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('활동 정보 조회 중 오류:', error);
    return NextResponse.json({ error: '활동 정보 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 사용자 활동 정보 업데이트
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 요청 유효성 검사
    if (!body.clientId || !body.location) {
      return NextResponse.json({ 
        error: 'clientId와 location이 필요합니다.' 
      }, { status: 400 });
    }
    
    const { clientId, location, action = 'viewing', taskId } = body;
    
    // 활동 정보 업데이트
    await updateUserPresence(clientId, location, action, taskId);
    
    return NextResponse.json({ 
      success: true,
      presence: userPresenceMap.get(clientId)
    });
  } catch (error) {
    console.error('활동 정보 업데이트 중 오류:', error);
    return NextResponse.json({ error: '활동 정보 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 내부 함수: 사용자 활동 정보 업데이트 및 브로드캐스팅
async function updateUserPresence(
  clientId: string, 
  location: string, 
  action: 'viewing' | 'editing' | 'idle' = 'viewing',
  taskId?: string
) {
  const now = Date.now();
  const oldPresence = userPresenceMap.get(clientId);
  
  // 새 활동 정보 생성
  const newPresence: UserPresence = {
    clientId,
    location,
    action,
    taskId,
    lastUpdated: now
  };
  
  // 변경 사항이 있는지 확인
  const hasChanges = !oldPresence || 
    oldPresence.location !== location || 
    oldPresence.action !== action || 
    oldPresence.taskId !== taskId;
  
  // 업데이트
  userPresenceMap.set(clientId, newPresence);
  
  // 변경 사항이 있으면 알림
  if (hasChanges) {
    await broadcastMessage('presence', {
      action: 'presence_update',
      presence: newPresence,
      previousLocation: oldPresence?.location
    });
  }
  
  return newPresence;
} 