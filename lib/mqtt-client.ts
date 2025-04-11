import mqtt from "mqtt";
import { MQTT_TOPICS } from './mqtt-topics';

// 상태 저장 래퍼 함수
const saveState = (key: string, state: any) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(state));
    console.log(`상태가 로컬 스토리지에 저장됨 (${key}):`, state);
  }
};

// 상태 복구 래퍼 함수
const loadState = (key: string) => {
  if (typeof window !== 'undefined') {
    const savedState = localStorage.getItem(key);
    if (savedState) {
      try {
        return JSON.parse(savedState);
      } catch (e) {
        console.error(`로컬 스토리지 상태 파싱 오류 (${key}):`, e);
      }
    }
  }
  return null;
};

// MQTT 서버 설정
const MQTT_CONFIG = {
  server: typeof process !== 'undefined' && process.env.NODE_ENV === 'development' 
    ? 'ws://dev.codingpen.com:1884' 
    : 'wss://api.codingpen.com:8884',
  username: 'dnature',
  password: 'XihQ2Q%RaS9u#Z3g'
};

// 문자열 상태 코드 → 숫자 코드 매핑 테이블
export const valveStateMapping = {
  "extraction_circulation": "1000", // 추출순환
  "full_circulation": "0000",       // 전체순환
  "valve_exchange": "0100",         // 전체순환_교환
  "extraction_open": "1100"         // 추출개방
};

// 숫자 코드 → 설명 텍스트 매핑 테이블
export const valveDescMapping = {
  "1000": { valveA: "추출순환", valveB: "OFF" },
  "0100": { valveA: "전체순환", valveB: "ON" },
  "0000": { valveA: "전체순환", valveB: "OFF" },
  "1100": { valveA: "추출순환", valveB: "ON" }
};

class MqttClient {
  private client: mqtt.MqttClient | null = null;
  private topics: Set<string> = new Set();
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private lastState: Map<string, string> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private stateStorageKey: string = 'mqttClientState';
  private connectionTimestamp: number = 0;
  private retryQueue: Map<string, {topic: string, message: string, timestamp: number}> = new Map();
  private isOfflineMode: boolean = false;
  private offlineSupportEnabled: boolean = true;

  constructor(offlineSupportEnabled: boolean = true) {
    // 이벤트 핸들러 초기화
    this.eventHandlers.set('connect', new Set());
    this.eventHandlers.set('disconnect', new Set());
    this.eventHandlers.set('message', new Set());
    this.eventHandlers.set('error', new Set());
    this.eventHandlers.set('offline', new Set());
    this.eventHandlers.set('online', new Set());
    
    this.offlineSupportEnabled = offlineSupportEnabled;
    
    // 서버리스 환경 확인 및 저장된 상태 복원
    if (typeof window !== 'undefined') {
      this.restoreState();
      
      // 온라인/오프라인 이벤트 리스너 등록
      window.addEventListener('online', this.handleOnlineStatus);
      window.addEventListener('offline', this.handleOfflineStatus);
      
      // 초기 네트워크 상태 확인
      this.isOfflineMode = !navigator.onLine;
      if (this.isOfflineMode) {
        console.log('오프라인 모드로 시작합니다.');
        this.emit('offline');
      }
    }
  }
  
  // 온라인 상태 처리
  private handleOnlineStatus = () => {
    console.log('네트워크 연결이 복구되었습니다.');
    this.isOfflineMode = false;
    this.emit('online');
    
    // 연결 재시도
    if (!this.client?.connected) {
      this.reconnect();
    }
    
    // 대기 중인 메시지 처리
    this.processRetryQueue();
  };
  
  // 오프라인 상태 처리
  private handleOfflineStatus = () => {
    console.log('네트워크 연결이 끊겼습니다. 오프라인 모드로 전환합니다.');
    this.isOfflineMode = true;
    this.emit('offline');
  };
  
  // 연결 재시도
  private reconnect() {
    if (this.client) {
      console.log('MQTT 브로커에 재연결을 시도합니다.');
      this.client.reconnect();
    }
  }
  
  // 재시도 큐 처리
  private processRetryQueue() {
    if (!this.client?.connected) return;
    
    console.log(`대기 중인 메시지 처리 (${this.retryQueue.size}개)`);
    
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1시간
    
    Array.from(this.retryQueue.values()).forEach(item => {
      // 오래된 메시지는 제거
      if (now - item.timestamp > maxAge) {
        this.retryQueue.delete(item.topic + item.message);
        console.log(`오래된 메시지 제거: ${item.topic}`);
        return;
      }
      
      // 메시지 재발행
      console.log(`지연된 메시지 발행: ${item.topic} - ${item.message}`);
      this.client!.publish(item.topic, item.message);
      this.retryQueue.delete(item.topic + item.message);
    });
  }

