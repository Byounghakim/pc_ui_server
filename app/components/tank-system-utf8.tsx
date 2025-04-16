"use client"
import { motion } from "framer-motion"
import { useEffect, useState, useRef, useCallback } from "react"
import { MqttClient } from "mqtt"
import { cn } from '@/lib/utils';
import "./tank-system.css"; // ?�로 ?�성??CSS ?�일 import
import { PROCESS_PROGRESS_TOPIC, AUTOMATION_STATUS_TOPIC, PROCESS_COMPLETION_TOPIC } from "@/lib/mqtt-topics"; // MQTT ?�픽 import
import { Tank } from '@/interface/tank'; // Tank ?�터?�이?�만 ?�포??
// 고유 ?�라?�언??ID ?�성 ?�수
const generateClientId = () => {
  if (typeof window === 'undefined') return 'server';
  return `client_${Math.random().toString(36).substring(2, 15)}`;
};

// ?�스???�태 ?�??�?불러?�기 ?�수 개선
const saveState = async (stateToSave: any) => {
  try {
    // 로컬 ?�토리�????�태 ?�??    if (typeof window !== 'undefined') {
      localStorage.setItem('tankSystemState', JSON.stringify(stateToSave));
      
      // API ?�출 비활?�화 - ?�버 API ?�??로컬 ?�토리�?�??�용
      console.log('?�버 API ?�출 ?�??로컬 ?�토리�??�만 ?�?�합?�다.');
      
      // IndexedDB?�도 ?�??      if (typeof saveToIndexedDB === 'function') {
        saveToIndexedDB(stateToSave);
      }
      
      // ?�른 ??창에 ?�태 변�??�림
      localStorage.setItem('tankSystemStateUpdate', Date.now().toString());
    }
  } catch (error) {
    console.error('?�태 ?�???�패:', error);
  }
};

// IndexedDB???�태 ?�??const saveToIndexedDB = (state: any) => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    console.warn('IndexedDB�??�용?????�습?�다.');
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
        console.error('IndexedDB ?�키�??�그?�이??�??�류:', error);
        // ?�류가 발생?�도 계속 진행
      }
    };
    
    request.onsuccess = function(event) {
      try {
        const db = request.result;
        const transaction = db.transaction(['systemState'], 'readwrite');
        const store = transaction.objectStore('systemState');
        
        // ??�� 같�? ?�로 ?�?�하??최신 ?�태�??��?
        const putRequest = store.put({
          id: 'currentState',
          data: state,
          timestamp: Date.now()
        });
        
        putRequest.onsuccess = function() {
          console.log('IndexedDB???�태 ?�???�공');
        };
        
        putRequest.onerror = function(event) {
          console.warn('IndexedDB ?�이???�??�??�류:', event);
        };
        
        transaction.oncomplete = function() {
          db.close();
        };
        
        transaction.onerror = function(event) {
          console.warn('IndexedDB ?�랜??�� ?�류:', event);
        };
      } catch (error) {
        console.error('IndexedDB ?�랜??�� ?�성 �??�류:', error);
      }
    };
    
    request.onerror = function(event) {
      console.warn('IndexedDB ?�기 ?�류:', event);
    };
  } catch (error) {
    console.error('IndexedDB ?�근 �??�상�?못한 ?�류:', error);
  }
};

// ?�태 불러?�기 ?�수 개선
const loadState = () => {
  if (typeof window !== 'undefined') {
    try {
      const storedState = localStorage.getItem('tankSystemState');
      
      if (storedState && storedState !== 'undefined') {
        return JSON.parse(storedState);
      }
      
      return null;
    } catch (error) {
      console.error('?�태 불러?�기 ?�패:', error);
      return null;
    }
  }
  
  return null;
};

// ?�버?�서 초기 ?�태 불러?�기
const loadInitialState = async (): Promise<any> => {
  if (typeof window !== 'undefined') {
    try {
      // ?�버 API?�서 ?�태 가?�오�?      if (window.navigator.onLine) {
        try {
          console.log('?�버?�서 최신 ?�태 불러?�기 ?�도...');
          console.log('API ?�출 ?�??로컬 ?�토리�?�??�용?�니??');
        } catch (serverError) {
          console.error('?�버?�서 ?�태 불러?�기 ?�패:', serverError);
          // ?�버 ?�류 ??계속 진행 - 로컬 ?�?�소 ?�용
        }
      }
      
      // ?�버?�서 불러?�기 ?�패 ??로컬 ?�토리�??�서 불러?�기 ?�도
      try {
        const localState = loadState();
        if (localState) {
          console.log('로컬 ?�토리�??�서 ?�태�?불러?�습?�다.');
          return localState;
        }
      } catch (localError) {
        console.error('로컬 ?�토리�??�서 ?�태 불러?�기 ?�패:', localError);
        // 로컬 ?�토리�? ?�류 ??계속 진행 - IndexedDB ?�용
      }
      
      // IndexedDB?�서 불러?�기 ?�도
      try {
        const idbState = await loadFromIndexedDB();
        if (idbState) {
          console.log('IndexedDB?�서 ?�태�?불러?�습?�다.');
          return idbState;
        }
      } catch (idbError) {
        console.error('IndexedDB?�서 ?�태 불러?�기 ?�패:', idbError);
        // IndexedDB ?�류 ??기본�??�용
      }
    } catch (error) {
      console.error('초기 ?�태 불러?�기 ?�체 ?�로?�스 ?�패:', error);
      // 모든 ?�류 ??기본�??�용
    }
  }
  
  console.log('?�용 가?�한 ?�?�된 ?�태가 ?�습?�다. 기본�??�용.');
  return null;
};

// IndexedDB?�서 ?�태 불러?�기 (Promise 반환)
const loadFromIndexedDB = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB�??�용?????�습?�다.');
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
          console.error('IndexedDB ?�키�??�그?�이??�??�류:', error);
          // ?�그?�이???�류가 발생?�도 계속 진행 가?�하?�록 ??        }
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
              console.log('IndexedDB???�?�된 ?�태가 ?�습?�다.');
              resolve(null);
            }
          };
          
          getRequest.onerror = function(event) {
            console.warn('IndexedDB ?�기 ?�류:', event);
            resolve(null); // ?�류 발생 ?�에??null??반환?�여 ?�이 계속 ?�행?�도�???          };
          
          transaction.oncomplete = function() {
            db.close();
          };
        } catch (error) {
          console.error('IndexedDB ?�랜??�� �??�류:', error);
          resolve(null);
        }
      };
      
      request.onerror = function(event) {
        console.warn('IndexedDB ?�근 ?�류:', event);
        resolve(null); // reject ?�??resolve(null)???�용?�여 ?�이 계속 ?�행?�도�???      };
    } catch (error) {
      console.error('IndexedDB ?�용 �??�상�?못한 ?�류:', error);
      resolve(null); // 모든 ?�외 ?�황?�서???�이 계속 ?�행?�도�???    }
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
    valveADesc?: string  // 밸브 A ?�명 추�?
    valveBDesc?: string  // 밸브 B ?�명 추�?
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
  onPumpToggle?: (pumpId: number) => void  // ?�프 ?��? ?�수
  onPumpReset?: (pumpId: number) => void   // ?�프 리셋 ?�수
  onPumpKCommand?: (pumpId: number) => void // ?�프 K 명령 ?�수
  // onExtractionCommand ?�성 ?�거??  pumpStateMessages?: Record<number, string> // ?�프 ?�태 메시지
  mqttClient?: MqttClient // MQTT ?�라?�언??추�?
  kButtonActive?: boolean // K 버튼 ?�성???��?
  pumpMessages?: Record<number, string> // ?�프 메시지
  progressMessages?: Array<{timestamp: number, message: string, rawJson?: string | null}> // 진행 메시지 추�?
  setProgressMessages?: (messages: Array<{timestamp: number, message: string, rawJson?: string | null}> | ((prev: Array<{timestamp: number, message: string, rawJson?: string | null}>) => Array<{timestamp: number, message: string, rawJson?: string | null}>)) => void // 진행 메시지 ?�데?�트 ?�수 추�?
}

// 추출 진행 메시지�??�한 ?�터?�이??interface ExtractionProgress {
  timestamp: number
  message: string
}

// ?�결 ?�태�??�한 ?�터?�이??interface ConnectionStatus {
  connected: boolean
  lastConnected: Date | null
  reconnecting: boolean
}

