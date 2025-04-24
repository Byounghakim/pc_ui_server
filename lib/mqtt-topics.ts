/**
 * MQTT 토픽 정의 및 관련 유틸리티
 * 
 * 이 파일은 애플리케이션에서 사용하는 모든 MQTT 토픽을 정의하고,
 * 토픽 처리에 필요한 유틸리티 함수를 제공합니다.
 */

// ========== 토픽 정의 ==========

/**
 * 펌프 명령 토픽 - 펌프 제어 명령을 전송합니다.
 * 메시지 형식: "0" (꺼짐) 또는 "1" (켜짐)
 * 예시: extwork/inverter1/command에 "1"을 발행하면 1번 인버터 펌프가 켜짐
 */
export const PUMP_COMMAND_TOPIC = "extwork/inverter%d/command";

/**
 * 펌프 상태 토픽 - 현재 펌프의 상태를 표시합니다.
 * 메시지 형식: "0" (꺼짐) 또는 "1" (켜짐)
 * 예시: extwork/inverter1/state로부터 "1"을 수신하면 1번 인버터 펌프가 켜져 있음을 의미
 */
export const PUMP_STATE_TOPIC = "extwork/inverter%d/state";

/**
 * 탱크 수위 토픽 - 특정 인버터에 연결된 탱크의 수위를 표시합니다.
 * 메시지 형식: 문자열 ("empty", "filling", "full", "50%" 등)
 * 예시: extwork/inverter1/tank1_level로부터 "50%"를 수신하면 1번 인버터의 1번 탱크가 50% 채워짐을 의미
 */
export const TANK_LEVEL_TOPIC = "extwork/inverter%d/tank%d_level";

/**
 * 펌프 전체 상태 토픽 - 펌프와 연결된 탱크들의 전체적인 상태를 표시합니다.
 * 메시지 형식: 자유 형식 문자열, 주로 상태 설명
 * 예시: "tank1_level: 50%, tank2_level: empty, pump: ON"
 */
export const PUMP_OVERALL_STATE_TOPIC = "extwork/inverter%d/overallstate";

/**
 * 추출 명령 입력 토픽 - 추출 시스템에 명령을 전송합니다.
 * 메시지 형식: 명령어 문자열
 */
export const EXTRACTION_INPUT_TOPIC = "extwork/extraction/input";

/**
 * 추출 결과 출력 토픽 - 추출 시스템의 결과를 출력합니다.
 * 메시지 형식: 결과 데이터 문자열
 */
export const EXTRACTION_OUTPUT_TOPIC = "extwork/extraction/output";

/**
 * 공정 진행 상황 토픽 - 현재 진행 중인 공정의 상태를 표시합니다.
 * 메시지 형식: 진행 상황 텍스트 또는 JSON 문자열
 */
export const PROCESS_PROGRESS_TOPIC = "extwork/extraction/progress";

/**
 * 자동화 공정 제어 토픽 - 자동화 공정 시스템에 제어 명령을 전송합니다.
 * 메시지 형식: JSON 형식의 제어 명령
 * 예시: { "command": "stop" }, { "command": "reset" }
 */
export const AUTOMATION_CONTROL_TOPIC = "extwork/automation/control";

/**
 * 자동화 공정 상태 토픽 - 자동화 공정의 현재 상태를 표시합니다.
 * 메시지 형식: JSON 형식의 상태 정보
 * 예시: { "status": "waiting", "progress": "0%" }
 */
export const AUTOMATION_STATUS_TOPIC = "extwork/automation/status";

/**
 * 오류 토픽 - 시스템에서 발생한 오류를 전송합니다.
 * 메시지 형식: 오류 메시지 텍스트
 */
export const ERROR_TOPIC = "extwork/extraction/error";

/**
 * 밸브 제어 입력 토픽 - 밸브 상태를 제어합니다.
 * 메시지 형식: "1000" (추출 순환), "0100" (전체 순환), "0000" (본탱크 수집)
 */
export const VALVE_INPUT_TOPIC = "extwork/valve/input";

/**
 * 밸브 상태 토픽 - 현재 밸브의 상태를 표시합니다.
 * 메시지 형식: "1000" (추출 순환), "0100" (전체 순환), "0000" (본탱크 수집)
 */
export const VALVE_STATE_TOPIC = "extwork/valve/state";

/**
 * 큐 상태 토픽 - 추출 큐의 상태를 표시합니다.
 * 메시지 형식: 큐 상태 정보 문자열 또는 JSON
 */
export const QUEUE_STATUS_TOPIC = "extwork/extraction/queue/status";

// ========== 토픽 포맷팅 유틸리티 ==========

/**
 * 인버터 ID를 사용하여 펌프 명령 토픽을 생성합니다.
 * @param inverterId 인버터 ID (1-6)
 * @returns 포맷팅된 토픽 문자열
 */
export function getPumpCommandTopic(inverterId: number): string {
  return PUMP_COMMAND_TOPIC.replace("%d", inverterId.toString());
}

