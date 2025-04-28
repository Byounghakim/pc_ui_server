// websocket.js
const WebSocket = require('ws'); // ws 모듈을 가져옵니다.

const wss = new WebSocket.Server({ port: 8443 }); // 웹소켓 서버를 8443 포트에서 실행합니다.

wss.on('connection', (ws) => {
  console.log('Client connected'); // 클라이언트가 연결되면 로그를 출력합니다.

  ws.on('message', (message) => {
    console.log(`Received: ${message}`); // 클라이언트로부터 메시지를 받으면 로그를 출력합니다.
  });

  ws.send('Welcome to the WebSocket server!'); // 클라이언트에게 환영 메시지를 보냅니다.
});

console.log('WebSocket server is running on ws://localhost:8443'); // 서버가 실행 중임을 알리는 로그