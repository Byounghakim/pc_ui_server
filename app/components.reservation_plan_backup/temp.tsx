"use client"
import { motion } from "framer-motion"
import { useEffect, useState, useRef, useCallback } from "react"
import { MqttClient } from "mqtt"
import { cn } from '@/lib/utils';
import "./tank-system.css"; // 새로 생성한 CSS 파일 import

// 고유 클라이언트 ID 생성 함수
const generateClientId = () => {
  if (typeof window === 'undefined') return 'server';
  return `client_${Math.random().toString(36).substring(2, 15)}`;
};

// 시스템 상태 저장 및 불러오기 함수 개선
const saveState = async (stateToSave: any) => {
  try {
    // 로컬 스토리지에 상태 저장
    if (typeof window !== 'undefined') {
      localStorage.setItem('tankSystemState', JSON.stringify(stateToSave));
      
      // API 호출 비활성화 - 서버 API 대신 로컬 스토리지만 사용
      console.log('서버 API 호출 대신 로컬 스토리지에만 저장합니다.');
      
      // IndexedDB에도 저장
      if (typeof saveToIndexedDB === 'function') {
        saveToIndexedDB(stateToSave);
      }
      
      // 다른 탭/창에 상태 변경 알림
      localStorage.setItem('tankSystemStateUpdate', Date.now().toString());
    }
  } catch (error) {
    console.error('상태 저장 실패:', error);
  }
};

// IndexedDB에 상태 저장
const saveToIndexedDB = (state: any) => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    console.warn('IndexedDB를 사용할 수 없습니다.');
    return;
  }
  
  try {
    const request = window.indexedDB.open('TankSystemDB', 1);
    
    request.onupgradeneeded = function(event) {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains('systemState')) {
          db.createObjectStore('systemState', { keyPath: 'id' });
        }
      } catch (error) {
        console.error('IndexedDB 스키마 업그레이드 중 오류:', error);
        // 오류가 발생해도 계속 진행
      }
    };
    
    request.onsuccess = function(event) {
      try {
        const db = request.result;
        const transaction = db.transaction(['systemState'], 'readwrite');
        const store = transaction.objectStore('systemState');
        
        // 항상 같은 키로 저장하여 최신 상태만 유지
        const putRequest = store.put({
          id: 'currentState',
          data: state,
          timestamp: Date.now()
        });
        
        putRequest.onsuccess = function() {
          console.log('IndexedDB에 상태 저장 성공');
        };
        
        putRequest.onerror = function(event) {
          console.warn('IndexedDB 데이터 저장 중 오류:', event);
        };
        
        transaction.oncomplete = function() {
          db.close();
        };
        
        transaction.onerror = function(event) {
          console.warn('IndexedDB 트랜잭션 오류:', event);
        };
      } catch (error) {
        console.error('IndexedDB 트랜잭션 생성 중 오류:', error);
      }
    };
    
    request.onerror = function(event) {
      console.warn('IndexedDB 열기 오류:', event);
    };
  } catch (error) {
    console.error('IndexedDB 접근 중 예상치 못한 오류:', error);
  }
};

// 상태 불러오기 함수 개선
const loadState = () => {
  if (typeof window !== 'undefined') {
    try {
      const storedState = localStorage.getItem('tankSystemState');
      
      if (storedState) {
        return JSON.parse(storedState);
      }
      
      return null;
    } catch (error) {
      console.error('상태 불러오기 실패:', error);
      return null;
    }
  }
  
  return null;
};

// 서버에서 초기 상태 불러오기
const loadInitialState = async (): Promise<any> => {
  if (typeof window !== 'undefined') {
    try {
      // 서버 API에서 상태 가져오기
      if (window.navigator.onLine) {
        try {
          console.log('서버에서 최신 상태 불러오기 시도...');
          console.log('API 호출 대신 로컬 스토리지만 사용합니다.');
        } catch (serverError) {
          console.error('서버에서 상태 불러오기 실패:', serverError);
          // 서버 오류 시 계속 진행 - 로컬 저장소 사용
        }
      }
      
      // 서버에서 불러오기 실패 시 로컬 스토리지에서 불러오기 시도
      try {
        const localState = loadState();
        if (localState) {
          console.log('로컬 스토리지에서 상태를 불러왔습니다.');
          return localState;
        }
      } catch (localError) {
        console.error('로컬 스토리지에서 상태 불러오기 실패:', localError);
        // 로컬 스토리지 오류 시 계속 진행 - IndexedDB 사용
      }
      
      // IndexedDB에서 불러오기 시도
      try {
        const idbState = await loadFromIndexedDB();
        if (idbState) {
          console.log('IndexedDB에서 상태를 불러왔습니다.');
          return idbState;
        }
      } catch (idbError) {
        console.error('IndexedDB에서 상태 불러오기 실패:', idbError);
        // IndexedDB 오류 시 기본값 사용
      }
    } catch (error) {
      console.error('초기 상태 불러오기 전체 프로세스 실패:', error);
      // 모든 오류 시 기본값 사용
    }
  }
  
  console.log('사용 가능한 저장된 상태가 없습니다. 기본값 사용.');
  return null;
};

// IndexedDB에서 상태 불러오기 (Promise 반환)
const loadFromIndexedDB = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB를 사용할 수 없습니다.');
      resolve(null);
      return;
    }
    
    try {
      const request = window.indexedDB.open('TankSystemDB', 1);
      
      request.onupgradeneeded = function(event) {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains('systemState')) {
            db.createObjectStore('systemState', { keyPath: 'id' });
          }
        } catch (error) {
          console.error('IndexedDB 스키마 업그레이드 중 오류:', error);
          // 업그레이드 오류가 발생해도 계속 진행 가능하도록 함
        }
      };
      
      request.onsuccess = function(event) {
        try {
          const db = request.result;
          const transaction = db.transaction(['systemState'], 'readonly');
          const store = transaction.objectStore('systemState');
          const getRequest = store.get('currentState');
          
          getRequest.onsuccess = function() {
            if (getRequest.result) {
              resolve(getRequest.result.data);
            } else {
              console.log('IndexedDB에 저장된 상태가 없습니다.');
              resolve(null);
            }
          };
          
          getRequest.onerror = function(event) {
            console.warn('IndexedDB 읽기 오류:', event);
            resolve(null); // 오류 발생 시에도 null을 반환하여 앱이 계속 실행되도록 함
          };
          
          transaction.oncomplete = function() {
            db.close();
          };
        } catch (error) {
          console.error('IndexedDB 트랜잭션 중 오류:', error);
          resolve(null);
        }
      };
      
      request.onerror = function(event) {
        console.warn('IndexedDB 접근 오류:', event);
        resolve(null); // reject 대신 resolve(null)을 사용하여 앱이 계속 실행되도록 함
      };
    } catch (error) {
      console.error('IndexedDB 사용 중 예상치 못한 오류:', error);
      resolve(null); // 모든 예외 상황에서도 앱이 계속 실행되도록 함
    }
  });
};

interface Tank {
  id: number
  level: number
  status: "empty" | "filling" | "full"
  pumpStatus: "ON" | "OFF"
  inverter: number
}

interface TankSystemProps {
  tankData: {
    mainTank: {
      level: number
      status: string
    }
    tanks: Tank[]
    valveState: string
    valveStatusMessage?: string
    valveADesc?: string  // 밸브 A 설명 추가
    valveBDesc?: string  // 밸브 B 설명 추가
    tankMessages?: Record<number, string>
    mainTankMessage?: string
    progressInfo?: {
      step: string
      elapsedTime: string
      remainingTime: string
      totalRemainingTime: string
    }
  }
  onValveChange: (newState: string) => void
  onPumpToggle?: (pumpId: number) => void  // 펌프 토글 함수
  onPumpReset?: (pumpId: number) => void   // 펌프 리셋 함수
  onPumpKCommand?: (pumpId: number) => void // 펌프 K 명령 함수
  // onExtractionCommand 속성 제거됨
  pumpStateMessages?: Record<number, string> // 펌프 상태 메시지
  mqttClient?: MqttClient // MQTT 클라이언트 추가
  kButtonActive?: boolean // K 버튼 활성화 여부
  pumpMessages?: Record<number, string> // 펌프 메시지
  progressMessages?: Array<{timestamp: number, message: string, rawJson?: string | null}> // 진행 메시지 추가
}

// 추출 진행 메시지를 위한 인터페이스
interface ExtractionProgress {
  timestamp: number
  message: string
}

// 연결 상태를 위한 인터페이스
interface ConnectionStatus {
  connected: boolean
  lastConnected: Date | null
  reconnecting: boolean
}

// 펄스 애니메이션을 위한 스타일 추가
const pulseCss = `
  @keyframes pulse {
    0% {
      opacity: 0.6;
    }
    50% {
      opacity: 0.8;
    }
    100% {
      opacity: 0.6;
    }
  }
`;

