import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// 클라이언트 연결을 저장할 맵
// 서버리스 환경에서는 인메모리 저장이 제한적이므로 실제 구현에서는 Redis나 다른 저장소 사용 권장
const clients = new Map<string, ReadableStreamController<Uint8Array>>();

// 메시지 큐 (최근 메시지 캐시)
const messageQueue: { type: string; data: any; timestamp: number }[] = [];
const MAX_QUEUE_SIZE = 100;

// 메시지 브로드캐스트 함수
export async function broadcastMessage(type: string, data: any) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  
  // 메시지 큐에 추가
  messageQueue.push({ type, data, timestamp: Date.now() });
  if (messageQueue.length > MAX_QUEUE_SIZE) {
    messageQueue.shift(); // 가장 오래된 메시지 제거
  }
  
  // 모든 클라이언트에 메시지 전송
  for (const [clientId, controller] of clients.entries()) {
    try {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${message}\n\n`));
    } catch (error) {
      console.error(`클라이언트(${clientId})에 메시지 전송 실패:`, error);
      clients.delete(clientId);
    }
  }
}

// SSE 엔드포인트
export async function GET(req: NextRequest) {
  const clientId = req.headers.get('x-client-id') || crypto.randomUUID();
  
  // 응답 스트림 생성
  const stream = new ReadableStream({
    start(controller) {
      clients.set(clientId, controller);
      
      // 연결 시 최근 메시지 전송 (상태 동기화)
      if (messageQueue.length > 0) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'sync', data: messageQueue })}\n\n`));
      }
      
      // 연결 유지를 위한 주기적 ping
      const pingInterval = setInterval(() => {
        try {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`:ping\n\n`));
        } catch (error) {
          clearInterval(pingInterval);
          clients.delete(clientId);
        }
      }, 30000); // 30초마다 ping
    },
    cancel() {
      clients.delete(clientId);
    }
  });
  
  // SSE 응답 설정
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Client-ID': clientId
    }
  });
}

// 메시지 발행 엔드포인트
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    if (!body.type || !body.data) {
      return NextResponse.json({ error: '잘못된 메시지 형식' }, { status: 400 });
    }
    
    // 메시지 브로드캐스트
    await broadcastMessage(body.type, body.data);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('메시지 발행 오류:', error);
    return NextResponse.json({ error: '메시지 발행 실패' }, { status: 500 });
  }
} 