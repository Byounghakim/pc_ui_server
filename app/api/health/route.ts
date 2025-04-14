import { NextRequest, NextResponse } from 'next/server';

// 내부 백엔드 API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3003/api/health';

export async function GET(request: NextRequest) {
  try {
    // 백엔드 API 건강 상태 확인
    let backendStatus = 'error';
    
    try {
      console.log(`백엔드 상태 확인 요청: ${BACKEND_API_URL}`);
      const response = await fetch(BACKEND_API_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(2000), // 2초 타임아웃
      });
      
      if (response.ok) {
        backendStatus = 'healthy';
        console.log('백엔드 서버 상태: 정상');
      } else {
        console.warn(`백엔드 서버 응답 오류: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.warn(`백엔드 서버 상태 확인 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // 현재 환경
    const environment = process.env.NODE_ENV || 'development';
    
    return NextResponse.json({
      status: 'healthy',
      time: new Date().toISOString(),
      backendApi: backendStatus,
      environment
    });
  } catch (error) {
    console.error(`건강 상태 확인 중 오류: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ 
      status: 'error', 
      error: error instanceof Error ? error.message : String(error),
      time: new Date().toISOString()
    }, { status: 500 });
  }
} 