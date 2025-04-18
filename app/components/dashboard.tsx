"use client"

import dynamic from 'next/dynamic'
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import MqttClient from "@/lib/mqtt-client"
import {
  getPumpCommandTopic,
  getPumpStateTopic,
  getTankLevelTopic,
  getPumpOverallStateTopic,
  getAllSubscriptionTopics,
  parseTankLevelMessage,
  parseValveStateMessage,
  parsePumpStateMessage,
  VALVE_STATE_TOPIC,
  VALVE_INPUT_TOPIC,
  PROCESS_PROGRESS_TOPIC,
  ERROR_TOPIC,
  EXTRACTION_OUTPUT_TOPIC,
  Tank
} from "@/lib/mqtt-topics"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { PumpSequence, TankSystemData, WorkLog } from '../types'
import * as apiService from '../services/api'
import { ChevronDown, ChevronUp } from 'lucide-react'
import workLogService from '../services/work-log-service'
import WorkLogBook from './work-log/work-log-book'
import AutomationProcess from './AutomationProcess'; // 자동화 공정 컴포넌트 import
import { v4 as uuidv4 } from 'uuid'
import { ClockIcon } from 'lucide-react'
import type { TankSystem, Tank } from "@/interface/tank" // type으로 임포트
import { toast } from "@/components/ui/use-toast" // toast 임포트 추가

// 카메라 구독 및 명령 토픽 형식
const CAM_COMMAND_TOPIC = "extwork/cam%d/command";
const CAM_STATE_TOPIC = "extwork/cam%d/state";

// 카메라 토픽 생성 함수
const getCamCommandTopic = (camNumber: number): string => {
  return CAM_COMMAND_TOPIC.replace("%d", camNumber.toString());
};

const getCamStateTopic = (camNumber: number): string => {
  return CAM_STATE_TOPIC.replace("%d", camNumber.toString());
};

// TankSystem 컴포넌트를 동적으로 임포트
const TankSystem = dynamic(
  () => import('@/app/components/tank-system'),
  { 
    ssr: false,
    loading: () => <div>탱크 시스템 로딩 중...</div>
  }
)

// 탱크 시스템 데이터 interface 확장
interface TankSystemDataWithMessages extends TankSystem {
  pumpStates?: Record<number, string>;
  progressInfo?: {
    step: string;
    elapsedTime: string;
    remainingTime: string;
    totalRemainingTime: string;
  };
  tankMessages?: Record<number, string>;
  mainTankMessage?: string;
}

// PumpSequence 인터페이스를 PumpSequenceType으로 변경
interface PumpSequenceType {
  name: string;
  operation_mode: number;
  repeats: number;
  process: number[];
  selectedPumps: boolean[];
  wait_time?: number;
}

// 서버에 상태 저장
const saveStateToServer = async (state: any) => {
  try {
    // 서버에 저장
    const serverSaved = await apiService.saveStateToServer(state);
    
    // 로컬 스토리지에도 백업으로 저장
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tankSystemState', JSON.stringify(state));
        console.log('상태가 로컬 스토리지에 백업되었습니다.');
      } catch (error) {
        console.error('로컬 스토리지에 상태 백업 중 오류:', error);
      }
    }
    
    return serverSaved;
  } catch (error) {
    console.error('상태 저장 중 오류:', error);
    // 서버 저장 실패 시 로컬 스토리지에만 저장
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('tankSystemState', JSON.stringify(state));
      console.log('상태가 로컬 스토리지에 저장되었습니다.');
      return true;
      } catch (localError) {
        console.error('로컬 스토리지에 상태 저장 중 오류:', localError);
    }
  }
  return false;
  }
};

// 서버에서 상태 불러오기
const loadStateFromServer = async () => {
  try {
    // 서버에서 불러오기 시도
    const serverState = await apiService.loadStateFromServer();
    if (serverState) {
      console.log('서버에서 상태를 불러왔습니다.');
      return serverState;
    }
  } catch (error) {
    console.error('서버에서 상태 불러오기 중 오류:', error);
  }
  
  // 서버에서 불러오기 실패 시 로컬 스토리지에서 시도
  if (typeof window !== 'undefined') {
    try {
      const savedState = localStorage.getItem('tankSystemState');
      if (savedState) {
        console.log('로컬 스토리지에서 상태를 불러왔습니다.');
        return JSON.parse(savedState);
      }
    } catch (error) {
      console.error('로컬 스토리지에서 상태 불러오기 중 오류:', error);
    }
  }
  
  return null;
};

// 서버에 시퀀스 저장
const saveSequencesToServer = async (sequences: PumpSequence[]): Promise<boolean> => {
  try {
    const response = await fetch('/api/sequences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sequences: sequences }),
    });
    
    if (response.ok) {
      console.log('시퀀스가 서버에 저장되었습니다.');
      // 성공 시에도 로컬에 백업
      saveSequencesToLocalStorage(sequences);
      return true;
    } else {
      console.error('시퀀스 저장 실패:', await response.text());
      // 서버 저장 실패 시 로컬에 백업
      saveSequencesToLocalStorage(sequences);
      return false;
    }
  } catch (error) {
    console.error('시퀀스 저장 중 오류:', error);
    // 오류 발생 시 로컬에 백업
    saveSequencesToLocalStorage(sequences);
    return false;
  }
};

// 서버에서 시퀀스 불러오기
const loadSequencesFromServer = async (): Promise<PumpSequence[] | null> => {
  try {
    // 서버에서 불러오기 시도
    const serverSequences = await apiService.loadSequencesFromServer();
    if (serverSequences && serverSequences.length > 0) {
      console.log('서버에서 시퀀스를 불러왔습니다.');
      return serverSequences;
    }
  } catch (error) {
    console.error('서버에서 시퀀스 불러오기 중 오류:', error);
  }
  
  // 서버에서 불러오기 실패 시 로컬 스토리지에서 시도
  const localSequences = loadSequencesFromLocalStorage();
  if (localSequences.length > 0) {
    console.log('로컬 스토리지에서 시퀀스를 불러왔습니다.');
    return localSequences;
  }
  
  return null;
};

// 로컬 스토리지에 시퀀스 저장
const saveSequencesToLocalStorage = (sequences: PumpSequence[]) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('savedSequences', JSON.stringify(sequences));
      return true;
    } catch (error) {
      console.error('로컬 스토리지에 시퀀스 저장 중 오류:', error);
      return false;
    }
  }
  return false;
};

// 로컬 스토리지에서 시퀀스 불러오기
const loadSequencesFromLocalStorage = (): PumpSequence[] => {
  if (typeof window !== 'undefined') {
    try {
      const savedSequences = localStorage.getItem('savedSequences');
      if (savedSequences) {
        try {
          const parsedSequences = JSON.parse(savedSequences);
          
          // 유효성 검사: 배열인지 확인
          if (!Array.isArray(parsedSequences)) {
            console.error('로컬 스토리지의 시퀀스 데이터가 배열이 아닙니다.');
            localStorage.removeItem('savedSequences'); // 잘못된 데이터 삭제
            return [];
          }
          
          // 각 시퀀스 항목 유효성 검사
          const validSequences = parsedSequences.filter(seq => {
            // 필수 필드 확인
            if (typeof seq !== 'object' || seq === null) return false;
            if (typeof seq.operation_mode !== 'number') return false;
            if (typeof seq.repeats !== 'number') return false;
            if (!Array.isArray(seq.process)) return false;
            
            // 선택적 필드 타입 검사 (존재하는 경우)
            if (seq.name !== undefined && typeof seq.name !== 'string') return false;
            if (seq.wait_time !== undefined && typeof seq.wait_time !== 'number') return false;
            if (seq.selectedPumps !== undefined && !Array.isArray(seq.selectedPumps)) return false;
            
            return true;
          });
          
          // 필터링된 시퀀스 확인
          if (validSequences.length < parsedSequences.length) {
            console.warn(`${parsedSequences.length - validSequences.length}개의 잘못된 시퀀스 데이터가 필터링되었습니다.`);
            // 유효한 시퀀스만 다시 저장
            localStorage.setItem('savedSequences', JSON.stringify(validSequences));
          }
          
          return validSequences;
        } catch (parseError) {
          console.error('로컬 스토리지의 시퀀스 JSON 파싱 오류:', parseError);
          localStorage.removeItem('savedSequences'); // 손상된 데이터 삭제
          return [];
        }
      }
    } catch (error) {
      console.error('로컬 스토리지에서 시퀀스 불러오기 중 오류:', error);
    }
  }
  return [];
};

// 타입 정의 추가
type ScheduledTask = {
  id: string;
  taskName: string;
  waitTime: number;
  scheduledTime: number;
  orderNumber: number; // 1~9 사이의 값만 가능
  repeats: number;
  isStarted: boolean; // 작업 시작 여부
  isRunning: boolean; // 현재 카운트다운 진행 중 여부
  isProcessing: boolean; // 다른 작업 실행 중 대기 여부
  isCompleted: boolean; // 작업 완료 여부
};

