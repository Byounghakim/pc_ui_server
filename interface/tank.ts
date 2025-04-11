export interface Tank {
  id: number;
  level: number;
  status: "empty" | "filling" | "full";
  pumpStatus: "ON" | "OFF";
  inverter: number;
  connectionType?: "BLE" | "WiFi"; // 연결 타입 추가 (BLE 또는 WiFi)
  startTime?: number; // 펌프 시작 시간 (타임스탬프)
}

export interface TankSystem {
  mainTank: {
    level: number;
    status: string;
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

export interface ConnectionStatus {
  connected: boolean;
  lastConnected: Date | null;
  reconnecting: boolean;
}

export interface ExtractionProgress {
  timestamp: number;
  message: string;
  rawJson?: string | null;
} 