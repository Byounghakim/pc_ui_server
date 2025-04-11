import { v4 as uuidv4 } from 'uuid';

// 이벤트 타입 정의
type EventType = 'task' | 'workLog' | 'state' | 'sync' | 'conflict';

// 이벤트 핸들러 인터페이스
interface EventHandler {
  (data: any): void;
}

// 동기화 서비스 클래스
class SyncService {
  private eventSource: EventSource | null = null;
  private clientId: string = '';
  private reconnectInterval: number = 5000; // 재연결 간격 (ms)
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;
  private eventHandlers: Map<EventType, Set<EventHandler>> = new Map();
  private connected: boolean = false;
  private lastMessageTime: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private apiUrl: string = '/api/sync';
  
  // 싱글톤 패턴을 위한 인스턴스
  private static instance: SyncService;
  
  private constructor() {
    // 클라이언트 ID 생성 또는 복구
    if (typeof window !== 'undefined') {
      this.clientId = localStorage.getItem('sync_client_id') || uuidv4();
      localStorage.setItem('sync_client_id', this.clientId);
    }
    
    // 이벤트 핸들러 맵 초기화
    this.eventHandlers.set('task', new Set());
    this.eventHandlers.set('workLog', new Set());
    this.eventHandlers.set('state', new Set());
    this.eventHandlers.set('sync', new Set());
    this.eventHandlers.set('conflict', new Set());
    
    // 페이지 가시성 변경 이벤트 리스너 (탭 전환 시 연결 관리)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    // 온라인/오프라인 이벤트 리스너
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }
  
