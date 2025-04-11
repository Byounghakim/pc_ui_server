// "use server"

// import mqtt from "mqtt"; // mqtt 전체를 import

// let client: mqtt.MqttClient | null = null; // MqttClient 타입으로 수정


// export async function connectMQTT() {
//   if (!client) {
//     client = mqtt.connect("wss://api.codingpen.com:8884", {
//       username: "dnature",
//       password: "XihQ2Q%RaS9u#Z3g",
//       protocol: "wss",
//       rejectUnauthorized: false, // 자체 서명된 인증서를 사용하는 경우
//     })

//     client.on("connect", () => {
//       console.log("Connected to MQTT broker")
//     })

//     client.on("error", (err) => {
//       console.error("MQTT error:", err)
//     })
//   }
//   return true
// }

// export async function publishMessage(topic: string, message: string) {
//   if (!client) {
//     await connectMQTT()
//   }

//   client?.publish(topic, message)
//   return true
// }

// export async function subscribeTopic(topic: string) {
//   if (!client) {
//     await connectMQTT()
//   }

//   client?.subscribe(topic)
//   return true
// }

// actions/mqtt.ts


// 주의: MQTT는 클라이언트 사이드 라이브러리이므로 "use server" 제거
import mqtt, { MqttClient } from "mqtt";

let client: MqttClient | null = null;

// 싱글톤 패턴으로 클라이언트 인스턴스 관리
const getClient = () => {
  // 서버 사이드에서 실행 방지
  if (typeof window === "undefined") return null;

  if (!client) {
    client = mqtt.connect("wss://api.codingpen.com:8884", {
      username: "dnature",
      password: "XihQ2Q%RaS9u#Z3g",
      protocol: "wss",
      reconnectPeriod: 10000,
      connectTimeout: 60000,
      keepalive: 120,
      rejectUnauthorized: false,
    });

    // 이벤트 핸들러 등록
    client.on("connect", () => {
      console.log("Connected to MQTT broker");
    });

    client.on("error", (err) => {
      console.error("MQTT error:", err);
      client = null; // 오류 발생 시 재연결을 위해 클라이언트 초기화
    });

    client.on("close", () => {
      console.log("MQTT connection closed");
      client = null;
    });
  }
  return client;
};

// 클라이언트 연결 함수 (CSR 전용)
export async function connectMQTT() {
  try {
    const client = getClient();
    return !!client; // 연결 성공 여부 반환
  } catch (err) {
    console.error("Connection failed:", err);
    return false;
  }
}

// 메시지 발행 함수 (컴포넌트에서 직접 사용)
export async function publishMessage(topic: string, message: string) {
  const client = getClient();
  if (!client) {
    throw new Error("MQTT client not initialized");
  }

  return new Promise((resolve, reject) => {
    client!.publish(topic, message, (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// 토픽 구독 함수 (컴포넌트에서 사용)
export async function subscribeTopic(
  topic: string,
  messageHandler: (payload: string) => void
) {
  const client = getClient();
  if (!client) {
    throw new Error("MQTT client not initialized");
  }

  client.subscribe(topic);
  client.on("message", (receivedTopic, payload) => {
    if (receivedTopic === topic) {
      messageHandler(payload.toString());
    }
  });
}

// 연결 해제 함수 (컴포넌트 unmount 시 사용)
export function disconnectMQTT() {
  if (client) {
    client.end();
    client = null;
  }
}