export default function Dashboard() {
  const [topic, setTopic] = useState(VALVE_INPUT_TOPIC)
  const [message, setMessage] = useState("")
  const [mqttClient, setMqttClient] = useState<MqttClient | null>(null)
  const [mqttStatus, setMqttStatus] = useState("연결 중...")
  const [progress, setProgress] = useState(0)
  const [pumpModalOpen, setPumpModalOpen] = useState(false)
  const [selectedPump, setSelectedPump] = useState<number | null>(null)
  const [camStates, setCamStates] = useState<Array<"ON" | "OFF">>(Array(5).fill("OFF"))
  const [lightStates, setLightStates] = useState<Array<"ON" | "OFF">>(Array(5).fill("OFF"))
  const [camStateMessages, setCamStateMessages] = useState<{[key: number]: string}>({})
  const [tankData, setTankData] = useState<TankSystemDataWithMessages>({
    tanks: [],
    mainTank: { level: 0, status: "empty" },
    valveState: "0000"
  })
  
  // 프로그레스 메시지 타입 정의
  type ProgressMessage = {
    timestamp: number;
    message: string;
    rawJson?: string | null;
  };
  
  // 펌프 상태 메시지 타입 정의
  type PumpStateMessage = {
    id: number;
    timestamp: number;
    message: string;
  };
  
  const [progressMessages, setProgressMessages] = useState<ProgressMessage[]>([])
  const [currentValveState, setCurrentValveState] = useState<string>("0000")
  const [pumpStateMessages, setPumpStateMessages] = useState<PumpStateMessage[]>([])
  const [pumpMessages, setPumpMessages] = useState<Record<number, string>>({})
  const [kButtonActive, setKButtonActive] = useState(false)
  const [activeTab, setActiveTab] = useState("tanks")
  const [isAutomationLocked, setIsAutomationLocked] = useState(false)
  const [progressData, setProgressData] = useState({})
  const [lastErrors, setLastErrors] = useState<string[]>([])
  // 시간 설정 팝업 관련 전역 상태 추가
  const [globalTimePickerOpen, setGlobalTimePickerOpen] = useState<{ isOpen: boolean, componentId: string }>({ isOpen: false, componentId: "" })
  
  // 탭 변경 핸들러
  const handleTabChange = (value: string) => {
    // 탭 변경 허용 (제한 없음)
    setActiveTab(value);
    
    // 자동화 탭에서 다른 탭으로 이동할 때 안내 메시지 표시 (자동화 실행 중이면)
    if (isAutomationLocked && value !== "automation") {
      addProgressMessage({
        timestamp: Date.now(),
        message: "자동화 공정이 백그라운드에서 계속 실행 중입니다. 자동화 탭으로 돌아가면 진행 상황을 확인할 수 있습니다.",
        rawJson: null
      });
    }
  };
  
  // 자동화 잠금/해제 핸들러
  const setAutomationLock = (locked: boolean) => {
    setIsAutomationLocked(locked);
    
    // 자동화 시작 시 자동화 탭으로 이동
    if (locked && activeTab !== "automation") {
      setActiveTab("automation");
      
      addProgressMessage({
        timestamp: Date.now(),
        message: "자동화 공정 시작: 다른 탭으로 이동하더라도 공정은 계속 진행됩니다.",
        rawJson: null
      });
    }
  };
  
  // 아래 중복 선언된 변수 제거
  const [searchTopic, setSearchTopic] = useState("")
  const [progressStatus, setProgressStatus] = useState<"connected" | "disconnected">("disconnected")
  
  // 큐 상태
  const [queueStatus, setQueueStatus] = useState<any>(null);
  
  // JSON 미리보기
  const [previewJson, setPreviewJson] = useState<string>("");

  // 첫 렌더링 여부 추적
  const isFirstRender = useRef(true);

  // 카메라 스트리밍 상태 관리
  const [streamingStates, setStreamingStates] = useState<Array<boolean>>([false, false, false, false, false]);

  // 작업 로그북 관련 상태 추가
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [currentWorkLogId, setCurrentWorkLogId] = useState<string | null>(null);

  // 작업목록 버튼 상태 관리를 위한 상태
  const [workInProgress, setWorkInProgress] = useState<Record<string, boolean>>({});

  // 카메라 스트리밍 토글 함수
  const toggleStreaming = (camNumber: number) => {
    if (!mqttClient) return;
    
    const currentState = streamingStates[camNumber - 1];
    const newState = !currentState;
    
    // 스트리밍 제어 명령 발행 (s0: 스트리밍 중지, s1: 스트리밍 시작)
    const command = newState ? "s1" : "s0";
    mqttClient.publish(getCamCommandTopic(camNumber), command);
    
    // UI 상태 업데이트
    setStreamingStates(prev => {
      const newStates = [...prev];
      newStates[camNumber - 1] = newState;
      return newStates;
    });
  };

  // 카메라 라이트 토글 함수 수정 - lightStates 사용
  const toggleLight = (camNumber: number) => {
    if (!mqttClient) return;
    
    const currentState = lightStates[camNumber - 1];
    const newState = currentState === "OFF" ? "ON" : "OFF";
    
    // 새 상태 배열 생성 및 업데이트
    const newLightStates = [...lightStates];
    newLightStates[camNumber - 1] = newState;
    setLightStates(newLightStates);
    
    // ON/OFF에 따라 0 또는 1 발행
    // OFF 상태일 때 스위치를 누르면 1을 발행해서 켜고, ON 상태일 때는 0을 발행해서 끔
    const command = newState === "ON" ? "1" : "0";
    mqttClient.publish(getCamCommandTopic(camNumber), command);
  };

  // 카메라 리셋 함수
  const resetCamera = (camNumber: number) => {
    if (!mqttClient) return;
    mqttClient.publish(getCamCommandTopic(camNumber), "reset");
  };

  // 로컬 스토리지에서 이전 밸브 상태 로드
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        // 탱크 데이터 로드
        const savedTankData = localStorage.getItem('tankData');
        if (savedTankData) {
          try {
            setTankData(JSON.parse(savedTankData));
          } catch (parseError) {
            console.error('탱크 데이터 JSON 파싱 오류:', parseError);
            // 잘못된 데이터 삭제
            localStorage.removeItem('tankData');
          }
        }

        // 밸브 상태 로드 (별도 저장된 경우)
        const savedValveState = localStorage.getItem('valveState');
        if (savedValveState) {
          try {
            const valveState = JSON.parse(savedValveState);
            // valveState를 탱크 데이터에 적용하는 로직 (필요한 경우)
          } catch (parseError) {
            console.error('밸브 상태 JSON 파싱 오류:', parseError);
            // 잘못된 데이터 삭제
            localStorage.removeItem('valveState');
          }
        }
      } catch (error) {
        console.error('로컬 스토리지에서 데이터 로드 중 오류:', error);
      }
    }
  }, []);

  // 초기 데이터 로드
  useEffect(() => {
    // 서버에서 초기 상태 로드
    const loadInitialServerState = async () => {
      const serverState = await loadStateFromServer();
      
      if (serverState) {
        console.log('서버에서 상태 로드 성공');
        // 서버 상태로 탱크 데이터 업데이트
        setTankData(serverState);
      } else {
        console.log('서버 상태 없음, 기본값 사용');
      }
    };
    
    loadInitialServerState();
  }, []);

  // 상태 변경 시 서버에 저장
  useEffect(() => {
    // 첫 렌더링 시에는 저장하지 않음
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    // 상태 변경 시 서버에 저장
    saveStateToServer(tankData);
  }, [tankData]);

  // MQTT 클라이언트 초기화
  useEffect(() => {
    console.log("MQTT 클라이언트 초기화 시작 - 현재 위치:", window.location.href);
    
    // MQTT 클라이언트 생성
    const client = new MqttClient();

    client.on('connect', () => {
      console.log("MQTT 브로커에 연결 성공!");
      setMqttStatus("연결됨");

      // 모든 토픽 구독 (6개 인버터 기준)
      const topics = getAllSubscriptionTopics(6);
      console.log("구독할 토픽:", topics);
      
      topics.forEach(topic => {
        client.subscribe(topic);
        console.log(`토픽 구독: ${topic}`);
      });
      
      // 밸브 상태 토픽 명시적 구독 추가
      client.subscribe(VALVE_STATE_TOPIC);
      console.log("밸브 상태 토픽 명시적 구독:", VALVE_STATE_TOPIC);
      
      // 진행 상황 토픽 명시적 구독
      client.subscribe(PROCESS_PROGRESS_TOPIC);
      console.log("진행 상황 토픽 구독:", PROCESS_PROGRESS_TOPIC);
      
      // 에러 토픽 구독
      client.subscribe(ERROR_TOPIC);
      console.log("에러 토픽 구독:", ERROR_TOPIC);
      
      // 메인 탱크 수위 토픽 명시적 구독 추가
      client.subscribe('extwork/tankMain/level');
      console.log("메인 탱크 수위 토픽 구독: extwork/tankMain/level");
      
      // 연결 즉시 밸브 상태 요청 메시지 전송
      console.log("밸브 상태 요청 메시지 전송:", VALVE_INPUT_TOPIC);
      // client.publish(VALVE_INPUT_TOPIC, "STATUS");

      // 카메라 상태 토픽 구독 추가
      for (let i = 1; i <= 5; i++) {
        client.subscribe(getCamStateTopic(i));
        console.log("카메라 상태 토픽 구독:", getCamStateTopic(i));
      }
    });

    client.on('disconnect', () => {
      console.log("MQTT 브로커와 연결이 끊겼습니다.");
      setMqttStatus("연결 끊김");
      setProgressStatus("disconnected");
      
      // 5초 후 자동 재연결 시도
      setTimeout(() => {
        console.log("MQTT 자동 재연결 시도...");
        if (!client.isConnected()) {
          client.connect();
        }
      }, 5000);
    });

    client.on('error', (error) => {
      console.error("MQTT 오류 발생:", error);
      // 오류 메시지 표시
      setLastErrors(prev => {
        const newErrors = [`MQTT 오류: ${error.message}`, ...prev].slice(0, 5);
        return newErrors;
      });
    });

    setMqttClient(client);
    
    // 자동으로 연결 시작
    console.log("MQTT 브로커에 연결 시도...");
    client.connect();  // 기본 URL과 인증 정보를 사용하도록 수정

    // 컴포넌트 언마운트 시 연결 종료
    return () => {
      console.log("Dashboard 컴포넌트 언마운트, MQTT 연결 종료");
      client.disconnect();
    };
  }, []);

  // MQTT 메시지 수신 처리 - 별도의 useEffect로 분리
  useEffect(() => {
    if (!mqttClient) return;
    
    console.log("MQTT 메시지 핸들러 설정 중...");
    
    const handleMessage = (topic: string, message: Buffer) => {
      const messageStr = message.toString();
      console.log(`[MQTT 메시지 수신] 토픽: ${topic}, 메시지: ${messageStr}`);
      
      // 메인 탱크 수위 토픽 처리 - 최우선 처리
      if (topic === 'extwork/tankMain/level') {
        console.log(`[메인 탱크] 수위 메시지 수신: ${messageStr}`);
        
        // 시간 추가하여 표시 메시지 생성
        const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const displayMessage = `${messageStr} (${timeStr})`;
        
        // 메인 탱크 메시지 저장 (본탱크 텍스트 박스용)
        setTankData(prev => {
          console.log('[메인 탱크] 메시지 업데이트:', displayMessage);
          
          const updatedData = {
            ...prev,
            mainTankMessage: displayMessage
          };
          
          // 업데이트된 상태 로깅
          console.log('[메인 탱크] 업데이트된 데이터:', JSON.stringify(updatedData));
          
          // 서버에 상태 저장
          saveStateToServer(updatedData);
          
          return updatedData;
        });
        
        // 진행 메시지에도 추가하여 로그에 남김
        setProgressMessages(prev => {
          const newMessage = {
            timestamp: Date.now(),
            message: `메인 탱크 수위 업데이트: ${messageStr}`,
            rawJson: null
          };
          return [newMessage, ...prev].slice(0, 20);
        });
        
        return;
      }
      
      try {
        // 토픽에 따른 처리
        if (topic.match(/extwork\/inverter(\d+)\/state/)) {
          const inverterId = Number.parseInt(topic.match(/extwork\/inverter(\d+)\/state/)![1]);
          const pumpStatus = parsePumpStateMessage(messageStr);

          // 인버터에 해당하는 탱크 업데이트 (1:1 매핑)
          setTankData((prev) => {
            // tanks가 undefined인 경우 기본값으로 빈 배열 사용
            if (!prev || !prev.tanks) {
              console.error('Tank data is undefined or missing tanks array', prev);
              // 초기 상태를 적절히 생성
              return prev || { 
                tanks: [], 
                mainTank: prev?.mainTank || { level: 0, lastUpdate: new Date().toISOString() }, 
                valveState: prev?.valveState || 'unknown'
              };
            }
            
            const updatedTanks = prev.tanks.map((tank) => {
              if (tank.id === inverterId) {  // id와 inverterId가 동일하게 매핑됨
                return { ...tank, pumpStatus }
              }
              return tank
            })

            // 업데이트된 상태
            const updatedState = { ...prev, tanks: updatedTanks }
            
            // 변경된 상태를 서버에 저장
            saveStateToServer(updatedState)
            
            return updatedState
          })
          return
        }

        // 밸브 상태 토픽 처리 - extwork/valve/state
        if (topic === VALVE_STATE_TOPIC) {
          console.log(`밸브 상태 메시지 수신: ${messageStr}`);
          
          // 밸브 상태 파싱 및 업데이트
          const valveInfo = parseValveStateMessage(messageStr);
          
          // 상태 로그 추가
          setProgressMessages(prev => {
            const newMessage = {
              timestamp: Date.now(),
              message: `밸브 상태 업데이트: ${messageStr} (밸브A: ${valveInfo.valveADesc || '알 수 없음'}, 밸브B: ${valveInfo.valveBDesc || '알 수 없음'})`,
              rawJson: messageStr
            };
            return [newMessage, ...prev].slice(0, 20); // 로그 개수 20개로 증가
          });
          
          return;
        }
        
        // 추출 진행 상황 토픽 처리 (extwork/extraction/progress)
        if (topic === PROCESS_PROGRESS_TOPIC) {
          console.log(`추출 진행 상황 메시지 수신: ${messageStr}`);
          
          // 진행 상황 데이터 업데이트
          setProgressData(messageStr);
          setProgressStatus("connected");
          
          try {
            // JSON 형식인 경우 파싱하여 저장
            const jsonData = JSON.parse(messageStr);
            
            // 작업 완료 메시지 감지 시
            if (jsonData.status === 'completed' || messageStr.includes('completed')) {
              if (currentWorkLogId) {
                workLogService.updateWorkLog(currentWorkLogId, {
                  status: 'completed',
                  endTime: new Date().toISOString(),
                  errorDetails: '작업이 성공적으로 완료되었습니다.'
                }).then(() => {
                  loadWorkLogs();
                  setCurrentWorkLogId(null);
                });
              }
            }
            
            // 작업 중단 메시지 감지 시
            if (jsonData.status === 'stopped' || messageStr.includes('stopped')) {
              if (currentWorkLogId) {
                workLogService.updateWorkLog(currentWorkLogId, {
                  status: 'aborted',
                  endTime: new Date().toISOString(),
                  errorDetails: '작업이 중단되었습니다.'
                }).then(() => {
                  loadWorkLogs();
                  setCurrentWorkLogId(null);
                });
              }
            }
            
            // 오류 메시지 감지 시
            if (jsonData.status === 'error' || messageStr.includes('error')) {
              if (currentWorkLogId) {
                workLogService.updateWorkLog(currentWorkLogId, {
                  status: 'error',
                  endTime: new Date().toISOString(),
                  errorDetails: `오류 발생: ${jsonData.message || messageStr}`
                }).then(() => {
                  loadWorkLogs();
                  setCurrentWorkLogId(null);
                });
              }
            }
            
            const timestamp = Date.now();
            let displayMessage = "";
            
            // JSON 데이터에서 메시지 추출
            if (jsonData.message) {
              displayMessage = jsonData.message;
            } else if (jsonData.step) {
              displayMessage = `단계 ${jsonData.step}: ${jsonData.description || '진행 중'}`;
              
              // 진행 정보 추출
              let stepInfo = `S(${jsonData.current_step || 0}/${jsonData.total_steps || 0})`;
              let elapsedTime = jsonData.elapsed_time ? formatTime(jsonData.elapsed_time) : "00:00";
              let remainingTime = jsonData.remaining_time ? formatTime(jsonData.remaining_time) : "00:00";
              let totalRemainingTime = jsonData.total_remaining_time ? formatTime(jsonData.total_remaining_time) : "00:00";
              
              // 진행 정보 업데이트
              setProgressInfo({
                step: stepInfo,
                elapsedTime,
                remainingTime,
                totalRemainingTime
              });
              
              // 탱크 데이터에도 진행 정보 추가
              setTankData(prev => ({
                ...prev,
                progressInfo: {
                  step: stepInfo,
                  elapsedTime,
                  remainingTime,
                  totalRemainingTime
                }
              }));
            } else {
              displayMessage = `진행 상황 업데이트: ${messageStr}`;
            }
            
            // 메시지 크기 제한 (10KB 이상인 경우)
            let rawJson = messageStr;
            if (rawJson && rawJson.length > 10000) {
              console.warn(`메시지 크기가 너무 큽니다: ${rawJson.length} 바이트`);
              rawJson = rawJson.substring(0, 10000) + "... (메시지 크기 초과로 잘림)"
            }
            
            // 로그 추가 - 최신 메시지가 맨 앞에 오도록 변경
            setProgressMessages(prev => {
              const newMessage = {
                timestamp,
                message: displayMessage,
                rawJson: rawJson
              };
              return [newMessage, ...prev].slice(0, 10); // 최신 10개 메시지만 유지
            });
          } catch (error) {
            console.error('JSON 파싱 오류:', error);
            
            // JSON이 아닌 일반 텍스트 메시지 처리 - 메시지 크기 제한 추가
            let displayMessage = messageStr;
            if (displayMessage && displayMessage.length > 10000) {
              console.warn(`메시지 크기가 너무 큽니다: ${displayMessage.length} 바이트. 잘라냅니다.`);
              displayMessage = displayMessage.substring(0, 10000) + `... (메시지 크기 초과로 잘림)`;
            }
            
            setProgressMessages(prev => {
              const newMessage = {
                timestamp: Date.now(),
                message: displayMessage,
                rawJson: null
              };
              return [newMessage, ...prev].slice(0, 10); // 최신 10개 메시지만 유지
            });
          }
          
          return;
        }

        // 에러 토픽 처리 (extwork/extraction/error)
        if (topic === ERROR_TOPIC) {
          console.log(`에러 메시지 수신: ${messageStr}`);
          
          // 에러 메시지 추가
          setLastErrors(prev => {
            const newErrors = [`${new Date().toLocaleTimeString()}: ${messageStr}`, ...prev].slice(0, 5);
            return newErrors;
          });
          
          // 작업 로그 오류 상태 업데이트
          if (currentWorkLogId) {
            workLogService.updateWorkLog(currentWorkLogId, {
              status: 'error',
              endTime: new Date().toISOString(),
              errorDetails: `오류 발생: ${messageStr}`
            }).then(() => {
              loadWorkLogs();
              setCurrentWorkLogId(null);
            });
          }
          
          return;
        }

        // 탱크 수위 토픽 처리 - extwork/inverter%d/tank%d_level 형식
        const tankLevelMatch = topic.match(/extwork\/inverter(\d+)\/tank(\d+)_level/)
        if (tankLevelMatch) {
          const inverterId = Number.parseInt(tankLevelMatch[1])
          const tankId = Number.parseInt(tankLevelMatch[2])
          
          console.log(`탱크 수위 메시지 수신 - 인버터: ${inverterId}, 탱크: ${tankId}, 메시지: ${messageStr}`)
          
          // 시간 추가하여 표시 메시지 생성
          const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
          
          // 세 가지 상태만 표시하도록 메시지 가공
          let simplifiedMessage = messageStr;
          
          // "비어있음(5%미만)", "5% 이상 잔여", "가득채워짐" 세 가지 상태만 표시
          if (messageStr.includes("5%미만") || messageStr.toLowerCase().includes("empty") || 
              messageStr.includes("비어있") || messageStr.includes("비었")) {
            simplifiedMessage = "비어있음(5%미만)";
          } else if (messageStr.includes("가득") || messageStr.toLowerCase().includes("full") || 
                     messageStr.includes("100%")) {
            simplifiedMessage = "가득채워짐";
          } else if (messageStr.includes("%")) {
            // 수위 퍼센트 정보가 있으면 "5% 이상 잔여"로 표시
            simplifiedMessage = "5% 이상 잔여";
          }
          
          const displayMessage = `${simplifiedMessage} (${timeStr})`;
      
          // 중요: tank_level 메시지는 탱크 메시지로 저장 (펌프 태그 아님)
          setTankData(prev => {
            // 탱크 메시지 업데이트
            return {
              ...prev,
              tankMessages: {
                ...(prev.tankMessages || {}),
                [tankId]: displayMessage
              }
            };
          });
          
          return
        }

        // 메인 탱크 수위 토픽 처리 - extwork/tankMain/level 형식
        if (topic === 'extwork/tankMain/level') {
          console.log(`메인 탱크 수위 메시지 수신: ${messageStr}`)
          
          // 시간 추가하여 표시 메시지 생성
          const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
          const displayMessage = `${messageStr} (${timeStr})`;
          
          // 메인 탱크 메시지 저장 (본탱크 텍스트 박스용)
          setTankData(prev => {
            console.log('메인 탱크 메시지 업데이트:', displayMessage);
            // 디버깅을 위한 이전 상태 로깅 추가
            console.log('이전 탱크 데이터:', JSON.stringify(prev));
            
            const updatedData = {
              ...prev,
              mainTankMessage: displayMessage
            };
            
            // 업데이트된 상태 로깅
            console.log('업데이트된 탱크 데이터:', JSON.stringify(updatedData));
            return updatedData;
          });
          
          // 진행 메시지에도 추가하여 로그에 남김
          setProgressMessages(prev => {
            const newMessage = {
              timestamp: Date.now(),
              message: `메인 탱크 수위 업데이트: ${messageStr}`,
              rawJson: null
            };
            return [newMessage, ...prev].slice(0, 20);
          });
          
          return;
        }

        // 펌프 전체 상태 토픽 처리
        const overallStateMatch = topic.match(/extwork\/inverter(\d+)\/overallstate/)
        if (overallStateMatch) {
          const inverterId = Number.parseInt(overallStateMatch[1])
          console.log(`인버터 ${inverterId}의 전체 상태 업데이트:`, messageStr)
          
          // 메인 탱크 상태 정보가 포함되어 있을 경우
          if (messageStr.includes("main") || messageStr.includes("본탱크")) {
            let status: "empty" | "filling" | "full" = "empty"
            let level = 0
            
            if (messageStr.includes("full") || messageStr.includes("가득")) {
              status = "full"
              level = 100
            } else if (messageStr.includes("filling") || messageStr.includes("채워")) {
              status = "filling"
              level = 50
            }
            
            // 메인 탱크 상태를 업데이트 (이 부분은 유지하되, 명확한 메인 탱크 메시지일 때만 적용)
            console.log("메인 탱크 상태 변경:", status, level);
            
            // 상태 메시지에 "본탱크" 또는 "main"이 직접적으로 포함된 경우에만 상태 변경
            if (messageStr.includes("본탱크") || messageStr.includes("main")) {
              setTankData(prev => ({
                ...prev,
                mainTank: {
                  status,
                  level
                }
              }))
            }
          }
          
          // 연결 타입 감지 (WiFi/BLE) - 모든 인버터(1~6번)를 위한 연결 타입 처리
          if (inverterId >= 1 && inverterId <= 6) {
            console.log(`${inverterId}번 펌프 연결 상태 확인:`, messageStr);
            
            setTankData(prev => {
              if (!prev || !prev.tanks) return prev;
              
              const updatedTanks = [...prev.tanks];
              if (updatedTanks[inverterId - 1]) {
                const tank = updatedTanks[inverterId - 1];
                
                // BLE 연결 관련 메시지 확인
                if (messageStr.includes("BLE만 연결됨") || 
                    messageStr.includes("BLE 환경으로 전환됨") || 
                    messageStr.includes("집단지성 네트워크") && !messageStr.includes("MQTT=연결됨")) {
                  // BLE 연결 상태 설정
                  updatedTanks[inverterId - 1] = {
                    ...tank,
                    connectionType: "BLE" as "BLE" | "WiFi"
                  };
                }
                // WiFi/MQTT 연결 관련 메시지 확인
                else if (messageStr.includes("MQTT만 연결됨") || 
                         messageStr.includes("MQTT 환경으로 전환됨") || 
                         messageStr.includes("MQTT 환경에서 동작 중") || 
                         messageStr.includes("MQTT 재연결 완료") ||
                         messageStr.includes("집단지성 네트워크: ") && messageStr.includes("MQTT=연결됨") ||
                         messageStr.includes("환경 상태: MQTT만 연결됨")) {
                  // WiFi 연결 상태 설정
                  updatedTanks[inverterId - 1] = {
                    ...tank,
                    connectionType: "WiFi" as "BLE" | "WiFi"
                  };
                }
              }
              
              return {
                ...prev,
                tanks: updatedTanks
              };
            });
          }
          
          // overallstate 메시지는 펌프 태그에 표시
          setPumpStateMessages(prev => {
            // prev가 배열인지 확인하고 아니면 빈 배열로 초기화
            const updatedMessages = Array.isArray(prev) ? [...prev] : [];
            updatedMessages[inverterId] = {
              id: inverterId,
              timestamp: Date.now(),
              message: messageStr
            };
            return updatedMessages;
          });
          
          return
        }

        // 카메라 상태 토픽 처리
        const camStateMatch = topic.match(/extwork\/cam(\d+)\/state/)
        if (camStateMatch) {
          const camNumber = parseInt(camStateMatch[1])
          if (camNumber >= 1 && camNumber <= 5) {
            // Flash ON/OFF 메시지 처리
            let camStatus: "ON" | "OFF" = "OFF";
            
            // 메시지가 "Flash ON" 또는 "Flash OFF"인 경우 처리
            if (messageStr.includes("Flash ON")) {
              camStatus = "ON";
              setLightStates(prev => {
                const newStates = [...prev];
                newStates[camNumber - 1] = "ON";
                return newStates;
              });
            } else if (messageStr.includes("Flash OFF")) {
              camStatus = "OFF";
              setLightStates(prev => {
                const newStates = [...prev];
                newStates[camNumber - 1] = "OFF";
                return newStates;
              });
            } else {
              // 기존 카메라 상태 처리 로직 유지
              camStatus = messageStr === "1" ? "ON" : "OFF";
              setCamStates(prev => {
                const newStates = [...prev];
                newStates[camNumber - 1] = camStatus;
                return newStates;
              });
            }
            
            // 상태 메시지 저장
            setCamStateMessages(prev => ({
              ...prev,
              [camNumber]: messageStr
            }));
            return;
          }
        }
      } catch (error) {
        console.error('MQTT 메시지 처리 오류:', error);
      }
      
      // 추출 명령 응답 처리 (extwork/extraction/output)
      if (topic === EXTRACTION_OUTPUT_TOPIC) {
        console.log(`추출 명령 응답 수신: ${messageStr}`);
        
        try {
          // 작업목록 상태 업데이트
          if (messageStr.includes("JSON 명령이 성공적으로 처리되었습니다.")) {
            // 추출 성공 시 해당 작업목록 진행중 상태로 변경
            const currentRunningSequence = localStorage.getItem('currentRunningSequence');
            if (currentRunningSequence) {
              setWorkInProgress(prev => ({
                ...prev,
                [currentRunningSequence]: true
              }));
            }
          } else if (messageStr.includes("공정 종료")) {
            // 공정 종료 시 작업목록 상태 초기화
            const currentRunningSequence = localStorage.getItem('currentRunningSequence');
            if (currentRunningSequence) {
              setWorkInProgress(prev => ({
                ...prev,
                [currentRunningSequence]: false
              }));
              localStorage.removeItem('currentRunningSequence');
            }
          }
          
          // 메시지 표시
          setProgressMessages(prev => [{
            timestamp: Date.now(),
            message: `추출 명령 응답: ${messageStr}`,
            rawJson: null
          }, ...prev]);
        } catch (error) {
          console.error('추출 명령 응답 처리 중 오류:', error);
        }
        
        return;
      }
    };

    // 메시지 핸들러 등록
    mqttClient.on('message', handleMessage);
    
    // 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      mqttClient.off('message', handleMessage);
    };
  }, [mqttClient]);

  // 카메라 상태 변경 함수
  const toggleCamera = (camNumber: number) => {
    if (!mqttClient) return
    
    
    // 현재 상태 확인 (인덱스는 0부터 시작하므로 camNumber - 1)
    const currentState = camStates[camNumber - 1]
    // 토글할 새 상태
    const newState = currentState === "ON" ? "OFF" : "ON"
    // 메시지 값 (ON -> 1, OFF -> 0)
    const messageValue = newState === "ON" ? "1" : "0"
    
    // 메시지 발행
    mqttClient.publish(getCamCommandTopic(camNumber), messageValue)
    
    // UI에 즉시 반영 (실제 상태는 구독한 state 토픽으로부터 업데이트될 것임)
    setCamStates(prev => {
      const newStates = [...prev]
      newStates[camNumber - 1] = newState
      return newStates
    })
  }

  // 밸브 상태 변경
  const changeValveState = (newState: string) => {
    if (mqttClient) {
      console.log(`[디버깅] 밸브 상태 변경: ${newState}`);
      
      // 상태에 따른 MQTT 메시지 결정
      let mqttMessage = '';
      
      if (newState === 'extraction_circulation') {
        mqttMessage = '1000'; // 추출 순환
      } else if (newState === 'full_circulation') {
        mqttMessage = '0100'; // 전체 순환
      } else if (newState === 'valve_exchange') {
        mqttMessage = '0000'; // 본탱크 수집
      } else if (newState === 'extraction_open') {
        mqttMessage = '1100'; // 추출 개방
      }
      
      if (mqttMessage) {
        console.log(`[디버깅] 밸브 상태 변경 MQTT 메시지 발행: ${mqttMessage}, 토픽: ${VALVE_INPUT_TOPIC}`);
        mqttClient.publish(VALVE_INPUT_TOPIC, mqttMessage)
        
        // STATUS 요청 메시지 제거
        // setTimeout(() => {
        //   console.log("[디버깅] 밸브 상태 요청 메시지 추가 전송: STATUS");
        //   // mqttClient.publish(VALVE_INPUT_TOPIC, "STATUS");
        // }, 500);
        
        // 즉시 UI 업데이트를 위해 로컬에서도 처리
        console.log("[디버깅] 로컬에서 밸브 상태 메시지 파싱: ", mqttMessage);
        parseValveStateMessage(mqttMessage);
        
        // LocalStateManager에 밸브 상태 저장
        try {
          import('@/lib/local-state-manager').then(module => {
            const localStateManager = module.default.getInstance();
            localStateManager.saveValveState(mqttMessage);
            console.log("[디버깅] 밸브 상태를 LocalStateManager에 저장: ", mqttMessage);
          });
        } catch (error) {
          console.error("[디버깅] LocalStateManager에 밸브 상태 저장 실패: ", error);
        }
      } else {
        console.log(`[디버깅] 알 수 없는 밸브 상태: ${newState}, 아무 동작도 하지 않음`);
      }
    } else {
      console.log('[디버깅] MQTT 클라이언트가 없어 밸브 상태를 변경할 수 없습니다.');
    }
  }

  // 펌프 토글 (ON/OFF) 함수 추가
  const togglePump = (pumpId: number) => {
    if (!mqttClient) return;
    
    // 현재 펌프 상태 확인
    const currentState = tankData?.tanks?.[pumpId - 1]?.pumpStatus || "OFF";
    // 토글할 새 상태
    const newState = currentState === "ON" ? "OFF" : "ON";
    // 메시지 값 (ON -> 1, OFF -> 0)
    const messageValue = newState === "ON" ? "1" : "0";
    
    console.log(`펌프 ${pumpId} 토글: ${currentState} -> ${newState}`);
    
    // 명령 발행
    const topic = getPumpCommandTopic(pumpId);
    mqttClient.publish(topic, messageValue);
    
    // 상태 즉시 업데이트 (UI 반응성 향상)
    setTankData(prev => {
      const updatedTanks = prev.tanks.map(tank => {
        if (tank.id === pumpId) {
          return { ...tank, pumpStatus: newState as "ON" | "OFF" };
        }
        return tank;
      });
      
      const updatedState = { ...prev, tanks: updatedTanks };
      
      // 서버에 상태 저장
      saveStateToServer(updatedState);
      
      return updatedState;
    });
  };
  
  // 펌프 리셋 함수 추가
  const resetPump = (pumpId: number) => {
    if (!mqttClient) return;
    
    console.log(`펌프 ${pumpId} 리셋 명령 발행`);
    
    // 리셋 명령(3) 발행 - 리셋 명령은 코드 3입니다
    const topic = getPumpCommandTopic(pumpId);
    mqttClient.publish(topic, "3");
  };
  
  // 펌프 K 명령 함수 추가 (디바운싱 적용)
  const [kCommandLock, setKCommandLock] = useState(false);

  const sendPumpKCommand = (pumpId: number) => {
    if (!mqttClient || kCommandLock) return;
    
    // 연속 클릭 방지를 위한 락 설정
    setKCommandLock(true);
    console.log(`펌프 ${pumpId}에 k 명령 발행 (단일 발행)`);
    
    // k 명령 발행 (소문자로 변경) - 한번만 발행
    const topic = getPumpCommandTopic(pumpId);
    mqttClient.publish(topic, "k");
    
    // 일정 시간 후 락 해제 (1초)
    setTimeout(() => {
      setKCommandLock(false);
    }, 1000);
  };

  // 추출 명령 발행 함수에 디바운싱 추가
  const [commandLock, setCommandLock] = useState<Record<string, boolean>>({});

  const sendExtractionCommand = (command: string) => {
    if (!mqttClient || commandLock[command]) return;
    
    // 연속 클릭 방지를 위한 락 설정
    setCommandLock(prev => ({ ...prev, [command]: true }));
    console.log(`추출 명령 발행: ${command}`);
    
    // 추출 명령 발행 (extwork/extraction/input 토픽으로)
    const topic = "extwork/extraction/input";
    mqttClient.publish(topic, command);
    
    // 로그 메시지 추가
    setProgressMessages(prev => {
      const newMessage = {
        timestamp: Date.now(),
        message: `추출 명령 발행: ${command}`,
        rawJson: null
      };
      return [newMessage, ...prev].slice(0, 10);
    });

    // 일정 시간 후 락 해제 (500ms)
    setTimeout(() => {
      setCommandLock(prev => ({ ...prev, [command]: false }));
    }, 500);
  };

  // MQTT 브로커에 연결
  const connectMqtt = () => {
    if (typeof window !== 'undefined') {
      const client = new MqttClient(true); // 오프라인 지원 활성화
      
      client.on('connect', () => {
        console.log('MQTT 서버에 연결됨');
        setMqttStatus('연결됨');
        
        // 연결 직후 API로 시스템 상태 조회만 실행
        refreshSystemState();
      });
      
      client.on('disconnect', () => {
        console.log('MQTT 서버 연결 끊김');
        setMqttStatus('연결 끊김');
      });
      
      client.on('error', (err) => {
        console.error('MQTT 오류:', err);
        setMqttStatus(`오류: ${err.message}`);
      });
      
      // 주요 상태 토픽 구독
      client.subscribe(VALVE_STATE_TOPIC);
      client.subscribe(PROCESS_PROGRESS_TOPIC);
      client.subscribe(ERROR_TOPIC);
      
      // 메시지 핸들러 등록
      client.on('message', (topic, message) => {
        const messageStr = message.toString();
        
        if (topic === VALVE_STATE_TOPIC) {
          // 밸브 상태 업데이트
          console.log('밸브 상태 메시지:', messageStr);
          setCurrentValveState(messageStr);
          
          // 탱크 시스템 데이터 업데이트
          setTankData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              valveState: messageStr
            };
          });
        } 
        else if (topic === PROCESS_PROGRESS_TOPIC) {
          // 진행 상태 업데이트
          try {
            const progressData = JSON.parse(messageStr);
            setProgressData(progressData);
            
            // 진행률이 포함된 경우
            if (progressData.percent) {
              const percentValue = parseInt(progressData.percent.replace('%', ''));
              setProgress(percentValue);
            }
            
            // 탱크 시스템 데이터 업데이트 - 진행 정보 포함
            setTankData(prev => {
              if (!prev) return prev;
              
              return {
                ...prev,
                progressInfo: {
                  step: progressData.step || '',
                  elapsedTime: progressData.elapsed_time || '00:00:00',
                  remainingTime: progressData.remaining_time || '00:00:00',
                  totalRemainingTime: progressData.total_remaining_time || '00:00:00'
                }
              };
            });
            
            // 메시지 기록
            addProgressMessage({
              timestamp: Date.now(),
              message: progressData.step || "진행 정보",
              rawJson: messageStr
            });
          } catch (error) {
            console.error('진행 메시지 파싱 오류:', error);
          }
        }
        
        // 오류 관련 메시지
        if (topic === ERROR_TOPIC) {
          console.error('MQTT 오류 메시지:', messageStr);
          
          // 메시지 기록 - 오류는 별도 표시
          addProgressMessage({
            timestamp: Date.now(),
            message: `오류: ${messageStr}`,
            rawJson: messageStr
          });
        }
        
        // 상태 메시지 관련해서는 특별한 처리가 필요하지 않음 - 자동으로 저장됨
      });
      
      // 탱크 레벨 및 펌프 상태 토픽 구독
      for (let i = 1; i <= 6; i++) {
        client.subscribe(getTankLevelTopic(i));
        client.subscribe(getPumpStateTopic(i));
        client.subscribe(`extwork/inverter${i}/overallstate`); // 인버터 전체 상태 토픽 구독 추가
        
        // 각 인버터에 대해 탱크 수위 토픽 명시적으로 구독 
        // 인버터마다 탱크가 있으므로 해당 탱크 수위 토픽 구독
        client.subscribe(`extwork/inverter${i}/tank${i}_level`);
      }
      
      // 서버 연결
      const serverUrl = process.env.NODE_ENV === 'development' 
        ? 'ws://dev.codingpen.com:1884'
        : 'wss://api.codingpen.com:8884';
      
      client.connect(serverUrl, 'dnature', 'XihQ2Q%RaS9u#Z3g');
      setMqttClient(client);
    }
  };
  
  // 토픽 직접 게시 함수 (STATUS 메시지 필터링)
  const publishToTopic = (topic: string, message: string) => {
    if (!mqttClient) {
      console.error('MQTT 클라이언트가 초기화되지 않았습니다.');
      return;
    }
    
    // STATUS 메시지는 더 이상 사용하지 않음
    if (message.trim() === 'STATUS') {
      console.log('STATUS 메시지는 사용되지 않습니다. API를 통해 상태를 조회합니다.');
      refreshSystemState();
      return;
    }
    
    // tank-system/request와 tank-system/status 토픽은 더 이상 사용하지 않음
    if (topic === 'tank-system/request' || topic === 'tank-system/status') {
      console.log(`토픽 ${topic}은(는) 더 이상 사용되지 않습니다. API를 통해 상태를 조회합니다.`);
      refreshSystemState();
      return;
    }
    
    // 일반 메시지 발행
    mqttClient.publish(topic, message);
  };
  
  // 밸브 명령 발행
  const handleValveCommand = (command: string) => {
    if (!mqttClient) return;
    
    // 'STATUS' 명령은 더 이상 사용하지 않음
    if (command.trim() === 'STATUS') {
      refreshSystemState();
      return;
    }
    
    mqttClient.publish(VALVE_INPUT_TOPIC, command);
  };

  // 시간 형식화 함수 추가
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 메시지 발행
  const publishMessage = (topic: string, message: string) => {
    if (!mqttClient) {
      console.log('MQTT 클라이언트가 연결되지 않아 메시지를 발행할 수 없습니다.');
      return;
    }
    
    // STATUS 메시지는 더 이상 보내지 않음
    if (message === "STATUS") {
      console.log("STATUS 메시지는 더 이상 전송되지 않습니다.");
      refreshSystemState();
      return;
    }
    
    mqttClient.publish(topic, message);
    console.log(`메시지 발행: ${topic} - ${message}`);
  };

  // 토픽 구독 함수
  const subscribeToTopic = () => {
    if (!searchTopic || !mqttClient) return
    
    mqttClient.subscribe(searchTopic)
    setSearchTopic("")
  }

  // 밸브 상태 파싱 함수
  const parseValveStateMessage = (message: string) => {
    console.log(`[디버깅] 밸브 상태 메시지 파싱 시작: ${message}`);
    
    // 밸브 상태 메시지 형식 확인 (valveA=OFF(전체순환_교환), valveB=ON(열림)...)
    if (message.includes('valveA=') && message.includes('valveB=')) {
      console.log(`[디버깅] 밸브 상태 메시지 형식 감지: ${message}`);
      
      // valveA 상태 추출 (ON/OFF)
      const valveAState = message.includes('valveA=ON') ? '1' : '0';
      const valveBState = message.includes('valveB=ON') ? '1' : '0';
      const valveCState = message.includes('valveC=ON') ? '1' : '0';
      const valveDState = message.includes('valveD=ON') ? '1' : '0';
      
      // 밸브 설명 추출 (괄호 안의 내용)
      let valveADesc = '';
      let valveBDesc = '';
      
      // valveA 설명 추출
      const valveADescMatch = message.match(/valveA=(?:ON|OFF)\(([^)]+)\)/);
      if (valveADescMatch && valveADescMatch[1]) {
        valveADesc = valveADescMatch[1];
      } else {
        // 기본 설명 설정
        valveADesc = valveAState === '1' ? '추출순환' : '전체순환';
      }
      
      // valveB 설명 추출
      const valveBDescMatch = message.match(/valveB=(?:ON|OFF)\(([^)]+)\)/);
      if (valveBDescMatch && valveBDescMatch[1]) {
        valveBDesc = valveBDescMatch[1];
      } else {
        // 기본 설명 설정
        valveBDesc = valveBState === '1' ? '열림' : '닫힘';
      }
      
      console.log(`[디버깅] 밸브 상태 및 설명 추출: A=${valveAState}(${valveADesc}), B=${valveBState}(${valveBDesc})`);
      
      // 4자리 밸브 상태 코드 생성
      const valveStateCode = `${valveAState}${valveBState}${valveCState}${valveDState}`;
      
      // 현재 활성화된 밸브 상태 저장 (버튼 스타일 변경에 사용)
      setCurrentValveState(valveStateCode);
      
      setTankData(prev => {
        const updatedState = {
          ...prev,
          valveState: valveStateCode,
          valveADesc,
          valveBDesc,
          valveStatusMessage: message
        };
        
        console.log('[디버깅] 업데이트될 탱크 데이터 상태', updatedState);
        
        // 업데이트된 상태 저장
        saveStateToServer(updatedState);
        
        return updatedState;
      });
      
      console.log('[디버깅] 상태 업데이트 함수 호출 완료');
      
      return {
        valveState: valveStateCode,
        valveAState,
        valveBState, 
        valveCState,
        valveDState,
        valveADesc,
        valveBDesc
      };
    }
    
    // 0100 형식의 메시지 처리 (밸브 상태 코드)
    if (message.match(/^[0-1]{4}$/)) {
      // 4자리 0과 1 코드인 경우
      console.log(`[디버깅] 밸브 상태 코드 감지: ${message}`);
      
      // 각 밸브 상태 추출
      const valveAState = message[0];
      const valveBState = message[1];
      const valveCState = message[2];
      const valveDState = message[3];
      
      console.log(`[디버깅] 밸브 상태 추출: A=${valveAState}, B=${valveBState}, C=${valveCState}, D=${valveDState}`);
      
      // 밸브 설명 설정 - 앞 두 자리에 따라 설명 결정
      let valveADesc = '';
      let valveBDesc = '';
      
      // 4가지 가능한 상태에 따른 설명 설정
      if (message.startsWith('00')) {
        // 0000: 본탱크 수집
        valveADesc = '본탱크 수집';
        valveBDesc = '닫힘';
        console.log('[디버깅] 밸브 상태: 본탱크 수집, 밸브B 닫힘');
      } else if (message.startsWith('10')) {
        // 1000: 추출순환
        valveADesc = '추출순환';
        valveBDesc = '닫힘';
        console.log('[디버깅] 밸브 상태: 추출순환, 밸브B 닫힘');
      } else if (message.startsWith('01')) {
        // 0100: 전체 순환
        valveADesc = '전체 순환';
        valveBDesc = '열림';
        console.log('[디버깅] 밸브 상태: 전체 순환, 밸브B 열림');
      } else if (message.startsWith('11')) {
        // 1100: 추출개방
        valveADesc = '추출개방';
        valveBDesc = '열림';
        console.log('[디버깅] 밸브 상태: 추출개방, 밸브B 열림');
      }
      
      console.log(`[디버깅] 밸브 상태 파싱 결과: A=${valveAState}(${valveADesc}), B=${valveBState}(${valveBDesc}), C=${valveCState}, D=${valveDState}`);
      
      // 현재 활성화된 밸브 상태 저장 (버튼 스타일 변경에 사용)
      setCurrentValveState(message);
      
      // 탱크 데이터 상태 업데이트 전 로그
      console.log('[디버깅] 탱크 데이터 상태 업데이트 전');
      
      setTankData(prev => {
        const updatedState = {
          ...prev,
          valveState: message,
          valveADesc,
          valveBDesc,
          valveStatusMessage: `valveA=${valveAState === '1' ? 'ON' : 'OFF'}, valveB=${valveBState === '1' ? 'ON' : 'OFF'}, valveC=${valveCState === '1' ? 'ON' : 'OFF'}, valveD=${valveDState === '1' ? 'ON' : 'OFF'}`
        };
        
        console.log('[디버깅] 업데이트될 탱크 데이터 상태', updatedState);
        
        // 업데이트된 상태 저장
        saveStateToServer(updatedState);
        
        return updatedState;
      });
      
      console.log('[디버깅] 상태 업데이트 함수 호출 완료');
      
      // 밸브 상태 정보 반환
      return {
        valveState: message,
        valveAState,
        valveBState, 
        valveCState,
        valveDState,
        valveADesc,
        valveBDesc
      };
    }
    
    // 코드 형식이 아닌 경우 기본 값 반환
    console.log('[디버깅] 밸브 상태 메시지가 코드 형식이 아님, 기본값 반환');
    return { valveState: message };
  }

  // K 버튼 활성화 상태 관리

  // MQTT 메시지 구독 설정
  useEffect(() => {
    if (mqttClient) {
      // K 버튼 활성화 상태 구독
      mqttClient.subscribe("extwork/inverter1/overallstate");
      
      // 각 펌프 상태 메시지 구독
      for (let i = 1; i <= 6; i++) {
        mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
      }
      
      // 큐 상태 구독 추가
      mqttClient.subscribe("extwork/extraction/queue/status");
      
      // 메시지 수신 처리
      mqttClient.on("message", (topic, message) => {
        const messageStr = message.toString();
        
        // K 버튼 활성화 상태 처리
        if (topic === "extwork/inverter1/overallstate") {
          if (messageStr.includes("K 명령 수신: 수위 센서 신호 대기 모드 비활성화")) {
            setKButtonActive(false);
          } else if (messageStr.includes("K 명령 수신: 수위 센서 신호 대기 모드 활성화")) {
            setKButtonActive(true);
          }
        }
        
        // 각 펌프 상태 메시지 처리
        const pumpMatch = topic.match(/extwork\/inverter(\d+)\/overallstate/);
        if (pumpMatch && pumpMatch[1]) {
          const pumpId = parseInt(pumpMatch[1]);
          setPumpMessages(prev => ({
            ...prev,
            [pumpId]: messageStr
          }));
        }
        
        // 큐 상태 처리
        if (topic === "extwork/extraction/queue/status") {
          try {
            const queueStatus = JSON.parse(messageStr);
            setQueueStatus(queueStatus);
          } catch (error) {
            console.error('큐 상태 파싱 오류:', error);
          }
        }
      });
    }
    
    return () => {
      if (mqttClient) {
        mqttClient.unsubscribe("extwork/extraction/queue/status");
        mqttClient.unsubscribe("extwork/inverter1/overallstate");
        for (let i = 1; i <= 6; i++) {
          mqttClient.unsubscribe(`extwork/inverter${i}/overallstate`);
        }
      }
    };
  }, [mqttClient]);

  // 저장된 시퀀스 상태 추가
  const [savedSequences, setSavedSequences] = useState<PumpSequence[]>([]);
  
  // 시퀀스 상태 수정 - 인터페이스 사용
  const [sequences, setSequences] = useState<PumpSequence[]>([]);

  // 시퀀스 이름 상태 추가
  const [currentSequenceName, setCurrentSequenceName] = useState<string>("");
  
  // 진행 정보 상태 추가
  const [progressInfo, setProgressInfo] = useState<{
    step: string;
    elapsedTime: string;
    remainingTime: string;
    totalRemainingTime: string;
  }>({
    step: "S(0/0)",
    elapsedTime: "00:00",
    remainingTime: "00:00",
    totalRemainingTime: "00:00"
  });

  // 프로세스 기본값 생성 함수 수정
  const getDefaultProcess = (mode: number) => {
    const firstDigit = Math.floor(mode / 10);
    switch (firstDigit) {
      case 1: // 동시 모드: 6개 펌프 가동시간
        return { process: Array(6).fill(0), wait_time: 5 };
      case 2: // 순차 모드: 18개 토큰 (펌프별 가동시간,대기시간,반복횟수)
        // 순차 모드에서는 각 펌프마다 3개의 토큰이 필요하므로 wait_time 필드 제거
        return { process: Array(18).fill(0) };
      case 3: // 중첩 모드: 12개 토큰 (펌프별 가동시간,대기시간)
        // 중첩 모드에서는 각 펌프마다 2개의 토큰이 필요하므로 wait_time 필드 제거
        return { process: Array(12).fill(0) };
      default:
        return { process: Array(18).fill(0) };
    }
  };

  // 현재 시퀀스를 저장
  const saveCurrentSequence = () => {
    if (!currentSequenceName || sequences.length === 0) {
      alert('시퀀스 이름을 입력하고 최소 하나 이상의 시퀀스를 추가해주세요.');
      return;
    }
    
    try {
      // 시퀀스 이름에서 잘못된 문자 제거 (선택적)
      const safeName = currentSequenceName.trim();
      
      // 빈 이름 체크
      if (!safeName) {
        alert('시퀀스 이름은 공백일 수 없습니다.');
        return;
      }
      
      // 현재 시퀀스에 이름 부여
      const namedSequences = sequences.map(seq => ({
        ...seq,
        name: safeName
      }));
      
      // 저장된 시퀀스 목록에 추가
      const updatedSavedSequences = [...savedSequences, ...namedSequences];
      setSavedSequences(updatedSavedSequences);
      
      try {
        // 로컬 스토리지에 저장
        const localSaved = saveSequencesToLocalStorage(updatedSavedSequences);
        if (!localSaved) {
          console.warn('로컬 스토리지에 시퀀스 저장 실패');
        }
        
        // 서버에 저장 시도 (비동기)
        saveSequencesToServer(updatedSavedSequences)
          .then(saved => {
            if (saved === false) {
              console.warn('서버에 시퀀스 저장 실패 - 로컬 스토리지만 사용됨');
            }
          })
          .catch(error => {
            console.error('서버 저장 중 오류:', error);
          });
        
        alert(`'${safeName}' 시퀀스가 저장되었습니다.`);
      } catch (storageError) {
        console.error('시퀀스 저장 중 오류:', storageError);
        alert(`시퀀스 저장 중 오류가 발생했습니다. 다시 시도해주세요.`);
      }
    } catch (error) {
      console.error('시퀀스 저장 처리 중 예상치 못한 오류:', error);
      alert('시퀀스를 저장하는 중 오류가 발생했습니다.');
    }
  };
  
  // 저장된 시퀀스 불러오기
  const loadSavedSequence = (sequenceName: string) => {
    const filteredSequences = savedSequences.filter(seq => seq.name === sequenceName);
    if (filteredSequences.length > 0) {
      setSequences(filteredSequences);
      setCurrentSequenceName(sequenceName);
    }
  };
  
  // 저장된 시퀀스 삭제
  const deleteSavedSequence = (sequenceName: string) => {
    if (confirm(`'${sequenceName}' 시퀀스를 삭제하시겠습니까?`)) {
      const filteredSequences = savedSequences.filter(seq => seq.name !== sequenceName);
      setSavedSequences(filteredSequences);
      
      // 로컬 스토리지와 서버에 저장
      saveSequencesToLocalStorage(filteredSequences);
      saveSequencesToServer(filteredSequences);
      
      alert(`'${sequenceName}' 시퀀스가 삭제되었습니다.`);
    }
  };
  
  // 저장된 시퀀스 실행
  const runSavedSequence = (sequenceName: string) => {
    const filteredSequences = savedSequences.filter(seq => seq.name === sequenceName);
    if (filteredSequences.length > 0 && mqttClient) {
      // 시퀀스 표준화 적용
      const standardizedSequences = standardizeSequenceJson(filteredSequences);
      
      const sequence = { sequences: standardizedSequences };
      const topic = "extwork/extraction/input";
      const message = JSON.stringify(sequence);
      mqttClient.publish(topic, message);
      
      // 실행 로그 남기기
      setProgressMessages(prev => [{
        timestamp: Date.now(),
        message: `시퀀스 '${sequenceName}' 실행`,
        rawJson: message
      }, ...prev]);
      
      // 작업 로그 생성 및 저장
      const firstSequence = standardizedSequences[0];
      
      // 작업 세부 내용 생성
      const processDetails = standardizedSequences.map((seq, index) => {
        // 원본 시퀀스에서 selectedPumps 정보 가져오기
        const originalSeq = savedSequences.find(s => 
          s.name === sequenceName && 
          s.operation_mode === filteredSequences[index].operation_mode
        );
        
        const pumpInfo = originalSeq && originalSeq.selectedPumps
          ? originalSeq.selectedPumps
              .map((selected, idx) => selected ? idx + 1 : null)
              .filter(idx => idx !== null)
              .join(', ')
          : '없음';
          
        return `시퀀스 ${index + 1}: 모드 ${seq.operation_mode}, 반복 ${seq.repeats}회, 펌프 ${pumpInfo}`;
      });
      
      // 원본 시퀀스에서 selectedPumps 정보 가져오기
      const originalFirstSeq = savedSequences.find(s => 
        s.name === sequenceName && 
        s.operation_mode === filteredSequences[0].operation_mode
      );
      
      const workLog = workLogService.createWorkLog(
        sequenceName,
        firstSequence.operation_mode,
        firstSequence.repeats,
        originalFirstSeq ? originalFirstSeq.selectedPumps : undefined
      );
      
      // 작업 세부 내용 추가
      workLog.tags = processDetails;
      
      // 로그 저장
      workLogService.saveWorkLog(workLog);
    }
  };
  
  // 시퀀스 이름 목록 가져오기
  const getUniqueSequenceNames = (): string[] => {
    const names = new Set(savedSequences.map(seq => seq.name));
    return Array.from(names);
  };

  // 시퀀스 저장 및 불러오기 기능 초기화
  useEffect(() => {
    // 로컬 스토리지에서 저장된 시퀀스 불러오기
    const localSequences = loadSequencesFromLocalStorage();
    if (localSequences.length > 0) {
      setSavedSequences(localSequences);
      console.log('로컬 스토리지에서 시퀀스 로드 성공:', localSequences.length, '개');
    }
  }, []);

  // 시퀀스 추가 함수 수정 - 이름 포함
  const addSequence = useCallback(() => {
    const defaultMode = 21; // 기본 모드: 순차 모드 + 추출 순환
    const newSequence: PumpSequenceType = {
      name: currentSequenceName,
      operation_mode: defaultMode,
      repeats: 1,
      process: getDefaultProcess(defaultMode).process,
      selectedPumps: Array(6).fill(false)
    };
    
    // 동시 모드인 경우 wait_time 추가
    if (Math.floor(defaultMode / 10) === 1) {
      newSequence.wait_time = 5; // 기본 대기 시간 5초
    }
    
    setSequences(prev => [...prev, newSequence]);
  }, [currentSequenceName]); // 의존성 명시적 선언

  // 시퀀스 삭제 함수
  const removeSequence = (seqIndex: number) => {
    setSequences(prev => prev.filter((_, i) => i !== seqIndex));
  };
  
  // 시퀀스 업데이트
  const updateSequence = useCallback((index: number, field: string, value: any) => {
    setSequences(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);
  
  // 프로세스 업데이트
  const updateProcess = useCallback((sequenceIndex: number, processIndex: number, value: number) => {
    setSequences(prev => {
      const updated = [...prev];
      const process = [...updated[sequenceIndex].process];
      process[processIndex] = value;
      updated[sequenceIndex] = { ...updated[sequenceIndex], process };
      return updated;
    });
  }, []);

  // 시퀀스 모드 변경 시 프로세스 배열 업데이트
  const handleModeChange = useCallback((seqIndex: number, newMode: number) => {
    // 모드가 변경되면 기본 프로세스로 초기화
    const defaultProcess = getDefaultProcess(newMode);
    
    setSequences(prev => {
      const updated = [...prev];
      updated[seqIndex] = {
        ...updated[seqIndex],
        operation_mode: newMode,
        process: defaultProcess.process,
        selectedPumps: Array(6).fill(false)
      };
      
      // 동시 모드인 경우 wait_time 추가
      if (Math.floor(newMode / 10) === 1) {
        updated[seqIndex].wait_time = 5; // 기본 대기 시간 5초
      } else {
        // 다른 모드에서는 wait_time 제거
        delete updated[seqIndex].wait_time;
      }
      
      return updated;
    });
  }, []);

  // JSON 미리보기 업데이트 함수
  useEffect(() => {
    try {
      const preview = {
        sequences: sequences.map(sequence => {
          const { operation_mode, repeats, process, selectedPumps } = sequence;
          const firstDigit = Math.floor(operation_mode / 10);
          
          let result: any = {
            operation_mode,
            repeats
          };

          // 동시 모드에만 wait_time 추가
          if (firstDigit === 1) {
            result.wait_time = sequence.wait_time || 5;
          }
          
          let finalProcess: number[] = [];
          switch (firstDigit) {
            case 1: // 동시 모드
              finalProcess = selectedPumps.map((selected, index) => selected ? process[index] : 0); // 개별 가동시간만
              break;
            
            case 2: // 순차 모드
              finalProcess = selectedPumps.reduce((acc, selected, index) => {
                if (selected) {
                  acc.push(
                    process[index * 3], // 가동시간
                    process[index * 3 + 1], // 대기시간
                    process[index * 3 + 2] // 반복횟수
                  );
                } else {
                  acc.push(0, 0, 0);
                }
                return acc;
              }, [] as number[]);
              break;
            
            case 3: // 중첩 모드
              finalProcess = selectedPumps.reduce((acc, selected, index) => {
                if (selected) {
                  acc.push(
                    process[index * 2], // 가동시간
                    process[index * 2 + 1] // 대기시간
                  );
                } else {
                  acc.push(0, 0);
                }
                return acc;
              }, [] as number[]);
              break;
          }

          result.process = finalProcess;
          return result;
        })
      };

      // JSON 문자열로 변환하기 전에 프로세스 배열을 펌프별로 포맷팅
      const formattedJson = JSON.stringify(preview, null, 2)
        .replace(/"process": \[([\d,\s]+)\]/g, (match, processStr) => {
          const numbers = processStr.split(',').map(n => n.trim());
          const firstDigit = preview.sequences[0]?.operation_mode.toString()[0] || '1';
          const tokensPerPump = firstDigit === '1' ? 1 : firstDigit === '2' ? 3 : 2;
          
          let formattedProcess = '"process": [\n';
          for (let i = 0; i < numbers.length; i += tokensPerPump) {
            const pumpTokens = numbers.slice(i, i + tokensPerPump);
            formattedProcess += `        ${pumpTokens.join(', ')}${i + tokensPerPump < numbers.length ? ',' : ''} // 펌프 ${Math.floor(i/tokensPerPump) + 1}\n`;
          }
          formattedProcess += '      ]';
          return formattedProcess;
        });

      setPreviewJson(formattedJson);
    } catch (error) {
      console.error('JSON 미리보기 생성 오류:', error);
      setPreviewJson("시퀀스가 없거나 형식이 올바르지 않습니다.");
    }
  }, [sequences]);

  // 프로세스 설정 컴포넌트
  const ProcessSettings = ({ sequence, seqIndex }: { sequence: any, seqIndex: number }) => {
    const mode = Math.floor(sequence.operation_mode / 10);
    
    // 빠른 시간 선택 버튼 값들 수정 - 최근 사용 내용 기반으로 두 개만 남김
    const [recentTimeOptions, setRecentTimeOptions] = useState<number[]>([60, 300]); // 기본값: 1분, 5분
    
    // 최근 사용 시간 업데이트 함수
    const updateRecentTimeOptions = useCallback((newTime: number) => {
      setRecentTimeOptions(prev => {
        // 이미 있는 경우 제외
        if (prev.includes(newTime)) return prev;
        // 최근 사용 시간 2개만 유지
        return [newTime, prev[0]];
      });
    }, []);
    
    // 펌프 선택 토글 함수
    const togglePump = useCallback((pumpIndex: number, checked: boolean) => {
      // 펌프 선택 상태 업데이트
      const newSelectedPumps = [...sequence.selectedPumps];
      newSelectedPumps[pumpIndex] = checked;
      
      // 시퀀스 업데이트
      const newSequences = [...sequences];
      newSequences[seqIndex] = {
        ...newSequences[seqIndex],
        selectedPumps: newSelectedPumps
      };
      
      setSequences(newSequences);
      saveSequencesToServer(newSequences);
    }, [seqIndex, sequence.selectedPumps, sequences]);
    
    // 프로세스 시간 업데이트 함수
    const handleProcessTimeChange = useCallback((pumpIndex: number, value: number) => {
      // 콘솔에 로그 추가 - 디버깅 목적
      console.log(`시간 변경: 시퀀스 ${seqIndex}, 펌프 ${pumpIndex}, 값: ${value}`);
      
      // 우선 로컬 상태 업데이트를 동기적으로 처리
      updateProcess(seqIndex, pumpIndex, value);
      updateRecentTimeOptions(value);
      
      // 서버 저장은 지연 처리 - 실패해도 UI에 영향 없도록
      const timer = setTimeout(() => {
        try {
          console.log(`저장 시작: 시퀀스 ${seqIndex}, 펌프 ${pumpIndex}`);
      const newSequences = [...sequences];
          // 실패해도 UI가 영향받지 않음
          saveSequencesToServer(newSequences).catch(err => {
            console.error('서버 저장 실패 (무시됨):', err);
          });
          console.log(`저장 요청 완료: 시퀀스 ${seqIndex}, 펌프 ${pumpIndex}`);
        } catch (error) {
          console.error('서버 저장 중 오류 (무시됨):', error);
        }
      }, 3000); // 저장 지연 시간 3초
      
      // 컴포넌트 언마운트 시 타이머 정리
      return () => clearTimeout(timer);
    }, [seqIndex, updateProcess, updateRecentTimeOptions, sequences]);
    
    // 공통 대기 시간 업데이트 함수
    const handleWaitTimeChange = useCallback((value: number) => {
      // 우선 로컬 상태 업데이트를 동기적으로 처리
      updateSequence(seqIndex, 'wait_time', value);
      updateRecentTimeOptions(value);
      
      // 서버 저장은 지연 처리 - 실패해도 UI에 영향 없도록
      const timer = setTimeout(() => {
        try {
          console.log(`대기시간 저장 시작: 시퀀스 ${seqIndex}, 값: ${value}`);
      const newSequences = [...sequences];
          // 실패해도 UI가 영향받지 않음
          saveSequencesToServer(newSequences).catch(err => {
            console.error('서버 저장 실패 (무시됨):', err);
          });
          console.log(`대기시간 저장 요청 완료: 시퀀스 ${seqIndex}, 값: ${value}`);
        } catch (error) {
          console.error('서버 저장 중 오류 (무시됨):', error);
        }
      }, 3000); // 저장 지연 시간 3초
      
      // 컴포넌트 언마운트 시 타이머 정리
      return () => clearTimeout(timer);
    }, [seqIndex, updateSequence, updateRecentTimeOptions, sequences]);
    
    // 반복 횟수 변경 함수 (드롭다운 방식)
    const [isRepeatDropdownOpen, setIsRepeatDropdownOpen] = useState(false);
    const repeatDropdownRef = useRef(null);
    
    // 반복 횟수 드롭다운 외부 클릭 감지
    useEffect(() => {
      const handleClickOutside = (event) => {
        if (repeatDropdownRef.current && !repeatDropdownRef.current.contains(event.target)) {
          setIsRepeatDropdownOpen(false);
        }
      };
      
      if (isRepeatDropdownOpen) {
        document.addEventListener('mousedown', handleClickOutside);
      } else {
        document.removeEventListener('mousedown', handleClickOutside);
      }
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [isRepeatDropdownOpen]);
    
    // 반복 횟수 변경 처리
    const handleRepeatCountChange = (count: number) => {
      updateSequence(seqIndex, 'repeats', count);
      
      // 서버에 저장
      const newSequences = [...sequences];
      saveSequencesToServer(newSequences);
      
      // 드롭다운 닫기
      setIsRepeatDropdownOpen(false);
    };
    
    // 빠른 반복 횟수 설정 처리 함수
    const handleQuickRepeatSet = (count: number) => {
      updateSequence(seqIndex, 'repeats', count);
      
      // 서버에 저장
      const newSequences = [...sequences];
      saveSequencesToServer(newSequences);
    };

    // 반복 횟수 직접 입력 처리
    const handleRepeatInputChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const count = parseInt(e.target.value, 10);
      if (!isNaN(count) && count >= 0 && count <= 30) {
        updateSequence(seqIndex, 'repeats', count);
        
        // 서버에 저장
        const newSequences = [...sequences];
        saveSequencesToServer(newSequences);
      }
    };
    
    // 개별 반복 횟수 드롭다운 관리 (순차 모드에서만 사용)
    const [individualRepeatDropdowns, setIndividualRepeatDropdowns] = useState<Record<number, boolean>>({});
    const individualRepeatRefs = useRef<Record<number, any>>({});
    
    // 개별 반복 횟수 드롭다운 외부 클릭 감지 - 완전히 새로운 방식으로 구현
    useEffect(() => {
      // 모달 형태로 동작하도록 이벤트 캡처 단계에서 처리
      const handleGlobalClick = (event) => {
        // 열려있는 드롭다운이 있는 경우에만 처리
        const hasOpenDropdown = Object.values(individualRepeatDropdowns).some(isOpen => isOpen);
        if (!hasOpenDropdown) return;
        
        // 각 드롭다운에 대해 확인
        let clickedInsideDropdown = false;
        
        Object.entries(individualRepeatRefs.current).forEach(([pumpIndex, ref]) => {
          // ref가 존재하고 클릭된 요소가 ref 내부에 있는지 확인
          if (ref && ref.contains(event.target)) {
            clickedInsideDropdown = true;
            // 드롭다운 내부 클릭은 처리하지 않음 (각 항목의 onClick에서 처리)
          }
        });
        
        // 드롭다운 외부 클릭인 경우 모든 드롭다운 닫기
        if (!clickedInsideDropdown) {
          setIndividualRepeatDropdowns({});
          event.stopPropagation();
        }
      };
      
      // 캡처 단계에서 이벤트 리스너 등록 (이벤트 버블링보다 먼저 실행)
      document.addEventListener('click', handleGlobalClick, true);
      
      return () => {
        document.removeEventListener('click', handleGlobalClick, true);
      };
    }, [individualRepeatDropdowns]);
    
    // 드롭다운 토글 함수 - 이벤트 전파를 완전히 차단
    const toggleIndividualRepeatDropdown = (pumpIndex: number, e: React.MouseEvent) => {
      // 이벤트 전파 중단 (캡처링과 버블링 모두 차단)
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      
      // 다른 모든 드롭다운은 닫고 현재 드롭다운만 토글
      setIndividualRepeatDropdowns(prev => {
        const newState = {};
        // 현재 드롭다운의 상태만 토글
        newState[pumpIndex] = !prev[pumpIndex];
        return newState;
      });
    };
    
    // 개별 반복 횟수 변경 함수 - 이벤트 전파를 완전히 차단
    const handleIndividualRepeatChange = (pumpIndex: number, count: number, e: React.MouseEvent) => {
      // 이벤트 전파 중단 (캡처링과 버블링 모두 차단)
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      
      const newSequences = [...sequences];
      
      // individualRepeats 객체 업데이트
      if (!newSequences[seqIndex].individualRepeats) {
        newSequences[seqIndex].individualRepeats = {};
      }
      newSequences[seqIndex].individualRepeats[pumpIndex] = count;
      
      // process 배열의 세 번째 토큰 업데이트 (순차 모드에서 사용)
      if (mode === 2) {
        const processIndex = pumpIndex * 3 + 2; // 세 번째 토큰 (반복횟수)
        const process = [...newSequences[seqIndex].process];
        process[processIndex] = count;
        newSequences[seqIndex].process = process;
      }
      
      setSequences(newSequences);
      saveSequencesToServer(newSequences);
      
      // 값을 선택한 후에도 드롭다운 유지 (명시적으로 닫지 않음)
    };
    
    // 개별 반복 횟수 직접 입력 처리
    const handleIndividualRepeatInputChange = (pumpIndex: number, e: React.ChangeEvent<HTMLSelectElement>) => {
      const count = parseInt(e.target.value, 10);
      if (!isNaN(count) && count >= 0 && count <= 30) {
        const newSequences = [...sequences];
        
        // individualRepeats 객체 업데이트
        if (!newSequences[seqIndex].individualRepeats) {
          newSequences[seqIndex].individualRepeats = {};
        }
        newSequences[seqIndex].individualRepeats[pumpIndex] = count;
        
        // process 배열의 세 번째 토큰 업데이트 (순차 모드에서 사용)
        if (mode === 2) {
          const processIndex = pumpIndex * 3 + 2; // 세 번째 토큰 (반복횟수)
          const process = [...newSequences[seqIndex].process];
          process[processIndex] = count;
          newSequences[seqIndex].process = process;
        }
        
        setSequences(newSequences);
        saveSequencesToServer(newSequences);
      }
    };
    
    // 빠른 개별 반복 횟수 설정
    const handleQuickIndividualRepeatSet = (pumpIndex: number, count: number) => {
      const newSequences = [...sequences];
      
      // individualRepeats 객체 업데이트
      if (!newSequences[seqIndex].individualRepeats) {
        newSequences[seqIndex].individualRepeats = {};
      }
      newSequences[seqIndex].individualRepeats[pumpIndex] = count;
      
      // process 배열의 세 번째 토큰 업데이트 (순차 모드에서 사용)
      if (mode === 2) {
        const processIndex = pumpIndex * 3 + 2; // 세 번째 토큰 (반복횟수)
        const process = [...newSequences[seqIndex].process];
        process[processIndex] = count;
        newSequences[seqIndex].process = process;
      }
      
      setSequences(newSequences);
      saveSequencesToServer(newSequences);
    };
    
    // 개별 반복 횟수 드롭다운 닫기
    const closeIndividualRepeatDropdown = (pumpIndex: number, e: React.MouseEvent) => {
      e.stopPropagation(); // 이벤트 전파 중단
      setIndividualRepeatDropdowns(prev => ({
        ...prev,
        [pumpIndex]: false
      }));
    };

    // 공통 대기시간 컴포넌트
    const CommonWaitTime = () => (
      <div className="space-y-2 border-t pt-4 mt-4">
        <label className="block text-sm font-medium">공통 대기시간</label>
        <TimePickerDial 
          value={sequence.wait_time || 0}
          onChange={(value) => handleWaitTimeChange(value)}
          max={600}
            step={5}
          onConfirm={(h, m, s) => {
            // 시간을 초로 변환하여 handleWaitTimeChange 호출
            const totalSeconds = h * 3600 + m * 60 + s;
            handleWaitTimeChange(totalSeconds);
          }}
        />
      </div>
    );

    // 반복 횟수 설정 컴포넌트
    const RepeatCountSetting = () => (
      <div className="space-y-2 border-t pt-4 mt-4">
        <label className="block text-sm font-medium">반복 횟수</label>
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <select
              id={`repeat-count-select-${seqIndex}`}
              value={sequence.repeats || 1}
              onChange={handleRepeatInputChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            >
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i} value={i}>{i}회</option>
              ))}
            </select>
            <div className="w-full p-2 border rounded flex justify-between items-center bg-white">
              <span>{sequence.repeats || 1}회</span>
              <span>▼</span>
            </div>
          </div>
        </div>
        <div className="flex justify-between items-center mt-2">
          <button
            type="button"
            className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 transition"
            onClick={() => handleQuickRepeatSet(1)}
          >
            1회
          </button>
          <button
            type="button"
            className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 transition"
            onClick={() => handleQuickRepeatSet(5)}
          >
            5회
          </button>
          <button
            type="button"
            className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 transition"
            onClick={() => handleQuickRepeatSet(10)}
          >
            10회
          </button>
        </div>
      </div>
    );

    switch (mode) {
      case 1: // 동시 모드
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-6 gap-4 mb-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={`pump-${i}`} className="flex flex-col items-center">
                  <label className="text-sm mb-2">펌프 {i + 1}</label>
                  <Switch
                    checked={sequence.selectedPumps[i]}
                    onCheckedChange={(checked) => togglePump(i, checked)}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {sequence.selectedPumps.map((isSelected, pumpIndex) => {
                if (!isSelected) return null;
                
                return (
                  <div key={`process-${pumpIndex}`} className="border p-4 rounded-md">
                    <div className="text-sm font-medium mb-4">펌프 {pumpIndex + 1}</div>
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs">가동시간</label>
                        <TimePickerDial 
                            value={sequence.process[pumpIndex] || 0}
                          onChange={(value) => handleProcessTimeChange(pumpIndex, value)}
                            onConfirm={(h, m, s) => {
                              // 시간을 초로 변환하여 handleProcessTimeChange 호출
                              const totalSeconds = h * 3600 + m * 60 + s;
                              handleProcessTimeChange(pumpIndex, totalSeconds);
                            }}
                        />
                          </div>
                        </div>
                      </div>
                );
              })}
                    </div>
            <CommonWaitTime />
            <RepeatCountSetting />
          </div>
        );

      case 2: // 순차 모드
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-6 gap-4 mb-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={`pump-${i}`} className="flex flex-col items-center">
                  <label className="text-sm mb-2">펌프 {i + 1}</label>
                  <Switch
                    checked={sequence.selectedPumps[i]}
                    onCheckedChange={(checked) => togglePump(i, checked)}
                  />
                </div>
              ))}
            </div>
            
            <div className="space-y-4">
              {sequence.selectedPumps.filter(Boolean).length > 0 ? (
                <div className="border p-4 rounded-md">
                  <div className="text-sm font-medium mb-4">선택된 펌프 프로세스 시간</div>
                  <div className="space-y-4">
                    {sequence.selectedPumps.map((isSelected, pumpIndex) => {
                      if (!isSelected) return null;
                      
                      // 순차 모드에서 각 펌프의 프로세스 인덱스 계산
                      const pumpTimeIndex = pumpIndex * 3; // 가동시간 인덱스
                      const waitTimeIndex = pumpIndex * 3 + 1; // 대기시간 인덱스
                      
                      return (
                        <div key={`process-${pumpIndex}`} className="mb-4">
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-sm">펌프 {pumpIndex + 1}</label>
                            <div className="text-sm text-gray-500">
                              {formatTime(sequence.process[pumpTimeIndex] || 0)}
                            </div>
                          </div>
                          <TimePickerDial 
                            value={sequence.process[pumpTimeIndex] || 0}
                            onChange={(value) => handleProcessTimeChange(pumpTimeIndex, value)}
                            onConfirm={(h, m, s) => {
                              // 시간을 초로 변환하여 handleProcessTimeChange 호출
                              const totalSeconds = h * 3600 + m * 60 + s;
                              handleProcessTimeChange(pumpTimeIndex, totalSeconds);
                            }}
                          />
                          
                          {/* 대기시간 설정 추가 */}
                          <div className="mt-4">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm">대기시간</label>
                              <div className="text-sm text-gray-500">
                                {formatTime(sequence.process[waitTimeIndex] || 0)}
                              </div>
                            </div>
                            <TimePickerDial 
                              value={sequence.process[waitTimeIndex] || 0}
                              onChange={(value) => handleProcessTimeChange(waitTimeIndex, value)}
                              onConfirm={(h, m, s) => {
                                // 시간을 초로 변환하여 handleProcessTimeChange 호출
                                const totalSeconds = h * 3600 + m * 60 + s;
                                handleProcessTimeChange(waitTimeIndex, totalSeconds);
                              }}
                            />
                          </div>
                          
                          {/* 개별 반복 횟수 설정 - 직접 선택 방식으로 변경 */}
                          {mode === 2 && (
                            <div className="mt-4">
                              <div className="flex justify-between items-center mb-2">
                                <label className="text-sm">반복 횟수</label>
                                <div className="text-sm text-gray-500">
                                  {sequence.individualRepeats?.[pumpIndex] ?? 0}회
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="relative w-1/3">
                                  <select
                                    id={`individual-repeat-select-${pumpIndex}`}
                                    value={sequence.individualRepeats?.[pumpIndex] ?? 0}
                                    onChange={(e) => handleIndividualRepeatInputChange(pumpIndex, e)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                  >
                                    {Array.from({ length: 31 }, (_, i) => (
                                      <option key={i} value={i}>{i}회</option>
                                    ))}
                                  </select>
                                  <div className="w-full p-2 border rounded flex justify-between items-center bg-white">
                                    <span>{sequence.individualRepeats?.[pumpIndex] ?? 0}회</span>
                                    <span>▼</span>
                                  </div>
                                </div>
                                <div className="flex flex-grow justify-end items-center gap-1">
                                  <button
                                    type="button"
                                    className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300 transition"
                                    onClick={() => handleQuickIndividualRepeatSet(pumpIndex, sequence.individualRepeats?.[pumpIndex] ? (sequence.individualRepeats[pumpIndex] + 1) : 1)}
                                  >
                                    +1회
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300 transition"
                                    onClick={() => handleQuickIndividualRepeatSet(pumpIndex, sequence.individualRepeats?.[pumpIndex] ? (sequence.individualRepeats[pumpIndex] + 5) : 5)}
                                  >
                                    +5회
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300 transition"
                                    onClick={() => handleQuickIndividualRepeatSet(pumpIndex, sequence.individualRepeats?.[pumpIndex] ? (sequence.individualRepeats[pumpIndex] + 10) : 10)}
                                  >
                                    +10회
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 p-4 border rounded-md">
                  펌프를 선택하세요
                </div>
              )}
            </div>
            {/* 순차 모드에서도 공통 반복 횟수 설정 추가 */}
            <RepeatCountSetting />
          </div>
        );

      case 3: // 중첩 모드
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-6 gap-4 mb-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={`pump-${i}`} className="flex flex-col items-center">
                  <label className="text-sm mb-2">펌프 {i + 1}</label>
                  <Switch
                    checked={sequence.selectedPumps[i]}
                    onCheckedChange={(checked) => togglePump(i, checked)}
                  />
                </div>
              ))}
            </div>
            
            <div className="space-y-4">
              {sequence.selectedPumps.filter(Boolean).length > 0 ? (
                <div className="border p-4 rounded-md">
                  <div className="text-sm font-medium mb-4">선택된 펌프 프로세스 시간</div>
                  <div className="space-y-4">
                    {sequence.selectedPumps.map((isSelected, pumpIndex) => {
                      if (!isSelected) return null;
                      
                      // 중첩 모드에서 각 펌프의 프로세스 인덱스 계산
                      const pumpTimeIndex = pumpIndex * 2; // 가동시간 인덱스
                      const waitTimeIndex = pumpIndex * 2 + 1; // 대기시간 인덱스
                      
                      return (
                        <div key={`process-${pumpIndex}`} className="mb-4">
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-sm">펌프 {pumpIndex + 1}</label>
                            <div className="text-sm text-gray-500">
                              {formatTime(sequence.process[pumpTimeIndex] || 0)}
                            </div>
                          </div>
                          <TimePickerDial 
                            value={sequence.process[pumpTimeIndex] || 0}
                            onChange={(value) => handleProcessTimeChange(pumpTimeIndex, value)}
                            onConfirm={(h, m, s) => {
                              // 시간을 초로 변환하여 handleProcessTimeChange 호출
                              const totalSeconds = h * 3600 + m * 60 + s;
                              handleProcessTimeChange(pumpTimeIndex, totalSeconds);
                            }}
                          />
                          
                          {/* 대기시간 설정 추가 */}
                          <div className="mt-4">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm">대기시간</label>
                              <div className="text-sm text-gray-500">
                                {formatTime(sequence.process[waitTimeIndex] || 0)}
                              </div>
                            </div>
                            <TimePickerDial 
                              value={sequence.process[waitTimeIndex] || 0}
                              onChange={(value) => handleProcessTimeChange(waitTimeIndex, value)}
                              onConfirm={(h, m, s) => {
                                // 시간을 초로 변환하여 handleProcessTimeChange 호출
                                const totalSeconds = h * 3600 + m * 60 + s;
                                handleProcessTimeChange(waitTimeIndex, totalSeconds);
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 p-4 border rounded-md">
                  펌프를 선택하세요
                </div>
              )}
            </div>
            {/* 중첩 모드에서는 공통 대기시간 제거 */}
            <RepeatCountSetting />
          </div>
        );

      default:
        return null;
    }
  };

  // MQTT 메시지 수신 처리 - 밸브 상태 주제 전용 useEffect 추가
  useEffect(() => {
    if (!mqttClient) return;
    
    console.log('밸브 상태 토픽 구독 설정 중...');
    
    // 밸브 상태 토픽 명시적 구독
    mqttClient.subscribe(VALVE_STATE_TOPIC);
    console.log('밸브 상태 토픽 구독 완료:', VALVE_STATE_TOPIC);
    
    // 밸브 상태 메시지 처리 함수
    const handleValveStateMessage = (topic: string, message: Buffer) => {
      if (topic !== VALVE_STATE_TOPIC) return;
      
      const messageStr = message.toString();
      console.log(`밸브 상태 메시지 수신: ${messageStr}`);
      
      // 밸브 상태 파싱 및 업데이트
      const valveInfo = parseValveStateMessage(messageStr);
      
      // 상태 로그 추가
      setProgressMessages(prev => {
        const newMessage = {
          timestamp: Date.now(),
          message: `밸브 상태 업데이트: ${messageStr} (밸브A: ${valveInfo.valveADesc || '알 수 없음'}, 밸브B: ${valveInfo.valveBDesc || '알 수 없음'})`,
          rawJson: messageStr
        };
        return [newMessage, ...prev].slice(0, 20);
      });
    };
    
    // 메시지 수신 이벤트 등록
    mqttClient.on('message', handleValveStateMessage);
    
    return () => {
      // 구독 해제 및 이벤트 리스너 제거
      if (mqttClient) {
        mqttClient.unsubscribe(VALVE_STATE_TOPIC);
        mqttClient.off('message', handleValveStateMessage);
        console.log('밸브 상태 토픽 구독 해제 및 이벤트 리스너 제거');
      }
    };
  }, [mqttClient]);

  // 밸브 버튼 스타일 가져오기
  const getValveButtonStyle = useCallback((valveCode: string) => {
    const isActive = currentValveState === valveCode;
    
    return {
      backgroundColor: isActive ? '#3b82f6' : '#f3f4f6',
      color: isActive ? 'white' : '#374151',
      borderColor: isActive ? '#2563eb' : '#d1d5db'
    };
  }, [currentValveState]);

  // 수정 모드 상태 추가
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editingSequence, setEditingSequence] = useState<string | null>(null);
  
  // 시퀀스 순서 변경 함수
  const moveSequence = (name: string, direction: 'up' | 'down') => {
    const names = getUniqueSequenceNames();
    const currentIndex = names.indexOf(name);
    
    if (direction === 'up' && currentIndex > 0) {
      // 위로 이동
      const newNames = [...names];
      [newNames[currentIndex], newNames[currentIndex - 1]] = [newNames[currentIndex - 1], newNames[currentIndex]];
      
      // 새 순서로 시퀀스 재정렬
      const reorderedSequences = newNames.flatMap(n => 
        savedSequences.filter(seq => seq.name === n)
      );
      
      setSavedSequences(reorderedSequences);
      saveSequencesToLocalStorage(reorderedSequences);
      saveSequencesToServer(reorderedSequences);
    } else if (direction === 'down' && currentIndex < names.length - 1) {
      // 아래로 이동
      const newNames = [...names];
      [newNames[currentIndex], newNames[currentIndex + 1]] = [newNames[currentIndex + 1], newNames[currentIndex]];
      
      // 새 순서로 시퀀스 재정렬
      const reorderedSequences = newNames.flatMap(n => 
        savedSequences.filter(seq => seq.name === n)
      );
      
      setSavedSequences(reorderedSequences);
      saveSequencesToLocalStorage(reorderedSequences);
      saveSequencesToServer(reorderedSequences);
    }
  };
  
  // 시퀀스 설명 업데이트 함수
  const updateSequenceDescription = (name: string, newName: string) => {
    if (newName.trim() === '') {
      alert('시퀀스 이름은 비워둘 수 없습니다.');
      return;
    }
    
    // 이름이 변경된 경우 중복 확인
    if (name !== newName && getUniqueSequenceNames().includes(newName)) {
      alert(`'${newName}' 이름의 시퀀스가 이미 존재합니다.`);
      return;
    }
    
    const updatedSequences = savedSequences.map(seq => {
      if (seq.name === name) {
        return { ...seq, name: newName };
      }
      return seq;
    });
    
    setSavedSequences(updatedSequences);
    saveSequencesToLocalStorage(updatedSequences);
    saveSequencesToServer(updatedSequences);
    setEditingSequence(null);
  };
  
  // 서버에서 상태를 불러오는 함수
  const loadStateFromServer = useCallback(async () => {
    try {
      const response = await fetch('/api/system-state');
      if (response.ok) {
        const data = await response.json();
        if (data) {
          console.log('서버에서 상태를 성공적으로 불러왔습니다.');
          return data;
        }
      }
      return null;
    } catch (error) {
      console.error('상태 불러오기 중 오류:', error);
      return null;
    }
  }, []);

  // 주기적으로 시스템 상태 저장 (30초마다)
  useEffect(() => {
    const intervalId = setInterval(saveStateToServer, 30000);
    
    // 컴포넌트 언마운트 시 인터벌 정리
    return () => clearInterval(intervalId);
  }, [saveStateToServer]);

  // 초기 상태 로드 함수
  const loadInitialSequences = async () => {
    try {
      // 서버에서 저장된 시퀀스 불러오기
      const savedSequences = await loadSequencesFromServer();
      if (savedSequences && savedSequences.length > 0) {
        setSavedSequences(savedSequences);
      }
    } catch (error) {
      console.error('초기 시퀀스 로드 중 오류:', error);
    }
  };

  // 컴포넌트가 마운트될 때 서버에서 상태 불러오기
  useEffect(() => {
    // 서버에서 상태 불러오기 함수
    const loadStateFromServerEffect = async () => {
      try {
        // 서버에서 저장된 상태 불러오기
        const savedState = await loadStateFromServer();
        
        if (savedState) {
          console.log('서버에서 시스템 상태를 불러왔습니다.');
          
          // 저장된 상태가 있으면 적용
          if (savedState.tankData) {
            setTankData(savedState.tankData);
          }
          
          if (savedState.currentValveState) {
            setCurrentValveState(savedState.currentValveState);
          }
          
          if (savedState.pumpStateMessages) {
            setPumpStateMessages(savedState.pumpStateMessages);
          }
          
          if (savedState.progressData) {
            setProgressData(savedState.progressData);
          }
          
          if (savedState.progressMessages) {
            setProgressMessages(savedState.progressMessages);
          }
          
          if (savedState.queueStatus) {
            setQueueStatus(savedState.queueStatus);
          }
        }
      } catch (error) {
        console.error('서버에서 상태 불러오기 중 오류:', error);
      }
    };

    // 서버에서 상태 불러오기
    loadStateFromServerEffect();
  }, []);

  // 컴포넌트가 마운트될 때 MQTT 연결 설정
  useEffect(() => {
    // MQTT 연결 설정
    connectMqtt();
    
    // 초기 상태 로드
    loadInitialSequences();
    
    return () => {
      // 컴포넌트 언마운트 시 MQTT 연결 해제
      if (mqttClient) {
        mqttClient.disconnect();
      }
    };
  }, []);

  // MQTT 메시지 수신 시 중요한 상태 변경이 있을 때 서버에 상태 저장
  useEffect(() => {
    // 이미 존재하는 MQTT 클라이언트가 있을 때만 실행
    if (!mqttClient) return;

    // 메시지 핸들러 함수
    const handleStateChange = (topic: string, message: Buffer) => {
      // 중요한 상태 변경이 있을 때만 서버에 상태 저장
      // STATUS 명령은 무시 - 실제 상태 변경 없는 단순 조회 요청임
      if (message.toString() === "STATUS") {
        console.log(`STATUS 명령 무시: ${topic}`);
        return;
      }
      
      const isImportantStateChange = 
        topic.includes('state') || 
        topic.includes('progress') || 
        topic.includes('level') ||
        topic === VALVE_STATE_TOPIC ||
        topic === PROCESS_PROGRESS_TOPIC;
      
      if (isImportantStateChange) {
        // 상태 변경 후 약간의 지연을 두고 저장 (상태 업데이트 완료 후)
        setTimeout(saveStateToServer, 500);
      }
    };

    // 메시지 이벤트 리스너 등록
    mqttClient.on('message', handleStateChange);

    // 클린업 함수
    return () => {
      mqttClient.off('message', handleStateChange);
    };
  }, [mqttClient, saveStateToServer]);

  // 시간 선택 다이얼 컴포넌트 인터페이스
  interface TimePickerDialProps {
    initialHours?: number;
    initialMinutes?: number;
    initialSeconds?: number;
    onConfirm: (hours: number, minutes: number, seconds: number) => void;
    onCancel?: () => void;
    value?: number; // 초 단위 값 추가
    onChange?: (value: number) => void; // 변경 이벤트 핸들러 추가
    max?: number; // 최대값
    step?: number; // 증가/감소 단계
  }

  // 시간 선택 다이얼 컴포넌트
  const TimePickerDial = ({ 
    initialHours = 0, 
    initialMinutes = 0, 
    initialSeconds = 0, 
    onConfirm, 
    onCancel,
    value, // 초 단위 값
    onChange, // 변경 이벤트 핸들러
    max,
    step
  }: TimePickerDialProps) => {
    // value가 제공되면 초를 시/분/초로 변환
    const convertValueToTime = useCallback((valueInSeconds?: number) => {
      if (valueInSeconds === undefined) return { h: initialHours, m: initialMinutes, s: initialSeconds };
      
      const h = Math.floor(valueInSeconds / 3600);
      const m = Math.floor((valueInSeconds % 3600) / 60);
      const s = valueInSeconds % 60;
      return { h, m, s };
    }, [initialHours, initialMinutes, initialSeconds]);

    const initialTimeValues = useMemo(() => convertValueToTime(value), [convertValueToTime, value]);
    
    // 시간값 상태 관리
    const [hours, setHours] = useState(initialTimeValues.h);
    const [minutes, setMinutes] = useState(initialTimeValues.m);
    const [seconds, setSeconds] = useState(initialTimeValues.s);
    
    // value가 변경될 때 시/분/초 업데이트
    useEffect(() => {
      if (value !== undefined) {
        const { h, m, s } = convertValueToTime(value);
        setHours(h);
        setMinutes(m);
        setSeconds(s);
      }
    }, [value, convertValueToTime]);

    // 시간 변경 핸들러
    const handleTimeChange = useCallback((type: 'h' | 'm' | 's', newValue: number) => {
      if (type === 'h') {
        setHours(newValue);
      } else if (type === 'm') {
        setMinutes(newValue);
      } else {
        setSeconds(newValue);
      }
      
      // 변경사항 즉시 적용
      const totalSeconds = (type === 'h' ? newValue : hours) * 3600 + 
                           (type === 'm' ? newValue : minutes) * 60 + 
                           (type === 's' ? newValue : seconds);
      
      if (onChange) {
        onChange(totalSeconds);
      }
    }, [hours, minutes, seconds, onChange]);

    // 시간 증가 함수
    const incrementTime = (type: 'h' | 'm' | 's') => {
      const currentStep = step || 1;
      if (type === 'h') {
        const newHours = Math.min(hours + 1, 23);
        handleTimeChange('h', newHours);
      } else if (type === 'm') {
        const newMinutes = Math.min(minutes + currentStep, 59);
        handleTimeChange('m', newMinutes);
      } else {
        const newSeconds = Math.min(seconds + currentStep, 59);
        handleTimeChange('s', newSeconds);
      }
    };

    // 시간 감소 함수
    const decrementTime = (type: 'h' | 'm' | 's') => {
      const currentStep = step || 1;
      if (type === 'h') {
        const newHours = Math.max(hours - 1, 0);
        handleTimeChange('h', newHours);
      } else if (type === 'm') {
        const newMinutes = Math.max(minutes - currentStep, 0);
        handleTimeChange('m', newMinutes);
      } else {
        const newSeconds = Math.max(seconds - currentStep, 0);
        handleTimeChange('s', newSeconds);
      }
    };

    // 빠른 시간 설정 함수
    const setQuickTime = (timeInSeconds: number) => {
      const { h, m, s } = convertValueToTime(timeInSeconds);
      setHours(h);
      setMinutes(m);
      setSeconds(s);
      
      if (onChange) {
        onChange(timeInSeconds);
      }
    };

    // 시간 추가 함수 (기존 시간에 초 단위로 추가)
    const addQuickTime = (secondsToAdd: number) => {
      const currentTotalSeconds = hours * 3600 + minutes * 60 + seconds;
      const newTotalSeconds = currentTotalSeconds + secondsToAdd;
      
      const newHours = Math.floor(newTotalSeconds / 3600);
      const newMinutes = Math.floor((newTotalSeconds % 3600) / 60);
      const newSeconds = newTotalSeconds % 60;
      
      setHours(newHours);
      setMinutes(newMinutes);
      setSeconds(newSeconds);
      
      if (onChange) {
        onChange(newTotalSeconds);
      }
    };
    
    return (
      <div className="bg-white p-2 rounded-lg shadow-sm border">
        <div className="flex justify-between items-center gap-2">
          {/* 시간 입력 컨트롤 */}
          <div className="flex items-center">
            <div className="flex flex-col items-center">
              <button 
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => incrementTime('h')}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <input
                type="number"
                min="0"
                max="23"
                value={hours}
                onChange={(e) => handleTimeChange('h', parseInt(e.target.value) || 0)}
                className="w-12 text-center border rounded p-1"
              />
              <button 
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => decrementTime('h')}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="text-xs">시간</span>
                  </div>
            <span className="mx-1 mt-1">:</span>
            <div className="flex flex-col items-center">
              <button 
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => incrementTime('m')}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <input
                type="number"
                min="0"
                max="59"
                      value={minutes}
                onChange={(e) => handleTimeChange('m', parseInt(e.target.value) || 0)}
                className="w-12 text-center border rounded p-1"
              />
              <button 
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => decrementTime('m')}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="text-xs">분</span>
                  </div>
            <span className="mx-1 mt-1">:</span>
            <div className="flex flex-col items-center">
              <button 
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => incrementTime('s')}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <input
                type="number"
                min="0"
                max="59"
                      value={seconds}
                onChange={(e) => handleTimeChange('s', parseInt(e.target.value) || 0)}
                className="w-12 text-center border rounded p-1"
              />
              <button 
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => decrementTime('s')}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="text-xs">초</span>
                  </div>
                </div>
                
          {/* 빠른 시간 버튼 - 수직 정렬 및 우측 배치 */}
          <div className="flex items-center gap-1 ml-2">
            <button
              className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium"
              onClick={() => addQuickTime(5)}
            >
              +5초
            </button>
            <button
              className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium"
              onClick={() => addQuickTime(30)}
            >
              +30초
            </button>
            <button
              className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium"
              onClick={() => addQuickTime(60)}
            >
              +1분
            </button>
            <button
              className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium"
              onClick={() => addQuickTime(300)}
            >
              +5분
            </button>
                  </div>
                </div>
      </div>
    );
  };

  // 작업 로그관련 상태 추가
  const [workLogsData, setWorkLogsData] = useState<{
    logs: WorkLog[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
  }>({
    logs: [],
    totalCount: 0,
    currentPage: 1,
    totalPages: 1
  });

  // 작업 로그 관리 함수 추가
  const loadWorkLogs = useCallback(async () => {
    try {
      const result = await workLogService.getWorkLogs();
      setWorkLogsData(result);
    } catch (error) {
      console.error('작업 로그 불러오기 중 오류:', error);
    }
  }, []);

  const clearWorkLogs = useCallback(async () => {
    if (confirm('모든 작업 로그를 삭제하시겠습니까?')) {
      try {
        await workLogService.clearAllWorkLogs();
        setWorkLogsData({
          logs: [],
          totalCount: 0,
          currentPage: 1,
          totalPages: 1
        });
      } catch (error) {
        console.error('작업 로그 삭제 중 오류:', error);
      }
    }
  }, []);

  // 컴포넌트 마운트 시 작업 로그 불러오기
  useEffect(() => {
    loadWorkLogs();
  }, [loadWorkLogs]);

  // 시퀀스 발행 시 JSON 형식 표준화 함수 추가
  const standardizeSequenceJson = (sequences: any[]): any[] => {
    return sequences.map(seq => {
      // operation_mode 유효성 검사 및 표준화
      // 11, 21 등의 모드는 12, 22, 30 등의 지원되는 모드로 변환
      let operationMode = seq.operation_mode;
      const firstDigit = Math.floor(operationMode / 10);
      const secondDigit = operationMode % 10;
      
      // 첫 번째 자리가 1인 경우 (동시 모드) -> 12로 표준화
      if (firstDigit === 1) {
        operationMode = 12;
      } 
      // 첫 번째 자리가 2인 경우 (순차 모드) -> 22로 표준화
      else if (firstDigit === 2) {
        operationMode = 22;
      }
      // 그 외의 경우 기본값 30 (혼합 모드)로 설정
      else if (firstDigit !== 3) {
        operationMode = 30;
      }
      
      // 프로세스 배열 표준화
      let processArray = [...seq.process];
      
      // 프로세스 배열에 유효하지 않은 값(7, 8, 9)이 있으면 유효한 값(0, 5, 6, 10)으로 변환
      processArray = processArray.map(value => {
        if (value === 7 || value === 8 || value === 9) {
          return 6; // 유효한 값으로 대체
        }
        return value;
      });
      
      // 모드별로 적절한 process 배열 길이와 패턴 확보
      if (operationMode === 12) { // 동시 모드
        // 프로세스 길이가 6의 배수가 되도록 조정
        while (processArray.length % 6 !== 0) {
          processArray.push(0);
        }
      } else if (operationMode === 22) { // 순차 모드
        // 프로세스 길이가 3의 배수가 되도록 조정
        while (processArray.length % 3 !== 0) {
          processArray.push(0);
        }
        
        // 각 그룹이 [6, 5, 0] 또는 [6, 5, 0] 같은 패턴으로 표준화
        const standardizedProcess = [];
        for (let i = 0; i < processArray.length; i += 3) {
          standardizedProcess.push(6);
          standardizedProcess.push(5);
          standardizedProcess.push(0);
        }
        processArray = standardizedProcess;
      } else if (operationMode === 30) { // 혼합 모드
        // 프로세스 길이가 짝수가 되도록 조정
        if (processArray.length % 2 !== 0) {
          processArray.push(0);
        }
        
        // 교차 패턴(10, 5, ...)으로 표준화
        const standardizedProcess = [];
        for (let i = 0; i < processArray.length; i += 2) {
          standardizedProcess.push(10);
          standardizedProcess.push(5);
        }
        processArray = standardizedProcess;
      }
      
      // 표준화된 시퀀스 객체 생성
      const standardizedSeq: any = {
        operation_mode: operationMode,
        repeats: seq.repeats || 1,
        process: processArray
      };
      
      // wait_time은 operation_mode가 22(순차 모드)가 아닌 경우에만 추가
      if (operationMode !== 22 && seq.wait_time) {
        standardizedSeq.wait_time = seq.wait_time;
      }
      
      return standardizedSeq;
    });
  };

  // 폼 제출 핸들러
  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    
    if (!mqttClient) {
      alert('MQTT 클라이언트가 초기화되지 않았습니다. 페이지를 새로고침하세요.');
      return;
    }
    
    // 기본 메시지 보내기 기능
    try {
      // publishToTopic 함수 사용 (STATUS 필터링 포함)
      publishToTopic(topic, message);
      
      // 메시지 발송 기록
      setProgressMessages(prev => [{
        timestamp: Date.now(),
        message: `메시지 발행: ${topic} -> ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
        rawJson: null
      }, ...prev]);
      
      // 메시지 필드 초기화
      setMessage("");
    } catch (error) {
      console.error("메시지 발행 오류:", error);
      alert(`메시지 발행 중 오류가 발생했습니다: ${error}`);
    }
  }

  // 시스템 상태를 API에서 새로고침하는 함수
  const refreshSystemState = async () => {
    console.log('시스템 상태 새로고침');
    try {
      // API로 현재 상태 요청
      const response = await fetch('/api/system-state');
      if (response.ok) {
        const data = await response.json();
        console.log('API에서 시스템 상태 가져옴:', data);
        
        // 데이터가 유효하면 적용
        if (data) {
          if (data.tankData) {
            setTankData(data.tankData);
          }
          
          if (data.pumpStateMessages) {
            setPumpStateMessages(data.pumpStateMessages);
          }
          
          if (data.currentValveState) {
            setCurrentValveState(data.currentValveState);
          }
          
          if (data.progressData) {
            setProgressData(data.progressData);
          }
          
          if (data.progressMessages) {
            setProgressMessages(data.progressMessages);
          }
          
          if (data.queueStatus) {
            setQueueStatus(data.queueStatus);
          }
          
          console.log('시스템 상태가 성공적으로 업데이트되었습니다.');
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('시스템 상태 새로고침 중 오류:', error);
      return false;
    }
  };

  // 진행 메시지 추가 함수
  const addProgressMessage = (message: {timestamp: number, message: string, rawJson?: string | null}) => {
    setProgressMessages(prev => {
      const newMessages = [message, ...prev].slice(0, 20);
      return newMessages;
    });
  };

  // 1분마다 상태 갱신하는 타이머 설정
  useEffect(() => {
    // 시스템 상태를 주기적으로 조회
    const intervalId = setInterval(() => {
      refreshSystemState();
    }, 21600000); // 6시간마다 시스템 상태 갱신
    
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // 알람 소리 재생 관련 상태
  const [alarmPlaying, setAlarmPlaying] = useState(false);
  const [useAlarmSound, setUseAlarmSound] = useState(true);
  
  // 공정 진행 상태 관리
  const [processRunning, setProcessRunning] = useState(false);
  
  // 탱크 시스템 상태 참조
  const tankSystemRef = useRef<HTMLDivElement>(null);
  
  // 공정 실행 상태 모니터링
  useEffect(() => {
    // 로컬 스토리지에서 초기 상태 확인
    const savedProcessState = localStorage.getItem('process-running-state');
    if (savedProcessState) {
      try {
        const state = JSON.parse(savedProcessState);
        setProcessRunning(state.running);
      } catch (error) {
        console.error('저장된 프로세스 상태 파싱 오류:', error);
      }
    }
    
    // 탱크 시스템 상태 변화 감지를 위한 MutationObserver 설정
    const checkProcessState = () => {
      if (tankSystemRef.current) {
        const stateElement = tankSystemRef.current.querySelector('#process-running-state');
        if (stateElement) {
          const runningValue = stateElement.getAttribute('data-running');
          const isRunning = runningValue === 'true';
          setProcessRunning(isRunning);
        }
      }
    };
    
    // 주기적으로 상태 확인
    const stateCheckInterval = setInterval(checkProcessState, 1000);
    
    return () => {
      clearInterval(stateCheckInterval);
    };
  }, []);
  
  // MQTT 메시지로 프로세스 상태 감지
  useEffect(() => {
    if (!mqttClient) return;
    
    const handleProcessMessage = (topic: string, message: Buffer) => {
      if (topic === 'extwork/extraction/output') {
        const messageStr = message.toString();
        
        // 완료 메시지 확인
        if (messageStr.includes("공정 종료") || 
            messageStr.includes("사이클 완료") || 
            messageStr.includes("JSON 명령이 성공적으로 처리")) {
          setProcessRunning(false);
        }
      } else if (topic === 'extwork/automation/control') {
        try {
          const command = JSON.parse(message.toString());
          if (command.command === 'start' || command.command === 'play') {
            setProcessRunning(true);
          } else if (command.command === 'stop' || command.command === 'reset') {
            setProcessRunning(false);
          }
        } catch (e) {
          console.error('자동화 명령 파싱 오류:', e);
        }
      }
    };
    
    mqttClient.subscribe('extwork/extraction/output');
    mqttClient.subscribe('extwork/automation/control');
    mqttClient.on('message', handleProcessMessage);
    
    return () => {
      mqttClient.unsubscribe('extwork/extraction/output');
      mqttClient.unsubscribe('extwork/automation/control');
      mqttClient.off('message', handleProcessMessage);
    };
  }, [mqttClient]);
  
  // 알람 소리 재생 함수
  const playAlarmSound = () => {
    if (useAlarmSound) {
      const audio = new Audio('/path/to/alarm.mp3');
      audio.play();
      setAlarmPlaying(true);
      setTimeout(() => setAlarmPlaying(false), 1000);
    }
  };

  // 주기적으로 로컬 스토리지에서 탱크 메시지 확인하여 업데이트
  useEffect(() => {
    if (!mqttClient) return;
    
    // 5초마다 로컬 스토리지에서 탱크 메시지 확인
    const checkTankMessages = () => {
      // 모든 탱크에 대해 로컬 스토리지 확인
      for (let tankId = 1; tankId <= 6; tankId++) {
        const tankMessage = localStorage.getItem(`tank_${tankId}_message`);
        if (tankMessage) {
          console.log(`로컬 스토리지에서 탱크 ${tankId} 메시지 발견:`, tankMessage);
          
          // 탱크 데이터 업데이트
          setTankData(prev => {
            // 이미 같은 메시지가 있으면 업데이트하지 않음
            if (prev?.tankMessages?.[tankId] === tankMessage) {
              return prev;
            }
            
            return {
              ...prev,
              tankMessages: {
                ...(prev.tankMessages || {}),
                [tankId]: tankMessage
              }
            };
          });
          
          // 사용한 메시지는 삭제하여 중복 처리 방지
          localStorage.removeItem(`tank_${tankId}_message`);
        }
      }
      
      // 메인 탱크 메시지도 확인
      const mainTankMessage = localStorage.getItem('mainTankLevelMessage');
      if (mainTankMessage) {
        console.log('로컬 스토리지에서 메인 탱크 메시지 발견:', mainTankMessage);
        
        // 시간 추가하여 표시 메시지 생성
        const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const displayMessage = `${mainTankMessage} (${timeStr})`;
        
        setTankData(prev => {
          // 이미 같은 메시지가 있으면 업데이트하지 않음
          if (prev?.mainTankMessage === displayMessage) {
            return prev;
          }
          
          return {
            ...prev,
            mainTankMessage: displayMessage
          };
        });
        
        // 사용한 메시지는 삭제
        localStorage.removeItem('mainTankLevelMessage');
      }
    };
    
    // 초기 실행 및 타이머 설정
    checkTankMessages();
    const intervalId = setInterval(checkTankMessages, 5000);
    
    return () => {
      clearInterval(intervalId);
    };
  }, [mqttClient]);

  // 작업 예약 관련 상태 추가
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState<{name: string, mode: 'configure' | 'run'} | null>(null);
  const [waitTime, setWaitTime] = useState<number>(60); // 기본 대기시간 1분
  const [nextOrderNumber, setNextOrderNumber] = useState<number>(1);
  const scheduleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 예약 추가 함수 (orderNumber는 1~9 사이로 제한)
  const scheduleTask = (taskName: string, waitTime: number, repeats: number) => {
    // 최대 9개까지만 예약 허용
    if (scheduledTasks.length >= 9) {
      setProgressMessages(prev => [{
        timestamp: Date.now(),
        message: `최대 9개까지만 예약할 수 있습니다. 기존 예약을 삭제 후 시도하세요.`,
        rawJson: null
      }, ...prev]);
      setShowScheduleDialog(null);
      return;
    }

    // 사용 가능한 가장 낮은 orderNumber 찾기 (1~9 사이)
    const usedNumbers = scheduledTasks.map(task => task.orderNumber);
    let nextNumber = 1;
    while (usedNumbers.includes(nextNumber) && nextNumber <= 9) {
      nextNumber++;
    }
    
    // 모든 번호가 사용 중이면 알림
    if (nextNumber > 9) {
      setProgressMessages(prev => [{
        timestamp: Date.now(),
        message: `모든 예약 순서(1-9)가 사용 중입니다. 기존 예약을 삭제 후 시도하세요.`,
        rawJson: null
      }, ...prev]);
      setShowScheduleDialog(null);
      return;
    }

    const newTask: ScheduledTask = {
      id: uuidv4(),
      taskName,
      waitTime,
      scheduledTime: Date.now() + waitTime * 1000,
      orderNumber: nextNumber,
      repeats,
      isStarted: false,
      isRunning: false,
      isProcessing: false,
      isCompleted: false
    };
    
    setScheduledTasks(prev => [...prev, newTask]);
    setShowScheduleDialog(null);
    
    // 예약 정보 로그 추가
    setProgressMessages(prev => [{
      timestamp: Date.now(),
      message: `작업 '${taskName}' 예약됨: 대기시간 ${formatWaitTime(waitTime)}, 순서 #${nextNumber}`,
      rawJson: null
    }, ...prev]);
  };
  
  // 예약 취소 함수
  const cancelScheduledTask = (taskId: string) => {
    setScheduledTasks(prev => prev.filter(task => task.id !== taskId));
  };

  // 작업 순서 변경 함수
  const moveScheduledTask = (taskId: string, direction: 'up' | 'down') => {
    setScheduledTasks(prev => {
      const index = prev.findIndex(task => task.id === taskId);
      if (index === -1) return prev;

      const task = prev[index];
      const targetIndex = direction === 'up' 
        ? Math.max(0, index - 1) 
        : Math.min(prev.length - 1, index + 1);
      
      // 이미 맨 위/아래인 경우 변경 없음
      if (index === targetIndex) return prev;
      
      const targetTask = prev[targetIndex];
      
      // 순서 번호 교환
      const updatedTasks = [...prev];
      const tempOrderNumber = task.orderNumber;
      updatedTasks[index] = { ...task, orderNumber: targetTask.orderNumber };
      updatedTasks[targetIndex] = { ...targetTask, orderNumber: tempOrderNumber };
      
      return updatedTasks;
    });
  };

  // 모든 예약 작업 일괄 시작 함수
  const startAllScheduledTasks = () => {
    // 이미 시작된 작업이 있는지 확인
    const anyStarted = scheduledTasks.some(task => task.isStarted);
    if (anyStarted) {
      setProgressMessages(prev => [{
        timestamp: Date.now(),
        message: `이미 시작된 예약 작업이 있습니다.`,
        rawJson: null
      }, ...prev]);
      return;
    }
    
    // 모든 작업을 시작 상태로 변경
    setScheduledTasks(prev => 
      prev.map(task => ({ 
        ...task, 
        isStarted: true,
        // 첫 번째 작업만 처리 가능 상태로, 나머지는 대기 상태로
        isProcessing: task.orderNumber !== 1
      }))
    );
    
    setProgressMessages(prev => [{
      timestamp: Date.now(),
      message: `모든 예약 작업(${scheduledTasks.length}개)이 순차적으로 시작됩니다.`,
      rawJson: null
    }, ...prev]);
    
    // 타이머 시작
    if (!scheduleTimerRef.current) {
      startScheduleTimer();
    }
  };
  
  // 타이머 시작 함수
  const startScheduleTimer = () => {
    if (scheduleTimerRef.current) {
      clearInterval(scheduleTimerRef.current);
    }
    
    // 1초마다 예약 상태 확인
    scheduleTimerRef.current = setInterval(() => {
      const now = Date.now();
      
      // 현재 진행 중인 작업이 있는지 확인
      const isAnyWorkInProgress = Object.values(workInProgress).some(status => status);
      
      setScheduledTasks(prev => {
        // 시작된 작업이 없으면 변경 없음
        const startedTasks = prev.filter(task => task.isStarted);
        if (startedTasks.length === 0) return prev;
        
        // 작업 상태 업데이트를 위한 새 배열
        const updatedTasks = [...prev];
        let tasksChanged = false;

        // 현재 진행 중인 작업이 있고, 실행 중인 예약 작업이 있다면 일시 중지
        if (isAnyWorkInProgress) {
          for (let i = 0; i < updatedTasks.length; i++) {
            const task = updatedTasks[i];
            if (task.isStarted && task.isRunning && !task.isProcessing) {
              updatedTasks[i] = { ...task, isRunning: false, isProcessing: true };
              tasksChanged = true;
              
              setProgressMessages(prev => [{
                timestamp: Date.now(),
                message: `예약 작업 '${task.taskName}' (#${task.orderNumber}) 카운트다운 일시정지: 다른 작업 진행 중`,
                rawJson: null
              }, ...prev]);
            }
          }
          return tasksChanged ? updatedTasks : prev;
        }
        
        // 현재 진행 중인 작업이 없을 때 처리
        
        // 1. 완료된 작업이 아닌 가장 낮은 순서 번호의 작업 찾기
        const sortedTasks = [...updatedTasks]
          .filter(task => task.isStarted && !task.isCompleted)
          .sort((a, b) => a.orderNumber - b.orderNumber);
        
        if (sortedTasks.length === 0) return prev;
        
        const nextTask = sortedTasks[0];
        const nextTaskIndex = updatedTasks.findIndex(task => task.id === nextTask.id);
        
        // 2. 다음 작업 처리
        if (!nextTask.isRunning && !nextTask.isProcessing) {
          // 카운트다운 시작
          updatedTasks[nextTaskIndex] = { 
            ...nextTask, 
            isRunning: true,
            isProcessing: false,
            scheduledTime: now + nextTask.waitTime * 1000
          };
          tasksChanged = true;
          
          setProgressMessages(prev => [{
            timestamp: Date.now(),
            message: `예약 작업 '${nextTask.taskName}' (#${nextTask.orderNumber}) 카운트다운 시작 (${formatWaitTime(nextTask.waitTime)})`,
            rawJson: null
          }, ...prev]);
        }
        // 3. 카운트다운 중인 작업이 완료되었는지 확인
        else if (nextTask.isRunning && nextTask.scheduledTime <= now) {
          // 작업 실행
          executeScheduledTask(nextTask);
          
          // 작업 완료 표시
          updatedTasks[nextTaskIndex] = { 
            ...nextTask,
            isRunning: false,
            isCompleted: true 
          };
          tasksChanged = true;
          
          // 다음 순번의 작업을 준비 상태로 변경
          const nextOrderTasks = sortedTasks.filter(task => 
            task.orderNumber > nextTask.orderNumber && !task.isCompleted
          );
          
          if (nextOrderTasks.length > 0) {
            const nextOrderTask = nextOrderTasks[0];
            const nextOrderIndex = updatedTasks.findIndex(task => task.id === nextOrderTask.id);
            
            if (nextOrderIndex !== -1) {
              updatedTasks[nextOrderIndex] = {
                ...nextOrderTask,
                isProcessing: false
              };
            }
          }
        }
        
        return tasksChanged ? updatedTasks : prev;
      });
      
      // 모든 예약이 완료되면 타이머 정지
      const allCompleted = scheduledTasks.every(task => !task.isStarted || task.isCompleted);
      if (allCompleted && scheduledTasks.length > 0) {
        setProgressMessages(prev => [{
          timestamp: Date.now(),
          message: `모든 예약 작업이 완료되었습니다.`,
          rawJson: null
        }, ...prev]);
        
        // 완료된 모든 작업 제거
        setScheduledTasks(prev => prev.filter(task => !task.isCompleted));
        
        stopScheduleTimer();
      }
    }, 1000);
  };
  
  // 예약된 작업 실행 함수
  const executeScheduledTask = (task: ScheduledTask) => {
    // 작업 진행 버튼 클릭과 동일한 로직 실행
    const filteredSequences = savedSequences
      .filter(seq => seq.name === task.taskName)
      .map(seq => {
        // 필요한 필드만 포함하여 새 객체 생성
        const cleanedSeq = {
          operation_mode: seq.operation_mode,
          repeats: task.repeats,
          process: seq.process
        };
        
        // wait_time이 있는 경우에만 추가
        if (seq.wait_time) {
          (cleanedSeq as any).wait_time = seq.wait_time;
        }
        
        return cleanedSeq;
      });
    
    if (filteredSequences.length > 0 && mqttClient) {
      try {
        // 시퀀스를 MQTT 메시지로 직접 발행
        const sequence = { sequences: filteredSequences };
        const topic = "extwork/extraction/input";
        const message = JSON.stringify(sequence);
        
        mqttClient.publish(topic, message);
        
        // 로그 추가
        setProgressMessages(prev => [{
          timestamp: Date.now(),
          message: `예약된 작업 '${task.taskName}' 실행 (예약 #${task.orderNumber})`,
          rawJson: message
        }, ...prev]);
        
        // 작업 로그 생성 및 저장
        const firstSequence = filteredSequences[0];
        
        // 원본 시퀀스에서 selectedPumps 정보 가져오기
        const originalFirstSeq = savedSequences.find(s => 
          s.name === task.taskName && 
          s.operation_mode === firstSequence.operation_mode
        );
        
        const workLog = workLogService.createWorkLog(
          task.taskName,
          firstSequence.operation_mode,
          task.repeats,
          originalFirstSeq ? originalFirstSeq.selectedPumps : undefined
        );
        
        // 작업 세부 내용 추가
        workLog.tags = [`예약된 작업 (#${task.orderNumber}): ${formatWaitTime(task.waitTime)} 대기 후 실행`];
        
        workLogService.saveWorkLog(workLog).then(() => {
          setCurrentWorkLogId(workLog.id);
          loadWorkLogs(); // 로그 목록 새로고침
        });
      } catch (error) {
        console.error("예약 작업 실행 중 오류:", error);
        
        // 오류 로그 추가
        setProgressMessages(prev => [{
          timestamp: Date.now(),
          message: `예약 작업 '${task.taskName}' 실행 중 오류: ${error}`,
          rawJson: null
        }, ...prev]);
      }
    }
  };
  
  // 대기 시간 포맷팅 함수
  const formatWaitTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}초`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}분 ${remainingSeconds}초` : `${minutes}분`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = seconds % 60;
      
      let result = `${hours}시간`;
      if (minutes > 0) result += ` ${minutes}분`;
      if (remainingSeconds > 0) result += ` ${remainingSeconds}초`;
      return result;
    }
  };
  
  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (scheduleTimerRef.current) {
        clearInterval(scheduleTimerRef.current);
      }
    };
  }, []);

  // 시퀀스를 서버에 저장하는 함수
  const saveSequencesToServer = useCallback(async (newSequences: any[]) => {
    try {
      // 서버 통신 오류가 UI에 영향을 주지 않도록 오류 처리 강화
      console.log('시퀀스 저장 시작...');
      
      // 서버에 저장하기 전에 로컬 상태는 이미 업데이트되었으므로
      // 서버 저장 성공 여부와 관계없이 UI가 유지되도록 함
      
      // 비동기로 서버 저장 시도
      const response = await fetch('/api/sequences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newSequences),
      }).catch(error => {
        console.error('시퀀스 저장 요청 실패:', error);
        return null; // 오류 시 null 반환하여 처리 계속
      });
      
      // 응답이 없거나 오류가 발생한 경우 조용히 처리
      if (!response) {
        console.warn('서버 응답 없음 - UI는 정상 유지됨');
        return;
      }
      
      if (response.ok) {
        const result = await response.json();
        console.log('시퀀스 저장 완료:', result);
      } else {
        console.warn(`서버 오류: ${response.status} - UI는 정상 유지됨`);
      }
    } catch (error) {
      // 오류가 발생해도 UI에는 영향을 주지 않도록 처리
      console.error('시퀀스 저장 중 오류 (UI는 정상 유지됨):', error);
    }
  }, []);
  
  // 서버에 시스템 상태 저장하는 함수
  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="tanks">
            {isAutomationLocked && <span className="mr-1">🏃</span>}
            탱크 시스템
          </TabsTrigger>
          <TabsTrigger value="cameras">
            {isAutomationLocked && <span className="mr-1">🏃</span>}
            카메라
          </TabsTrigger>
          <TabsTrigger value="mqtt">
            {isAutomationLocked && <span className="mr-1">🏃</span>}
            MQTT 제어
          </TabsTrigger>
          <TabsTrigger value="automation">
            {isAutomationLocked && <span className="mr-1">🔒</span>}
            자동화 공정
          </TabsTrigger>
          <TabsTrigger value="worklog">
            {isAutomationLocked && <span className="mr-1">🏃</span>}
            작업 로그북
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tanks" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span>탱크 시스템</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pb-10">
              {/* 상단 줄: K 버튼과 R1~R6 버튼 */}
              <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-0">
                {/* 왼쪽: K 버튼과 연결 상태 */}
                <div className="flex items-center gap-4 mb-3 sm:mb-0 mr-0 sm:mr-auto">
                  <div className="relative">
                    <Button 
                      variant="outline"
                      onClick={() => sendPumpKCommand(1)}
                      size="sm" 
                      className={`text-xs ${kButtonActive ? 'bg-blue-400 hover:bg-blue-500 text-white' : 'bg-blue-100 hover:bg-blue-200'} px-5 py-3 font-bold`}
                    >
                      K
                    </Button>
                    {kButtonActive && (
                      <div className="absolute -top-2 -right-2">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                        </span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">상태:</span>
                    <Badge variant={mqttStatus === "연결됨" ? "default" : "destructive"}>{mqttStatus}</Badge>
                  </div>
                </div>
                
                {/* 오른쪽: R1~R6 버튼 - 펌프 스위치와 정렬 (반응형으로 수정) */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 w-full sm:w-auto">
                  {tankData?.tanks?.map((tank) => (
                    <Button 
                      key={`reset-${tank.id}`} 
                      variant="outline"
                      onClick={() => resetPump(tank.id)}
                      size="sm" 
                      className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-2 font-bold w-full"
                    >
                      R{tank.id}
                    </Button>
                  )) || []}
                </div>
              </div>
              
              {/* 하단 줄: 추출 제어 버튼들과 펌프 스위치 - 반응형으로 수정 */}
              <div className="mb-4 flex flex-col gap-4">
                {/* 왼쪽: 추출 제어 버튼들과 밸브 스위치 */}
                <div className="flex flex-wrap gap-2 items-center">
                  <Button 
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendExtractionCommand("next");
                    }}
                    size="sm" 
                    className="text-xs bg-blue-100 hover:bg-blue-200 px-2 py-2 font-bold"
                  >
                    Next
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendExtractionCommand("prev");
                    }}
                    size="sm" 
                    className="text-xs bg-amber-100 hover:bg-amber-200 px-2 py-2 font-bold"
                  >
                    Prev
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendExtractionCommand("pause");
                    }}
                    size="sm" 
                    className="text-xs bg-purple-100 hover:bg-purple-200 px-2 py-2 font-bold"
                  >
                    Pause
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendExtractionCommand("resume");
                    }}
                    size="sm" 
                    className="text-xs bg-green-100 hover:bg-green-200 px-2 py-2 font-bold"
                  >
                    Resume
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendExtractionCommand("sr");
                    }}
                    size="sm" 
                    className="text-xs bg-red-100 hover:bg-red-200 px-2 py-2 font-bold"
                  >
                    Reset
                  </Button>
                </div>

                {/* 밸브 제어 버튼 그리드 */}
                <div className="grid grid-cols-4 gap-2 mb-4">
                  <Button 
                    variant="outline"
                    onClick={() => publishMessage("extwork/valve/input", "1000")}
                    size="sm" 
                    style={getValveButtonStyle("1000")}
                    className="text-xs px-2 py-2 font-medium"
                  >
                    추출순환
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => publishMessage("extwork/valve/input", "0000")}
                    size="sm" 
                    style={getValveButtonStyle("0000")}
                    className="text-xs px-2 py-2 font-medium"
                  >
                    본탱크 수집
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => publishMessage("extwork/valve/input", "0100")}
                    size="sm" 
                    style={getValveButtonStyle("0100")}
                    className="text-xs px-2 py-2 font-medium"
                  >
                    전체 순환
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => publishMessage("extwork/valve/input", "1100")}
                    size="sm" 
                    style={getValveButtonStyle("1100")}
                    className="text-xs px-2 py-2 font-medium"
                  >
                    추출개방
                  </Button>
                </div>
                
                {/* 오른쪽: 펌프 ON/OFF 버튼 - 반응형으로 수정 */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 w-full">
                  {tankData?.tanks?.map((tank) => (
                    <div key={tank.id} className="relative">
                      <Button 
                        variant={tank.pumpStatus === "ON" ? "default" : "outline"}
                        onClick={() => togglePump(tank.id)}
                        size="sm" 
                        className="text-xs px-2 py-2 font-bold w-full"
                      >
                        Pump {tank.id}: {tank.pumpStatus}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              
              <TankSystem 
                tankData={{
                  ...tankData,
                  progressInfo // 본탱크에 표시할 진행 정보를 tankData 내부에 포함
                }}
                onValveChange={changeValveState}
                progressMessages={progressMessages}
                onPumpToggle={togglePump}
                onPumpReset={resetPump}
                onPumpKCommand={sendPumpKCommand}
                pumpStateMessages={
                  // 객체로 안전하게 변환
                  Array.isArray(pumpStateMessages) 
                  ? pumpStateMessages
                      .filter(msg => msg && typeof msg === 'object' && 'id' in msg && 'message' in msg)
                      .reduce((acc, msg) => ({
                        ...acc,
                        [msg.id]: msg.message
                      }), {})
                  : {} // 배열이 아닌 경우 빈 객체 반환
                }
                mqttClient={mqttClient as any}
                kButtonActive={kButtonActive}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cameras" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>카메라 제어</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                {Array.from({ length: 5 }, (_, i) => i + 1).map((camNumber) => (
                  <Card key={`cam-${camNumber}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">카메라 {camNumber}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col items-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="flex items-center space-x-2 text-sm">
                          <Badge variant="secondary">
                            {camStateMessages[camNumber] || '상태 메시지 대기중...'}
                          </Badge>
                        </div>
                        <div className="flex items-center space-x-2 mt-2">
                          <div className="flex items-center space-x-2">
                            <span className={`text-xs ${lightStates[camNumber - 1] === "ON" ? "text-yellow-600" : "text-gray-400"}`}>
                              Flash {lightStates[camNumber - 1]}
                            </span>
                            <Switch 
                              checked={lightStates[camNumber - 1] === "ON"}
                              onCheckedChange={() => toggleLight(camNumber)}
                              className={`${lightStates[camNumber - 1] === "ON" ? "bg-yellow-500" : "bg-gray-300"}`}
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs bg-red-50 hover:bg-red-100"
                            onClick={() => resetCamera(camNumber)}
                          >
                            리셋
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mqtt" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 왼쪽: 시퀀스 설정 */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <span>시퀀스 설정</span>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setSequences([])}
                        className="text-red-500 hover:text-red-700"
                      >
                        전체 초기화
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* 시퀀스 이름 입력 추가 */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-2">시퀀스 이름</label>
                    <div className="flex gap-2">
                      <Input
                        value={currentSequenceName}
                        onChange={(e) => setCurrentSequenceName(e.target.value)}
                        placeholder="시퀀스 이름을 입력하세요"
                      />
                      <Button
                        variant="outline"
                        onClick={saveCurrentSequence}
                        disabled={!currentSequenceName || sequences.length === 0}
                      >
                        저장
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {sequences.map((sequence, seqIndex) => (
                      <div key={seqIndex} className="border rounded p-4">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-sm font-medium">시퀀스 {seqIndex + 1}</h4>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => removeSequence(seqIndex)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </Button>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm text-muted-foreground mb-2">동작 방식</label>
                                <select 
                                  className="w-full border rounded-md"
                                  value={Math.floor(sequence.operation_mode / 10)}
                                  onChange={(e) => {
                                    const firstDigit = Number(e.target.value);
                                    const secondDigit = sequence.operation_mode % 10;
                                    handleModeChange(seqIndex, firstDigit * 10 + secondDigit);
                                  }}
                                >
                                  <option value="1">1 - 동시 모드</option>
                                  <option value="2">2 - 순차 모드</option>
                                  <option value="3">3 - 중첩 모드</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm text-muted-foreground mb-2">순환 방식</label>
                                <select 
                                  className="w-full border rounded-md"
                                  value={sequence.operation_mode % 10}
                                  onChange={(e) => {
                                    const firstDigit = Math.floor(sequence.operation_mode / 10);
                                    const secondDigit = Number(e.target.value);
                                    handleModeChange(seqIndex, firstDigit * 10 + secondDigit);
                                  }}
                                >
                                  <option value="1">1 - 추출 순환</option>
                                  <option value="2">2 - 전체 순환</option>
                                  <option value="3">3 - 본탱크 수집</option>
                                </select>
                              </div>
                            </div>

                            <div className="text-sm bg-slate-50 p-3 rounded-md">
                              <div className="font-medium mb-1">현재 모드: {sequence.operation_mode}</div>
                              <div className="text-muted-foreground">
                                {Math.floor(sequence.operation_mode / 10) === 1 && "동시 모드: 선택된 펌프들이 동시에 작동"}
                                {Math.floor(sequence.operation_mode / 10) === 2 && "순차 모드: 선택된 펌프들이 순차적으로 작동"}
                                {Math.floor(sequence.operation_mode / 10) === 3 && "중첩 모드: 이전 펌프 작동 중에 다음 펌프 작동"}
                                {" + "}
                                {sequence.operation_mode % 10 === 1 && "추출 순환 방식"}
                                {sequence.operation_mode % 10 === 2 && "전체 순환 방식"}
                                {sequence.operation_mode % 10 === 3 && "본탱크 수집 방식"}
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium mb-2">반복 횟수</label>
                            <select 
                              className="w-full p-2 border rounded cursor-pointer bg-white"
                              value={sequence.repeats || 1}
                              onChange={(e) => updateSequence(seqIndex, 'repeats', Number(e.target.value))}
                            >
                              {Array.from({ length: 30 }, (_, i) => i + 1).map(count => (
                                <option key={count} value={count}>
                                  {count}회
                                </option>
                              ))}
                            </select>
                          </div>
                          
                          {/* 동시 모드일 때만 wait_time 입력 필드 표시 */}
                          {Math.floor(sequence.operation_mode / 10) === 1 && (
                            <div>
                              <label className="block text-sm font-medium mb-2">대기 시간 (초)</label>
                            <Input 
                              type="number" 
                                min="0" 
                                value={sequence.wait_time || 5}
                                onChange={(e) => updateSequence(seqIndex, 'wait_time', Number(e.target.value))}
                                placeholder="펌프 간 대기 시간 (초)"
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                동시 모드에서 펌프 간 대기 시간을 설정합니다.
                              </p>
                          </div>
                          )}

                          <div>
                            <label className="block text-sm font-medium mb-2">프로세스 설정</label>
                            <ProcessSettings sequence={sequence} seqIndex={seqIndex} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex justify-between items-center">
              <Button 
                      variant="outline" 
                      size="sm"
                      onClick={addSequence}
                    >
                      시퀀스 추가
                    </Button>
                    
                    <Button 
                      size="sm"
                onClick={() => {
                        // 필요한 필드만 포함하여 새 시퀀스 배열 생성
                        const cleanedSequences = sequences.map(seq => {
                          const cleanedSeq = {
                            operation_mode: seq.operation_mode,
                            repeats: seq.repeats,
                            process: seq.process
                          };
                          
                          // wait_time이 있는 경우에만 추가
                          if (seq.wait_time) {
                            (cleanedSeq as any).wait_time = seq.wait_time;
                          }
                          
                          return cleanedSeq;
                        });
                        
                        // 시퀀스 표준화 적용
                        const standardizedSequences = standardizeSequenceJson(cleanedSequences);
                        
                        const sequence = { sequences: standardizedSequences };
                        const topic = "extwork/extraction/input";
                        const message = JSON.stringify(sequence);
                        
                        if (mqttClient) {
                          try {
                            mqttClient.publish(topic, message);
                            
                            // 발행 기록 추가
                            setProgressMessages(prev => [{
                              timestamp: Date.now(),
                              message: `시퀀스 발행: ${message.substring(0, 100)}...`,
                              rawJson: message
                            }, ...prev]);
                            
                            console.log("발행된 JSON:", message);
                          } catch (error) {
                            console.error("MQTT 발행 오류:", error);
                            alert(`MQTT 발행 중 오류가 발생했습니다: ${error}`);
                          }
                        }
                  }}
                  disabled={sequences.length === 0}
                >
                        현재 시퀀스 발행
                </Button>
            </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>JSON 미리보기</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap text-sm bg-slate-50 p-4 rounded-md h-[300px] overflow-auto">
                    {JSON.stringify({ 
                      sequences: sequences.map(seq => {
                        const cleanedSeq = {
                          operation_mode: seq.operation_mode,
                          repeats: seq.repeats,
                          process: seq.process
                        };
                        
                        if (seq.wait_time) {
                          (cleanedSeq as any).wait_time = seq.wait_time;
                        }
                        
                        return cleanedSeq;
                      })
                    }, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </div>

            {/* 오른쪽: 작업목록 */}
            <div className="space-y-6 md:col-span-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <span>작업목록 (extwork)</span>
                      <Button 
                        variant="outline"
                        size="sm" 
                      onClick={() => setIsEditMode(!isEditMode)}
                      >
                      {isEditMode ? '수정 완료' : '작업 수정'}
                      </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* 수동 동기화 버튼 추가 */}
                    <div className="flex justify-between mb-4">
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const success = await saveSequencesToServer(savedSequences);
                            if (success) {
                              alert(`성공: ${savedSequences.length}개 시퀀스가 서버에 저장되었습니다.`);
                            } else {
                              alert('실패: 서버에 시퀀스를 저장하지 못했습니다.');
                            }
                          } catch (error) {
                            console.error('서버 저장 오류:', error);
                            alert(`오류: 서버 저장 중 문제가 발생했습니다. ${error}`);
                          }
                        }}
                      >
                        저장하기
                      </Button>
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const serverSequences = await loadSequencesFromServer();
                            if (serverSequences && serverSequences.length > 0) {
                              if (confirm(`서버에서 ${serverSequences.length}개 시퀀스를 가져오시겠습니까? 현재 작업 목록은 대체됩니다.`)) {
                                setSavedSequences(serverSequences);
                                saveSequencesToLocalStorage(serverSequences);
                                alert(`성공: ${serverSequences.length}개 시퀀스를 서버에서 가져왔습니다.`);
                              }
                            } else {
                              alert('서버에 저장된 시퀀스가 없거나 가져오기에 실패했습니다.');
                            }
                          } catch (error) {
                            console.error('서버 가져오기 오류:', error);
                            alert(`오류: 서버에서 가져오기 중 문제가 발생했습니다. ${error}`);
                          }
                        }}
                      >
                        가져오기
                      </Button>
                    </div>
                    {getUniqueSequenceNames().length === 0 ? (
                      <div className="text-sm text-gray-500">저장된 시퀀스가 없습니다. 시퀀스를 추가하고 저장하세요.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium">번호</th>
                              <th className="text-left py-2 px-2 font-medium">이름</th>
                              <th className="text-center py-2 px-2 font-medium">횟수</th>
                              <th className="text-right py-2 px-2 font-medium">작업</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getUniqueSequenceNames().map((name, index) => {
                              const sequenceCount = savedSequences.filter(seq => seq.name === name).length;
                              const firstSequence = savedSequences.find(seq => seq.name === name);
                              const modeDescription = firstSequence ? 
                                `${Math.floor(firstSequence.operation_mode / 10) === 1 ? '동시' : 
                                  Math.floor(firstSequence.operation_mode / 10) === 2 ? '순차' : '중첩'} + 
                                 ${firstSequence.operation_mode % 10 === 1 ? '추출순환' : 
                                   firstSequence.operation_mode % 10 === 2 ? '전체순환' : '본탱크수집'}` : '';
                              
                              return (
                                <tr key={name} className={`border-b hover:bg-slate-50 ${isEditMode ? 'bg-blue-50' : ''}`}>
                                  <td className="py-2 px-2">
                                    {isEditMode ? (
                                      <div className="flex flex-col gap-1">
                      <Button 
                                          variant="ghost" 
                        size="sm" 
                                          className="h-6 w-6 p-0"
                                          onClick={() => moveSequence(name, 'up')}
                                          disabled={index === 0}
                      >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                                          </svg>
                      </Button>
                                        <span className="text-center">{index + 1}</span>
                      <Button 
                                          variant="ghost" 
                        size="sm" 
                                          className="h-6 w-6 p-0"
                                          onClick={() => moveSequence(name, 'down')}
                                          disabled={index === getUniqueSequenceNames().length - 1}
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                          </svg>
                      </Button>
                    </div>
                                    ) : (
                                      index + 1
                                    )}
                                  </td>
                                  <td className="py-2 px-2 font-medium">
                                    {editingSequence === name ? (
                                      <Input 
                                        className="h-8 text-sm"
                                        defaultValue={name}
                                        onBlur={(e) => updateSequenceDescription(name, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            updateSequenceDescription(name, e.currentTarget.value);
                                          } else if (e.key === 'Escape') {
                                            setEditingSequence(null);
                                          }
                                        }}
                                        autoFocus
                                      />
                                    ) : (
                  <div>
                                        <span 
                                          className={isEditMode ? "cursor-pointer hover:underline" : ""}
                                          onClick={() => isEditMode && setEditingSequence(name)}
                                        >
                                          {name}
                                        </span>
                                        <div className="text-xs text-gray-500 mt-1">
                                          {modeDescription} <span className="bg-blue-100 text-blue-800 px-1 rounded">시퀀스 {sequenceCount}개</span>
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2 px-2">
                                    <div className="flex items-center justify-center">
                                      <input 
                                        type="number" 
                                        className="w-14 p-1 text-xs border border-gray-300 rounded text-center"
                                        min="1"
                                        max="100"
                                        defaultValue="1"
                                        id={`repeat-${name}`}
                    />
                  </div>
                                  </td>
                                  <td className="py-2 px-2">
                                    <div className="flex justify-end gap-1">
                                      {!isEditMode && (
                                        <>
                                          <Button 
                                            variant="default" 
                                            size="sm"
                                            className={`h-7 px-2 ${workInProgress[name] ? 'bg-red-500 hover:bg-red-600' : processRunning ? 'bg-indigo-500 hover:bg-indigo-600' : ''}`}
                                            onClick={() => {
                                              // 이미 진행 중인 경우 실행하지 않음
                                              if (workInProgress[name]) return;
                                              
                                              const repeatInput = document.getElementById(`repeat-${name}`) as HTMLInputElement;
                                              const repeats = parseInt(repeatInput.value) || 1;
                                              // 반복 횟수 설정 후 실행
                                              const filteredSequences = savedSequences
                                                .filter(seq => seq.name === name)
                                                .map(seq => {
                                                  // 필요한 필드만 포함하여 새 객체 생성
                                                  const cleanedSeq = {
                                                    operation_mode: seq.operation_mode,
                                                    repeats: repeats,
                                                    process: seq.process
                                                  };
                                                  
                                                  // wait_time이 있는 경우에만 추가
                                                  if (seq.wait_time) {
                                                    (cleanedSeq as any).wait_time = seq.wait_time;
                                                  }
                                                  
                                                  return cleanedSeq;
                                                });
                                              
                                              if (filteredSequences.length > 0 && mqttClient) {
                                                // 시퀀스를 MQTT 메시지로 직접 발행
                                                const sequence = { sequences: filteredSequences };
                                                const topic = "extwork/extraction/input";
                                                
                                                // 필드 순서 재정렬 및 process 배열 형식 개선
                                                const formattedSequences = sequence.sequences.map(seq => {
                                                  const firstDigit = Math.floor(seq.operation_mode / 10);
                                                  
                                                  // 기본 객체 구조 (필드 순서 조정)
                                                  const formattedSeq: any = {
                                                    operation_mode: seq.operation_mode,
                                                    repeats: seq.repeats,
                                                    process: [...seq.process]
                                                  };
                                                  
                                                  // 순차 모드가 아닌 경우에만 wait_time 추가
                                                  if (firstDigit !== 2 && (seq as any).wait_time !== undefined) {
                                                    formattedSeq.wait_time = (seq as any).wait_time;
                                                  }
                                                  
                                                  return formattedSeq;
                                                });
                                                
                                                const formattedSequence = { sequences: formattedSequences };
                                                
                                                // 모드별 포맷팅을 위한 JSON 문자열 생성
                                                let message = JSON.stringify(formattedSequence, null, 2);
                                                
                                                // 동시 모드: process 배열을 한 줄로 표시
                                                message = message.replace(/"process": \[\s+([^]*?)\s+\]/g, (match, processContent) => {
                                                  const firstDigit = formattedSequences[0] ? Math.floor(formattedSequences[0].operation_mode / 10) : 0;
                                                  
                                                  if (firstDigit === 1) { // 동시 모드
                                                    // 배열 내용을 한 줄로 압축
                                                    const compactProcess = processContent.replace(/\s+/g, ' ').trim();
                                                    return `"process": [ ${compactProcess} ]`;
                                                  } else if (firstDigit === 2) { // 순차 모드
                                                    // 3개씩 그룹화하여 줄바꿈
                                                    const values = processContent.match(/\d+/g) || [];
                                                    let formattedProcess = '';
                                                    
                                                    for (let i = 0; i < values.length; i += 3) {
                                                      if (i > 0) formattedProcess += ',\n        ';
                                                      const group = values.slice(i, i + 3);
                                                      formattedProcess += group.join(', ');
                                                    }
                                                    
                                                    return `"process": [\n        ${formattedProcess}\n      ]`;
                                                  } else if (firstDigit === 3) { // 중첩 모드
                                                    // 2개씩 그룹화하여 줄바꿈
                                                    const values = processContent.match(/\d+/g) || [];
                                                    let formattedProcess = '';
                                                    
                                                    for (let i = 0; i < values.length; i += 2) {
                                                      if (i > 0) formattedProcess += ',\n        ';
                                                      const group = values.slice(i, i + 2);
                                                      formattedProcess += group.join(', ');
                                                    }
                                                    
                                                    return `"process": [\n        ${formattedProcess}\n      ]`;
                                                  }
                                                  
                                                  return match; // 기본값은 원래 형식 유지
                                                });
                                                
                                                try {
                                                  mqttClient.publish(topic, message);
                                                  
                                                  // 현재 실행 중인 시퀀스 이름 저장
                                                  localStorage.setItem('currentRunningSequence', name);
                                                  
                                                  // 자동화 실행 상태 저장
                                                  localStorage.setItem('process-running-state', JSON.stringify({ running: true }));
                                                  
                                                  // 자동화 제어 메시지 발행 - tank-system 컴포넌트에서 감지
                                                  mqttClient.publish("extwork/automation/control", JSON.stringify({ command: "start" }));
                                                  
                                                  // 실행 로그 남기기
                                                  setProgressMessages(prev => [{
                                                    timestamp: Date.now(),
                                                    message: `시퀀스 '${name}' 실행 (${repeats}회)`,
                                                    rawJson: message
                                                  }, ...prev]);
                                                  
                                                  // 작업 로그 생성 및 저장
                                                  const firstSequence = filteredSequences[0];
                                                  
                                                  // 작업 세부 내용 생성
                                                  const processDetails = filteredSequences.map((seq, index) => {
                                                    // 원본 시퀀스에서 selectedPumps 정보 가져오기
                                                    const originalSeq = savedSequences.find(s => 
                                                      s.name === name && 
                                                      s.operation_mode === seq.operation_mode
                                                    );
                                                    
                                                    const pumpInfo = originalSeq && originalSeq.selectedPumps
                                                      ? originalSeq.selectedPumps
                                                          .map((selected, idx) => selected ? idx + 1 : null)
                                                          .filter(idx => idx !== null)
                                                          .join(', ')
                                                      : '없음';
                                                      
                                                    return `시퀀스 ${index + 1}: 모드 ${seq.operation_mode}, 반복 ${seq.repeats}회, 펌프 ${pumpInfo}`;
                                                  });
                                                  
                                                  // 원본 시퀀스에서 selectedPumps 정보 가져오기
                                                  const originalFirstSeq = savedSequences.find(s => 
                                                    s.name === name && 
                                                    s.operation_mode === firstSequence.operation_mode
                                                  );
                                                  
                                                  const workLog = workLogService.createWorkLog(
                                                    name,
                                                    firstSequence.operation_mode,
                                                    repeats,
                                                    originalFirstSeq ? originalFirstSeq.selectedPumps : undefined
                                                  );
                                                  
                                                  // 작업 세부 내용 추가
                                                  workLog.tags = processDetails;
                                                  
                                                  workLogService.saveWorkLog(workLog).then(() => {
                                                    setCurrentWorkLogId(workLog.id);
                                                    loadWorkLogs(); // 로그 목록 새로고침
                                                  });
                                                  
                                                  console.log("발행된 JSON:", message);
                                                } catch (error) {
                                                  console.error("MQTT 발행 오류:", error);
                                                  alert(`MQTT 발행 중 오류가 발생했습니다: ${error}`);
                                                }
                                              } else {
                                                alert('MQTT 클라이언트가 연결되지 않았거나 시퀀스를 찾을 수 없습니다.');
                                              }
                                            }}
                                          >
                                            {workInProgress[name] ? '진행중' : '진행'}
                                          </Button>
                                          
                                          {/* 예약 버튼 추가 */}
                                          <Button 
                                            variant="outline" 
                                            size="sm"
                                            className="h-7 px-2 ml-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                            onClick={() => setShowScheduleDialog({ name: name, mode: 'configure' })}
                                          >
                                            예약
                                          </Button>
                                        </>
                                      )}
                      <Button 
                                        variant="destructive" 
                        size="sm"
                                        className="h-7 px-2 ml-1"
                                        onClick={() => deleteSavedSequence(name)}
                      >
                                        삭제
                      </Button>
                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        
                        {/* 예약된 작업 목록 표시 */}
                        {scheduledTasks.length > 0 && (
                          <div className="mt-4 border-t pt-3">
                            <div className="flex justify-between items-center mb-2">
                            <h3 className="text-sm font-medium mb-2">예약된 작업 목록</h3>
                              {scheduledTasks.some(task => !task.isStarted) && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="h-7 px-2 text-white bg-green-600 hover:bg-green-700"
                                  onClick={startAllScheduledTasks}
                                >
                                  모든 작업 시작
                                </Button>
                              )}
                            </div>
                            <div className="bg-gray-50 rounded-md p-2">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-200">
                                    <th className="text-left py-1 px-2 font-medium">순서</th>
                                    <th className="text-left py-1 px-2 font-medium">작업</th>
                                    <th className="text-center py-1 px-2 font-medium">대기시간</th>
                                    <th className="text-center py-1 px-2 font-medium">상태</th>
                                    <th className="text-right py-1 px-2 font-medium">작업</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {scheduledTasks
                                    .sort((a, b) => a.orderNumber - b.orderNumber)
                                    .map((task) => {
                                      const remainingTime = task.isRunning 
                                        ? Math.max(0, Math.round((task.scheduledTime - Date.now()) / 1000))
                                        : task.waitTime;
                                      
                                      // 상태에 따른 스타일 클래스 결정
                                      const rowClass = task.isCompleted
                                        ? 'bg-green-50'
                                        : task.isRunning
                                          ? 'bg-blue-50 animate-pulse'
                                          : task.isProcessing
                                            ? 'bg-yellow-50'
                                            : task.isStarted
                                              ? 'bg-gray-100'
                                              : '';
                                      
                                      return (
                                        <tr key={task.id} className={`border-b border-gray-100 ${rowClass}`}>
                                          <td className="py-1 px-2">
                                            {!task.isStarted && (
                                              <div className="flex flex-col items-center">
                                                <Button 
                                                  variant="ghost" 
                                                  size="sm" 
                                                  className="h-5 w-5 p-0 mb-1"
                                                  onClick={() => moveScheduledTask(task.id, 'up')}
                                                  disabled={task.orderNumber === 1}
                                                >
                                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                                                  </svg>
                                                </Button>
                                                <span className="font-bold">{task.orderNumber}</span>
                                                <Button 
                                                  variant="ghost" 
                                                  size="sm" 
                                                  className="h-5 w-5 p-0 mt-1"
                                                  onClick={() => moveScheduledTask(task.id, 'down')}
                                                  disabled={task.orderNumber === scheduledTasks.length}
                                                >
                                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                                  </svg>
                                                </Button>
                                              </div>
                                            )}
                                            {task.isStarted && (
                                              <span className="font-bold">{task.orderNumber}</span>
                                            )}
                                          </td>
                                          <td className="py-1 px-2 font-medium">{task.taskName}</td>
                                          <td className="py-1 px-2 text-center">
                                            <span className="px-1 py-0.5 rounded text-xs">
                                              {formatWaitTime(remainingTime)}
                                            </span>
                                          </td>
                                          <td className="py-1 px-2 text-center">
                                            <span className={`px-1 py-0.5 rounded text-xs font-medium ${
                                              task.isCompleted 
                                                ? 'bg-green-100 text-green-800'
                                                : task.isRunning 
                                                  ? 'bg-blue-100 text-blue-800' 
                                                  : task.isProcessing 
                                                    ? 'bg-yellow-100 text-yellow-800'
                                                    : task.isStarted
                                                      ? 'bg-blue-50 text-blue-600'
                                                      : 'bg-gray-100 text-gray-800'
                                            }`}>
                                              {task.isCompleted 
                                                ? '완료됨' 
                                                : task.isRunning 
                                                  ? `카운트다운: ${formatWaitTime(remainingTime)}` 
                                                  : task.isProcessing 
                                                    ? '다른 작업 완료 대기 중' 
                                                    : task.isStarted
                                                      ? '대기 중'
                                                      : '미시작'}
                                            </span>
                                          </td>
                                          <td className="py-1 px-2 text-right">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                                              onClick={() => cancelScheduledTask(task.id)}
                                              disabled={task.isCompleted}
                                            >
                                              취소
                                            </Button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                    </div>
                    )}
                    
                    {/* 작업 예약 설정 다이얼로그 */}
                    {showScheduleDialog && (
                      <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={() => setShowScheduleDialog(null)}>
                        <div className="bg-white p-4 rounded-lg shadow-lg w-80" onClick={(e) => e.stopPropagation()}>
                          <h3 className="text-lg font-bold mb-4">{showScheduleDialog.name} 예약</h3>
                          <div className="space-y-4">
                            <div>
                              <label className="block text-sm mb-1">대기 시간 (초):</label>
                              <input 
                                type="range" 
                                min="5" 
                                max="3600" 
                                step="5" 
                              value={waitTime}
                                onChange={(e) => setWaitTime(parseInt(e.target.value))}
                                className="w-full"
                              />
                              <div className="flex justify-between text-sm">
                                <span>5초</span>
                                <span className="font-medium">{formatWaitTime(waitTime)}</span>
                                <span>1시간</span>
                          </div>
                            </div>
                            
                            {/* 빠른 시간 선택 버튼 */}
                            <div className="grid grid-cols-5 gap-1">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => setWaitTime(waitTime + 30)}
                              >
                                +30초
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => setWaitTime(waitTime + 60)}
                              >
                                +1분
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => setWaitTime(waitTime + 300)}
                              >
                                +5분
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => setWaitTime(waitTime + 600)}
                              >
                                +10분
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => setWaitTime(waitTime + 1800)}
                              >
                                +30분
                              </Button>
                            </div>
                            
                            <div>
                            <label className="block text-sm mb-1">반복 횟수:</label>
                            <input
                              type="number"
                              className="w-full p-2 border rounded"
                              min="1"
                              max="100"
                              defaultValue="1"
                              id="schedule-repeat-count"
                            />
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowScheduleDialog(null)}
                            >
                              취소
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                const repeatInput = document.getElementById('schedule-repeat-count') as HTMLInputElement;
                                const repeats = parseInt(repeatInput.value) || 1;
                                  scheduleTask(showScheduleDialog.name, waitTime, repeats);
                              }}
                            >
                              예약 추가
                            </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* 작업목록 서버 데이터 삭제 버튼 추가 */}
                    <div className="flex justify-center mt-4">
                      <Button 
                        variant="destructive"
                        size="sm"
                        className="w-1/4 h-8 text-xs"
                        onClick={async () => {
                          try {
                            if (confirm('정말로 서버의 모든 작업목록 데이터를 삭제하시겠습니까?')) {
                              // all=true 파라미터 추가하여 모든 데이터 삭제 요청
                              const response = await fetch('/api/automation/processes?all=true', {
                                method: 'DELETE'
                              });
                              
                              if (response.ok) {
                                const result = await response.json();
                                
                                if (result.success) {
                                  console.log('서버 데이터 삭제 성공:', result);
                                  
                                  // 저장된 프로세스 목록 초기화
                                  setSavedProcesses([]);
                                  
                                  // Redis에서 실제로 데이터가 삭제되었는지 확인하기 위해 즉시 다시 불러오기
                                  try {
                                    const checkResponse = await fetch('/api/automation/processes');
                                    if (checkResponse.ok) {
                                      const checkData = await checkResponse.json();
                                      if (checkData.processes && Array.isArray(checkData.processes)) {
                                        setSavedProcesses(checkData.processes);
                                        if (checkData.processes.length === 0) {
                                          console.log('확인 완료: 모든 데이터가 성공적으로 삭제됨');
                                        } else {
                                          console.warn('일부 데이터가 삭제되지 않았을 수 있음:', checkData.processes.length);
                                        }
                                      }
                                    }
                                  } catch (checkError) {
                                    console.error('삭제 확인 중 오류:', checkError);
                                  }
                                  
                                  toast({
                                    title: "서버 데이터 삭제 완료",
                                    description: `작업목록 서버 데이터가 성공적으로 삭제되었습니다. (${result.deletedCount || 0}개 항목 삭제)`,
                                  });
                                } else {
                                  toast({
                                    title: "서버 데이터 삭제 실패",
                                    description: result.error || "알 수 없는 오류가 발생했습니다.",
                                    variant: "destructive"
                                  });
                                }
                              } else {
                                console.error('서버 데이터 삭제 실패:', await response.text());
                                toast({
                                  title: "서버 데이터 삭제 실패",
                                  description: "서버 데이터 삭제 중 오류가 발생했습니다.",
                                  variant: "destructive"
                                });
                              }
                            }
                          } catch (error) {
                            console.error('서버 데이터 삭제 중 오류:', error);
                            toast({
                              title: "서버 데이터 삭제 오류",
                              description: "네트워크 오류가 발생했습니다.",
                              variant: "destructive"
                            });
                          }
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                          <path d="M3 6h18"></path>
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                        서버 삭제
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="automation" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {isAutomationLocked ? "🔒 자동화 공정 진행 중" : "자동화 공정"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AutomationProcess 
                mqttClient={mqttClient} 
                savedSequences={savedSequences}
                onLockChange={setAutomationLock}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="worklog" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>작업 로그북</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkLogBook 
                workLogs={workLogsData.logs.filter((log, index, self) => 
                  // 중복 ID 필터링 - 같은 ID가 있는 경우 첫 번째 항목만 유지
                  index === self.findIndex(l => l.id === log.id)
                )}
                onClearLogs={clearWorkLogs}
                onRefreshLogs={loadWorkLogs}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
} 

// 타이머 정지 함수
const stopScheduleTimer = () => {
  if (scheduleTimerRef.current) {
    clearInterval(scheduleTimerRef.current);
    scheduleTimerRef.current = null;
  }
};