export default function TankSystem({ 
  tankData, 
  onValveChange, 
  progressMessages = [], 
  onPumpToggle, 
  onPumpReset,
  onPumpKCommand,
  pumpStateMessages = {},
  mqttClient,
  // onExtractionCommand 속성 제거됨
  kButtonActive,
  pumpMessages
}: TankSystemProps) {
  // 고유 클라이언트 ID 생성 함수
  const generateClientId = () => {
    if (typeof window === 'undefined') return 'server';
    return `client_${Math.random().toString(36).substring(2, 15)}`;
  };

  // 애니메이션을 위한 상태 추가
  const [fillPercentage, setFillPercentage] = useState(0);
  
  // 길게 누르기 감지를 위한 타이머 상태 추가
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [currentPressedPump, setCurrentPressedPump] = useState<number | null>(null);
  
  // 클라이언트 ID 상태 추가
  const clientId = useRef(generateClientId());
  
  // 마지막 상태 업데이트 시간
  const [lastStateUpdate, setLastStateUpdate] = useState<Date | null>(null);
  
  // 연결 상태 추가
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    lastConnected: null,
    reconnecting: false
  });
  
  // 상태 변경 알림을 위한 상태
  const [notifications, setNotifications] = useState<Array<{
    message: string,
    timestamp: number,
    source?: string
  }>>([]);

  // 펌프 스위치 드래그 상태
  const [pumpSwitchPosition, setPumpSwitchPosition] = useState<Record<number, number>>({
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 // 모든 펌프에 대한 초기 스위치 위치 설정
  });
  const [draggingPump, setDraggingPump] = useState<number | null>(null);
  const [resetTimers, setResetTimers] = useState<Record<number, NodeJS.Timeout | null>>({});
  const [resetSwitchPosition, setResetSwitchPosition] = useState<Record<number, number>>({});
  // 펌프 리셋 드래그 상태 추가
  const [resetDragState, setResetDragState] = useState<Record<number, { dragging: boolean, position: number, timer: NodeJS.Timeout | null }>>({});
  
  // MQTT 클라이언트 연결 상태 모니터링
  useEffect(() => {
    if (!mqttClient) return;
    
    const subscribeTankTopics = () => {
      console.log('탱크 토픽 구독 중...');
      
      // 필요한 토픽 구독
      for (let i = 1; i <= 6; i++) {
        // 탱크 수위 토픽 구독
        mqttClient.subscribe(`extwork/inverter${i}/tank${i}_level`);
        
        // 인버터 상태 토픽 구독 (펌프 상태)
        mqttClient.subscribe(`extwork/inverter${i}/state`);
      }
      
      // 본탱크 수위 토픽 구독
      mqttClient.subscribe('extwork/tank/level');
      
      // STATUS 요청 제거 - Redis에서 상태를 가져오도록 변경
      // 밸브, 펌프 상태는 MQTT 메시지를 통해 업데이트
      console.log('Redis를 통해 시스템 상태를 관리합니다.');
    };
    
    // MQTT 클라이언트 연결 시 구독 설정
    mqttClient.on('connect', () => {
      console.log('MQTT 연결됨, 탱크 토픽 구독');
      setConnectionStatus({
        connected: true,
        lastConnected: new Date(),
        reconnecting: false
      });
      
      subscribeTankTopics();
    });
    
    // 연결 끊김 처리
    mqttClient.on('disconnect', () => {
      console.log('MQTT 연결 끊김');
      setConnectionStatus(prev => ({
        ...prev,
        connected: false
      }));
    });
    
    // 이미 연결되어 있는 경우 구독 실행
    if (mqttClient.connected) {
      subscribeTankTopics();
    }
    
    // 연결 이벤트 리스너 등록
    mqttClient.on('connect', subscribeTankTopics);
    
    const handleMessage = (topic: string, message: Buffer) => {
      const messageStr = message.toString();
      console.log(`MQTT 메시지 수신: ${topic} - ${messageStr}`);
      
      try {
        // 토픽에 따른 처리
        if (topic === 'tank-system/notifications') {
          const notification = JSON.parse(messageStr);
          
          // 자신이 발생시킨 알림이 아닌 경우에만 처리
          if (notification.clientId !== clientId.current) {
            setNotifications(prev => [
              ...prev,
              {
                message: notification.message,
                timestamp: notification.timestamp,
                source: notification.clientId
              }
            ]);
            
            // 5초 후 알림 제거
            setTimeout(() => {
              setNotifications(prev => 
                prev.filter(n => n.timestamp !== notification.timestamp)
              );
            }, 5000);
          }
        } else if (topic === 'extwork/tankMain/level') {
          // 본탱크 수위 정보 업데이트
          console.log(`본탱크 메시지 수신: ${messageStr}`);
          
          // 시간 문자열 생성
          const timeStr = formatTimeStr();
          
          // 테스트 메시지 처리 (본탱크용)
          if (messageStr.includes("테스트 메시지")) {
            // 테스트 메시지에 시간 추가
            const displayMessage = `본탱크 테스트 (${timeStr})`;
            console.log(`본탱크 테스트 메시지 변환: ${messageStr} -> ${displayMessage}`);
            setMainTankLevelMessage(displayMessage);
          } else {
            // 일반 메시지 처리 - 시간 정보 추가
            const displayMessage = `${messageStr} (${timeStr})`;
            setMainTankLevelMessage(displayMessage);
            
            // 메시지에 따라 표시만 변경하고 탱크 상태는 변경하지 않음
            // 중요: 여기서 tankData.mainTank를 수정하면 안됨
          }
          
          console.log(`본탱크 메시지 업데이트 완료: ${messageStr}`);
          
          // 상태 지속을 위해 로컬 스토리지에 저장
          localStorage.setItem('mainTankLevelMessage', messageStr);
        } else if (topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/)) {
          // 탱크 수위 토픽 처리
          const tankLevelMatch = topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/);
          if (tankLevelMatch) {
            const inverterId = Number.parseInt(tankLevelMatch[1]);
            const tankId = Number.parseInt(tankLevelMatch[2]);
            
            console.log(`탱크 수위 메시지 처리 - 인버터 ID: ${inverterId}, 탱크 ID: ${tankId}, 메시지: ${messageStr}`);
            
            // 펌프 상태 확인
            const isPumpRunning = tankData?.tanks && tankData?.tanks[inverterId - 1]?.pumpStatus === "ON";
            console.log(`펌프 상태: ${isPumpRunning ? "ON" : "OFF"}`);
            
            // 시간 문자열 생성
            const timeStr = formatTimeStr();
            
            // 메시지 처리 - 중요: 메시지만 업데이트하고 탱크 상태는 변경하지 않음
            let displayMessage = messageStr;
            
            if (messageStr === "테스트 메시지") {
              // 테스트 메시지 처리
              console.log(`테스트 메시지 감지: ${topic}`);
              displayMessage = `탱크${tankId} 테스트 (${timeStr})`;
            } else if (isPumpRunning && messageStr.includes("5% 이상 잔여")) {
              // 펌프 가동 중이고 "5% 이상 잔여" 메시지인 경우 "채워지는중"으로 변경
              displayMessage = `채워지는중 (${timeStr})`;
              console.log(`메시지 변경: "${messageStr}" -> "채워지는중 (${timeStr})"`);
            } else {
              // 일반 메시지에 시간 추가
              displayMessage = `${messageStr} (${timeStr})`;
            }
            
            // 메시지만 업데이트하고 탱크 상태(색상)는 변경하지 않음
            // 펌프 활성화 상태가 우선적으로 적용됨 (getTankColor 함수에 의해)
            console.log(`탱크 메시지 업데이트 - 탱크 ID: ${tankId}, 메시지: ${displayMessage}`);
            
            // 중요: 여기서 tankData.tanks[tankId-1]를 직접 수정하지 않고, 
            // 메시지만 업데이트하여 UI에 표시
            setTankMessages(prev => {
              const updated = {
                ...prev,
                [tankId]: displayMessage
              };
              console.log("업데이트된 탱크 메시지:", updated);
              return updated;
            });
            
            // 디버깅: 현재 상태 출력
            setTimeout(() => {
              console.log("현재 탱크 메시지 상태 업데이트 완료");
            }, 100);
          }
        } 
        // 다른 토픽 처리...
        else if (topic.match(/extwork\/inverter(\d+)\/state/)) {
          // 인버터 상태 토픽 처리 - 펌프 상태만 변경, 색상은 getTankColor 함수가 처리
          const inverterId = parseInt(topic.match(/extwork\/inverter(\d+)\/state/)![1]);
          console.log(`인버터 상태 메시지 수신 - 인버터 ID: ${inverterId}, 메시지: ${messageStr}`);
          
          // 메시지에 따라 펌프 상태 업데이트 (색상 변경은 getTankColor 함수가 담당)
          // 메시지가 "ON"을 포함하면 펌프 ON, 그렇지 않으면 OFF
          const isOn = messageStr.toUpperCase().includes("ON");
          
          // 여기에서는 상위 컴포넌트의 펌프 토글 함수를 호출해서는 안됨
          // 직접 상태를 변경하지 않고 메시지만 처리
        }
        // 카메라 상태 토픽 처리 추가
        else if (topic.match(/extwork\/cam(\d+)\/state/)) {
          const camNumber = parseInt(topic.match(/extwork\/cam(\d+)\/state/)![1]);
          console.log(`카메라 ${camNumber} 상태 메시지 수신: ${messageStr}`);
          
          // 이 컴포넌트에서는 카메라 상태 처리를 하지 않고,
          // 상위 컴포넌트(Dashboard)에서 처리하도록 합니다.
          // 여기서는 로그만 출력합니다.
        }
      } catch (error) {
        console.error('메시지 처리 오류:', error);
      }
    };
    
    // 메시지 이벤트 리스너 등록
    mqttClient.on('message', handleMessage);
    
    // 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      mqttClient.off('message', handleMessage);
      mqttClient.off('connect', subscribeTankTopics);
    };
  }, [mqttClient, tankData]);
  
  // 컴포넌트 마운트 시 저장된 상태 복원 - IndexedDB 추가
  useEffect(() => {
    // 로컬/세션 스토리지에서 먼저 불러오기
    const savedState = loadState();
    if (savedState && savedState.timestamp) {
      setLastStateUpdate(new Date(savedState.timestamp));
    }
    
    // IndexedDB에서도 확인 (더 최신일 수 있음)
    loadFromIndexedDB()
      .then(indexedDBState => {
        if (indexedDBState && 
            indexedDBState.timestamp > (savedState?.timestamp || 0)) {
          // IndexedDB의 상태가 더 최신이면 사용
          setLastStateUpdate(new Date(indexedDBState.timestamp));
          
          // localStorage와 sessionStorage 업데이트
          localStorage.setItem('tankSystemState', JSON.stringify(indexedDBState));
          sessionStorage.setItem('tankSystemState', JSON.stringify(indexedDBState));
        }
      })
      .catch(error => {
        console.error('IndexedDB 상태 로드 실패:', error);
      });
    
    // 온라인 상태 변화 감지
    const handleOnlineStatusChange = () => {
      if (window.navigator.onLine && mqttClient) {
        // 온라인으로 복귀 시 Redis에서 최신 상태 조회
        console.log('네트워크 연결이 복구되었습니다. 시스템 상태를 업데이트합니다.');
        
        // 상태 업데이트 알림
        mqttClient.publish('tank-system/notification', JSON.stringify({
          clientId: clientId.current,
          timestamp: Date.now(),
          message: '네트워크 연결이 복구되었습니다. 시스템 상태가 업데이트됩니다.'
        }));
      }
    };
    
    window.addEventListener('online', handleOnlineStatusChange);
    
    return () => {
      window.removeEventListener('online', handleOnlineStatusChange);
    };
  }, [mqttClient]);
  
  // 리셋 드래그 시작
  const handleResetDragStart = (pumpId: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setResetDragState(prev => ({
      ...prev,
      [pumpId]: { 
        dragging: true, 
        position: 0, 
        timer: null 
      }
    }));
    
    document.addEventListener('mousemove', (e) => handleResetDragMove(e, pumpId));
    document.addEventListener('touchmove', (e) => handleResetDragMove(e, pumpId));
    document.addEventListener('mouseup', () => handleResetDragEnd(pumpId));
    document.addEventListener('touchend', () => handleResetDragEnd(pumpId));
  };
  
  // 리셋 드래그 이동
  const handleResetDragMove = (e: MouseEvent | TouchEvent, pumpId: number) => {
    if (!resetDragState[pumpId]?.dragging) return;
    
    // 마우스 또는 터치 X 좌표
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    
    // 리셋 버튼 요소의 위치 구하기
    const resetButton = document.getElementById(`reset-btn-${pumpId}`);
    if (!resetButton) return;
    
    const rect = resetButton.getBoundingClientRect();
    const buttonWidth = rect.width;
    const maxDrag = 50; // 최대 드래그 거리
    
    // 드래그 위치 계산 (0~1 사이 값)
    const dragStartX = rect.left + buttonWidth / 2; // 버튼 중앙
    const dragDistance = Math.max(0, Math.min(maxDrag, clientX - dragStartX)); // 0 ~ maxDrag
    const position = dragDistance / maxDrag; // 0 ~ 1
    
    setResetDragState(prev => {
      const currentState = prev[pumpId] || { dragging: true, position: 0, timer: null };
      
      // 이미 타이머가 있고, 위치가 0.8(80%) 이상이면 타이머 유지
      if (currentState.timer && position >= 0.8) {
        return prev;
      }
      
      // 타이머가 있지만 위치가 0.8 미만이면 타이머 취소
      if (currentState.timer && position < 0.8) {
        clearTimeout(currentState.timer);
        return {
          ...prev,
          [pumpId]: { 
            ...currentState,
            position,
            timer: null
          }
        };
      }
      
      // 타이머가 없고 위치가 0.8 이상이면 타이머 시작
      if (!currentState.timer && position >= 0.8) {
        const timer = setTimeout(() => {
          console.log(`펌프 ${pumpId} 리셋 명령 실행 (2초 후)`);
          if (onPumpReset) {
            onPumpReset(pumpId);
            
            // "3" 명령 발행
            if (mqttClient) {
              const pumpTopic = `extwork/pump${pumpId}/cmd`;
              mqttClient.publish(pumpTopic, "3");
              
              // 알림 발행
              const notification = {
                type: 'pump-reset',
                pumpId: pumpId,
                timestamp: Date.now(),
                clientId: clientId.current,
                message: `펌프 ${pumpId} 리셋 명령(3)이 실행되었습니다.`
              };
              
              mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
            }
          }
          
          // 타이머 리셋 및 상태 초기화
          setResetDragState(prev => ({
            ...prev,
            [pumpId]: {
              dragging: false,
              position: 0,
              timer: null
            }
          }));
        }, 2000); // 2초 후 실행
        
        return {
          ...prev,
          [pumpId]: {
            ...currentState,
            position,
            timer
          }
        };
      }
      
      // 그 외의 경우 위치만 업데이트
      return {
        ...prev,
        [pumpId]: {
          ...currentState,
          position
        }
      };
    });
  };

  // 리셋 드래그 종료
  const handleResetDragEnd = (pumpId: number) => {
    const currentState = resetDragState[pumpId];
    if (!currentState?.dragging) return;
    
    // 이벤트 리스너 제거
    document.removeEventListener('mousemove', (e) => handleResetDragMove(e, pumpId));
    document.removeEventListener('touchmove', (e) => handleResetDragMove(e, pumpId));
    document.removeEventListener('mouseup', () => handleResetDragEnd(pumpId));
    document.removeEventListener('touchend', () => handleResetDragEnd(pumpId));
    
    // 타이머가 있고, 위치가 0.8 이상이면 타이머 유지 (계속 실행)
    if (currentState.timer && currentState.position >= 0.8) {
      return;
    }
    
    // 타이머가 있지만 위치가 0.8 미만이면 타이머 취소
    if (currentState.timer) {
      clearTimeout(currentState.timer);
    }
    
    // 상태 초기화
    setResetDragState(prev => ({
      ...prev,
      [pumpId]: {
        dragging: false,
        position: 0,
        timer: null
      }
    }));
  };
  
  // 밸브 상태 변경 핸들러 - MQTT 알림 추가
  const handleValveChange = (newState: string) => {
    // 상태 변경 요청
    onValveChange(newState);
    
    // MQTT를 통한 알림 발행
    if (mqttClient) {
      const notification = {
        type: 'valve-change',
        valveState: newState,
        timestamp: Date.now(),
        clientId: clientId.current,
        message: `밸브 상태가 변경되었습니다: ${newState}`
      };
      
      mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
    }
    
    // 상태 변경 시간 업데이트
    setLastStateUpdate(new Date());
    
    // 상태 저장
    saveState({
      ...tankData,
      valveState: newState
    });
  };
  
  // 펌프 버튼 마우스 다운 핸들러 - MQTT 알림 추가
  const handlePumpMouseDown = (pumpId: number) => {
    setCurrentPressedPump(pumpId);
    
    // 길게 누르기 감지 타이머 설정 (3초 후 리셋 명령 발생)
    const timer = setTimeout(() => {
      console.log(`펌프 ${pumpId} 길게 누름 감지 - 리셋 명령 실행`);
      if (onPumpReset) {
        onPumpReset(pumpId);
        
        // MQTT를 통한 알림 발행
        if (mqttClient) {
          const notification = {
            type: 'pump-reset',
            pumpId,
            timestamp: Date.now(),
            clientId: clientId.current,
            message: `펌프 ${pumpId} 리셋 명령이 실행되었습니다.`
          };
          
          mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
        }
      }
      setCurrentPressedPump(null);
    }, 3000);
    
    setLongPressTimer(timer);
  };
  
  // 펌프 버튼 마우스 업 핸들러 - MQTT 알림 추가
  const handlePumpMouseUp = (pumpId: number) => {
    // 타이머가 있으면 취소 (길게 누르기 취소)
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    // 현재 누른 펌프가 있고, 마우스 업 이벤트가 발생한 펌프와 같으면 클릭으로 간주
    if (currentPressedPump === pumpId) {
      console.log(`펌프 ${pumpId} 클릭 - 토글 명령 실행`);
      if (onPumpToggle) {
        onPumpToggle(pumpId);
        
        // MQTT를 통한 알림 발행
        if (mqttClient) {
          const notification = {
            type: 'pump-toggle',
            pumpId,
            timestamp: Date.now(),
            clientId: clientId.current,
            message: `펌프 ${pumpId} 상태가 토글되었습니다.`
          };
          
          mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
        }
      }
    }
    
    setCurrentPressedPump(null);
  };
  
  // 마우스가 펌프 밖으로 나갔을 때 핸들러
  const handlePumpMouseLeave = () => {
    // 타이머가 있으면 취소
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    setCurrentPressedPump(null);
  };
  
  // 터치 이벤트 핸들러 (모바일)
  const handlePumpTouchStart = (pumpId: number) => {
    handlePumpMouseDown(pumpId);
  };
  
  const handlePumpTouchEnd = (pumpId: number) => {
    handlePumpMouseUp(pumpId);
  };
  
  const handlePumpTouchCancel = () => {
    handlePumpMouseLeave();
  };

  // 추출 진행 상황에서 탱크 채움 비율 계산
  useEffect(() => {
    if (progressMessages.length > 0) {
      const latestProgress = progressMessages[progressMessages.length - 1];
      const latestMessage = latestProgress.message;
      
      // 시간 정보 추출 (84s | 140s 또는 427/215s 형식)
      const timeMatch = latestMessage.match(/(\d+)s?\s*[\|\/]\s*(\d+)s?/);
      
      if (timeMatch && timeMatch.length >= 3) {
        const current = parseInt(timeMatch[1], 10);
        const total = parseInt(timeMatch[2], 10);
        
        if (!isNaN(current) && !isNaN(total) && total > 0) {
          // 현재 값과 총 값의 비율 계산 (최대 100%)
          const percentage = Math.min((current / total) * 100, 100);
          setFillPercentage(percentage);
        }
      }
    }
  }, [progressMessages]);

  // 탱크 상태에 따른 색상 반환 - 펌프 상태 최우선 적용
  const getTankColor = (status: string | undefined, tankId: number) => {
    // status가 undefined인 경우 기본값 설정
    if (status === undefined) {
      console.log(`getTankColor - 탱크 ${tankId}, 상태: undefined, 기본값 'empty' 사용`);
      status = 'empty';
    }
    
    // 해당 탱크와 연결된 펌프의 상태 확인
    let pumpStatus = "OFF";
    if (tankId >= 1 && tankId <= 6 && tankData?.tanks && tankData?.tanks.length >= tankId) {
      const tank = tankData?.tanks[tankId - 1];
      pumpStatus = tank?.pumpStatus || "OFF";
    }
    
    console.log(`getTankColor - 탱크 ${tankId}, 상태: ${status}, 펌프: ${pumpStatus}`);
    
    // 1. 펌프가 켜져 있으면 노란색 테두리로 변경 - 이 로직이 최우선
    if (pumpStatus === "ON") {
      return "fill-white stroke-yellow-400 stroke-[3]";
    }
    
    // 2. 펌프가 꺼져 있으면 상태에 따라 색상 결정 (메시지가 와도 색상 변경하지 않음)
    switch (status) {
      case "full":
        return "fill-red-50 stroke-red-500 stroke-[3]";
      case "filling":
        return "fill-blue-50 stroke-blue-400 stroke-[3]"; 
      case "empty":
      default:
        return "fill-white stroke-gray-400 stroke-2";
    }
  };

  // 탱크 상태에 따른 상세 메시지 반환
  const getStatusMessage = (status: string, level: number) => {
    switch (status) {
      case "full":
        return "가득 차있음";
      case "empty":
        return level <= 5 ? "비었음" : `${level}% 잔여`;
      case "filling":
        return `채워지는 중 (${Math.round(fillPercentage)}%)`;
      default:
        return `${level}% 잔여`;
    }
  };

  // 채워지는 애니메이션을 위한 스타일 계산
  const getFillingStyle = (status: string, tankId: number) => {
    // 해당 탱크와 연결된 펌프의 상태 확인
    const pumpStatus = tankData?.tanks && tankData?.tanks[tankId - 1]?.pumpStatus || "OFF";
    
    // 펌프가 켜져 있는 경우에만 애니메이션 적용
    if (pumpStatus === "ON") {
      // 추출 진행 상황에서 남은 시간/경과 시간 정보 가져오기
      const progressInfo = progressMessages[0]?.message || "";
      let fillPercent = fillPercentage;
      
      // 추출 진행 상황에서 남은 시간 정보 추출
      if (progressInfo.includes("남은:") && progressInfo.includes("경과:")) {
        const remainingMatch = progressInfo.match(/남은:\s*(\d+)s/);
        const elapsedMatch = progressInfo.match(/경과:\s*(\d+)s/);
        
        if (remainingMatch && elapsedMatch) {
          const remaining = parseInt(remainingMatch[1]);
          const elapsed = parseInt(elapsedMatch[1]);
          const total = remaining + elapsed;
          
          // 남은 시간이 0이면 100%, 아니면 경과 시간 비율로 계산
          fillPercent = total > 0 ? (elapsed / total) * 100 : 100;
        }
      }
      
      return {
        clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
        transition: 'clip-path 1.5s ease-in-out',
        animation: 'pulse 2s infinite',
        backgroundColor: 'rgba(124, 58, 237, 0.3)' // 흐린 보라색
      };
    }
    
    // 펌프가 꺼져 있으면 애니메이션 없음
    return {};
  };

  // 밸브 상태 파싱 (4자리 문자열에서 첫 두 자리만 사용) - 개선
  const parseValveState = () => {
    // 디버깅용 로그 추가
    console.log('[디버깅] parseValveState 호출됨');
    console.log('[디버깅] 현재 tankData:', tankData);
    console.log('[디버깅] 현재 밸브 상태:', tankData.valveState);
    console.log('[디버깅] 밸브 상태 메시지:', tankData.valveStatusMessage);
    
    // tankData의 유효성 검사
    if (!tankData || !tankData.valveState) {
      console.log('[디버깅] tankData 또는 valveState가 유효하지 않음, 저장된 상태 확인');
      // 저장된 상태 확인
      const savedState = loadState();
      if (savedState && savedState.valveState) {
        console.log('저장된 밸브 상태 발견:', savedState.valveState);
        return {
          valve1: parseInt(savedState.valveState[0]) || 0,
          valve2: parseInt(savedState.valveState[1]) || 0,
          valve1Desc: savedState.valveADesc || (parseInt(savedState.valveState[0]) === 1 ? '추출순환' : '전체순환'),
          valve2Desc: savedState.valveBDesc || (parseInt(savedState.valveState[1]) === 1 ? 'ON' : 'OFF')
        };
      }
      
      // 기본값 반환
      return { valve1: 0, valve2: 0, valve1Desc: '전체순환', valve2Desc: 'OFF' };
    }
    
    // 특수 케이스: 0100 (밸브2 OFF, 밸브1 ON)
    if (tankData.valveState === '0100') {
      console.log('특수 케이스 감지: 0100 - 밸브2 OFF, 밸브1 ON');
      // localStorage에 밸브 상태 저장 (래퍼 함수 사용)
      saveState(tankData);
      return {
        valve1: 0, // 밸브2 OFF (3way)
        valve2: 1, // 밸브1 ON (2way)
        valve1Desc: tankData.valveADesc || '본탱크 수집',
        valve2Desc: tankData.valveBDesc || 'ON'
      };
    }
    
    // valveStatusMessage를 우선적으로 확인하여 상태 파싱
    if (tankData.valveStatusMessage) {
      console.log('[디버깅] valveStatusMessage로 상태 파싱:');
      // 'valveA=ON' 또는 'valveA=OFF' 포함 여부 정확히 체크
      const valveAState = tankData.valveStatusMessage.includes('valveA=ON') ? 1 : 0;
      const valveBState = tankData.valveStatusMessage.includes('valveB=ON') ? 1 : 0;
      
      // 밸브 설명 텍스트 - dashboard.tsx에서 파싱된 값 사용
      let valveADesc = tankData.valveADesc || '';
      let valveBDesc = tankData.valveBDesc || '';
      
      // 설명이 없으면 상태에 따라 기본값 설정
      if (!valveADesc) {
        valveADesc = valveAState === 1 ? '추출순환' : '전체순환';
      }
      if (!valveBDesc) {
        valveBDesc = valveBState === 1 ? 'ON' : 'OFF';
      }
      
      // 디버깅을 위한 로그
      console.log(`밸브 상태 파싱 결과: valveA=${valveAState} (${valveADesc}), valveB=${valveBState} (${valveBDesc})`);
      
      // 밸브 상태를 로컬 스토리지에 저장 (래퍼 함수 사용)
      saveState({
        ...tankData,
        valveADesc,
        valveBDesc
      });
      
      return {
        valve1: valveAState,
        valve2: valveBState,
        valve1Desc: valveADesc,
        valve2Desc: valveBDesc
      };
    }
    
    // valveState의 길이 확인
    if (typeof tankData.valveState !== 'string' || tankData.valveState.length < 2) {
      console.warn('valveState 형식 오류:', tankData.valveState);
      
      // localStorage에 저장된 상태 확인
      const savedState = loadState();
      if (savedState && savedState.valveState && typeof savedState.valveState === 'string' && savedState.valveState.length >= 2) {
        console.log('localStorage에서 밸브 상태 복원:', savedState.valveState);
        const v1 = parseInt(savedState.valveState[0]) || 0;
        const v2 = parseInt(savedState.valveState[1]) || 0;
        return {
          valve1: v1,
          valve2: v2,
          valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
          valve2Desc: v2 === 1 ? 'ON' : 'OFF'
        };
      }
      
      // 기본값 반환
      return { valve1: 0, valve2: 0, valve1Desc: '전체순환', valve2Desc: 'OFF' };
    }
    
    // 기존 로직 유지 (fallback)
    if (tankData.valveState.length !== 4) {
      // localStorage에 저장된 상태가 있으면 사용 (래퍼 함수 사용)
      const savedState = loadState();
      if (savedState && savedState.valveState && savedState.valveState.length === 4) {
        console.log('localStorage에서 밸브 상태 복원:', savedState.valveState);
        const v1 = parseInt(savedState.valveState[0]);
        const v2 = parseInt(savedState.valveState[1]);
        return {
          valve1: v1,
          valve2: v2,
          valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
          valve2Desc: v2 === 1 ? 'ON' : 'OFF'
        };
      }
      
      // localStorage에 저장된 밸브 상태 메시지가 있으면 사용 (래퍼 함수 사용)
      const savedValveStatusMessage = loadState()?.valveStatusMessage;
      if (savedValveStatusMessage) {
        console.log('localStorage에서 밸브 상태 메시지 복원:', savedValveStatusMessage);
        const valveAState = savedValveStatusMessage.includes('valveA=ON') ? 1 : 0;
        const valveBState = savedValveStatusMessage.includes('valveB=ON') ? 1 : 0;
        return {
          valve1: valveAState,
          valve2: valveBState,
          valve1Desc: valveAState === 1 ? '추출순환' : '전체순환',
          valve2Desc: valveBState === 1 ? 'ON' : 'OFF'
        };
      }
      
      // 최소 안전 길이 보장
      const safeValveState = (tankData.valveState + '0000').slice(0, 4);
      console.log('안전하게 보정된 밸브 상태:', safeValveState);
      
      const v1 = parseInt(safeValveState[0]) || 0;
      const v2 = parseInt(safeValveState[1]) || 0;
      
      return {
        valve1: v1, 
        valve2: v2,
        valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
        valve2Desc: v2 === 1 ? 'ON' : 'OFF'
      };
    }

    const v1 = parseInt(tankData.valveState[0]);
    const v2 = parseInt(tankData.valveState[1]);

    // 현재 상태를 localStorage에 저장 (래퍼 함수 사용)
    saveState(tankData);

    const result = {
      valve1: v1,
      valve2: v2,
      valve1Desc: v1 === 1 ? '추출순환' : '전체순환',
      valve2Desc: v2 === 1 ? 'ON' : 'OFF'
    };
    
    console.log('[디버깅] parseValveState 결과:', result);
    return result;
  };

  const { valve1, valve2, valve1Desc, valve2Desc } = parseValveState();

  // 경로 활성화 여부 확인
  const isPathActive = (path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1") => {
    console.log(`[디버깅] isPathActive 호출: ${path}, valve1=${valve1}, valve2=${valve2}`);
    if (path === "tank6ToMain") return valve1 === 0;
    if (path === "tank6ToTank1") return valve1 === 1;
    if (path === "mainToTank1") return valve2 === 1;
    return false;
  };

  // 밸브 상태에 따라 라인 표시 여부 결정하는 함수 추가
  const shouldShowLine = (path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1") => {
    console.log(`[디버깅] shouldShowLine 호출: ${path}, valve1=${valve1}, valve2=${valve2}`);
    if (path === "tank6ToMain") {
      const result = valve1 === 0;
      console.log(`[디버깅] tank6ToMain 라인 표시 여부: ${result}`);
      return result;
    }
    if (path === "tank6ToTank1") {
      const result = valve1 === 1;
      console.log(`[디버깅] tank6ToTank1 라인 표시 여부: ${result}`);
      return result;
    }
    if (path === "mainToTank1") {
      const result = valve2 === 1;
      console.log(`[디버깅] mainToTank1 라인 표시 여부: ${result}`);
      return result;
    }
    return false;
  };

  // 밸브 상태에 따른 파이프 색상 가져오기
  const getValvePipeColor = (path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1") => {
    const isActive = isPathActive(path);
    console.log(`[디버깅] getValvePipeColor: ${path}, 활성화=${isActive}`);
    return isActive ? "stroke-blue-500" : "stroke-gray-300";
  };

  // 펌프 상태에 따른 파이프 색상 가져오기
  const getPipeColor = (fromTank: number, toTank: number) => {
    // 1-based 인덱스를 0-based로 변환
    const fromIndex = fromTank - 1;
    const toIndex = toTank - 1;

    // 해당 구간에 연결된 펌프의 상태 확인
    // 예: 2-3 구간은 3번 펌프에 연결 (인덱스 2)
    const pumpIndex = toIndex >= 0 && toIndex < tankData?.tanks?.length ? toIndex : fromIndex;
    const pumpStatus = tankData?.tanks?.[pumpIndex]?.pumpStatus || "OFF";

    return pumpStatus === "ON" ? "stroke-blue-500" : "stroke-gray-300";
  };

  // 밸브 상태에 따른 텍스트 반환
  const getValveStateText = () => {
    const { valve1, valve2 } = parseValveState();
    
    if (valve1 === 1) {
      return "추출 순환";
    } else if (valve2 === 1) {
      return "전체 순환 (열림)";
    } else {
      return "밸브 닫힘";
    }
  };

  // 다음 밸브 상태 가져오기 (순환)
  const getNextValveState = () => {
    console.log('현재 밸브 상태:', tankData.valveState);
    let nextState = '';
    
    // 0100 상태에서 클릭하면 1000 상태로 변경
    if (tankData.valveState === "0100") nextState = "1000";
    // 1000 상태에서 클릭하면 0000 상태로 변경
    else if (tankData.valveState === "1000") nextState = "0000";
    // 0000 상태에서 클릭하면 0100 상태로 변경
    else if (tankData.valveState === "0000") nextState = "0100";
    else nextState = "0100"; // 기본값
    
    // 변경된 상태를 localStorage에 저장 (래퍼 함수 사용)
    saveState({
      ...tankData,
      valveState: nextState
    });
    console.log('다음 밸브 상태 localStorage에 저장:', nextState);
    
    return nextState;
  };

  // 원형 레이아웃을 위한 계산
  const centerX = 500;
  const centerY = 350; // 본탱크 위치를 위로 조정
  const mainTankRadius = 70;
  const circleRadius = 250;
  const tankWidth = 100;
  const tankHeight = 100;
  const pumpRadius = 30;
  const pumpDistance = 60;

  // 원형으로 배치된 탱크 위치 계산
  const calculatePosition = (index: number, total: number) => {
    // 시작 각도를 조정하여 1번 탱크가 상단에 오도록 함
    const startAngle = -Math.PI / 2;
    const angle = startAngle + (index * 2 * Math.PI) / total;
    return {
      x: centerX + circleRadius * Math.cos(angle),
      y: centerY + circleRadius * Math.sin(angle),
      angle: angle,
    };
  };

  // 탱크 위치 계산
  const tankPositions = Array(6)
    .fill(0)
    .map((_, i) => {
      const pos = calculatePosition(i, 6);
      return {
        ...pos,
        label: `${i + 1}번 탱크`,
      };
    });

  // 본탱크 위치 - 사각형으로 변경하고 크기 확대, 너비 확대/높이 감소
  const mainTankPosition = { x: centerX, y: centerY, label: "본탱크", width: 220, height: 150 };

  // 밸브 위치 계산 수정
  // 2way 밸브(밸브1) 위치 계산 수정 - 본탱크에서 더 멀어지게, 1번 탱크 텍스트박스가 보이도록 아래로
  const valve2Position = {
    x: centerX,
    y: centerY - 100, // 본탱크 위쪽에 배치하되 더 아래로 조정 (기존 -150에서 -100으로)
  };

  // 3way 밸브(밸브2) 위치 계산 - 6번 탱크 바로 우측에 배치하고 약간 아래로 내림
  const valve3wayPosition = {
    x: tankPositions[5].x + tankWidth / 2 + 50, // 6번 탱크 바로 우측으로 이동
    y: tankPositions[5].y + 20, // 6번 탱크와 동일한 높이에서 약간 아래로 조정
  };

  // 펌프 위치 계산 함수 수정 - 현재 탱크와 다음 탱크 사이에 위치하도록
  const calculatePumpPosition = (currentTankIndex: number, nextTankIndex: number) => {
    const currentTank = tankPositions[currentTankIndex];
    const nextTank = tankPositions[nextTankIndex];

    // 두 탱크 간의 중간 지점에 펌프 배치
    return {
      x: (currentTank.x + nextTank.x) / 2,
      y: (currentTank.y + nextTank.y) / 2,
      angle: currentTank.angle
    };
  };

  // 탱크 간 파이프 경로 계산
  const calculatePipePath = (fromIndex: number, toIndex: number) => {
    const from = tankPositions[fromIndex];
    const to = tankPositions[toIndex];

    // 직선 경로
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  };

  // 6번 탱크에서 3way 밸브(밸브2)로의 경로 - 우측으로 짧게 연결
  const calculate6ToValvePath = () => {
    // 6번 탱크에서 우측으로 짧게 나온 후 3way 밸브로 연결
    const startX = tankPositions[5].x + tankWidth / 2;
    const startY = tankPositions[5].y;
    
    // 6번 탱크와 밸브2가 같은 높이에 있으므로 직선으로 연결
    return `M ${startX} ${startY} H ${valve3wayPosition.x - 30}`;
  };

  // 3way 밸브(밸브2)에서 본탱크로의 경로 - 전체순환일 때만 표시
  const calculate3wayToMainPath = () => {
    // 밸브2에서 본탱크 왼쪽 가장자리까지 직선 연결
    const tankLeft = mainTankPosition.x - mainTankPosition.width / 2;
    const tankMid = mainTankPosition.y;
    
    // 경로 조정: 밸브2에서 나와서 중간 지점에서 꺾여 본탱크로
    return `M ${valve3wayPosition.x} ${valve3wayPosition.y} 
            H ${(valve3wayPosition.x + tankLeft) / 2}
            L ${tankLeft + 20} ${tankMid}`;
  };

  // 본탱크에서 2way 밸브(밸브1)로의 경로 - 항상 표시
  const calculateMainToTank1Path = () => {
    // 본탱크 위쪽 가장자리에서 시작하여 2way 밸브까지 수직 연결 - 짧게 하되 보이도록
    const tankEdgeY = mainTankPosition.y - mainTankPosition.height / 2;
    // 본탱크 상단에서 밸브1까지의 거리의 30%만 연결하여 눈에 보이게 함
    const lineLength = Math.abs(valve2Position.y - tankEdgeY) * 0.3;
    return `M ${mainTankPosition.x} ${tankEdgeY} V ${tankEdgeY - lineLength}`;
  };

  // 2way 밸브(밸브1)에서 펌프1 입구 쪽으로의 경로 - 항상 표시
  const calculate2wayToPump1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    
    // 밸브1에서 출발하여 펌프1 방향으로 가는 경로 - 밸브1 위치가 변경되었으므로 경로도 조정
    return `M ${valve2Position.x} ${valve2Position.y} 
            V ${(valve2Position.y + pump1Pos.y) / 2}
            L ${pump1Pos.x} ${pump1Pos.y}`;
  };

  // 3way 밸브(밸브2)에서 펌프 1로의 경로 - 추출순환일 때만 표시
  const calculate3wayToPump1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    
    // 시작점과 끝점 사이 벡터 계산
    const dx = pump1Pos.x - valve3wayPosition.x;
    const dy = pump1Pos.y - valve3wayPosition.y;
    
    // 벡터 길이
    const length = Math.sqrt(dx*dx + dy*dy);
    
    // 밸브2에서 펌프1 방향으로 85% 정도 이동한 지점으로 연결 (기존 50%에서 증가)
    const endX = valve3wayPosition.x + dx * 0.85;
    const endY = valve3wayPosition.y + dy * 0.85;
    
    return `M ${valve3wayPosition.x} ${valve3wayPosition.y} L ${endX} ${endY}`;
  };

  // 합류 지점에서 펌프1로의 경로
  const calculateMergeToPump1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    return `M ${pump1Pos.x} ${pump1Pos.y} L ${pump1Pos.x} ${pump1Pos.y}`; // 변경 없는 경로
  };

  // 1번 펌프에서 1번 탱크로의 경로 (직선 연결)
  const calculatePump1To1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    return `M ${pump1Pos.x} ${pump1Pos.y} L ${tankPositions[0].x} ${tankPositions[0].y}`;
  };

  // 1번 탱크에서 2번 펌프로의 경로
  const calculate1ToPump2Path = () => {
    const pump2Pos = calculatePumpPosition(0, 1);
    return `M ${tankPositions[0].x} ${tankPositions[0].y} L ${pump2Pos.x} ${pump2Pos.y}`;
  };

  // 2번 펌프에서 2번 탱크로의 경로
  const calculatePump2To2Path = () => {
    const pump2Pos = calculatePumpPosition(0, 1);
    return `M ${pump2Pos.x} ${pump2Pos.y} L ${tankPositions[1].x} ${tankPositions[1].y}`;
  };

  // 밸브 상태 메시지에서 필요한 부분만 추출
  const extractValveStatus = (message: string) => {
    if (!message) return "";
    
    // valveA와 valveB 부분만 추출하는 정규식
    const valveAMatch = message.match(/valveA=[^,]+/);
    const valveBMatch = message.match(/valveB=[^,]+/);
    
    const valveA = valveAMatch ? valveAMatch[0] : "";
    const valveB = valveBMatch ? valveBMatch[0] : "";
    
    if (valveA && valveB) {
      return `${valveA}, ${valveB}`;
    } else if (valveA) {
      return valveA;
    } else if (valveB) {
      return valveB;
    }
    
    return "";
  };

  // 화살표 위치 계산
  const calculateArrowPosition = (path: string, progress = 0.5) => {
    // SVG 경로 객체 생성
    const dummySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathElement.setAttribute("d", path);
    dummySvg.appendChild(pathElement);
    
    // 경로의 길이 구하기
    const pathLength = pathElement.getTotalLength();
    
    // 특정 위치의 점 구하기 (기본값: 경로의 중간점)
    const point = pathElement.getPointAtLength(pathLength * progress);
    
    return { x: point.x, y: point.y };
  };

  // 파이프가 활성화 상태인지 확인
  const isPipeActive = (pumpIndex: number, valveCondition: boolean = true) => {
    return tankData?.tanks && 
           tankData?.tanks[pumpIndex] && 
           tankData?.tanks[pumpIndex].pumpStatus === "ON" && 
           valveCondition;
  };

  // 추출 제어 명령 발행 함수
  const handleExtractionCommand = (command: string) => {
    if (mqttClient) {
      mqttClient.publish("extwork/extraction/input", command);
      
      // MQTT 알림 발행
      const notification = {
        type: 'extraction-command',
        command,
        timestamp: Date.now(),
        clientId: clientId.current,
        message: `추출 명령이 발행되었습니다: ${command}`
      };
      
      mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
      
      // 클릭 효과
      const commandElement = document.getElementById(`extraction-command-${command}`);
      if (commandElement) {
        commandElement.classList.add('bg-blue-200');
        setTimeout(() => {
          commandElement?.classList.remove('bg-blue-200');
        }, 300);
      }
    }
  };
  
  // 스위치 드래그 시작
  const handlePumpSwitchStart = (pumpId: number, e: React.MouseEvent | React.TouchEvent) => {
    setDraggingPump(pumpId);
    document.addEventListener('mousemove', handlePumpSwitchMove);
    document.addEventListener('touchmove', handlePumpSwitchMove);
    document.addEventListener('mouseup', handlePumpSwitchEnd);
    document.addEventListener('touchend', handlePumpSwitchEnd);
  };
  
  // 스위치 드래그 이동
  const handlePumpSwitchMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingPump) return;
    
    // 마우스 또는 터치 Y 좌표
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // 펌프 요소의 위치 구하기
    const pumpElement = document.getElementById(`pump-${draggingPump}`);
    if (!pumpElement) return;
    
    const rect = pumpElement.getBoundingClientRect();
    const switchHeight = 40; // 스위치 높이
    
    // 스위치 위치 계산 (0: 기본, -1: 위로 이동)
    let position = 0;
    if (clientY < rect.top - switchHeight/2) {
      position = -1; // 위로 이동
      
      // 리셋 타이머 설정 (3초 후 리셋 명령)
      if (!resetTimers[draggingPump]) {
        console.log(`펌프 ${draggingPump} 스위치 위로 이동 - 리셋 타이머 시작`);
        const timer = setTimeout(() => {
          console.log(`펌프 ${draggingPump} 리셋 명령 실행`);
          if (onPumpReset) {
            onPumpReset(draggingPump);
            
            // "3" 명령 발행 - 리셋에는 3 코드 사용
            if (mqttClient) {
              const pumpTopic = `extwork/pump${draggingPump}/cmd`;
              mqttClient.publish(pumpTopic, "3");
              
              // 알림 발행
              const notification = {
                type: 'pump-reset',
                pumpId: draggingPump,
                timestamp: Date.now(),
                clientId: clientId.current,
                message: `펌프 ${draggingPump} 리셋 명령(3)이 실행되었습니다.`
              };
              
              mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
            }
          }
          
          // 타이머 리셋 및 상태 초기화
          setResetDragState(prev => ({
            ...prev,
            [draggingPump]: {
              dragging: false,
              position: 0,
              timer: null
            }
          }));
        }, 2000); // 2초 후 실행
        
        setResetTimers(prev => ({...prev, [draggingPump]: timer}));
      }
    } else {
      // 타이머 취소
      if (resetTimers[draggingPump]) {
        clearTimeout(resetTimers[draggingPump]!);
        setResetTimers(prev => ({...prev, [draggingPump]: null}));
      }
    }
    
    setPumpSwitchPosition(prev => ({...prev, [draggingPump]: position}));
  };
  
  // 스위치 드래그 종료
  const handlePumpSwitchEnd = (e: MouseEvent | TouchEvent) => {
    if (!draggingPump) return;
    
    // 이벤트 리스너 제거
    document.removeEventListener('mousemove', handlePumpSwitchMove);
    document.removeEventListener('touchmove', handlePumpSwitchMove);
    document.removeEventListener('mouseup', handlePumpSwitchEnd);
    document.removeEventListener('touchend', handlePumpSwitchEnd);
    
    // 타이머 취소
    if (resetTimers[draggingPump]) {
      clearTimeout(resetTimers[draggingPump]!);
      setResetTimers(prev => ({...prev, [draggingPump]: null}));
    }
    
    // 모든 펌프에 대해 동일하게 처리
    if (onPumpToggle) {
      // 현재 위치가 0이면 토글
      if (pumpSwitchPosition[draggingPump] === 0) {
        onPumpToggle(draggingPump);
      }
    }
    
    // 위치 초기화
    setPumpSwitchPosition(prev => ({...prev, [draggingPump]: 0}));
    setDraggingPump(null);
  };

  // 최초 로드 및 저장된 상태 복원
  useEffect(() => {
    // 중요: 비동기 함수를 별도로 선언하여 실행
    const loadSavedState = async () => {
      try {
        if (mqttClient) {
          // 서버 및 로컬 스토리지에서 상태 로드 시도
          const savedState = await loadInitialState();
          
          if (savedState) {
            console.log('저장된 상태를 복원합니다.');
            
            try {
              // 저장된 상태로 업데이트 로직 (예: onValveChange 호출 등)
              if (savedState.valveState && onValveChange) {
                onValveChange(savedState.valveState);
              }
              
              // 필요한 경우 상태 업데이트를 MQTT로 브로드캐스트
              if (mqttClient.connected) {
                mqttClient.publish('tank-system/state-loaded', JSON.stringify({
                  clientId: clientId.current,
                  timestamp: Date.now(),
                  source: 'localStorage'
                }));
              }
            } catch (updateError) {
              console.error('상태 복원 중 오류 발생:', updateError);
              // 오류가 발생해도 컴포넌트 초기화를 계속 진행합니다.
            }
          }
        }
      } catch (error) {
        console.error('상태 로드 중 예상치 못한 오류:', error);
        // 오류가 발생해도 앱이 계속 실행되도록 합니다.
      }
    };
    
    // 안전하게 초기화 함수 호출
    loadSavedState().catch(error => {
      console.error('상태 로드 프로세스 전체 실패:', error);
    });
  }, [mqttClient, onValveChange]);

  const [mainTankLevelMessage, setMainTankLevelMessage] = useState<string>("");
  const [tankMessages, setTankMessages] = useState<Record<number, string>>({});
  const [mainTankMessage, setMainTankMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [processRunning, setProcessRunning] = useState<boolean>(false);

  // 컴포넌트 마운트 시 로컬 스토리지에서 프로세스 실행 상태 확인
  useEffect(() => {
    const savedProcessState = localStorage.getItem('process-running-state');
    if (savedProcessState) {
      try {
        const state = JSON.parse(savedProcessState);
        setProcessRunning(state.running);
      } catch (error) {
        console.error('저장된 프로세스 상태 파싱 오류:', error);
      }
    }
  }, []);

  // 컴포넌트 마운트 시 탱크 메시지 초기화
  useEffect(() => {
    console.log('TankSystem 컴포넌트 마운트 - tankData:', tankData);
    
    // tankData에서 탱크 메시지 업데이트
    if (tankData.tankMessages) {
      setTankMessages(tankData.tankMessages);
    }
    
    // 메인 탱크 메시지 업데이트
    if (tankData?.mainTankMessage) {
      console.log('메인 탱크 메시지 업데이트 감지:', tankData?.mainTankMessage);
      setMainTankMessage(tankData?.mainTankMessage);
    }
  }, [tankData]);

  // 에러 메시지 구독 처리
  useEffect(() => {
    if (!mqttClient) return;

    const handleErrorMessage = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/error') {
        const messageStr = message.toString();
        console.log('에러 메시지 수신:', messageStr);
        
        // 시간 추가
        const timeStr = formatTimeStr();
        setErrorMessage(`${messageStr} (${timeStr})`);
        
        // 5초 후 메시지 제거
        setTimeout(() => {
          setErrorMessage('');
        }, 10000);
      }
    };

    mqttClient.subscribe('extwork/extraction/error');
    mqttClient.on('message', handleErrorMessage);

    return () => {
      mqttClient.unsubscribe('extwork/extraction/error');
      mqttClient.off('message', handleErrorMessage);
    };
  }, [mqttClient]);

  // 프로세스 완료 감지 및 버튼 상태 업데이트
  useEffect(() => {
    if (!mqttClient) return;

    const handleProcessCompletion = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        
        // 완료 메시지 확인
        if (messageStr.includes("공정 종료") || 
            messageStr.includes("사이클 완료") || 
            messageStr.includes("JSON 명령이 성공적으로 처리")) {
          // 프로세스 종료 상태로 변경
          setProcessRunning(false);
          localStorage.setItem('process-running-state', JSON.stringify({ running: false }));
          console.log('프로세스 완료 감지, 상태 초기화');
        }
      } else if (topic === 'extwork/automation/control') {
        const messageStr = message.toString();
        
        try {
          const command = JSON.parse(messageStr);
          if (command.command === 'start' || command.command === 'play') {
            // 프로세스 시작 상태로 변경
            setProcessRunning(true);
            localStorage.setItem('process-running-state', JSON.stringify({ running: true }));
            console.log('프로세스 시작 감지, 상태 활성화');
          } else if (command.command === 'stop' || command.command === 'reset') {
            // 프로세스 종료 상태로 변경
            setProcessRunning(false);
            localStorage.setItem('process-running-state', JSON.stringify({ running: false }));
            console.log('프로세스 중지 감지, 상태 초기화');
          }
        } catch (e) {
          console.error('자동화 명령 파싱 오류:', e);
        }
      }
    };

    mqttClient.subscribe('extwork/extraction/output');
    mqttClient.subscribe('extwork/automation/control');
    mqttClient.on('message', handleProcessCompletion);

    return () => {
      mqttClient.unsubscribe('extwork/extraction/output');
      mqttClient.unsubscribe('extwork/automation/control');
      mqttClient.off('message', handleProcessCompletion);
    };
  }, [mqttClient]);

  // 특수 extraction 토픽 메시지 처리 추가
  useEffect(() => {
    if (!mqttClient) return;

    const handleExtractionMessage = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        console.log('추출 메시지 수신:', messageStr);
        
        // 특정 완료 메시지 확인
        if (messageStr.includes("공정 종료") || 
            messageStr.includes("사이클 완료") || 
            messageStr.includes("JSON 명령이 성공적으로 처리되었습니다")) {
          // 시간 추가
          const timeStr = formatTimeStr();
          setExtractionCompleteMessage(`${messageStr} (${timeStr})`);
        }
      }
    };

    mqttClient.subscribe('extwork/extraction/output');
    mqttClient.on('message', handleExtractionMessage);

    return () => {
      mqttClient.unsubscribe('extwork/extraction/output');
      mqttClient.off('message', handleExtractionMessage);
    };
  }, [mqttClient]);

  // 시간 포맷 함수 추가
  const formatTimeStr = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ampm = hours >= 12 ? '오후' : '오전';
    const hour12 = hours % 12 || 12; // 12시간제 변환
    return `${ampm} ${hour12}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // MQTT 메시지 파싱 및 처리를 위한 추가 상태
  const [extractionCompleteMessage, setExtractionCompleteMessage] = useState<string>("");
  const [automationStatus, setAutomationStatus] = useState<string>("");
  const [automationWaitTime, setAutomationWaitTime] = useState<{value: number, endTime: number} | null>(null);

  // 자동화 공정 상태 및 대기시간 모니터링 MQTT 메시지 처리 추가
  useEffect(() => {
    if (!mqttClient) return;

    const handleAutomationMessage = (topic: string, message: Buffer) => {
      // 자동화 공정 관련 메시지 처리
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        console.log('자동화 메시지 수신:', messageStr);
        
        // JSON 명령 성공 메시지 처리
        if (messageStr.includes("JSON 명령이 성공적으로 처리되었습니다")) {
          const timeStr = formatTimeStr();
          setAutomationStatus(`공정 진행중 (${timeStr})`);
        }
        // 공정 종료 메시지 처리
        else if (messageStr.includes("공정 종료") || 
                messageStr.includes("공정종료") || 
                messageStr.includes("완료") || 
                messageStr.includes("process completed") || 
                messageStr.includes("extraction complete")) {
          const timeStr = formatTimeStr();
          setExtractionCompleteMessage(`공정 종료 (${timeStr})`);
          setAutomationStatus(`공정 종료됨 (${timeStr})`);
        }
      }
      
      // 자동화 공정 대기시간 메시지 처리
      if (topic === 'extwork/automation/status') {
        try {
          const data = JSON.parse(message.toString());
          if (data.waiting && data.waitTime) {
            const waitTime = parseInt(data.waitTime);
            const endTime = Date.now() + (waitTime * 1000);
            setAutomationWaitTime({value: waitTime, endTime: endTime});
            
            // 대기시간 카운트다운
            const countdownInterval = setInterval(() => {
              const now = Date.now();
              const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
              
              if (remaining <= 0) {
                clearInterval(countdownInterval);
                setAutomationWaitTime(null);
              } else {
                setAutomationWaitTime({value: remaining, endTime: endTime});
              }
            }, 1000);
            
            return () => clearInterval(countdownInterval);
          }
        } catch (e) {
          console.error('자동화 상태 메시지 파싱 오류:', e);
        }
      }
    };

    mqttClient.subscribe('extwork/extraction/output');
    mqttClient.subscribe('extwork/automation/status');
    mqttClient.on('message', handleAutomationMessage);

    return () => {
      mqttClient.unsubscribe('extwork/automation/status');
      mqttClient.off('message', handleAutomationMessage);
    };
  }, [mqttClient]);

  // 펌프 연결 상태 관리 추가
  const [pumpConnectionStates, setPumpConnectionStates] = useState<{[key: number]: {ble: boolean, mqtt: boolean}}>({
    1: { ble: false, mqtt: false },
    2: { ble: false, mqtt: false },
    3: { ble: false, mqtt: false },
    4: { ble: false, mqtt: false },
    5: { ble: false, mqtt: false },
    6: { ble: false, mqtt: false }
  });
  
  // 펌프 연결 상태 구독 설정
  useEffect(() => {
    if (!mqttClient) return;
    
    // 각 펌프의 overallstate 토픽 구독
    for (let i = 1; i <= 6; i++) {
      mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
    }
    
    // 메시지 핸들러 추가
    const handleConnectionStateMessage = (topic: string, message: Buffer) => {
      try {
        const pumpMatch = topic.match(/extwork\/inverter(\d+)\/overallstate/);
        if (!pumpMatch) return;
        
        const pumpId = parseInt(pumpMatch[1]);
        const messageStr = message.toString();
        
        // 연결 상태 감지
        if (messageStr.includes("MQTT 및 BLE 모두 연결됨")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ble: true, mqtt: true }
          }));
        } else if (messageStr.includes("MQTT만 연결됨") || messageStr.includes("MQTT 환경으로 전환됨") || messageStr.includes("MQTT 환경에서 동작 중")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], mqtt: true, ble: false }
          }));
        } else if (messageStr.includes("BLE만 연결됨") || messageStr.includes("BLE 환경으로 전환됨")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], mqtt: false, ble: true }
          }));
        } else if (messageStr.includes("MQTT 및 BLE 모두 연결 끊김")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { mqtt: false, ble: false }
          }));
        } else if (messageStr.includes("BLE 클라이언트 연결됨")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], ble: true }
          }));
        } else if (messageStr.includes("BLE 클라이언트 연결 끊김")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], ble: false }
          }));
        }
      } catch (error) {
        console.error("Error handling connection state message:", error);
      }
    };
    
    mqttClient.on('message', handleConnectionStateMessage);
    
    return () => {
      // 구독 해제
      for (let i = 1; i <= 6; i++) {
        mqttClient.unsubscribe(`extwork/inverter${i}/overallstate`);
      }
      mqttClient.off('message', handleConnectionStateMessage);
    };
  }, [mqttClient]);
  
  // 연결 상태 아이콘 렌더링 함수
  const renderConnectionIcons = (pumpId: number, x: number, y: number) => {
    const connections = pumpConnectionStates[pumpId] || { ble: false, mqtt: false };
    
    // 원의 가장자리에 10시와 2시 방향으로 위치 계산
    const radius = pumpRadius - 2; // 원 내부에 살짝 들어오게
    
    // WiFi 10시 방향, 블루투스 2시 방향
    // Math.PI * 5/6은 150도, Math.PI * 1/6은 30도
    const wifiX = x + radius * Math.cos(Math.PI * 7/6); // 10시 방향으로 수정 (210도)
    const wifiY = y + radius * Math.sin(Math.PI * 7/6);
    const bleX = x + radius * Math.cos(Math.PI * 11/6); // 2시 방향으로 수정 (330도)
    const bleY = y + radius * Math.sin(Math.PI * 11/6);
    
    return (
      <g className="connection-icons">
        {/* WiFi/MQTT 아이콘 - 10시 방향 */}
        <g transform={`translate(${wifiX}, ${wifiY})`} opacity={connections.mqtt ? 1 : 0.6}>
          <circle cx="0" cy="0" r="5" fill={connections.mqtt ? "#0ea5e9" : "#d1d5db"} stroke={connections.mqtt ? "#0284c7" : "#9ca3af"} strokeWidth="0.5" />
          <path 
            d="M-2.5,1.5 C-2.5,0.25 -1.25,-0.75 0,-0.75 C1.25,-0.75 2.5,0.25 2.5,1.5" 
            fill="none" 
            stroke={connections.mqtt ? "#ffffff" : "#9ca3af"}
            strokeWidth="0.5"
          />
          <path 
            d="M-1.25,1.5 C-1.25,0.75 -0.5,0.25 0,0.25 C0.5,0.25 1.25,0.75 1.25,1.5" 
            fill="none" 
            stroke={connections.mqtt ? "#ffffff" : "#9ca3af"}
            strokeWidth="0.5"
          />
          <circle cx="0" cy="1.5" r="0.5" fill={connections.mqtt ? "#ffffff" : "#9ca3af"} />
        </g>
        
        {/* 블루투스 아이콘 - 2시 방향 - 색상을 노란색으로 변경 */}
        <g transform={`translate(${bleX}, ${bleY})`} opacity={connections.ble ? 1 : 0.6}>
          <circle cx="0" cy="0" r="5" fill={connections.ble ? "#FFCC00" : "#d1d5db"} stroke={connections.ble ? "#f59e0b" : "#9ca3af"} strokeWidth="0.5" />
          <path 
            d="M0,-1.5 L0,1.5 L1.5,0 L0,-1.5 L1.5,-3 L0,-1.5 L-1.5,-3 L0,-1.5 L-1.5,0 L0,1.5 L1.5,3 L0,1.5 L-1.5,3 L0,1.5" 
            fill="none" 
            stroke={connections.ble ? "#ffffff" : "#9ca3af"}
            strokeWidth="0.5"
          />
        </g>
      </g>
    );
  };

  // 카메라 관련 상태 및 기능
  const [cameraLights, setCameraLights] = useState<Record<number, string>>({
    0: "OFF", 1: "OFF", 2: "OFF", 3: "OFF", 4: "OFF"
  });
  const [camStateMessages, setCamStateMessages] = useState<Record<number, string>>({});
  
  // 카메라 제어 함수
  const resetCamera = (camNumber: number) => {
    // 실제 카메라 리셋 명령을 MQTT로 전송하는 코드
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(`extwork/camera${camNumber}/control`, JSON.stringify({ 
        command: "reset", 
        timestamp: Date.now() 
      }));
    }
  };

  const toggleLight = (camNumber: number) => {
    const currentState = cameraLights[camNumber - 1] === "ON" ? "OFF" : "ON";
    
    // MQTT로 카메라 라이트 토글 명령 전송
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(`extwork/camera${camNumber}/control`, JSON.stringify({ 
        command: "light", 
        state: currentState,
        timestamp: Date.now() 
      }));
    }
    
    // 로컬 상태 업데이트
    setCameraLights(prev => ({
      ...prev,
      [camNumber - 1]: currentState
    }));
  };
  
  // 카메라 상태 메시지를 처리하는 코드
  useEffect(() => {
    if (!mqttClient) return;
    
    // 카메라 상태 토픽 구독
    const subscribeCameraTopics = () => {
      for (let i = 1; i <= 5; i++) {
        mqttClient.subscribe(`extwork/camera${i}/state`);
      }
    };
    
    // 카메라 상태 메시지 처리
    const handleCameraStateMessage = (topic: string, message: Buffer) => {
      const match = topic.match(/extwork\/camera(\d+)\/state/);
      if (!match) return;
      
      const camNumber = parseInt(match[1]);
      try {
        const data = JSON.parse(message.toString());
        
        // 카메라 상태 정보 업데이트
        if (data.light !== undefined) {
          setCameraLights(prev => ({
            ...prev,
            [camNumber - 1]: data.light
          }));
        }
        
        // 카메라 상태 메시지 업데이트
        if (data.status) {
          setCamStateMessages(prev => ({
            ...prev,
            [camNumber]: data.status
          }));
        }
      } catch (e) {
        console.error('카메라 상태 메시지 파싱 에러:', e);
      }
    };
    
    // 토픽 구독
    subscribeCameraTopics();
    
    // 메시지 핸들러 등록
    mqttClient.on('message', handleCameraStateMessage);
    
    // 정리 함수
    return () => {
      for (let i = 1; i <= 5; i++) {
        mqttClient.unsubscribe(`extwork/camera${i}/state`);
      }
      mqttClient.off('message', handleCameraStateMessage);
    };
  }, [mqttClient]);

  return (
    <div className="relative w-full bg-white rounded-lg shadow-sm overflow-hidden border border-gray-100">
      {/* 펄스 애니메이션 스타일 추가 */}
      <style>{pulseCss}</style>
      
      {/* 모니터링 타이틀과 시간 표시 - 파스텔 색상으로 변경 */}
      <div className="bg-blue-200 text-gray-700 px-4 py-1.5 flex justify-between items-center">
        <h2 className="text-sm font-semibold">모니터링: {formatTimeStr()}</h2>
        {/* 오른쪽 상태 영역: 에러 메시지와 완료 메시지 */}
        <div className="flex items-center space-x-2 text-xs">
          {/* 에러 메시지가 있으면 빨간색 알림으로 표시 */}
          {errorMessage && (
            <span className="bg-red-100 px-2 py-0.5 rounded text-red-700 animate-pulse">
              {errorMessage}
            </span>
          )}
          {/* 추출 완료 메시지 표시 */}
          {extractionCompleteMessage && (
            <span className="bg-green-100 px-2 py-0.5 rounded text-green-700">
              {extractionCompleteMessage}
            </span>
          )}
          {/* 공정 진행 중 표시 */}
          {processRunning && (
            <span className="bg-indigo-100 px-2 py-0.5 rounded text-indigo-700 flex items-center">
              <span className="h-2 w-2 bg-indigo-500 rounded-full mr-1 animate-pulse"></span>
              공정 진행 중
            </span>
          )}
        </div>
      </div>
      
      {/* 상태 변경 알림 UI 추가 */}
      {notifications.length > 0 && (
        <div className="absolute top-8 right-2 z-10 max-w-[300px] space-y-2">
          {notifications.map((notification, idx) => (
            <div 
              key={`${notification.timestamp}-${idx}`}
              className="bg-blue-50 p-2 rounded-lg border border-blue-200 text-xs shadow-sm animate-fadeIn"
            >
              <div className="flex justify-between">
                <span className="text-blue-700 font-medium">시스템 알림</span>
                <span className="text-blue-400 text-[10px]">
                  {new Date(notification.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-blue-800 mt-1">{notification.message}</p>
              {notification.source && (
                <p className="text-[10px] text-blue-400 mt-1">
                  출처: {notification.source}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* 모니터링 컨텐츠 컨테이너 */}
      <div className="flex">
        {/* 메인 모니터링 영역 - 비율을 60%에서 55%로 조정 */}
        <div className="w-[55%] border-r border-gray-200 p-0 pl-1 pr-1">
          {/* SVG 컨테이너 - 박스로 감싸기 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-0 mb-3 h-[500px] flex flex-col">
            <div className="bg-gray-100 py-2 px-3 text-sm font-semibold text-gray-700 rounded-t-lg border-b border-gray-200">
              탱크 시스템 모니터링
            </div>
            
            <div className="flex justify-start items-start flex-grow pl-0">
              <svg 
                viewBox="0 0 800 680" 
                className="w-[100%] h-[800px] ml-0 mr-auto"
                style={{ 
                  backgroundColor: 'white',
                  overflow: 'visible'
                }}
              >
                {/* 전체 컨텐츠를 탱크 시스템 모니터링 상자 안으로 이동 */}
                <g transform="translate(-170, -50) scale(1.10)">
          {/* 본탱크 - 너비 확대, 높이 감소 */}
          <rect
            x={mainTankPosition.x - mainTankPosition.width / 2}
            y={mainTankPosition.y - mainTankPosition.height / 2}
            width={mainTankPosition.width}
            height={mainTankPosition.height}
            rx="10"
            className={`${valve1 === 0 && isPipeActive(5) ? "fill-white stroke-yellow-400 stroke-[3]" : getTankColor(tankData?.mainTank?.status, 0)}`}
          />
          
          {/* 채워지는 애니메이션을 위한 오버레이 */}
          {tankData?.mainTank?.status === "filling" && (
            <rect
              x={mainTankPosition.x - mainTankPosition.width / 2}
              y={mainTankPosition.y - mainTankPosition.height / 2}
              width={mainTankPosition.width}
              height={mainTankPosition.height}
              rx="10"
              className="fill-amber-200/30"
              style={getFillingStyle(tankData?.mainTank?.status, 0)}
            />
          )}
          <text x={mainTankPosition.x} y={mainTankPosition.y} textAnchor="middle" className="text-xl font-bold fill-black">
            {mainTankPosition.label}
          </text>
          
          {/* 본탱크 상태 메시지 텍스트 박스 - 너비 확대 */}
          <g>
            <rect
              x={mainTankPosition.x - mainTankPosition.width / 2}
              y={mainTankPosition.y + mainTankPosition.height / 2 + 5}
              width={mainTankPosition.width}
              height={30}
              rx="3"
              className="fill-gray-100 stroke-gray-300 stroke-1"
            />
            <foreignObject
              x={mainTankPosition.x - mainTankPosition.width / 2}
              y={mainTankPosition.y + mainTankPosition.height / 2 + 5}
              width={mainTankPosition.width}
              height={30}
            >
              <div 
                xmlns="http://www.w3.org/1999/xhtml"
                className={`h-full flex items-center justify-center px-2 text-center ${tankData?.mainTankMessage ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
                style={{ fontSize: '6px', lineHeight: '1.1' }}
              >
                {tankData?.mainTankMessage || mainTankMessage || mainTankLevelMessage || getStatusMessage(tankData?.mainTank?.status, tankData?.mainTank?.level)}
              </div>
            </foreignObject>
          </g>

          {/* 탱크 연결 파이프 - 직선으로 연결 (2-3, 3-4, 4-5, 5-6번 탱크만) */}
          {Array(4)
            .fill(0)
            .map((_, i) => {
              const currentIndex = i + 1 // 2, 3, 4, 5번 탱크부터 시작
              const nextIndex = (currentIndex + 1) % 6 // 3, 4, 5, 6번 탱크
              const pumpIndex = i + 2 // 펌프 인덱스 (3, 4, 5, 6번 펌프는 각각 2, 3, 4, 5번 인덱스)
              
              // 안전 검사를 추가하여 tankData.tanks[pumpIndex]가 존재하는지 확인
              const pipeColor = tankData?.tanks && 
                                tankData?.tanks[pumpIndex] && 
                                tankData?.tanks[pumpIndex].pumpStatus === "ON" ? 
                                "stroke-blue-500" : "stroke-gray-300";
              
              return (
                <path
                  key={`pipe-${currentIndex}-${nextIndex}`}
                  d={calculatePipePath(currentIndex, nextIndex)}
                  className={`${pipeColor} stroke-[12]`}
                  fill="none"
                  strokeLinecap="round"
                />
              )
            })}

          {/* 1번 탱크에서 2번 펌프로의 경로 */}
          <path
            d={calculate1ToPump2Path()}
            className={`stroke-[12] ${
              tankData?.tanks && 
              tankData?.tanks[1] && 
              tankData?.tanks[1].pumpStatus === "ON" ? 
              "stroke-blue-500" : "stroke-gray-300"
            }`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 2번 펌프에서 2번 탱크로의 경로 */}
          <path
            d={calculatePump2To2Path()}
            className={`stroke-[12] ${
              tankData?.tanks && 
              tankData?.tanks[1] && 
              tankData?.tanks[1].pumpStatus === "ON" ? 
              "stroke-blue-500" : "stroke-gray-300"
            }`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 6번 탱크에서 3way 밸브(밸브2)로의 경로 */}
          <path
            d={calculate6ToValvePath()}
            className={`stroke-[12] ${
              (tankData?.tanks && 
              tankData?.tanks[5] && 
              tankData?.tanks[5].pumpStatus === "ON") || 
              (valve1 === 1 && isPipeActive(0)) ? 
              "stroke-blue-500" : "stroke-gray-300"
            }`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 3way 밸브(밸브2)에서 본탱크로의 경로 - 전체순환일 때만 표시 */}
          {valve1 === 0 && (
            <path
              d={calculate3wayToMainPath()}
              className={`stroke-[12] ${isPipeActive(5) ? "stroke-blue-500" : "stroke-gray-300"}`}
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* 본탱크에서 2way 밸브(밸브1)로의 경로 - 항상 표시 */}
          <path
            d={calculateMainToTank1Path()}
            className={`stroke-[12] ${valve2 === 1 || (valve1 === 1 && isPipeActive(0)) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 2way 밸브(밸브1)에서 펌프1 입구 쪽으로의 경로 - 항상 표시 */}
          <path
            d={calculate2wayToPump1Path()}
            className={`stroke-[12] ${(valve2 === 1 && isPipeActive(0)) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 3way 밸브(밸브2)에서 펌프 1로의 경로 - 추출순환일 때만 표시 */}
          {valve1 === 1 && (
            <path
              d={calculate3wayToPump1Path()}
              className={`stroke-[12] ${isPipeActive(5) || isPipeActive(0) ? "stroke-blue-500" : "stroke-gray-300"}`}
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* 합류 지점에서 펌프1로의 경로 */}
          <path
            d={calculateMergeToPump1Path()}
            className={`stroke-[12] ${((valve1 === 1 && (isPipeActive(5) || isPipeActive(0))) || (valve2 === 1 && isPipeActive(0))) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 1번 펌프에서 1번 탱크로의 경로 */}
          <path
            d={calculatePump1To1Path()}
            className={`stroke-[12] ${isPipeActive(0) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 펌프 (1번) */}
          {(() => {
            const pumpPos = calculatePumpPosition(5, 0);
            const tank = tankData?.tanks?.[0]; // 1번 펌프 = 0번 인덱스
            const stateMessage = pumpStateMessages[1] || '';
            const switchPosition = pumpSwitchPosition[1] || 0;
            
            return (
              <g key="pump-1" id="pump-1">
                <circle
                  cx={pumpPos.x}
                  cy={pumpPos.y}
                  r={pumpRadius}
                  className="stroke-gray-400 stroke-2"
                  fill={tank && tank.pumpStatus === "ON" ? "#93c5fd" : "#e5e7eb"}
                />
                <text x={pumpPos.x} y={pumpPos.y + 10} textAnchor="middle" className="text-sm font-bold">
                  invP-1
                </text>
                
                {/* 연결 상태 아이콘 추가 */}
                {renderConnectionIcons(1, pumpPos.x, pumpPos.y)}
                
                {/* 펌프 스위치 표시 - 태그 제거, ON/OFF만 표시 */}
                <g className="transition-transform duration-300" style={{ transform: `translateY(${switchPosition * 20}px)` }}>
                  {tank && tank.pumpStatus === "ON" && (
                    <rect 
                      x={pumpPos.x - 20} 
                      y={pumpPos.y - 30} 
                      width={40} 
                      height={15} 
                      rx={5}
                      className="fill-green-500 stroke-gray-700 stroke-1"
                    />
                  )}
                  <text x={pumpPos.x} y={pumpPos.y - 20} textAnchor="middle" className={`text-[12px] font-bold ${tank && tank.pumpStatus === "ON" ? "text-white" : "text-black"}`}>
                    {switchPosition < 0 ? "리셋" : (tank && tank.pumpStatus === "ON" ? "ON" : "OFF")}
                  </text>
                </g>
                
                {/* 리셋 타이머 표시 */}
                {resetTimers[1] && (
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius + 8}
                    className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                  />
                )}
                
                {/* 펌프 메시지 태그 표시 - 수평으로 스위치 위에 배치, 더 위로 올림 */}
                {pumpStateMessages[1] && (
                  <g transform={`translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`}>
                    <rect
                      x={0}
                      y={0}
                      width={120}
                      height={20}
                      rx={10}
                      className="fill-amber-100 stroke-amber-300 stroke-1 shadow-sm"
                    />
                    <text
                      x={60}
                      y={13}
                      textAnchor="middle"
                      className="text-[9px] font-medium fill-amber-800"
                    >
                      {pumpStateMessages[1].length > 14 ? pumpStateMessages[1].substring(0, 14) + '...' : pumpStateMessages[1]}
                    </text>
                  </g>
                )}
                
                {currentPressedPump === 1 && (
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius + 5}
                    className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                  />
                )}
              </g>
            );
          })()}

          {/* 펌프 (2번) */}
          {(() => {
            const pumpPos = calculatePumpPosition(0, 1);
            const tank = tankData?.tanks?.[1]; // 2번 펌프 = 1번 인덱스
            const stateMessage = pumpStateMessages[2] || '';
            const switchPosition = pumpSwitchPosition[2] || 0;
            
            return (
              <g key="pump-2" id="pump-2">
                <circle
                  cx={pumpPos.x}
                  cy={pumpPos.y}
                  r={pumpRadius}
                  className="stroke-gray-400 stroke-2"
                  fill={tank && tank.pumpStatus === "ON" ? "#93c5fd" : "#e5e7eb"}
                />
                <text x={pumpPos.x} y={pumpPos.y + 10} textAnchor="middle" className="text-sm font-bold">
                  invP-2
                </text>
                
                {/* 연결 상태 아이콘 추가 */}
                {renderConnectionIcons(2, pumpPos.x, pumpPos.y)}
                
                {/* 펌프 스위치 표시 - 태그 제거, ON/OFF만 표시 */}
                <g className="transition-transform duration-300" style={{ transform: `translateY(${switchPosition * 20}px)` }}>
                  {tank && tank.pumpStatus === "ON" && (
                    <rect 
                      x={pumpPos.x - 20} 
                      y={pumpPos.y - 30} 
                      width={40} 
                      height={15} 
                      rx={5}
                      className="fill-green-500 stroke-gray-700 stroke-1"
                    />
                  )}
                  <text x={pumpPos.x} y={pumpPos.y - 20} textAnchor="middle" className={`text-[12px] font-bold ${tank && tank.pumpStatus === "ON" ? "text-white" : "text-black"}`}>
                    {switchPosition < 0 ? "리셋" : (tank && tank.pumpStatus === "ON" ? "ON" : "OFF")}
                  </text>
                </g>
                
                {/* 리셋 타이머 표시 */}
                {resetTimers[2] && (
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius + 8}
                    className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                  />
                )}
                
                {/* 펌프 메시지 태그 표시 - 수평으로 스위치 위에 배치, 더 위로 올림 */}
                {pumpStateMessages[2] && (
                  <g transform={`translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`}>
                    <rect
                      x={0}
                      y={0}
                      width={120}
                      height={20}
                      rx={10}
                      className="fill-amber-100 stroke-amber-300 stroke-1 shadow-sm"
                    />
                    <text
                      x={60}
                      y={13}
                      textAnchor="middle"
                      className="text-[9px] font-medium fill-amber-800"
                    >
                      {pumpStateMessages[2].length > 14 ? pumpStateMessages[2].substring(0, 14) + '...' : pumpStateMessages[2]}
                    </text>
                  </g>
                )}
                
                {currentPressedPump === 2 && (
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius + 5}
                    className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                  />
                )}
              </g>
            );
          })()}

          {/* 펌프 (3~6번) - 탱크 사이에 배치 */}
          {Array(4)
            .fill(0)
            .map((_, index) => {
              const currentTankIndex = index + 1 // 2, 3, 4, 5번 탱크부터 시작
              const nextTankIndex = (currentTankIndex + 1) % 6 // 3, 4, 5, 6번 탱크
              const pumpPos = calculatePumpPosition(currentTankIndex, nextTankIndex);
              const pumpNum = index + 3 // 3, 4, 5, 6번 펌프
              // 안전하게 탱크 데이터 접근
              const tank = tankData?.tanks && tankData?.tanks.length > (pumpNum - 1) ? tankData?.tanks[pumpNum - 1] : null;
              const stateMessage = pumpStateMessages[pumpNum] || '';
              const switchPosition = pumpSwitchPosition[pumpNum] || 0;
              
              return (
                <g key={`pump-${pumpNum}`} id={`pump-${pumpNum}`}>
                  {/* 인버터 펌프 */}
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius}
                    className="stroke-gray-400 stroke-2"
                    fill={tank && tank.pumpStatus === "ON" ? "#93c5fd" : "#e5e7eb"}
                  />
                  <text x={pumpPos.x} y={pumpPos.y + 10} textAnchor="middle" className="text-sm font-bold">
                    invP-{pumpNum}
                  </text>
                  
                  {/* 연결 상태 아이콘 추가 */}
                  {renderConnectionIcons(pumpNum, pumpPos.x, pumpPos.y)}
                  
                  {/* 펌프 스위치 표시 - 태그 제거, ON/OFF만 표시 */}
                  <g className="transition-transform duration-300" style={{ transform: `translateY(${switchPosition * 20}px)` }}>
                    {tank && tank.pumpStatus === "ON" && (
                      <rect 
                        x={pumpPos.x - 20} 
                        y={pumpPos.y - 30} 
                        width={40} 
                        height={15} 
                        rx={5}
                        className="fill-green-500 stroke-gray-700 stroke-1"
                      />
                    )}
                    <text x={pumpPos.x} y={pumpPos.y - 20} textAnchor="middle" className={`text-[12px] font-bold ${tank && tank.pumpStatus === "ON" ? "text-white" : "text-black"}`}>
                      {switchPosition < 0 ? "리셋" : (tank && tank.pumpStatus === "ON" ? "ON" : "OFF")}
                    </text>
                  </g>
                  
                  {/* 리셋 타이머 표시 */}
                  {resetTimers[pumpNum] && (
                    <circle
                      cx={pumpPos.x}
                      cy={pumpPos.y}
                      r={pumpRadius + 8}
                      className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                    />
                  )}
                  
                  {/* 펌프 메시지 태그 표시 - 각 펌프에 붙어있는 대각선 형태 */}
                  {pumpStateMessages[pumpNum] && (
                    <g transform={(() => {
                      // 각 펌프마다 다른 위치와 각도 설정 - 빈 공간에 배치
                      switch (pumpNum) {
                        case 3: // 펌프 3번 - 펌프 아래쪽에 수평으로 배치
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y + 30}) rotate(0)`;
                        case 4: // 펌프 4번 - 스위치 위에 수평으로 배치, 더 위로 올림
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`;
                        case 5: // 펌프 5번 - 스위치 위에 수평으로 배치, 더 위로 올림
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`;
                        case 6: // 펌프 6번 - 펌프 아래쪽에 수평으로 배치
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y + 30}) rotate(0)`;
                        default:
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`;
                      }
                    })()}>
                      <rect
                        x={0}
                        y={0}
                        width={120}
                        height={20}
                        rx={10}
                        className="fill-amber-100 stroke-amber-300 stroke-1 shadow-sm"
                      />
                      <text
                        x={60}
                        y={13}
                        textAnchor="middle"
                        className="text-[9px] font-medium fill-amber-800"
                      >
                        {pumpStateMessages[pumpNum].length > 14 ? pumpStateMessages[pumpNum].substring(0, 14) + '...' : pumpStateMessages[pumpNum]}
                      </text>
                    </g>
                  )}
                  
                  {currentPressedPump === pumpNum && (
                    <circle
                      cx={pumpPos.x}
                      cy={pumpPos.y}
                      r={pumpRadius + 5}
                      className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                    />
                  )}
                </g>
              );
            })}

          {/* 탱크 1-6 */}
                  {tankPositions.map((position, i) => {
                    const tankId = i + 1;
                    const tankData1 = tankData?.tanks?.[i];
                    // 해당 인덱스의 탱크 메시지 가져오기
                    const tankMessage = tankMessages[tankId] || (tankData?.tankMessages ? tankData.tankMessages[tankId] : '');
            
            return (
                      <g key={`tank-${tankId}`} id={`tank-${tankId}`}>
                <rect
                          x={position.x - tankWidth / 2}
                          y={position.y - tankHeight / 2}
                  width={tankWidth}
                  height={tankHeight}
                          rx="10"
                          className={getTankColor(tankData1?.status, tankId)}
                />
                        
                        {/* 채워지는 애니메이션을 위한 오버레이 추가 */}
                        {tankData1?.status === "filling" && (
                  <rect
                            x={position.x - tankWidth / 2}
                            y={position.y - tankHeight / 2}
                    width={tankWidth}
                    height={tankHeight}
                            rx="10"
                            className="fill-blue-300/30"
                            style={getFillingStyle(tankData1?.status, tankId)}
                          />
                        )}
                        
                        <text x={position.x} y={position.y} textAnchor="middle" className="text-lg font-bold fill-black">
                          {position.label}
                </text>
                
                        {/* 탱크 텍스트 박스 추가 - 넉넉한 여백으로 조정 */}
                <g>
                  <rect
                            x={position.x - tankWidth / 2}
                            y={position.y + tankHeight / 2 + 5}
                            width={tankWidth}
                            height={30}
                    rx="3"
                            className={`fill-gray-100 stroke-gray-300 stroke-1 ${tankId === 4 ? 'fill-gray-100' : ''}`}
                  />
                  <foreignObject
                    x={position.x - tankWidth / 2}
                    y={position.y + tankHeight / 2 + 5}
                    width={tankWidth}
                    height={30}
                  >
                    <div 
                      xmlns="http://www.w3.org/1999/xhtml"
                      className={`h-full flex items-center justify-center px-2 text-center ${tankMessage ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
                      style={{ fontSize: '6px', lineHeight: '1.1' }}
                    >
                      {tankMessage || getStatusMessage(tankData1?.status, tankData1?.level)}
                    </div>
                  </foreignObject>
                </g>
              </g>
            );
          })}

          {/* 3way 밸브 - ON/OFF 스위치 형태로 개선 - 크기 줄임 */}
          <g
            onClick={() => handleValveChange(getNextValveState())}
            className="cursor-pointer"
            transform={`translate(${valve3wayPosition.x}, ${valve3wayPosition.y})`}
          >
            {/* 밸브 배경 - 크기 줄임 */}
            <rect 
              x="-30" 
              y="-30" 
              width="60" 
              height="50" 
              rx="10" 
              className={`fill-yellow-50 stroke-yellow-400 stroke-2`} 
            />
            
            {/* 밸브 내부 T자 표시 - 크기 조정 */}
            <line x1="-20" y1="0" x2="20" y2="0" className="stroke-yellow-500 stroke-2" />
            <line x1="0" y1="0" x2="0" y2="15" className="stroke-yellow-500 stroke-2" />
            
            {/* ON/OFF 스위치 - 위치에 따라 위아래로 이동 */}
            <rect 
              x="-20" 
              y={valve1 === 1 ? "-20" : "0"} 
              width="40" 
              height="20" 
              rx="10" 
              className={`${valve1 === 1 ? "fill-green-500" : "fill-red-500"} stroke-gray-400 stroke-1 transition-all duration-300`} 
            />
            
            {/* 밸브 텍스트 변경 */}
            <text x="0" y="-20" textAnchor="middle" className="text-sm font-bold">
              밸브2
            </text>
            <text x="0" y={valve1 === 1 ? "-10" : "10"} textAnchor="middle" className="text-[12px] font-bold text-white">
              {valve1 === 1 ? "추출순환" : "전체순환"}
            </text>
          </g>

          {/* 2way 밸브 이름과 표시 변경 */}
          <g transform={`translate(${valve2Position.x}, ${valve2Position.y})`}>
            {/* 밸브 배경 */}
            <rect 
              x="-30" 
              y="-30" 
              width="60" 
              height="50" 
              rx="10" 
              className={`fill-yellow-50 stroke-yellow-400 stroke-2`} 
            />
            
            {/* 밸브 내부 표시 */}
            <line x1="-20" y1="0" x2="20" y2="0" className="stroke-yellow-500 stroke-2" />
            {valve2 === 1 && <line x1="0" y1="-15" x2="0" y2="15" className="stroke-yellow-500 stroke-2" />}
            
            {/* ON/OFF 스위치 */}
            <rect 
              x="-20" 
              y={valve2 === 1 ? "-20" : "0"} 
              width="40" 
              height="20" 
              rx="10" 
              className={`${valve2 === 1 ? "fill-green-500" : "fill-red-500"} stroke-gray-400 stroke-1 transition-all duration-300`} 
            />
            
            {/* 밸브 텍스트 변경 */}
            <text x="0" y="-20" textAnchor="middle" className="text-sm font-bold">
              밸브1
            </text>
            <text x="0" y={valve2 === 1 ? "-10" : "10"} textAnchor="middle" className="text-[12px] font-bold text-white">
              {valve2 === 1 ? "본탱크 수집" : "OFF"}
            </text>
          </g>

          {/* 펌프 리셋 버튼 상자 - 추출 제어 상자 우측에 배치, 약간 왼쪽으로 이동 */}
          {/* 펌프 리셋 버튼은 상단으로 이동했으므로 제거 */}
        </g> {/* 전체 컨텐츠 위로 이동 translate의 닫는 태그 */}
      </svg>
            </div>
              </div>
            </div>
            
        {/* 추가 정보 사이드바 - 비율을 40%에서 45%로 조정 */}
        <div className="w-[45%] p-2 flex flex-col space-y-4">
          {/* 시스템 상태 정보 - 하단에서 옮겨옴 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-2">
            <div className="bg-indigo-50 py-1 px-2 text-xs font-semibold text-indigo-700 rounded-t-lg border-b border-gray-200">
              시스템 상태 정보
              </div>
            <div className="p-2 text-xs max-h-[120px] overflow-y-auto">
              {tankData.valveStatusMessage && (
                <div className="bg-yellow-50 p-1 rounded text-[9px] border border-yellow-100 mb-1 overflow-x-auto whitespace-nowrap">
                  <span className="font-semibold">밸브 상세:</span> {tankData.valveStatusMessage}
              </div>
            )}
            
              {/* 자동화 공정 상태 표시 */}
              {(automationStatus || extractionCompleteMessage) && (
                <div className={`p-1 rounded text-[9px] border mb-1 overflow-x-auto whitespace-nowrap ${
                  extractionCompleteMessage ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'
                }`}>
                  <span className="font-semibold">자동화 공정:</span> {extractionCompleteMessage || automationStatus}
              </div>
              )}
              
              {/* 대기시간 표시 */}
              {automationWaitTime && (
                <div className="bg-indigo-50 p-1 rounded text-[9px] border border-indigo-100 overflow-x-auto whitespace-nowrap">
                  <span className="font-semibold">다음 작업 대기 중:</span> {automationWaitTime.value}초 남음
              </div>
            )}
          </div>
        </div>
        
          {/* 추가 정보 박스 1 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-2">
            <div className="bg-blue-50 py-1 px-2 text-xs font-semibold text-blue-700 rounded-t-lg border-b border-gray-200">
              탱크 요약 정보
            </div>
            <div className="p-2 text-xs">
              <div className="mb-1">
                <span className="font-semibold">본탱크 상태:</span> {tankData?.mainTank?.status || "비었음"}
              </div>
              <div className="mb-1">
                <span className="font-semibold">채움 비율:</span> {fillPercentage}%
              </div>
              <div>
                <span className="font-semibold">탱크 상태:</span>
                <div className="pl-2 mt-1">
                  <div className="text-[9px]">본탱크: {getStatusMessage(tankData?.mainTank?.status, tankData?.mainTank?.level)}</div>
                  
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                    {tankData?.tanks?.map((tank, idx) => (
                      <div key={idx} className="text-[9px]">
                        {`탱크 ${tank.id}: ${getStatusMessage(tank.status, tank.level)}, 펌프: ${tank.pumpStatus}`}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* 추가 정보 박스 2 - Loading Process */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
            <div className="bg-green-50 py-1 px-2 text-xs font-semibold text-green-700 rounded-t-lg border-b border-gray-200">
              Loading Process
            </div>
            <div className="p-3">
              {/* JSON 데이터 - 하나만 표시 */}
              <div className="space-y-2">
                {progressMessages.filter(msg => msg.rawJson).slice(0, 1).map((msg, idx) => (
                  <div key={`json-${idx}`} className="p-2 rounded bg-white border border-gray-100 text-[10px] leading-tight">
                      <div className="flex justify-between items-center">
                      <span className="font-medium text-green-700">JSON 데이터</span>
                      <span className="text-green-500 font-semibold text-[8px]">{formatTimeStr()}</span>
                      </div>
                      
                      {msg.rawJson && (
                        <div className="mt-2 bg-green-50 border border-green-100 rounded p-2 overflow-x-auto">
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px]">
                          {(() => {
                            try {
                              const jsonData = JSON.parse(msg.rawJson);
                              return (
                                <>
                                  {jsonData.process_info && (
                              <div>
                                <span className="font-semibold text-green-700">진행:</span>{" "}
                                    <span className="font-medium">{jsonData.process_info}</span>
                              </div>
                            )}
                                  {jsonData.pump_id && (
                              <div>
                                      <span className="font-semibold text-green-700">펌프:</span>{" "}
                                    <span className="font-medium">{jsonData.pump_id}</span>
                              </div>
