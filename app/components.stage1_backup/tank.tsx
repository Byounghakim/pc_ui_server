interface TankProps {
  id: number
  fillPercentage: number
  elapsedTime: number
  remainingTime: number
  isActive: boolean
  isCurrentPump: boolean
}

export function Tank({ id, fillPercentage, elapsedTime, remainingTime, isActive, isCurrentPump }: TankProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col items-center gap-2">
        <div
          className={`w-20 h-24 border-4 ${
            isCurrentPump ? "border-red-500" : "border-gray-300"
          } rounded-lg relative overflow-hidden transition-all duration-300`}
          role="progressbar"
          aria-valuenow={fillPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {/* 배경색 */}
          <div
            className={`absolute inset-0 transition-colors duration-300 ${isCurrentPump ? "bg-red-50" : "bg-blue-50"}`}
          />

          {/* 채워지는 부분 */}
          <div
            className={`absolute bottom-0 left-0 right-0 transition-all duration-1000 ease-in-out ${
              isCurrentPump ? "bg-red-200" : "bg-blue-500"
            }`}
            style={{ height: `${fillPercentage}%` }}
          />

          {/* 활성 상태 표시 효과 */}
          {isCurrentPump && <div className="absolute inset-0 bg-red-400/20 animate-pulse" />}
        </div>
        <span className={`text-sm font-medium ${isCurrentPump ? "text-red-500" : ""}`}>Tank {id}</span>
      </div>
      <div className="flex flex-col text-xs space-y-1">
        <div className={`font-medium ${isCurrentPump ? "text-red-600" : isActive ? "text-blue-600" : "text-gray-500"}`}>
          진행 시간: {elapsedTime}s
        </div>
        {isActive && remainingTime > 0 && <div className="text-gray-500">남은 시간: {remainingTime}s</div>}
      </div>
    </div>
  )
}

