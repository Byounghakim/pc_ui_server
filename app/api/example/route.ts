import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis-client';

export async function GET(req: NextRequest) {
  try {
    // Redis 클라이언트 가져오기
    const redis = await getRedisClient();
    
    // 테스트 데이터 조회
    const data = await redis.get('test:key');
    
    return NextResponse.json({
      success: true,
      data: data || '데이터가 없습니다',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Redis 조회 중 오류:', error);
    return NextResponse.json({ 
      error: 'Redis 조회 중 오류가 발생했습니다.'
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 요청 데이터 파싱
    const body = await req.json();
    const { key, value } = body;
    
    // 데이터 유효성 검증
    if (!key || !value) {
      return NextResponse.json({ 
        error: 'key와 value는 필수 필드입니다.'
      }, { status: 400 });
    }
    
    // Redis 클라이언트 가져오기
    const redis = await getRedisClient();
    
    // 데이터 저장
    await redis.set(`test:${key}`, value);
    
    return NextResponse.json({
      success: true,
      message: '데이터가 성공적으로 저장되었습니다.',
      key: `test:${key}`,
      value
    });
  } catch (error) {
    console.error('Redis 저장 중 오류:', error);
    return NextResponse.json({ 
      error: 'Redis 저장 중 오류가 발생했습니다.'
    }, { status: 500 });
  }
} 