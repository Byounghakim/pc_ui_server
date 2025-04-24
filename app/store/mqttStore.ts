import mqtt from "mqtt"

interface MQTTState {
  client: mqtt.MqttClient | null
  isConnected: boolean
  connectionError: Error | null
  mqtt_server: string
  mqtt_user: string
  mqtt_password: string
}

export const mqttStore = {
  state: {
    client: null,
    isConnected: false,
    connectionError: null,
    mqtt_server: "ws://203.234.35.54:8080",
    mqtt_user: "dnature",
    mqtt_password: "8210",
  } as MQTTState,

  getters: {
    connectionStatus: (state: MQTTState) => (state.isConnected ? "Connected" : "Disconnected"),
  },

  actions: {
    connect(clientState: MQTTState, setState: (updater: (prev: MQTTState) => MQTTState) => void) {
      // ✅ setState의 타입을 명확하게 지정하여 에러 해결

      // 이미 연결된 클라이언트가 있다면 재사용
      if (clientState.client?.connected) {
        setState((prev) => ({
          ...prev,
          isConnected: true,
        }))
        return
      }

      // 기존 연결이 있다면 정리
      if (clientState.client) {
        clientState.client.end(true)
      }

      const mqttOptions: mqtt.IClientOptions = {
        clientId: `bhkim_${Math.random().toString(16).substring(2, 10)}`,
        username: clientState.mqtt_user,
        password: clientState.mqtt_password,
        protocol: "wss",
        protocolVersion: 4,
        reconnectPeriod: 10000,
        connectTimeout: 60000,
        keepalive: 120,
        rejectUnauthorized: false,
      }

      const client = mqtt.connect(clientState.mqtt_server, mqttOptions)

      // 연결 시도 중임을 표시
      setState((prev) => ({
        ...prev,
        client,
        isConnected: false,
      }))

      client.on("connect", () => {
        console.log("MQTT Connected")
        setState((prev) => ({
          ...prev,
          client,
          isConnected: true,
          connectionError: null,
        }))

        // 토픽 구독
        const topics = ["extwork/process/progress", "extwork/valve/state"]
        topics.forEach((topic) => {
          client.subscribe(topic)
        })
      })

      client.on("reconnect", () => {
        console.log("MQTT Reconnecting...")
        setState((prev) => ({
          ...prev,
          isConnected: false,
        }))
      })

      client.on("error", (err) => {
        console.error("MQTT Error:", err)
        setState((prev) => ({
          ...prev,
          connectionError: err,
          isConnected: false,
        }))
      })

      client.on("close", () => {
        console.warn("MQTT connection closed")
        setState((prev) => ({
          ...prev,
          isConnected: false,
        }))
      })
    },
  },
}
