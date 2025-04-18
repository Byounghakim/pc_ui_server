"use client"
import { motion } from "framer-motion"
import { useEffect, useState, useRef, useCallback } from "react"
import { MqttClient } from "mqtt"
import { cn } from '@/lib/utils';
import "./tank-system.css"; // 새로 생성한 CSS 파일 import
import { PROCESS_PROGRESS_TOPIC, AUTOMATION_STATUS_TOPIC } from "@/lib/mqtt-topics"; // MQTT 토픽 import
import { Tank } from '@/interface/tank'; // Tank 인터페이스만 임포트

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
      // 상태에 설명이 없으면 기본값 추가 (본탱크수집 방지)
      const stateWithDesc = { ...stateToSave };
      
      // 밸브 상태에 따라 적절한 설명 설정 (기본값 전체순환/추출순환)
      if (stateWithDesc.valveState === '0100') {
        if (!stateWithDesc.valveADesc) {
          stateWithDesc.valveADesc = '전체순환'; // '본탱크수집' 대신 '전체순환' 사용
        }
        if (!stateWithDesc.valveBDesc) {
          stateWithDesc.valveBDesc = 'ON';
        }
      } else if (stateWithDesc.valveState && stateWithDesc.valveState.length >= 2) {
        const v1 = parseInt(stateWithDesc.valveState[0]) || 0;
        const v2 = parseInt(stateWithDesc.valveState[1]) || 0;
        
        if (!stateWithDesc.valveADesc) {
          stateWithDesc.valveADesc = v1 === 1 ? '추출순환' : '전체순환';
        }
        if (!stateWithDesc.valveBDesc) {
          stateWithDesc.valveBDesc = v2 === 1 ? 'ON' : 'OFF';
        }
      }
      
      // 전체 상태를 로컬 스토리지에 저장
      const stateString = JSON.stringify(stateWithDesc);
      localStorage.setItem('tankSystemState', stateString);
      console.log('개선된 밸브 상태 저장:', stateWithDesc.valveState, 
        '설명:', stateWithDesc.valveADesc, stateWithDesc.valveBDesc);
      
      // IndexedDB에도 저장
      if (typeof saveToIndexedDB === 'function') {
        // extractionCommand 필드를 제외한 복사본 생성
        const stateForStorage = {...stateWithDesc};
        
        // 서버와 충돌할 수 있는 필드 제거
        if (stateForStorage.extractionCommand) {
          delete stateForStorage.extractionCommand;
        }
        
        saveToIndexedDB(stateForStorage);
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
      
      if (storedState && storedState !== 'undefined') {
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
  setProgressMessages?: (messages: Array<{timestamp: number, message: string, rawJson?: string | null}> | ((prev: Array<{timestamp: number, message: string, rawJson?: string | null}>) => Array<{timestamp: number, message: string, rawJson?: string | null}>)) => void // 진행 메시지 업데이트 함수 추가
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
  pumpMessages,
  setProgressMessages
}: TankSystemProps) {
  // 고유 클라이언트 ID 생성 함수
  const generateClientId = () => {
    if (typeof window === 'undefined') return 'server';
    return `client_${Math.random().toString(36).substring(2, 15)}`;
  };

  // MQTT 토픽에서 진행 정보 파싱을 위한 인터페이스 추가
  interface ProcessProgress {
    mode: string;             // 작동 모드 (동시모드, 순차모드, 오버랩모드)
    elapsed_time: number;     // 경과 시간 (초)
    remaining_time: number;   // 남은 시간 (초)
    total_repeats: number;    // 총 반복 횟수 
    current_repeat: number;   // 현재 반복 횟수
    pump_id?: string;         // 펌프 ID (순차모드, 오버랩모드에서 사용)
  }

  // 진행 상태 정보 저장 (펌프 ID별)
  const [pumpProgressInfo, setPumpProgressInfo] = useState<Record<number, ProcessProgress>>({});

  // 진행 정보 메시지 파싱 함수 - extwork/extraction/progress 토픽용
  const parseProgressMessage = (messageStr: string): ProcessProgress | null => {
    try {
      // JSON 파싱 시도
      if (messageStr.startsWith('{') && messageStr.endsWith('}')) {
        const progressData = JSON.parse(messageStr);
        
        // 기본 필드 확인
        if (progressData.elapsed_time && progressData.remaining_time) {
          // 경과 시간과 남은 시간을 초 단위로 파싱
          const elapsedStr = progressData.elapsed_time.replace('s', '');
          const remainingStr = progressData.remaining_time.replace('s', '');
          const elapsed = parseInt(elapsedStr, 10);
          const remaining = parseInt(remainingStr, 10);
          
          // 기본 프로그레스 정보 객체
          const progress: ProcessProgress = {
            mode: '',
            elapsed_time: elapsed,
            remaining_time: remaining,
            total_repeats: 1,
            current_repeat: 0,
            pump_id: undefined
          };
          
          // 모드 정보 파싱
          if (progressData.mode) {
            progress.mode = progressData.mode;
          } else if (messageStr.includes('동시모드')) {
            progress.mode = '동시모드';
          } else if (messageStr.includes('순차모드')) {
            progress.mode = '순차모드';
          } else if (messageStr.includes('오버랩모드')) {
            progress.mode = '오버랩모드';
          }
          
          // 반복 횟수 정보 파싱 - 동시모드
          if (progress.mode === '동시모드' && progressData.process_info) {
            const processMatch = progressData.process_info.match(/S\((\d+)\/(\d+)\)/);
            if (processMatch) {
              progress.current_repeat = parseInt(processMatch[1], 10);
              progress.total_repeats = parseInt(processMatch[2], 10) || 1; // 0이면 1로 처리
            }
          }
          
          // 펌프 ID 및 반복 횟수 파싱 - 순차모드 & 오버랩모드
          if ((progress.mode === '순차모드' || progress.mode === '오버랩모드') && progressData.pump_id) {
            // 정확한 패턴 매칭: "1(0/9)" 형식
            const pumpMatch = progressData.pump_id.match(/(\d+)\((\d+)\/(\d+)\)/);
            if (pumpMatch) {
              progress.pump_id = pumpMatch[1]; // 펌프 ID (예: "1")
              
              // 순차 모드 개선: 정확한 현재 반복 횟수와 총 반복 횟수 계산
              progress.current_repeat = parseInt(pumpMatch[2], 10); // 현재 반복 횟수 (예: 0)
              
              // 총 반복 횟수 처리 - 0부터 시작하므로 +1
              const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부터 시작하므로 +1
              progress.total_repeats = totalRepeats || 1; // 총 반복 횟수가 0이면 1로 설정
              
              console.log(`펌프 ${progress.pump_id} 진행 정보 파싱: 현재 ${progress.current_repeat+1}/${progress.total_repeats} 회 (${((progress.current_repeat/progress.total_repeats)*100).toFixed(1)}% 진행)`);
            }
          }
          
          return progress;
        }
      }
      
      // 텍스트 형식으로 된 메시지 파싱 시도 (비 JSON 형식)
      const elapsedMatch = messageStr.match(/경과:\s*(\d+)s/) || messageStr.match(/elapsed_time":\s*"(\d+)s/);
      const remainingMatch = messageStr.match(/남은:\s*(\d+)s/) || messageStr.match(/remaining_time":\s*"(\d+)s/);
      
      if (elapsedMatch && remainingMatch) {
        const elapsed = parseInt(elapsedMatch[1], 10);
        const remaining = parseInt(remainingMatch[1], 10);
        
        // 기본 프로그레스 정보 객체
        const progress: ProcessProgress = {
          mode: '',
          elapsed_time: elapsed,
          remaining_time: remaining,
          total_repeats: 1,
          current_repeat: 0,
          pump_id: undefined
        };
        
        // 모드 정보 파싱
        if (messageStr.includes('동시모드')) {
          progress.mode = '동시모드';
          // 동시모드 반복 횟수 정보 파싱
          const processMatch = messageStr.match(/S\((\d+)\/(\d+)\)/);
          if (processMatch) {
            progress.current_repeat = parseInt(processMatch[1], 10);
            progress.total_repeats = parseInt(processMatch[2], 10) || 1; // 0이면 1로 처리
          }
        } else if (messageStr.includes('순차모드')) {
          progress.mode = '순차모드';
          
          // 순차모드 펌프 ID 및 반복 횟수 파싱 - 개선된 정규식
          const pumpMatch = messageStr.match(/펌프\s*(\d+)\s*\((\d+)\/(\d+)\)/) || 
                            messageStr.match(/(\d+)\((\d+)\/(\d+)\)/);
          
          if (pumpMatch) {
            progress.pump_id = pumpMatch[1]; // 펌프 ID
            progress.current_repeat = parseInt(pumpMatch[2], 10); // 현재 반복 횟수
            
            // 총 반복 횟수 처리 - 0이면 1로 설정 (100% 채워짐)
            const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부터 시작하므로 +1
            progress.total_repeats = totalRepeats || 1;
            
            console.log(`[텍스트] 펌프 ${progress.pump_id} 순차모드 진행 정보: ${progress.current_repeat+1}/${progress.total_repeats} 회`);
          }
        } else if (messageStr.includes('오버랩모드')) {
          progress.mode = '오버랩모드';
          
          // 오버랩모드 펌프 ID 및 반복 횟수 파싱 - 개선된 정규식
          const pumpMatch = messageStr.match(/펌프\s*(\d+)\s*\((\d+)\/(\d+)\)/) || 
                            messageStr.match(/(\d+)\((\d+)\/(\d+)\)/);
                          
          if (pumpMatch) {
            progress.pump_id = pumpMatch[1]; // 펌프 ID
            progress.current_repeat = parseInt(pumpMatch[2], 10); // 현재 반복 횟수
            
            // 총 반복 횟수 처리 - 0이면 1로 설정 (100% 채워짐)
            const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부터 시작하므로 +1
            progress.total_repeats = totalRepeats || 1;
            
            console.log(`[텍스트] 펌프 ${progress.pump_id} 오버랩모드 진행 정보: ${progress.current_repeat+1}/${progress.total_repeats} 회`);
          }
        }
        
        return progress;
      }
      
      return null;
    } catch (error) {
      console.error('진행 정보 파싱 오류:', error);
      return null;
    }
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
  
  // 상태 변경 알림을 위한 상태 업데이트
  const [notifications, setNotifications] = useState<Array<{
    message: string,
    timestamp: number,
    source?: string,
    type?: 'info' | 'warning' | 'error', // 알림 유형 추가
    pumpId?: number // 펌프 ID 추가
  }>>([]);

  // 알림 추가 함수 
  const addNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info', pumpId?: number) => {
    const notification = {
      message,
      timestamp: Date.now(),
      type,
      pumpId,
      source: '시스템'
    };
    
    // 알림 목록에 추가
    setNotifications(prev => [...prev, notification]);
    
    // 15초 후 알림 자동 제거
    setTimeout(() => {
      setNotifications(prev => 
        prev.filter(n => n.timestamp !== notification.timestamp)
      );
    }, 15000);
    
    // MQTT를 통해 알림 공유 (다른 클라이언트에게도 알림)
    if (mqttClient) {
      mqttClient.publish('tank-system/notifications', JSON.stringify({
        ...notification,
        clientId: clientId.current
      }));
    }
  };

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
        
        // 2번 탱크 수위 문제 해결: 모든 탱크-인버터 조합 구독
        for (let j = 1; j <= 6; j++) {
          if (i !== j) { // 위에서 이미 구독한 동일 번호 조합은 제외
            mqttClient.subscribe(`extwork/inverter${i}/tank${j}_level`);
            console.log(`추가 구독: extwork/inverter${i}/tank${j}_level`);
          }
        }
        
        // 인버터 상태 토픽 구독 (펌프 상태)
        mqttClient.subscribe(`extwork/inverter${i}/state`);
        
        // 인버터 연결 상태 토픽 구독
        mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
      }
      
      // 본탱크 수위 토픽 구독
      mqttClient.subscribe('extwork/tank/level');
      
      // 자동화 공정 관련 토픽 구독
      mqttClient.subscribe(AUTOMATION_STATUS_TOPIC);
      mqttClient.subscribe(PROCESS_PROGRESS_TOPIC);
      
      // 추출 명령 입력 토픽 구독 추가
      mqttClient.subscribe('extwork/extraction/input');
      
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
        // extwork/extraction/input 토픽 처리 추가
        if (topic === 'extwork/extraction/input') {
          console.log(`추출 입력 명령 수신: ${messageStr}`);
          
          try {
            // 메시지 유효성 검사 추가
            if (!messageStr || messageStr.trim() === '') {
              throw new Error("빈 메시지 입니다");
            }
            
            // 'next'와 같은 유효하지 않은 JSON 문자열 필터링
            if (messageStr.trim() === 'next' || !messageStr.trim().startsWith('{')) {
              console.log('JSON 형식이 아닌 메시지 수신:', messageStr);
              addNotification(`JSON 형식이 아닌 메시지: ${messageStr}`, 'warning');
              return;
            }
            
            // JSON 데이터 파싱 시도
            const jsonData = JSON.parse(messageStr);
            
            // 받은 명령 저장하기 (시간 추가하여 메시지 보관)
            const timeStr = formatTimeStr();
            const displayMessage = `새 공정 명령 수신: ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'} (${timeStr})`;
            
            // 별도 상태로 저장 (active = true로 설정)
            setExtractionCommand({
              timestamp: Date.now(),
              message: displayMessage,
              rawJson: messageStr,
              active: true
            });
            
            // 로컬 스토리지에도 저장 (영구 보존)
            localStorage.setItem('lastExtractionCommand', messageStr);
            localStorage.setItem('lastExtractionTimestamp', Date.now().toString());
            localStorage.setItem('extractionCommandActive', 'true');
            
            // 알림 추가
            addNotification(`새 공정 명령이 수신되었습니다: ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'}`, 'info');
            
            // 기존 progress 메시지 업데이트도 유지
            if (setProgressMessages) {
              setProgressMessages(prev => [{
                timestamp: Date.now(),
                message: displayMessage,
                rawJson: messageStr
              }, ...prev]);
            }
            
            console.log(`추출 명령 처리됨: ${displayMessage}`);
          } catch (parseError) {
            console.error('추출 입력 명령 파싱 오류:', parseError, '원본 메시지:', messageStr);
            
            // 파싱 실패해도 알림은 띄워줌
            addNotification('추출 명령을 수신했지만 처리할 수 없습니다. 형식을 확인해주세요.', 'error');
            
            // 파싱 실패 메시지 추가
            if (setProgressMessages) {
              setProgressMessages(prev => [{
                timestamp: Date.now(),
                message: `오류: 수신된 명령의 JSON 형식이 잘못되었습니다. [${messageStr.substring(0, 20)}${messageStr.length > 20 ? '...' : ''}]`,
                rawJson: null
              }, ...prev]);
            }
          }
          return; // 다른 핸들러 호출하지 않고 종료
        }
        // 토픽에 따른 처리
        else if (topic === 'tank-system/notifications') {
          const notification = JSON.parse(messageStr);
          
          // 자신이 발생시킨 알림이 아닌 경우에만 처리
          if (notification.clientId !== clientId.current) {
            setNotifications(prev => [
              ...prev,
              {
                message: notification.message,
                timestamp: notification.timestamp,
                source: notification.clientId,
                type: notification.type || 'info',
                pumpId: notification.pumpId
              }
            ]);
            
            // 15초 후 알림 제거
            setTimeout(() => {
              setNotifications(prev => 
                prev.filter(n => n.timestamp !== notification.timestamp)
              );
            }, 15000);
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
            
            // 중요 메시지 여부 정확하게 체크 (정확한 메시지만 매칭)
            const isImportantMessage = (msg: string, tankId: number): boolean => {
              // 1번 탱크와 나머지 탱크를 구분
              if (tankId === 1) {
                // 1번 탱크용 중요 메시지
                return (
                  msg.includes("수위:5%이상") || 
                  msg.includes("수위부족:5%미만") || 
                  msg.includes("가득채워짐") ||
                  msg.includes("채움가능")
                );
            } else {
                // 2~6번 탱크용 중요 메시지
                return (
                  msg.includes("수위부족") || 
                  msg.includes("수위정상") || 
                  msg.includes("가득채워짐") || 
                  msg.includes("정상수위")
                );
              }
            };
            
            // 메시지 처리 - 텍스트 박스에 표시할 전체 메시지
            let displayMessage = `${messageStr} (${timeStr})`;
            
            // 탱크 내부에 표시할 메시지 (중요 메시지만)
            let tankDisplayMessage = "";
            
            // 중요 메시지 여부 확인
            if (isImportantMessage(messageStr, tankId)) {
              // 중요 상태 메시지는 탱크 내부 표시용으로 저장
              tankDisplayMessage = messageStr;
              console.log(`중요 상태 메시지 감지: "${messageStr}" (탱크 ${tankId})`);
            }
            
            // 디버깅: 탱크 메시지 업데이트 전 현재 상태 확인
            console.log(`탱크 ${tankId} 메시지 업데이트 전 현재 상태:`, {
              현재메시지: tankMessages[tankId],
              새메시지: displayMessage
            });
            
            // 탱크 메시지 상태 업데이트 - 두 종류의 메시지 모두 업데이트
            setTankMessages(prev => {
              const updated = {
                ...prev,
                [tankId]: displayMessage
              };
              console.log(`탱크 ${tankId} 메시지 업데이트: "${displayMessage}"`);
              
              // 원본 메시지를 localStorage에 저장하여 다음 갱신까지 유지
              localStorage.setItem(`tank_${tankId}_last_message`, messageStr);
              console.log(`원본 메시지 저장: tank_${tankId}_last_message = "${messageStr}"`);
              
              // 텍스트 박스용 메시지 저장
              localStorage.setItem(`tank_${tankId}_message`, displayMessage);
              
              // 중요 메시지는 별도로 저장 (탱크 내부 표시용)
              if (tankDisplayMessage) {
                localStorage.setItem(`tank_${tankId}_important_message`, tankDisplayMessage);
                console.log(`중요 메시지 저장 (탱크 내부 표시용): tank_${tankId}_important_message = "${tankDisplayMessage}"`);
              }
              
              return updated;
            });
            
            // 디버깅: 현재 상태 출력
            setTimeout(() => {
              console.log(`탱크 ${tankId} 메시지 상태 업데이트 완료: "${displayMessage}"`);
              if (tankDisplayMessage) {
                console.log(`탱크 ${tankId} 내부 표시 메시지: "${tankDisplayMessage}"`);
              }
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
          
          // 펌프 상태가 ON에서 OFF로 변경된 경우 알림 추가
          if (tankData?.tanks && tankData?.tanks[inverterId - 1]?.pumpStatus === "ON" && !isOn) {
            const timeStr = formatTimeStr();
            const pumpOffMessage = `펌프 ${inverterId} OFF: ${messageStr} (${timeStr})`;
            addNotification(pumpOffMessage, 'info', inverterId);
          }
        }
        // 카메라 상태 토픽 처리 추가
        else if (topic.match(/extwork\/cam(\d+)\/state/)) {
          const camNumber = parseInt(topic.match(/extwork\/cam(\d+)\/state/)![1]);
          console.log(`카메라 ${camNumber} 상태 메시지 수신: ${messageStr}`);
          
          // 이 컴포넌트에서는 카메라 상태 처리를 하지 않고,
          // 상위 컴포넌트(Dashboard)에서 처리하도록 합니다.
          // 여기서는 로그만 출력합니다.
        }
        // 자동화 공정 상태 토픽 처리
        else if (topic === AUTOMATION_STATUS_TOPIC) {
          try {
            const automationStatus = JSON.parse(messageStr);
            if (automationStatus.status === "sequence_started") {
              setAutomationProgress(`${automationStatus.sequenceName} 시퀀스 시작됨`);
            }
          } catch (error) {
            console.error('자동화 상태 메시지 파싱 오류:', error);
            // JSON 파싱 실패 시 원본 메시지 그대로 저장
            setAutomationProgress(messageStr);
          }
        }
        // 공정 진행 상태 토픽 처리
        else if (topic === PROCESS_PROGRESS_TOPIC) {
          try {
            // 공정 진행 상태 메시지 처리
            console.log(`공정 진행 상태 메시지: ${messageStr}`);
            
            // JSON 파싱 시도
            let jsonData: any;
            let isJsonFormat = false;
            
            try {
              if (messageStr.trim().startsWith('{') && messageStr.trim().endsWith('}')) {
                jsonData = JSON.parse(messageStr);
                isJsonFormat = true;
                console.log('JSON 형식 진행 데이터 확인:', jsonData);
              }
            } catch (jsonError) {
              console.log('JSON 파싱 실패, 텍스트 형식으로 처리:', jsonError);
            }
            
            // 진행 정보 파싱 (JSON 또는 텍스트 형식)
            let progressInfo: ProcessProgress | null = null;
            
            if (isJsonFormat && jsonData) {
              // JSON 형식 처리 - 요청한 형식에 맞춘 명시적 처리
              progressInfo = {
                mode: jsonData.mode || '',
                elapsed_time: 0,
                remaining_time: 0,
                total_repeats: 1,
                current_repeat: 0,
                pump_id: undefined
              };
              
              // 경과 시간 추출 (숫자 또는 문자열+s 형식)
              if (jsonData.elapsed_time !== undefined) {
                if (typeof jsonData.elapsed_time === 'number') {
                  progressInfo.elapsed_time = jsonData.elapsed_time;
                } else if (typeof jsonData.elapsed_time === 'string') {
                  const match = String(jsonData.elapsed_time).match(/(\d+)/);
                  if (match) {
                    progressInfo.elapsed_time = parseInt(match[1], 10);
                  }
                }
              }
              
              // 남은 시간 추출 (숫자 또는 문자열+s 형식)
              if (jsonData.remaining_time !== undefined) {
                if (typeof jsonData.remaining_time === 'number') {
                  progressInfo.remaining_time = jsonData.remaining_time;
                } else if (typeof jsonData.remaining_time === 'string') {
                  const match = String(jsonData.remaining_time).match(/(\d+)/);
                  if (match) {
                    progressInfo.remaining_time = parseInt(match[1], 10);
                  }
                }
              }
              
              // 펌프 ID 추출 (예: "1(10/11)" 형식)
              if (jsonData.pump_id) {
                progressInfo.pump_id = String(jsonData.pump_id);
                
                // 반복 정보 파싱 (예: "1(10/11)" → 펌프 1, 현재 10회, 총 11회)
                const pumpMatch = String(jsonData.pump_id).match(/(\d+)\((\d+)\/(\d+)\)/);
                if (pumpMatch) {
                  // 현재 반복 횟수와 총 반복 횟수 설정
                  progressInfo.current_repeat = parseInt(pumpMatch[2], 10);
                  progressInfo.total_repeats = parseInt(pumpMatch[3], 10);
                  
                  console.log(`[JSON] 펌프 ${pumpMatch[1]} 진행 정보: ${progressInfo.current_repeat}/${progressInfo.total_repeats} 회`);
                }
              }
              
              // process_info 필드에서 반복 정보 파싱 (예: "C(6/10)")
              if (jsonData.process_info) {
                const processMatch = String(jsonData.process_info).match(/\w+\((\d+)\/(\d+)\)/);
                if (processMatch) {
                  if (!progressInfo.pump_id) {
                    // 동시모드인 경우 또는 pump_id가 없는 경우에만 설정
                    progressInfo.current_repeat = parseInt(processMatch[1], 10);
                    progressInfo.total_repeats = parseInt(processMatch[2], 10);
                  }
                }
              }
              
              console.log('파싱된 JSON 진행 정보:', progressInfo);
            } else {
              // 기존 텍스트 기반 파싱 사용
              progressInfo = parseProgressMessage(messageStr);
            }
            
            // 진행 정보가 있으면 상태 업데이트
            if (progressInfo) {
              console.log('최종 파싱된 진행 정보:', progressInfo);
              
              // 펌프 ID가 있는 경우 (순차모드, 오버랩모드)
              if (progressInfo.pump_id) {
                // 펌프 ID 추출 ("1(10/11)" → "1")
                const pumpIdMatch = String(progressInfo.pump_id).match(/^(\d+)/);
                const pumpId = pumpIdMatch ? parseInt(pumpIdMatch[1], 10) : 0;
                
                if (pumpId > 0) {
                // 진행 정보 상태 업데이트 전 로그
                console.log(`펌프 ${pumpId} 진행 정보 업데이트 전:`, {
                  현재값: pumpProgressInfo[pumpId],
                  새값: progressInfo
                });
                
                // 펌프 ID에 해당하는 진행 정보 업데이트
                setPumpProgressInfo(prev => {
                  const updated = { 
                    ...prev, 
                    [pumpId]: progressInfo 
                  };
                  
                  // 업데이트 후 값 기록
                  setTimeout(() => {
                    console.log(`펌프 ${pumpId} 진행 정보 업데이트 후:`, updated[pumpId]);
                  }, 10);
                  
                  return updated;
                });
                
                // JSON으로 직렬화하여 로컬 스토리지에도 저장 (디버깅용)
                try {
                  localStorage.setItem(`pump_progress_${pumpId}`, JSON.stringify(progressInfo));
                    
                    // 진행률 계산하여 저장 (애니메이션용)
                    const totalTime = progressInfo.elapsed_time + progressInfo.remaining_time;
                    if (totalTime > 0) {
                      const fillPercent = 5 + (progressInfo.elapsed_time / totalTime) * 90;
                      localStorage.setItem(`pump_${pumpId}_fill_percent`, fillPercent.toString());
                    }
                } catch (e) {
                  console.error('진행 정보 로컬 스토리지 저장 실패:', e);
                  }
                } else {
                  console.log('펌프 ID를 추출할 수 없거나 유효하지 않음:', progressInfo.pump_id);
                }
              } else if (progressInfo.mode === '동시모드') {
                // 동시모드인 경우 모든 활성 펌프에 동일한 진행 정보 적용
                const activePumps = tankData?.tanks?.filter(t => t.pumpStatus === "ON").map(t => t.id) || [];
                
                if (activePumps.length > 0) {
                  console.log(`동시모드: ${activePumps.length}개 활성 펌프에 진행 정보 적용`, activePumps);
                  
                  setPumpProgressInfo(prev => {
                    const updated = { ...prev };
                    
                    activePumps.forEach(pumpId => {
                      updated[pumpId] = progressInfo;
                      
                      // 로컬 스토리지에도 저장 (디버깅용)
                      try {
                        localStorage.setItem(`pump_progress_${pumpId}`, JSON.stringify(progressInfo));
                        
                        // 진행률 계산하여 저장 (애니메이션용)
                        const totalTime = progressInfo.elapsed_time + progressInfo.remaining_time;
                        if (totalTime > 0) {
                          const fillPercent = 5 + (progressInfo.elapsed_time / totalTime) * 90;
                          localStorage.setItem(`pump_${pumpId}_fill_percent`, fillPercent.toString());
                        }
                      } catch (e) {
                        console.error('진행 정보 로컬 스토리지 저장 실패:', e);
                      }
                    });
                    
                    return updated;
                  });
                } else {
                  console.log('동시모드이지만 활성화된 펌프가 없습니다.');
                }
              } else {
                console.log('처리할 펌프 ID가 없거나 모드가 지정되지 않았습니다.');
              }
              
              // progress 메시지 업데이트
              if (setProgressMessages) {
                setProgressMessages(prev => [{
                  timestamp: Date.now(),
                  message: `진행 상태: ${messageStr}`,
                  rawJson: isJsonFormat ? messageStr : null
                }, ...prev]);
              }
              
            // 텍스트 메시지 처리 (현재 시퀀스 정보 파싱)
            if (messageStr.includes("현재 시퀀스:")) {
              setCurrentSequenceInfo(messageStr.split('\n')[0]?.trim() || null);
            }
            
            // 다음 시퀀스 정보 파싱
            if (messageStr.includes("다음 시퀀스:")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith("다음 시퀀스:")) {
                  setNextSequenceInfo(line.trim());
                  break;
                }
              }
            }
            
            // 시퀀스 통계 정보 파싱 (n개 완료 / n개 실행중 / n개 대기중 / n개 오류)
            if (messageStr.includes("개 완료") && messageStr.includes("개 실행중")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.includes("개 완료") && line.includes("개 실행중")) {
                  setSequenceStatsInfo(line.trim());
                  break;
                }
              }
            }
            
              // 전체 메시지를 자동화 진행 상태 표시에 저장
            setAutomationProgress(messageStr);
            } else {
              console.log('진행 정보를 파싱할 수 없습니다. 원본 메시지:', messageStr);
              // 파싱 실패 시에도 원본 메시지 저장
              setAutomationProgress(messageStr);
            }
          } catch (error) {
            console.error('공정 진행 상태 메시지 처리 오류:', error);
            setAutomationProgress(messageStr); // 오류 발생 시 원본 메시지 그대로 저장
          }
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

  // 추출 진행 상황에서 탱크 채움 비율 계산 - 로직 개선
  useEffect(() => {
    if (progressMessages.length > 0) {
      const latestProgress = progressMessages[0]; // 가장 최신 메시지 사용 (배열 첫 번째 요소)
      const latestMessage = latestProgress.message || '';
      console.log('최신 진행 메시지:', latestMessage);
      
      // 다양한 형식의 진행 메시지 처리 개선
      try {
        // 1. "남은: XXs | 경과: YYs" 형식 패턴 확인
        const remainingMatch = latestMessage.match(/남은:\s*(\d+)s/) || latestMessage.match(/남음:\s*(\d+)s/) || latestMessage.match(/remaining:\s*(\d+)s/);
        const elapsedMatch = latestMessage.match(/경과:\s*(\d+)s/) || latestMessage.match(/진행:\s*(\d+)s/) || latestMessage.match(/elapsed:\s*(\d+)s/);
        
        // 2. 직접적인 숫자 패턴 확인 ("50/100초" 같은 형식)
        const directProgressMatch = latestMessage.match(/(\d+)\/(\d+)(초|s)/);
      
      if (remainingMatch && elapsedMatch) {
        const remaining = parseInt(remainingMatch[1], 10);
        const elapsed = parseInt(elapsedMatch[1], 10);
        const total = remaining + elapsed;
        
        if (!isNaN(remaining) && !isNaN(elapsed) && total > 0) {
          // 현재 경과 시간과 전체 시간의 비율 계산 (최대 100%)
          const percentage = Math.min((elapsed / total) * 100, 100);
          setFillPercentage(percentage);
          console.log(`채움 애니메이션 진행률 업데이트: ${percentage.toFixed(1)}% (경과: ${elapsed}s, 전체: ${total}s)`);
        }
        } else if (directProgressMatch) {
          // 직접적인 진행 정보 파싱 (예: "50/100초")
          const current = parseInt(directProgressMatch[1], 10);
          const total = parseInt(directProgressMatch[2], 10);
          
          if (!isNaN(current) && !isNaN(total) && total > 0) {
            const percentage = Math.min((current / total) * 100, 100);
            setFillPercentage(percentage);
            console.log(`채움 애니메이션 진행률 업데이트(직접 형식): ${percentage.toFixed(1)}% (현재: ${current}, 전체: ${total})`);
          }
        } else {
          // 3. JSON 형식인 경우 파싱 시도
          try {
            if (latestProgress.rawJson) {
              const jsonData = JSON.parse(latestProgress.rawJson);
              
              // process_time과 total_remaining을 사용한 진행률 계산 추가
              if (jsonData.process_time !== undefined && jsonData.total_remaining !== undefined) {
                const processTime = parseInt(jsonData.process_time.toString().replace('s', ''), 10);
                const totalRemaining = parseInt(jsonData.total_remaining.toString().replace('s', ''), 10);
                
                if (!isNaN(processTime) && !isNaN(totalRemaining)) {
                  // 전체 처리 시간 - 이미 처리한 시간과 남은 시간의 합
                  const totalTime = processTime;
                  // 진행률 = ((전체 처리 시간 - 남은 시간) / 전체 처리 시간) * 100
                  const completedTime = Math.max(0, processTime - totalRemaining);
                  const percentage = Math.min((completedTime / processTime) * 100, 100);
                  setFillPercentage(percentage);
                  console.log(`채움 애니메이션 진행률 업데이트(process_time): ${percentage.toFixed(1)}% (처리 시간: ${processTime}s, 완료 시간: ${completedTime}s, 남은 시간: ${totalRemaining}s)`);
                }
              } else if (jsonData.elapsedTime !== undefined && jsonData.totalTime !== undefined) {
                const elapsed = parseInt(jsonData.elapsedTime, 10);
                const total = parseInt(jsonData.totalTime, 10);
                
                if (!isNaN(elapsed) && !isNaN(total) && total > 0) {
                  const percentage = Math.min((elapsed / total) * 100, 100);
                  setFillPercentage(percentage);
                  console.log(`채움 애니메이션 진행률 업데이트(JSON): ${percentage.toFixed(1)}% (경과: ${elapsed}s, 전체: ${total}s)`);
                }
              } else if (jsonData.percent !== undefined) {
                // 퍼센트 직접 파싱
                const percentStr = jsonData.percent.toString().replace('%', '');
                const percentage = parseFloat(percentStr);
                
                if (!isNaN(percentage)) {
                  setFillPercentage(percentage);
                  console.log(`채움 애니메이션 진행률 업데이트(퍼센트): ${percentage.toFixed(1)}%`);
                }
              }
            }
          } catch (jsonError) {
            // JSON 파싱 실패해도 무시
          }
        }
      } catch (error) {
        console.error('진행 메시지 파싱 오류:', error);
      }
      
      // 4. 펌프가 ON 상태이면 기본값 50%로 설정 (채움 애니메이션은 보이지만 정확한 진행률은 알 수 없음)
      const anyPumpActive = tankData?.tanks?.some(tank => tank.pumpStatus === "ON");
      if (anyPumpActive && fillPercentage === 0) {
        setFillPercentage(50);
        console.log('펌프 활성화 감지, 기본 채움 애니메이션 적용 (50%)');
      }
    }
  }, [progressMessages, tankData?.tanks]);

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
  const getStatusMessage = (status: string, level: number, tankId?: number) => {
    // 본탱크(tankId가 0)인 경우 mainTankMessage 우선 표시
    if (tankId === 0 && mainTankMessage) {
      return mainTankMessage;
    }

    // tankId가 유효한 경우 이전에 저장된 메시지가 있는지 확인
    if (tankId !== undefined) {
      const savedMessage = localStorage.getItem(`tank_${tankId}_last_message`);
      if (savedMessage) {
        return savedMessage;
      }
    }

    // 기본 탱크 상태 메시지 로직
    switch (status) {
      case "full":
        return "가득채워짐";
      case "empty":
        return "준비중"; // 초기값을 "준비중"으로 변경
      case "filling":
        return `채워지는 중 (${Math.round(fillPercentage)}%)`;
      default:
        return `5% 이상 잔여`;
    }
  };

  // 채워지는 애니메이션을 위한 스타일 계산 함수 개선
  const getFillingStyle = (status: string, tankId: number, operationTime?: number) => {
    // 디버깅: 함수 호출 정보 추가
    console.log(`[getFillingStyle] 호출: 탱크 ${tankId}, 상태=${status}, 작동시간=${operationTime || 'N/A'}`);

    // 펌프가 꺼져 있으면 애니메이션 없음
    if (status !== "ON") {
      console.log(`[getFillingStyle] 탱크 ${tankId}의 펌프가 꺼져 있어 채움 없음`);
      return {};
    }

    // 해당 탱크와 연결된 펌프의 상태 확인
    const pumpStatus = tankData?.tanks && tankData?.tanks[tankId - 1]?.pumpStatus || "OFF";
    console.log(`[getFillingStyle] 탱크 ${tankId}의 펌프 상태: ${pumpStatus}`);
    
    // 펌프 진행 정보 가져오기
      const pumpProgress = pumpProgressInfo[tankId];
    console.log(`[getFillingStyle] 펌프 ${tankId}의 pumpProgressInfo:`, pumpProgress);
      
      if (pumpProgress) {
      // 간단한 애니메이션 로직 적용 - elapsed_time과 remaining_time의 비율로 계산
      let elapsedTime = 0;
      let totalTime = 0;
      
      // elapsed_time 값 추출
      if (pumpProgress.elapsed_time !== undefined) {
        if (typeof pumpProgress.elapsed_time === 'number') {
          elapsedTime = pumpProgress.elapsed_time;
        } else if (typeof pumpProgress.elapsed_time === 'string') {
          // 문자열에서 숫자 추출 (예: "54s" -> 54)
          const matchElapsed = String(pumpProgress.elapsed_time).match(/(\d+)/);
          if (matchElapsed) {
            elapsedTime = parseInt(matchElapsed[1], 10);
          }
        }
      }
      
      // remaining_time 값 추출
      if (pumpProgress.remaining_time !== undefined) {
        if (typeof pumpProgress.remaining_time === 'number') {
          totalTime = elapsedTime + pumpProgress.remaining_time;
        } else if (typeof pumpProgress.remaining_time === 'string') {
          // 문자열에서 숫자 추출 (예: "6s" -> 6)
          const matchRemaining = String(pumpProgress.remaining_time).match(/(\d+)/);
          if (matchRemaining) {
            const remainingTime = parseInt(matchRemaining[1], 10);
            totalTime = elapsedTime + remainingTime;
          }
        }
      }
      
      console.log(`[getFillingStyle] 펌프 ${tankId} 시간 계산: elapsedTime=${elapsedTime}, totalTime=${totalTime}`);
      
      // 데이터가 없거나 totalTime이 0이면 기본값 사용
      if (totalTime <= 0) {
        console.log(`[getFillingStyle] 탱크 ${tankId}의 시간 데이터가 없거나 0입니다. 기본값 사용`);
        return {
          clipPath: 'inset(95% 0 0 0)', // 기본 5% 채움
          transition: 'clip-path 1s linear',
          backgroundColor: 'rgba(59, 130, 246, 0.3)'
        };
      }
      
      // 진행률 계산 (백분율)
      let fillPercent = Math.min((elapsedTime / totalTime) * 100, 100);
      
      // 최소 5% 채움 보장 (시각적 피드백)
      fillPercent = Math.max(fillPercent, 5);
      
      console.log(`[간단한 채움 계산] 탱크 ${tankId}: ${fillPercent.toFixed(1)}% (경과:${elapsedTime}초, 전체:${totalTime}초)`);
      
      // 주의: 여기서 직접 상태를 업데이트하면 무한 렌더링이 발생합니다.
      // 전역 상태 업데이트는 useEffect에서 수행해야 합니다.
      
        return {
          clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
          transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: fillPercent // 백분율 값도 함께 반환
        };
      }
      
      // pumpProgressInfo가 없을 때만 operationTime 사용 (fallback)
      if (operationTime && operationTime > 0) {
        console.log(`펌프 ${tankId}의 진행 정보가 없어 operationTime 사용: ${operationTime}초`);
        
        // 현재 경과 시간 계산 (첫 메시지 시간부터 현재까지)
        const startTime = tankData?.tanks?.[tankId - 1]?.startTime || Date.now();
        const elapsedTime = (Date.now() - startTime) / 1000; // 초 단위
        
        // 가동 시간을 100%로 하여 경과 시간에 비례한 채움 비율 계산
      let fillPercent = Math.min((elapsedTime / operationTime) * 100, 100);
      // 최소 5%는 채워지도록 (시각적 피드백)
      fillPercent = Math.max(fillPercent, 5);
            
      console.log(`[대체 방식] 탱크 ${tankId} 채움률: ${fillPercent.toFixed(1)}%`);
              
              return {
                clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
                transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: fillPercent // 백분율 값도 함께 반환
              };
      }
      
    // 펌프가 켜져 있지만 진행 정보가 없는 경우 기본 채움 (시각적 피드백)
    if (pumpStatus === "ON") {
      console.log(`[기본 채움] 탱크 ${tankId}는 켜져 있지만 진행 정보 없음 - 10% 채움 적용`);
      
      return {
        clipPath: 'inset(90% 0 0 0)', // 기본 10% 채움
        transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: 10 // 백분율 값도 함께 반환
      };
    }
    
    // 그 외 경우(펌프 꺼져 있음)
    return { fillPercent: 0 };
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
      
      // 저장된 상태에서 설명 불러오기 시도
      const savedState = loadState();
      
      // 고정된 '본탱크수집' 지정을 피하고 저장된 값 또는 일반 값 사용
      let valveADesc = '전체순환'; // 기본값 '전체순환'으로 설정
      let valveBDesc = 'ON';       // 기본값 'ON'으로 설정
      
      // 저장된 상태에서 설명 가져오기 시도
      if (savedState?.valveADesc) {
        valveADesc = savedState.valveADesc;
        console.log('0100 케이스: 저장된 valveADesc 사용:', valveADesc);
      } else if (tankData.valveADesc) {
        valveADesc = tankData.valveADesc;
        console.log('0100 케이스: 현재 tankData.valveADesc 사용:', valveADesc);
      }
      
      if (savedState?.valveBDesc) {
        valveBDesc = savedState.valveBDesc;
      } else if (tankData.valveBDesc) {
        valveBDesc = tankData.valveBDesc;
      }
      
      console.log('0100 특수 케이스 최종 설명 텍스트:', valveADesc, valveBDesc);
      
      // localStorage에 밸브 상태와 함께 설명 저장
      saveState({
        ...tankData,
        valveADesc,
        valveBDesc
      });
      
      return {
        valve1: 0, // 밸브2 OFF (3way)
        valve2: 1, // 밸브1 ON (2way)
        valve1Desc: valveADesc,
        valve2Desc: valveBDesc
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
    // 기본값이 "0100"이 아닌 현재 상태 유지로 변경
    else nextState = tankData.valveState || "0000"; 
    
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

  // 추출 명령 중복 실행 방지를 위한 상태
  const [commandLock, setCommandLock] = useState<Record<string, boolean>>({});

  // 추출 제어 명령 발행 함수 (디바운싱 적용)
  const handleExtractionCommand = (command: string) => {
    if (!mqttClient || commandLock[command]) return;
    
    // 연속 클릭 방지를 위한 락 설정
    setCommandLock(prev => ({ ...prev, [command]: true }));
    
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
    
    // 일정 시간 후 락 해제 (500ms)
    setTimeout(() => {
      setCommandLock(prev => ({ ...prev, [command]: false }));
    }, 500);
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
        console.log('저장된 상태 로드 시도 - mqttClient 상태:', mqttClient ? '존재' : '없음');
        console.log('onValveChange 함수 상태:', onValveChange ? '존재' : '없음');
        
          // 서버 및 로컬 스토리지에서 상태 로드 시도
          const savedState = await loadInitialState();
          
          if (savedState) {
          console.log('저장된 상태를 복원합니다:', savedState);
            
            try {
            // 저장된 상태로 업데이트 로직
              if (savedState.valveState && onValveChange) {
              console.log('저장된 밸브 상태 복원 시도:', savedState.valveState);
              
              // 저장된 설명 로그 출력
              console.log('저장된 밸브 설명:', 
                savedState.valveADesc || '설명 없음', 
                savedState.valveBDesc || '설명 없음');
              
              // 특수 케이스 (0100)일 때 저장된 설명을 보존하기 위한 추가 처리
              if (savedState.valveState === '0100') {
                console.log('저장된 상태가 특수 케이스(0100)입니다. 설명 보존 처리 중...');
                
                // 저장된 밸브 상태 복원을 위해 onValveChange 호출
                onValveChange(savedState.valveState);
                
                // 설명을 유지하기 위해 현재 tankData를 업데이트
                if (savedState.valveADesc) {
                  // 다음 렌더링 사이클에서 tankData와 함께 전달될 수 있도록 
                  // 부모 컴포넌트에게 알리는 코드 (필요한 경우)
                  console.log('특수 케이스(0100)의 설명 보존:', savedState.valveADesc);
                }
              } else {
                // 일반 케이스 - 저장된 밸브 상태만 복원
                onValveChange(savedState.valveState);
              }
              
              // 디버깅을 위한 추가 로그
              setTimeout(() => {
                console.log('현재 UI에 표시된 밸브 상태:', tankData.valveState);
              }, 100);
              }
              
              // 필요한 경우 상태 업데이트를 MQTT로 브로드캐스트
            if (mqttClient?.connected) {
                mqttClient.publish('tank-system/state-loaded', JSON.stringify({
                  clientId: clientId.current,
                  timestamp: Date.now(),
                source: 'localStorage',
                valveState: savedState.valveState,
                descriptions: {
                  valveADesc: savedState.valveADesc,
                  valveBDesc: savedState.valveBDesc
                }
                }));
              }
            } catch (updateError) {
              console.error('상태 복원 중 오류 발생:', updateError);
          }
        }
      } catch (error) {
        console.error('상태 로드 중 예상치 못한 오류:', error);
      }
    };
    
    // 안전하게 초기화 함수 호출
    loadSavedState().catch(error => {
      console.error('상태 로드 프로세스 전체 실패:', error);
    });
  }, [mqttClient, onValveChange, tankData]); // tankData도 의존성 배열에 추가

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
          
          // extractionCommand 상태 초기화 (공정 계획 요약 초기화용)
          setExtractionCommand({
            timestamp: Date.now(),
            message: "준비중",
            rawJson: null,
            active: false
          });
          
          // 로컬 스토리지에도 비활성 상태로 저장
          localStorage.setItem('extractionCommandActive', 'false');
          
          // 공정 종료 알림 추가
          addNotification("공정이 종료되었습니다.", 'info');
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
        } else if (messageStr.includes("BLE만 연결됨") || messageStr.includes("BLE 환경으로 전환됨") || messageStr.includes("집단지성 네트워크")) {
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

        // Dashboard에서 설정된 connectionType 기반 상태 업데이트
        if (tankData?.tanks && tankData.tanks[pumpId - 1]) {
          const connectionType = tankData.tanks[pumpId - 1].connectionType;
          if (connectionType === "BLE") {
            setPumpConnectionStates(prev => ({
              ...prev,
              [pumpId]: { ...prev[pumpId], mqtt: false, ble: true }
            }));
          } else if (connectionType === "WiFi") {
            setPumpConnectionStates(prev => ({
              ...prev,
              [pumpId]: { ...prev[pumpId], mqtt: true, ble: false }
            }));
          }
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
  }, [mqttClient, tankData]);
  
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

  // 자동화 공정 진행 정보 상태
  const [automationProgress, setAutomationProgress] = useState<string | null>(null);
  const [currentSequenceInfo, setCurrentSequenceInfo] = useState<string | null>(null);
  const [nextSequenceInfo, setNextSequenceInfo] = useState<string | null>(null);
  const [sequenceStatsInfo, setSequenceStatsInfo] = useState<string | null>(null);

  // MQTT 구독 및 메시지 처리 - 자동화 공정 진행 정보 추가
  useEffect(() => {
    if (!mqttClient) return;
    
    const subscribeTankTopics = () => {
      // 기존 구독
      mqttClient.subscribe('extwork/+/state');
      mqttClient.subscribe('extwork/+/temp');
      mqttClient.subscribe('extwork/+/alert');
      mqttClient.subscribe('extwork/+/temp');
      mqttClient.subscribe('extwork/+/message');
      
      // 자동화 공정 관련 토픽 구독
      mqttClient.subscribe(AUTOMATION_STATUS_TOPIC); 
      mqttClient.subscribe(PROCESS_PROGRESS_TOPIC);
      
      console.log('MQTT 토픽 구독 완료');
    };
    
    // 연결 시 토픽 구독
    if (mqttClient.connected) {
      subscribeTankTopics();
    } else {
      mqttClient.on('connect', subscribeTankTopics);
    }
    
    // 메시지 처리 핸들러
    const handleMessage = (topic: string, message: Buffer) => {
      try {
        const messageStr = message.toString();
        
        // 기존 토픽 처리 로직...
        
        // 자동화 공정 상태 토픽 처리
        if (topic === AUTOMATION_STATUS_TOPIC) {
          try {
            const automationStatus = JSON.parse(messageStr);
            if (automationStatus.status === "sequence_started") {
              setAutomationProgress(`${automationStatus.sequenceName} 시퀀스 시작됨`);
            }
          } catch (error) {
            console.error('자동화 상태 메시지 파싱 오류:', error);
            // JSON 파싱 실패 시 원본 메시지 그대로 저장
            setAutomationProgress(messageStr);
          }
        }
        
        // 공정 진행 상태 토픽 처리
        if (topic === PROCESS_PROGRESS_TOPIC) {
          try {
            // 텍스트 메시지 처리 (현재 시퀀스 정보 파싱)
            if (messageStr.includes("현재 시퀀스:")) {
              setCurrentSequenceInfo(messageStr.split('\n')[0]?.trim() || null);
            }
            
            // 다음 시퀀스 정보 파싱
            if (messageStr.includes("다음 시퀀스:")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith("다음 시퀀스:")) {
                  setNextSequenceInfo(line.trim());
                  break;
                }
              }
            }
            
            // 시퀀스 통계 정보 파싱 (n개 완료 / n개 실행중 / n개 대기중 / n개 오류)
            if (messageStr.includes("개 완료") && messageStr.includes("개 실행중")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.includes("개 완료") && line.includes("개 실행중")) {
                  setSequenceStatsInfo(line.trim());
                  break;
                }
              }
            }
            
            // 전체 메시지를 자동화 진행 상태 표시에 저장
            setAutomationProgress(messageStr);
          } catch (error) {
            console.error('공정 진행 상태 메시지 파싱 오류:', error);
            setAutomationProgress(messageStr); // 오류 발생 시 원본 메시지 그대로 저장
          }
        }
        
        // ... 기존 토픽 처리 로직 계속
        
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

  // 자동화 공정 상태 관리 부분 업데이트
  const [automationProcessList, setAutomationProcessList] = useState<any[]>([]);
  const [currentAutomationProcess, setCurrentAutomationProcess] = useState<any>(null);

  // 자동화 공정 목록 및 진행 상태 가져오기
  useEffect(() => {
    // 자동화 공정 목록 가져오기
    const fetchAutomationProcesses = async () => {
      try {
        const response = await fetch('/api/automation');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            setAutomationProcessList(data.data);
            
            // 실행 중인 공정이 있는지 확인
            const runningProcess = data.data.find((p: any) => p.isRunning);
            if (runningProcess) {
              setCurrentAutomationProcess(runningProcess);
              
              // 자동화 공정 상태 업데이트
              const timeStr = formatTimeStr();
              setAutomationStatus(`공정 진행중: ${runningProcess.name} (${timeStr})`);
            }
          }
        }
      } catch (error) {
        console.error('자동화 공정 목록 가져오기 오류:', error);
      }
    };
    
    // 초기 로드 및 주기적 업데이트
    fetchAutomationProcesses();
    const intervalId = setInterval(fetchAutomationProcesses, 30000); // 30초마다 업데이트
    
    return () => clearInterval(intervalId);
  }, []);

  // 시스템 상태 정보 영역 렌더링 함수 (컴포넌트 렌더링 부분 근처에 추가)
  const renderSystemStatusInfo = () => {
    return (
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
          {(automationStatus || extractionCompleteMessage || currentAutomationProcess) && (
            <div className={`p-1 rounded text-[9px] border mb-1 overflow-x-auto whitespace-nowrap ${
              extractionCompleteMessage ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'
            }`}>
              <span className="font-semibold">자동화 공정:</span> {
                currentAutomationProcess ? 
                `${currentAutomationProcess.name} (${currentAutomationProcess.isRunning ? '실행중' : '대기중'})` : 
                (extractionCompleteMessage || automationStatus)
              }
            </div>
          )}
          
          {/* 자동화 작업 목록 표시 */}
          {automationProcessList.length > 0 && (
            <div className="bg-blue-50 p-1 rounded text-[9px] border border-blue-100 mb-1 overflow-x-auto">
              <span className="font-semibold">작업 목록:</span> {
                automationProcessList.slice(0, 3).map((process, index) => (
                  <span key={process.id} className={`${process.isRunning ? 'text-green-700 font-semibold' : ''}`}>
                    {process.name}{index < Math.min(automationProcessList.length, 3) - 1 ? ', ' : ''}
                  </span>
                ))
              }
              {automationProcessList.length > 3 ? ` 외 ${automationProcessList.length - 3}개` : ''}
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
    );
  }

  // 탱크별 중요 메시지 패턴 정의
  const getTankImportantMessagePattern = (tankId: number): RegExp => {
    if (tankId === 1) {
      // 1번 탱크용 중요 메시지 패턴
      return /(수위:5%이상|수위부족:5%미만|가득채워짐|채움가능)/;
    } else {
      // 2~6번 탱크용 중요 메시지 패턴
      return /(수위부족|수위정상|가득채워짐|정상수위)/;
    }
  };

  // 각 탱크 렌더링 - 물 채움 애니메이션을 포함한 탱크를 그립니다
  const renderTank = (tankId: number, x: number, y: number, label: string) => {
    const tankData1 = tankData?.tanks?.find(t => t.id === tankId);
    const status = tankData1?.status || "empty";
    const level = tankData1?.level || 0;
    const isPumpOn = tankData1?.pumpStatus === "ON";
    
    // 탱크 메시지 가져오기 - 모든 메시지 (텍스트 박스용)
    const tankMessage = tankData?.tankMessages?.[tankId];
    
    // 퀴즈 안전하게 operationTime 접근
    const operationTime = tankData1 ? (tankData1 as any).operationTime : undefined;
    
    // 펌프 상태 확인 및 채워진 비율 계산 (직접 계산)
    let fillPercent = 0;
    // 남은 반복 횟수 추적 (예: 1회 남음)
    let remainingRepeats = "";
    
    // 1. 펌프가 켜져 있는 경우에만 채움 애니메이션 표시
    if (isPumpOn) {
      // 2. 펌프 진행 정보 가져오기
      const pumpProgress = pumpProgressInfo[tankId];
      
      // 3. 진행 정보가 있으면 채움 비율 계산
      if (pumpProgress) {
        console.log(`[renderTank] 탱크 ${tankId} 진행 정보:`, pumpProgress);
        
        // 3.1 경과 시간과 남은 시간 파싱
        let elapsedTime = 0;
        let remainingTime = 0;
        
        // 경과 시간 추출 (숫자 또는 문자열+s 형식)
        if (pumpProgress.elapsed_time !== undefined) {
          if (typeof pumpProgress.elapsed_time === 'number') {
            elapsedTime = pumpProgress.elapsed_time;
          } else if (typeof pumpProgress.elapsed_time === 'string') {
            const match = String(pumpProgress.elapsed_time).match(/(\d+)/);
            if (match) {
              elapsedTime = parseInt(match[1], 10);
            }
          }
        }
        
        // 남은 시간 추출 (숫자 또는 문자열+s 형식)
        if (pumpProgress.remaining_time !== undefined) {
          if (typeof pumpProgress.remaining_time === 'number') {
            remainingTime = pumpProgress.remaining_time;
          } else if (typeof pumpProgress.remaining_time === 'string') {
            const match = String(pumpProgress.remaining_time).match(/(\d+)/);
            if (match) {
              remainingTime = parseInt(match[1], 10);
            }
          }
        }
        
        // 3.2 전체 시간 계산 (경과 시간 + 남은 시간)
        const totalTime = elapsedTime + remainingTime;
        
        // 3.3 진행률 계산 - 5%~95% 범위로 매핑
        if (totalTime > 0) {
          // 5%-95% 범위 내에서 애니메이션 (경과 시간 비율에 따라)
          fillPercent = 5 + (elapsedTime / totalTime) * 90;
          console.log(`[renderTank] 탱크 ${tankId} 채움률: ${fillPercent.toFixed(1)}% (${elapsedTime}s/${totalTime}s)`);
        } else {
          // 시간 정보가 없으면 기본값
          fillPercent = isPumpOn ? 10 : 0;
        }
        
        // 3.4 남은 반복 횟수 계산 (pump_id 파싱)
        if (pumpProgress.pump_id && typeof pumpProgress.pump_id === 'string') {
          const pumpMatch = pumpProgress.pump_id.match(/(\d+)\((\d+)\/(\d+)\)/);
          if (pumpMatch) {
            const currentRepeat = parseInt(pumpMatch[2], 10);
            const totalRepeat = parseInt(pumpMatch[3], 10);
            const repeatsLeft = totalRepeat - currentRepeat;
            
            if (repeatsLeft > 0) {
              remainingRepeats = `${repeatsLeft}회 남음`;
            } else {
              remainingRepeats = "완료";
            }
            
            console.log(`[renderTank] 탱크 ${tankId} 남은 반복: ${remainingRepeats}`);
          }
        } else if (pumpProgress.total_repeats !== undefined && pumpProgress.current_repeat !== undefined) {
          // 진행 정보에서 직접 반복 횟수 확인
          const repeatsLeft = pumpProgress.total_repeats - pumpProgress.current_repeat;
          if (repeatsLeft > 0) {
            remainingRepeats = `${repeatsLeft}회 남음`;
          } else {
            remainingRepeats = "완료";
          }
        }
      } else {
        // 진행 정보가 없으면 기본값 (로컬 스토리지에서 가져오기 시도)
        const savedFillPercent = localStorage.getItem(`pump_${tankId}_fill_percent`);
        
        if (savedFillPercent) {
          fillPercent = parseFloat(savedFillPercent);
        } else if (tankId === 4) {
          // 4번 탱크가 10%에서 멈춰있는 문제 해결 - 진행률이 없는 경우 계산
          fillPercent = 44; // 진행 상태에 표시된 값과 동일하게 설정
        } else {
          // 다른 펌프는 기본값 10% 설정
          fillPercent = 10;
        }
      }
      
      // 최소 5%, 최대 95%로 제한 (애니메이션 범위)
      fillPercent = Math.max(5, Math.min(fillPercent, 95));
    }
    
    // 실제 채움 스타일 객체 생성
    const fillingStyle = isPumpOn ? {
      clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
      transition: 'clip-path 1s linear',
      backgroundColor: 'rgba(59, 130, 246, 0.3)'
    } : {};
    
    // 채움 스타일 디버깅 로그
    if (isPumpOn) {
      console.log(`[renderTank] 탱크 ${tankId} 채움 스타일:`, fillingStyle);
    }
    
    // 채움 스타일이 있는지 확인 (empty object가 아닌지)
    const hasFilling = fillingStyle && Object.keys(fillingStyle).length > 0;
    
    // 중요 메시지만 정확히 식별하는 함수
    const isImportantStatusMessage = (msg: string | undefined, tankId: number): boolean => {
      if (!msg) return false;
      
      // 1번 탱크와 나머지 탱크를 구분
      if (tankId === 1) {
        return (
          msg.includes("수위:5%이상") || 
          msg.includes("수위부족:5%미만") || 
          msg.includes("가득채워짐") ||
          msg.includes("채움가능")
        );
      } else {
        return (
          msg.includes("수위부족") || 
          msg.includes("수위정상") || 
          msg.includes("가득채워짐") || 
          msg.includes("정상수위")
        );
      }
    };
    
    // 중요 메시지 패턴 가져오기 함수
    const getTankImportantMessagePattern = (tankId: number) => {
      // 1번 탱크용 중요 메시지 패턴
      if (tankId === 1) {
        return /(수위:\d+%이상|수위부족:\d+%미만|가득채워짐|채움가능)/;
      }
      
      // 2~6번 탱크용 중요 메시지 패턴
      return /(수위부족|수위정상|가득채워짐|정상수위)/;
    };
    
    // 탱크 내부에 표시할 상태 텍스트 결정
    const getStatusText = () => {
      // 탱크 메시지가 있고, 중요 상태 메시지인 경우만 탱크 내부에 표시
      if (tankMessage && isImportantStatusMessage(tankMessage, tankId)) {
        // 중요 메시지에서 시간 정보 제거하고 표시
        const pattern = getTankImportantMessagePattern(tankId);
        const baseMsgMatch = tankMessage.match(pattern);
        return baseMsgMatch ? baseMsgMatch[0] : tankMessage;
      }
      
      // localStorage에 저장된 중요 메시지가 있는지 확인
      const storedImportantMessage = localStorage.getItem(`tank_${tankId}_important_message`);
      if (storedImportantMessage && isImportantStatusMessage(storedImportantMessage, tankId)) {
        // 저장된 중요 메시지에서 시간 정보 제거하고 표시
        const pattern = getTankImportantMessagePattern(tankId);
        const baseMsgMatch = storedImportantMessage.match(pattern);
        return baseMsgMatch ? baseMsgMatch[0] : storedImportantMessage;
      }
      
      // 중요 메시지가 없으면 기본 상태 메시지 반환
      const tankStatus = tankData1?.status || "empty";
      const tankLevel = tankData1?.level || 0;
      return getStatusMessage(tankStatus, tankLevel);
    };
    
    return (
      <g key={`tank-${tankId}`} id={`tank-${tankId}`}>
        {/* 탱크 본체 */}
        <rect
          x={x - tankWidth / 2}
          y={y - tankHeight / 2}
          width={tankWidth}
          height={tankHeight}
          rx="5"
          className={getTankColor(status, tankId)}
        />
        
        {/* 채워지는 애니메이션을 위한 오버레이 - 펌프가 켜져 있을 때만 적용 */}
        {isPumpOn && (
          <rect
            x={x - tankWidth / 2}
            y={y - tankHeight / 2}
            width={tankWidth}
            height={tankHeight}
            rx="5"
            className="fill-blue-500/30"
            style={fillingStyle}
          />
        )}
        
        {/* 탱크 라벨 - 글자 크기 15% 키움 */}
        <text x={x} y={y} textAnchor="middle" className="text-[1.15rem] font-bold fill-black">
          {label}
        </text>
        
        {/* 상태 메시지 - 중요 상태 메시지만 표시 */}
        <text x={x} y={y + 25} textAnchor="middle" className="text-[12.1px] fill-gray-700">
          {getStatusText()}
        </text>
        
        {/* 펌프 상태가 ON일 때 남은 반복 횟수만 표시 (퍼센트 제거) */}
        {isPumpOn && remainingRepeats && (
          <text x={x} y={y + 45} textAnchor="middle" className="text-[12px] fill-blue-700 font-bold">
            {remainingRepeats}
          </text>
        )}
      </g>
    );
  };

  // 메인 탱크 레벨 메시지 처리 함수 개선
  const handleMainTankLevelMessage = (messageStr: string) => {
    console.log(`본 탱크 레벨 메시지 수신: ${messageStr}`);
    
    // 항상 메시지를 바로 저장 - 화면에 표시할 메시지 업데이트
    setMainTankMessage(messageStr);
    console.log(`본 탱크 메시지 설정됨: ${messageStr}`);
    
    // 메시지에 따라 레벨 설정 (애니메이션을 위한 레벨 업데이트)
    let newLevel = tankData?.mainTank?.level || 0;
    
    // 특정 메시지에 따라 레벨 설정
    if (messageStr === "50%이상 채워짐") {
      newLevel = 60; // 60% 채움
      console.log("본 탱크 레벨: 60%로 설정(50%이상 채워짐)");
    } else if (messageStr === "50%이하 비워짐") {
      newLevel = 20; // 20% 채움
      console.log("본 탱크 레벨: 20%로 설정(50%이하 비워짐)");
    }
    
    // 레벨 업데이트 - 로컬 상태만 변경하고 저장
    if (tankData && tankData.mainTank) {
      // 업데이트할 데이터 준비
      const updatedTankData = {
        ...tankData,
        mainTank: {
          ...tankData.mainTank,
          level: newLevel
        }
      };
      
      // 로컬 스토리지에 저장
      saveState(updatedTankData);
      console.log(`본 탱크 레벨 저장됨: ${newLevel}%`);
    }
  };

  // MQTT 메시지 처리 부분에서 본 탱크 메시지 처리 로직 개선
  useEffect(() => {
    if (!mqttClient) return;
    
    // 토픽 구독 함수
    const subscribeTankTopics = () => {
      console.log('Tank System MQTT 토픽 구독 시작');
      
      // 1. 제어 인터페이스 토픽 구독
      mqttClient.subscribe('tank-system/notifications');
      
      // 2. 본 탱크 수위 토픽 구독
      mqttClient.subscribe('extwork/tankMain/level');
      console.log('> 본 탱크 수위 토픽 구독: extwork/tankMain/level');
      
      // 3. 추출 명령 토픽 구독
      mqttClient.subscribe('extwork/extraction/input');
      
      // 4. 인버터 펌프 상태 토픽 구독
      for (let i = 1; i <= 6; i++) {
        mqttClient.subscribe(`extwork/inverter${i}/state`);
        console.log(`> 인버터 펌프 상태 토픽 구독: extwork/inverter${i}/state`);
      }
      
      // 5. 탱크 수위 토픽 구독
      for (let i = 1; i <= 6; i++) {
        for (let j = 1; j <= 6; j++) {
          mqttClient.subscribe(`extwork/inverter${i}/tank${j}_level`);
          console.log(`> 탱크 수위 토픽 구독: extwork/inverter${i}/tank${j}_level`);
        }
      }
      
      console.log('모든 MQTT 토픽 구독 완료');
    };
    
    // 메시지 처리 함수
    const handleMessage = (topic: string, message: Buffer) => {
      try {
        const messageStr = message.toString();
        
        // 본 탱크 수위 토픽 처리 - 특별히 우선 처리
        if (topic === 'extwork/tankMain/level') {
          console.log(`본 탱크 수위 메시지 수신: ${messageStr}`);
          
          // 메시지 상태 업데이트 (화면에 표시될 메시지)
          setMainTankMessage(messageStr);
          
          // 메시지에 따라 레벨 설정
          let newLevel = tankData?.mainTank?.level || 0;
          
          if (messageStr === "50%이상 채워짐") {
            newLevel = 60; // 60% 채움
            console.log("본 탱크 레벨: 60%로 설정됨");
          } else if (messageStr === "50%이하 비워짐") {
            newLevel = 20; // 20% 채움
            console.log("본 탱크 레벨: 20%로 설정됨");
          }
          
          // 상태 저장
          if (tankData && tankData.mainTank) {
            // 현재 탱크 데이터 복사
            const updatedTankData = {
              ...tankData,
              mainTank: {
                ...tankData.mainTank,
                level: newLevel
              }
            };
            
            // 상태 저장 - IndexedDB에 저장
            saveState(updatedTankData);
            console.log(`본 탱크 레벨 저장됨: ${newLevel}%`);
          }
        }
        // 다른 토픽 처리 계속...
      } catch (error) {
        console.error('메시지 처리 오류:', error);
      }
    };
    
    // 연결 시 토픽 구독
    mqttClient.on('connect', subscribeTankTopics);
    
    // 메시지 수신 이벤트 리스너 등록
    mqttClient.on('message', handleMessage);
    
    // 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      mqttClient.off('message', handleMessage);
      mqttClient.off('connect', subscribeTankTopics);
    };
  }, [mqttClient, tankData, setMainTankMessage]);

  // 펌프별 진행 상태 추적을 위한 useEffect 추가
  useEffect(() => {
    // 활성화된 펌프가 있는지 확인
    const activePump = Object.entries(pumpProgressInfo).find(([_, progress]) => 
      progress && (progress.elapsed_time !== undefined || progress.remaining_time !== undefined)
    );
    
    if (activePump) {
      const [pumpId, progress] = activePump;
      
      // 진행률 계산을 위한 데이터 추출
      let elapsedTime = 0;
      let totalTime = 0;
      
      // elapsed_time 값 추출
      if (progress.elapsed_time !== undefined) {
        if (typeof progress.elapsed_time === 'number') {
          elapsedTime = progress.elapsed_time;
        } else if (typeof progress.elapsed_time === 'string') {
          const matchElapsed = String(progress.elapsed_time).match(/(\d+)/);
          if (matchElapsed) {
            elapsedTime = parseInt(matchElapsed[1], 10);
          }
        }
      }
      
      // remaining_time 값 추출
      if (progress.remaining_time !== undefined) {
        if (typeof progress.remaining_time === 'number') {
          totalTime = elapsedTime + progress.remaining_time;
        } else if (typeof progress.remaining_time === 'string') {
          const matchRemaining = String(progress.remaining_time).match(/(\d+)/);
          if (matchRemaining) {
            totalTime = elapsedTime + parseInt(matchRemaining[1], 10);
          }
        }
      }
      
      // 데이터가 유효하면 진행률 계산
      if (totalTime > 0) {
        let fillPercent = Math.min((elapsedTime / totalTime) * 100, 100);
        fillPercent = Math.max(fillPercent, 5); // 최소 5% 보장
        
        // fillPercentage 상태 업데이트 (안전하게 useEffect 내에서)
        setFillPercentage(fillPercent);
        console.log(`[useEffect] 전역 fillPercentage 업데이트: ${fillPercent.toFixed(1)}%`);
      }
    }
    
    // 클린업 함수 - 필요한 경우 여기에 로직 추가
    return () => {
      // 필요한 경우 클린업 로직
    };
  }, [pumpProgressInfo]); // pumpProgressInfo가 변경될 때만 실행

  useEffect(() => {
    if (!mqttClient) {
      // MQTT 클라이언트 연결 안 된 상태
      console.log('MQTT 클라이언트가 연결되지 않았습니다. 초기 상태로 설정합니다.');
      
      // 초기 탱크 메시지 설정 - "준비중"으로 설정하고 localStorage에 저장된 이전 메시지 복원
      setTankMessages(prev => {
        const initialMessages = { ...prev };
        
        // 모든 탱크 메시지를 "준비중"으로 초기화
        for (let i = 1; i <= 6; i++) {
          // localStorage에서 저장된 메시지 확인
          const savedMessage = localStorage.getItem(`tank_${i}_message`);
          
          if (savedMessage) {
            // 저장된 메시지가 있으면 사용
            initialMessages[i] = savedMessage;
            console.log(`탱크 ${i} 메시지 복원: "${savedMessage}"`);
          } else {
            // 저장된 메시지가 없으면 "준비중"으로 설정
            initialMessages[i] = "준비중";
            console.log(`탱크 ${i} 메시지 초기화: "준비중"`);
          }
        }
        
        return initialMessages;
      });
    }
  }, [mqttClient]);

  // MQTT 클라이언트 연결 상태 변경 시 실행
  useEffect(() => {
    // ... existing code ...
  }, [mqttClient?.connected]);

  // 탱크 구독 설정
  useEffect(() => {
    if (!mqttClient?.connected || !tankData?.tanks) return;
    
    // 자동 공급 상태 구독
    // ... existing code ...
  }, [mqttClient?.connected, tankData?.tanks]);

  // 별도의 추출 명령 상태 추가 (컴포넌트 최상단 상태 부분에 추가)
  const [extractionCommand, setExtractionCommand] = useState<{
    timestamp: number;
    message: string;
    rawJson: string | null;
    active: boolean;
  } | null>(null);

  // 공정 상태 감지를 위한 useEffect 추가 (컴포넌트에 새로운 useEffect 추가)
  useEffect(() => {
    // 공정 상태 확인 로직 (예: 모든 펌프가 OFF 상태인지)
    const allPumpsOff = tankData?.tanks?.every(tank => tank.pumpStatus === "OFF");
    
    // 이전에 활성화된 명령이 있었고, 지금은 모든 펌프가 꺼져있다면 공정 완료로 판단
    if (extractionCommand?.active && allPumpsOff) {
      console.log('공정 완료 감지: 추출 명령 비활성화');
      
      // 비활성 상태로 업데이트 - 로컬에만 저장하고 서버에는 전송하지 않음
      setExtractionCommand(prev => prev ? {...prev, active: false} : null);
      
      // 로컬 스토리지 업데이트
      localStorage.setItem('extractionCommandActive', 'false');
    }
  }, [tankData?.tanks, extractionCommand?.active]);

  // 컴포넌트 마운트 시 이전 명령 복원하는 useEffect 추가
  useEffect(() => {
    const storedCommand = localStorage.getItem('lastExtractionCommand');
    const storedTimestamp = localStorage.getItem('lastExtractionTimestamp');
    const isActive = localStorage.getItem('extractionCommandActive') === 'true';
    
    if (storedCommand && storedTimestamp) {
      try {
        setExtractionCommand({
          timestamp: parseInt(storedTimestamp, 10),
          message: `이전 공정 명령 (${new Date(parseInt(storedTimestamp, 10)).toLocaleString()})`,
          rawJson: storedCommand,
          active: isActive
        });
      } catch (error) {
        console.error('저장된 명령 복원 중 오류:', error);
      }
    }
  }, []);

  // 약 320줄 근처, 컴포넌트 함수 내 상단에 추가
  useEffect(() => {
    // 컴포넌트 마운트 즉시 저장된 상태 확인
    const savedState = loadState();
    console.log('컴포넌트 마운트 - 저장된 상태:', savedState);
    
    if (savedState && savedState.valveState && onValveChange) {
      console.log('초기 마운트 시 밸브 상태 복원:', savedState.valveState);
      onValveChange(savedState.valveState);
    }
  }, []); // 빈 의존성 배열로 컴포넌트 마운트 시 한 번만 실행

  // 컴포넌트 마운트 시 독립적으로 저장된 밸브 상태 확인 및 적용
  useEffect(() => {
    // 컴포넌트 마운트 즉시 독립적으로 저장된 상태 확인
    const savedState = loadState();
    console.log('컴포넌트 초기 마운트 - 저장된 상태:', savedState);
    
    if (savedState && savedState.valveState && onValveChange) {
      console.log('초기 마운트 시 직접 밸브 상태 설정:', savedState.valveState);
      // 직접 상태 업데이트
      onValveChange(savedState.valveState);
    }
  }, [onValveChange]); // onValveChange가 변경될 때마다 실행

  return (
    <div className="relative w-full h-[950px] bg-white rounded-lg shadow-sm overflow-hidden border border-gray-100">
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
      
      {/* 상태 변경 알림 UI는 제거하고 아래에 다시 추가 */}
      
      {/* 모니터링 컨텐츠 컨테이너 */}
      <div className="flex h-[calc(100%-32px)]">
        {/* 메인 모니터링 영역 - 비율을 60%에서 55%로 조정 */}
        <div className="w-[55%] border-r border-gray-200 p-0 pl-1 pr-1">
          {/* SVG 컨테이너 - 박스로 감싸기 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-0 mb-0 h-[850px] flex flex-col">
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
                {/* 전체 컨텐츠를 탱크 시스템 모니터링 상자 안으로 이동 - 크기 추가 증가 및 위치 조정 */}
                <g transform="translate(-260, -140) scale(1.33)">
          {/* 본탱크 - 너비 확대, 높이 감소 */}
          <rect
            x={mainTankPosition.x - mainTankPosition.width / 2}
            y={mainTankPosition.y - mainTankPosition.height / 2}
            width={mainTankPosition.width}
            height={mainTankPosition.height}
            rx="10"
            className={`${valve1 === 0 && isPipeActive(5) ? "fill-white stroke-yellow-400 stroke-[3]" : getTankColor(tankData?.mainTank?.status, 0)}`}
          />
          
          {/* 채워지는 애니메이션을 위한 오버레이 - 펌프가 ON이거나 filling 상태일 때 적용 */}
          {(tankData?.mainTank?.status === "filling" || valve2 === 1) && (
            <rect
              x={mainTankPosition.x - mainTankPosition.width / 2}
              y={mainTankPosition.y - mainTankPosition.height / 2}
              width={mainTankPosition.width}
              height={mainTankPosition.height}
              rx="10"
              className="fill-amber-200/30"
              style={getFillingStyle(tankData?.mainTank?.status || 'empty', 0)}
            />
          )}
          <text x={mainTankPosition.x} y={mainTankPosition.y} textAnchor="middle" className="text-xl font-bold fill-black">
            {mainTankPosition.label}
          </text>
          
          {/* 본탱크 상태 메시지 텍스트 */}
          <text 
            x={mainTankPosition.x} 
            y={mainTankPosition.y + 30} 
            textAnchor="middle" 
            className="text-[14px] font-semibold fill-blue-700"
          >
            {mainTankMessage || getStatusMessage(tankData?.mainTank?.status, tankData?.mainTank?.level, 0)}
          </text>

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
                {renderTank(tankId, position.x, position.y, position.label)}
                
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
                      className={`h-full flex items-center justify-center px-2 text-center ${tankMessage ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
                      style={{ fontSize: '8px', lineHeight: '1', paddingTop: '4px' }}
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
        <div className="w-[45%] p-2 flex flex-col space-y-2">
          {/* 현재 상태 및 진행 정보 */}
          {renderSystemStatusInfo()}
        
          {/* 추가 정보 박스 1 - 탱크 요약 정보를 공정 진행 요약 정보로 변경 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-2">
            <div className="bg-blue-50 py-1 px-2 text-xs font-semibold text-blue-700 rounded-t-lg border-b border-gray-200 flex justify-between items-center">
              <span>공정 진행 계획 요약</span>
              {progressMessages.filter(msg => 
                msg.rawJson && 
                msg.rawJson.trim().startsWith('{')
              ).length > 0 && (
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[9px] font-bold animate-pulse">
                  활성
                </span>
              )}
            </div>
            <div className="p-2 text-xs">
              {/* 공정 계획 정보 표시 */}
              <div className="space-y-2">
                {false ? ( // processRunning 상태에 관계없이 항상 내용 표시
                  <div className="bg-gray-50 p-2 rounded border border-gray-100 text-center">
                    <span className="font-medium text-gray-500">준비중</span>
                  </div>
                ) : (
                  progressMessages.filter(msg => 
                    msg.rawJson && 
                    msg.rawJson.trim().startsWith('{')
                  ).slice(0, 1).map((msg, idx) => {
                    try {
                      // 유효성 검사 추가
                      if (!msg.rawJson || msg.rawJson.trim() === '') {
                        throw new Error("JSON 데이터가 없습니다");
                      }
                      
                      // 'next' 또는 유효하지 않은 형식의 문자열 필터링
                      if (msg.rawJson.trim() === 'next' || !msg.rawJson.trim().startsWith('{')) {
                        throw new Error(`유효하지 않은 JSON 형식: ${msg.rawJson.substring(0, 20)}`);
                      }
                      
                      // JSON 파싱 시도
                    const jsonData = msg.rawJson ? JSON.parse(msg.rawJson) : null;
                    
                    // 복합 명령어 처리 (sequences 배열이 있는 경우)
                    if (jsonData?.sequences && Array.isArray(jsonData.sequences)) {
                      return (
                        <div key={`process-plan-${idx}`} className="bg-gray-50 p-2 rounded border border-gray-100">
                          <div className="mb-2 font-semibold text-blue-700 border-b border-blue-100 pb-1">복합 공정 계획</div>
                          
                          {jsonData.sequences.map((seq, seqIdx) => (
                            <div key={`seq-${seqIdx}`} className="mb-2 p-1.5 bg-white rounded border border-gray-100">
                  <div className="flex justify-between items-center mb-1">
                                <span className="font-semibold text-blue-700">시퀀스 {seqIdx + 1}:</span>
                                <span className="text-[9px] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                  {seq.operation_mode ? `모드: ${seq.operation_mode}` : ''}
                                </span>
                  </div>
                              
                                {/* 추가 정보 표시 */}
                                <div className="grid grid-cols-2 gap-1 text-[9px]">
                              {seq.repeats !== undefined && (
                                    <div>
                                      <span className="font-semibold text-blue-700">반복:</span>{" "}
                                      <span className="bg-blue-50 px-1 py-0.5 rounded border border-blue-100">{seq.repeats}회</span>
                  </div>
                              )}
                              
                                  {seq.wait_time !== undefined && (
                                    <div>
                                      <span className="font-semibold text-blue-700">대기:</span>{" "}
                                      <span className="bg-blue-50 px-1 py-0.5 rounded border border-blue-100">{seq.wait_time}초</span>
                                </div>
                              )}
                            </div>
                        </div>
                            ))}
                            
                            {/* 선택된 펌프 표시 */}
                            {jsonData.selectedPumps && Array.isArray(jsonData.selectedPumps) && (
                              <div className="mt-2">
                                <div className="font-semibold text-blue-700 mb-1">선택된 펌프:</div>
                                <div className="flex flex-wrap gap-1">
                                  {jsonData.selectedPumps.map((selected, i) => {
                                    const pumpId = selected ? (i + 1) : null;
                                if (!pumpId) return null;
                                return (
                                  <span key={i} className="bg-green-50 text-green-700 text-[9px] px-1.5 py-0.5 rounded border border-green-100">
                                    {pumpId}
                            </span>
                                );
                              }).filter(Boolean)}
                            </div>
                  </div>
                        )}
                        {jsonData?.estimated_completion_time && (
                          <div className="mb-1 flex justify-between items-center">
                            <span className="font-semibold text-blue-700">예상 종료:</span>{" "}
                            <span className="bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 text-indigo-700">{jsonData.estimated_completion_time}</span>
                </div>
                        )}
                          </div>
                        );
                      }
                      
                      // 단일 명령어 처리 (기존 방식 유지)
                      return (
                        <div key={`process-plan-${idx}`} className="bg-gray-50 p-2 rounded border border-gray-100">
                          <div className="mb-2 font-semibold text-blue-700 border-b border-blue-100 pb-1">단일 공정 계획</div>
                          <div className="grid grid-cols-2 gap-1 text-[9px]">
                            {jsonData.name && (
                              <div className="col-span-2">
                                <span className="font-semibold text-blue-700">이름:</span>{" "}
                                <span className="font-medium">{jsonData.name}</span>
                              </div>
                            )}
                            {jsonData.repeats !== undefined && (
                              <div>
                                <span className="font-semibold text-blue-700">반복:</span>{" "}
                                <span className="bg-blue-50 px-1 py-0.5 rounded border border-blue-100">{jsonData.repeats}회</span>
                              </div>
                            )}
                            {jsonData.operation_mode !== undefined && (
                              <div>
                                <span className="font-semibold text-blue-700">모드:</span>{" "}
                                <span className="bg-blue-50 px-1 py-0.5 rounded border border-blue-100">{jsonData.operation_mode}</span>
                              </div>
                            )}
                          </div>
              </div>
                    );
                  } catch (error) {
                      console.error('JSON 파싱 오류:', error, msg.rawJson);
                    return (
                        <div className="text-red-500 bg-red-50 p-2 rounded border border-red-200">
                        공정 명령 처리 중 오류가 발생했습니다.
                          <div className="text-[9px] mt-1">오류: {error.message}</div>
                          <div className="text-[8px] mt-1 text-gray-500 truncate">
                            {msg.rawJson ? `원본: ${msg.rawJson.substring(0, 30)}${msg.rawJson.length > 30 ? '...' : ''}` : '데이터 없음'}
                          </div>
                      </div>
                    );
                  }
                  })
                )}
                {processRunning && progressMessages.filter(msg => 
                    msg.rawJson && 
                    msg.rawJson.trim().startsWith('{') && 
                    !msg.rawJson.includes("process_info") && 
                    !msg.rawJson.includes("extwork/extraction/progress")
                  ).length === 0 && (
                  <div className="bg-gray-50 p-2 rounded border border-gray-100 text-center">
                    <span className="font-medium text-gray-500">데이터 없음</span>
                </div>
              )}
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
                {progressMessages.filter(msg => 
                  msg.rawJson && 
                  typeof msg.rawJson === 'string' && 
                  msg.rawJson.trim().startsWith('{') && 
                  (msg.rawJson.includes("process_info") || msg.rawJson.includes("extwork/extraction/progress"))
                ).slice(0, 1).map((msg, idx) => (
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
                              // 유효성 검사 추가
                              if (!msg.rawJson || msg.rawJson.trim() === '') {
                                return (
                                  <div className="col-span-2 text-amber-600">
                                    비어있는 데이터
                                  </div>
                                );
                              }
                              
                              // 'next'와 같은 유효하지 않은 문자열 검사
                              if (msg.rawJson.trim() === 'next' || !msg.rawJson.trim().startsWith('{')) {
                                return (
                                  <div className="col-span-2 text-amber-600">
                                    형식이 올바르지 않은 데이터: {msg.rawJson}
                                  </div>
                                );
                              }
                              
                              // 텍스트 메시지인 경우 처리
                              if (msg.rawJson.includes("현재 밸브 상태") || 
                                  !msg.rawJson.trim().startsWith('{')) {
                                return (
                                  <div className="col-span-2">
                                    <span className="font-semibold text-green-700">메시지:</span>{" "}
                                    <span className="font-medium">{msg.rawJson}</span>
                                  </div>
                                );
                              }
                              
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
                            )}
                                  {jsonData.remaining_time && (
                              <div>
                                <span className="font-semibold text-green-700">남은:</span>{" "}
                                    <span className="font-medium">{jsonData.remaining_time}</span>
                              </div>
                            )}
                                  {jsonData.total_remaining && (
                              <div>
                                <span className="font-semibold text-green-700">총남은:</span>{" "}
                                    <span className="font-medium">{jsonData.total_remaining}</span>
                              </div>
                            )}
                                  {jsonData.total_time && (
                              <div>
                                <span className="font-semibold text-green-700">총시간:</span>{" "}
                                    <span className="font-medium">{jsonData.total_time}</span>
                              </div>
                            )}
                                </>
                              );
                              } catch (jsonParseError) {
                                console.error("JSON 파싱 내부 오류:", jsonParseError);
                                return (
                                  <div className="col-span-2">
                                    <span className="font-semibold text-red-500">파싱 오류:</span>{" "}
                                    <span className="font-medium">{msg.rawJson}</span>
                                  </div>
                                );
                              }
                            } catch (error) {
                              console.error("JSON 파싱 오류:", error, "데이터:", msg.rawJson?.substring(0, 50));
                              return (
                                <div className="col-span-2 text-red-500">
                                  JSON 파싱 오류: {error.message}
                                  <div className="mt-1 text-gray-500 text-[8px] truncate">
                                    {msg.rawJson ? `${msg.rawJson.substring(0, 40)}${msg.rawJson.length > 40 ? '...' : ''}` : '데이터 없음'}
                                  </div>
                                </div>
                              );
                            }
                          })()}
                          </div>
                        </div>
                      )}
                            </div>
                ))}
                {progressMessages.filter(msg => msg.rawJson).length === 0 && (
                  <div className="text-gray-500 text-[10px] italic p-2 text-center">
                    데이터가 없습니다
                  </div>
                )}
              </div>
                
                {/* 채움 비율 진행 바 - 애니메이션 적용 */}
                <div className="mb-2 mt-3 pt-2 border-t border-gray-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold">진행 상태:</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      fillPercentage >= 90 ? 'bg-green-100 text-green-800' :
                      fillPercentage >= 60 ? 'bg-blue-100 text-blue-800' :
                      fillPercentage >= 30 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {(() => {
                        try {
                          // 최신 JSON 데이터에서 repetition 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (latestJsonMsg && latestJsonMsg.rawJson) {
                          // JSON 형식 검증 추가
                          const rawJson = latestJsonMsg.rawJson.trim();
                          if (rawJson.startsWith('{') && rawJson.endsWith('}') && !rawJson.includes("현재 밸브 상태")) {
                            const jsonData = JSON.parse(rawJson);
                            if (jsonData.repetition_count && jsonData.repetition) {
                              return `${jsonData.repetition_count - jsonData.repetition}회 남음`;
                            }
                          } else {
                            // JSON이 아닌 경우 기본값 사용
                            console.log('비 JSON 형식 메시지 무시:', rawJson.substring(0, 30));
                            }
                          }
                        } catch (e) {
                          console.error('Repetition parsing error:', e);
                        }
                        return `${Math.floor(fillPercentage)}%`;
                      })()}
                    </span>
                  </div>
                  
                  {/* 원형 그래프 추가 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-16 h-16 relative">
                      <svg viewBox="0 0 36 36" className="w-full h-full">
                        {/* 배경 원 */}
                        <circle 
                          cx="18" 
                          cy="18" 
                          r="15.9" 
                          fill="none" 
                          stroke="#eeeeee" 
                          strokeWidth="3"
                        />
                        
                        {/* 진행 원 */}
                        {(() => {
                          // 기본값 대신 동적 진행률 계산
                          let percent = 0;

                          // 최신 JSON 데이터에서 진행 정보 찾기
                          try {
                            const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                            if (latestJsonMsg && latestJsonMsg.rawJson) {
                            // JSON 형식 검증 추가
                            const rawJson = latestJsonMsg.rawJson.trim();
                            if (rawJson.startsWith('{') && rawJson.endsWith('}') && !rawJson.includes("현재 밸브 상태")) {
                              const jsonData = JSON.parse(rawJson);
                              // process_time과 total_remaining으로 진행률 계산
                              if (jsonData.process_time && jsonData.total_remaining) {
                                const totalTime = parseInt(String(jsonData.process_time).match(/(\d+)/)?.[1] || "0", 10);
                                const totalRemaining = parseInt(String(jsonData.total_remaining).match(/(\d+)/)?.[1] || "0", 10);
                                
                                if (totalTime > 0 && totalRemaining >= 0) {
                                  // 진행률 계산 = (전체 시간 - 남은 시간) / 전체 시간 * 100
                                  percent = Math.min(100, Math.max(0, Math.floor(100 - (totalRemaining / totalTime * 100))));
                                }
                              }
                            } else {
                              // JSON이 아닌 경우 로그만 남기고 기본값 사용
                              console.log('비 JSON 형식 메시지 진행 정보 무시:', rawJson.substring(0, 30));
                              }
                            }
                          } catch (e) {
                            console.error('Progress calculation error:', e);
                          // 에러 발생 시 기본값 유지
                          }
                          
                          return (
                            <>
                              {/* 배경 원 - 완전한 원으로 백그라운드 표시 */}
                              <circle 
                                cx="18" 
                                cy="18" 
                                r="15.9" 
                                fill="none" 
                                stroke="#eeeeee" 
                                strokeWidth="3"
                              />
                              
                              {/* 진행 원 - 시작 위치를 12시 방향(맨 위)으로 설정하고 시계 방향으로 진행 */}
                              <circle 
                                cx="18" 
                                cy="18" 
                                r="15.9" 
                                fill="none" 
                                stroke={percent >= 90 ? '#22c55e' : percent >= 60 ? '#3b82f6' : percent >= 30 ? '#eab308' : '#6b7280'} 
                                strokeWidth="3" 
                                strokeDasharray={`${2 * Math.PI * 15.9 * percent / 100}, ${2 * Math.PI * 15.9}`} 
                                strokeDashoffset="0" 
                                strokeLinecap="round" 
                                transform="rotate(-90, 18, 18)"
                                className="transition-all duration-1000"
                              />
                              
                              {/* 가운데 텍스트 */}
                              <text 
                                x="18" 
                                y="18.5" 
                                textAnchor="middle" 
                                fontSize="10" 
                                fontWeight="bold" 
                                fill={percent >= 90 ? '#22c55e' : percent >= 60 ? '#3b82f6' : percent >= 30 ? '#eab308' : '#6b7280'}
                              >
                                {percent > 0 ? `${percent}%` : "대기중"}
                              </text>
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                    
                    {/* 진행 상태 바를 개별로 분리하여 표시 */}
                    <div className="space-y-1.5 flex-1 ml-2">
                      {/* 현재 작업 진행률 바 - 대기중에도 항상 표시 */}
                      {(() => {
                        try {
                          // 최신 JSON 데이터에서 펌프 진행 정보 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (latestJsonMsg && latestJsonMsg.rawJson) {
                          // JSON 형식 검증 추가
                          const rawJson = latestJsonMsg.rawJson.trim();
                          if (rawJson.startsWith('{') && rawJson.endsWith('}') && !rawJson.includes("현재 밸브 상태")) {
                            const jsonData = JSON.parse(rawJson);
                            
                            // 대기 상태인 경우 - 고정 값으로 표시
                            if (jsonData.process_info === "waiting") {
                              const pumpId = jsonData.pump_id || 0;
                              return (
                                <div className="flex items-center space-x-2">
                                  <span className="text-[10px] font-medium text-yellow-700 w-14">펌프 {pumpId}(대기):</span>
                                  <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-yellow-200 rounded-full"
                                      style={{ width: '100%' }}
                                    ></div>
                                  </div>
                                  <span className="text-[9px] font-semibold text-yellow-700">대기중</span>
                                </div>
                              );
                            }
                            
                            // 일반 작업 상태
                            if (jsonData.pump_id) {
                              const pumpMatch = String(jsonData.pump_id).match(/(\d+)\((\d+)\/(\d+)\)/);
                              if (pumpMatch) {
                                const pumpId = parseInt(pumpMatch[1], 10);
                                const current = parseInt(pumpMatch[2], 10);
                                const total = parseInt(pumpMatch[3], 10);
                                if (!isNaN(current) && !isNaN(total) && total > 0) {
                                  const pumpPercent = Math.min(100, Math.floor((current / total) * 100));
                                  return (
                                    <div className="flex items-center space-x-2">
                                      <span className="text-[10px] font-medium text-yellow-700 w-14">펌프 {pumpId}(가동):</span>
                                      <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div 
                                          className="h-full bg-yellow-500 rounded-full transition-all duration-1000 ease-in-out"
                                          style={{ width: `${pumpPercent}%` }}
                                        ></div>
                                      </div>
                                      <span className="text-[9px] font-semibold text-yellow-700">{pumpPercent}%</span>
                                    </div>
                                  );
                                }
                              } else if (typeof jsonData.pump_id === 'number') {
                                // 펌프 ID가 숫자인 경우 - 단순히 펌프 번호만 표시
                                const pumpId = jsonData.pump_id;
                                return (
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] font-medium text-yellow-700 w-14">펌프 {pumpId}(가동):</span>
                                    <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-yellow-500 rounded-full transition-all duration-1000 ease-in-out"
                                        style={{ width: '50%' }}
                                      ></div>
                                    </div>
                                    <span className="text-[9px] font-semibold text-yellow-700">진행중</span>
                                  </div>
                                );
                              }
                            }
                          } else {
                            // JSON이 아닌 경우, 밸브 상태 정보일 수 있음
                            console.log('비 JSON 형식 메시지 펌프 정보 무시:', rawJson.substring(0, 30));
                            }
                          }
                        } catch (e) {
                          console.error('Pump info parsing error:', e);
                        }
                        
                        // 기본 상태 - 항상 표시되도록
                        return (
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-medium text-yellow-700 w-14">펌프(대기):</span>
                            <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-yellow-200 rounded-full"
                                style={{ width: '100%' }}
                              ></div>
                            </div>
                            <span className="text-[9px] font-semibold text-yellow-700">미작동</span>
                          </div>
                        );
                      })()}
                      
                      {/* 대기시간 카운터 그래프 */}
                      {(() => {
                        try {
                          // 최신 JSON 데이터에서 대기시간 정보 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (latestJsonMsg && latestJsonMsg.rawJson) {
                          // JSON 형식 검증 추가
                          const rawJson = latestJsonMsg.rawJson.trim();
                          if (rawJson.startsWith('{') && rawJson.endsWith('}') && !rawJson.includes("현재 밸브 상태")) {
                            const jsonData = JSON.parse(rawJson);
                            
                            // 대기 상태인 경우에 대기시간 카운터 표시
                            if (jsonData.process_info === "waiting" && jsonData.remaining_time !== undefined && jsonData.total_time !== undefined) {
                              const remainingTime = parseInt(String(jsonData.remaining_time), 10);
                              const totalTime = parseInt(String(jsonData.total_time), 10);
                              
                              if (!isNaN(remainingTime) && !isNaN(totalTime) && totalTime > 0) {
                                const elapsedTime = totalTime - remainingTime;
                                const waitPercent = Math.min(100, Math.max(0, Math.floor((elapsedTime / totalTime) * 100)));
                                
                                return (
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] font-medium text-blue-700 w-14">대기카운터:</span>
                                    <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-in-out"
                                        style={{ width: `${waitPercent}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-[9px] font-semibold text-blue-700">{remainingTime}초/{totalTime}초</span>
                                  </div>
                                );
                              }
                            }
                          } else {
                            // JSON이 아닌 경우 무시
                            console.log('비 JSON 형식 메시지 대기시간 정보 무시:', rawJson.substring(0, 30));
                            }
                          }
                        } catch (e) {
                          console.error('Wait counter parsing error:', e);
                        }
                        return null;
                      })()}
                      
                    {/* 자동화 대기시간 진행률 바 */}
                      {(() => {
                        try {
                          // 최신 JSON 데이터에서 대기시간 정보 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (latestJsonMsg && latestJsonMsg.rawJson) {
                          // JSON 형식 검증 추가
                          const rawJson = latestJsonMsg.rawJson.trim();
                          if (!rawJson.startsWith('{') || !rawJson.endsWith('}')) {
                            console.log('올바른 JSON 형식이 아님. JSON 파싱 건너뜀:', rawJson.substring(0, 30));
                            return null;  
                          }
                          
                          // 밸브 상태 메시지 체크 - 다양한 키워드로 확인
                          if (rawJson.includes("현재 밸브 상태") || 
                              rawJson.includes("밸브") || 
                              rawJson.includes("valve") || 
                              rawJson.includes("현재") ||
                              rawJson.includes("valveA") || 
                              rawJson.includes("valveB")) {
                            console.log('밸브 관련 메시지 감지. JSON 파싱 건너뜀:', rawJson.substring(0, 30));
                            return null;  
                          }
                          
                          // 안전한 방식으로 JSON 파싱 시도
                          try {
                            const jsonData = JSON.parse(rawJson);
                            
                            // total_remaining이 있으면 대기시간으로 표시
                            if (jsonData.total_remaining && jsonData.process_time) {
                              const totalTime = parseInt(String(jsonData.process_time).match(/(\d+)/)?.[1] || "0", 10);
                              const totalRemaining = parseInt(String(jsonData.total_remaining).match(/(\d+)/)?.[1] || "0", 10);
                              
                              if (totalTime > 0 && totalRemaining > 0) {
                                const waitPercent = Math.min(100, Math.max(0, Math.floor(100 - (totalRemaining / totalTime * 100))));
                                
                                // 시간 단위 계산 (시:분:초 형식)
                                const hours = Math.floor(totalRemaining / 3600);
                                const minutes = Math.floor((totalRemaining % 3600) / 60);
                                const seconds = totalRemaining % 60;
                                
                                // 시간 포맷팅 (시간이 있으면 시:분:초, 없으면 분:초)
                                const timeDisplay = hours > 0 
                                  ? `${hours}시 ${minutes}분 ${seconds}초`
                                  : `${minutes}분 ${seconds}초`;
                                
                                return (
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] font-medium text-purple-700 w-14">공정 종료:</span>
                                    <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-purple-500 rounded-full transition-all duration-1000 ease-in-out"
                                        style={{ width: `${waitPercent}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-[9px] font-semibold text-purple-700">{timeDisplay}</span>
                                  </div>
                                );
                              }
                            }
                          } catch (jsonError) {
                            console.error('JSON 파싱 오류 (자동화 대기시간):', jsonError);
                            return null;
                            }
                          }
                        } catch (e) {
                          console.error('Wait time parsing error:', e);
                        }
                        return null;
                      })()}
                  </div>
                </div>
                            </div>
                            </div>
          </div>
          
          {/* 추가 정보 박스 3 - 알림 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="bg-gray-50 py-1 px-2 text-xs font-semibold text-gray-700 rounded-t-lg border-b border-gray-200">
              알림
            </div>
            <div className="p-2 max-h-[70px] overflow-y-auto">
              {notifications.length > 0 ? (
                notifications.slice(0, 5).map((notification, idx) => (
                  <div key={idx} className="text-[9px] mb-1 pb-1 border-b border-gray-100 last:border-0 last:mb-0 last:pb-0">
                    <div className="font-medium">{new Date(notification.timestamp).toLocaleTimeString()}</div>
                    <div>{notification.message}</div>
                  </div>
                ))
              ) : (
                <div className="text-[9px] text-gray-500">새로운 알림이 없습니다</div>
              )}
            </div>
          </div>
          
          {/* 상태 변경 알림 UI 추가 - 우측 하단 빈 공간에 배치 */}
          {notifications.length > 0 && (
            <div className="mt-1 space-y-1">
              {notifications.slice(0, 2).map((notification, idx) => (
                <div 
                  key={`popup-${notification.timestamp}-${idx}`}
                  className={`p-2 rounded-lg border text-xs shadow-sm animate-slideInRight ${
                    notification.type === 'warning' ? 'bg-yellow-50 border-yellow-300 text-yellow-800' :
                    notification.type === 'error' ? 'bg-red-50 border-red-300 text-red-800' :
                    'bg-blue-50 border-blue-200 text-blue-800'
                  }`}
                  style={{
                    animation: 'slideInRight 0.5s forwards, fadeOut 0.5s 4.5s forwards'
                  }}
                >
                  <div className="flex justify-between">
                    <span className={`font-medium ${
                      notification.type === 'warning' ? 'text-yellow-600' :
                      notification.type === 'error' ? 'text-red-600' :
                      'text-blue-700'
                    }`}>
                      {notification.type === 'warning' ? '⚠️ 경고' : 
                      notification.type === 'error' ? '⛔ 오류' : 
                      '💡 알림'}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(notification.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1">{notification.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 애니메이션 키프레임 정의 */}
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>

      <div className="absolute bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-200 mt-0">
        <div className="p-0">
          <div className="w-full">
            <div className="flex justify-between items-center px-1 py-0.5">
              <div className="font-bold text-[9px]">추출 진행 상황:</div>
              <div className="text-[8px] text-gray-500">{formatTimeStr()}</div>
            </div>
            <div className="max-h-[40px] overflow-y-auto px-1">
              {progressMessages.slice(0, 2).map((msg, idx) => (
                <div key={`msg-${idx}`} className="p-0.5 mb-0.5 rounded bg-white border border-gray-100 text-[9px] leading-tight flex items-center last:mb-0">
                  <div className="w-3 h-3 flex-shrink-0 bg-blue-100 rounded-full flex items-center justify-center mr-1">
                    <span className="text-[7px] font-bold text-blue-700">{idx+1}</span>
                  </div>
                  <div className="flex-grow overflow-hidden">
                    {msg.message || '진행 정보'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 진행 버튼 상태 전달을 위한 히든 요소 */}
      <div className="hidden" id="process-running-state" data-running={processRunning.toString()}></div>
    </div>
  );
}

