import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import MqttClient from '@/lib/mqtt-client';
import { 
  EXTRACTION_INPUT_TOPIC, 
  EXTRACTION_OUTPUT_TOPIC, 
  PROCESS_PROGRESS_TOPIC,
  AUTOMATION_CONTROL_TOPIC,
  AUTOMATION_STATUS_TOPIC,
  ERROR_TOPIC,
  QUEUE_STATUS_TOPIC
} from '@/lib/mqtt-topics';
import { Checkbox } from "@/app/components/ui/checkbox";
import { X, Play, Square, RotateCcw, ArrowUp, ArrowDown, PlusCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PumpSequence } from '../types/index';
import workLogService from '../services/work-log-service';
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Separator } from "@/app/components/ui/separator";
import { Input } from '@/components/ui/input';
import { v4 as uuidv4 } from 'uuid';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/app/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel, AlertDialogAction } from "@/app/components/ui/alert-dialog";
import { toast } from "@/app/components/ui/use-toast";

// 로컬 스토리지 키
const AUTOMATION_STATE_KEY = 'automation-process-state';
const AUTOMATION_SEQUENCES_KEY = 'automation-process-sequences';

type AutomationStatus = 'waiting' | 'running' | 'paused' | 'stopped' | 'completed' | 'error';
type SequenceStatus = 'waiting' | 'running' | 'completed' | 'error';

// 큐 아이템 인터페이스 정의
interface QueueItem {
  id: string;
  name: string;
  timestamp: number;
  data: any;
}

// 큐 상태 인터페이스 정의
interface QueueStatus {
  isProcessing: boolean;
  count: number;
  items?: QueueItem[];
}

interface SequenceWithStatus {
  id: string;
  sequence: PumpSequence;
  status: SequenceStatus;
  waitTime: number;
  customRepeats: number;
  startTime?: number;
  endTime?: number;
  errorDetails?: string;
  currentRepeatCount?: number; // 현재 반복 횟수 카운트 추가
}

interface SavedProcess {
  id: string;
  name: string;
  description?: string;
  sequences: SequenceWithStatus[];
  createdAt: string;
  updatedAt: string;
}

interface AutomationProcessProps {
  mqttClient: MqttClient | null;
  savedSequences: PumpSequence[];
  onLockChange?: (locked: boolean) => void; // 자동화 공정 잠금 상태 변경 콜백
}

// 시퀀스 JSON 형식 표준화 함수
const standardizeSequenceJson = (sequence: any): any => {
  // operation_mode 보존 플래그: true로 설정하면 시퀀스의 원본 operation_mode가 보존됩니다
  const preserveOriginalMode = true;
  
  // operation_mode 유효성 검사 및 표준화
  let operationMode = sequence.operation_mode;
  
  console.log(`[표준화] 원본 시퀀스 operation_mode: ${operationMode}`);
  
  // 원본 모드를 보존하는 경우
  if (preserveOriginalMode) {
    // 원본 모드 값 유지, 표준화하지 않음
    console.log(`[표준화] 원본 operation_mode 유지: ${operationMode}`);
  } else {
    // 원래의 표준화 로직
    const firstDigit = Math.floor(operationMode / 10);
    const secondDigit = operationMode % 10;
    
    console.log(`[표준화] 분석: 첫째 자리(${firstDigit}), 둘째 자리(${secondDigit})`);
    
    // 첫 번째 자리가 1인 경우 (동시 모드) -> 원래는 12로 표준화했지만 11(동시+추출순환)도 보존
    if (firstDigit === 1) {
      if (secondDigit === 1) {
        // 11(동시+추출순환)인 경우 그대로 유지
        console.log(`[표준화] 동시+추출순환(11) 모드 보존`);
      } else {
        operationMode = 12;
        console.log(`[표준화] 동시 모드를 12로 표준화`);
      }
    } 
    //