  // 싱글톤 인스턴스 가져오기
  public static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }
  
  // 페이지 가시성 변경 핸들러 (탭 전환 시)
  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // 페이지가 다시 보이면 연결 확인
      if (!this.connected) {
        this.connect();
      }
    } else {
      // 페이지가 숨겨지면 연결 상태 유지 (모바일에서 배터리 절약을 위해 필요하면 연결 해제 가능)
    }
  };
  
  // 온라인 상태 핸들러
  private handleOnline = () => {
    console.log('네트워크 연결 복구됨. 동기화 재연결...');
    this.connect();
  };
  
  // 오프라인 상태 핸들러
  private handleOffline = () => {
    console.log('네트워크 연결 끊김. 동기화 일시 중단...');
    this.disconnect();
  };
  
  // SSE 연결 설정
  public connect(): void {
    if (typeof window === 'undefined' || this.eventSource) {
      return;
    }
    
    // 네트워크 상태 확인
    if (!navigator.onLine) {
      console.log('오프라인 상태에서는 동기화 서비스에 연결할 수 없습니다.');
      return;
    }
    
    try {
      console.log('동기화 서비스에 연결 중...');
      
      // EventSource 생성
      this.eventSource = new EventSource(`${this.apiUrl}?clientId=${this.clientId}`);
      
      // 연결 이벤트 핸들러
      this.eventSource.onopen = () => {
        console.log('동기화 서비스에 연결되었습니다.');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        
        // 하트비트 타이머 설정 (연결 상태 모니터링)
        this.startHeartbeatTimer();
      };
      
      // 메시지 이벤트 핸들러
      this.eventSource.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        
        try {
          const { type, data, timestamp } = JSON.parse(event.data);
          
          // 이벤트 타입에 맞는 핸들러 호출
          if (type && this.eventHandlers.has(type as EventType)) {
            this.eventHandlers.get(type as EventType)?.forEach(handler => {
              handler(data);
            });
          }
        } catch (error) {
          console.error('메시지 처리 중 오류:', error);
        }
      };
      
      // 오류 이벤트 핸들러
      this.eventSource.onerror = (error) => {
        console.error('동기화 서비스 연결 오류:', error);
        this.connected = false;
        this.cleanupEventSource();
        
        // 재연결 시도
        this.reconnectAttempts++;
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
          console.log(`${this.reconnectInterval / 1000}초 후 재연결 시도... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          setTimeout(() => this.connect(), this.reconnectInterval);
        } else {
          console.error(`최대 재연결 시도 횟수(${this.maxReconnectAttempts})를 초과했습니다.`);
        }
      };
    } catch (error) {
      console.error('동기화 서비스 초기화 중 오류:', error);
    }
  }
  
  // EventSource 정리
  private cleanupEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  // 하트비트 타이머 시작 (연결 모니터링)
  private startHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      
      // 마지막 메시지로부터 60초 이상 경과하면 연결 재설정
      if (now - this.lastMessageTime > 60000) {
        console.log('장시간 메시지가 없음. 연결 재설정 시도...');
        this.disconnect();
        this.connect();
      }
    }, 30000); // 30초마다 체크
  }
  
  // 연결 해제
  public disconnect(): void {
    this.cleanupEventSource();
    this.connected = false;
  }
  
  // 이벤트 리스너 등록
  public on(eventType: EventType, handler: EventHandler): void {
    if (this.eventHandlers.has(eventType)) {
      this.eventHandlers.get(eventType)?.add(handler);
    }
  }
  
  // 이벤트 리스너 제거
  public off(eventType: EventType, handler: EventHandler): void {
    if (this.eventHandlers.has(eventType)) {
      this.eventHandlers.get(eventType)?.delete(handler);
    }
  }
  
  // 메시지 발행
  public async publish(type: EventType, data: any): Promise<boolean> {
    try {
      if (!this.connected) {
        console.warn('동기화 서비스가 연결되지 않았습니다. 메시지를 저장하고 나중에 전송합니다.');
        this.storeOfflineMessage(type, data);
        return false;
      }
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-ID': this.clientId
        },
        body: JSON.stringify({ type, data })
      });
      
      if (!response.ok) {
        throw new Error(`상태 코드: ${response.status}`);
      }
      
      return true;
    } catch (error) {
      console.error('메시지 발행 중 오류:', error);
      this.storeOfflineMessage(type, data);
      return false;
    }
  }
  
  // 오프라인 메시지 저장
  private storeOfflineMessage(type: EventType, data: any): void {
    if (typeof window === 'undefined') return;
    
    try {
      const offlineMessages = JSON.parse(localStorage.getItem('offline_sync_messages') || '[]');
      offlineMessages.push({ type, data, timestamp: Date.now() });
      
      // 최대 100개까지만 저장
      if (offlineMessages.length > 100) {
        offlineMessages.shift();
      }
      
      localStorage.setItem('offline_sync_messages', JSON.stringify(offlineMessages));
    } catch (error) {
      console.error('오프라인 메시지 저장 중 오류:', error);
    }
  }
  
  // 오프라인 메시지 전송 시도
  public async processOfflineMessages(): Promise<void> {
    if (typeof window === 'undefined' || !this.connected) return;
    
    try {
      const offlineMessages = JSON.parse(localStorage.getItem('offline_sync_messages') || '[]');
      if (offlineMessages.length === 0) return;
      
      console.log(`오프라인 메시지 ${offlineMessages.length}개 처리 중...`);
      
      const processedMessages = [];
      
      for (const message of offlineMessages) {
        try {
          const success = await this.publish(message.type, message.data);
          if (success) {
            processedMessages.push(message);
          }
        } catch (error) {
          console.error('오프라인 메시지 처리 중 오류:', error);
          break; // 오류 발생 시 중단
        }
      }
      
      // 처리된 메시지 제거
      if (processedMessages.length > 0) {
        const remainingMessages = offlineMessages.filter(msg => 
          !processedMessages.some(processed => 
            processed.type === msg.type && 
            processed.timestamp === msg.timestamp
          )
        );
        
        localStorage.setItem('offline_sync_messages', JSON.stringify(remainingMessages));
        console.log(`${processedMessages.length}개의 오프라인 메시지가 처리되었습니다.`);
      }
    } catch (error) {
      console.error('오프라인 메시지 처리 중 오류:', error);
    }
  }
  
  // 연결 상태 확인
  public isConnected(): boolean {
    return this.connected;
  }
  
  // 정리 메서드 (애플리케이션 종료 시)
  public cleanup(): void {
    this.disconnect();
    
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }
}

// 싱글톤 인스턴스 내보내기
export default SyncService.getInstance(); 