export function getProcessMode(processInfo: string): string {
  if (!processInfo || processInfo === "waiting") return "대기중"

  const mode = processInfo.charAt(0)
  switch (mode) {
    case "C":
      return "순차 모드"
    case "S":
      return "동시 모드"
    case "O":
      return "오버랩 모드"
    default:
      return "대기중"
  }
}

