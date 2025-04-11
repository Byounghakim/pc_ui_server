MQTTTEST/                   # 프로젝트 루트 디렉토리
│── .cursor / rules/        # 커서 및 코드 스타일 관련 설정 (VSCode, 기타 에디터 설정 가능)
│   ├── myrules.mdc         # 사용자 정의 규칙 파일
│
│── .next/                  # Next.js 빌드 출력 폴더 (자동 생성됨, Git에 업로드할 필요 없음)
│
│── app/                    # 애플리케이션의 주요 코드들이 위치
│   ├── actions/            # 액션(비즈니스 로직) 관련 파일 저장 폴더
│   │   ├── mqtt.ts         # MQTT 관련 액션 파일
│   │
│   ├── api/mqtt/           # API 엔드포인트 관련 폴더
│   │   ├── route.ts        # MQTT API 라우트 파일
│   │
│   ├── components/         # UI 컴포넌트 폴더
│   │   ├── tank.tsx        # 특정 UI 컴포넌트 (예: 탱크 관련 UI)
│   │
│   ├── fonts/              # 프로젝트에서 사용되는 폰트 파일 저장 폴더
│   │   ├── GeistMonoVF.woff
│   │   ├── GeistVF.woff
│   │
│   ├── store/              # 상태 관리를 담당하는 폴더 (Redux, Zustand 등)
│   │   ├── mqttStore.ts    # MQTT 상태 관리 파일
│   │
│   ├── utils/              # 유틸리티 함수 저장 폴더
│   │   ├── processMode.ts  # 프로세스 모드 관련 유틸 함수
│
│── favicon.ico             # 프로젝트 파비콘
│── globals.css             # 글로벌 스타일 파일
│── layout.tsx              # 전체 레이아웃 컴포넌트
│── page.tsx                # 메인 페이지 컴포넌트
│
│── components/ui/          # 공통 UI 컴포넌트 저장 폴더
│   ├── button.tsx          # 버튼 컴포넌트
│   ├── card.tsx            # 카드 UI 컴포넌트
│   ├── input.tsx           # 입력 필드 컴포넌트
│   ├── textarea.tsx        # 텍스트 입력창 컴포넌트
│
│── lib/                    # 라이브러리 또는 유틸리티 모음 폴더
│   ├── utils.ts            # 공용 유틸리티 함수 파일
│
│── node_modules/           # 프로젝트 종속성 (자동 생성됨, Git에 업로드하지 않음)
│
│── server/                 # 서버 관련 코드 (필요 시 추가)
│
│── tests/                  # 테스트 코드 폴더
│   ├── example.test.is     # 예제 테스트 파일
│
│── NOTEPADS/               # 추가적인 참고 파일 저장 폴더