  // 상태 저장 메서드
  private saveState() {
    const state = {
      topics: Array.from(this.topics),
      lastState: Object.fromEntries(this.lastState),
      retryQueue: Array.from(this.retryQueue.values()),
      connectionTimestamp: this.connectionTimestamp,
      isOfflineMode: this.isOfflineMode
    };
    saveState(this.stateStorageKey, state);
  }

  // 상태 복원 메서드
  private restoreState() {
    const savedState = loadState(this.stateStorageKey);
    if (savedState) {
      console.log('저장된 MQTT 상태 복원:', savedState);
      
      // 토픽 복원
      if (savedState.topics && Array.isArray(savedState.topics)) {
        savedState.topics.forEach((topic: string) => {
          this.topics.add(topic);
        });
      }
      
      // 마지막 메시지 상태 복원
      if (savedState.lastState) {
        Object.entries(savedState.lastState).forEach(([topic, message]) => {
          this.lastState.set(topic, message as string);
        });
      }
      
      // 재시도 큐 복원
      if (savedState.retryQueue && Array.isArray(savedState.retryQueue)) {
        savedState.retryQueue.forEach((item: any) => {
          this.retryQueue.set(item.topic + item.message, item);
        });
      }
      
      // 기타 상태 복원
      if (savedState.connectionTimestamp) {
        this.connectionTimestamp = savedState.connectionTimestamp;
      }
      
      if (savedState.isOfflineMode !== undefined) {
        this.isOfflineMode = savedState.isOfflineMode;
      }
    }
  }

