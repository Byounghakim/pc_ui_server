import { NextRequest, NextResponse } from 'next/server';
import { broadcastMessage } from '../../sync/route';

// 활성 사용자 정보 인터페이스
interface ActiveUser {
  clientId: string;
  username?: string;
  device?: string;
  lastActivity: number;
  status: 'online' | 'idle' | 'offline';
}

// 활성 사용자 목록 (실제로는 Redis나 다른 저장소에 저장하는 것이 좋음)
const activeUsers = new Map<string, ActiveUser>();

// 비활성 타임아웃 (5분)
const IDLE_TIMEOUT = 5 * 60 * 1000;
// 오프라인 타임아웃 (15분)
const OFFLINE_TIMEOUT = 15 * 60 * 1000;

// 주기적으로 오래된 사용자 상태 업데이트
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    let updates = false;
    
    for (const [clientId, user] of activeUsers.entries()) {
      // 15분 이상 활동이 없으면 목록에서 제거
      if (now - user.lastActivity > OFFLINE_TIMEOUT) {
        if (user.status !== 'offline') {
          user.status = 'offline';
          updates = true;
        }
      } 
      // 5분 이상 활동이 없으면 idle 상태로 변경
      else if (now - user.lastActivity > IDLE_TIMEOUT) {
        if (user.status === 'online') {
          user.status = 'idle';
          updates = true;
        }
      }
    }
    
    // 상태 변경이 있으면 알림
    if (updates) {
      broadcastMessage('users', {
        action: 'status_update',
        users: Array.from(activeUsers.entries()).map(([clientId, user]) => ({
          clientId,
          username: user.username,
          device: user.device,
          status: user.status,
          lastActivity: user.lastActivity
        }))
      });
    }
  }, 60000); // 1분마다 체크
}

// 활성 사용자 목록 가져오기
export async function GET(req: NextRequest) {
  try {
    // URL에서 현재 클라이언트 ID 가져오기
    const url = new URL(req.url);
    const currentClientId = url.searchParams.get('clientId');
    
    // 현재 사용자의 상태 업데이트
    if (currentClientId && activeUsers.has(currentClientId)) {
      const user = activeUsers.get(currentClientId)!;
      user.lastActivity = Date.now();
      user.status = 'online';
      activeUsers.set(currentClientId, user);
    }
    
    // 활성 사용자 목록 반환
    return NextResponse.json({
      users: Array.from(activeUsers.entries())
        .filter(([_, user]) => user.status !== 'offline')
        .map(([clientId, user]) => ({
          clientId,
          username: user.username,
          device: user.device,
          status: user.status,
          lastActivity: user.lastActivity
        })),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('활성 사용자 목록 조회 중 오류:', error);
    return NextResponse.json({ error: '활성 사용자 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 사용자 상태 업데이트
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 요청 유효성 검사
    if (!body.clientId) {
      return NextResponse.json({ error: 'clientId가 필요합니다.' }, { status: 400 });
    }
    
    const { clientId, username, device, status } = body;
    const now = Date.now();
    
    // 새 사용자 또는 기존 사용자 업데이트
    if (!activeUsers.has(clientId)) {
      activeUsers.set(clientId, {
        clientId,
        username: username || `사용자${Math.floor(Math.random() * 10000)}`,
        device: device || 'unknown',
        lastActivity: now,
        status: status || 'online'
      });
    } else {
      const user = activeUsers.get(clientId)!;
      
      // 필드 업데이트
      if (username) user.username = username;
      if (device) user.device = device;
      if (status) user.status = status;
      
      user.lastActivity = now;
      activeUsers.set(clientId, user);
    }
    
    // 상태 변경 알림
    await broadcastMessage('users', {
      action: 'status_update',
      user: {
        clientId,
        username: activeUsers.get(clientId)?.username,
        device: activeUsers.get(clientId)?.device,
        status: activeUsers.get(clientId)?.status,
        lastActivity: activeUsers.get(clientId)?.lastActivity
      }
    });
    
    return NextResponse.json({ 
      success: true,
      user: activeUsers.get(clientId)
    });
  } catch (error) {
    console.error('사용자 상태 업데이트 중 오류:', error);
    return NextResponse.json({ error: '사용자 상태 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 사용자 로그아웃
export async function DELETE(req: NextRequest) {
  try {
    // URL에서 클라이언트 ID 가져오기
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    
    if (!clientId) {
      return NextResponse.json({ error: 'clientId가 필요합니다.' }, { status: 400 });
    }
    
    // 사용자가 존재하면 상태 업데이트
    if (activeUsers.has(clientId)) {
      const user = activeUsers.get(clientId)!;
      user.status = 'offline';
      activeUsers.set(clientId, user);
      
      // 상태 변경 알림
      await broadcastMessage('users', {
        action: 'logout',
        clientId,
        username: user.username
      });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('사용자 로그아웃 중 오류:', error);
    return NextResponse.json({ error: '사용자 로그아웃 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 