/**
 * 인버터 ID를 사용하여 펌프 상태 토픽을 생성합니다.
 * @param inverterId 인버터 ID (1-6)
 * @returns 포맷팅된 토픽 문자열
 */
export function getPumpStateTopic(inverterId: number): string {
  return PUMP_STATE_TOPIC.replace("%d", inverterId.toString());
}

/**
 * 인버터 ID와 탱크 ID를 사용하여 탱크 수위 토픽을 생성합니다.
 * @param inverterId 인버터 ID (1-6)
 * @param tankId 탱크 ID (1-2, 인버터당 1~2개의 탱크), 기본값 1
 * @returns 포맷팅된 토픽 문자열
 */
export function getTankLevelTopic(inverterId: number, tankId: number = 1): string {
  return TANK_LEVEL_TOPIC
    .replace("%d", inverterId.toString())
    .replace("%d", tankId.toString());
}

/**
 * 인버터 ID를 사용하여 펌프 전체 상태 토픽을 생성합니다.
 * @param inverterId 인버터 ID (1-6)
 * @returns 포맷팅된 토픽 문자열
 */
export function getPumpOverallStateTopic(inverterId: number): string {
  return PUMP_OVERALL_STATE_TOPIC.replace("%d", inverterId.toString());
}

// ========== 메시지 파싱 유틸리티 ==========

/**
 * 탱크 수위 메시지에서 레벨과 상태를 추출합니다.
 * @param message 수신된 메시지 문자열 (예: "50%", "empty", "full", "filling")
 * @returns 파싱된 레벨과 상태 객체
 */
export function parseTankLevelMessage(message: string): { 
  level: number;
  status: "empty" | "filling" | "full"; 
} {
  let level = 50;  // 기본값
  let status: "empty" | "filling" | "full" = "filling";  // 기본값
  
  // 퍼센트 값 파싱
  if (message.includes("%")) {
    const match = message.match(/(\d+)%/);
    if (match) {
      level = parseInt(match[1], 10);
    }
  }
  
  // 상태 결정
  if (message.toLowerCase().includes("full") || message.toLowerCase().includes("가득") || level >= 90) {
    status = "full";
    if (level < 90) level = 100;
  } else if (message.toLowerCase().includes("empty") || message.toLowerCase().includes("비어") || level <= 10) {
    status = "empty";
    if (level > 10) level = 5;
  }
  
  return { level, status };
}

// 밸브 상태 메시지 파싱 (입력: 상태 문자열, 출력: 포맷팅된 객체)
export function parseValveStateMessage(message: string, debug = false): any {
  if (debug) console.log("밸브 상태 메시지 파싱:", message);
  
  try {
    // "현재 밸브 상태" 문자열을 포함하는 경우 특별 처리
    if (message.includes("현재 밸브 상태")) {
      if (debug) console.log("'현재 밸브 상태' 메시지 감지:", message);
      // 밸브 상태 코드만 추출 시도
      const match = message.match(/(\d{4})/);
      if (match && match[1]) {
        return { valveState: match[1], rawMessage: message };
      }
      // 코드를 찾지 못했다면 원본 메시지 반환
      return { message, isTextMessage: true };
    }
  
    // JSON 형식 메시지 파싱
    if (message.trim().startsWith("{") && message.trim().endsWith("}")) {
      const data = JSON.parse(message);
      if (debug) console.log("JSON 형식 메시지 파싱 결과:", data);
      return data;
    }
    
    // 문자열 형식 메시지 파싱 (예: valveA=ON,valveB=OFF)
    else if (message.includes("=")) {
      const parts = message.split(",");
      const result: any = {};
      
      parts.forEach(part => {
        const [key, value] = part.split("=");
        result[key.trim()] = value.trim();
      });
      
      if (debug) console.log("문자열 형식 메시지 파싱 결과:", result);
      return result;
    }
    
    // STATUS 요청 관련 코드 제거 - 이제 STATUS 명령은 사용하지 않음
    
    // 기본 응답
    return { message };
  } catch (error) {
    console.error("밸브 상태 메시지 파싱 오류:", error);
    return { error: "파싱 오류", message };
  }
}

/**
 * 펌프 상태 메시지를 파싱합니다.
 * @param message 펌프 상태 메시지 (예: "0", "1")
 * @returns 파싱된 펌프 상태 ("ON" 또는 "OFF")
 */
export function parsePumpStateMessage(message: string): "ON" | "OFF" {
  return message === "1" ? "ON" : "OFF";
}

// ========== 구독 헬퍼 함수 ==========

/**
 * 모든 필수 토픽을 구독하기 위한 토픽 목록을 반환합니다.
 * @param totalInverters 총 인버터 수 (기본값: 6)
 * @returns 구독할 토픽 배열
 */
