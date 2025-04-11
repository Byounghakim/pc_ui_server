import { useState, useEffect, useCallback } from 'react';
import { syncClient, SyncEventType, SyncEventListener, SyncClientState } from '../services/sync-client';

/**
 * SyncClient 상태를 사용하는 Hook
 */
export function useSyncState(): SyncClientState | null {
  const [state, setState] = useState<SyncClientState | null>(
    syncClient ? { ...syncClient['state'] } : null
  );
  
  useEffect(() => {
    if (!syncClient) return;
    
    // 상태 변경 구독
    const unsubscribe = syncClient.onStateChange(newState => {
      setState(newState);
    });
    
    return () => {
      unsubscribe();
    };
  }, []);
  
  return state;
}

/**
 * SyncClient에 연결하는 Hook
 */
export function useSyncConnection(autoConnect = true): {
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  isReconnecting: boolean;
  clientId: string | null;
} {
  const state = useSyncState();
  
  const connect = useCallback(() => {
    syncClient?.connect();
  }, []);
  
  const disconnect = useCallback(() => {
    syncClient?.disconnect();
  }, []);
  
  // 자동 연결
  useEffect(() => {
    if (autoConnect && syncClient && !state?.connected && !state?.reconnecting) {
      connect();
    }
    
    return () => {
      // 컴포넌트 언마운트 시 연결 종료 (필요한 경우)
      // disconnect();
    };
  }, [autoConnect, connect, state?.connected, state?.reconnecting]);
  
  return {
    connect,
    disconnect,
    isConnected: state?.connected || false,
    isReconnecting: state?.reconnecting || false,
    clientId: state?.clientId || null
  };
}

/**
 * SyncClient의 특정 이벤트를 구독하는 Hook
 */
export function useSyncEvent<T = any>(eventType: SyncEventType): {
  lastEvent: T | null;
  eventCount: number;
} {
  const [lastEvent, setLastEvent] = useState<T | null>(null);
  const [eventCount, setEventCount] = useState(0);
  
  useEffect(() => {
    if (!syncClient) return;
    
    const handleEvent = (data: T) => {
      setLastEvent(data);
      setEventCount(prev => prev + 1);
    };
    
    // 이벤트 구독
    syncClient.on(eventType, handleEvent as SyncEventListener);
    
    return () => {
      // 구독 해제
      syncClient.off(eventType, handleEvent as SyncEventListener);
    };
  }, [eventType]);
  
  return { lastEvent, eventCount };
}

/**
 * SyncClient를 사용하여 태스크의 편집 상태를 관리하는 Hook
 */
export function useTaskEditingStatus(taskId: string | null): {
  setEditing: (isEditing: boolean) => void;
  isBeingEditedByOthers: boolean;
  editorClientId: string | null;
} {
  const [isBeingEditedByOthers, setIsBeingEditedByOthers] = useState(false);
  const [editorClientId, setEditorClientId] = useState<string | null>(null);
  const state = useSyncState();
  
  // 편집 상태 변경 이벤트 구독
  const { lastEvent } = useSyncEvent<{
    taskId: string;
    clientId: string;
    isEditing: boolean;
  }>('editing_status_changed');
  
  // 다른 클라이언트의 편집 상태 변경 감지
  useEffect(() => {
    if (!lastEvent || !taskId || lastEvent.taskId !== taskId) return;
    
    // 자신의 이벤트는 무시
    if (lastEvent.clientId === state?.clientId) return;
    
    if (lastEvent.isEditing) {
      setIsBeingEditedByOthers(true);
      setEditorClientId(lastEvent.clientId);
    } else if (lastEvent.clientId === editorClientId) {
      setIsBeingEditedByOthers(false);
      setEditorClientId(null);
    }
  }, [lastEvent, taskId, state?.clientId, editorClientId]);
  
  // 편집 상태 설정
  const setEditing = useCallback((isEditing: boolean) => {
    if (!syncClient || !taskId) return;
    
    syncClient.setTaskEditingStatus(taskId, isEditing);
  }, [taskId]);
  
  // 컴포넌트 언마운트 시 편집 상태 해제
  useEffect(() => {
    return () => {
      if (taskId) {
        setEditing(false);
      }
    };
  }, [taskId, setEditing]);
  
  return {
    setEditing,
    isBeingEditedByOthers,
    editorClientId
  };
}

