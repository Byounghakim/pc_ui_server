"use client"

import { Suspense, useEffect, useState } from "react"
import dynamic from "next/dynamic"

// 클라이언트 사이드에서만 렌더링되도록 동적 임포트
const DynamicDashboard = dynamic(
  () => import("@/app/components/dashboard"),
  { 
    ssr: false, // 서버 사이드 렌더링 비활성화
    loading: () => <div>로딩 중...</div>
  }
)

export default function MQTTDashboard() {
  // 서버 사이드 렌더링인지 확인하는 상태
  const [isClient, setIsClient] = useState(false)

  // 마운트 시점에 클라이언트 사이드임을 확인
  useEffect(() => {
    setIsClient(true)
  }, [])

  // 클라이언트 사이드에서만 대시보드 렌더링
  return (
    <>
      {isClient ? (
        <Suspense fallback={<div>대시보드 로딩 중...</div>}>
          <DynamicDashboard />
        </Suspense>
      ) : (
        <div>서버에서 렌더링 중... 로딩 중입니다.</div>
      )}
    </>
  )
}