// ?�스 ?�니메이?�을 ?�한 ?��???추�?
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
  // onExtractionCommand ?�성 ?�거??  kButtonActive,
  pumpMessages,
  setProgressMessages
}: TankSystemProps) {
  // 고유 ?�라?�언??ID ?�성 ?�수
  const generateClientId = () => {
    if (typeof window === 'undefined') return 'server';
    return `client_${Math.random().toString(36).substring(2, 15)}`;
  };

  // MQTT ?�픽?�서 진행 ?�보 ?�싱???�한 ?�터?�이??추�?
  interface ProcessProgress {
    mode: string;             // ?�동 모드 (?�시모드, ?�차모드, ?�버?�모??
    elapsed_time: number;     // 경과 ?�간 (�?
    remaining_time: number;   // ?��? ?�간 (�?
    total_repeats: number;    // �?반복 ?�수 
    current_repeat: number;   // ?�재 반복 ?�수
    pump_id?: string;         // ?�프 ID (?�차모드, ?�버?�모?�에???�용)
  }

  // 진행 ?�태 ?�보 ?�??(?�프 ID�?
  const [pumpProgressInfo, setPumpProgressInfo] = useState<Record<number, ProcessProgress>>({});

  // 진행 ?�보 메시지 ?�싱 ?�수 - extwork/extraction/progress ?�픽??  const parseProgressMessage = (messageStr: string): ProcessProgress | null => {
    try {
      // JSON ?�싱 ?�도
      if (messageStr.startsWith('{') && messageStr.endsWith('}')) {
        const progressData = JSON.parse(messageStr);
        
        // 기본 ?�드 ?�인
        if (progressData.elapsed_time && progressData.remaining_time) {
          // 경과 ?�간�??��? ?�간??�??�위�??�싱
          const elapsedStr = progressData.elapsed_time.replace('s', '');
          const remainingStr = progressData.remaining_time.replace('s', '');
          const elapsed = parseInt(elapsedStr, 10);
          const remaining = parseInt(remainingStr, 10);
          
          // 기본 ?�로그레???�보 객체
          const progress: ProcessProgress = {
            mode: '',
            elapsed_time: elapsed,
            remaining_time: remaining,
            total_repeats: 1,
            current_repeat: 0,
            pump_id: undefined
          };
          
          // 모드 ?�보 ?�싱
          if (progressData.mode) {
            progress.mode = progressData.mode;
          } else if (messageStr.includes('?�시모드')) {
            progress.mode = '?�시모드';
          } else if (messageStr.includes('?�차모드')) {
            progress.mode = '?�차모드';
          } else if (messageStr.includes('?�버?�모??)) {
            progress.mode = '?�버?�모??;
          }
          
          // 반복 ?�수 ?�보 ?�싱 - ?�시모드
          if (progress.mode === '?�시모드' && progressData.process_info) {
            const processMatch = progressData.process_info.match(/S\((\d+)\/(\d+)\)/);
            if (processMatch) {
              progress.current_repeat = parseInt(processMatch[1], 10);
              progress.total_repeats = parseInt(processMatch[2], 10) || 1; // 0?�면 1�?처리
            }
          }
          
          // ?�프 ID �?반복 ?�수 ?�싱 - ?�차모드 & ?�버?�모??          if ((progress.mode === '?�차모드' || progress.mode === '?�버?�모??) && progressData.pump_id) {
            // ?�확???�턴 매칭: "1(0/9)" ?�식
            const pumpMatch = progressData.pump_id.match(/(\d+)\((\d+)\/(\d+)\)/);
            if (pumpMatch) {
              progress.pump_id = pumpMatch[1]; // ?�프 ID (?? "1")
              
              // ?�차 모드 개선: ?�확???�재 반복 ?�수?� �?반복 ?�수 계산
              progress.current_repeat = parseInt(pumpMatch[2], 10); // ?�재 반복 ?�수 (?? 0)
              
              // �?반복 ?�수 처리 - 0부???�작?��?�?+1
              const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부???�작?��?�?+1
              progress.total_repeats = totalRepeats || 1; // �?반복 ?�수가 0?�면 1�??�정
              
              console.log(`?�프 ${progress.pump_id} 진행 ?�보 ?�싱: ?�재 ${progress.current_repeat+1}/${progress.total_repeats} ??(${((progress.current_repeat/progress.total_repeats)*100).toFixed(1)}% 진행)`);
            }
          }
          
          return progress;
        }
      }
      
      // ?�스???�식?�로 ??메시지 ?�싱 ?�도 (�?JSON ?�식)
      const elapsedMatch = messageStr.match(/경과:\s*(\d+)s/) || messageStr.match(/elapsed_time":\s*"(\d+)s/);
      const remainingMatch = messageStr.match(/?��?:\s*(\d+)s/) || messageStr.match(/remaining_time":\s*"(\d+)s/);
      
      if (elapsedMatch && remainingMatch) {
        const elapsed = parseInt(elapsedMatch[1], 10);
        const remaining = parseInt(remainingMatch[1], 10);
        
        // 기본 ?�로그레???�보 객체
        const progress: ProcessProgress = {
          mode: '',
          elapsed_time: elapsed,
          remaining_time: remaining,
          total_repeats: 1,
          current_repeat: 0,
          pump_id: undefined
        };
        
        // 모드 ?�보 ?�싱
        if (messageStr.includes('?�시모드')) {
          progress.mode = '?�시모드';
          // ?�시모드 반복 ?�수 ?�보 ?�싱
          const processMatch = messageStr.match(/S\((\d+)\/(\d+)\)/);
          if (processMatch) {
            progress.current_repeat = parseInt(processMatch[1], 10);
            progress.total_repeats = parseInt(processMatch[2], 10) || 1; // 0?�면 1�?처리
          }
        } else if (messageStr.includes('?�차모드')) {
          progress.mode = '?�차모드';
          
          // ?�차모드 ?�프 ID �?반복 ?�수 ?�싱 - 개선???�규??          const pumpMatch = messageStr.match(/?�프\s*(\d+)\s*\((\d+)\/(\d+)\)/) || 
                            messageStr.match(/(\d+)\((\d+)\/(\d+)\)/);
          
          if (pumpMatch) {
            progress.pump_id = pumpMatch[1]; // ?�프 ID
            progress.current_repeat = parseInt(pumpMatch[2], 10); // ?�재 반복 ?�수
            
            // �?반복 ?�수 처리 - 0?�면 1�??�정 (100% 채워�?
            const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부???�작?��?�?+1
            progress.total_repeats = totalRepeats || 1;
            
            console.log(`[?�스?? ?�프 ${progress.pump_id} ?�차모드 진행 ?�보: ${progress.current_repeat+1}/${progress.total_repeats} ??);
          }
        } else if (messageStr.includes('?�버?�모??)) {
          progress.mode = '?�버?�모??;
          
          // ?�버?�모???�프 ID �?반복 ?�수 ?�싱 - 개선???�규??          const pumpMatch = messageStr.match(/?�프\s*(\d+)\s*\((\d+)\/(\d+)\)/) || 
                            messageStr.match(/(\d+)\((\d+)\/(\d+)\)/);
                          
          if (pumpMatch) {
            progress.pump_id = pumpMatch[1]; // ?�프 ID
            progress.current_repeat = parseInt(pumpMatch[2], 10); // ?�재 반복 ?�수
            
            // �?반복 ?�수 처리 - 0?�면 1�??�정 (100% 채워�?
            const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부???�작?��?�?+1
            progress.total_repeats = totalRepeats || 1;
            
            console.log(`[?�스?? ?�프 ${progress.pump_id} ?�버?�모??진행 ?�보: ${progress.current_repeat+1}/${progress.total_repeats} ??);
          }
        }
        
        return progress;
      }
      
      return null;
    } catch (error) {
      console.error('진행 ?�보 ?�싱 ?�류:', error);
      return null;
    }
  };

  // ?�니메이?�을 ?�한 ?�태 추�?
  const [fillPercentage, setFillPercentage] = useState(0);
  
  // 길게 ?�르�?감�?�??�한 ?�?�머 ?�태 추�?
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [currentPressedPump, setCurrentPressedPump] = useState<number | null>(null);
  
  // ?�라?�언??ID ?�태 추�?
  const clientId = useRef(generateClientId());
  
  // 마�?�??�태 ?�데?�트 ?�간
  const [lastStateUpdate, setLastStateUpdate] = useState<Date | null>(null);
  
  // ?�결 ?�태 추�?
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    lastConnected: null,
    reconnecting: false
  });
  
  // ?�태 변�??�림???�한 ?�태 ?�데?�트
  const [notifications, setNotifications] = useState<Array<{
    message: string,
    timestamp: number,
    source?: string,
    type?: 'info' | 'warning' | 'error', // ?�림 ?�형 추�?
    pumpId?: number // ?�프 ID 추�?
  }>>([]);

  // ?�림 추�? ?�수 
  const addNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info', pumpId?: number) => {
    const notification = {
      message,
      timestamp: Date.now(),
      type,
      pumpId,
      source: '?�스??
    };
    
    // ?�림 목록??추�?
    setNotifications(prev => [...prev, notification]);
    
    // 15�????�림 ?�동 ?�거
    setTimeout(() => {
      setNotifications(prev => 
        prev.filter(n => n.timestamp !== notification.timestamp)
      );
    }, 15000);
    
    // MQTT�??�해 ?�림 공유 (?�른 ?�라?�언?�에게도 ?�림)
    if (mqttClient) {
      mqttClient.publish('tank-system/notifications', JSON.stringify({
        ...notification,
        clientId: clientId.current
      }));
    }
  };

  // ?�프 ?�위�??�래�??�태
  const [pumpSwitchPosition, setPumpSwitchPosition] = useState<Record<number, number>>({
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 // 모든 ?�프???�??초기 ?�위�??�치 ?�정
  });
  const [draggingPump, setDraggingPump] = useState<number | null>(null);
  const [resetTimers, setResetTimers] = useState<Record<number, NodeJS.Timeout | null>>({});
  const [resetSwitchPosition, setResetSwitchPosition] = useState<Record<number, number>>({});
  // ?�프 리셋 ?�래�??�태 추�?
  const [resetDragState, setResetDragState] = useState<Record<number, { dragging: boolean, position: number, timer: NodeJS.Timeout | null }>>({});
  
  // MQTT ?�라?�언???�결 ?�태 모니?�링
  useEffect(() => {
    if (!mqttClient) return;
    
    const subscribeTankTopics = () => {
      console.log('?�크 ?�픽 구독 �?..');
      
      // ?�요???�픽 구독
      for (let i = 1; i <= 6; i++) {
        // ?�크 ?�위 ?�픽 구독
        mqttClient.subscribe(`extwork/inverter${i}/tank${i}_level`);
        
        // 2�??�크 ?�위 문제 ?�결: 모든 ?�크-?�버??조합 구독
        for (let j = 1; j <= 6; j++) {
          if (i !== j) { // ?�에???��? 구독???�일 번호 조합?� ?�외
            mqttClient.subscribe(`extwork/inverter${i}/tank${j}_level`);
            console.log(`추�? 구독: extwork/inverter${i}/tank${j}_level`);
          }
        }
        
        // ?�버???�태 ?�픽 구독 (?�프 ?�태)
        mqttClient.subscribe(`extwork/inverter${i}/state`);
        
        // ?�버???�결 ?�태 ?�픽 구독
        mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
      }
      
      // 본탱???�위 ?�픽 구독
      mqttClient.subscribe('extwork/tank/level');
      
      // ?�동??공정 관???�픽 구독
      mqttClient.subscribe(AUTOMATION_STATUS_TOPIC);
      mqttClient.subscribe(PROCESS_PROGRESS_TOPIC);
      
      // 추출 명령 ?�력 ?�픽 구독 추�?
      mqttClient.subscribe('extwork/extraction/input');
      
      // STATUS ?�청 ?�거 - Redis?�서 ?�태�?가?�오?�록 변�?      // 밸브, ?�프 ?�태??MQTT 메시지�??�해 ?�데?�트
      console.log('Redis�??�해 ?�스???�태�?관리합?�다.');
    };
    
    // MQTT ?�라?�언???�결 ??구독 ?�정
    mqttClient.on('connect', () => {
      console.log('MQTT ?�결?? ?�크 ?�픽 구독');
      setConnectionStatus({
        connected: true,
        lastConnected: new Date(),
        reconnecting: false
      });
      
      subscribeTankTopics();
      
      // ?�결 복구 ???�림 추�?
      if (connectionStatus.lastConnected) {
        addNotification('MQTT ?�버 ?�결??복구?�었?�니??', 'info');
      }
    });
    
    // ?�결 ?��? 처리
    mqttClient.on('disconnect', () => {
      console.log('MQTT ?�결 ?��?');
      setConnectionStatus(prev => ({
        ...prev,
        connected: false
      }));
      
      // ?�결 ?��? ?�림 추�?
      addNotification('MQTT ?�버 ?�결???�어졌습?�다. 로컬 ?�태�??�영?�니??', 'warning');
    });
    
    // ?��? ?�결?�어 ?�는 경우 구독 ?�행
    if (mqttClient.connected) {
      subscribeTankTopics();
    }
    
    // ?�결 ?�벤??리스???�록
    mqttClient.on('connect', subscribeTankTopics);
    
    const handleMessage = (topic: string, message: Buffer) => {
      const messageStr = message.toString();
      console.log(`MQTT 메시지 ?�신: ${topic} - ${messageStr}`);
      
      try {
        // extwork/extraction/input ?�픽 처리 추�?
        if (topic === 'extwork/extraction/input') {
          console.log(`추출 ?�력 명령 ?�신: ${messageStr}`);
          
          try {
            // JSON ?�이???�싱 ?�도
            const jsonData = JSON.parse(messageStr);
            
            // 받�? 명령 ?�?�하�?(?�간 추�??�여 메시지 보�?)
            const timeStr = formatTimeStr();
            const displayMessage = `??공정 명령 ?�신: ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'} (${timeStr})`;
            
            // ?�림 추�?
            addNotification(`??공정 명령???�신?�었?�니?? ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'}`, 'info');
            
            // progress 메시지 ?�데?�트 - rawJson ?�드???�본 JSON ?�이???�??            if (setProgressMessages) {
              setProgressMessages(prevMessages => {
                const updatedMessages = [{
                timestamp: Date.now(),
                message: displayMessage,
                rawJson: messageStr
                }, ...(prevMessages || [])];
                
                // 로컬 ?�토리�???진행 메시지 ?�??(?�결 ?��? ??복원??
                localStorage.setItem('lastProgressMessages', JSON.stringify(updatedMessages));
                
                return updatedMessages;
              });
            }
            
            // 로그 출력
            console.log(`추출 명령 처리?? ${displayMessage}`);
          } catch (parseError) {
            console.error('추출 ?�력 명령 ?�싱 ?�류:', parseError);
            
            // ?�싱 ?�패?�도 ?�림?� ?�워�?            addNotification('추출 명령???�신?��?�?처리?????�습?�다. ?�식???�인?�주?�요.', 'error');
            
            // ?�싱 ?�패 메시지 추�?
            if (setProgressMessages) {
              setProgressMessages(prevMessages => {
                const updatedMessages = [{
                timestamp: Date.now(),
                message: `?�류: ?�신??명령??JSON ?�식???�못?�었?�니??`,
                rawJson: null
                }, ...(prevMessages || [])];
                
                // 로컬 ?�토리�???진행 메시지 ?�??(?�결 ?��? ??복원??
                localStorage.setItem('lastProgressMessages', JSON.stringify(updatedMessages));
                
                return updatedMessages;
              });
            }
          }
          return; // ?�른 ?�들???�출?��? ?�고 종료
        }
        // ?�픽???�른 처리
        else if (topic === 'tank-system/notifications') {
          const notification = JSON.parse(messageStr);
          
          // ?�신??발생?�킨 ?�림???�닌 경우?�만 처리
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
            
            // 15�????�림 ?�거
            setTimeout(() => {
              setNotifications(prev => 
                prev.filter(n => n.timestamp !== notification.timestamp)
              );
            }, 15000);
          }
        } else if (topic === 'extwork/tankMain/level') {
          // 본탱???�위 ?�보 ?�데?�트
          console.log(`본탱??메시지 ?�신: ${messageStr}`);
          
          // ?�간 문자???�성
          const timeStr = formatTimeStr();
          
          // ?�스??메시지 처리 (본탱?�용)
          if (messageStr.includes("?�스??메시지")) {
            // ?�스??메시지???�간 추�?
            const displayMessage = `본탱???�스??(${timeStr})`;
            console.log(`본탱???�스??메시지 변?? ${messageStr} -> ${displayMessage}`);
            setMainTankLevelMessage(displayMessage);
          } else {
            // ?�반 메시지 처리 - ?�간 ?�보 추�?
            const displayMessage = `${messageStr} (${timeStr})`;
            setMainTankLevelMessage(displayMessage);
            
            // 메시지???�라 ?�시�?변경하�??�크 ?�태??변경하지 ?�음
            // 중요: ?�기??tankData.mainTank�??�정?�면 ?�됨
          }
          
          console.log(`본탱??메시지 ?�데?�트 ?�료: ${messageStr}`);
          
          // ?�태 지?�을 ?�해 로컬 ?�토리�????�??          localStorage.setItem('mainTankLevelMessage', messageStr);
        } else if (topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/)) {
          // ?�크 ?�위 ?�픽 처리
          const tankLevelMatch = topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/);
          if (tankLevelMatch) {
            const inverterId = Number.parseInt(tankLevelMatch[1]);
            const tankId = Number.parseInt(tankLevelMatch[2]);
            
            console.log(`?�크 ?�위 메시지 처리 - ?�버??ID: ${inverterId}, ?�크 ID: ${tankId}, 메시지: ${messageStr}`);
            
            // ?�프 ?�태 ?�인
            const isPumpRunning = tankData?.tanks && tankData?.tanks[inverterId - 1]?.pumpStatus === "ON";
            console.log(`?�프 ?�태: ${isPumpRunning ? "ON" : "OFF"}`);
            
            // ?�간 문자???�성
            const timeStr = formatTimeStr();
            
            // 중요 메시지 ?��? ?�확?�게 체크 (?�확??메시지�?매칭)
            const isImportantMessage = (msg: string, tankId: number): boolean => {
              // 1�??�크?� ?�머지 ?�크�?구분
              if (tankId === 1) {
                // 1�??�크??중요 메시지
                return (
                  msg.includes("?�위:5%?�상") || 
                  msg.includes("?�위부�?5%미만") || 
                  msg.includes("가?�채?�짐") ||
                  msg.includes("채�?가??)
                );
            } else {
                // 2~6�??�크??중요 메시지
                return (
                  msg.includes("?�위부�?) || 
                  msg.includes("?�위?�상") || 
                  msg.includes("가?�채?�짐") || 
                  msg.includes("?�상?�위")
                );
              }
            };
            
            // 메시지 처리 - ?�스??박스???�시???�체 메시지
            let displayMessage = `${messageStr} (${timeStr})`;
            
            // ?�크 ?��????�시??메시지 (중요 메시지�?
            let tankDisplayMessage = "";
            
            // 중요 메시지 ?��? ?�인
            if (isImportantMessage(messageStr, tankId)) {
              // 중요 ?�태 메시지???�크 ?��? ?�시?�으�??�??              tankDisplayMessage = messageStr;
              console.log(`중요 ?�태 메시지 감�?: "${messageStr}" (?�크 ${tankId})`);
            }
            
            // ?�버�? ?�크 메시지 ?�데?�트 ???�재 ?�태 ?�인
            console.log(`?�크 ${tankId} 메시지 ?�데?�트 ???�재 ?�태:`, {
              ?�재메시지: tankMessages[tankId],
              ?�메?��?: displayMessage
            });
            
            // ?�크 메시지 ?�태 ?�데?�트 - ??종류??메시지 모두 ?�데?�트
            setTankMessages(prev => {
              const updated = {
                ...prev,
                [tankId]: displayMessage
              };
              console.log(`?�크 ${tankId} 메시지 ?�데?�트: "${displayMessage}"`);
              
              // ?�본 메시지�?localStorage???�?�하???�음 갱신까�? ?��?
              localStorage.setItem(`tank_${tankId}_last_message`, messageStr);
              console.log(`?�본 메시지 ?�?? tank_${tankId}_last_message = "${messageStr}"`);
              
              // ?�스??박스??메시지 ?�??              localStorage.setItem(`tank_${tankId}_message`, displayMessage);
              
              // 중요 메시지??별도�??�??(?�크 ?��? ?�시??
              if (tankDisplayMessage) {
                localStorage.setItem(`tank_${tankId}_important_message`, tankDisplayMessage);
                console.log(`중요 메시지 ?�??(?�크 ?��? ?�시??: tank_${tankId}_important_message = "${tankDisplayMessage}"`);
              }
              
              return updated;
            });
            
            // ?�버�? ?�재 ?�태 출력
            setTimeout(() => {
              console.log(`?�크 ${tankId} 메시지 ?�태 ?�데?�트 ?�료: "${displayMessage}"`);
              if (tankDisplayMessage) {
                console.log(`?�크 ${tankId} ?��? ?�시 메시지: "${tankDisplayMessage}"`);
              }
            }, 100);
          }
        } 
        // ?�른 ?�픽 처리...
        else if (topic.match(/extwork\/inverter(\d+)\/state/)) {
          // ?�버???�태 ?�픽 처리 - ?�프 ?�태�?변�? ?�상?� getTankColor ?�수가 처리
          const inverterId = parseInt(topic.match(/extwork\/inverter(\d+)\/state/)![1]);
          console.log(`?�버???�태 메시지 ?�신 - ?�버??ID: ${inverterId}, 메시지: ${messageStr}`);
          
          // 메시지???�라 ?�프 ?�태 ?�데?�트 (?�상 변경�? getTankColor ?�수가 ?�당)
          // 메시지가 "ON"???�함?�면 ?�프 ON, 그렇지 ?�으�?OFF
          const isOn = messageStr.toUpperCase().includes("ON");
          
          // ?�프 ?�태가 ON?�서 OFF�?변경된 경우 ?�림 추�?
          if (tankData?.tanks && tankData?.tanks[inverterId - 1]?.pumpStatus === "ON" && !isOn) {
            const timeStr = formatTimeStr();
            const pumpOffMessage = `?�프 ${inverterId} OFF: ${messageStr} (${timeStr})`;
            addNotification(pumpOffMessage, 'info', inverterId);
          }
        }
        // 카메???�태 ?�픽 처리 추�?
        else if (topic.match(/extwork\/cam(\d+)\/state/)) {
          const camNumber = parseInt(topic.match(/extwork\/cam(\d+)\/state/)![1]);
          console.log(`카메??${camNumber} ?�태 메시지 ?�신: ${messageStr}`);
          
          // ??컴포?�트?�서??카메???�태 처리�??��? ?�고,
          // ?�위 컴포?�트(Dashboard)?�서 처리?�도�??�니??
          // ?�기?�는 로그�?출력?�니??
        }
        // ?�동??공정 ?�태 ?�픽 처리
        else if (topic === AUTOMATION_STATUS_TOPIC) {
          try {
            const automationStatus = JSON.parse(messageStr);
            if (automationStatus.status === "sequence_started") {
              setAutomationProgress(`${automationStatus.sequenceName} ?�퀀???�작??);
            }
          } catch (error) {
            console.error('?�동???�태 메시지 ?�싱 ?�류:', error);
            // JSON ?�싱 ?�패 ???�본 메시지 그�?�??�??            setAutomationProgress(messageStr);
          }
        }
        // 공정 진행 ?�태 ?�픽 처리
        else if (topic === PROCESS_PROGRESS_TOPIC) {
          try {
            // 공정 진행 ?�태 메시지 처리
            console.log(`공정 진행 ?�태 메시지: ${messageStr}`);
            
            // JSON ?�싱 ?�도
            let jsonData: any;
            let isJsonFormat = false;
            
            try {
              if (messageStr.trim().startsWith('{') && messageStr.trim().endsWith('}')) {
                jsonData = JSON.parse(messageStr);
                isJsonFormat = true;
                console.log('JSON ?�식 진행 ?�이???�인:', jsonData);
              }
            } catch (jsonError) {
              console.log('JSON ?�싱 ?�패, ?�스???�식?�로 처리:', jsonError);
            }
            
            // 진행 ?�보 ?�싱 (JSON ?�는 ?�스???�식)
            let progressInfo: ProcessProgress | null = null;
            
            if (isJsonFormat && jsonData) {
              // JSON ?�식 처리 - ?�청???�식??맞춘 명시??처리
              progressInfo = {
                mode: jsonData.mode || '',
                elapsed_time: 0,
                remaining_time: 0,
                total_repeats: 1,
                current_repeat: 0,
                pump_id: undefined
              };
              
              // 경과 ?�간 추출 (?�자 ?�는 문자??s ?�식)
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
              
              // ?��? ?�간 추출 (?�자 ?�는 문자??s ?�식)
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
              
              // ?�프 ID 추출 (?? "1(10/11)" ?�식)
              if (jsonData.pump_id) {
                progressInfo.pump_id = String(jsonData.pump_id);
                
                // 반복 ?�보 ?�싱 (?? "1(10/11)" ???�프 1, ?�재 10?? �?11??
                const pumpMatch = String(jsonData.pump_id).match(/(\d+)\((\d+)\/(\d+)\)/);
                if (pumpMatch) {
                  // ?�재 반복 ?�수?� �?반복 ?�수 ?�정
                  progressInfo.current_repeat = parseInt(pumpMatch[2], 10);
                  progressInfo.total_repeats = parseInt(pumpMatch[3], 10);
                  
                  console.log(`[JSON] ?�프 ${pumpMatch[1]} 진행 ?�보: ${progressInfo.current_repeat}/${progressInfo.total_repeats} ??);
                }
              }
              
              // process_info ?�드?�서 반복 ?�보 ?�싱 (?? "C(6/10)")
              if (jsonData.process_info) {
                const processMatch = String(jsonData.process_info).match(/\w+\((\d+)\/(\d+)\)/);
                if (processMatch) {
                  if (!progressInfo.pump_id) {
                    // ?�시모드??경우 ?�는 pump_id가 ?�는 경우?�만 ?�정
                    progressInfo.current_repeat = parseInt(processMatch[1], 10);
                    progressInfo.total_repeats = parseInt(processMatch[2], 10);
                  }
                }
              }
              
              console.log('?�싱??JSON 진행 ?�보:', progressInfo);
            } else {
              // 기존 ?�스??기반 ?�싱 ?�용
              progressInfo = parseProgressMessage(messageStr);
            }
            
            // 진행 ?�보가 ?�으�??�태 ?�데?�트
            if (progressInfo) {
              console.log('최종 ?�싱??진행 ?�보:', progressInfo);
              
              // ?�프 ID가 ?�는 경우 (?�차모드, ?�버?�모??
              if (progressInfo.pump_id) {
                // ?�프 ID 추출 ("1(10/11)" ??"1")
                const pumpIdMatch = String(progressInfo.pump_id).match(/^(\d+)/);
                const pumpId = pumpIdMatch ? parseInt(pumpIdMatch[1], 10) : 0;
                
                if (pumpId > 0) {
                // 진행 ?�보 ?�태 ?�데?�트 ??로그
                console.log(`?�프 ${pumpId} 진행 ?�보 ?�데?�트 ??`, {
                  ?�재�? pumpProgressInfo[pumpId],
                  ?�값: progressInfo
                });
                
                // ?�프 ID???�당?�는 진행 ?�보 ?�데?�트
                setPumpProgressInfo(prev => {
                  const updated = { 
                    ...prev, 
                    [pumpId]: progressInfo 
                  };
                  
                  // ?�데?�트 ??�?기록
                  setTimeout(() => {
                    console.log(`?�프 ${pumpId} 진행 ?�보 ?�데?�트 ??`, updated[pumpId]);
                  }, 10);
                  
                  return updated;
                });
                
                // JSON?�로 직렬?�하??로컬 ?�토리�??�도 ?�??(?�버깅용)
                try {
                  localStorage.setItem(`pump_progress_${pumpId}`, JSON.stringify(progressInfo));
                    
                    // 진행�?계산?�여 ?�??(?�니메이?�용)
                    const totalTime = progressInfo.elapsed_time + progressInfo.remaining_time;
                    if (totalTime > 0) {
                      const fillPercent = 5 + (progressInfo.elapsed_time / totalTime) * 90;
                      localStorage.setItem(`pump_${pumpId}_fill_percent`, fillPercent.toString());
                    }
                } catch (e) {
                  console.error('진행 ?�보 로컬 ?�토리�? ?�???�패:', e);
                  }
                } else {
                  console.log('?�프 ID�?추출?????�거???�효?��? ?�음:', progressInfo.pump_id);
                }
              } else if (progressInfo.mode === '?�시모드') {
                // ?�시모드??경우 모든 ?�성 ?�프???�일??진행 ?�보 ?�용
                const activePumps = tankData?.tanks?.filter(t => t.pumpStatus === "ON").map(t => t.id) || [];
                
                if (activePumps.length > 0) {
                  console.log(`?�시모드: ${activePumps.length}�??�성 ?�프??진행 ?�보 ?�용`, activePumps);
                  
                  setPumpProgressInfo(prev => {
                    const updated = { ...prev };
                    
                    activePumps.forEach(pumpId => {
                      updated[pumpId] = progressInfo;
                      
                      // 로컬 ?�토리�??�도 ?�??(?�버깅용)
                      try {
                        localStorage.setItem(`pump_progress_${pumpId}`, JSON.stringify(progressInfo));
                        
                        // 진행�?계산?�여 ?�??(?�니메이?�용)
                        const totalTime = progressInfo.elapsed_time + progressInfo.remaining_time;
                        if (totalTime > 0) {
                          const fillPercent = 5 + (progressInfo.elapsed_time / totalTime) * 90;
                          localStorage.setItem(`pump_${pumpId}_fill_percent`, fillPercent.toString());
                        }
                      } catch (e) {
                        console.error('진행 ?�보 로컬 ?�토리�? ?�???�패:', e);
                      }
                    });
                    
                    return updated;
                  });
                } else {
                  console.log('?�시모드?��?�??�성?�된 ?�프가 ?�습?�다.');
                }
              } else {
                console.log('처리???�프 ID가 ?�거??모드가 지?�되지 ?�았?�니??');
              }
              
              // progress 메시지 ?�데?�트
              if (setProgressMessages) {
                setProgressMessages(prevMessages => {
                  const updatedMessages = [{
                  timestamp: Date.now(),
                  message: `진행 ?�태: ${messageStr}`,
                  rawJson: isJsonFormat ? messageStr : null
                  }, ...(prevMessages || [])];
                  
                  // 로컬 ?�토리�???진행 메시지 ?�??(?�결 ?��? ??복원??
                  localStorage.setItem('lastProgressMessages', JSON.stringify(updatedMessages));
                  
                  return updatedMessages;
                });
              }
              
            // ?�스??메시지 처리 (?�재 ?�퀀???�보 ?�싱)
            if (messageStr.includes("?�재 ?�퀀??")) {
              setCurrentSequenceInfo(messageStr.split('\n')[0]?.trim() || null);
            }
            
            // ?�음 ?�퀀???�보 ?�싱
            if (messageStr.includes("?�음 ?�퀀??")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith("?�음 ?�퀀??")) {
                  setNextSequenceInfo(line.trim());
                  break;
                }
              }
            }
            
            // ?�퀀???�계 ?�보 ?�싱 (n�??�료 / n�??�행�?/ n�??�기중 / n�??�류)
            if (messageStr.includes("�??�료") && messageStr.includes("�??�행�?)) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.includes("�??�료") && line.includes("�??�행�?)) {
                  setSequenceStatsInfo(line.trim());
                  break;
                }
              }
            }
            
              // ?�체 메시지�??�동??진행 ?�태 ?�시???�??            setAutomationProgress(messageStr);
            } else {
              console.log('진행 ?�보�??�싱?????�습?�다. ?�본 메시지:', messageStr);
              // ?�싱 ?�패 ?�에???�본 메시지 ?�??              setAutomationProgress(messageStr);
            }
          } catch (error) {
            console.error('공정 진행 ?�태 메시지 처리 ?�류:', error);
            setAutomationProgress(messageStr); // ?�류 발생 ???�본 메시지 그�?�??�??          }
        }
      } catch (error) {
        console.error('메시지 처리 ?�류:', error);
      }
    };
    
    // 메시지 ?�벤??리스???�록
    mqttClient.on('message', handleMessage);
    
    // 컴포?�트 ?�마?�트 ???�벤??리스???�거
    return () => {
      mqttClient.off('message', handleMessage);
      mqttClient.off('connect', subscribeTankTopics);
    };
  }, [mqttClient, tankData]);
  
  // ?�라???�태 변??감�? ?�수�?컴포?�트 최상???�벨???�언
  const handleOnlineStatusChange = useCallback(() => {
    if (window.navigator.onLine && mqttClient) {
      // ?�라?�으�?복�? ??메시지 출력
      console.log('?�트?�크 ?�결??복구?�었?�니?? ?�스???�태�??�데?�트?�니??');
      
      // ?�결 ?�태 ?�데?�트
      setConnectionStatus({
        connected: true,
        lastConnected: new Date(),
        reconnecting: false
      });
      
      // ?�태 ?�데?�트 ?�림
      addNotification('?�트?�크 ?�결??복구?�었?�니?? ?�스???�태가 ?�데?�트?�니??', 'info');
    } else if (!window.navigator.onLine) {
      // ?�프?�인 ?�태�??�환 ??      console.log('?�트?�크 ?�결???�겼?�니??');
      
      // ?�결 ?�태 ?�데?�트
      setConnectionStatus(prev => ({
        ...prev,
        connected: false,
        reconnecting: false
      }));
      
      // ?�결 ?��? ?�림
      addNotification('?�트?�크 ?�결???�겼?�니?? ?�프?�인 모드�??�환?�니??', 'warning');
    }
  }, [mqttClient, addNotification]);
  
  // 컴포?�트 마운?????�?�된 ?�태 복원 - IndexedDB 추�?
  useEffect(() => {
    // 로컬/?�션 ?�토리�??�서 먼�? 불러?�기
    const savedState = loadState();
    if (savedState && savedState.timestamp) {
      setLastStateUpdate(new Date(savedState.timestamp));
    }
    
    // IndexedDB?�서???�인 (??최신?????�음)
    loadFromIndexedDB()
      .then(indexedDBState => {
        if (indexedDBState && 
            indexedDBState.timestamp > (savedState?.timestamp || 0)) {
          // IndexedDB???�태가 ??최신?�면 ?�용
          setLastStateUpdate(new Date(indexedDBState.timestamp));
          
          // localStorage?� sessionStorage ?�데?�트
          localStorage.setItem('tankSystemState', JSON.stringify(indexedDBState));
          sessionStorage.setItem('tankSystemState', JSON.stringify(indexedDBState));
        }
      })
      .catch(error => {
        console.error('IndexedDB ?�태 로드 ?�패:', error);
      });
  }, []);
  
  // ?�라???�프?�인 ?�태 ?�벤??리스???�록
  useEffect(() => {
    window.addEventListener('online', handleOnlineStatusChange);
    window.addEventListener('offline', handleOnlineStatusChange);
    
    // 초기 ?�태 ?�인
    if (!window.navigator.onLine) {
      setConnectionStatus(prev => ({
        ...prev,
        connected: false,
        reconnecting: false
      }));
    }
    
    return () => {
      window.removeEventListener('online', handleOnlineStatusChange);
      window.removeEventListener('offline', handleOnlineStatusChange);
    };
  }, [handleOnlineStatusChange]);
  
  // 공정 메시지 ?�?�된 �?복원 (?�결 ?��? ?��?
  useEffect(() => {
    if (setProgressMessages) {
      try {
        const savedMessages = localStorage.getItem('lastProgressMessages');
        if (savedMessages && progressMessages.length === 0) {
          const parsed = JSON.parse(savedMessages);
          setProgressMessages(parsed);
          console.log('로컬 ?�토리�??�서 진행 메시지�?복원?�습?�다.', parsed.length);
        }
      } catch (error) {
        console.error('진행 메시지 복원 �??�류:', error);
      }
    }
  }, [setProgressMessages, progressMessages]);

  // MQTT ?�결 ?�태 변�?처리 
  useEffect(() => {
    if (!mqttClient) return;
    
    mqttClient.on('connect', () => {
      console.log('MQTT ?�결?? ?�크 ?�픽 구독');
      setConnectionStatus({
        connected: true,
        lastConnected: new Date(),
        reconnecting: false
      });
      
      subscribeTankTopics();
      
      // ?�결 복구 ???�림 추�?
      if (connectionStatus.lastConnected) {
        addNotification('MQTT ?�버 ?�결??복구?�었?�니??', 'info');
      }
    });
    
    // ?�결 ?��? 처리
    mqttClient.on('disconnect', () => {
      console.log('MQTT ?�결 ?��?');
      setConnectionStatus(prev => ({
        ...prev,
        connected: false
      }));
      
      // ?�결 ?��? ?�림 추�?
      addNotification('MQTT ?�버 ?�결???�어졌습?�다. 로컬 ?�태�??�영?�니??', 'warning');
    });
    
    // ?��? ?�결?�어 ?�는 경우 구독 ?�행
    if (mqttClient.connected) {
      subscribeTankTopics();
    }
    
    // ?�결 ?�벤??리스???�록
    mqttClient.on('connect', subscribeTankTopics);
    
    // ... ?�머지 코드 ...
  }, [mqttClient, tankData, setProgressMessages, progressMessages]);

  // 리셋 ?�래�??�작
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
  
  // 리셋 ?�래�??�동
  const handleResetDragMove = (e: MouseEvent | TouchEvent, pumpId: number) => {
    if (!resetDragState[pumpId]?.dragging) return;
    
    // 마우???�는 ?�치 X 좌표
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    
    // 리셋 버튼 ?�소???�치 구하�?    const resetButton = document.getElementById(`reset-btn-${pumpId}`);
    if (!resetButton) return;
    
    const rect = resetButton.getBoundingClientRect();
    const buttonWidth = rect.width;
    const maxDrag = 50; // 최�? ?�래�?거리
    
    // ?�래�??�치 계산 (0~1 ?�이 �?
    const dragStartX = rect.left + buttonWidth / 2; // 버튼 중앙
    const dragDistance = Math.max(0, Math.min(maxDrag, clientX - dragStartX)); // 0 ~ maxDrag
    const position = dragDistance / maxDrag; // 0 ~ 1
    
    setResetDragState(prev => {
      const currentState = prev[pumpId] || { dragging: true, position: 0, timer: null };
      
      // ?��? ?�?�머가 ?�고, ?�치가 0.8(80%) ?�상?�면 ?�?�머 ?��?
      if (currentState.timer && position >= 0.8) {
        return prev;
      }
      
      // ?�?�머가 ?��?�??�치가 0.8 미만?�면 ?�?�머 취소
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
      
      // ?�?�머가 ?�고 ?�치가 0.8 ?�상?�면 ?�?�머 ?�작
      if (!currentState.timer && position >= 0.8) {
        const timer = setTimeout(() => {
          console.log(`?�프 ${pumpId} 리셋 명령 ?�행 (2�???`);
          if (onPumpReset) {
            onPumpReset(pumpId);
            
            // "3" 명령 발행
            if (mqttClient) {
              const pumpTopic = `extwork/pump${pumpId}/cmd`;
              mqttClient.publish(pumpTopic, "3");
              
              // ?�림 발행
              const notification = {
                type: 'pump-reset',
                pumpId: pumpId,
                timestamp: Date.now(),
                clientId: clientId.current,
                message: `?�프 ${pumpId} 리셋 명령(3)???�행?�었?�니??`
              };
              
              mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
            }
          }
          
          // ?�?�머 리셋 �??�태 초기??          setResetDragState(prev => ({
            ...prev,
            [pumpId]: {
              dragging: false,
              position: 0,
              timer: null
            }
          }));
        }, 2000); // 2�????�행
        
        return {
          ...prev,
          [pumpId]: {
            ...currentState,
            position,
            timer
          }
        };
      }
      
      // �??�의 경우 ?�치�??�데?�트
      return {
        ...prev,
        [pumpId]: {
          ...currentState,
          position
        }
      };
    });
  };

  // 리셋 ?�래�?종료
  const handleResetDragEnd = (pumpId: number) => {
    const currentState = resetDragState[pumpId];
    if (!currentState?.dragging) return;
    
    // ?�벤??리스???�거
    document.removeEventListener('mousemove', (e) => handleResetDragMove(e, pumpId));
    document.removeEventListener('touchmove', (e) => handleResetDragMove(e, pumpId));
    document.removeEventListener('mouseup', () => handleResetDragEnd(pumpId));
    document.removeEventListener('touchend', () => handleResetDragEnd(pumpId));
    
    // ?�?�머가 ?�고, ?�치가 0.8 ?�상?�면 ?�?�머 ?��? (계속 ?�행)
    if (currentState.timer && currentState.position >= 0.8) {
      return;
    }
    
    // ?�?�머가 ?��?�??�치가 0.8 미만?�면 ?�?�머 취소
    if (currentState.timer) {
      clearTimeout(currentState.timer);
    }
    
    // ?�태 초기??    setResetDragState(prev => ({
      ...prev,
      [pumpId]: {
        dragging: false,
        position: 0,
        timer: null
      }
    }));
  };
  
  // 밸브 ?�태 변�??�들??- MQTT ?�림 추�?
  const handleValveChange = (newState: string) => {
    // ?�태 변�??�청
    onValveChange(newState);
    
    // MQTT�??�한 ?�림 발행
    if (mqttClient) {
      const notification = {
        type: 'valve-change',
        valveState: newState,
        timestamp: Date.now(),
        clientId: clientId.current,
        message: `밸브 ?�태가 변경되?�습?�다: ${newState}`
      };
      
      mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
    }
    
    // ?�태 변�??�간 ?�데?�트
    setLastStateUpdate(new Date());
    
    // ?�태 ?�??    saveState({
      ...tankData,
      valveState: newState
    });
  };
  
  // ?�프 버튼 마우???�운 ?�들??- MQTT ?�림 추�?
  const handlePumpMouseDown = (pumpId: number) => {
    setCurrentPressedPump(pumpId);
    
    // 길게 ?�르�?감�? ?�?�머 ?�정 (3�???리셋 명령 발생)
    const timer = setTimeout(() => {
      console.log(`?�프 ${pumpId} 길게 ?�름 감�? - 리셋 명령 ?�행`);
      if (onPumpReset) {
        onPumpReset(pumpId);
        
        // MQTT�??�한 ?�림 발행
        if (mqttClient) {
          const notification = {
            type: 'pump-reset',
            pumpId,
            timestamp: Date.now(),
            clientId: clientId.current,
            message: `?�프 ${pumpId} 리셋 명령???�행?�었?�니??`
          };
          
          mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
        }
      }
      setCurrentPressedPump(null);
    }, 3000);
    
    setLongPressTimer(timer);
  };
  
  // ?�프 버튼 마우?????�들??- MQTT ?�림 추�?
  const handlePumpMouseUp = (pumpId: number) => {
    // ?�?�머가 ?�으�?취소 (길게 ?�르�?취소)
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    // ?�재 ?�른 ?�프가 ?�고, 마우?????�벤?��? 발생???�프?� 같으�??�릭?�로 간주
    if (currentPressedPump === pumpId) {
      console.log(`?�프 ${pumpId} ?�릭 - ?��? 명령 ?�행`);
      if (onPumpToggle) {
        onPumpToggle(pumpId);
        
        // MQTT�??�한 ?�림 발행
        if (mqttClient) {
          const notification = {
            type: 'pump-toggle',
            pumpId,
            timestamp: Date.now(),
            clientId: clientId.current,
            message: `?�프 ${pumpId} ?�태가 ?��??�었?�니??`
          };
          
          mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
        }
      }
    }
    
    setCurrentPressedPump(null);
  };
  
  // 마우?��? ?�프 밖으�??�갔?????�들??  const handlePumpMouseLeave = () => {
    // ?�?�머가 ?�으�?취소
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    setCurrentPressedPump(null);
  };
  
  // ?�치 ?�벤???�들??(모바??
  const handlePumpTouchStart = (pumpId: number) => {
    handlePumpMouseDown(pumpId);
  };
  
  const handlePumpTouchEnd = (pumpId: number) => {
    handlePumpMouseUp(pumpId);
  };
  
  const handlePumpTouchCancel = () => {
    handlePumpMouseLeave();
  };

  // 추출 진행 ?�황?�서 ?�크 채�? 비율 계산 - 로직 개선
  useEffect(() => {
    if (progressMessages.length > 0) {
      const latestProgress = progressMessages[0]; // 가??최신 메시지 ?�용 (배열 �?번째 ?�소)
      const latestMessage = latestProgress.message || '';
      console.log('최신 진행 메시지:', latestMessage);
      
      // ?�양???�식??진행 메시지 처리 개선
      try {
        // 1. "?��?: XXs | 경과: YYs" ?�식 ?�턴 ?�인
        const remainingMatch = latestMessage.match(/?��?:\s*(\d+)s/) || latestMessage.match(/?�음:\s*(\d+)s/) || latestMessage.match(/remaining:\s*(\d+)s/);
        const elapsedMatch = latestMessage.match(/경과:\s*(\d+)s/) || latestMessage.match(/진행:\s*(\d+)s/) || latestMessage.match(/elapsed:\s*(\d+)s/);
        
        // 2. 직접?�인 ?�자 ?�턴 ?�인 ("50/100�? 같�? ?�식)
        const directProgressMatch = latestMessage.match(/(\d+)\/(\d+)(�?s)/);
      
      if (remainingMatch && elapsedMatch) {
        const remaining = parseInt(remainingMatch[1], 10);
        const elapsed = parseInt(elapsedMatch[1], 10);
        const total = remaining + elapsed;
        
        if (!isNaN(remaining) && !isNaN(elapsed) && total > 0) {
          // ?�재 경과 ?�간�??�체 ?�간??비율 계산 (최�? 100%)
          const percentage = Math.min((elapsed / total) * 100, 100);
          setFillPercentage(percentage);
          console.log(`채�? ?�니메이??진행�??�데?�트: ${percentage.toFixed(1)}% (경과: ${elapsed}s, ?�체: ${total}s)`);
        }
        } else if (directProgressMatch) {
          // 직접?�인 진행 ?�보 ?�싱 (?? "50/100�?)
          const current = parseInt(directProgressMatch[1], 10);
          const total = parseInt(directProgressMatch[2], 10);
          
          if (!isNaN(current) && !isNaN(total) && total > 0) {
            const percentage = Math.min((current / total) * 100, 100);
            setFillPercentage(percentage);
            console.log(`채�? ?�니메이??진행�??�데?�트(직접 ?�식): ${percentage.toFixed(1)}% (?�재: ${current}, ?�체: ${total})`);
          }
        } else {
          // 3. JSON ?�식??경우 ?�싱 ?�도
          try {
            if (latestProgress.rawJson) {
              const jsonData = JSON.parse(latestProgress.rawJson);
              
              // process_time�?total_remaining???�용??진행�?계산 추�?
              if (jsonData.process_time !== undefined && jsonData.total_remaining !== undefined) {
                const processTime = parseInt(jsonData.process_time.toString().replace('s', ''), 10);
                const totalRemaining = parseInt(jsonData.total_remaining.toString().replace('s', ''), 10);
                
                if (!isNaN(processTime) && !isNaN(totalRemaining)) {
                  // ?�체 처리 ?�간 - ?��? 처리???�간�??��? ?�간????                  const totalTime = processTime;
                  // 진행�?= ((?�체 처리 ?�간 - ?��? ?�간) / ?�체 처리 ?�간) * 100
                  const completedTime = Math.max(0, processTime - totalRemaining);
                  const percentage = Math.min((completedTime / processTime) * 100, 100);
                  setFillPercentage(percentage);
                  console.log(`채�? ?�니메이??진행�??�데?�트(process_time): ${percentage.toFixed(1)}% (처리 ?�간: ${processTime}s, ?�료 ?�간: ${completedTime}s, ?��? ?�간: ${totalRemaining}s)`);
                }
              } else if (jsonData.elapsedTime !== undefined && jsonData.totalTime !== undefined) {
                const elapsed = parseInt(jsonData.elapsedTime, 10);
                const total = parseInt(jsonData.totalTime, 10);
                
                if (!isNaN(elapsed) && !isNaN(total) && total > 0) {
                  const percentage = Math.min((elapsed / total) * 100, 100);
                  setFillPercentage(percentage);
                  console.log(`채�? ?�니메이??진행�??�데?�트(JSON): ${percentage.toFixed(1)}% (경과: ${elapsed}s, ?�체: ${total}s)`);
                }
              } else if (jsonData.percent !== undefined) {
                // ?�센??직접 ?�싱
                const percentStr = jsonData.percent.toString().replace('%', '');
                const percentage = parseFloat(percentStr);
                
                if (!isNaN(percentage)) {
                  setFillPercentage(percentage);
                  console.log(`채�? ?�니메이??진행�??�데?�트(?�센??: ${percentage.toFixed(1)}%`);
                }
              }
            }
          } catch (jsonError) {
            // JSON ?�싱 ?�패?�도 무시
          }
        }
      } catch (error) {
        console.error('진행 메시지 ?�싱 ?�류:', error);
      }
      
      // 4. ?�프가 ON ?�태?�면 기본�?50%�??�정 (채�? ?�니메이?��? 보이지�??�확??진행률�? ?????�음)
      const anyPumpActive = tankData?.tanks?.some(tank => tank.pumpStatus === "ON");
      if (anyPumpActive && fillPercentage === 0) {
        setFillPercentage(50);
        console.log('?�프 ?�성??감�?, 기본 채�? ?�니메이???�용 (50%)');
      }
    }
  }, [progressMessages, tankData?.tanks]);

  // ?�크 ?�태???�른 ?�상 반환 - ?�프 ?�태 최우???�용
  const getTankColor = (status: string | undefined, tankId: number) => {
    // status가 undefined??경우 기본�??�정
    if (status === undefined) {
      console.log(`getTankColor - ?�크 ${tankId}, ?�태: undefined, 기본�?'empty' ?�용`);
      status = 'empty';
    }
    
    // ?�당 ?�크?� ?�결???�프???�태 ?�인
    let pumpStatus = "OFF";
    if (tankId >= 1 && tankId <= 6 && tankData?.tanks && tankData?.tanks.length >= tankId) {
      const tank = tankData?.tanks[tankId - 1];
      pumpStatus = tank?.pumpStatus || "OFF";
    }
    
    console.log(`getTankColor - ?�크 ${tankId}, ?�태: ${status}, ?�프: ${pumpStatus}`);
    
    // 1. ?�프가 켜져 ?�으�??��????�두리로 변�?- ??로직??최우??    if (pumpStatus === "ON") {
      return "fill-white stroke-yellow-400 stroke-[3]";
    }
    
    // 2. ?�프가 꺼져 ?�으�??�태???�라 ?�상 결정 (메시지가 ?�???�상 변경하지 ?�음)
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

  // ?�크 ?�태???�른 ?�세 메시지 반환
  const getStatusMessage = (status: string, level: number, tankId?: number) => {
    // 본탱??tankId가 0)??경우 mainTankMessage ?�선 ?�시
    if (tankId === 0 && mainTankMessage) {
      return mainTankMessage;
    }

    // tankId가 ?�효??경우 ?�전???�?�된 메시지가 ?�는지 ?�인
    if (tankId !== undefined) {
      const savedMessage = localStorage.getItem(`tank_${tankId}_last_message`);
      if (savedMessage) {
        return savedMessage;
      }
    }

    // 기본 ?�크 ?�태 메시지 로직
    switch (status) {
      case "full":
        return "가?�채?�짐";
      case "empty":
        return "준비중"; // 초기값을 "준비중"?�로 변�?      case "filling":
        return `채워지??�?(${Math.round(fillPercentage)}%)`;
      default:
        return `5% ?�상 ?�여`;
    }
  };

  // 채워지???�니메이?�을 ?�한 ?��???계산 ?�수 개선
  const getFillingStyle = (status: string, tankId: number, operationTime?: number) => {
    // ?�버�? ?�수 ?�출 ?�보 추�?
    console.log(`[getFillingStyle] ?�출: ?�크 ${tankId}, ?�태=${status}, ?�동?�간=${operationTime || 'N/A'}`);

    // ?�프가 꺼져 ?�으�??�니메이???�음
    if (status !== "ON") {
      console.log(`[getFillingStyle] ?�크 ${tankId}???�프가 꺼져 ?�어 채�? ?�음`);
      return {};
    }

    // ?�당 ?�크?� ?�결???�프???�태 ?�인
    const pumpStatus = tankData?.tanks && tankData?.tanks[tankId - 1]?.pumpStatus || "OFF";
    console.log(`[getFillingStyle] ?�크 ${tankId}???�프 ?�태: ${pumpStatus}`);
    
    // ?�프 진행 ?�보 가?�오�?      const pumpProgress = pumpProgressInfo[tankId];
    console.log(`[getFillingStyle] ?�프 ${tankId}??pumpProgressInfo:`, pumpProgress);
      
      if (pumpProgress) {
      // 간단???�니메이??로직 ?�용 - elapsed_time�?remaining_time??비율�?계산
      let elapsedTime = 0;
      let totalTime = 0;
      
      // elapsed_time �?추출
      if (pumpProgress.elapsed_time !== undefined) {
        if (typeof pumpProgress.elapsed_time === 'number') {
          elapsedTime = pumpProgress.elapsed_time;
        } else if (typeof pumpProgress.elapsed_time === 'string') {
          // 문자?�에???�자 추출 (?? "54s" -> 54)
          const matchElapsed = String(pumpProgress.elapsed_time).match(/(\d+)/);
          if (matchElapsed) {
            elapsedTime = parseInt(matchElapsed[1], 10);
          }
        }
      }
      
      // remaining_time �?추출
      if (pumpProgress.remaining_time !== undefined) {
        if (typeof pumpProgress.remaining_time === 'number') {
          totalTime = elapsedTime + pumpProgress.remaining_time;
        } else if (typeof pumpProgress.remaining_time === 'string') {
          // 문자?�에???�자 추출 (?? "6s" -> 6)
          const matchRemaining = String(pumpProgress.remaining_time).match(/(\d+)/);
          if (matchRemaining) {
            const remainingTime = parseInt(matchRemaining[1], 10);
            totalTime = elapsedTime + remainingTime;
          }
        }
      }
      
      console.log(`[getFillingStyle] ?�프 ${tankId} ?�간 계산: elapsedTime=${elapsedTime}, totalTime=${totalTime}`);
      
      // ?�이?��? ?�거??totalTime??0?�면 기본�??�용
      if (totalTime <= 0) {
        console.log(`[getFillingStyle] ?�크 ${tankId}???�간 ?�이?��? ?�거??0?�니?? 기본�??�용`);
        return {
          clipPath: 'inset(95% 0 0 0)', // 기본 5% 채�?
          transition: 'clip-path 1s linear',
          backgroundColor: 'rgba(59, 130, 246, 0.3)'
        };
      }
      
      // 진행�?계산 (백분??
      let fillPercent = Math.min((elapsedTime / totalTime) * 100, 100);
      
      // 최소 5% 채�? 보장 (?�각???�드�?
      fillPercent = Math.max(fillPercent, 5);
      
      console.log(`[간단??채�? 계산] ?�크 ${tankId}: ${fillPercent.toFixed(1)}% (경과:${elapsedTime}�? ?�체:${totalTime}�?`);
      
      // 주의: ?�기??직접 ?�태�??�데?�트?�면 무한 ?�더링이 발생?�니??
      // ?�역 ?�태 ?�데?�트??useEffect?�서 ?�행?�야 ?�니??
      
        return {
          clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
          transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: fillPercent // 백분??값도 ?�께 반환
        };
      }
      
      // pumpProgressInfo가 ?�을 ?�만 operationTime ?�용 (fallback)
      if (operationTime && operationTime > 0) {
        console.log(`?�프 ${tankId}??진행 ?�보가 ?�어 operationTime ?�용: ${operationTime}�?);
        
        // ?�재 경과 ?�간 계산 (�?메시지 ?�간부???�재까�?)
        const startTime = tankData?.tanks?.[tankId - 1]?.startTime || Date.now();
        const elapsedTime = (Date.now() - startTime) / 1000; // �??�위
        
        // 가???�간??100%�??�여 경과 ?�간??비�???채�? 비율 계산
      let fillPercent = Math.min((elapsedTime / operationTime) * 100, 100);
      // 최소 5%??채워지?�록 (?�각???�드�?
      fillPercent = Math.max(fillPercent, 5);
            
      console.log(`[?��?방식] ?�크 ${tankId} 채�?�? ${fillPercent.toFixed(1)}%`);
              
              return {
                clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
                transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
"use client"
import { motion } from "framer-motion"
import { useEffect, useState, useRef, useCallback } from "react"
import { MqttClient } from "mqtt"
import { cn } from '@/lib/utils';
import "./tank-system.css"; // ?�로 ?�성??CSS ?�일 import
import { PROCESS_PROGRESS_TOPIC, AUTOMATION_STATUS_TOPIC, PROCESS_COMPLETION_TOPIC } from "@/lib/mqtt-topics"; // MQTT ?�픽 import
import { Tank } from '@/interface/tank'; // Tank ?�터?�이?�만 ?�포??
// 고유 ?�라?�언??ID ?�성 ?�수
const generateClientId = () => {
  if (typeof window === 'undefined') return 'server';
  return `client_${Math.random().toString(36).substring(2, 15)}`;
};

// ?�스???�태 ?�??�?불러?�기 ?�수 개선
const saveState = async (stateToSave: any) => {
  try {
    // 로컬 ?�토리�????�태 ?�??    if (typeof window !== 'undefined') {
      localStorage.setItem('tankSystemState', JSON.stringify(stateToSave));
      
      // API ?�출 비활?�화 - ?�버 API ?�??로컬 ?�토리�?�??�용
      console.log('?�버 API ?�출 ?�??로컬 ?�토리�??�만 ?�?�합?�다.');
      
      // IndexedDB?�도 ?�??      if (typeof saveToIndexedDB === 'function') {
        saveToIndexedDB(stateToSave);
      }
      
      // ?�른 ??창에 ?�태 변�??�림
      localStorage.setItem('tankSystemStateUpdate', Date.now().toString());
    }
  } catch (error) {
    console.error('?�태 ?�???�패:', error);
  }
};

// IndexedDB???�태 ?�??const saveToIndexedDB = (state: any) => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    console.warn('IndexedDB�??�용?????�습?�다.');
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
        console.error('IndexedDB ?�키�??�그?�이??�??�류:', error);
        // ?�류가 발생?�도 계속 진행
      }
    };
    
    request.onsuccess = function(event) {
      try {
        const db = request.result;
        const transaction = db.transaction(['systemState'], 'readwrite');
        const store = transaction.objectStore('systemState');
        
        // ??�� 같�? ?�로 ?�?�하??최신 ?�태�??��?
        const putRequest = store.put({
          id: 'currentState',
          data: state,
          timestamp: Date.now()
        });
        
        putRequest.onsuccess = function() {
          console.log('IndexedDB???�태 ?�???�공');
        };
        
        putRequest.onerror = function(event) {
          console.warn('IndexedDB ?�이???�??�??�류:', event);
        };
        
        transaction.oncomplete = function() {
          db.close();
        };
        
        transaction.onerror = function(event) {
          console.warn('IndexedDB ?�랜??�� ?�류:', event);
        };
      } catch (error) {
        console.error('IndexedDB ?�랜??�� ?�성 �??�류:', error);
      }
    };
    
    request.onerror = function(event) {
      console.warn('IndexedDB ?�기 ?�류:', event);
    };
  } catch (error) {
    console.error('IndexedDB ?�근 �??�상�?못한 ?�류:', error);
  }
};

// ?�태 불러?�기 ?�수 개선
const loadState = () => {
  if (typeof window !== 'undefined') {
    try {
      const storedState = localStorage.getItem('tankSystemState');
      
      if (storedState && storedState !== 'undefined') {
        return JSON.parse(storedState);
      }
      
      return null;
    } catch (error) {
      console.error('?�태 불러?�기 ?�패:', error);
      return null;
    }
  }
  
  return null;
};

// ?�버?�서 초기 ?�태 불러?�기
const loadInitialState = async (): Promise<any> => {
  if (typeof window !== 'undefined') {
    try {
      // ?�버 API?�서 ?�태 가?�오�?      if (window.navigator.onLine) {
        try {
          console.log('?�버?�서 최신 ?�태 불러?�기 ?�도...');
          console.log('API ?�출 ?�??로컬 ?�토리�?�??�용?�니??');
        } catch (serverError) {
          console.error('?�버?�서 ?�태 불러?�기 ?�패:', serverError);
          // ?�버 ?�류 ??계속 진행 - 로컬 ?�?�소 ?�용
        }
      }
      
      // ?�버?�서 불러?�기 ?�패 ??로컬 ?�토리�??�서 불러?�기 ?�도
      try {
        const localState = loadState();
        if (localState) {
          console.log('로컬 ?�토리�??�서 ?�태�?불러?�습?�다.');
          return localState;
        }
      } catch (localError) {
        console.error('로컬 ?�토리�??�서 ?�태 불러?�기 ?�패:', localError);
        // 로컬 ?�토리�? ?�류 ??계속 진행 - IndexedDB ?�용
      }
      
      // IndexedDB?�서 불러?�기 ?�도
      try {
        const idbState = await loadFromIndexedDB();
        if (idbState) {
          console.log('IndexedDB?�서 ?�태�?불러?�습?�다.');
          return idbState;
        }
      } catch (idbError) {
        console.error('IndexedDB?�서 ?�태 불러?�기 ?�패:', idbError);
        // IndexedDB ?�류 ??기본�??�용
      }
    } catch (error) {
      console.error('초기 ?�태 불러?�기 ?�체 ?�로?�스 ?�패:', error);
      // 모든 ?�류 ??기본�??�용
    }
  }
  
  console.log('?�용 가?�한 ?�?�된 ?�태가 ?�습?�다. 기본�??�용.');
  return null;
};

// IndexedDB?�서 ?�태 불러?�기 (Promise 반환)
const loadFromIndexedDB = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB�??�용?????�습?�다.');
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
          console.error('IndexedDB ?�키�??�그?�이??�??�류:', error);
          // ?�그?�이???�류가 발생?�도 계속 진행 가?�하?�록 ??        }
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
              console.log('IndexedDB???�?�된 ?�태가 ?�습?�다.');
              resolve(null);
            }
          };
          
          getRequest.onerror = function(event) {
            console.warn('IndexedDB ?�기 ?�류:', event);
            resolve(null); // ?�류 발생 ?�에??null??반환?�여 ?�이 계속 ?�행?�도�???          };
          
          transaction.oncomplete = function() {
            db.close();
          };
        } catch (error) {
          console.error('IndexedDB ?�랜??�� �??�류:', error);
          resolve(null);
        }
      };
      
      request.onerror = function(event) {
        console.warn('IndexedDB ?�근 ?�류:', event);
        resolve(null); // reject ?�??resolve(null)???�용?�여 ?�이 계속 ?�행?�도�???      };
    } catch (error) {
      console.error('IndexedDB ?�용 �??�상�?못한 ?�류:', error);
      resolve(null); // 모든 ?�외 ?�황?�서???�이 계속 ?�행?�도�???    }
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
    valveADesc?: string  // 밸브 A ?�명 추�?
    valveBDesc?: string  // 밸브 B ?�명 추�?
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
  onPumpToggle?: (pumpId: number) => void  // ?�프 ?��? ?�수
  onPumpReset?: (pumpId: number) => void   // ?�프 리셋 ?�수
  onPumpKCommand?: (pumpId: number) => void // ?�프 K 명령 ?�수
  // onExtractionCommand ?�성 ?�거??  pumpStateMessages?: Record<number, string> // ?�프 ?�태 메시지
  mqttClient?: MqttClient // MQTT ?�라?�언??추�?
  kButtonActive?: boolean // K 버튼 ?�성???��?
  pumpMessages?: Record<number, string> // ?�프 메시지
  progressMessages?: Array<{timestamp: number, message: string, rawJson?: string | null}> // 진행 메시지 추�?
  setProgressMessages?: (messages: Array<{timestamp: number, message: string, rawJson?: string | null}> | ((prev: Array<{timestamp: number, message: string, rawJson?: string | null}>) => Array<{timestamp: number, message: string, rawJson?: string | null}>)) => void // 진행 메시지 ?�데?�트 ?�수 추�?
}

// 추출 진행 메시지�??�한 ?�터?�이??interface ExtractionProgress {
  timestamp: number
  message: string
}

// ?�결 ?�태�??�한 ?�터?�이??interface ConnectionStatus {
  connected: boolean
  lastConnected: Date | null
  reconnecting: boolean
}

// ?�스 ?�니메이?�을 ?�한 ?��???추�?
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
  // onExtractionCommand ?�성 ?�거??  kButtonActive,
  pumpMessages,
  setProgressMessages
}: TankSystemProps) {
  // 고유 ?�라?�언??ID ?�성 ?�수
  const generateClientId = () => {
    if (typeof window === 'undefined') return 'server';
    return `client_${Math.random().toString(36).substring(2, 15)}`;
  };

  // MQTT ?�픽?�서 진행 ?�보 ?�싱???�한 ?�터?�이??추�?
  interface ProcessProgress {
    mode: string;             // ?�동 모드 (?�시모드, ?�차모드, ?�버?�모??
    elapsed_time: number;     // 경과 ?�간 (�?
    remaining_time: number;   // ?��? ?�간 (�?
    total_repeats: number;    // �?반복 ?�수 
    current_repeat: number;   // ?�재 반복 ?�수
    pump_id?: string;         // ?�프 ID (?�차모드, ?�버?�모?�에???�용)
  }

  // 진행 ?�태 ?�보 ?�??(?�프 ID�?
  const [pumpProgressInfo, setPumpProgressInfo] = useState<Record<number, ProcessProgress>>({});

  // 진행 ?�보 메시지 ?�싱 ?�수 - extwork/extraction/progress ?�픽??  const parseProgressMessage = (messageStr: string): ProcessProgress | null => {
    try {
      // JSON ?�싱 ?�도
      if (messageStr.startsWith('{') && messageStr.endsWith('}')) {
        const progressData = JSON.parse(messageStr);
        
        // 기본 ?�드 ?�인
        if (progressData.elapsed_time && progressData.remaining_time) {
          // 경과 ?�간�??��? ?�간??�??�위�??�싱
          const elapsedStr = progressData.elapsed_time.replace('s', '');
          const remainingStr = progressData.remaining_time.replace('s', '');
          const elapsed = parseInt(elapsedStr, 10);
          const remaining = parseInt(remainingStr, 10);
          
          // 기본 ?�로그레???�보 객체
          const progress: ProcessProgress = {
            mode: '',
            elapsed_time: elapsed,
            remaining_time: remaining,
            total_repeats: 1,
            current_repeat: 0,
            pump_id: undefined
          };
          
          // 모드 ?�보 ?�싱
          if (progressData.mode) {
            progress.mode = progressData.mode;
          } else if (messageStr.includes('?�시모드')) {
            progress.mode = '?�시모드';
          } else if (messageStr.includes('?�차모드')) {
            progress.mode = '?�차모드';
          } else if (messageStr.includes('?�버?�모??)) {
            progress.mode = '?�버?�모??;
          }
          
          // 반복 ?�수 ?�보 ?�싱 - ?�시모드
          if (progress.mode === '?�시모드' && progressData.process_info) {
            const processMatch = progressData.process_info.match(/S\((\d+)\/(\d+)\)/);
            if (processMatch) {
              progress.current_repeat = parseInt(processMatch[1], 10);
              progress.total_repeats = parseInt(processMatch[2], 10) || 1; // 0?�면 1�?처리
            }
          }
          
          // ?�프 ID �?반복 ?�수 ?�싱 - ?�차모드 & ?�버?�모??          if ((progress.mode === '?�차모드' || progress.mode === '?�버?�모??) && progressData.pump_id) {
            // ?�확???�턴 매칭: "1(0/9)" ?�식
            const pumpMatch = progressData.pump_id.match(/(\d+)\((\d+)\/(\d+)\)/);
            if (pumpMatch) {
              progress.pump_id = pumpMatch[1]; // ?�프 ID (?? "1")
              
              // ?�차 모드 개선: ?�확???�재 반복 ?�수?� �?반복 ?�수 계산
              progress.current_repeat = parseInt(pumpMatch[2], 10); // ?�재 반복 ?�수 (?? 0)
              
              // �?반복 ?�수 처리 - 0부???�작?��?�?+1
              const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부???�작?��?�?+1
              progress.total_repeats = totalRepeats || 1; // �?반복 ?�수가 0?�면 1�??�정
              
              console.log(`?�프 ${progress.pump_id} 진행 ?�보 ?�싱: ?�재 ${progress.current_repeat+1}/${progress.total_repeats} ??(${((progress.current_repeat/progress.total_repeats)*100).toFixed(1)}% 진행)`);
            }
          }
          
          return progress;
        }
      }
      
      // ?�스???�식?�로 ??메시지 ?�싱 ?�도 (�?JSON ?�식)
      const elapsedMatch = messageStr.match(/경과:\s*(\d+)s/) || messageStr.match(/elapsed_time":\s*"(\d+)s/);
      const remainingMatch = messageStr.match(/?��?:\s*(\d+)s/) || messageStr.match(/remaining_time":\s*"(\d+)s/);
      
      if (elapsedMatch && remainingMatch) {
        const elapsed = parseInt(elapsedMatch[1], 10);
        const remaining = parseInt(remainingMatch[1], 10);
        
        // 기본 ?�로그레???�보 객체
        const progress: ProcessProgress = {
          mode: '',
          elapsed_time: elapsed,
          remaining_time: remaining,
          total_repeats: 1,
          current_repeat: 0,
          pump_id: undefined
        };
        
        // 모드 ?�보 ?�싱
        if (messageStr.includes('?�시모드')) {
          progress.mode = '?�시모드';
          // ?�시모드 반복 ?�수 ?�보 ?�싱
          const processMatch = messageStr.match(/S\((\d+)\/(\d+)\)/);
          if (processMatch) {
            progress.current_repeat = parseInt(processMatch[1], 10);
            progress.total_repeats = parseInt(processMatch[2], 10) || 1; // 0?�면 1�?처리
          }
        } else if (messageStr.includes('?�차모드')) {
          progress.mode = '?�차모드';
          
          // ?�차모드 ?�프 ID �?반복 ?�수 ?�싱 - 개선???�규??          const pumpMatch = messageStr.match(/?�프\s*(\d+)\s*\((\d+)\/(\d+)\)/) || 
                            messageStr.match(/(\d+)\((\d+)\/(\d+)\)/);
          
          if (pumpMatch) {
            progress.pump_id = pumpMatch[1]; // ?�프 ID
            progress.current_repeat = parseInt(pumpMatch[2], 10); // ?�재 반복 ?�수
            
            // �?반복 ?�수 처리 - 0?�면 1�??�정 (100% 채워�?
            const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부???�작?��?�?+1
            progress.total_repeats = totalRepeats || 1;
            
            console.log(`[?�스?? ?�프 ${progress.pump_id} ?�차모드 진행 ?�보: ${progress.current_repeat+1}/${progress.total_repeats} ??);
          }
        } else if (messageStr.includes('?�버?�모??)) {
          progress.mode = '?�버?�모??;
          
          // ?�버?�모???�프 ID �?반복 ?�수 ?�싱 - 개선???�규??          const pumpMatch = messageStr.match(/?�프\s*(\d+)\s*\((\d+)\/(\d+)\)/) || 
                            messageStr.match(/(\d+)\((\d+)\/(\d+)\)/);
                          
          if (pumpMatch) {
            progress.pump_id = pumpMatch[1]; // ?�프 ID
            progress.current_repeat = parseInt(pumpMatch[2], 10); // ?�재 반복 ?�수
            
            // �?반복 ?�수 처리 - 0?�면 1�??�정 (100% 채워�?
            const totalRepeats = parseInt(pumpMatch[3], 10) + 1; // 0부???�작?��?�?+1
            progress.total_repeats = totalRepeats || 1;
            
            console.log(`[?�스?? ?�프 ${progress.pump_id} ?�버?�모??진행 ?�보: ${progress.current_repeat+1}/${progress.total_repeats} ??);
          }
        }
        
        return progress;
      }
      
      return null;
    } catch (error) {
      console.error('진행 ?�보 ?�싱 ?�류:', error);
      return null;
    }
  };

  // ?�니메이?�을 ?�한 ?�태 추�?
  const [fillPercentage, setFillPercentage] = useState(0);
  
  // 길게 ?�르�?감�?�??�한 ?�?�머 ?�태 추�?
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [currentPressedPump, setCurrentPressedPump] = useState<number | null>(null);
  
  // ?�라?�언??ID ?�태 추�?
  const clientId = useRef(generateClientId());
  
  // 마�?�??�태 ?�데?�트 ?�간
  const [lastStateUpdate, setLastStateUpdate] = useState<Date | null>(null);
  
  // ?�결 ?�태 추�?
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    lastConnected: null,
    reconnecting: false
  });
  
  // ?�태 변�??�림???�한 ?�태 ?�데?�트
  const [notifications, setNotifications] = useState<Array<{
    message: string,
    timestamp: number,
    source?: string,
    type?: 'info' | 'warning' | 'error', // ?�림 ?�형 추�?
    pumpId?: number // ?�프 ID 추�?
  }>>([]);

  // ?�림 추�? ?�수 
  const addNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info', pumpId?: number) => {
    const notification = {
      message,
      timestamp: Date.now(),
      type,
      pumpId,
      source: '?�스??
    };
    
    // ?�림 목록??추�?
    setNotifications(prev => [...prev, notification]);
    
    // 15�????�림 ?�동 ?�거
    setTimeout(() => {
      setNotifications(prev => 
        prev.filter(n => n.timestamp !== notification.timestamp)
      );
    }, 15000);
    
    // MQTT�??�해 ?�림 공유 (?�른 ?�라?�언?�에게도 ?�림)
    if (mqttClient) {
      mqttClient.publish('tank-system/notifications', JSON.stringify({
        ...notification,
        clientId: clientId.current
      }));
    }
  };

  // ?�프 ?�위�??�래�??�태
  const [pumpSwitchPosition, setPumpSwitchPosition] = useState<Record<number, number>>({
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 // 모든 ?�프???�??초기 ?�위�??�치 ?�정
  });
  const [draggingPump, setDraggingPump] = useState<number | null>(null);
  const [resetTimers, setResetTimers] = useState<Record<number, NodeJS.Timeout | null>>({});
  const [resetSwitchPosition, setResetSwitchPosition] = useState<Record<number, number>>({});
  // ?�프 리셋 ?�래�??�태 추�?
  const [resetDragState, setResetDragState] = useState<Record<number, { dragging: boolean, position: number, timer: NodeJS.Timeout | null }>>({});
  
  // MQTT ?�라?�언???�결 ?�태 모니?�링
  useEffect(() => {
    if (!mqttClient) return;
    
    const subscribeTankTopics = () => {
      console.log('?�크 ?�픽 구독 �?..');
      
      // ?�요???�픽 구독
      for (let i = 1; i <= 6; i++) {
        // ?�크 ?�위 ?�픽 구독
        mqttClient.subscribe(`extwork/inverter${i}/tank${i}_level`);
        
        // 2�??�크 ?�위 문제 ?�결: 모든 ?�크-?�버??조합 구독
        for (let j = 1; j <= 6; j++) {
          if (i !== j) { // ?�에???��? 구독???�일 번호 조합?� ?�외
            mqttClient.subscribe(`extwork/inverter${i}/tank${j}_level`);
            console.log(`추�? 구독: extwork/inverter${i}/tank${j}_level`);
          }
        }
        
        // ?�버???�태 ?�픽 구독 (?�프 ?�태)
        mqttClient.subscribe(`extwork/inverter${i}/state`);
        
        // ?�버???�결 ?�태 ?�픽 구독
        mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
      }
      
      // 본탱???�위 ?�픽 구독
      mqttClient.subscribe('extwork/tank/level');
      
      // ?�동??공정 관???�픽 구독
      mqttClient.subscribe(AUTOMATION_STATUS_TOPIC);
      mqttClient.subscribe(PROCESS_PROGRESS_TOPIC);
      
      // 추출 명령 ?�력 ?�픽 구독 추�?
      mqttClient.subscribe('extwork/extraction/input');
      
      // STATUS ?�청 ?�거 - Redis?�서 ?�태�?가?�오?�록 변�?      // 밸브, ?�프 ?�태??MQTT 메시지�??�해 ?�데?�트
      console.log('Redis�??�해 ?�스???�태�?관리합?�다.');
    };
    
    // MQTT ?�라?�언???�결 ??구독 ?�정
    mqttClient.on('connect', () => {
      console.log('MQTT ?�결?? ?�크 ?�픽 구독');
      setConnectionStatus({
        connected: true,
        lastConnected: new Date(),
        reconnecting: false
      });
      
      subscribeTankTopics();
      
      // ?�결 복구 ???�림 추�?
      if (connectionStatus.lastConnected) {
        addNotification('MQTT ?�버 ?�결??복구?�었?�니??', 'info');
      }
    });
    
    // ?�결 ?��? 처리
    mqttClient.on('disconnect', () => {
      console.log('MQTT ?�결 ?��?');
      setConnectionStatus(prev => ({
        ...prev,
        connected: false
      }));
      
      // ?�결 ?��? ?�림 추�?
      addNotification('MQTT ?�버 ?�결???�어졌습?�다. 로컬 ?�태�??�영?�니??', 'warning');
    });
    
    // ?��? ?�결?�어 ?�는 경우 구독 ?�행
    if (mqttClient.connected) {
      subscribeTankTopics();
    }
    
    // ?�결 ?�벤??리스???�록
    mqttClient.on('connect', subscribeTankTopics);
    
    const handleMessage = (topic: string, message: Buffer) => {
      const messageStr = message.toString();
      console.log(`MQTT 메시지 ?�신: ${topic} - ${messageStr}`);
      
      try {
        // extwork/extraction/input ?�픽 처리 추�?
        if (topic === 'extwork/extraction/input') {
          console.log(`추출 ?�력 명령 ?�신: ${messageStr}`);
          
          try {
            // JSON ?�이???�싱 ?�도
            const jsonData = JSON.parse(messageStr);
            
            // 받�? 명령 ?�?�하�?(?�간 추�??�여 메시지 보�?)
            const timeStr = formatTimeStr();
            const displayMessage = `??공정 명령 ?�신: ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'} (${timeStr})`;
            
            // ?�림 추�?
            addNotification(`??공정 명령???�신?�었?�니?? ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'}`, 'info');
            
            // progress 메시지 ?�데?�트 - rawJson ?�드???�본 JSON ?�이???�??            if (setProgressMessages) {
              setProgressMessages(prevMessages => {
                const updatedMessages = [{
                  timestamp: Date.now(),
                  message: displayMessage,
                  rawJson: messageStr
                }, ...(prevMessages || [])];
                
                // 로컬 ?�토리�???진행 메시지 ?�??(?�결 ?��? ??복원??
                localStorage.setItem('lastProgressMessages', JSON.stringify(updatedMessages));
                
                return updatedMessages;
              });
            }
            
            // 로그 출력
            console.log(`추출 명령 처리?? ${displayMessage}`);
          } catch (parseError) {
            console.error('추출 ?�력 명령 ?�싱 ?�류:', parseError);
            
            // ?�싱 ?�패?�도 ?�림?� ?�워�?            addNotification('추출 명령???�신?��?�?처리?????�습?�다. ?�식???�인?�주?�요.', 'error');
            
            // ?�싱 ?�패 메시지 추�?
            if (setProgressMessages) {
              setProgressMessages(prevMessages => {
                const updatedMessages = [{
                  timestamp: Date.now(),
                  message: `?�류: ?�신??명령??JSON ?�식???�못?�었?�니??`,
                  rawJson: null
                }, ...(prevMessages || [])];
                
                // 로컬 ?�토리�???진행 메시지 ?�??(?�결 ?��? ??복원??
                localStorage.setItem('lastProgressMessages', JSON.stringify(updatedMessages));
                
                return updatedMessages;
              });
            }
          }
          return; // ?�른 ?�들???�출?��? ?�고 종료
        }
        // ?�픽???�른 처리
        else if (topic === 'tank-system/notifications') {
          const notification = JSON.parse(messageStr);
          
          // ?�신??발생?�킨 ?�림???�닌 경우?�만 처리
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
            
            // 15�????�림 ?�거
            setTimeout(() => {
              setNotifications(prev => 
                prev.filter(n => n.timestamp !== notification.timestamp)
              );
            }, 15000);
          }
        } else if (topic === 'extwork/tankMain/level') {
          // 본탱???�위 ?�보 ?�데?�트
          console.log(`본탱??메시지 ?�신: ${messageStr}`);
          
          // ?�간 문자???�성
          const timeStr = formatTimeStr();
          
          // ?�스??메시지 처리 (본탱?�용)
          if (messageStr.includes("?�스??메시지")) {
            // ?�스??메시지???�간 추�?
            const displayMessage = `본탱???�스??(${timeStr})`;
            console.log(`본탱???�스??메시지 변?? ${messageStr} -> ${displayMessage}`);
            setMainTankLevelMessage(displayMessage);
          } else {
            // ?�반 메시지 처리 - ?�간 ?�보 추�?
            const displayMessage = `${messageStr} (${timeStr})`;
            setMainTankLevelMessage(displayMessage);
            
            // 메시지???�라 ?�시�?변경하�??�크 ?�태??변경하지 ?�음
            // 중요: ?�기??tankData.mainTank�??�정?�면 ?�됨
          }
          
          console.log(`본탱??메시지 ?�데?�트 ?�료: ${messageStr}`);
          
          // ?�태 지?�을 ?�해 로컬 ?�토리�????�??          localStorage.setItem('mainTankLevelMessage', messageStr);
        } else if (topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/)) {
          // ?�크 ?�위 ?�픽 처리
          const tankLevelMatch = topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/);
          if (tankLevelMatch) {
            const inverterId = Number.parseInt(tankLevelMatch[1]);
            const tankId = Number.parseInt(tankLevelMatch[2]);
            
            console.log(`?�크 ?�위 메시지 처리 - ?�버??ID: ${inverterId}, ?�크 ID: ${tankId}, 메시지: ${messageStr}`);
            
            // ?�프 ?�태 ?�인
            const isPumpRunning = tankData?.tanks && tankData?.tanks[inverterId - 1]?.pumpStatus === "ON";
            console.log(`?�프 ?�태: ${isPumpRunning ? "ON" : "OFF"}`);
            
            // ?�간 문자???�성
            const timeStr = formatTimeStr();
            
            // 중요 메시지 ?��? ?�확?�게 체크 (?�확??메시지�?매칭)
            const isImportantMessage = (msg: string, tankId: number): boolean => {
              // 1�??�크?� ?�머지 ?�크�?구분
              if (tankId === 1) {
                // 1�??�크??중요 메시지
                return (
                  msg.includes("?�위:5%?�상") || 
                  msg.includes("?�위부�?5%미만") || 
                  msg.includes("가?�채?�짐") ||
                  msg.includes("채�?가??)
                );
            } else {
                // 2~6�??�크??중요 메시지
                return (
                  msg.includes("?�위부�?) || 
                  msg.includes("?�위?�상") || 
                  msg.includes("가?�채?�짐") || 
                  msg.includes("?�상?�위")
                );
              }
            };
            
            // 메시지 처리 - ?�스??박스???�시???�체 메시지
            let displayMessage = `${messageStr} (${timeStr})`;
            
            // ?�크 ?��????�시??메시지 (중요 메시지�?
            let tankDisplayMessage = "";
            
            // 중요 메시지 ?��? ?�인
            if (isImportantMessage(messageStr, tankId)) {
              // 중요 ?�태 메시지???�크 ?��? ?�시?�으�??�??              tankDisplayMessage = messageStr;
              console.log(`중요 ?�태 메시지 감�?: "${messageStr}" (?�크 ${tankId})`);
            }
            
            // ?�버�? ?�크 메시지 ?�데?�트 ???�재 ?�태 ?�인
            console.log(`?�크 ${tankId} 메시지 ?�데?�트 ???�재 ?�태:`, {
              ?�재메시지: tankMessages[tankId],
              ?�메?��?: displayMessage
            });
            
            // ?�크 메시지 ?�태 ?�데?�트 - ??종류??메시지 모두 ?�데?�트
            setTankMessages(prev => {
              const updated = {
                ...prev,
                [tankId]: displayMessage
              };
              console.log(`?�크 ${tankId} 메시지 ?�데?�트: "${displayMessage}"`);
              
              // ?�본 메시지�?localStorage???�?�하???�음 갱신까�? ?��?
              localStorage.setItem(`tank_${tankId}_last_message`, messageStr);
              console.log(`?�본 메시지 ?�?? tank_${tankId}_last_message = "${messageStr}"`);
              
              // ?�스??박스??메시지 ?�??              localStorage.setItem(`tank_${tankId}_message`, displayMessage);
              
              // 중요 메시지??별도�??�??(?�크 ?��? ?�시??
              if (tankDisplayMessage) {
                localStorage.setItem(`tank_${tankId}_important_message`, tankDisplayMessage);
                console.log(`중요 메시지 ?�??(?�크 ?��? ?�시??: tank_${tankId}_important_message = "${tankDisplayMessage}"`);
              }
              
              return updated;
            });
            
            // ?�버�? ?�재 ?�태 출력
            setTimeout(() => {
              console.log(`?�크 ${tankId} 메시지 ?�태 ?�데?�트 ?�료: "${displayMessage}"`);
              if (tankDisplayMessage) {
                console.log(`?�크 ${tankId} ?��? ?�시 메시지: "${tankDisplayMessage}"`);
              }
            }, 100);
          }
        } 
        // ?�른 ?�픽 처리...
        else if (topic.match(/extwork\/inverter(\d+)\/state/)) {
          // ?�버???�태 ?�픽 처리 - ?�프 ?�태�?변�? ?�상?� getTankColor ?�수가 처리
          const inverterId = parseInt(topic.match(/extwork\/inverter(\d+)\/state/)![1]);
          console.log(`?�버???�태 메시지 ?�신 - ?�버??ID: ${inverterId}, 메시지: ${messageStr}`);
          
          // 메시지???�라 ?�프 ?�태 ?�데?�트 (?�상 변경�? getTankColor ?�수가 ?�당)
          // 메시지가 "ON"???�함?�면 ?�프 ON, 그렇지 ?�으�?OFF
          const isOn = messageStr.toUpperCase().includes("ON");
          
          // ?�프 ?�태가 ON?�서 OFF�?변경된 경우 ?�림 추�?
          if (tankData?.tanks && tankData?.tanks[inverterId - 1]?.pumpStatus === "ON" && !isOn) {
            const timeStr = formatTimeStr();
            const pumpOffMessage = `?�프 ${inverterId} OFF: ${messageStr} (${timeStr})`;
            addNotification(pumpOffMessage, 'info', inverterId);
          }
        }
        // 카메???�태 ?�픽 처리 추�?
        else if (topic.match(/extwork\/cam(\d+)\/state/)) {
          const camNumber = parseInt(topic.match(/extwork\/cam(\d+)\/state/)![1]);
          console.log(`카메??${camNumber} ?�태 메시지 ?�신: ${messageStr}`);
          
          // ??컴포?�트?�서??카메???�태 처리�??��? ?�고,
          // ?�위 컴포?�트(Dashboard)?�서 처리?�도�??�니??
          // ?�기?�는 로그�?출력?�니??
        }
        // ?�동??공정 ?�태 ?�픽 처리
        else if (topic === AUTOMATION_STATUS_TOPIC) {
          try {
            const automationStatus = JSON.parse(messageStr);
            if (automationStatus.status === "sequence_started") {
              setAutomationProgress(`${automationStatus.sequenceName} ?�퀀???�작??);
            }
          } catch (error) {
            console.error('?�동???�태 메시지 ?�싱 ?�류:', error);
            // JSON ?�싱 ?�패 ???�본 메시지 그�?�??�??            setAutomationProgress(messageStr);
          }
        }
        // 공정 진행 ?�태 ?�픽 처리
        else if (topic === PROCESS_PROGRESS_TOPIC) {
          try {
            // 공정 진행 ?�태 메시지 처리
            console.log(`공정 진행 ?�태 메시지: ${messageStr}`);
            
            // JSON ?�싱 ?�도
            let jsonData: any;
            let isJsonFormat = false;
            
            try {
              if (messageStr.trim().startsWith('{') && messageStr.trim().endsWith('}')) {
                jsonData = JSON.parse(messageStr);
                isJsonFormat = true;
                console.log('JSON ?�식 진행 ?�이???�인:', jsonData);
              }
            } catch (jsonError) {
              console.log('JSON ?�싱 ?�패, ?�스???�식?�로 처리:', jsonError);
            }
            
            // 진행 ?�보 ?�싱 (JSON ?�는 ?�스???�식)
            let progressInfo: ProcessProgress | null = null;
            
            if (isJsonFormat && jsonData) {
              // JSON ?�식 처리 - ?�청???�식??맞춘 명시??처리
              progressInfo = {
                mode: jsonData.mode || '',
                elapsed_time: 0,
                remaining_time: 0,
                total_repeats: 1,
                current_repeat: 0,
                pump_id: undefined
              };
              
              // 경과 ?�간 추출 (?�자 ?�는 문자??s ?�식)
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
              
              // ?��? ?�간 추출 (?�자 ?�는 문자??s ?�식)
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
              
              // ?�프 ID 추출 (?? "1(10/11)" ?�식)
              if (jsonData.pump_id) {
                progressInfo.pump_id = String(jsonData.pump_id);
                
                // 반복 ?�보 ?�싱 (?? "1(10/11)" ???�프 1, ?�재 10?? �?11??
                const pumpMatch = String(jsonData.pump_id).match(/(\d+)\((\d+)\/(\d+)\)/);
                if (pumpMatch) {
                  // ?�재 반복 ?�수?� �?반복 ?�수 ?�정
                  progressInfo.current_repeat = parseInt(pumpMatch[2], 10);
                  progressInfo.total_repeats = parseInt(pumpMatch[3], 10);
                  
                  console.log(`[JSON] ?�프 ${pumpMatch[1]} 진행 ?�보: ${progressInfo.current_repeat}/${progressInfo.total_repeats} ??);
                }
              }
              
              // process_info ?�드?�서 반복 ?�보 ?�싱 (?? "C(6/10)")
              if (jsonData.process_info) {
                const processMatch = String(jsonData.process_info).match(/\w+\((\d+)\/(\d+)\)/);
                if (processMatch) {
                  if (!progressInfo.pump_id) {
                    // ?�시모드??경우 ?�는 pump_id가 ?�는 경우?�만 ?�정
                    progressInfo.current_repeat = parseInt(processMatch[1], 10);
                    progressInfo.total_repeats = parseInt(processMatch[2], 10);
                  }
                }
              }
              
              console.log('?�싱??JSON 진행 ?�보:', progressInfo);
            } else {
              // 기존 ?�스??기반 ?�싱 ?�용
              progressInfo = parseProgressMessage(messageStr);
            }
            
            // 진행 ?�보가 ?�으�??�태 ?�데?�트
            if (progressInfo) {
              console.log('최종 ?�싱??진행 ?�보:', progressInfo);
              
              // ?�프 ID가 ?�는 경우 (?�차모드, ?�버?�모??
              if (progressInfo.pump_id) {
                // ?�프 ID 추출 ("1(10/11)" ??"1")
                const pumpIdMatch = String(progressInfo.pump_id).match(/^(\d+)/);
                const pumpId = pumpIdMatch ? parseInt(pumpIdMatch[1], 10) : 0;
                
                if (pumpId > 0) {
                // 진행 ?�보 ?�태 ?�데?�트 ??로그
                console.log(`?�프 ${pumpId} 진행 ?�보 ?�데?�트 ??`, {
                  ?�재�? pumpProgressInfo[pumpId],
                  ?�값: progressInfo
                });
                
                // ?�프 ID???�당?�는 진행 ?�보 ?�데?�트
                setPumpProgressInfo(prev => {
                  const updated = { 
                    ...prev, 
                    [pumpId]: progressInfo 
                  };
                  
                  // ?�데?�트 ??�?기록
                  setTimeout(() => {
                    console.log(`?�프 ${pumpId} 진행 ?�보 ?�데?�트 ??`, updated[pumpId]);
                  }, 10);
                  
                  return updated;
                });
                
                // JSON?�로 직렬?�하??로컬 ?�토리�??�도 ?�??(?�버깅용)
                try {
                  localStorage.setItem(`pump_progress_${pumpId}`, JSON.stringify(progressInfo));
                    
                    // 진행�?계산?�여 ?�??(?�니메이?�용)
                    const totalTime = progressInfo.elapsed_time + progressInfo.remaining_time;
                    if (totalTime > 0) {
                      const fillPercent = 5 + (progressInfo.elapsed_time / totalTime) * 90;
                      localStorage.setItem(`pump_${pumpId}_fill_percent`, fillPercent.toString());
                    }
                } catch (e) {
                  console.error('진행 ?�보 로컬 ?�토리�? ?�???�패:', e);
                  }
                } else {
                  console.log('?�프 ID�?추출?????�거???�효?��? ?�음:', progressInfo.pump_id);
                }
              } else if (progressInfo.mode === '?�시모드') {
                // ?�시모드??경우 모든 ?�성 ?�프???�일??진행 ?�보 ?�용
                const activePumps = tankData?.tanks?.filter(t => t.pumpStatus === "ON").map(t => t.id) || [];
                
                if (activePumps.length > 0) {
                  console.log(`?�시모드: ${activePumps.length}�??�성 ?�프??진행 ?�보 ?�용`, activePumps);
                  
                  setPumpProgressInfo(prev => {
                    const updated = { ...prev };
                    
                    activePumps.forEach(pumpId => {
                      updated[pumpId] = progressInfo;
                      
                      // 로컬 ?�토리�??�도 ?�??(?�버깅용)
                      try {
                        localStorage.setItem(`pump_progress_${pumpId}`, JSON.stringify(progressInfo));
                        
                        // 진행�?계산?�여 ?�??(?�니메이?�용)
                        const totalTime = progressInfo.elapsed_time + progressInfo.remaining_time;
                        if (totalTime > 0) {
                          const fillPercent = 5 + (progressInfo.elapsed_time / totalTime) * 90;
                          localStorage.setItem(`pump_${pumpId}_fill_percent`, fillPercent.toString());
                        }
                      } catch (e) {
                        console.error('진행 ?�보 로컬 ?�토리�? ?�???�패:', e);
                      }
                    });
                    
                    return updated;
                  });
                } else {
                  console.log('?�시모드?��?�??�성?�된 ?�프가 ?�습?�다.');
                }
              } else {
                console.log('처리???�프 ID가 ?�거??모드가 지?�되지 ?�았?�니??');
              }
              
              // progress 메시지 ?�데?�트
              if (setProgressMessages) {
                setProgressMessages(prevMessages => {
                  const updatedMessages = [{
                    timestamp: Date.now(),
                    message: `진행 ?�태: ${messageStr}`,
                    rawJson: isJsonFormat ? messageStr : null
                  }, ...(prevMessages || [])];
                  
                  // 로컬 ?�토리�???진행 메시지 ?�??(?�결 ?��? ??복원??
                  localStorage.setItem('lastProgressMessages', JSON.stringify(updatedMessages));
                  
                  return updatedMessages;
                });
              }
              
            // ?�스??메시지 처리 (?�재 ?�퀀???�보 ?�싱)
            if (messageStr.includes("?�재 ?�퀀??")) {
              setCurrentSequenceInfo(messageStr.split('\n')[0]?.trim() || null);
            }
            
            // ?�음 ?�퀀???�보 ?�싱
            if (messageStr.includes("?�음 ?�퀀??")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith("?�음 ?�퀀??")) {
                  setNextSequenceInfo(line.trim());
                  break;
                }
              }
            }
            
            // ?�퀀???�계 ?�보 ?�싱 (n�??�료 / n�??�행�?/ n�??�기중 / n�??�류)
            if (messageStr.includes("�??�료") && messageStr.includes("�??�행�?)) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.includes("�??�료") && line.includes("�??�행�?)) {
                  setSequenceStatsInfo(line.trim());
                  break;
                }
              }
            }
            
              // ?�체 메시지�??�동??진행 ?�태 ?�시???�??            setAutomationProgress(messageStr);
            } else {
              console.log('진행 ?�보�??�싱?????�습?�다. ?�본 메시지:', messageStr);
              // ?�싱 ?�패 ?�에???�본 메시지 ?�??              setAutomationProgress(messageStr);
            }
          } catch (error) {
            console.error('공정 진행 ?�태 메시지 처리 ?�류:', error);
            setAutomationProgress(messageStr); // ?�류 발생 ???�본 메시지 그�?�??�??          }
        }
      } catch (error) {
        console.error('메시지 처리 ?�류:', error);
      }
    };
    
    // 메시지 ?�벤??리스???�록
    mqttClient.on('message', handleMessage);
    
    // 컴포?�트 ?�마?�트 ???�벤??리스???�거
    return () => {
      mqttClient.off('message', handleMessage);
      mqttClient.off('connect', subscribeTankTopics);
    };
  }, [mqttClient, tankData]);
  
  // 컴포?�트 마운?????�?�된 ?�태 복원 - IndexedDB 추�?
  useEffect(() => {
    // 로컬/?�션 ?�토리�??�서 먼�? 불러?�기
    const savedState = loadState();
    if (savedState && savedState.timestamp) {
      setLastStateUpdate(new Date(savedState.timestamp));
    }
    
    // IndexedDB?�서???�인 (??최신?????�음)
    loadFromIndexedDB()
      .then(indexedDBState => {
        if (indexedDBState && 
            indexedDBState.timestamp > (savedState?.timestamp || 0)) {
          // IndexedDB???�태가 ??최신?�면 ?�용
          setLastStateUpdate(new Date(indexedDBState.timestamp));
          
          // localStorage?� sessionStorage ?�데?�트
          localStorage.setItem('tankSystemState', JSON.stringify(indexedDBState));
          sessionStorage.setItem('tankSystemState', JSON.stringify(indexedDBState));
        }
      })
      .catch(error => {
        console.error('IndexedDB ?�태 로드 ?�패:', error);
      });
    
    // ?�라???�태 변??감�?
    const handleOnlineStatusChange = useCallback(() => {
      if (window.navigator.onLine && mqttClient) {
        // ?�라?�으�?복�? ??메시지 출력
        console.log('?�트?�크 ?�결??복구?�었?�니?? ?�스???�태�??�데?�트?�니??');
        
        // ?�결 ?�태 ?�데?�트
        setConnectionStatus({
          connected: true,
          lastConnected: new Date(),
          reconnecting: false
        });
        
        // ?�태 ?�데?�트 ?�림
        addNotification('?�트?�크 ?�결??복구?�었?�니?? ?�스???�태가 ?�데?�트?�니??', 'info');
      } else if (!window.navigator.onLine) {
        // ?�프?�인 ?�태�??�환 ??        console.log('?�트?�크 ?�결???�겼?�니??');
        
        // ?�결 ?�태 ?�데?�트
        setConnectionStatus(prev => ({
          ...prev,
          connected: false,
          reconnecting: false
        }));
        
        // ?�결 ?��? ?�림
        addNotification('?�트?�크 ?�결???�겼?�니?? ?�프?�인 모드�??�환?�니??', 'warning');
      }
    }, [mqttClient]);

    // ?�라???�프?�인 ?�태 ?�벤??리스???�록
    useEffect(() => {
    window.addEventListener('online', handleOnlineStatusChange);
      window.addEventListener('offline', handleOnlineStatusChange);
      
      // 초기 ?�태 ?�인
      if (!window.navigator.onLine) {
        setConnectionStatus(prev => ({
          ...prev,
          connected: false,
          reconnecting: false
        }));
      }
    
    return () => {
      window.removeEventListener('online', handleOnlineStatusChange);
        window.removeEventListener('offline', handleOnlineStatusChange);
    };
    }, [handleOnlineStatusChange]);
  }, [mqttClient]);
  
  // 리셋 ?�래�??�작
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
  
  // 리셋 ?�래�??�동
  const handleResetDragMove = (e: MouseEvent | TouchEvent, pumpId: number) => {
    if (!resetDragState[pumpId]?.dragging) return;
    
    // 마우???�는 ?�치 X 좌표
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    
    // 리셋 버튼 ?�소???�치 구하�?    const resetButton = document.getElementById(`reset-btn-${pumpId}`);
    if (!resetButton) return;
    
    const rect = resetButton.getBoundingClientRect();
    const buttonWidth = rect.width;
    const maxDrag = 50; // 최�? ?�래�?거리
    
    // ?�래�??�치 계산 (0~1 ?�이 �?
    const dragStartX = rect.left + buttonWidth / 2; // 버튼 중앙
    const dragDistance = Math.max(0, Math.min(maxDrag, clientX - dragStartX)); // 0 ~ maxDrag
    const position = dragDistance / maxDrag; // 0 ~ 1
    
    setResetDragState(prev => {
      const currentState = prev[pumpId] || { dragging: true, position: 0, timer: null };
      
      // ?��? ?�?�머가 ?�고, ?�치가 0.8(80%) ?�상?�면 ?�?�머 ?��?
      if (currentState.timer && position >= 0.8) {
        return prev;
      }
      
      // ?�?�머가 ?��?�??�치가 0.8 미만?�면 ?�?�머 취소
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
      
      // ?�?�머가 ?�고 ?�치가 0.8 ?�상?�면 ?�?�머 ?�작
      if (!currentState.timer && position >= 0.8) {
        const timer = setTimeout(() => {
          console.log(`?�프 ${pumpId} 리셋 명령 ?�행 (2�???`);
          if (onPumpReset) {
            onPumpReset(pumpId);
            
            // "3" 명령 발행
            if (mqttClient) {
              const pumpTopic = `extwork/pump${pumpId}/cmd`;
              mqttClient.publish(pumpTopic, "3");
              
              // ?�림 발행
              const notification = {
                type: 'pump-reset',
                pumpId: pumpId,
                timestamp: Date.now(),
                clientId: clientId.current,
                message: `?�프 ${pumpId} 리셋 명령(3)???�행?�었?�니??`
              };
              
              mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
            }
          }
          
          // ?�?�머 리셋 �??�태 초기??          setResetDragState(prev => ({
            ...prev,
            [pumpId]: {
              dragging: false,
              position: 0,
              timer: null
            }
          }));
        }, 2000); // 2�????�행
        
        return {
          ...prev,
          [pumpId]: {
            ...currentState,
            position,
            timer
          }
        };
      }
      
      // �??�의 경우 ?�치�??�데?�트
      return {
        ...prev,
        [pumpId]: {
          ...currentState,
          position
        }
      };
    });
  };

  // 리셋 ?�래�?종료
  const handleResetDragEnd = (pumpId: number) => {
    const currentState = resetDragState[pumpId];
    if (!currentState?.dragging) return;
    
    // ?�벤??리스???�거
    document.removeEventListener('mousemove', (e) => handleResetDragMove(e, pumpId));
    document.removeEventListener('touchmove', (e) => handleResetDragMove(e, pumpId));
    document.removeEventListener('mouseup', () => handleResetDragEnd(pumpId));
    document.removeEventListener('touchend', () => handleResetDragEnd(pumpId));
    
    // ?�?�머가 ?�고, ?�치가 0.8 ?�상?�면 ?�?�머 ?��? (계속 ?�행)
    if (currentState.timer && currentState.position >= 0.8) {
      return;
    }
    
    // ?�?�머가 ?��?�??�치가 0.8 미만?�면 ?�?�머 취소
    if (currentState.timer) {
      clearTimeout(currentState.timer);
    }
    
    // ?�태 초기??    setResetDragState(prev => ({
      ...prev,
      [pumpId]: {
        dragging: false,
        position: 0,
        timer: null
      }
    }));
  };
  
  // 밸브 ?�태 변�??�들??- MQTT ?�림 추�?
  const handleValveChange = (newState: string) => {
    // ?�태 변�??�청
    onValveChange(newState);
    
    // MQTT�??�한 ?�림 발행
    if (mqttClient) {
      const notification = {
        type: 'valve-change',
        valveState: newState,
        timestamp: Date.now(),
        clientId: clientId.current,
        message: `밸브 ?�태가 변경되?�습?�다: ${newState}`
      };
      
      mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
    }
    
    // ?�태 변�??�간 ?�데?�트
    setLastStateUpdate(new Date());
    
    // ?�태 ?�??    saveState({
      ...tankData,
      valveState: newState
    });
  };
  
  // ?�프 버튼 마우???�운 ?�들??- MQTT ?�림 추�?
  const handlePumpMouseDown = (pumpId: number) => {
    setCurrentPressedPump(pumpId);
    
    // 길게 ?�르�?감�? ?�?�머 ?�정 (3�???리셋 명령 발생)
    const timer = setTimeout(() => {
      console.log(`?�프 ${pumpId} 길게 ?�름 감�? - 리셋 명령 ?�행`);
      if (onPumpReset) {
        onPumpReset(pumpId);
        
        // MQTT�??�한 ?�림 발행
        if (mqttClient) {
          const notification = {
            type: 'pump-reset',
            pumpId,
            timestamp: Date.now(),
            clientId: clientId.current,
            message: `?�프 ${pumpId} 리셋 명령???�행?�었?�니??`
          };
          
          mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
        }
      }
      setCurrentPressedPump(null);
    }, 3000);
    
    setLongPressTimer(timer);
  };
  
  // ?�프 버튼 마우?????�들??- MQTT ?�림 추�?
  const handlePumpMouseUp = (pumpId: number) => {
    // ?�?�머가 ?�으�?취소 (길게 ?�르�?취소)
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    // ?�재 ?�른 ?�프가 ?�고, 마우?????�벤?��? 발생???�프?� 같으�??�릭?�로 간주
    if (currentPressedPump === pumpId) {
      console.log(`?�프 ${pumpId} ?�릭 - ?��? 명령 ?�행`);
      if (onPumpToggle) {
        onPumpToggle(pumpId);
        
        // MQTT�??�한 ?�림 발행
        if (mqttClient) {
          const notification = {
            type: 'pump-toggle',
            pumpId,
            timestamp: Date.now(),
            clientId: clientId.current,
            message: `?�프 ${pumpId} ?�태가 ?��??�었?�니??`
          };
          
          mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
        }
      }
    }
    
    setCurrentPressedPump(null);
  };
  
  // 마우?��? ?�프 밖으�??�갔?????�들??  const handlePumpMouseLeave = () => {
    // ?�?�머가 ?�으�?취소
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    setCurrentPressedPump(null);
  };
  
  // ?�치 ?�벤???�들??(모바??
  const handlePumpTouchStart = (pumpId: number) => {
    handlePumpMouseDown(pumpId);
  };
  
  const handlePumpTouchEnd = (pumpId: number) => {
    handlePumpMouseUp(pumpId);
  };
  
  const handlePumpTouchCancel = () => {
    handlePumpMouseLeave();
  };

  // 추출 진행 ?�황?�서 ?�크 채�? 비율 계산 - 로직 개선
  useEffect(() => {
    if (progressMessages.length > 0) {
      const latestProgress = progressMessages[0]; // 가??최신 메시지 ?�용 (배열 �?번째 ?�소)
      const latestMessage = latestProgress.message || '';
      console.log('최신 진행 메시지:', latestMessage);
      
      // ?�양???�식??진행 메시지 처리 개선
      try {
        // 1. "?��?: XXs | 경과: YYs" ?�식 ?�턴 ?�인
        const remainingMatch = latestMessage.match(/?��?:\s*(\d+)s/) || latestMessage.match(/?�음:\s*(\d+)s/) || latestMessage.match(/remaining:\s*(\d+)s/);
        const elapsedMatch = latestMessage.match(/경과:\s*(\d+)s/) || latestMessage.match(/진행:\s*(\d+)s/) || latestMessage.match(/elapsed:\s*(\d+)s/);
        
        // 2. 직접?�인 ?�자 ?�턴 ?�인 ("50/100�? 같�? ?�식)
        const directProgressMatch = latestMessage.match(/(\d+)\/(\d+)(�?s)/);
      
      if (remainingMatch && elapsedMatch) {
        const remaining = parseInt(remainingMatch[1], 10);
        const elapsed = parseInt(elapsedMatch[1], 10);
        const total = remaining + elapsed;
        
        if (!isNaN(remaining) && !isNaN(elapsed) && total > 0) {
          // ?�재 경과 ?�간�??�체 ?�간??비율 계산 (최�? 100%)
          const percentage = Math.min((elapsed / total) * 100, 100);
          setFillPercentage(percentage);
          console.log(`채�? ?�니메이??진행�??�데?�트: ${percentage.toFixed(1)}% (경과: ${elapsed}s, ?�체: ${total}s)`);
        }
        } else if (directProgressMatch) {
          // 직접?�인 진행 ?�보 ?�싱 (?? "50/100�?)
          const current = parseInt(directProgressMatch[1], 10);
          const total = parseInt(directProgressMatch[2], 10);
          
          if (!isNaN(current) && !isNaN(total) && total > 0) {
            const percentage = Math.min((current / total) * 100, 100);
            setFillPercentage(percentage);
            console.log(`채�? ?�니메이??진행�??�데?�트(직접 ?�식): ${percentage.toFixed(1)}% (?�재: ${current}, ?�체: ${total})`);
          }
        } else {
          // 3. JSON ?�식??경우 ?�싱 ?�도
          try {
            if (latestProgress.rawJson) {
              const jsonData = JSON.parse(latestProgress.rawJson);
              
              // process_time�?total_remaining???�용??진행�?계산 추�?
              if (jsonData.process_time !== undefined && jsonData.total_remaining !== undefined) {
                const processTime = parseInt(jsonData.process_time.toString().replace('s', ''), 10);
                const totalRemaining = parseInt(jsonData.total_remaining.toString().replace('s', ''), 10);
                
                if (!isNaN(processTime) && !isNaN(totalRemaining)) {
                  // ?�체 처리 ?�간 - ?��? 처리???�간�??��? ?�간????                  const totalTime = processTime;
                  // 진행�?= ((?�체 처리 ?�간 - ?��? ?�간) / ?�체 처리 ?�간) * 100
                  const completedTime = Math.max(0, processTime - totalRemaining);
                  const percentage = Math.min((completedTime / processTime) * 100, 100);
                  setFillPercentage(percentage);
                  console.log(`채�? ?�니메이??진행�??�데?�트(process_time): ${percentage.toFixed(1)}% (처리 ?�간: ${processTime}s, ?�료 ?�간: ${completedTime}s, ?��? ?�간: ${totalRemaining}s)`);
                }
              } else if (jsonData.elapsedTime !== undefined && jsonData.totalTime !== undefined) {
                const elapsed = parseInt(jsonData.elapsedTime, 10);
                const total = parseInt(jsonData.totalTime, 10);
                
                if (!isNaN(elapsed) && !isNaN(total) && total > 0) {
                  const percentage = Math.min((elapsed / total) * 100, 100);
                  setFillPercentage(percentage);
                  console.log(`채�? ?�니메이??진행�??�데?�트(JSON): ${percentage.toFixed(1)}% (경과: ${elapsed}s, ?�체: ${total}s)`);
                }
              } else if (jsonData.percent !== undefined) {
                // ?�센??직접 ?�싱
                const percentStr = jsonData.percent.toString().replace('%', '');
                const percentage = parseFloat(percentStr);
                
                if (!isNaN(percentage)) {
                  setFillPercentage(percentage);
                  console.log(`채�? ?�니메이??진행�??�데?�트(?�센??: ${percentage.toFixed(1)}%`);
                }
              }
            }
          } catch (jsonError) {
            // JSON ?�싱 ?�패?�도 무시
          }
        }
      } catch (error) {
        console.error('진행 메시지 ?�싱 ?�류:', error);
      }
      
      // 4. ?�프가 ON ?�태?�면 기본�?50%�??�정 (채�? ?�니메이?��? 보이지�??�확??진행률�? ?????�음)
      const anyPumpActive = tankData?.tanks?.some(tank => tank.pumpStatus === "ON");
      if (anyPumpActive && fillPercentage === 0) {
        setFillPercentage(50);
        console.log('?�프 ?�성??감�?, 기본 채�? ?�니메이???�용 (50%)');
      }
    }
  }, [progressMessages, tankData?.tanks]);

  // ?�크 ?�태???�른 ?�상 반환 - ?�프 ?�태 최우???�용
  const getTankColor = (status: string | undefined, tankId: number) => {
    // status가 undefined??경우 기본�??�정
    if (status === undefined) {
      console.log(`getTankColor - ?�크 ${tankId}, ?�태: undefined, 기본�?'empty' ?�용`);
      status = 'empty';
    }
    
    // ?�당 ?�크?� ?�결???�프???�태 ?�인
    let pumpStatus = "OFF";
    if (tankId >= 1 && tankId <= 6 && tankData?.tanks && tankData?.tanks.length >= tankId) {
      const tank = tankData?.tanks[tankId - 1];
      pumpStatus = tank?.pumpStatus || "OFF";
    }
    
    console.log(`getTankColor - ?�크 ${tankId}, ?�태: ${status}, ?�프: ${pumpStatus}`);
    
    // 1. ?�프가 켜져 ?�으�??��????�두리로 변�?- ??로직??최우??    if (pumpStatus === "ON") {
      return "fill-white stroke-yellow-400 stroke-[3]";
    }
    
    // 2. ?�프가 꺼져 ?�으�??�태???�라 ?�상 결정 (메시지가 ?�???�상 변경하지 ?�음)
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

  // ?�크 ?�태???�른 ?�세 메시지 반환
  const getStatusMessage = (status: string, level: number, tankId?: number) => {
    // 본탱??tankId가 0)??경우 mainTankMessage ?�선 ?�시
    if (tankId === 0 && mainTankMessage) {
      return mainTankMessage;
    }

    // tankId가 ?�효??경우 ?�전???�?�된 메시지가 ?�는지 ?�인
    if (tankId !== undefined) {
      const savedMessage = localStorage.getItem(`tank_${tankId}_last_message`);
      if (savedMessage) {
        return savedMessage;
      }
    }

    // 기본 ?�크 ?�태 메시지 로직
    switch (status) {
      case "full":
        return "가?�채?�짐";
      case "empty":
        return "준비중"; // 초기값을 "준비중"?�로 변�?      case "filling":
        return `채워지??�?(${Math.round(fillPercentage)}%)`;
      default:
        return `5% ?�상 ?�여`;
    }
  };

  // 채워지???�니메이?�을 ?�한 ?��???계산 ?�수 개선
  const getFillingStyle = (status: string, tankId: number, operationTime?: number) => {
    // ?�버�? ?�수 ?�출 ?�보 추�?
    console.log(`[getFillingStyle] ?�출: ?�크 ${tankId}, ?�태=${status}, ?�동?�간=${operationTime || 'N/A'}`);

    // ?�프가 꺼져 ?�으�??�니메이???�음
    if (status !== "ON") {
      console.log(`[getFillingStyle] ?�크 ${tankId}???�프가 꺼져 ?�어 채�? ?�음`);
      return {};
    }

    // ?�당 ?�크?� ?�결???�프???�태 ?�인
    const pumpStatus = tankData?.tanks && tankData?.tanks[tankId - 1]?.pumpStatus || "OFF";
    console.log(`[getFillingStyle] ?�크 ${tankId}???�프 ?�태: ${pumpStatus}`);
    
    // ?�프 진행 ?�보 가?�오�?      const pumpProgress = pumpProgressInfo[tankId];
    console.log(`[getFillingStyle] ?�프 ${tankId}??pumpProgressInfo:`, pumpProgress);
      
      if (pumpProgress) {
      // 간단???�니메이??로직 ?�용 - elapsed_time�?remaining_time??비율�?계산
      let elapsedTime = 0;
      let totalTime = 0;
      
      // elapsed_time �?추출
      if (pumpProgress.elapsed_time !== undefined) {
        if (typeof pumpProgress.elapsed_time === 'number') {
          elapsedTime = pumpProgress.elapsed_time;
        } else if (typeof pumpProgress.elapsed_time === 'string') {
          // 문자?�에???�자 추출 (?? "54s" -> 54)
          const matchElapsed = String(pumpProgress.elapsed_time).match(/(\d+)/);
          if (matchElapsed) {
            elapsedTime = parseInt(matchElapsed[1], 10);
          }
        }
      }
      
      // remaining_time �?추출
      if (pumpProgress.remaining_time !== undefined) {
        if (typeof pumpProgress.remaining_time === 'number') {
          totalTime = elapsedTime + pumpProgress.remaining_time;
        } else if (typeof pumpProgress.remaining_time === 'string') {
          // 문자?�에???�자 추출 (?? "6s" -> 6)
          const matchRemaining = String(pumpProgress.remaining_time).match(/(\d+)/);
          if (matchRemaining) {
            const remainingTime = parseInt(matchRemaining[1], 10);
            totalTime = elapsedTime + remainingTime;
          }
        }
      }
      
      console.log(`[getFillingStyle] ?�프 ${tankId} ?�간 계산: elapsedTime=${elapsedTime}, totalTime=${totalTime}`);
      
      // ?�이?��? ?�거??totalTime??0?�면 기본�??�용
      if (totalTime <= 0) {
        console.log(`[getFillingStyle] ?�크 ${tankId}???�간 ?�이?��? ?�거??0?�니?? 기본�??�용`);
        return {
          clipPath: 'inset(95% 0 0 0)', // 기본 5% 채�?
          transition: 'clip-path 1s linear',
          backgroundColor: 'rgba(59, 130, 246, 0.3)'
        };
      }
      
      // 진행�?계산 (백분??
      let fillPercent = Math.min((elapsedTime / totalTime) * 100, 100);
      
      // 최소 5% 채�? 보장 (?�각???�드�?
      fillPercent = Math.max(fillPercent, 5);
      
      console.log(`[간단??채�? 계산] ?�크 ${tankId}: ${fillPercent.toFixed(1)}% (경과:${elapsedTime}�? ?�체:${totalTime}�?`);
      
      // 주의: ?�기??직접 ?�태�??�데?�트?�면 무한 ?�더링이 발생?�니??
      // ?�역 ?�태 ?�데?�트??useEffect?�서 ?�행?�야 ?�니??
      
        return {
          clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
          transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: fillPercent // 백분??값도 ?�께 반환
        };
      }
      
      // pumpProgressInfo가 ?�을 ?�만 operationTime ?�용 (fallback)
      if (operationTime && operationTime > 0) {
        console.log(`?�프 ${tankId}??진행 ?�보가 ?�어 operationTime ?�용: ${operationTime}�?);
        
        // ?�재 경과 ?�간 계산 (�?메시지 ?�간부???�재까�?)
        const startTime = tankData?.tanks?.[tankId - 1]?.startTime || Date.now();
        const elapsedTime = (Date.now() - startTime) / 1000; // �??�위
        
        // 가???�간??100%�??�여 경과 ?�간??비�???채�? 비율 계산
      let fillPercent = Math.min((elapsedTime / operationTime) * 100, 100);
      // 최소 5%??채워지?�록 (?�각???�드�?
      fillPercent = Math.max(fillPercent, 5);
            
      console.log(`[?��?방식] ?�크 ${tankId} 채�?�? ${fillPercent.toFixed(1)}%`);
              
              return {
                clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
                transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: fillPercent // 백분??값도 ?�께 반환
              };
      }
      
    // ?�프가 켜져 ?��?�?진행 ?�보가 ?�는 경우 기본 채�? (?�각???�드�?
    if (pumpStatus === "ON") {
      console.log(`[기본 채�?] ?�크 ${tankId}??켜져 ?��?�?진행 ?�보 ?�음 - 10% 채�? ?�용`);
      
      return {
        clipPath: 'inset(90% 0 0 0)', // 기본 10% 채�?
        transition: 'clip-path 1s linear',
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fillPercent: 10 // 백분??값도 ?�께 반환
      };
    }
    
    // �???경우(?�프 꺼져 ?�음)
    return { fillPercent: 0 };
  };

  // 밸브 ?�태 ?�싱 (4?�리 문자?�에??�????�리�??�용) - 개선
  const parseValveState = () => {
    // ?�버깅용 로그 추�?
    console.log('[?�버�? parseValveState ?�출??);
    console.log('[?�버�? ?�재 tankData:', tankData);
    console.log('[?�버�? ?�재 밸브 ?�태:', tankData.valveState);
    console.log('[?�버�? 밸브 ?�태 메시지:', tankData.valveStatusMessage);
    
    // tankData???�효??검??    if (!tankData || !tankData.valveState) {
      console.log('[?�버�? tankData ?�는 valveState가 ?�효?��? ?�음, ?�?�된 ?�태 ?�인');
      // ?�?�된 ?�태 ?�인
      const savedState = loadState();
      if (savedState && savedState.valveState) {
        console.log('?�?�된 밸브 ?�태 발견:', savedState.valveState);
        return {
          valve1: parseInt(savedState.valveState[0]) || 0,
          valve2: parseInt(savedState.valveState[1]) || 0,
          valve1Desc: savedState.valveADesc || (parseInt(savedState.valveState[0]) === 1 ? '추출?�환' : '?�체?�환'),
          valve2Desc: savedState.valveBDesc || (parseInt(savedState.valveState[1]) === 1 ? 'ON' : 'OFF')
        };
      }
      
      // 기본�?반환
      return { valve1: 0, valve2: 0, valve1Desc: '?�체?�환', valve2Desc: 'OFF' };
    }
    
    // ?�수 케?�스: 0100 (밸브2 OFF, 밸브1 ON)
    if (tankData.valveState === '0100') {
      console.log('?�수 케?�스 감�?: 0100 - 밸브2 OFF, 밸브1 ON');
      // localStorage??밸브 ?�태 ?�??(?�퍼 ?�수 ?�용)
      saveState(tankData);
      return {
        valve1: 0, // 밸브2 OFF (3way)
        valve2: 1, // 밸브1 ON (2way)
        valve1Desc: tankData.valveADesc || '본탱???�집',
        valve2Desc: tankData.valveBDesc || 'ON'
      };
    }
    
    // valveStatusMessage�??�선?�으�??�인?�여 ?�태 ?�싱
    if (tankData.valveStatusMessage) {
      console.log('[?�버�? valveStatusMessage�??�태 ?�싱:');
      // 'valveA=ON' ?�는 'valveA=OFF' ?�함 ?��? ?�확??체크
      const valveAState = tankData.valveStatusMessage.includes('valveA=ON') ? 1 : 0;
      const valveBState = tankData.valveStatusMessage.includes('valveB=ON') ? 1 : 0;
      
      // 밸브 ?�명 ?�스??- dashboard.tsx?�서 ?�싱??�??�용
      let valveADesc = tankData.valveADesc || '';
      let valveBDesc = tankData.valveBDesc || '';
      
      // ?�명???�으�??�태???�라 기본�??�정
      if (!valveADesc) {
        valveADesc = valveAState === 1 ? '추출?�환' : '?�체?�환';
      }
      if (!valveBDesc) {
        valveBDesc = valveBState === 1 ? 'ON' : 'OFF';
      }
      
      // ?�버깅을 ?�한 로그
      console.log(`밸브 ?�태 ?�싱 결과: valveA=${valveAState} (${valveADesc}), valveB=${valveBState} (${valveBDesc})`);
      
      // 밸브 ?�태�?로컬 ?�토리�????�??(?�퍼 ?�수 ?�용)
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
    
    // valveState??길이 ?�인
    if (typeof tankData.valveState !== 'string' || tankData.valveState.length < 2) {
      console.warn('valveState ?�식 ?�류:', tankData.valveState);
      
      // localStorage???�?�된 ?�태 ?�인
      const savedState = loadState();
      if (savedState && savedState.valveState && typeof savedState.valveState === 'string' && savedState.valveState.length >= 2) {
        console.log('localStorage?�서 밸브 ?�태 복원:', savedState.valveState);
        const v1 = parseInt(savedState.valveState[0]) || 0;
        const v2 = parseInt(savedState.valveState[1]) || 0;
        return {
          valve1: v1,
          valve2: v2,
          valve1Desc: v1 === 1 ? '추출?�환' : '?�체?�환',
          valve2Desc: v2 === 1 ? 'ON' : 'OFF'
        };
      }
      
      // 기본�?반환
      return { valve1: 0, valve2: 0, valve1Desc: '?�체?�환', valve2Desc: 'OFF' };
    }
    
    // 기존 로직 ?��? (fallback)
    if (tankData.valveState.length !== 4) {
      // localStorage???�?�된 ?�태가 ?�으�??�용 (?�퍼 ?�수 ?�용)
      const savedState = loadState();
      if (savedState && savedState.valveState && savedState.valveState.length === 4) {
        console.log('localStorage?�서 밸브 ?�태 복원:', savedState.valveState);
        const v1 = parseInt(savedState.valveState[0]);
        const v2 = parseInt(savedState.valveState[1]);
        return {
          valve1: v1,
          valve2: v2,
          valve1Desc: v1 === 1 ? '추출?�환' : '?�체?�환',
          valve2Desc: v2 === 1 ? 'ON' : 'OFF'
        };
      }
      
      // localStorage???�?�된 밸브 ?�태 메시지가 ?�으�??�용 (?�퍼 ?�수 ?�용)
      const savedValveStatusMessage = loadState()?.valveStatusMessage;
      if (savedValveStatusMessage) {
        console.log('localStorage?�서 밸브 ?�태 메시지 복원:', savedValveStatusMessage);
        const valveAState = savedValveStatusMessage.includes('valveA=ON') ? 1 : 0;
        const valveBState = savedValveStatusMessage.includes('valveB=ON') ? 1 : 0;
        return {
          valve1: valveAState,
          valve2: valveBState,
          valve1Desc: valveAState === 1 ? '추출?�환' : '?�체?�환',
          valve2Desc: valveBState === 1 ? 'ON' : 'OFF'
        };
      }
      
      // 최소 ?�전 길이 보장
      const safeValveState = (tankData.valveState + '0000').slice(0, 4);
      console.log('?�전?�게 보정??밸브 ?�태:', safeValveState);
      
      const v1 = parseInt(safeValveState[0]) || 0;
      const v2 = parseInt(safeValveState[1]) || 0;
      
      return {
        valve1: v1, 
        valve2: v2,
        valve1Desc: v1 === 1 ? '추출?�환' : '?�체?�환',
        valve2Desc: v2 === 1 ? 'ON' : 'OFF'
      };
    }

    const v1 = parseInt(tankData.valveState[0]);
    const v2 = parseInt(tankData.valveState[1]);

    // ?�재 ?�태�?localStorage???�??(?�퍼 ?�수 ?�용)
    saveState(tankData);

    const result = {
      valve1: v1,
      valve2: v2,
      valve1Desc: v1 === 1 ? '추출?�환' : '?�체?�환',
      valve2Desc: v2 === 1 ? 'ON' : 'OFF'
    };
    
    console.log('[?�버�? parseValveState 결과:', result);
    return result;
  };

  const { valve1, valve2, valve1Desc, valve2Desc } = parseValveState();

  // 경로 ?�성???��? ?�인
  const isPathActive = (path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1") => {
    console.log(`[?�버�? isPathActive ?�출: ${path}, valve1=${valve1}, valve2=${valve2}`);
    if (path === "tank6ToMain") return valve1 === 0;
    if (path === "tank6ToTank1") return valve1 === 1;
    if (path === "mainToTank1") return valve2 === 1;
    return false;
  };

  // 밸브 ?�태???�라 ?�인 ?�시 ?��? 결정?�는 ?�수 추�?
  const shouldShowLine = (path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1") => {
    console.log(`[?�버�? shouldShowLine ?�출: ${path}, valve1=${valve1}, valve2=${valve2}`);
    if (path === "tank6ToMain") {
      const result = valve1 === 0;
      console.log(`[?�버�? tank6ToMain ?�인 ?�시 ?��?: ${result}`);
      return result;
    }
    if (path === "tank6ToTank1") {
      const result = valve1 === 1;
      console.log(`[?�버�? tank6ToTank1 ?�인 ?�시 ?��?: ${result}`);
      return result;
    }
    if (path === "mainToTank1") {
      const result = valve2 === 1;
      console.log(`[?�버�? mainToTank1 ?�인 ?�시 ?��?: ${result}`);
      return result;
    }
    return false;
  };

  // 밸브 ?�태???�른 ?�이???�상 가?�오�?  const getValvePipeColor = (path: "tank6ToMain" | "tank6ToTank1" | "mainToTank1") => {
    const isActive = isPathActive(path);
    console.log(`[?�버�? getValvePipeColor: ${path}, ?�성??${isActive}`);
    return isActive ? "stroke-blue-500" : "stroke-gray-300";
  };

  // ?�프 ?�태???�른 ?�이???�상 가?�오�?  const getPipeColor = (fromTank: number, toTank: number) => {
    // 1-based ?�덱?��? 0-based�?변??    const fromIndex = fromTank - 1;
    const toIndex = toTank - 1;

    // ?�당 구간???�결???�프???�태 ?�인
    // ?? 2-3 구간?� 3�??�프???�결 (?�덱??2)
    const pumpIndex = toIndex >= 0 && toIndex < tankData?.tanks?.length ? toIndex : fromIndex;
    const pumpStatus = tankData?.tanks?.[pumpIndex]?.pumpStatus || "OFF";

    return pumpStatus === "ON" ? "stroke-blue-500" : "stroke-gray-300";
  };

  // 밸브 ?�태???�른 ?�스??반환
  const getValveStateText = () => {
    const { valve1, valve2 } = parseValveState();
    
    if (valve1 === 1) {
      return "추출 ?�환";
    } else if (valve2 === 1) {
      return "?�체 ?�환 (?�림)";
    } else {
      return "밸브 ?�힘";
    }
  };

  // ?�음 밸브 ?�태 가?�오�?(?�환)
  const getNextValveState = () => {
    console.log('?�재 밸브 ?�태:', tankData.valveState);
    let nextState = '';
    
    // 0100 ?�태?�서 ?�릭?�면 1000 ?�태�?변�?    if (tankData.valveState === "0100") nextState = "1000";
    // 1000 ?�태?�서 ?�릭?�면 0000 ?�태�?변�?    else if (tankData.valveState === "1000") nextState = "0000";
    // 0000 ?�태?�서 ?�릭?�면 0100 ?�태�?변�?    else if (tankData.valveState === "0000") nextState = "0100";
    else nextState = "0100"; // 기본�?    
    // 변경된 ?�태�?localStorage???�??(?�퍼 ?�수 ?�용)
    saveState({
      ...tankData,
      valveState: nextState
    });
    console.log('?�음 밸브 ?�태 localStorage???�??', nextState);
    
    return nextState;
  };

  // ?�형 ?�이?�웃???�한 계산
  const centerX = 500;
  const centerY = 350; // 본탱???�치�??�로 조정
  const mainTankRadius = 70;
  const circleRadius = 250;
  const tankWidth = 100;
  const tankHeight = 100;
  const pumpRadius = 30;
  const pumpDistance = 60;

  // ?�형?�로 배치???�크 ?�치 계산
  const calculatePosition = (index: number, total: number) => {
    // ?�작 각도�?조정?�여 1�??�크가 ?�단???�도�???    const startAngle = -Math.PI / 2;
    const angle = startAngle + (index * 2 * Math.PI) / total;
    return {
      x: centerX + circleRadius * Math.cos(angle),
      y: centerY + circleRadius * Math.sin(angle),
      angle: angle,
    };
  };

  // ?�크 ?�치 계산
  const tankPositions = Array(6)
    .fill(0)
    .map((_, i) => {
      const pos = calculatePosition(i, 6);
      return {
        ...pos,
        label: `${i + 1}�??�크`,
      };
    });

  // 본탱???�치 - ?�각?�으�?변경하�??�기 ?��?, ?�비 ?��?/?�이 감소
  const mainTankPosition = { x: centerX, y: centerY, label: "본탱??, width: 220, height: 150 };

  // 밸브 ?�치 계산 ?�정
  // 2way 밸브(밸브1) ?�치 계산 ?�정 - 본탱?�에????멀?��?�? 1�??�크 ?�스?�박?��? 보이?�록 ?�래�?  const valve2Position = {
    x: centerX,
    y: centerY - 100, // 본탱???�쪽??배치?�되 ???�래�?조정 (기존 -150?�서 -100?�로)
  };

  // 3way 밸브(밸브2) ?�치 계산 - 6�??�크 바로 ?�측??배치?�고 ?�간 ?�래�??�림
  const valve3wayPosition = {
    x: tankPositions[5].x + tankWidth / 2 + 50, // 6�??�크 바로 ?�측?�로 ?�동
    y: tankPositions[5].y + 20, // 6�??�크?� ?�일???�이?�서 ?�간 ?�래�?조정
  };

  // ?�프 ?�치 계산 ?�수 ?�정 - ?�재 ?�크?� ?�음 ?�크 ?�이???�치?�도�?  const calculatePumpPosition = (currentTankIndex: number, nextTankIndex: number) => {
    const currentTank = tankPositions[currentTankIndex];
    const nextTank = tankPositions[nextTankIndex];

    // ???�크 간의 중간 지?�에 ?�프 배치
    return {
      x: (currentTank.x + nextTank.x) / 2,
      y: (currentTank.y + nextTank.y) / 2,
      angle: currentTank.angle
    };
  };

  // ?�크 �??�이??경로 계산
  const calculatePipePath = (fromIndex: number, toIndex: number) => {
    const from = tankPositions[fromIndex];
    const to = tankPositions[toIndex];

    // 직선 경로
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  };

  // 6�??�크?�서 3way 밸브(밸브2)로의 경로 - ?�측?�로 짧게 ?�결
  const calculate6ToValvePath = () => {
    // 6�??�크?�서 ?�측?�로 짧게 ?�온 ??3way 밸브�??�결
    const startX = tankPositions[5].x + tankWidth / 2;
    const startY = tankPositions[5].y;
    
    // 6�??�크?� 밸브2가 같�? ?�이???�으므�?직선?�로 ?�결
    return `M ${startX} ${startY} H ${valve3wayPosition.x - 30}`;
  };

  // 3way 밸브(밸브2)?�서 본탱?�로??경로 - ?�체?�환???�만 ?�시
  const calculate3wayToMainPath = () => {
    // 밸브2?�서 본탱???�쪽 가?�자리까지 직선 ?�결
    const tankLeft = mainTankPosition.x - mainTankPosition.width / 2;
    const tankMid = mainTankPosition.y;
    
    // 경로 조정: 밸브2?�서 ?��???중간 지?�에??꺾여 본탱?�로
    return `M ${valve3wayPosition.x} ${valve3wayPosition.y} 
            H ${(valve3wayPosition.x + tankLeft) / 2}
            L ${tankLeft + 20} ${tankMid}`;
  };

  // 본탱?�에??2way 밸브(밸브1)로의 경로 - ??�� ?�시
  const calculateMainToTank1Path = () => {
    // 본탱???�쪽 가?�자리에???�작?�여 2way 밸브까�? ?�직 ?�결 - 짧게 ?�되 보이?�록
    const tankEdgeY = mainTankPosition.y - mainTankPosition.height / 2;
    // 본탱???�단?�서 밸브1까�???거리??30%�??�결?�여 ?�에 보이�???    const lineLength = Math.abs(valve2Position.y - tankEdgeY) * 0.3;
    return `M ${mainTankPosition.x} ${tankEdgeY} V ${tankEdgeY - lineLength}`;
  };

  // 2way 밸브(밸브1)?�서 ?�프1 ?�구 쪽으로의 경로 - ??�� ?�시
  const calculate2wayToPump1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    
    // 밸브1?�서 출발?�여 ?�프1 방향?�로 가??경로 - 밸브1 ?�치가 변경되?�으므�?경로??조정
    return `M ${valve2Position.x} ${valve2Position.y} 
            V ${(valve2Position.y + pump1Pos.y) / 2}
            L ${pump1Pos.x} ${pump1Pos.y}`;
  };

  // 3way 밸브(밸브2)?�서 ?�프 1로의 경로 - 추출?�환???�만 ?�시
  const calculate3wayToPump1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    
    // ?�작?�과 ?�점 ?�이 벡터 계산
    const dx = pump1Pos.x - valve3wayPosition.x;
    const dy = pump1Pos.y - valve3wayPosition.y;
    
    // 벡터 길이
    const length = Math.sqrt(dx*dx + dy*dy);
    
    // 밸브2?�서 ?�프1 방향?�로 85% ?�도 ?�동??지?�으�??�결 (기존 50%?�서 증�?)
    const endX = valve3wayPosition.x + dx * 0.85;
    const endY = valve3wayPosition.y + dy * 0.85;
    
    return `M ${valve3wayPosition.x} ${valve3wayPosition.y} L ${endX} ${endY}`;
  };

  // ?�류 지?�에???�프1로의 경로
  const calculateMergeToPump1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    return `M ${pump1Pos.x} ${pump1Pos.y} L ${pump1Pos.x} ${pump1Pos.y}`; // 변�??�는 경로
  };

  // 1�??�프?�서 1�??�크로의 경로 (직선 ?�결)
  const calculatePump1To1Path = () => {
    const pump1Pos = calculatePumpPosition(5, 0);
    return `M ${pump1Pos.x} ${pump1Pos.y} L ${tankPositions[0].x} ${tankPositions[0].y}`;
  };

  // 1�??�크?�서 2�??�프로의 경로
  const calculate1ToPump2Path = () => {
    const pump2Pos = calculatePumpPosition(0, 1);
    return `M ${tankPositions[0].x} ${tankPositions[0].y} L ${pump2Pos.x} ${pump2Pos.y}`;
  };

  // 2�??�프?�서 2�??�크로의 경로
  const calculatePump2To2Path = () => {
    const pump2Pos = calculatePumpPosition(0, 1);
    return `M ${pump2Pos.x} ${pump2Pos.y} L ${tankPositions[1].x} ${tankPositions[1].y}`;
  };

  // 밸브 ?�태 메시지?�서 ?�요??부분만 추출
  const extractValveStatus = (message: string) => {
    if (!message) return "";
    
    // valveA?� valveB 부분만 추출?�는 ?�규??    const valveAMatch = message.match(/valveA=[^,]+/);
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

  // ?�살???�치 계산
  const calculateArrowPosition = (path: string, progress = 0.5) => {
    // SVG 경로 객체 ?�성
    const dummySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathElement.setAttribute("d", path);
    dummySvg.appendChild(pathElement);
    
    // 경로??길이 구하�?    const pathLength = pathElement.getTotalLength();
    
    // ?�정 ?�치????구하�?(기본�? 경로??중간??
    const point = pathElement.getPointAtLength(pathLength * progress);
    
    return { x: point.x, y: point.y };
  };

  // ?�이?��? ?�성???�태?��? ?�인
  const isPipeActive = (pumpIndex: number, valveCondition: boolean = true) => {
    return tankData?.tanks && 
           tankData?.tanks[pumpIndex] && 
           tankData?.tanks[pumpIndex].pumpStatus === "ON" && 
           valveCondition;
  };

  // 추출 명령 중복 ?�행 방�?�??�한 ?�태
  const [commandLock, setCommandLock] = useState<Record<string, boolean>>({});

  // 추출 ?�어 명령 발행 ?�수 (?�바?�싱 ?�용)
  const handleExtractionCommand = (command: string) => {
    if (!mqttClient || commandLock[command]) return;
    
    // ?�속 ?�릭 방�?�??�한 ???�정
    setCommandLock(prev => ({ ...prev, [command]: true }));
    
      mqttClient.publish("extwork/extraction/input", command);
      
      // MQTT ?�림 발행
      const notification = {
        type: 'extraction-command',
        command,
        timestamp: Date.now(),
        clientId: clientId.current,
        message: `추출 명령??발행?�었?�니?? ${command}`
      };
      
      mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
      
      // ?�릭 ?�과
      const commandElement = document.getElementById(`extraction-command-${command}`);
      if (commandElement) {
        commandElement.classList.add('bg-blue-200');
        setTimeout(() => {
          commandElement?.classList.remove('bg-blue-200');
        }, 300);
      }
    
    // ?�정 ?�간 ?????�제 (500ms)
    setTimeout(() => {
      setCommandLock(prev => ({ ...prev, [command]: false }));
    }, 500);
  };
  
  // ?�위�??�래�??�작
  const handlePumpSwitchStart = (pumpId: number, e: React.MouseEvent | React.TouchEvent) => {
    setDraggingPump(pumpId);
    document.addEventListener('mousemove', handlePumpSwitchMove);
    document.addEventListener('touchmove', handlePumpSwitchMove);
    document.addEventListener('mouseup', handlePumpSwitchEnd);
    document.addEventListener('touchend', handlePumpSwitchEnd);
  };
  
  // ?�위�??�래�??�동
  const handlePumpSwitchMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingPump) return;
    
    // 마우???�는 ?�치 Y 좌표
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // ?�프 ?�소???�치 구하�?    const pumpElement = document.getElementById(`pump-${draggingPump}`);
    if (!pumpElement) return;
    
    const rect = pumpElement.getBoundingClientRect();
    const switchHeight = 40; // ?�위�??�이
    
    // ?�위�??�치 계산 (0: 기본, -1: ?�로 ?�동)
    let position = 0;
    if (clientY < rect.top - switchHeight/2) {
      position = -1; // ?�로 ?�동
      
      // 리셋 ?�?�머 ?�정 (3�???리셋 명령)
      if (!resetTimers[draggingPump]) {
        console.log(`?�프 ${draggingPump} ?�위�??�로 ?�동 - 리셋 ?�?�머 ?�작`);
        const timer = setTimeout(() => {
          console.log(`?�프 ${draggingPump} 리셋 명령 ?�행`);
          if (onPumpReset) {
            onPumpReset(draggingPump);
            
            // "3" 명령 발행 - 리셋?�는 3 코드 ?�용
            if (mqttClient) {
              const pumpTopic = `extwork/pump${draggingPump}/cmd`;
              mqttClient.publish(pumpTopic, "3");
              
              // ?�림 발행
              const notification = {
                type: 'pump-reset',
                pumpId: draggingPump,
                timestamp: Date.now(),
                clientId: clientId.current,
                message: `?�프 ${draggingPump} 리셋 명령(3)???�행?�었?�니??`
              };
              
              mqttClient.publish('tank-system/notifications', JSON.stringify(notification));
            }
          }
          
          // ?�?�머 리셋 �??�태 초기??          setResetDragState(prev => ({
            ...prev,
            [draggingPump]: {
              dragging: false,
              position: 0,
              timer: null
            }
          }));
        }, 2000); // 2�????�행
        
        setResetTimers(prev => ({...prev, [draggingPump]: timer}));
      }
    } else {
      // ?�?�머 취소
      if (resetTimers[draggingPump]) {
        clearTimeout(resetTimers[draggingPump]!);
        setResetTimers(prev => ({...prev, [draggingPump]: null}));
      }
    }
    
    setPumpSwitchPosition(prev => ({...prev, [draggingPump]: position}));
  };
  
  // ?�위�??�래�?종료
  const handlePumpSwitchEnd = (e: MouseEvent | TouchEvent) => {
    if (!draggingPump) return;
    
    // ?�벤??리스???�거
    document.removeEventListener('mousemove', handlePumpSwitchMove);
    document.removeEventListener('touchmove', handlePumpSwitchMove);
    document.removeEventListener('mouseup', handlePumpSwitchEnd);
    document.removeEventListener('touchend', handlePumpSwitchEnd);
    
    // ?�?�머 취소
    if (resetTimers[draggingPump]) {
      clearTimeout(resetTimers[draggingPump]!);
      setResetTimers(prev => ({...prev, [draggingPump]: null}));
    }
    
    // 모든 ?�프???�???�일?�게 처리
    if (onPumpToggle) {
      // ?�재 ?�치가 0?�면 ?��?
      if (pumpSwitchPosition[draggingPump] === 0) {
        onPumpToggle(draggingPump);
      }
    }
    
    // ?�치 초기??    setPumpSwitchPosition(prev => ({...prev, [draggingPump]: 0}));
    setDraggingPump(null);
  };

  // 최초 로드 �??�?�된 ?�태 복원
  useEffect(() => {
    // 중요: 비동�??�수�?별도�??�언?�여 ?�행
    const loadSavedState = async () => {
      try {
        if (mqttClient) {
          // ?�버 �?로컬 ?�토리�??�서 ?�태 로드 ?�도
          const savedState = await loadInitialState();
          
          if (savedState) {
            console.log('?�?�된 ?�태�?복원?�니??');
            
            try {
              // ?�?�된 ?�태�??�데?�트 로직 (?? onValveChange ?�출 ??
              if (savedState.valveState && onValveChange) {
                onValveChange(savedState.valveState);
              }
              
              // ?�요??경우 ?�태 ?�데?�트�?MQTT�?브로?�캐?�트
              if (mqttClient.connected) {
                mqttClient.publish('tank-system/state-loaded', JSON.stringify({
                  clientId: clientId.current,
                  timestamp: Date.now(),
                  source: 'localStorage'
                }));
              }
            } catch (updateError) {
              console.error('?�태 복원 �??�류 발생:', updateError);
              // ?�류가 발생?�도 컴포?�트 초기?��? 계속 진행?�니??
            }
          }
        }
      } catch (error) {
        console.error('?�태 로드 �??�상�?못한 ?�류:', error);
        // ?�류가 발생?�도 ?�이 계속 ?�행?�도�??�니??
      }
    };
    
    // ?�전?�게 초기???�수 ?�출
    loadSavedState().catch(error => {
      console.error('?�태 로드 ?�로?�스 ?�체 ?�패:', error);
    });
  }, [mqttClient, onValveChange]);

  const [mainTankLevelMessage, setMainTankLevelMessage] = useState<string>("");
  const [tankMessages, setTankMessages] = useState<Record<number, string>>({});
  const [mainTankMessage, setMainTankMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [processRunning, setProcessRunning] = useState<boolean>(false);

  // 컴포?�트 마운????로컬 ?�토리�??�서 ?�로?�스 ?�행 ?�태 ?�인
  useEffect(() => {
    const savedProcessState = localStorage.getItem('process-running-state');
    if (savedProcessState) {
      try {
        const state = JSON.parse(savedProcessState);
        setProcessRunning(state.running);
      } catch (error) {
        console.error('?�?�된 ?�로?�스 ?�태 ?�싱 ?�류:', error);
      }
    }
  }, []);

  // 컴포?�트 마운?????�크 메시지 초기??  useEffect(() => {
    console.log('TankSystem 컴포?�트 마운??- tankData:', tankData);
    
    // tankData?�서 ?�크 메시지 ?�데?�트
    if (tankData.tankMessages) {
      setTankMessages(tankData.tankMessages);
    }
    
    // 메인 ?�크 메시지 ?�데?�트
    if (tankData?.mainTankMessage) {
      console.log('메인 ?�크 메시지 ?�데?�트 감�?:', tankData?.mainTankMessage);
      setMainTankMessage(tankData?.mainTankMessage);
    }
  }, [tankData]);

  // ?�러 메시지 구독 처리
  useEffect(() => {
    if (!mqttClient) return;

    const handleErrorMessage = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/error') {
        const messageStr = message.toString();
        console.log('?�러 메시지 ?�신:', messageStr);
        
        // ?�간 추�?
        const timeStr = formatTimeStr();
        setErrorMessage(`${messageStr} (${timeStr})`);
        
        // 5�???메시지 ?�거
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

  // ?�로?�스 ?�료 감�? �?버튼 ?�태 ?�데?�트
  useEffect(() => {
    if (!mqttClient) return;

    const handleProcessCompletion = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        
        // ?�료 메시지 ?�인
        if (messageStr.includes("공정 종료") || 
            messageStr.includes("?�이???�료") || 
            messageStr.includes("JSON 명령???�공?�으�?처리")) {
          // ?�로?�스 종료 ?�태�?변�?          setProcessRunning(false);
          localStorage.setItem('process-running-state', JSON.stringify({ running: false }));
          console.log('?�로?�스 ?�료 감�?, ?�태 초기??);
        }
      } else if (topic === 'extwork/automation/control') {
        const messageStr = message.toString();
        
        try {
          const command = JSON.parse(messageStr);
          if (command.command === 'start' || command.command === 'play') {
            // ?�로?�스 ?�작 ?�태�?변�?            setProcessRunning(true);
            localStorage.setItem('process-running-state', JSON.stringify({ running: true }));
            console.log('?�로?�스 ?�작 감�?, ?�태 ?�성??);
          } else if (command.command === 'stop' || command.command === 'reset') {
            // ?�로?�스 종료 ?�태�?변�?            setProcessRunning(false);
            localStorage.setItem('process-running-state', JSON.stringify({ running: false }));
            console.log('?�로?�스 중�? 감�?, ?�태 초기??);
          }
        } catch (e) {
          console.error('?�동??명령 ?�싱 ?�류:', e);
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

  // ?�수 extraction ?�픽 메시지 처리 추�?
  useEffect(() => {
    if (!mqttClient) return;

    const handleExtractionMessage = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        console.log('추출 메시지 ?�신:', messageStr);
        
        // ?�정 ?�료 메시지 ?�인
        if (messageStr.includes("공정 종료") || 
            messageStr.includes("?�이???�료") || 
            messageStr.includes("JSON 명령???�공?�으�?처리?�었?�니??)) {
          // ?�간 추�?
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

  // ?�간 ?�맷 ?�수 추�?
  const formatTimeStr = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ampm = hours >= 12 ? '?�후' : '?�전';
    const hour12 = hours % 12 || 12; // 12?�간??변??    return `${ampm} ${hour12}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // MQTT 메시지 ?�싱 �?처리�??�한 추�? ?�태
  const [extractionCompleteMessage, setExtractionCompleteMessage] = useState<string>("");
  const [automationStatus, setAutomationStatus] = useState<string>("");
  const [automationWaitTime, setAutomationWaitTime] = useState<{value: number, endTime: number} | null>(null);

  // ?�동??공정 ?�태 �??�기시�?모니?�링 MQTT 메시지 처리 추�?
  useEffect(() => {
    if (!mqttClient) return;

    const handleAutomationMessage = (topic: string, message: Buffer) => {
      // ?�동??공정 관??메시지 처리
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        console.log('?�동??메시지 ?�신:', messageStr);
        
        // JSON 명령 ?�공 메시지 처리
        if (messageStr.includes("JSON 명령???�공?�으�?처리?�었?�니??)) {
          const timeStr = formatTimeStr();
          setAutomationStatus(`공정 진행�?(${timeStr})`);
        }
        // 공정 종료 메시지 처리
        else if (messageStr.includes("공정 종료") || 
                messageStr.includes("공정종료") || 
                messageStr.includes("?�료") || 
                messageStr.includes("process completed") || 
                messageStr.includes("extraction complete")) {
          const timeStr = formatTimeStr();
          setExtractionCompleteMessage(`공정 종료 (${timeStr})`);
          setAutomationStatus(`공정 종료??(${timeStr})`);
        }
      }
      
      // ?�동??공정 ?�기시�?메시지 처리
      if (topic === 'extwork/automation/status') {
        try {
          const data = JSON.parse(message.toString());
          if (data.waiting && data.waitTime) {
            const waitTime = parseInt(data.waitTime);
            const endTime = Date.now() + (waitTime * 1000);
            setAutomationWaitTime({value: waitTime, endTime: endTime});
            
            // ?�기시�?카운?�다??            const countdownInterval = setInterval(() => {
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
          console.error('?�동???�태 메시지 ?�싱 ?�류:', e);
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

  // ?�프 ?�결 ?�태 관�?추�?
  const [pumpConnectionStates, setPumpConnectionStates] = useState<{[key: number]: {ble: boolean, mqtt: boolean}}>({
    1: { ble: false, mqtt: false },
    2: { ble: false, mqtt: false },
    3: { ble: false, mqtt: false },
    4: { ble: false, mqtt: false },
    5: { ble: false, mqtt: false },
    6: { ble: false, mqtt: false }
  });
  
  // ?�프 ?�결 ?�태 구독 ?�정
  useEffect(() => {
    if (!mqttClient) return;
    
    // �??�프??overallstate ?�픽 구독
    for (let i = 1; i <= 6; i++) {
      mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
    }
    
    // 메시지 ?�들??추�?
    const handleConnectionStateMessage = (topic: string, message: Buffer) => {
      try {
        const pumpMatch = topic.match(/extwork\/inverter(\d+)\/overallstate/);
        if (!pumpMatch) return;
        
        const pumpId = parseInt(pumpMatch[1]);
        const messageStr = message.toString();
        
        // ?�결 ?�태 감�?
        if (messageStr.includes("MQTT �?BLE 모두 ?�결??)) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ble: true, mqtt: true }
          }));
        } else if (messageStr.includes("MQTT�??�결??) || messageStr.includes("MQTT ?�경?�로 ?�환??) || messageStr.includes("MQTT ?�경?�서 ?�작 �?)) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], mqtt: true, ble: false }
          }));
        } else if (messageStr.includes("BLE�??�결??) || messageStr.includes("BLE ?�경?�로 ?�환??) || messageStr.includes("집단지???�트?�크")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], mqtt: false, ble: true }
          }));
        } else if (messageStr.includes("MQTT �?BLE 모두 ?�결 ?��?")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { mqtt: false, ble: false }
          }));
        } else if (messageStr.includes("BLE ?�라?�언???�결??)) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], ble: true }
          }));
        } else if (messageStr.includes("BLE ?�라?�언???�결 ?��?")) {
          setPumpConnectionStates(prev => ({
            ...prev,
            [pumpId]: { ...prev[pumpId], ble: false }
          }));
        }

        // Dashboard?�서 ?�정??connectionType 기반 ?�태 ?�데?�트
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
      // 구독 ?�제
      for (let i = 1; i <= 6; i++) {
        mqttClient.unsubscribe(`extwork/inverter${i}/overallstate`);
      }
      mqttClient.off('message', handleConnectionStateMessage);
    };
  }, [mqttClient, tankData]);
  
  // ?�결 ?�태 ?�이�??�더�??�수
  const renderConnectionIcons = (pumpId: number, x: number, y: number) => {
    const connections = pumpConnectionStates[pumpId] || { ble: false, mqtt: false };
    
    // ?�의 가?�자리에 10?��? 2??방향?�로 ?�치 계산
    const radius = pumpRadius - 2; // ???��????�짝 ?�어?�게
    
    // WiFi 10??방향, 블루?�스 2??방향
    // Math.PI * 5/6?� 150?? Math.PI * 1/6?� 30??    const wifiX = x + radius * Math.cos(Math.PI * 7/6); // 10??방향?�로 ?�정 (210??
    const wifiY = y + radius * Math.sin(Math.PI * 7/6);
    const bleX = x + radius * Math.cos(Math.PI * 11/6); // 2??방향?�로 ?�정 (330??
    const bleY = y + radius * Math.sin(Math.PI * 11/6);

  return (
      <g className="connection-icons">
        {/* WiFi/MQTT ?�이�?- 10??방향 */}
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
        
        {/* 블루?�스 ?�이�?- 2??방향 - ?�상???��??�으�?변�?*/}
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

  // ?�동??공정 진행 ?�보 ?�태
  const [automationProgress, setAutomationProgress] = useState<string | null>(null);
  const [currentSequenceInfo, setCurrentSequenceInfo] = useState<string | null>(null);
  const [nextSequenceInfo, setNextSequenceInfo] = useState<string | null>(null);
  const [sequenceStatsInfo, setSequenceStatsInfo] = useState<string | null>(null);

  // MQTT 구독 �?메시지 처리 - ?�동??공정 진행 ?�보 추�?
  useEffect(() => {
    if (!mqttClient) return;
    
    const subscribeTankTopics = () => {
      // 기존 구독
      mqttClient.subscribe('extwork/+/state');
      mqttClient.subscribe('extwork/+/temp');
      mqttClient.subscribe('extwork/+/alert');
      mqttClient.subscribe('extwork/+/temp');
      mqttClient.subscribe('extwork/+/message');
      
      // ?�동??공정 관???�픽 구독
      mqttClient.subscribe(AUTOMATION_STATUS_TOPIC); 
      mqttClient.subscribe(PROCESS_PROGRESS_TOPIC);
      
      console.log('MQTT ?�픽 구독 ?�료');
    };
    
    // ?�결 ???�픽 구독
    if (mqttClient.connected) {
      subscribeTankTopics();
    } else {
      mqttClient.on('connect', subscribeTankTopics);
    }
    
    // 메시지 처리 ?�들??    const handleMessage = (topic: string, message: Buffer) => {
      try {
        const messageStr = message.toString();
        
        // 기존 ?�픽 처리 로직...
        
        // ?�동??공정 ?�태 ?�픽 처리
        if (topic === AUTOMATION_STATUS_TOPIC) {
          try {
            const automationStatus = JSON.parse(messageStr);
            if (automationStatus.status === "sequence_started") {
              setAutomationProgress(`${automationStatus.sequenceName} ?�퀀???�작??);
            }
          } catch (error) {
            console.error('?�동???�태 메시지 ?�싱 ?�류:', error);
            // JSON ?�싱 ?�패 ???�본 메시지 그�?�??�??            setAutomationProgress(messageStr);
          }
        }
        
        // 공정 진행 ?�태 ?�픽 처리
        if (topic === PROCESS_PROGRESS_TOPIC) {
          try {
            // ?�스??메시지 처리 (?�재 ?�퀀???�보 ?�싱)
            if (messageStr.includes("?�재 ?�퀀??")) {
              setCurrentSequenceInfo(messageStr.split('\n')[0]?.trim() || null);
            }
            
            // ?�음 ?�퀀???�보 ?�싱
            if (messageStr.includes("?�음 ?�퀀??")) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith("?�음 ?�퀀??")) {
                  setNextSequenceInfo(line.trim());
                  break;
                }
              }
            }
            
            // ?�퀀???�계 ?�보 ?�싱 (n�??�료 / n�??�행�?/ n�??�기중 / n�??�류)
            if (messageStr.includes("�??�료") && messageStr.includes("�??�행�?)) {
              const lines = messageStr.split('\n');
              for (const line of lines) {
                if (line.includes("�??�료") && line.includes("�??�행�?)) {
                  setSequenceStatsInfo(line.trim());
                  break;
                }
              }
            }
            
            // ?�체 메시지�??�동??진행 ?�태 ?�시???�??            setAutomationProgress(messageStr);
          } catch (error) {
            console.error('공정 진행 ?�태 메시지 ?�싱 ?�류:', error);
            setAutomationProgress(messageStr); // ?�류 발생 ???�본 메시지 그�?�??�??          }
        }
        
        // ... 기존 ?�픽 처리 로직 계속
        
      } catch (error) {
        console.error('메시지 처리 ?�류:', error);
      }
    };
    
    // 메시지 ?�벤??리스???�록
    mqttClient.on('message', handleMessage);
    
    // 컴포?�트 ?�마?�트 ???�벤??리스???�거
    return () => {
      mqttClient.off('message', handleMessage);
      mqttClient.off('connect', subscribeTankTopics);
    };
  }, [mqttClient, tankData]);

  // ?�동??공정 ?�태 관�?부�??�데?�트
  const [automationProcessList, setAutomationProcessList] = useState<any[]>([]);
  const [currentAutomationProcess, setCurrentAutomationProcess] = useState<any>(null);

  // ?�동??공정 목록 �?진행 ?�태 가?�오�?  useEffect(() => {
    // ?�동??공정 목록 가?�오�?    const fetchAutomationProcesses = async () => {
      try {
        const response = await fetch('/api/automation');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            setAutomationProcessList(data.data);
            
            // ?�행 중인 공정???�는지 ?�인
            const runningProcess = data.data.find((p: any) => p.isRunning);
            if (runningProcess) {
              setCurrentAutomationProcess(runningProcess);
              
              // ?�동??공정 ?�태 ?�데?�트
              const timeStr = formatTimeStr();
              setAutomationStatus(`공정 진행�? ${runningProcess.name} (${timeStr})`);
            }
          }
        }
      } catch (error) {
        console.error('?�동??공정 목록 가?�오�??�류:', error);
      }
    };
    
    // 초기 로드 �?주기???�데?�트
    fetchAutomationProcesses();
    const intervalId = setInterval(fetchAutomationProcesses, 30000); // 30초마???�데?�트
    
    return () => clearInterval(intervalId);
  }, []);

  // ?�스???�태 ?�보 ?�역 ?�더�??�수 (컴포?�트 ?�더�?부�?근처??추�?)
  const renderSystemStatusInfo = () => {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-2">
        <div className="bg-indigo-50 py-1 px-2 text-xs font-semibold text-indigo-700 rounded-t-lg border-b border-gray-200">
          ?�스???�태 ?�보
        </div>
        <div className="p-2 text-xs max-h-[120px] overflow-y-auto">
          {tankData.valveStatusMessage && (
            <div className="bg-yellow-50 p-1 rounded text-[9px] border border-yellow-100 mb-1 overflow-x-auto whitespace-nowrap">
              <span className="font-semibold">밸브 ?�세:</span> {tankData.valveStatusMessage}
            </div>
          )}
          
          {/* ?�동??공정 ?�태 ?�시 */}
          {(automationStatus || extractionCompleteMessage || currentAutomationProcess) && (
            <div className={`p-1 rounded text-[9px] border mb-1 overflow-x-auto whitespace-nowrap ${
              extractionCompleteMessage ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'
            }`}>
              <span className="font-semibold">?�동??공정:</span> {
                currentAutomationProcess ? 
                `${currentAutomationProcess.name} (${currentAutomationProcess.isRunning ? '?�행�? : '?�기중'})` : 
                (extractionCompleteMessage || automationStatus)
              }
            </div>
          )}
          
          {/* ?�동???�업 목록 ?�시 */}
          {automationProcessList.length > 0 && (
            <div className="bg-blue-50 p-1 rounded text-[9px] border border-blue-100 mb-1 overflow-x-auto">
              <span className="font-semibold">?�업 목록:</span> {
                automationProcessList.slice(0, 3).map((process, index) => (
                  <span key={process.id} className={`${process.isRunning ? 'text-green-700 font-semibold' : ''}`}>
                    {process.name}{index < Math.min(automationProcessList.length, 3) - 1 ? ', ' : ''}
                  </span>
                ))
              }
              {automationProcessList.length > 3 ? ` ??${automationProcessList.length - 3}�? : ''}
            </div>
          )}
          
          {/* ?�기시�??�시 */}
          {automationWaitTime && (
            <div className="bg-indigo-50 p-1 rounded text-[9px] border border-indigo-100 overflow-x-auto whitespace-nowrap">
              <span className="font-semibold">?�음 ?�업 ?��?�?</span> {automationWaitTime.value}�??�음
            </div>
          )}
        </div>
      </div>
    );
  }

  // ?�크�?중요 메시지 ?�턴 ?�의
  const getTankImportantMessagePattern = (tankId: number): RegExp => {
    if (tankId === 1) {
      // 1�??�크??중요 메시지 ?�턴
      return /(?�위:5%?�상|?�위부�?5%미만|가?�채?�짐|채�?가??/;
    } else {
      // 2~6�??�크??중요 메시지 ?�턴
      return /(?�위부�??�위?�상|가?�채?�짐|?�상?�위)/;
    }
  };

  // �??�크 ?�더�?- �?채�? ?�니메이?�을 ?�함???�크�?그립?�다
  const renderTank = (tankId: number, x: number, y: number, label: string) => {
    const tankData1 = tankData?.tanks?.find(t => t.id === tankId);
    const status = tankData1?.status || "empty";
    const level = tankData1?.level || 0;
    const isPumpOn = tankData1?.pumpStatus === "ON";
    
    // ?�크 메시지 가?�오�?- 모든 메시지 (?�스??박스??
    const tankMessage = tankData?.tankMessages?.[tankId];
    
    // ?�즈 ?�전?�게 operationTime ?�근
    const operationTime = tankData1 ? (tankData1 as any).operationTime : undefined;
    
    // ?�프 ?�태 ?�인 �?채워�?비율 계산 (직접 계산)
    let fillPercent = 0;
    // ?��? 반복 ?�수 추적 (?? 1???�음)
    let remainingRepeats = "";
    
    // 1. ?�프가 켜져 ?�는 경우?�만 채�? ?�니메이???�시
    if (isPumpOn) {
      // 2. ?�프 진행 ?�보 가?�오�?      const pumpProgress = pumpProgressInfo[tankId];
      
      // 3. 진행 ?�보가 ?�으�?채�? 비율 계산
      if (pumpProgress) {
        console.log(`[renderTank] ?�크 ${tankId} 진행 ?�보:`, pumpProgress);
        
        // 3.1 경과 ?�간�??��? ?�간 ?�싱
        let elapsedTime = 0;
        let remainingTime = 0;
        
        // 경과 ?�간 추출 (?�자 ?�는 문자??s ?�식)
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
        
        // ?��? ?�간 추출 (?�자 ?�는 문자??s ?�식)
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
        
        // 3.2 ?�체 ?�간 계산 (경과 ?�간 + ?��? ?�간)
        const totalTime = elapsedTime + remainingTime;
        
        // 3.3 진행�?계산 - 5%~95% 범위�?매핑
        if (totalTime > 0) {
          // 5%-95% 범위 ?�에???�니메이??(경과 ?�간 비율???�라)
          fillPercent = 5 + (elapsedTime / totalTime) * 90;
          console.log(`[renderTank] ?�크 ${tankId} 채�?�? ${fillPercent.toFixed(1)}% (${elapsedTime}s/${totalTime}s)`);
        } else {
          // ?�간 ?�보가 ?�으�?기본�?          fillPercent = isPumpOn ? 10 : 0;
        }
        
        // 3.4 ?��? 반복 ?�수 계산 (pump_id ?�싱)
        if (pumpProgress.pump_id && typeof pumpProgress.pump_id === 'string') {
          const pumpMatch = pumpProgress.pump_id.match(/(\d+)\((\d+)\/(\d+)\)/);
          if (pumpMatch) {
            const currentRepeat = parseInt(pumpMatch[2], 10);
            const totalRepeat = parseInt(pumpMatch[3], 10);
            const repeatsLeft = totalRepeat - currentRepeat;
            
            if (repeatsLeft > 0) {
              remainingRepeats = `${repeatsLeft}???�음`;
            } else {
              remainingRepeats = "?�료";
            }
            
            console.log(`[renderTank] ?�크 ${tankId} ?��? 반복: ${remainingRepeats}`);
          }
        } else if (pumpProgress.total_repeats !== undefined && pumpProgress.current_repeat !== undefined) {
          // 진행 ?�보?�서 직접 반복 ?�수 ?�인
          const repeatsLeft = pumpProgress.total_repeats - pumpProgress.current_repeat;
          if (repeatsLeft > 0) {
            remainingRepeats = `${repeatsLeft}???�음`;
          } else {
            remainingRepeats = "?�료";
          }
        }
      } else {
        // 진행 ?�보가 ?�으�?기본�?(로컬 ?�토리�??�서 가?�오�??�도)
        const savedFillPercent = localStorage.getItem(`pump_${tankId}_fill_percent`);
        
        if (savedFillPercent) {
          fillPercent = parseFloat(savedFillPercent);
        } else if (tankId === 4) {
          // 4�??�크가 10%?�서 멈춰?�는 문제 ?�결 - 진행률이 ?�는 경우 계산
          fillPercent = 44; // 진행 ?�태???�시??값과 ?�일?�게 ?�정
        } else {
          // ?�른 ?�프??기본�?10% ?�정
          fillPercent = 10;
        }
      }
      
      // 최소 5%, 최�? 95%�??�한 (?�니메이??범위)
      fillPercent = Math.max(5, Math.min(fillPercent, 95));
    }
    
    // ?�제 채�? ?��???객체 ?�성
    const fillingStyle = isPumpOn ? {
      clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
      transition: 'clip-path 1s linear',
      backgroundColor: 'rgba(59, 130, 246, 0.3)'
    } : {};
    
    // 채�? ?��????�버�?로그
    if (isPumpOn) {
      console.log(`[renderTank] ?�크 ${tankId} 채�? ?��???`, fillingStyle);
    }
    
    // 채�? ?��??�이 ?�는지 ?�인 (empty object가 ?�닌지)
    const hasFilling = fillingStyle && Object.keys(fillingStyle).length > 0;
    
    // 중요 메시지�??�확???�별?�는 ?�수
    const isImportantStatusMessage = (msg: string | undefined, tankId: number): boolean => {
      if (!msg) return false;
      
      // 1�??�크?� ?�머지 ?�크�?구분
      if (tankId === 1) {
        return (
          msg.includes("?�위:5%?�상") || 
          msg.includes("?�위부�?5%미만") || 
          msg.includes("가?�채?�짐") ||
          msg.includes("채�?가??)
        );
      } else {
        return (
          msg.includes("?�위부�?) || 
          msg.includes("?�위?�상") || 
          msg.includes("가?�채?�짐") || 
          msg.includes("?�상?�위")
        );
      }
    };
    
    // 중요 메시지 ?�턴 가?�오�??�수
    const getTankImportantMessagePattern = (tankId: number) => {
      // 1�??�크??중요 메시지 ?�턴
      if (tankId === 1) {
        return /(?�위:\d+%?�상|?�위부�?\d+%미만|가?�채?�짐|채�?가??/;
      }
      
      // 2~6�??�크??중요 메시지 ?�턴
      return /(?�위부�??�위?�상|가?�채?�짐|?�상?�위)/;
    };
    
    // ?�크 ?��????�시???�태 ?�스??결정
    const getStatusText = () => {
      // ?�크 메시지가 ?�고, 중요 ?�태 메시지??경우�??�크 ?��????�시
      if (tankMessage && isImportantStatusMessage(tankMessage, tankId)) {
        // 중요 메시지?�서 ?�간 ?�보 ?�거?�고 ?�시
        const pattern = getTankImportantMessagePattern(tankId);
        const baseMsgMatch = tankMessage.match(pattern);
        return baseMsgMatch ? baseMsgMatch[0] : tankMessage;
      }
      
      // localStorage???�?�된 중요 메시지가 ?�는지 ?�인
      const storedImportantMessage = localStorage.getItem(`tank_${tankId}_important_message`);
      if (storedImportantMessage && isImportantStatusMessage(storedImportantMessage, tankId)) {
        // ?�?�된 중요 메시지?�서 ?�간 ?�보 ?�거?�고 ?�시
        const pattern = getTankImportantMessagePattern(tankId);
        const baseMsgMatch = storedImportantMessage.match(pattern);
        return baseMsgMatch ? baseMsgMatch[0] : storedImportantMessage;
      }
      
      // 중요 메시지가 ?�으�?기본 ?�태 메시지 반환
      const tankStatus = tankData1?.status || "empty";
      const tankLevel = tankData1?.level || 0;
      return getStatusMessage(tankStatus, tankLevel);
    };
    
    return (
      <g key={`tank-${tankId}`} id={`tank-${tankId}`}>
        {/* ?�크 본체 */}
        <rect
          x={x - tankWidth / 2}
          y={y - tankHeight / 2}
          width={tankWidth}
          height={tankHeight}
          rx="5"
          className={getTankColor(status, tankId)}
        />
        
        {/* 채워지???�니메이?�을 ?�한 ?�버?�이 - ?�프가 켜져 ?�을 ?�만 ?�용 */}
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
        
        {/* ?�크 ?�벨 - 글???�기 15% ?��? */}
        <text x={x} y={y} textAnchor="middle" className="text-[1.15rem] font-bold fill-black">
          {label}
        </text>
        
        {/* ?�태 메시지 - 중요 ?�태 메시지�??�시 */}
        <text x={x} y={y + 25} textAnchor="middle" className="text-[12.1px] fill-gray-700">
          {getStatusText()}
        </text>
        
        {/* ?�프 ?�태가 ON?????��? 반복 ?�수�??�시 (?�센???�거) */}
        {isPumpOn && remainingRepeats && (
          <text x={x} y={y + 45} textAnchor="middle" className="text-[12px] fill-blue-700 font-bold">
            {remainingRepeats}
          </text>
        )}
      </g>
    );
  };

  // 메인 ?�크 ?�벨 메시지 처리 ?�수 개선
  const handleMainTankLevelMessage = (messageStr: string) => {
    console.log(`�??�크 ?�벨 메시지 ?�신: ${messageStr}`);
    
    // ??�� 메시지�?바로 ?�??- ?�면???�시??메시지 ?�데?�트
    setMainTankMessage(messageStr);
    console.log(`�??�크 메시지 ?�정?? ${messageStr}`);
    
    // 메시지???�라 ?�벨 ?�정 (?�니메이?�을 ?�한 ?�벨 ?�데?�트)
    let newLevel = tankData?.mainTank?.level || 0;
    
    // ?�정 메시지???�라 ?�벨 ?�정
    if (messageStr === "50%?�상 채워�?) {
      newLevel = 60; // 60% 채�?
      console.log("�??�크 ?�벨: 60%�??�정(50%?�상 채워�?");
    } else if (messageStr === "50%?�하 비워�?) {
      newLevel = 20; // 20% 채�?
      console.log("�??�크 ?�벨: 20%�??�정(50%?�하 비워�?");
    }
    
    // ?�벨 ?�데?�트 - 로컬 ?�태�?변경하�??�??    if (tankData && tankData.mainTank) {
      // ?�데?�트???�이??준�?      const updatedTankData = {
        ...tankData,
        mainTank: {
          ...tankData.mainTank,
          level: newLevel
        }
      };
      
      // 로컬 ?�토리�????�??      saveState(updatedTankData);
      console.log(`�??�크 ?�벨 ?�?�됨: ${newLevel}%`);
    }
  };

  // MQTT 메시지 처리 부분에??�??�크 메시지 처리 로직 개선
  useEffect(() => {
    if (!mqttClient) return;
    
    // ?�픽 구독 ?�수
    const subscribeTankTopics = () => {
      console.log('Tank System MQTT ?�픽 구독 ?�작');
      
      // 1. ?�어 ?�터?�이???�픽 구독
      mqttClient.subscribe('tank-system/notifications');
      
      // 2. �??�크 ?�위 ?�픽 구독
      mqttClient.subscribe('extwork/tankMain/level');
      console.log('> �??�크 ?�위 ?�픽 구독: extwork/tankMain/level');
      
      // 3. 추출 명령 ?�픽 구독
      mqttClient.subscribe('extwork/extraction/input');
      
      // 4. ?�버???�프 ?�태 ?�픽 구독
      for (let i = 1; i <= 6; i++) {
        mqttClient.subscribe(`extwork/inverter${i}/state`);
        console.log(`> ?�버???�프 ?�태 ?�픽 구독: extwork/inverter${i}/state`);
      }
      
      // 5. ?�크 ?�위 ?�픽 구독
      for (let i = 1; i <= 6; i++) {
        for (let j = 1; j <= 6; j++) {
          mqttClient.subscribe(`extwork/inverter${i}/tank${j}_level`);
          console.log(`> ?�크 ?�위 ?�픽 구독: extwork/inverter${i}/tank${j}_level`);
        }
      }
      
      console.log('모든 MQTT ?�픽 구독 ?�료');
    };
    
    // 메시지 처리 ?�수
    const handleMessage = (topic: string, message: Buffer) => {
      try {
        const messageStr = message.toString();
        
        // �??�크 ?�위 ?�픽 처리 - ?�별???�선 처리
        if (topic === 'extwork/tankMain/level') {
          console.log(`�??�크 ?�위 메시지 ?�신: ${messageStr}`);
          
          // 메시지 ?�태 ?�데?�트 (?�면???�시??메시지)
          setMainTankMessage(messageStr);
          
          // 메시지???�라 ?�벨 ?�정
          let newLevel = tankData?.mainTank?.level || 0;
          
          if (messageStr === "50%?�상 채워�?) {
            newLevel = 60; // 60% 채�?
            console.log("�??�크 ?�벨: 60%�??�정??);
          } else if (messageStr === "50%?�하 비워�?) {
            newLevel = 20; // 20% 채�?
            console.log("�??�크 ?�벨: 20%�??�정??);
          }
          
          // ?�태 ?�??          if (tankData && tankData.mainTank) {
            // ?�재 ?�크 ?�이??복사
            const updatedTankData = {
              ...tankData,
              mainTank: {
                ...tankData.mainTank,
                level: newLevel
              }
            };
            
            // ?�태 ?�??- IndexedDB???�??            saveState(updatedTankData);
            console.log(`�??�크 ?�벨 ?�?�됨: ${newLevel}%`);
          }
        }
        // ?�른 ?�픽 처리 계속...
      } catch (error) {
        console.error('메시지 처리 ?�류:', error);
      }
    };
    
    // ?�결 ???�픽 구독
    mqttClient.on('connect', subscribeTankTopics);
    
    // 메시지 ?�신 ?�벤??리스???�록
    mqttClient.on('message', handleMessage);
    
    // 컴포?�트 ?�마?�트 ???�벤??리스???�거
    return () => {
      mqttClient.off('message', handleMessage);
      mqttClient.off('connect', subscribeTankTopics);
    };
  }, [mqttClient, tankData, setMainTankMessage]);

  // ?�프�?진행 ?�태 추적???�한 useEffect 추�?
  useEffect(() => {
    // ?�성?�된 ?�프가 ?�는지 ?�인
    const activePump = Object.entries(pumpProgressInfo).find(([_, progress]) => 
      progress && (progress.elapsed_time !== undefined || progress.remaining_time !== undefined)
    );
    
    if (activePump) {
      const [pumpId, progress] = activePump;
      
      // 진행�?계산???�한 ?�이??추출
      let elapsedTime = 0;
      let totalTime = 0;
      
      // elapsed_time �?추출
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
      
      // remaining_time �?추출
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
      
      // ?�이?��? ?�효?�면 진행�?계산
      if (totalTime > 0) {
        let fillPercent = Math.min((elapsedTime / totalTime) * 100, 100);
        fillPercent = Math.max(fillPercent, 5); // 최소 5% 보장
        
        // fillPercentage ?�태 ?�데?�트 (?�전?�게 useEffect ?�에??
        setFillPercentage(fillPercent);
        console.log(`[useEffect] ?�역 fillPercentage ?�데?�트: ${fillPercent.toFixed(1)}%`);
      }
    }
    
    // ?�린???�수 - ?�요??경우 ?�기??로직 추�?
    return () => {
      // ?�요??경우 ?�린??로직
    };
  }, [pumpProgressInfo]); // pumpProgressInfo가 변경될 ?�만 ?�행

  useEffect(() => {
    if (!mqttClient) {
      // MQTT ?�라?�언???�결 ?????�태
      console.log('MQTT ?�라?�언?��? ?�결?��? ?�았?�니?? 초기 ?�태�??�정?�니??');
      
      // 초기 ?�크 메시지 ?�정 - "준비중"?�로 ?�정?�고 localStorage???�?�된 ?�전 메시지 복원
      setTankMessages(prev => {
        const initialMessages = { ...prev };
        
        // 모든 ?�크 메시지�?"준비중"?�로 초기??        for (let i = 1; i <= 6; i++) {
          // localStorage?�서 ?�?�된 메시지 ?�인
          const savedMessage = localStorage.getItem(`tank_${i}_message`);
          
          if (savedMessage) {
            // ?�?�된 메시지가 ?�으�??�용
            initialMessages[i] = savedMessage;
            console.log(`?�크 ${i} 메시지 복원: "${savedMessage}"`);
          } else {
            // ?�?�된 메시지가 ?�으�?"준비중"?�로 ?�정
            initialMessages[i] = "준비중";
            console.log(`?�크 ${i} 메시지 초기?? "준비중"`);
          }
        }
        
        return initialMessages;
      });
    }
  }, [mqttClient]);

  // MQTT ?�라?�언???�결 ?�태 변�????�행
  useEffect(() => {
    // ... existing code ...
  }, [mqttClient?.connected]);

  // ?�크 구독 ?�정
  useEffect(() => {
    if (!mqttClient?.connected || !tankData?.tanks) return;
    
    // ?�동 공급 ?�태 구독
    // ... existing code ...
  }, [mqttClient?.connected, tankData?.tanks]);

  // 공정 메시지 ?�?�된 �?복원 (?�결 ?��? ?��?
  useEffect(() => {
    if (setProgressMessages) {
      try {
        const savedMessages = localStorage.getItem('lastProgressMessages');
        if (savedMessages && progressMessages.length === 0) {
          const parsed = JSON.parse(savedMessages);
          setProgressMessages(parsed);
          console.log('로컬 ?�토리�??�서 진행 메시지�?복원?�습?�다.', parsed.length);
        }
      } catch (error) {
        console.error('진행 메시지 복원 �??�류:', error);
      }
    }
  }, [setProgressMessages]);

  return (
    <div className="relative w-full h-[950px] bg-white rounded-lg shadow-sm overflow-hidden border border-gray-100">
      {/* ?�스 ?�니메이???��???추�? */}
      <style>{pulseCss}</style>
      
      {/* 모니?�링 ?�?��?�??�간 ?�시 - ?�스???�상?�로 변�?*/}
      <div className="bg-blue-200 text-gray-700 px-4 py-1.5 flex justify-between items-center">
        <h2 className="text-sm font-semibold">모니?�링: {formatTimeStr()}</h2>
        {/* ?�른�??�태 ?�역: ?�러 메시지?� ?�료 메시지 */}
        <div className="flex items-center space-x-2 text-xs">
          {/* ?�러 메시지가 ?�으�?빨간???�림?�로 ?�시 */}
          {errorMessage && (
            <span className="bg-red-100 px-2 py-0.5 rounded text-red-700 animate-pulse">
              {errorMessage}
            </span>
          )}
          {/* 추출 ?�료 메시지 ?�시 */}
          {extractionCompleteMessage && (
            <span className="bg-green-100 px-2 py-0.5 rounded text-green-700">
              {extractionCompleteMessage}
            </span>
          )}
          {/* 공정 진행 �??�시 */}
          {processRunning && (
            <span className="bg-indigo-100 px-2 py-0.5 rounded text-indigo-700 flex items-center">
              <span className="h-2 w-2 bg-indigo-500 rounded-full mr-1 animate-pulse"></span>
              공정 진행 �?            </span>
          )}
        </div>
      </div>
      
      {/* ?�태 변�??�림 UI???�거?�고 ?�래???�시 추�? */}
      
      {/* 모니?�링 컨텐�?컨테?�너 */}
      <div className="flex h-[calc(100%-32px)]">
        {/* 메인 모니?�링 ?�역 - 비율??60%?�서 55%�?조정 */}
        <div className="w-[55%] border-r border-gray-200 p-0 pl-1 pr-1">
          {/* SVG 컨테?�너 - 박스�?감싸�?*/}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-0 mb-0 h-[850px] flex flex-col">
            <div className="bg-gray-100 py-2 px-3 text-sm font-semibold text-gray-700 rounded-t-lg border-b border-gray-200">
              ?�크 ?�스??모니?�링
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
                {/* ?�체 컨텐츠�? ?�크 ?�스??모니?�링 ?�자 ?�으�??�동 - ?�기 추�? 증�? �??�치 조정 */}
                <g transform="translate(-260, -140) scale(1.33)">
          {/* 본탱??- ?�비 ?��?, ?�이 감소 */}
          <rect
            x={mainTankPosition.x - mainTankPosition.width / 2}
            y={mainTankPosition.y - mainTankPosition.height / 2}
            width={mainTankPosition.width}
            height={mainTankPosition.height}
            rx="10"
            className={`${valve1 === 0 && isPipeActive(5) ? "fill-white stroke-yellow-400 stroke-[3]" : getTankColor(tankData?.mainTank?.status, 0)}`}
          />
          
          {/* 채워지???�니메이?�을 ?�한 ?�버?�이 - ?�프가 ON?�거??filling ?�태?????�용 */}
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
          
          {/* 본탱???�태 메시지 ?�스??*/}
          <text 
            x={mainTankPosition.x} 
            y={mainTankPosition.y + 30} 
            textAnchor="middle" 
            className="text-[14px] font-semibold fill-blue-700"
          >
            {mainTankMessage || getStatusMessage(tankData?.mainTank?.status, tankData?.mainTank?.level, 0)}
          </text>

          {/* ?�크 ?�결 ?�이??- 직선?�로 ?�결 (2-3, 3-4, 4-5, 5-6�??�크�? */}
          {Array(4)
            .fill(0)
            .map((_, i) => {
              const currentIndex = i + 1 // 2, 3, 4, 5�??�크부???�작
              const nextIndex = (currentIndex + 1) % 6 // 3, 4, 5, 6�??�크
              const pumpIndex = i + 2 // ?�프 ?�덱??(3, 4, 5, 6�??�프??각각 2, 3, 4, 5�??�덱??
              
              // ?�전 검?��? 추�??�여 tankData.tanks[pumpIndex]가 존재?�는지 ?�인
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

          {/* 1�??�크?�서 2�??�프로의 경로 */}
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

          {/* 2�??�프?�서 2�??�크로의 경로 */}
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

          {/* 6�??�크?�서 3way 밸브(밸브2)로의 경로 */}
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

          {/* 3way 밸브(밸브2)?�서 본탱?�로??경로 - ?�체?�환???�만 ?�시 */}
          {valve1 === 0 && (
            <path
              d={calculate3wayToMainPath()}
              className={`stroke-[12] ${isPipeActive(5) ? "stroke-blue-500" : "stroke-gray-300"}`}
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* 본탱?�에??2way 밸브(밸브1)로의 경로 - ??�� ?�시 */}
          <path
            d={calculateMainToTank1Path()}
            className={`stroke-[12] ${valve2 === 1 || (valve1 === 1 && isPipeActive(0)) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 2way 밸브(밸브1)?�서 ?�프1 ?�구 쪽으로의 경로 - ??�� ?�시 */}
          <path
            d={calculate2wayToPump1Path()}
            className={`stroke-[12] ${(valve2 === 1 && isPipeActive(0)) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 3way 밸브(밸브2)?�서 ?�프 1로의 경로 - 추출?�환???�만 ?�시 */}
          {valve1 === 1 && (
            <path
              d={calculate3wayToPump1Path()}
              className={`stroke-[12] ${isPipeActive(5) || isPipeActive(0) ? "stroke-blue-500" : "stroke-gray-300"}`}
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* ?�류 지?�에???�프1로의 경로 */}
          <path
            d={calculateMergeToPump1Path()}
            className={`stroke-[12] ${((valve1 === 1 && (isPipeActive(5) || isPipeActive(0))) || (valve2 === 1 && isPipeActive(0))) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* 1�??�프?�서 1�??�크로의 경로 */}
          <path
            d={calculatePump1To1Path()}
            className={`stroke-[12] ${isPipeActive(0) ? "stroke-blue-500" : "stroke-gray-300"}`}
            fill="none"
            strokeLinecap="round"
          />

          {/* ?�프 (1�? */}
          {(() => {
            const pumpPos = calculatePumpPosition(5, 0);
            const tank = tankData?.tanks?.[0]; // 1�??�프 = 0�??�덱??            const stateMessage = pumpStateMessages[1] || '';
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
                
                {/* ?�결 ?�태 ?�이�?추�? */}
                {renderConnectionIcons(1, pumpPos.x, pumpPos.y)}
                
                {/* ?�프 ?�위�??�시 - ?�그 ?�거, ON/OFF�??�시 */}
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
                
                {/* 리셋 ?�?�머 ?�시 */}
                {resetTimers[1] && (
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius + 8}
                    className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                  />
                )}
                
                {/* ?�프 메시지 ?�그 ?�시 - ?�평?�로 ?�위�??�에 배치, ???�로 ?�림 */}
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

          {/* ?�프 (2�? */}
          {(() => {
            const pumpPos = calculatePumpPosition(0, 1);
            const tank = tankData?.tanks?.[1]; // 2�??�프 = 1�??�덱??            const stateMessage = pumpStateMessages[2] || '';
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
                
                {/* ?�결 ?�태 ?�이�?추�? */}
                {renderConnectionIcons(2, pumpPos.x, pumpPos.y)}
                
                {/* ?�프 ?�위�??�시 - ?�그 ?�거, ON/OFF�??�시 */}
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
                
                {/* 리셋 ?�?�머 ?�시 */}
                {resetTimers[2] && (
                  <circle
                    cx={pumpPos.x}
                    cy={pumpPos.y}
                    r={pumpRadius + 8}
                    className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                  />
                )}
                
                {/* ?�프 메시지 ?�그 ?�시 - ?�평?�로 ?�위�??�에 배치, ???�로 ?�림 */}
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

          {/* ?�프 (3~6�? - ?�크 ?�이??배치 */}
          {Array(4)
            .fill(0)
            .map((_, index) => {
              const currentTankIndex = index + 1 // 2, 3, 4, 5�??�크부???�작
              const nextTankIndex = (currentTankIndex + 1) % 6 // 3, 4, 5, 6�??�크
              const pumpPos = calculatePumpPosition(currentTankIndex, nextTankIndex);
              const pumpNum = index + 3 // 3, 4, 5, 6�??�프
              // ?�전?�게 ?�크 ?�이???�근
              const tank = tankData?.tanks && tankData?.tanks.length > (pumpNum - 1) ? tankData?.tanks[pumpNum - 1] : null;
              const stateMessage = pumpStateMessages[pumpNum] || '';
              const switchPosition = pumpSwitchPosition[pumpNum] || 0;
              
              return (
                <g key={`pump-${pumpNum}`} id={`pump-${pumpNum}`}>
                  {/* ?�버???�프 */}
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
                  
                  {/* ?�결 ?�태 ?�이�?추�? */}
                  {renderConnectionIcons(pumpNum, pumpPos.x, pumpPos.y)}
                  
                  {/* ?�프 ?�위�??�시 - ?�그 ?�거, ON/OFF�??�시 */}
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
                  
                  {/* 리셋 ?�?�머 ?�시 */}
                  {resetTimers[pumpNum] && (
                    <circle
                      cx={pumpPos.x}
                      cy={pumpPos.y}
                      r={pumpRadius + 8}
                      className="fill-transparent stroke-yellow-400 stroke-2 animate-pulse"
                    />
                  )}
                  
                  {/* ?�프 메시지 ?�그 ?�시 - �??�프??붙어?�는 ?�각선 ?�태 */}
                  {pumpStateMessages[pumpNum] && (
                    <g transform={(() => {
                      // �??�프마다 ?�른 ?�치?� 각도 ?�정 - �?공간??배치
                      switch (pumpNum) {
                        case 3: // ?�프 3�?- ?�프 ?�래쪽에 ?�평?�로 배치
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y + 30}) rotate(0)`;
                        case 4: // ?�프 4�?- ?�위�??�에 ?�평?�로 배치, ???�로 ?�림
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`;
                        case 5: // ?�프 5�?- ?�위�??�에 ?�평?�로 배치, ???�로 ?�림
                          return `translate(${pumpPos.x - 60}, ${pumpPos.y - 60}) rotate(0)`;
                        case 6: // ?�프 6�?- ?�프 ?�래쪽에 ?�평?�로 배치
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

          {/* ?�크 1-6 */}
                  {tankPositions.map((position, i) => {
                    const tankId = i + 1;
                    const tankData1 = tankData?.tanks?.[i];
                    // ?�당 ?�덱?�의 ?�크 메시지 가?�오�?                    const tankMessage = tankMessages[tankId] || (tankData?.tankMessages ? tankData.tankMessages[tankId] : '');
            
            return (
                      <g key={`tank-${tankId}`} id={`tank-${tankId}`}>
                {renderTank(tankId, position.x, position.y, position.label)}
                
                        {/* ?�크 ?�스??박스 추�? - ?�넉???�백?�로 조정 */}
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

          {/* 3way 밸브 - ON/OFF ?�위�??�태�?개선 - ?�기 줄임 */}
          <g
            onClick={() => handleValveChange(getNextValveState())}
            className="cursor-pointer"
            transform={`translate(${valve3wayPosition.x}, ${valve3wayPosition.y})`}
          >
            {/* 밸브 배경 - ?�기 줄임 */}
            <rect 
              x="-30" 
              y="-30" 
              width="60" 
              height="50" 
              rx="10" 
              className={`fill-yellow-50 stroke-yellow-400 stroke-2`} 
            />
            
            {/* 밸브 ?��? T???�시 - ?�기 조정 */}
            <line x1="-20" y1="0" x2="20" y2="0" className="stroke-yellow-500 stroke-2" />
            <line x1="0" y1="0" x2="0" y2="15" className="stroke-yellow-500 stroke-2" />
            
            {/* ON/OFF ?�위�?- ?�치???�라 ?�아?�로 ?�동 */}
            <rect 
              x="-20" 
              y={valve1 === 1 ? "-20" : "0"} 
              width="40" 
              height="20" 
              rx="10" 
              className={`${valve1 === 1 ? "fill-green-500" : "fill-red-500"} stroke-gray-400 stroke-1 transition-all duration-300`} 
            />
            
            {/* 밸브 ?�스??변�?*/}
            <text x="0" y="-20" textAnchor="middle" className="text-sm font-bold">
              밸브2
            </text>
            <text x="0" y={valve1 === 1 ? "-10" : "10"} textAnchor="middle" className="text-[12px] font-bold text-white">
              {valve1 === 1 ? "추출?�환" : "?�체?�환"}
            </text>
          </g>

          {/* 2way 밸브 ?�름�??�시 변�?*/}
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
            
            {/* 밸브 ?��? ?�시 */}
            <line x1="-20" y1="0" x2="20" y2="0" className="stroke-yellow-500 stroke-2" />
            {valve2 === 1 && <line x1="0" y1="-15" x2="0" y2="15" className="stroke-yellow-500 stroke-2" />}
            
            {/* ON/OFF ?�위�?*/}
            <rect 
              x="-20" 
              y={valve2 === 1 ? "-20" : "0"} 
              width="40" 
              height="20" 
              rx="10" 
              className={`${valve2 === 1 ? "fill-green-500" : "fill-red-500"} stroke-gray-400 stroke-1 transition-all duration-300`} 
            />
            
            {/* 밸브 ?�스??변�?*/}
            <text x="0" y="-20" textAnchor="middle" className="text-sm font-bold">
              밸브1
            </text>
            <text x="0" y={valve2 === 1 ? "-10" : "10"} textAnchor="middle" className="text-[12px] font-bold text-white">
              {valve2 === 1 ? "본탱???�집" : "OFF"}
            </text>
          </g>

          {/* ?�프 리셋 버튼 ?�자 - 추출 ?�어 ?�자 ?�측??배치, ?�간 ?�쪽?�로 ?�동 */}
          {/* ?�프 리셋 버튼?� ?�단?�로 ?�동?�으므�??�거 */}
        </g> {/* ?�체 컨텐�??�로 ?�동 translate???�는 ?�그 */}
      </svg>
            </div>
              </div>
            </div>
            
        {/* 추�? ?�보 ?�이?�바 - 비율??40%?�서 45%�?조정 */}
        <div className="w-[45%] p-2 flex flex-col space-y-2">
          {/* ?�재 ?�태 �?진행 ?�보 */}
          {renderSystemStatusInfo()}
        
          {/* 추�? ?�보 박스 1 - ?�크 ?�약 ?�보�?공정 진행 ?�약 ?�보�?변�?*/}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-2">
            <div className="bg-blue-50 py-1 px-2 text-xs font-semibold text-blue-700 rounded-t-lg border-b border-gray-200 flex justify-between items-center">
              <span>공정 진행 계획 ?�약</span>
              {progressMessages.filter(msg => msg.rawJson).length > 0 && (
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[9px] font-bold animate-pulse">
                  ?�성
                </span>
              )}
            </div>
            <div className="p-2 text-xs">
              {/* 공정 계획 ?�보 ?�시 */}
              <div className="space-y-2">
                {/* 공정 계획 ?�보 ?�시 */}
                {progressMessages.filter(msg => msg.rawJson).slice(0, 1).map((msg, idx) => {
                  try {
                    const jsonData = msg.rawJson ? JSON.parse(msg.rawJson) : null;
                    
                    // 복합 명령??처리 (sequences 배열???�는 경우)
                    if (jsonData?.sequences && Array.isArray(jsonData.sequences)) {
                      return (
                        <div key={`process-plan-${idx}`} className="bg-gray-50 p-2 rounded border border-gray-100">
                          <div className="mb-2 font-semibold text-blue-700 border-b border-blue-100 pb-1">복합 공정 계획</div>
                          
                          {jsonData.sequences.map((seq, seqIdx) => (
                            <div key={`seq-${seqIdx}`} className="mb-2 p-1.5 bg-white rounded border border-gray-100">
                  <div className="flex justify-between items-center mb-1">
                                <span className="font-semibold text-blue-700">?�퀀??{seqIdx + 1}:</span>
                                <span className="text-[9px] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                  {seq.operation_mode ? `모드: ${seq.operation_mode}` : ''}
                                </span>
                  </div>
                              
                              {seq.repeats !== undefined && (
                                <div className="mb-1 flex justify-between items-center">
                                  <span className="font-semibold text-blue-700">반복 ?�수:</span>
                                  <span className="bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{seq.repeats}??/span>
                  </div>
                              )}
                              
                              {seq.process && Array.isArray(seq.process) && (
                                <div className="mb-1">
                                  <span className="font-semibold text-blue-700">?�로?�스:</span>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {seq.process.map((proc, procIdx) => (
                                      <span key={procIdx} className="bg-green-50 text-green-700 text-[9px] px-1.5 py-0.5 rounded border border-green-100">
                                        {proc}
                                      </span>
                                    ))}
                </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    
                    // ?�반 명령??처리
                    return (
                      <div key={`process-info-${idx}`} className="bg-gray-50 p-2 rounded border border-gray-100">
                        {jsonData?.name && (
                          <div className="mb-1 flex justify-between items-center">
                            <span className="font-semibold text-blue-700">공정 ?�름:</span>{" "}
                            <span className="bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{jsonData.name}</span>
              </div>
                        )}
                        {jsonData?.mode && (
                          <div className="mb-1 flex justify-between items-center">
                            <span className="font-semibold text-blue-700">?�영 모드:</span>{" "}
                            <span className={`px-2 py-0.5 rounded border ${
                              jsonData.mode === "sequential" ? "bg-purple-50 border-purple-100 text-purple-700" : 
                              jsonData.mode === "concurrent" ? "bg-green-50 border-green-100 text-green-700" : 
                              jsonData.mode === "mixed" ? "bg-yellow-50 border-yellow-100 text-yellow-700" : 
                              "bg-gray-50 border-gray-100"
                            }`}>
                              {jsonData.mode === "sequential" ? "?�차 모드" : 
                                  jsonData.mode === "concurrent" ? "?�시 모드" : 
                              jsonData.mode === "mixed" ? "?�합 모드" : jsonData.mode}
                            </span>
              </div>
                        )}
                        {jsonData?.repeat !== undefined && (
                          <div className="mb-1 flex justify-between items-center">
                            <span className="font-semibold text-blue-700">반복 ?�수:</span>{" "}
                            <span className="bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{jsonData.repeat}??/span>
                      </div>
                        )}
                        {jsonData?.sequences && (
                          <div className="mb-1">
                            <span className="font-semibold text-blue-700">?�성?�될 ?�프:</span>{" "}
                            <div className="mt-1 flex flex-wrap gap-1">
                              {jsonData.sequences.map((seq: any, i: number) => {
                                const pumpId = seq.pump_id || seq.pumpId;
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
                            <span className="font-semibold text-blue-700">?�상 종료:</span>{" "}
                            <span className="bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 text-indigo-700">{jsonData.estimated_completion_time}</span>
                </div>
                        )}
              </div>
                    );
                  } catch (error) {
                    return (
                      <div key={`process-info-error-${idx}`} className="text-red-500 bg-red-50 p-2 rounded border border-red-200">
                        공정 명령 처리 �??�류가 발생?�습?�다.
                      </div>
                    );
                  }
                })}
                
                {/* 명령???�는 경우 ?�내 메시지 ?�시 */}
                {progressMessages.filter(msg => msg.rawJson).length === 0 && (
                  <div className="text-gray-500 bg-gray-50 border border-gray-200 italic text-center p-3 rounded">
                    <div className="text-[10px] mb-1">공정 명령???�습?�다</div>
                    <div className="text-[9px]">extwork/extraction/input ?�픽?�로 JSON 명령??보내주세??/div>
                  </div>
                )}
                
                {/* 채�? 비율 진행 �?- ?�니메이???�용 */}
                <div className="mb-2 mt-3 pt-2 border-t border-gray-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold">진행 ?�태:</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      fillPercentage >= 90 ? 'bg-green-100 text-green-800' :
                      fillPercentage >= 60 ? 'bg-blue-100 text-blue-800' :
                      fillPercentage >= 30 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {(() => {
                        try {
                          // 최신 JSON ?�이?�에??repetition 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (latestJsonMsg && latestJsonMsg.rawJson) {
                            // ?�스??메시지??경우 건너?�기
                            if (latestJsonMsg.rawJson.includes("?�재 밸브 ?�태") || 
                                !latestJsonMsg.rawJson.trim().startsWith('{')) {
                              return `${Math.floor(fillPercentage)}%`;
                            }
                            
                            try {
                            const jsonData = JSON.parse(latestJsonMsg.rawJson);
                            if (jsonData.repetition_count && jsonData.repetition) {
                              return `${jsonData.repetition_count - jsonData.repetition}???�음`;
                              }
                            } catch (parseError) {
                              console.error('반복 ?�보 JSON ?�싱 ?�류:', parseError);
                              return `${Math.floor(fillPercentage)}%`;
                            }
                          }
                        } catch (e) {
                          console.error('Repetition parsing error:', e);
                        }
                        return `${Math.floor(fillPercentage)}%`;
                      })()}
                    </span>
                  </div>
                  
                  {/* ?�형 그래??추�? */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-16 h-16 relative">
                      <svg viewBox="0 0 36 36" className="w-full h-full">
                        {/* 배경 ??*/}
                        <circle 
                          cx="18" 
                          cy="18" 
                          r="15.9" 
                          fill="none" 
                          stroke="#eeeeee" 
                          strokeWidth="3"
                        />
                        
                        {(() => {
                          // 기본�??�???�적 진행�?계산
                          let percent = 0;

                          // 최신 JSON ?�이?�에??진행 ?�보 찾기
                          try {
                            const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                            if (latestJsonMsg && latestJsonMsg.rawJson) {
                              // ?�스??메시지??경우 건너?�기
                              if (latestJsonMsg.rawJson.includes("?�재 밸브 ?�태") || 
                                  !latestJsonMsg.rawJson.trim().startsWith('{')) {
                                console.log('밸브 ?�태 메시지??JSON?�로 ?�싱?��? ?�음:', latestJsonMsg.rawJson);
                                // 마�?막으�??�?�된 �??�용
                                percent = parseInt(localStorage.getItem('lastProgressPercent') || "0", 10);
                              } else {
                                try {
                              const jsonData = JSON.parse(latestJsonMsg.rawJson);
                              if (jsonData.process_time && jsonData.total_remaining) {
                                const totalTime = parseInt(String(jsonData.process_time).match(/(\d+)/)?.[1] || "0", 10);
                                const totalRemaining = parseInt(String(jsonData.total_remaining).match(/(\d+)/)?.[1] || "0", 10);
                                
                                if (totalTime > 0 && totalRemaining >= 0) {
                                  // 진행�?계산 = (?�체 ?�간 - ?��? ?�간) / ?�체 ?�간 * 100
                                  percent = Math.min(100, Math.max(0, Math.floor(100 - (totalRemaining / totalTime * 100))));
                                }
                              } else if (jsonData.process_info === "waiting" && localStorage.getItem('lastProgressPercent')) {
                                // ?��?중일 ??마�?막으�?계산??진행�??�용
                                percent = parseInt(localStorage.getItem('lastProgressPercent') || "0", 10);
                                  }
                                } catch (parseError) {
                                  console.error('진행�?계산 JSON ?�싱 ?�류:', parseError);
                                  // ?�싱 ?�류 ??마�?�??�?�값 ?�용
                                  percent = parseInt(localStorage.getItem('lastProgressPercent') || "0", 10);
                                }
                              }
                            }
                          } catch (e) {
                            console.error('Progress calculation error:', e);
                            // ?�러 발생 ??로컬 ?�토리�??�서 마�?�?계산??�?불러?�기
                            percent = parseInt(localStorage.getItem('lastProgressPercent') || "0", 10);
                          }
                          
                          // 진행�?값이 ?�으�?로컬 ?�토리�????�??                          if (percent > 0) {
                            localStorage.setItem('lastProgressPercent', percent.toString());
                          }
                          
                          return (
                            <>
                              <circle 
                                cx="18" 
                                cy="18" 
                                r="15.9" 
                                fill="none" 
                                stroke={percent >= 90 ? '#22c55e' : percent >= 60 ? '#3b82f6' : percent >= 30 ? '#eab308' : '#6b7280'} 
                                strokeWidth="3" 
                                strokeDasharray={`${15.9 * 2 * Math.PI}`} 
                                strokeDashoffset={`${15.9 * 2 * Math.PI * (1 - percent/100)}`} 
                                strokeLinecap="round" 
                                className="transition-all duration-1000"
                                transform="rotate(-90 18 18)"
                              />
                              
                              {/* 가?�데 ?�스??*/}
                              <text 
                                x="18" 
                                y="18.5" 
                                textAnchor="middle" 
                                fontSize="10" 
                                fontWeight="bold" 
                                fill={percent >= 90 ? '#22c55e' : percent >= 60 ? '#3b82f6' : percent >= 30 ? '#eab308' : '#6b7280'}
                              >
                                {percent}%
                              </text>
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                    
                    {/* 진행 ?�태 바�? 개별�?분리?�여 ?�시 */}
                    <div className="space-y-1.5 flex-1 ml-2">
                      {/* ?�재 ?�업 진행�?�?- ?�기중?�도 ??�� ?�시 */}
                      {(() => {
                        try {
                          // 최신 JSON ?�이?�에???�프 진행 ?�보 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (latestJsonMsg && latestJsonMsg.rawJson) {
                            // ?�스??메시지??경우 건너?�기
                            if (latestJsonMsg.rawJson.includes("?�재 밸브 ?�태") || 
                                !latestJsonMsg.rawJson.trim().startsWith('{')) {
                              console.log('밸브 ?�태 메시지??JSON?�로 ?�싱?��? ?�음:', latestJsonMsg.rawJson);
                              return null;
                            }
                            
                            const jsonData = JSON.parse(latestJsonMsg.rawJson);
                            
                            // ?��??�태??경우 - 고정 값으�??�시
                            if (jsonData.process_info === "waiting") {
                              const pumpId = jsonData.pump_id || 0;
                              return (
                                <div className="flex items-center space-x-2">
                                  <span className="text-[10px] font-medium text-yellow-700 w-14">?�프 {pumpId}(?��?:</span>
                                  <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-yellow-200 rounded-full"
                                      style={{ width: '100%' }}
                                    ></div>
                                  </div>
                                  <span className="text-[9px] font-semibold text-yellow-700">?�기중</span>
                                </div>
                              );
                            }
                            
                            // ?�반 ?�업 ?�태
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
                                      <span className="text-[10px] font-medium text-yellow-700 w-14">?�프 {pumpId}(가??:</span>
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
                                // ?�프 ID가 ?�자??경우 - ?�순???�프 번호�??�시
                                const pumpId = jsonData.pump_id;
                                return (
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] font-medium text-yellow-700 w-14">?�프 {pumpId}(가??:</span>
                                    <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-yellow-500 rounded-full transition-all duration-1000 ease-in-out"
                                        style={{ width: '50%' }}
                                      ></div>
                                    </div>
                                    <span className="text-[9px] font-semibold text-yellow-700">진행�?/span>
                                  </div>
                                );
                              }
                            }
                          }
                        } catch (e) {
                          console.error('Pump info parsing error:', e);
                        }
                        
                        // 기본 ?�태 - ??�� ?�시?�도�?                        return (
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-medium text-yellow-700 w-14">?�프(?��?:</span>
                            <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-yellow-200 rounded-full"
                                style={{ width: '100%' }}
                              ></div>
                            </div>
                            <span className="text-[9px] font-semibold text-yellow-700">미작??/span>
                          </div>
                        );
                      })()}
                      
                      {/* ?�기시�?카운??그래??*/}
                      {(() => {
                        try {
                          // 최신 JSON ?�이?�에???�기시�??�보 찾기
                          const latestJsonMsg = progressMessages.find(msg => msg.rawJson);
                          if (!latestJsonMsg || !latestJsonMsg.rawJson) {
                            return null;
                          }
                          
                          // "?�재 밸브 ?�태" 문자??체크 ?�는 JSON???�닌 경우
                          if (latestJsonMsg.rawJson.includes("?�재 밸브 ?�태") || 
                              !latestJsonMsg.rawJson.trim().startsWith('{')) {
                            console.log('밸브 ?�태 메시지??JSON?�로 ?�싱?��? ?�음:', latestJsonMsg.rawJson);
                            return null;
                          }
                          
                          let jsonData;
                          try {
                            jsonData = JSON.parse(latestJsonMsg.rawJson);
                          } catch (parseError) {
                            console.error('Wait counter JSON parsing error:', parseError);
                            return null;
                          }
                            
                            // ?��??�태??경우???�기시�?카운???�시
                            if (jsonData.process_info === "waiting" && jsonData.remaining_time !== undefined && jsonData.total_time !== undefined) {
                              const remainingTime = parseInt(String(jsonData.remaining_time), 10);
                              const totalTime = parseInt(String(jsonData.total_time), 10);
                              
                              if (!isNaN(remainingTime) && !isNaN(totalTime) && totalTime > 0) {
                                const elapsedTime = totalTime - remainingTime;
                                const waitPercent = Math.min(100, Math.max(0, Math.floor((elapsedTime / totalTime) * 100)));
                                
                                return (
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] font-medium text-blue-700 w-14">?�기카?�터:</span>
                                    <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-in-out"
                                        style={{ width: `${waitPercent}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-[9px] font-semibold text-blue-700">{remainingTime}�?{totalTime}�?/span>
                                  </div>
                                );
                              }
                            }
                          // ?�프 가???�태????�?공정 ?�간 진행�??�시 추�?
                          else if (jsonData.process_info === "operating" || jsonData.pump_id) {
                            // process_time�?total_remaining???�는 경우
                            if (jsonData.process_time !== undefined && jsonData.total_remaining !== undefined) {
                              try {
                                // 문자?�이???�자�??�어?�는 경우�?모두 처리
                                const processTimeStr = typeof jsonData.process_time === 'string' ? 
                                  jsonData.process_time : String(jsonData.process_time);
                                const totalRemainingStr = typeof jsonData.total_remaining === 'string' ? 
                                  jsonData.total_remaining : String(jsonData.total_remaining);
                                
                                // 's' 문자 ?�거?�고 ?�자�?변??                                const processTime = parseInt(processTimeStr.replace(/[^0-9]/g, ''), 10);
                                const totalRemaining = parseInt(totalRemainingStr.replace(/[^0-9]/g, ''), 10);
                                
                                if (isNaN(processTime) || isNaN(totalRemaining)) {
                                  console.warn('?�효?��? ?��? 진행 ?�간 �?', 
                                    { process_time: jsonData.process_time, total_remaining: jsonData.total_remaining });
                                  return null;
                                }
                                
                                if (processTime > 0) {
                                  const elapsedTime = Math.max(0, processTime - totalRemaining);
                                  const progressPercent = Math.min(100, Math.max(0, Math.floor((elapsedTime / processTime) * 100)));
                                  console.log(`Progress: ${progressPercent}%, Elapsed: ${elapsedTime}, Total: ${processTime}`);
                                
                                return (
                                  <div className="flex items-center space-x-2">
                                      <span className="text-[10px] font-medium text-green-700 w-14">공정진행:</span>
                                    <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                          className="h-full bg-green-500 rounded-full transition-all duration-1000 ease-in-out"
                                          style={{ width: `${progressPercent}%` }}
                                      ></div>
                                    </div>
                                      <span className="text-[9px] font-semibold text-green-700">{progressPercent}%</span>
                                  </div>
                                );
                                }
                              } catch (e) {
                                console.error('Progress calculation error:', e);
                                return null;
                              }
                            }
                          }
                        } catch (e) {
                          console.error('Wait counter parsing error:', e);
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* 추�? ?�보 박스 2 - Loading Process */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
            <div className="bg-green-50 py-1 px-2 text-xs font-semibold text-green-700 rounded-t-lg border-b border-gray-200">
              Loading Process
            </div>
            <div className="p-3">
              {/* JSON ?�이??- ?�나�??�시 */}
              <div className="space-y-2">
                {progressMessages.filter(msg => msg.rawJson).slice(0, 1).map((msg, idx) => (
                  <div key={`json-${idx}`} className="p-2 rounded bg-white border border-gray-100 text-[10px] leading-tight">
                      <div className="flex justify-between items-center">
                      <span className="font-medium text-green-700">JSON ?�이??/span>
                      <span className="text-green-500 font-semibold text-[8px]">{formatTimeStr()}</span>
                      </div>
                      
                      {msg.rawJson && (
                        <div className="mt-2 bg-green-50 border border-green-100 rounded p-2 overflow-x-auto">
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px]">
                          {(() => {
                            try {
                              // ?�스??메시지??경우 처리
                              if (msg.rawJson.includes("?�재 밸브 ?�태") || 
                                  !msg.rawJson.trim().startsWith('{')) {
                                return (
                                  <div className="col-span-2">
                                    <span className="font-semibold text-green-700">메시지:</span>{" "}
                                    <span className="font-medium">{msg.rawJson}</span>
                                  </div>
                                );
                              }
                              
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
                                      <span className="font-semibold text-green-700">?�프:</span>{" "}
                                    <span className="font-medium">{jsonData.pump_id}</span>
                              </div>
                            )}
                                  {jsonData.remaining_time && (
                              <div>
                                <span className="font-semibold text-green-700">?��?:</span>{" "}
                                    <span className="font-medium">{jsonData.remaining_time}</span>
                              </div>
                            )}
                                  {jsonData.total_remaining && (
                              <div>
                                <span className="font-semibold text-green-700">총남?�:</span>{" "}
                                    <span className="font-medium">{jsonData.total_remaining}</span>
                              </div>
                            )}
                                  {jsonData.total_time && (
                              <div>
                                <span className="font-semibold text-green-700">총시�?</span>{" "}
                                    <span className="font-medium">{jsonData.total_time}</span>
                              </div>
                            )}
                                </>
                              );
                            } catch (error) {
                              return (
                                <div className="col-span-2 text-red-500">
                                  JSON ?�싱 ?�류: ?�못???�식
                                </div>
                              );
                            }
                          })()}
                          </div>
                        </div>
                      )}
                            </div>
                ))}
                            </div>
                            </div>
          </div>
          
          {/* 추�? ?�보 박스 3 - ?�림 */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="bg-gray-50 py-1 px-2 text-xs font-semibold text-gray-700 rounded-t-lg border-b border-gray-200">
              ?�림
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
                <div className="text-[9px] text-gray-500">?�로???�림???�습?�다</div>
              )}
            </div>
          </div>
          
          {/* ?�태 변�??�림 UI 추�? - ?�측 ?�단 �?공간??배치 */}
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
                      {notification.type === 'warning' ? '?�️ 경고' : 
                      notification.type === 'error' ? '???�류' : 
                      '?�� ?�림'}
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

      {/* ?�니메이???�프?�임 ?�의 */}
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
              <div className="font-bold text-[9px]">추출 진행 ?�황:</div>
              <div className="text-[8px] text-gray-500">{formatTimeStr()}</div>
            </div>
            <div className="max-h-[40px] overflow-y-auto px-1">
              {progressMessages.slice(0, 2).map((msg, idx) => (
                <div key={`msg-${idx}`} className="p-0.5 mb-0.5 rounded bg-white border border-gray-100 text-[9px] leading-tight flex items-center last:mb-0">
                  <div className="w-3 h-3 flex-shrink-0 bg-blue-100 rounded-full flex items-center justify-center mr-1">
                    <span className="text-[7px] font-bold text-blue-700">{idx+1}</span>
                  </div>
                  <div className="flex-grow overflow-hidden">
                    {msg.message || '진행 ?�보'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 진행 버튼 ?�태 ?�달???�한 ?�든 ?�소 */}
      <div className="hidden" id="process-running-state" data-running={processRunning.toString()}></div>
    </div>
  );
}

