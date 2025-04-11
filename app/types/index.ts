export interface PumpSequence {
  name?: string;
  operation_mode: number;
  repeats: number;
  process: number[];
  selectedPumps?: boolean[];
  wait_time?: number;
  showRepeatsPopup?: boolean;
  showWaitTimePopup?: boolean;
  individualRepeatsPopups?: Record<number, boolean>;
  individualRepeats?: Record<number, number>;
}

// 작업 목록의 각 단계를 정의하는 인터페이스
export interface SequenceStep {
  valveMode: string;       // 밸브 모드 코드
  pumpStatus: string[];    // 각 펌프의 상태 (ON/OFF)
  duration: number;        // 실행 시간(초)
  description?: string;    // 설명
}

// 작업 목록 아이템을 정의하는 인터페이스
export interface WorkTask {
  id: string;              // 고유 ID (UUID)
  name: string;            // 작업 이름
  description?: string;    // 작업 설명
  sequence: SequenceStep[]; // 시퀀스 배열
  createdAt: number;       // 생성 시간 (timestamp)
  updatedAt: number;       // 수정 시간
  isActive: boolean;       // 활성화 상태
  tags?: string[];         // 분류 태그 (선택)
  author?: string;         // 작성자 (선택)
}

export interface Tank {
  id: number;
  level: number;
  status: "empty" | "filling" | "full";
  pumpStatus: "ON" | "OFF";
  inverter: number;
}

export interface TankSystemData {
  mainTank: {
    level: number;
    status: "empty" | "filling" | "full";
  };
  tanks: Tank[];
  valveState: string;
  valveStatusMessage?: string;
  valveADesc?: string;
  valveBDesc?: string;
  tankMessages?: Record<number, string>;
  mainTankMessage?: string;
  progressInfo?: {
    step: string;
    elapsedTime: string;
    remainingTime: string;
    totalRemainingTime: string;
  };
}

export interface WorkLog {
  id: string;
  sequenceName: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'error' | 'aborted' | 'warning';
  operationMode?: number;
  repeats?: number;
  selectedPumps?: boolean[];
  taskId?: string;
  deviceId?: string;
  clientIp?: string;
  createdAt?: number;
  executionTime?: number;
  valveState?: Record<string, string>;
  errorDetails?: string;
  details?: string;
  userAgent?: string;
  tags?: string[];
}

// 로그 보관 정책 인터페이스
export interface LogRetentionPolicy {
  maxAgeDays: number;           // 로그 유지 최대 일수
  maxLogsPerDevice: number;     // 장치당 최대 로그 수
  autoCleanupEnabled: boolean;  // 자동 정리 활성화 여부
  retainErrorLogs: boolean;     // 오류 로그 보존 여부
  lastCleanupTime: number;      // 마지막 정리 시간 (타임스탬프)
}

// 시퀀스 실행 상태를 관리하기 위한 인터페이스
export interface SequenceExecutionState {
  name: string;
  status: 'idle' | 'executing' | 'completed' | 'error';
  remainingTime?: number; // 남은 시간(초)
  startTime?: number; // 시작 시간 (타임스탬프)
  totalTime?: number; // 예상 총 소요 시간(초)
}

// 자동화 공정에서 사용할 시퀀스 스텝 정의
export interface AutomationStep {
  sequenceName: string; // 실행할 시퀀스 이름
  repeats: number; // 반복 횟수
  delayBefore: number; // 실행 전 대기 시간(초)
  delayAfter: number; // 실행 후 대기 시간(초)
}

// 자동화 공정 정의
export interface AutomationProcess {
  id: string;
  name: string;
  description?: string;
  steps: AutomationStep[];
  totalRepeats: number; // 전체 공정 반복 횟수
  status: 'idle' | 'executing' | 'paused' | 'completed' | 'error';
  currentStep?: number; // 현재 실행 중인 스텝 인덱스
  currentRepeat?: number; // 현재 반복 횟수
  createdAt: string;
  updatedAt: string;
} 