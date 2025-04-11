import { NextRequest, NextResponse } from 'next/server';
import { broadcastMessage } from '../../sync/route';

// 활동 로그 인터페이스
interface ActivityLog {
  id: string;
  taskId: string;
  clientId: string;
  username?: string;
  action: 'created' | 'updated' | 'deleted' | 'viewed' | 'completed' | 'restored';
  timestamp: number;
  changes?: {
    field: string;
    oldValue?: any;
    newValue?: any;
  }[];
  metadata?: Record<string, any>;
}

// 활동 로그 저장소 (실제로는 데이터베이스에 저장)
const activityLogs: ActivityLog[] = [];

// 최대 로그 유지 개수
const MAX_LOGS_PER_TASK = 100;

// 활동 로그 생성 함수
function createActivityLog(data: Omit<ActivityLog, 'id' | 'timestamp'>): ActivityLog {
  const id = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now();
  
  const log: ActivityLog = {
    id,
    timestamp,
    ...data
  };
  
  activityLogs.unshift(log);
  
  // 태스크별 로그 수 제한
  const taskLogs = activityLogs.filter(l => l.taskId === data.taskId);
  if (taskLogs.length > MAX_LOGS_PER_TASK) {
    const logsToDelete = taskLogs.slice(MAX_LOGS_PER_TASK);
    for (const logToDelete of logsToDelete) {
      const index = activityLogs.findIndex(l => l.id === logToDelete.id);
      if (index !== -1) {
        activityLogs.splice(index, 1);
      }
    }
  }
  
  return log;
}

// 태스크 활동 로그 조회
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId');
    const clientId = url.searchParams.get('clientId');
    const action = url.searchParams.get('action');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    
    // 필터링된 로그
    let filteredLogs = [...activityLogs];
    
    // 태스크 ID로 필터링
    if (taskId) {
      filteredLogs = filteredLogs.filter(log => log.taskId === taskId);
    }
    
    // 클라이언트 ID로 필터링
    if (clientId) {
      filteredLogs = filteredLogs.filter(log => log.clientId === clientId);
    }
    
    // 액션으로 필터링
    if (action) {
      filteredLogs = filteredLogs.filter(log => log.action === action);
    }
    
    // 페이지네이션
    const totalCount = filteredLogs.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
    
    return NextResponse.json({
      logs: paginatedLogs,
      totalCount,
      totalPages,
      currentPage: page,
      limit,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('활동 로그 조회 중 오류:', error);
    return NextResponse.json({ error: '활동 로그 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 활동 로그 저장
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 필수 필드 검증
    if (!body.taskId || !body.clientId || !body.action) {
      return NextResponse.json({ 
        error: 'taskId, clientId, action 필드가 필요합니다.' 
      }, { status: 400 });
    }
    
    const { taskId, clientId, username, action, changes, metadata } = body;
    
    // 활동 로그 생성
    const log = createActivityLog({
      taskId,
      clientId,
      username,
      action,
      changes,
      metadata
    });
    
    // 활동 알림 브로드캐스트
    await broadcastMessage('activity', {
      action: 'new_activity',
      log
    });
    
    return NextResponse.json({ success: true, log });
  } catch (error) {
    console.error('활동 로그 저장 중 오류:', error);
    return NextResponse.json({ error: '활동 로그 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 특정 태스크에 대한 최근 활동 조회
export async function OPTIONS(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId');
    
    if (!taskId) {
      return NextResponse.json({ error: 'taskId가 필요합니다.' }, { status: 400 });
    }
    
    // 최근 활동 찾기
    const recentActivities = activityLogs
      .filter(log => log.taskId === taskId)
      .slice(0, 5);
    
    // 전체 활동 수
    const totalActivities = activityLogs.filter(log => log.taskId === taskId).length;
    
    // 활동 요약
    const summary = {
      taskId,
      totalActivities,
      lastActivity: recentActivities[0] || null,
      recentActivities
    };
    
    return NextResponse.json(summary);
  } catch (error) {
    console.error('활동 요약 조회 중 오류:', error);
    return NextResponse.json({ error: '활동 요약 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 