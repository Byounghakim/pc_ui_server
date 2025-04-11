import React from 'react';
import { WorkLog } from '../../types';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface WorkLogBookProps {
  workLogs: WorkLog[];
  onClearLogs: () => void;
  onRefreshLogs: () => void;
}

const WorkLogBook: React.FC<WorkLogBookProps> = ({ workLogs, onClearLogs, onRefreshLogs }) => {
  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return format(new Date(dateString), 'yyyy-MM-dd HH:mm:ss', { locale: ko });
  };
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge variant="outline" className="bg-blue-100 text-blue-800">실행 중</Badge>;
      case 'completed':
        return <Badge variant="outline" className="bg-green-100 text-green-800">완료됨</Badge>;
      case 'stopped':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800">중지됨</Badge>;
      case 'error':
        return <Badge variant="outline" className="bg-red-100 text-red-800">오류</Badge>;
      default:
        return <Badge variant="outline">알 수 없음</Badge>;
    }
  };
  
  const getOperationModeName = (mode?: number) => {
    if (mode === undefined) return '알 수 없음';
    switch (mode) {
      case 0: return '일반 모드';
      case 1: return '추출 모드';
      case 2: return '세척 모드';
      default: return `모드 ${mode}`;
    }
  };
  
  const getSelectedPumpsText = (selectedPumps?: boolean[]) => {
    if (!selectedPumps || selectedPumps.length === 0) return '없음';
    
    const selectedIndices = selectedPumps
      .map((selected, index) => selected ? index + 1 : null)
      .filter(index => index !== null);
    
    return selectedIndices.join(', ');
  };
  
  const calculateDuration = (startTime?: string, endTime?: string) => {
    if (!startTime) return '-';
    
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const durationMs = end - start;
    
    const seconds = Math.floor(durationMs / 1000) % 60;
    const minutes = Math.floor(durationMs / (1000 * 60)) % 60;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">작업 로그 ({workLogs.length})</h2>
        <div className="space-x-2">
          <Button variant="outline" onClick={onRefreshLogs}>새로고침</Button>
          <Button variant="destructive" onClick={onClearLogs}>모든 로그 삭제</Button>
        </div>
      </div>
      
      {workLogs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          작업 로그가 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {workLogs.map((log) => (
            <Card key={log.id} className="overflow-hidden">
              <CardHeader className="bg-gray-50 py-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">{log.sequenceName}</CardTitle>
                  {getStatusBadge(log.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-sm font-medium text-gray-500">시작 시간</div>
                      <div>{formatDate(log.startTime)}</div>
                      
                      <div className="text-sm font-medium text-gray-500">종료 시간</div>
                      <div>{formatDate(log.endTime)}</div>
                      
                      <div className="text-sm font-medium text-gray-500">소요 시간</div>
                      <div>{calculateDuration(log.startTime, log.endTime)}</div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-sm font-medium text-gray-500">작업 모드</div>
                      <div>{getOperationModeName(log.operationMode)}</div>
                      
                      <div className="text-sm font-medium text-gray-500">반복 횟수</div>
                      <div>{log.repeats || '-'}</div>
                      
                      <div className="text-sm font-medium text-gray-500">사용 펌프</div>
                      <div>{getSelectedPumpsText(log.selectedPumps)}</div>
                    </div>
                  </div>
                </div>
                
                {log.details && (
                  <div className="mt-4">
                    <div className="text-sm font-medium text-gray-500 mb-1">세부 정보</div>
                    <div className="text-sm bg-gray-50 p-2 rounded">{log.details}</div>
                  </div>
                )}
                
                {log.processDetails && log.processDetails.length > 0 && (
                  <div className="mt-4">
                    <div className="text-sm font-medium text-gray-500 mb-1">작업 과정</div>
                    <div className="text-sm bg-gray-50 p-2 rounded space-y-1">
                      {log.processDetails.map((detail, index) => (
                        <div key={index}>{detail}</div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkLogBook; 