export function getAllSubscriptionTopics(totalInverters: number = 6): string[] {
  const topics: string[] = [];
  
  // 인버터/펌프 관련 토픽
  for (let i = 1; i <= totalInverters; i++) {
    topics.push(getPumpCommandTopic(i));
    topics.push(getPumpStateTopic(i));
    topics.push(getPumpOverallStateTopic(i));
    
    // 각 인버터에 대해 탱크 수위 토픽
    // 인버터당 최대 2개의 탱크가 있다고 가정
    for (let j = 1; j <= 2; j++) {
      topics.push(getTankLevelTopic(i, j));
    }
  }
  
  // 밸브 관련 토픽
  topics.push(VALVE_INPUT_TOPIC);
  topics.push(VALVE_STATE_TOPIC);
  
  // 추출 관련 토픽
  topics.push(EXTRACTION_INPUT_TOPIC);
  topics.push(EXTRACTION_OUTPUT_TOPIC);
  topics.push(PROCESS_PROGRESS_TOPIC);
  topics.push(ERROR_TOPIC);
  topics.push(QUEUE_STATUS_TOPIC);
  topics.push(AUTOMATION_CONTROL_TOPIC);
  topics.push(AUTOMATION_STATUS_TOPIC);
  
  return topics;
}

// ========== 인터페이스 정의 ==========

/**
 * 탱크 데이터 인터페이스
 */
export interface Tank {
  id: number;
  level: number;
  status: "empty" | "filling" | "full";
  pumpStatus: "ON" | "OFF";
  inverter: number;
}

/**
 * 전체 탱크 시스템 데이터 인터페이스
 */
export interface TankSystemData {
  mainTank: {
    level: number;
    status: "empty" | "filling" | "full";
  };
  tanks: Tank[];
  valveState: string;
}

// ========== 기본 데이터 ==========

/**
 * 기본 탱크 시스템 데이터를 생성합니다.
 * @param totalTanks 총 탱크 수 (기본값: 6)
 * @returns 기본 탱크 시스템 데이터
 */
export function getDefaultTankSystemData(totalTanks: number = 6): TankSystemData {
  const tanks: Tank[] = [];
  
  for (let i = 1; i <= totalTanks; i++) {
    // 각 인버터가 1개의 탱크를 담당 (1->1, 2->2, 3->3, 4->4, 5->5, 6->6)
    const inverterId = i;
    
    tanks.push({
      id: i,
      level: 0,
      status: "empty",
      pumpStatus: "OFF",
      inverter: inverterId
    });
  }
  
  return {
    mainTank: { 
      level: 0, 
      status: "empty" 
    },
    tanks,
    valveState: "1000"  // 기본값: 추출 순환
  };
}

// ========== MQTT_TOPICS 객체 내보내기 ==========

// MQTT 서버 설정 - 환경별 접속 URL
export const MQTT_SERVERS = {
  // 프로덕션 환경 및 외부 접근용 WebSocket 서버
  PROD: 'ws://203.234.35.54:8080',
  // 로컬 개발 환경 서버 (같은 PC에서 접근)
  DEV_LOCAL: 'ws://127.0.0.1:8080',
  // 내부 네트워크에서 접근
  DEV_LAN: 'ws://192.168.0.26:8080',
  // 개발 환경 WebSocket 서버 (외부 접근)
  DEV_REMOTE: 'ws://203.234.35.54:8080'
};

// MQTT 토픽 상수 정의
export const MQTT_TOPICS = {
  // 장치 상태 관련 토픽
  DEVICE_STATUS: 'extwork/device/status',
  ERROR_TOPIC: 'extwork/device/error',
  
  // 탱크 시스템 토픽
  VALVE_STATE_TOPIC: 'extwork/valve/state',
  MAIN_TANK_LEVEL_TOPIC: 'extwork/tankMain/level',
  
  // 펌프 관련 토픽
  getPumpStateTopic: (pumpId: number) => `extwork/inverter${pumpId}/state`,
  getPumpCommandTopic: (pumpId: number) => `extwork/inverter${pumpId}/command`,
  getPumpKCommandTopic: (pumpId: number) => `extwork/inverter${pumpId}/k_command`,
  getPumpResetTopic: (pumpId: number) => `extwork/inverter${pumpId}/reset`,
  getPumpTankLevelTopic: (inverterId: number, tankId: number) => `extwork/inverter${inverterId}/tank${tankId}_level`,
  
  // 진행 상황 토픽
  PROCESS_PROGRESS: 'extwork/process/progress',
  
  // 추출 관련 토픽
  EXTRACTION_INPUT: 'extwork/extraction/input',
  EXTRACTION_PROGRESS: 'extwork/extraction/progress',
  EXTRACTION_COMPLETE: 'extwork/extraction/complete',
  
  // 알림 관련 토픽
  NOTIFICATION_TOPIC: 'tank-system/notifications',
  
  // 자동화 관련 토픽
  AUTOMATION_STATUS: 'extwork/automation/status',
  AUTOMATION_COMMAND: 'extwork/automation/command',
  
  // 연결 상태 토픽
  CONNECTION_STATE: 'extwork/connection/state',
  
  // 유틸리티 함수들
  parseTankLevelMessage,
  parseValveStateMessage,
  parsePumpStateMessage,
  getAllSubscriptionTopics
}; 

export default MQTT_TOPICS; 