/**
 * SyncClient를 사용하여 태스크 변경사항을 브로드캐스트하는 Hook
 */
export function useTaskSyncBroadcast(): {
  broadcastTaskChange: (taskId: string, changeType: 'created' | 'updated' | 'deleted') => void;
} {
  const broadcastTaskChange = useCallback((
    taskId: string, 
    changeType: 'created' | 'updated' | 'deleted'
  ) => {
    if (!syncClient) return;
    
    syncClient.broadcastTaskChange(taskId, changeType);
  }, []);
  
  return { broadcastTaskChange };
}

/**
 * SyncClient를 사용하여 태스크 변경사항을 감지하는 Hook
 */
export function useTaskChangeListener(
  onTaskCreated?: (data: any) => void,
  onTaskUpdated?: (data: any) => void,
  onTaskDeleted?: (data: any) => void
): void {
  useEffect(() => {
    if (!syncClient) return;
    
    // 태스크 생성 이벤트 리스너
    const handleTaskCreated = (data: any) => {
      onTaskCreated?.(data);
    };
    
    // 태스크 업데이트 이벤트 리스너
    const handleTaskUpdated = (data: any) => {
      onTaskUpdated?.(data);
    };
    
    // 태스크 삭제 이벤트 리스너
    const handleTaskDeleted = (data: any) => {
      onTaskDeleted?.(data);
    };
    
    // 이벤트 구독
    if (onTaskCreated) {
      syncClient.on('task_created', handleTaskCreated);
    }
    
    if (onTaskUpdated) {
      syncClient.on('task_updated', handleTaskUpdated);
    }
    
    if (onTaskDeleted) {
      syncClient.on('task_deleted', handleTaskDeleted);
    }
    
    // 구독 해제
    return () => {
      if (onTaskCreated) {
        syncClient.off('task_created', handleTaskCreated);
      }
      
      if (onTaskUpdated) {
        syncClient.off('task_updated', handleTaskUpdated);
      }
      
      if (onTaskDeleted) {
        syncClient.off('task_deleted', handleTaskDeleted);
      }
    };
  }, [onTaskCreated, onTaskUpdated, onTaskDeleted]);
}

/**
 * SyncClient를 사용하여 활성 사용자 목록을 가져오는 Hook
 */
export function useActiveUsers(): {
  activeUsers: any[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const state = useSyncState();
  
  // 사용자 연결/연결 해제 이벤트 구독
  const { lastEvent: userConnectedEvent } = useSyncEvent('user_connected');
  const { lastEvent: userDisconnectedEvent } = useSyncEvent('user_disconnected');
  
  // 활성 사용자 목록 가져오기
  const fetchActiveUsers = useCallback(async () => {
    if (!syncClient) return;
    
    try {
      setLoading(true);
      const response = await fetch(`/api/users/active?clientId=${state?.clientId || ''}`);
      
      if (!response.ok) {
        throw new Error('활성 사용자 목록을 가져오는 데 실패했습니다.');
      }
      
      const data = await response.json();
      setActiveUsers(data.users || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('알 수 없는 오류가 발생했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [state?.clientId]);
  
  // 초기 로드 및 사용자 이벤트 발생 시 재로드
  useEffect(() => {
    fetchActiveUsers();
  }, [fetchActiveUsers, userConnectedEvent, userDisconnectedEvent]);
  
  return {
    activeUsers,
    loading,
    error,
    refetch: fetchActiveUsers
  };
} 