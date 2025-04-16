import { PROCESS_PROGRESS_TOPIC, AUTOMATION_STATUS_TOPIC, PROCESS_COMPLETION_TOPIC } from "@/lib/mqtt-topics";

const subscribeTankTopics = () => {
  console.log('탱크 토픽 구독 중...');
  
  for (let i = 1; i <= 6; i++) {
    mqttClient.subscribe(`extwork/inverter${i}/tank${i}_level`);
    
    for (let j = 1; j <= 6; j++) {
      if (i !== j) {
        mqttClient.subscribe(`extwork/inverter${i}/tank${j}_level`);
        console.log(`추가 구독: extwork/inverter${i}/tank${j}_level`);
      }
    }
    
    mqttClient.subscribe(`extwork/inverter${i}/state`);
    mqttClient.subscribe(`extwork/inverter${i}/overallstate`);
  }
  
  mqttClient.subscribe('extwork/tank/level');
  
  mqttClient.subscribe(AUTOMATION_STATUS_TOPIC);
  mqttClient.subscribe(PROCESS_PROGRESS_TOPIC);
  
  mqttClient.subscribe('extwork/extraction/input');
  
  mqttClient.subscribe(PROCESS_COMPLETION_TOPIC);
  
  console.log('Redis를 통해 시스템 상태를 관리합니다.');
};

if (topic === 'extwork/extraction/input') {
  console.log(`추출 입력 명령 수신: ${messageStr}`);
  
  try {
    const jsonData = JSON.parse(messageStr);
    
    const timeStr = formatTimeStr();
    const displayMessage = `새 공정 명령 수신: ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'} (${timeStr})`;
    
    addNotification(`새 공정 명령이 수신되었습니다: ${jsonData.name || jsonData.sequences?.[0]?.name || 'JSON 명령'}`, 'info');
    
    if (setProgressMessages) {
      setProgressMessages([{
        timestamp: Date.now(),
        message: displayMessage,
        rawJson: messageStr
      }]);
      
      localStorage.setItem('lastProgressMessages', JSON.stringify([{
        timestamp: Date.now(),
        message: displayMessage,
        rawJson: messageStr
      }]));
    }
    
    console.log(`추출 명령 처리됨: ${displayMessage}`);
  } catch (parseError) {
    console.error('추출 입력 명령 파싱 오류:', parseError);
    
    addNotification('추출 명령을 수신했지만 처리할 수 없습니다. 형식을 확인해주세요.', 'error');
    
    if (setProgressMessages) {
      setProgressMessages([{
        timestamp: Date.now(),
        message: `오류: 수신된 명령의 JSON 형식이 잘못되었습니다.`,
        rawJson: null
      }]);
      
      localStorage.setItem('lastProgressMessages', JSON.stringify([{
        timestamp: Date.now(),
        message: `오류: 수신된 명령의 JSON 형식이 잘못되었습니다.`,
        rawJson: null
      }]));
    }
  }
  return;
}
else if (topic === PROCESS_COMPLETION_TOPIC) {
  console.log(`공정 완료 메시지 수신: ${messageStr}`);
  
  addNotification('공정이 완료되었습니다.', 'info');
  
  if (setProgressMessages) {
    setProgressMessages([{
      timestamp: Date.now(),
      message: '준비중',
      rawJson: null
    }]);
    
    localStorage.setItem('lastProgressMessages', JSON.stringify([{
      timestamp: Date.now(),
      message: '준비중',
      rawJson: null
    }]));
  }
  
  console.log('공정 완료 처리 완료: 상태를 "준비중"으로 리셋했습니다.');
}

{/* 추가 정보 박스 2 - Loading Process */}
<div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
  <div className="bg-green-50 py-1 px-2 text-xs font-semibold text-green-700 rounded-t-lg border-b border-gray-200">
    Loading Process
  </div>
  <div className="p-3">
    <div className="space-y-2">
      {progressMessages.length > 0 ? (
        <div className="p-2 rounded bg-white border border-gray-100 text-[10px] leading-tight">
          <div className="flex justify-between items-center">
            <span className="font-medium text-green-700">공정 진행 계획 요약</span>
            <span className="text-green-500 font-semibold text-[8px]">{formatTimeStr()}</span>
          </div>
          
          {progressMessages[0].rawJson ? (
            <div className="mt-2 bg-green-50 border border-green-100 rounded p-2 overflow-x-auto">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px]">
                {(() => {
                  try {
                    if (progressMessages[0].rawJson && (
                        progressMessages[0].rawJson.includes("현재 밸브 상태") || 
                        !progressMessages[0].rawJson.trim().startsWith('{'))
                    ) {
                      return (
                        <div className="col-span-2">
                          <span className="font-semibold text-green-700">메시지:</span>{" "}
                          <span className="font-medium">{progressMessages[0].rawJson}</span>
                        </div>
                      );
                    }
                    
                    const jsonData = JSON.parse(progressMessages[0].rawJson);
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
                  } catch (error) {
                    return (
                      <div className="col-span-2 text-red-500">
                        <span className="font-semibold">상태:</span>{" "}
                        <span className="font-medium">{progressMessages[0].message || '준비중'}</span>
                      </div>
                    );
                  }
                })()}
              </div>
            </div>
          ) : (
            <div className="mt-2 bg-green-50 border border-green-100 rounded p-2 overflow-x-auto">
              <div className="text-[9px]">
                <span className="font-semibold text-green-700">상태:</span>{" "}
                <span className="font-medium">{progressMessages[0]?.message || '준비중'}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-2 rounded bg-white border border-gray-100 text-[10px] leading-tight">
          <div className="flex justify-between items-center">
            <span className="font-medium text-green-700">공정 진행 계획 요약</span>
            <span className="text-green-500 font-semibold text-[8px]">{formatTimeStr()}</span>
          </div>
          <div className="mt-2 bg-green-50 border border-green-100 rounded p-2">
            <div className="text-[9px]">
              <span className="font-semibold text-green-700">상태:</span>{" "}
              <span className="font-medium">준비중</span>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
</div> 