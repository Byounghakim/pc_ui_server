/**
 * 실시간 다중 클라이언트 동기화를 위한 클라이언트 서비스
 */

// 이벤트 유형 정의
export type SyncEventType = 
  | 'task_updated' 
  | 'task_created' 
  | 'task_deleted' 
  | 'editing_status_changed'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'user_connected'
  | 'user_disconnected'
  | 'presence_changed'
  | 'activity_logged';

// 이벤트 리스너 타입
export type SyncEventListener = (data: any) => void;

// 상태 변경에 대한 콜백 함수 타입
export type SyncStateCallback = (state: SyncClientState) => void;

// 동기화 클라이언트 상태
export interface SyncClientState {
  connected: boolean;
  connectionId?: string;
  lastEventTimestamp?: number;
  reconnecting: boolean;
  reconnectAttempts: number;
  clientId: string;
  eventsQueue: any[];
  queuePaused: boolean;
}

class SyncClient {
  private eventSource: EventSource | null = null;
  private listeners: Map<SyncEventType, SyncEventListener[]> = new Map();
  private stateListeners: SyncStateCallback[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000; // 초기 재연결 지연 시간 (ms)
  private maxReconnectDelay = 30000; // 최대 재연결 지연 시간 (ms)
  private reconnectBackoff = 1.5; // 재연결 지연 배수
  
  // 클라이언트 상태
  private state: SyncClientState = {
    connected: false,
    reconnecting: false,
    reconnectAttempts: 0,
    clientId: this.generateClientId(),
    eventsQueue: [],
    queuePaused: false
  };

  constructor() {
    // 페이지 언로드 시 연결 종료
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.disconnect();
      });
    }
  }

  /**
   * 동기화 서버에 연결
   */
  connect(): void {
    if (typeof window === 'undefined') return;
    
    // 이미 연결되어 있으면 무시
    if (this.eventSource && this.state.connected) return;
    
    try {
      // SSE 연결 설정
      const url = `/api/sync?clientId=${this.state.clientId}&timestamp=${Date.now()}`;
      this.eventSource = new EventSource(url);
      
      // 연결 이벤트 핸들러
      this.eventSource.onopen = () => {
        console.log('동기화 서버에 연결되었습니다.');
        this.updateState({
          connected: true,
          reconnecting: false,
          reconnectAttempts: 0
        });
        
        // 사용자 온라인 상태 알림
        this.sendEvent('presence', {
          clientId: this.state.clientId,
          action: 'connect',
          timestamp: Date.now()
        });
        
        // 큐에 있는 이벤트 전송
        this.processQueuedEvents();
      };
      
      // 에러 핸들러
      this.eventSource.onerror = (error) => {
        console.error('동기화 서버 연결 오류:', error);
        
        // 연결 실패 시
        if (this.state.connected) {
          this.updateState({
            connected: false,
            reconnecting: true
          });
        }
        
        // 재연결 시도
        this.reconnect();
      };
      
      // 메시지 핸들러
      this.eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // 이벤트 처리
          if (data && data.type && data.payload) {
            this.updateState({
              lastEventTimestamp: data.timestamp || Date.now()
            });
            
            // 리스너들에게 이벤트 전파
            this.dispatchEvent(data.type as SyncEventType, data.payload);
          }
        } catch (error) {
          console.error('메시지 처리 중 오류:', error);
        }
      });
      
      // 서버에서 전송한 특정 이벤트 구독
      ['task', 'editing', 'conflict', 'presence', 'users', 'activity'].forEach(channel => {
        this.eventSource?.addEventListener(channel, (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.action) {
              // 채널과 액션을 조합하여 이벤트 타입 생성
              // 예: 'task.updated' -> 'task_updated'
              const eventType = `${channel}_${data.action}` as SyncEventType;
              this.dispatchEvent(eventType, data);
            }
          } catch (error) {
            console.error(`${channel} 이벤트 처리 중 오류:`, error);
          }
        });
      });
      
    } catch (error) {
      console.error('동기화 서버 연결 중 오류:', error);
      this.reconnect();
    }
  }

  /**
   * 동기화 서버 연결 종료
   */
  disconnect(): void {
    // 연결 종료 전 로그아웃 알림
    if (this.state.connected) {
      this.sendEvent('presence', {
        clientId: this.state.clientId,
        action: 'disconnect',
        timestamp: Date.now()
      });
    }

    // EventSource 종료
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    // 재연결 타이머 취소
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // 상태 업데이트
    this.updateState({
      connected: false,
      reconnecting: false
    });
  }

  /**
   * 서버로 이벤트 전송
   */
  sendEvent(type: string, data: any): void {
    if (typeof window === 'undefined') return;
    
    const payload = {
      type,
      clientId: this.state.clientId,
      timestamp: Date.now(),
      data
    };
    
    // 연결이 끊어진 경우 큐에 저장
    if (!this.state.connected && !this.state.queuePaused) {
      this.state.eventsQueue.push(payload);
      return;
    }
    
    // HTTP 요청으로 이벤트 전송
    fetch('/api/sync/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(error => {
      console.error('이벤트 전송 중 오류:', error);
      
      // 전송 실패 시 큐에 추가
      this.state.eventsQueue.push(payload);
    });
  }

  /**
   * 이벤트 리스너 등록
   */
  on(eventType: SyncEventType, listener: SyncEventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    
    const eventListeners = this.listeners.get(eventType)!;
    
    // 중복 리스너 방지
    if (!eventListeners.includes(listener)) {
      eventListeners.push(listener);
    }
  }

  /**
   * 이벤트 리스너 제거
   */
  off(eventType: SyncEventType, listener?: SyncEventListener): void {
    if (!this.listeners.has(eventType)) return;
    
    // 특정 리스너 제거
    if (listener) {
      const listeners = this.listeners.get(eventType)!;
      const index = listeners.indexOf(listener);
      
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    } 
    // 모든 리스너 제거
    else {
      this.listeners.delete(eventType);
    }
  }

  /**
   * 상태 변경 리스너 등록
   */
  onStateChange(callback: SyncStateCallback): () => void {
    this.stateListeners.push(callback);
    
    // 현재 상태 즉시 전달
    callback({ ...this.state });
    
    // 리스너 제거 함수 반환
    return () => {
      const index = this.stateListeners.indexOf(callback);
      if (index !== -1) {
        this.stateListeners.splice(index, 1);
      }
    };
  }

  /**
   * 상태 업데이트
   */
  private updateState(updates: Partial<SyncClientState>): void {
    this.state = { ...this.state, ...updates };
    
    // 모든 상태 리스너에게 알림
    this.stateListeners.forEach(listener => {
      listener({ ...this.state });
    });
  }

  /**
   * 이벤트 전파
   */
  private dispatchEvent(eventType: SyncEventType, data: any): void {
    // 자신이 발생시킨 이벤트는 무시
    if (data.clientId === this.state.clientId && !data.broadcast) {
      return;
    }
    
    // 리스너들에게 이벤트 전달
    if (this.listeners.has(eventType)) {
      const listeners = this.listeners.get(eventType)!;
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`${eventType} 이벤트 처리 중 오류:`, error);
        }
      });
    }
  }

  /**
   * 서버에 재연결 시도
   */
  private reconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // 최대 재시도 횟수 제한 없음
    const reconnectAttempts = this.state.reconnectAttempts + 1;
    
    // 지수 백오프로 재연결 지연 시간 계산
    const delay = Math.min(
      this.reconnectDelay * Math.pow(this.reconnectBackoff, reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    
    this.updateState({
      reconnectAttempts,
      reconnecting: true
    });
    
    console.log(`${delay}ms 후 재연결 시도 (${reconnectAttempts}번째)`);
    
    // 재연결 시도
    this.reconnectTimer = setTimeout(() => {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      
      this.connect();
    }, delay);
  }

  /**
   * 클라이언트 ID 생성
   */
  private generateClientId(): string {
    // 브라우저에 저장된 ID 사용 (새로고침 시 같은 ID 유지)
    if (typeof localStorage !== 'undefined') {
      const storedId = localStorage.getItem('sync_client_id');
      if (storedId) return storedId;
      
      const newId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('sync_client_id', newId);
      return newId;
    }
    
    // 로컬 스토리지를 사용할 수 없는 경우
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * 큐에 있는 이벤트 처리
   */
  private processQueuedEvents(): void {
    if (!this.state.connected || this.state.queuePaused || this.state.eventsQueue.length === 0) {
      return;
    }
    
    // 큐 처리 중 일시 정지
    this.updateState({ queuePaused: true });
    
    // 큐의 이벤트 복사 후 초기화
    const events = [...this.state.eventsQueue];
    this.updateState({ eventsQueue: [] });
    
    // 이벤트 일괄 전송
    Promise.all(
      events.map(event => 
        fetch('/api/sync/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        }).catch(error => {
          console.error('큐 이벤트 전송 중 오류:', error);
          return Promise.reject(error);
        })
      )
    )
    .catch(error => {
      console.error('일부 큐 이벤트 전송 실패:', error);
      
      // 실패한 이벤트 다시 큐에 추가 (추가 로직 필요)
    })
    .finally(() => {
      // 큐 처리 재개
      this.updateState({ queuePaused: false });
    });
  }
  
  /**
   * 태스크 편집 상태 설정
   */
  setTaskEditingStatus(taskId: string, isEditing: boolean): void {
    this.sendEvent('editing', {
      taskId,
      clientId: this.state.clientId,
      isEditing,
      timestamp: Date.now()
    });
  }
  
  /**
   * 태스크 변경사항 브로드캐스트
   */
  broadcastTaskChange(taskId: string, changeType: 'created' | 'updated' | 'deleted'): void {
    this.sendEvent('task', {
      taskId,
      action: changeType,
      clientId: this.state.clientId,
      timestamp: Date.now()
    });
  }
  
  /**
   * 현재 클라이언트 ID 가져오기
   */
  getClientId(): string {
    return this.state.clientId;
  }
  
  /**
   * 현재 연결 상태 가져오기
   */
  isConnected(): boolean {
    return this.state.connected;
  }
}

// 싱글톤 인스턴스
export const syncClient = typeof window !== 'undefined' ? new SyncClient() : null;

// 사용자 정의 훅
export function useSyncEvent(eventType: SyncEventType, listener: SyncEventListener): void {
  if (typeof window === 'undefined' || !syncClient) return;
  
  // 리액트 훅 구현 (실제로는 useEffect 등과 함께 사용)
} 