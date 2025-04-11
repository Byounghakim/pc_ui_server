import { NextRequest } from 'next/server';

// 간단한 인증 토큰을 위한 인터페이스
interface AuthToken {
  deviceId: string;
  role: 'admin' | 'user' | 'device';
  issuedAt: number;
  expiresAt: number;
}

// 서버리스 환경에서의 인증 관리
const authService = {
  // 환경 변수에서 API 키 가져오기
  getApiKey: (): string => {
    return process.env.API_SECRET_KEY || 'dev-test-api-key';
  },
  
  // API 키 검증
  validateApiKey: (providedKey: string): boolean => {
    const validKey = authService.getApiKey();
    return providedKey === validKey;
  },
  
  // 토큰 생성 (실제 구현에서는 JWT 사용 권장)
  generateToken: (deviceId: string, role: 'admin' | 'user' | 'device' = 'device'): string => {
    const now = Date.now();
    const token: AuthToken = {
      deviceId,
      role,
      issuedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000 // 30일 유효기간
    };
    
    // 실제 구현에서는 JWT 서명 등 보안 조치 필요
    // 여기서는 간단한 base64 인코딩만 사용
    return Buffer.from(JSON.stringify(token)).toString('base64');
  },
  
  // 토큰 검증
  verifyToken: (token: string): AuthToken | null => {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8')) as AuthToken;
      
      // 만료 확인
      if (Date.now() > decoded.expiresAt) {
        console.log('토큰 만료됨');
        return null;
      }
      
      return decoded;
    } catch (error) {
      console.error('토큰 검증 오류:', error);
      return null;
    }
  },
  
  // 요청에서 인증 정보 추출
  getAuthFromRequest: (req: NextRequest): { deviceId?: string; role?: string; isAuthenticated: boolean } => {
    try {
      // Authorization 헤더에서 토큰 가져오기
      const authHeader = req.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { isAuthenticated: false };
      }
      
      const token = authHeader.slice(7); // 'Bearer ' 제거
      const decoded = authService.verifyToken(token);
      
      if (!decoded) {
        return { isAuthenticated: false };
      }
      
      return {
        deviceId: decoded.deviceId,
        role: decoded.role,
        isAuthenticated: true
      };
    } catch (error) {
      console.error('요청에서 인증 정보 추출 실패:', error);
      return { isAuthenticated: false };
    }
  },
  
  // 장치 ID 검증
  validateDeviceId: (deviceId: string): boolean => {
    // 여기서는 간단한 형식 검사만 수행
    // 실제 구현에서는 등록된 장치 목록과 대조하는 등의 검증 필요
    return deviceId && deviceId.length >= 5 && /^[a-zA-Z0-9\-_]+$/.test(deviceId);
  },
  
  // 권한 확인
  hasPermission: (role: string, requiredRole: 'admin' | 'user' | 'device'): boolean => {
    if (role === 'admin') return true; // 관리자는 모든 권한 있음
    if (role === 'user' && requiredRole !== 'admin') return true; // 사용자는 관리자 권한 제외 가능
    if (role === 'device' && requiredRole === 'device') return true; // 장치는 장치 권한만 가능
    
    return false;
  },
  
  // 인증 요구 미들웨어 로직
  requireAuth: (req: NextRequest): { allowed: boolean; deviceId?: string; error?: string } => {
    const auth = authService.getAuthFromRequest(req);
    
    if (!auth.isAuthenticated) {
      return { 
        allowed: false, 
        error: '인증이 필요합니다.' 
      };
    }
    
    return { 
      allowed: true, 
      deviceId: auth.deviceId 
    };
  },
  
  // 특정 역할 요구 미들웨어 로직
  requireRole: (req: NextRequest, requiredRole: 'admin' | 'user' | 'device'): { allowed: boolean; error?: string } => {
    const auth = authService.getAuthFromRequest(req);
    
    if (!auth.isAuthenticated) {
      return { 
        allowed: false, 
        error: '인증이 필요합니다.' 
      };
    }
    
    if (!authService.hasPermission(auth.role!, requiredRole)) {
      return { 
        allowed: false, 
        error: '권한이 부족합니다.' 
      };
    }
    
    return { allowed: true };
  }
};

export default authService; 