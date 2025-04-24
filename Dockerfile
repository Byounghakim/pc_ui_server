FROM node:18-alpine

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# 애플리케이션 빌드
RUN npm run build

# 환경 변수 설정
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 애플리케이션 실행
CMD ["npm", "start"] 