import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis-client';

export async function GET(req: NextRequest) {
  try {
    // Redis 연결 상태 확인
    let redisStatus = 'disconnected';
    try {
      const redis = await getRedisClient();
      
      // Redis 간단한 ping 테스트
      await redis.ping();
      redisStatus = 'healthy';
      
      // 연결 종료
      await redis.quit();
    } catch (error) {
      console.error('Redis 연결 확인 중 오류:', error);
      redisStatus = 'error';
    }

    return NextResponse.json({
      status: 'healthy',
      time: new Date().toISOString(),
      redis: redisStatus,
      environment: process.env.NODE_ENV || 'unknown'
    });
  } catch (error) {
    console.error('상태 확인 API 오류:', error);
    return NextResponse.json({
      status: 'error',
      message: '서버 상태 확인 중 오류가 발생했습니다.'
    }, { status: 500 });
  }
} 