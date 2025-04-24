/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // serverActions는 기본적으로 활성화되므로 제거
  },
  env: {
    // MQTT 설정
    MQTT_BROKER_URL: process.env.MQTT_BROKER_URL,
    MQTT_USERNAME: process.env.MQTT_USERNAME,
    MQTT_PASSWORD: process.env.MQTT_PASSWORD,
    
    // API 설정
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    
    // MongoDB 설정 (클라이언트에 노출되지 않음)
    // MONGODB_URI: process.env.MONGODB_URI,
    // MONGODB_DB_NAME: process.env.MONGODB_DB_NAME,
  },
  // 정적 내보내기 설정 제거
  // output: 'export',
  // 내보내기 시 API 라우트 무시 설정 제거
  // distDir: '.next',
  // 폰트 최적화 설정
  optimizeFonts: true,
  // 이미지 최적화 활성화 (서버 측 렌더링에서 사용 가능)
  images: {
    domains: ['203.234.35.54'],
  },
  // webpack 설정 추가
  webpack: (config, { isServer }) => {
    // 클라이언트 측에서만 필요한 설정
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        http2: false,
        process: false,
        timers: false,
        'timers/promises': false,
      };
    }
    return config;
  },
  // 빌드 검사 설정
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 페이지를 찾을 수 없을 때 빌드 실패하지 않음
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
}

module.exports = nextConfig 