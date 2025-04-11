import { NextRequest, NextResponse } from 'next/server';
import { LogRetentionPolicy } from '@/app/types';

// 기본 로그 보관 정책
let retentionPolicy: LogRetentionPolicy = {
  maxAgeDays: 30,
  maxLogsPerDevice: 1000,
  autoCleanupEnabled: true,
  retainErrorLogs: true,
  lastCleanupTime: Date.now()
};

// 로그 보관 정책 조회
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      policy: retentionPolicy
    });
  } catch (error) {
    console.error('로그 보관 정책 조회 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '로그 보관 정책 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 로그 보관 정책 업데이트
export async function POST(request: NextRequest) {
  try {
    const updates = await request.json() as Partial<LogRetentionPolicy>;
    
    // 업데이트할 필드 검증
    if (updates.maxAgeDays !== undefined && (updates.maxAgeDays < 1 || updates.maxAgeDays > 365)) {
      return NextResponse.json(
        { success: false, message: '최대 보관 일수는 1일에서 365일 사이여야 합니다.' },
        { status: 400 }
      );
    }
    
    if (updates.maxLogsPerDevice !== undefined && (updates.maxLogsPerDevice < 10 || updates.maxLogsPerDevice > 10000)) {
      return NextResponse.json(
        { success: false, message: '장치당 최대 로그 수는 10개에서 10000개 사이여야 합니다.' },
        { status: 400 }
      );
    }
    
    // 허용된 필드만 업데이트
    const allowedFields: (keyof LogRetentionPolicy)[] = [
      'maxAgeDays', 
      'maxLogsPerDevice', 
      'autoCleanupEnabled', 
      'retainErrorLogs'
    ];
    
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        (retentionPolicy[field] as any) = updates[field];
      }
    });
    
    // 마지막 업데이트 타임스탬프 설정
    retentionPolicy.lastCleanupTime = Date.now();
    
    return NextResponse.json({
      success: true,
      policy: retentionPolicy
    });
  } catch (error) {
    console.error('로그 보관 정책 업데이트 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '로그 보관 정책 업데이트 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 장치별 로그 보관 정책 설정 (미래 확장용)
export async function PUT(request: NextRequest) {
  try {
    const { deviceId, policy } = await request.json() as {
      deviceId: string;
      policy: Partial<LogRetentionPolicy>;
    };
    
    // 구현 필요한 경우 확장
    // 현재는 글로벌 정책만 지원하므로 동일하게 처리
    
    if (!deviceId) {
      return NextResponse.json(
        { success: false, message: '장치 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 전역 정책과 동일하게 처리
    const updatedPolicy = { ...retentionPolicy };
    
    // 허용된 필드만 업데이트
    const allowedFields: (keyof LogRetentionPolicy)[] = [
      'maxAgeDays', 
      'maxLogsPerDevice', 
      'autoCleanupEnabled', 
      'retainErrorLogs'
    ];
    
    allowedFields.forEach(field => {
      if (policy[field] !== undefined) {
        (updatedPolicy[field] as any) = policy[field];
      }
    });
    
    // 현재는 단일 정책을 사용하므로 모든 장치에 동일한 정책 적용
    retentionPolicy = updatedPolicy;
    
    return NextResponse.json({
      success: true,
      deviceId,
      policy: updatedPolicy
    });
  } catch (error) {
    console.error('장치별 로그 보관 정책 업데이트 중 오류:', error);
    return NextResponse.json(
      { success: false, message: '장치별 로그 보관 정책 업데이트 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 