  // 이벤트 리스너 등록 메서드
  on(event: string, callback: Function) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)?.add(callback);
    }
    return this;
  }

  // 이벤트 리스너 제거 메서드
  off(event: string, callback: Function) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)?.delete(callback);
    }
    return this;
  }

  // 이벤트 발생 메서드
  private emit(event: string, ...args: any[]) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)?.forEach(handler => {
        handler(...args);
      });
    }
  }

  // MQTT 브로커에 연결
  connect(url?: string, username?: string, password?: string) {
    // 서버리스 환경 확인
    if (typeof window === 'undefined') {
      console.log("서버 사이드에서는 MQTT 연결을 건너뜁니다.");
      return this;
    }

    // 오프라인 모드 확인
    if (this.isOfflineMode) {
      console.log("오프라인 모드에서는 연결을 시도하지 않습니다.");
      this.emit('error', new Error("오프라인 모드에서는 연결할 수 없습니다."));
      return this;
    }

    // 설정값 사용 (파라미터로 전달된 값이 있으면 우선 사용)
    const serverUrl = url || MQTT_CONFIG.server;
    const user = username || MQTT_CONFIG.username;
    const pass = password || MQTT_CONFIG.password;

    console.log(`MQTT 브로커에 연결 시도 중: ${serverUrl}`);

    if (this.client?.connected) {
      console.log("이미 연결되어 있습니다.");
      this.emit('connect');
      return this;
    }

    // 기존 연결이 있다면 정리
    if (this.client) {
      this.client.end(true);
    }

    try {
      // MQTT 연결 옵션
      const options: mqtt.IClientOptions = {
        clientId: `client_${Math.random().toString(16).substring(2, 10)}`,
        username: user,
        password: pass,
        keepalive: 60,
        reconnectPeriod: 5000, // 5초
        connectTimeout: 30 * 1000, // 30초
        clean: true
      };

      // MQTT 클라이언트 생성 및 연결
      this.client = mqtt.connect(serverUrl, options);
      
      // 연결 이벤트 핸들러
      this.client.on("connect", () => {
        this.isOfflineMode = false;
        this.connectionTimestamp = Date.now();
        this.reconnectAttempts = 0;
        console.log('MQTT 브로커에 연결되었습니다.');
        this.saveState();
        this.emit('connect');
        
        Array.from(this.topics).forEach(topic => {
          this.client!.subscribe(topic, { qos: 1 }, err => {
            if (err) {
              console.error(`토픽 구독 실패: ${topic}`, err);
            } else {
              console.log(`토픽 구독 성공: ${topic}`);
            }
          });
        });
        
        // 대기 중인 메시지 처리
        this.processRetryQueue();
      });
      
      // 재연결 이벤트 핸들러
      this.client.on("reconnect", () => {
        this.reconnectAttempts++;
        console.log(`MQTT 브로커에 재연결 시도 중... (${this.reconnectAttempts}번째)`);
        
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
          this.disconnect();
          this.reconnectAttempts = 0;
          this.isOfflineMode = true;
          this.saveState();
          this.emit('offline');
          this.emit('error', new Error("최대 재연결 시도 횟수 초과"));
        }
      });

      this.client.on("error", (err) => {
        console.error("MQTT 오류:", err.message);
        this.emit('error', err);
      });

      this.client.on("close", () => {
        console.log("MQTT 연결이 종료되었습니다.");
        this.emit('disconnect');
      });

      this.client.on("message", (topic, message) => {
        const messageStr = message.toString();
        console.log(`메시지 수신: ${topic} - ${messageStr.substring(0, 100)}${messageStr.length > 100 ? '...' : ''}`);
        
        // 마지막 수신 메시지 저장
        this.lastState.set(topic, messageStr);
        this.saveState();
        
        this.emit('message', topic, messageStr);
      });
      
      this.client.on("offline", () => {
        console.log("MQTT 클라이언트가 오프라인 상태가 되었습니다.");
        this.isOfflineMode = true;
        this.saveState();
        this.emit('offline');
      });
    } catch (err) {
      console.error("MQTT 연결 오류:", err);
      this.emit('error', err as Error);
    }

    return this;
  }

  // 토픽 구독
  subscribe(topic: string) {
    if (typeof window === 'undefined') {
      console.log(`서버 사이드에서는 토픽 구독을 건너뜁니다: ${topic}`);
      return this;
    }

    this.topics.add(topic);
    this.saveState();

    if (!this.client?.connected) {
      console.log(`토픽 ${topic}을(를) 구독하기 위해 대기 중. 연결 후 구독합니다.`);
      return this;
    }

    this.client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`토픽 구독 실패: ${topic}`, err);
      } else {
        console.log(`토픽 구독 성공: ${topic}`);
      }
    });

    return this;
  }

  // 토픽 구독 해제
  unsubscribe(topic: string) {
    if (typeof window === 'undefined') {
      console.log(`서버 사이드에서는 토픽 구독 해제를 건너뜁니다: ${topic}`);
      return this;
    }

    this.topics.delete(topic);
    this.saveState();

    if (!this.client?.connected) {
      console.log(`토픽 ${topic}을(를) 구독 해제하기 위해 대기 중. 연결 후 구독 해제합니다.`);
      return this;
    }

    this.client.unsubscribe(topic, (err) => {
      if (err) {
        console.error(`토픽 구독 해제 실패: ${topic}`, err);
      } else {
        console.log(`토픽 구독 해제 성공: ${topic}`);
      }
    });

    return this;
  }

  // 메시지 발행
  publish(topic: string, message: string) {
    if (typeof window === 'undefined') {
      console.log(`서버 사이드에서는 메시지 발행을 건너뜁니다: ${topic} - ${message}`);
      return this;
    }

    // STATUS 명령어는 더 이상 사용하지 않으므로 완전히 차단
    if (message.trim() === 'STATUS') {
      console.log(`STATUS 명령은 더 이상 사용되지 않습니다: ${topic}`);
      return this; // 메시지 발행하지 않고 리턴
    }

    // 오프라인 모드에서 메시지 발행 시
    if (this.isOfflineMode && this.offlineSupportEnabled) {
      console.log(`오프라인 모드에서 메시지 발행 - 큐에 추가: ${topic} - ${message}`);
      
      // 상태 저장
      this.lastState.set(topic, message);
      
      // 재시도 큐에 추가
      this.retryQueue.set(topic + message, {
        topic,
        message,
        timestamp: Date.now()
      });
      
      this.saveState();
      
      // 오프라인 모드에서 이벤트 에뮬레이션 (UI 즉시 업데이트를 위해)
      this.emit('message', topic, message);
      
      return this;
    }

    // 항상 로컬 상태 저장
    this.lastState.set(topic, message);
    this.saveState();

    if (!this.client?.connected) {
      console.log(`토픽 ${topic}에 메시지 발행을 위해 대기 중. 연결 후 발행합니다.`);
      
      // 재시도 큐에 추가
      if (this.offlineSupportEnabled) {
        this.retryQueue.set(topic + message, {
          topic,
          message,
          timestamp: Date.now()
        });
        this.saveState();
      }
      
      // 연결 후 메시지 발행을 위해 이벤트 핸들러 등록
      const publishAfterConnect = () => {
        console.log(`연결 후 발행: ${topic} - ${message}`);
        this.client?.publish(topic, message, { qos: 1, retain: true });
        
        this.off('connect', publishAfterConnect);
      };
      
      this.on('connect', publishAfterConnect);
      return this;
    }

    this.client.publish(topic, message, { qos: 1, retain: true }, (err) => {
      if (err) {
        console.error(`메시지 발행 실패: ${topic}`, err);
        
        // 실패한 메시지 재시도 큐에 추가
        if (this.offlineSupportEnabled) {
          this.retryQueue.set(topic + message, {
            topic,
            message,
            timestamp: Date.now()
          });
          this.saveState();
        }
      } else {
        console.log(`메시지 발행 성공: ${topic} - ${message}`);
      }
    });

    return this;
  }

  // 저장된 마지막 메시지 가져오기
  getLastMessage(topic: string): string | null {
    const message = this.lastState.get(topic);
    return message || null;
  }

  // 연결 종료
  disconnect() {
    if (typeof window !== 'undefined') {
      // 온라인/오프라인 이벤트 리스너 제거
      window.removeEventListener('online', this.handleOnlineStatus);
      window.removeEventListener('offline', this.handleOfflineStatus);
    }
    
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    return this;
  }

  // 연결 상태 확인
  isConnected(): boolean {
    if (this.isOfflineMode) return false;
    return !!this.client?.connected;
  }
  
  // 오프라인 모드 확인
  isOffline(): boolean {
    return this.isOfflineMode;
  }
  
  // 오프라인 지원 활성화/비활성화
  setOfflineSupport(enabled: boolean) {
    this.offlineSupportEnabled = enabled;
    return this;
  }
  
  // 밸브 상태 코드를 설명 텍스트로 변환
  getValveDescription(stateCode: string) {
    return valveDescMapping[stateCode as keyof typeof valveDescMapping] || { valveA: "알 수 없음", valveB: "알 수 없음" };
  }
  
  // 설명 텍스트를 밸브 상태 코드로 변환
  getValveStateCode(stateName: string) {
    return valveStateMapping[stateName as keyof typeof valveStateMapping] || "0000";
  }
  
  // 밸브 상태 메시지 파싱
  parseValveStateMessage(message: string) {
    try {
      if (!message) return { valveState: "0000", valveADesc: "알 수 없음", valveBDesc: "알 수 없음" };
      
      // 메시지 형식에 따라 파싱
      let valveState = "0000";
      
      // 숫자 형식인 경우
      if (/^\d+$/.test(message)) {
        valveState = message.padStart(4, '0');
      } 
      // JSON 형식인 경우
      else if (message.startsWith('{')) {
        try {
          const data = JSON.parse(message);
          valveState = data.valveState || "0000";
        } catch (e) {
          console.error("밸브 상태 JSON 파싱 오류:", e);
        }
      }
      
      // 설명 텍스트 조회
      const desc = this.getValveDescription(valveState);
      
      return {
        valveState,
        valveADesc: desc.valveA,
        valveBDesc: desc.valveB
      };
    } catch (error) {
      console.error("밸브 상태 메시지 파싱 오류:", error);
      
      // 오류 발생 시 저장된 상태 확인
      const savedState = loadState('tankSystemState');
      if (savedState && savedState.valveState) {
        console.log('저장된 밸브 상태 발견:', savedState.valveState);
        return {
          valveState: savedState.valveState,
          valveADesc: savedState.valveADesc || "알 수 없음",
          valveBDesc: savedState.valveBDesc || "알 수 없음"
        };
      }
      
      return { valveState: "0000", valveADesc: "알 수 없음", valveBDesc: "알 수 없음" };
    }
  }
  
  // 클리닝 메서드 - 오래된 메시지 및 상태 정리
  cleanupOldData(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) { // 기본값 1주일
    const now = Date.now();
    
    // 오래된 재시도 큐 항목 정리
    Array.from(this.retryQueue.values()).forEach(item => {
      if (now - item.timestamp > maxAgeMs) {
        this.retryQueue.delete(item.topic + item.message);
      }
    });
    
    this.saveState();
    return this;
  }

  // 시스템 상태 동기화 - Redis로 대체
  syncStoredStates() {
    if (!this.client || !this.isConnected()) {
      console.warn('MQTT 클라이언트가 연결되지 않아 상태를 동기화할 수 없습니다.');
      return;
    }
    
    // 불필요한 tank-system/request 및 tank-system/status 관련 코드 제거
    console.log('Redis를 통해 시스템 상태를 관리합니다.');
    
    try {
      // Redis에서 최신 상태 가져오기 로직은 API 엔드포인트를 통해 처리
      console.log('시스템 상태는 /api/system-state 엔드포인트를 통해 제공됩니다.');
    } catch (error) {
      console.error('시스템 상태 동기화 오류:', error);
    }
  }
}

export default MqttClient; 