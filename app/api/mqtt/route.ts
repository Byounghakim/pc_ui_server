import { NextResponse } from "next/server";

// WebSocket 서버를 직접 시작하는 코드 제거
// 서버는 별도의 파일에서 실행해야 합니다

export async function GET() {
  return NextResponse.json({ 
    status: "MQTT API Ready",
    message: "WebSocket 서버를 API 라우트에서 직접 시작하면 안 됩니다. 별도 서비스로 분리해야 합니다."
  });
}

