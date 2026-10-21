#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include "esp_camera.h"
#include "DHT.h"

// Archivo con los pines de la cámara (debe tener descomentado tu CAMERA_MODEL_...)
#include "board_config.h"

// Credenciales y variables sensibles (ignorado por Git)
#if __has_include("secrets.h")
  #include "secrets.h"
#else
  #include "secrets.example.h"
#endif

// ==========================================
// CONFIGURACIÓN DE MÓDULOS OPCIONALES
// ==========================================
// Cambia a 'true' solo si no usas WebServer en el puerto 80.
#define ENABLE_CAMERA_SERVER false
// Cambia a 'true' solo si tienes un broker MQTT local (Mosquitto) corriendo en tu red
#define ENABLE_LOCAL_MQTT    false
// Envío directo a servidor en la nube Amazon Lightsail
#define ENABLE_LIGHTSAIL_PUSH true
const char *LIGHTSAIL_API_URL = SECRET_LIGHTSAIL_API_URL;
const char *LIGHTSAIL_CAM_URL = SECRET_LIGHTSAIL_CAM_URL;
const char *LIGHTSAIL_API_KEY = SECRET_LIGHTSAIL_API_KEY;
bool uploadPhotoToLightsail(camera_fb_t *fb);
void captureAndUploadToLightsail();

#if ENABLE_CAMERA_SERVER
void startCameraServer();
#endif

// ==========================================
// 1. CREDENCIALES
// ==========================================
const char *WIFI_SSID = SECRET_WIFI_SSID;
const char *WIFI_PASS = SECRET_WIFI_PASS;

const char *UBIDOTS_TOKEN = SECRET_UBIDOTS_TOKEN;
const char *MQTT_SERVER   = "industrial.api.ubidots.com";
const int   MQTT_PORT     = 1883;
const char *DEVICE_LABEL  = "esp32-s3";

// MQTT local para el dashboard (solo si ENABLE_LOCAL_MQTT es true)
const char *LOCAL_MQTT_SERVER = "192.168.1.28"; // IP de tu PC donde corre Mosquitto
const int   LOCAL_MQTT_PORT   = 1883;

const char *TELEGRAM_BOT_TOKEN = SECRET_TELEGRAM_BOT_TOKEN;
const char *TELEGRAM_CHAT_ID   = SECRET_TELEGRAM_CHAT_ID;

// ==========================================
// 2. CONFIGURACIÓN DE SENSORES
// ==========================================
// GPIO 14 libre — GPIO 4 y 5 están ocupados por I2C de la cámara (SIOD/SIOC)
#define DHTPIN 14
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

const int sensorTierraPin = 1; // GPIO 1 (ADC1)
int valorSeco   = 2617;
int valorHumedo = 1200;

// ==========================================
// 3. OBJETOS, TEMPORIZADORES Y CONSTANTES
// ==========================================
WiFiClient espClient;
#if ENABLE_LOCAL_MQTT
WiFiClient espClientLocal;
PubSubClient localMqttClient(espClientLocal);
#endif
PubSubClient mqttClient(espClient);

// Servidor HTTP estándar (puerto 80)
WebServer httpServer(80);

// Últimas lecturas de sensores (compartidas con HTTP API)
volatile float lastTemp     = 0;
volatile float lastHumidity = 0;
volatile int   lastSoilRaw  = 0;
volatile int   lastSoilPct  = 0;

const unsigned long SENSOR_INTERVAL     = 5000;   // Publicar cada 5s (5000 ms)
const unsigned long PHOTO_INTERVAL      = 60000;  // Enviar foto a Telegram cada 60 s (1 min para evitar Rate Limit)
const unsigned long CAM_UPLOAD_INTERVAL = 10000;  // Refrescar foto en la web cada 10 s (10000 ms)
const unsigned long MQTT_RETRY_MS       = 5000;
const uint32_t      MIN_HEAP_TLS        = 50000;  // TLS/HTTPS necesita ~40-50 KB libres

unsigned long lastPublishSensors = 0;
unsigned long lastTelegramPhoto  = 0;
unsigned long lastCamUpload      = 0;
unsigned long lastMqttAttempt    = 0;
unsigned long lastLocalMqttAttempt = 0;

// ==========================================
// 4. SERVIDOR HTTP - ENDPOINTS PARA DASHBOARD
// ==========================================

void handleCORS() {
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.sendHeader("Access-Control-Allow-Methods", "GET");
  httpServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleOptions() {
  handleCORS();
  httpServer.send(204);
}

void handleRoot() {
  handleCORS();
  String html = "<html><body><h1>ESP32-S3 Sensor Dashboard API</h1>";
  html += "<p><a href='/api/sensors'>Sensor Data (JSON)</a></p>";
  html += "<p><a href='/api/capture'>Capture Photo (JPEG)</a></p>";
  html += "<p><a href='/api/stream'>MJPEG Stream</a></p>";
  html += "</body></html>";
  httpServer.send(200, "text/html", html);
}

void handleSensors() {
  handleCORS();
  readSensors();
  char json[256];
  snprintf(json, sizeof(json),
    "{\"temperatura\":%.1f,\"humedad\":%.1f,\"humedad_suelo\":%d,"
    "\"humedad_suelo_raw\":%d,\"heap_libre\":%u,\"uptime\":%lu}",
    lastTemp, lastHumidity, lastSoilPct, lastSoilRaw,
    (unsigned int)ESP.getFreeHeap(), millis() / 1000);
  httpServer.send(200, "application/json", json);
}

void handleCapture() {
  handleCORS();
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    httpServer.send(500, "text/plain", "Error capturando imagen");
    return;
  }
  httpServer.sendHeader("Content-Disposition", "inline; filename=capture.jpg");
  httpServer.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleStream() {
  WiFiClient client = httpServer.client();
  String response = "HTTP/1.1 200 OK\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n";
  response += "Access-Control-Allow-Origin: *\r\n";
  response += "\r\n";
  client.print(response);

  unsigned long streamStart = millis();
  while (client.connected() && millis() - streamStart < 15000) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("⚠️ Stream: error capturando frame");
      break;
    }

    String header = "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " +
                    String(fb->len) + "\r\n\r\n";
    client.print(header);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);

    delay(100); // ~10 FPS
    if (mqttClient.connected()) mqttClient.loop();
    yield();
  }
}

void setupHttpServer() {
  httpServer.on("/", HTTP_GET, handleRoot);
  httpServer.on("/api/sensors", HTTP_GET, handleSensors);
  httpServer.on("/api/sensors", HTTP_OPTIONS, handleOptions);
  httpServer.on("/api/capture", HTTP_GET, handleCapture);
  httpServer.on("/api/capture", HTTP_OPTIONS, handleOptions);
  httpServer.on("/api/stream", HTTP_GET, handleStream);
  httpServer.begin();
  Serial.println("🌐 Servidor HTTP iniciado en puerto 80");
}

// ==========================================
// 5. FUNCIONES AUXILIARES Y DE RED
// ==========================================

void setupWifi() {
  Serial.print("Conectando a Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - start > 30000) {
      Serial.println("\n❌ No se pudo conectar al Wi-Fi. Reiniciando...");
      ESP.restart();
    }
  }
  Serial.println("\n¡Wi-Fi Conectado!");
  Serial.print("📡 IP del ESP32 en la red: http://");
  Serial.println(WiFi.localIP());
  Serial.println("ℹ️ NOTA: El ESP32 corre en esta IP, NO en 'localhost'.");
  Serial.println("   El frontend (localhost:4200) y backend (localhost:3000) corren en tu PC.");
}

void readSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // Sobremuestreo de 10 lecturas para filtrar ruido eléctrico del ADC en ESP32
  long rawSum = 0;
  const int SAMPLES = 10;
  for (int i = 0; i < SAMPLES; i++) {
    rawSum += analogRead(sensorTierraPin);
    delay(4);
  }
  int raw = (int)(rawSum / SAMPLES);
  int soil = constrain(map(raw, valorSeco, valorHumedo, 0, 100), 0, 100);

  if (!isnan(t) && !isnan(h)) {
    lastTemp     = t;
    lastHumidity = h;
  }
  lastSoilRaw = raw;
  lastSoilPct = soil;
}

void publishSensors() {
  readSensors();

  if (isnan(lastTemp) || isnan(lastHumidity)) {
    Serial.println("⚠️ Error leyendo el sensor DHT22");
    return;
  }

  char payload[200];
  snprintf(payload, sizeof(payload),
           "{\"temperatura\":%.1f,\"humedad\":%.1f,\"humedad_suelo\":%d}",
           lastTemp, lastHumidity, lastSoilPct);

  // Publicar en Ubidots
  if (mqttClient.connected()) {
    String topic = String("/v1.6/devices/") + DEVICE_LABEL;
    if (mqttClient.publish(topic.c_str(), payload)) {
      Serial.println(String("📡 Publicado en Ubidots: ") + payload);
    } else {
      Serial.println("❌ Falló la publicación a Ubidots");
    }
  }

  // Publicar en MQTT local para el dashboard (opcional)
#if ENABLE_LOCAL_MQTT
  if (localMqttClient.connected()) {
    if (localMqttClient.publish("esp32/sensors", payload)) {
      Serial.println(String("📡 Publicado en MQTT local: ") + payload);
    }
  }
#endif

  // Publicar directamente en Amazon Lightsail (Push HTTP)
#if ENABLE_LIGHTSAIL_PUSH
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;
    http.begin(client, LIGHTSAIL_API_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Connection", "close");
    if (strlen(LIGHTSAIL_API_KEY) > 0) {
      http.addHeader("X-API-Key", LIGHTSAIL_API_KEY);
    }
    http.setTimeout(4000); // 4 segundos máximo (evita congelar el loop ante pérdidas de red)
    int httpResponseCode = http.POST(payload);
    if (httpResponseCode > 0) {
      Serial.printf("☁️ Publicado en Lightsail (HTTP %d): %s\n", httpResponseCode, payload);
    } else {
      Serial.printf("⚠️ Error al publicar en Lightsail: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
    if (mqttClient.connected()) mqttClient.loop();
  }
#endif
}

void reconnectMQTT() {
  if (mqttClient.connected()) return;
  if (millis() - lastMqttAttempt < MQTT_RETRY_MS) return;
  lastMqttAttempt = millis();

  Serial.print("Conectando a Ubidots via MQTT...");
  String clientId = "ESP32S3-";
  clientId += String((uint32_t)esp_random(), HEX);

  if (mqttClient.connect(clientId.c_str(), UBIDOTS_TOKEN, "")) {
    Serial.println(" ¡Conectado a Ubidots!");
  } else {
    Serial.print(" Falló (código ");
    Serial.print(mqttClient.state());
    Serial.println("). Reintentando en 5s...");
  }
}

void reconnectLocalMQTT() {
#if ENABLE_LOCAL_MQTT
  if (localMqttClient.connected()) return;
  if (millis() - lastLocalMqttAttempt < MQTT_RETRY_MS) return;
  lastLocalMqttAttempt = millis();

  String clientId = "ESP32S3-LOCAL-";
  clientId += String((uint32_t)esp_random(), HEX);

  if (localMqttClient.connect(clientId.c_str())) {
    Serial.println("📡 Conectado a MQTT local");
  }
#endif
}

bool setupCamera() {
  camera_config_t config = {};

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.jpeg_quality = 16; // Optimizado: reduce ~40% el peso de la imagen sin pérdida visible, agilizando la subida
  config.grab_mode    = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;  // 640x480
    config.fb_location  = CAMERA_FB_IN_PSRAM;
    config.fb_count     = 2;
  } else {
    Serial.println("⚠️ PSRAM no detectada. Usando configuración reducida.");
    config.frame_size   = FRAMESIZE_QVGA; // 320x240
    config.fb_location  = CAMERA_FB_IN_DRAM;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("❌ Error al iniciar la cámara: 0x%x\n", err);
    return false;
  }
  Serial.println("✅ Cámara inicializada correctamente.");
  return true;
}

bool sendPhotoToTelegram() {
  if (ESP.getMaxAllocHeap() < 30000) {
    Serial.printf("⚠️ Memoria contigua insuficiente para TLS (%u bytes libres). Omitiendo Telegram...\n", ESP.getMaxAllocHeap());
    return false;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Error al capturar imagen");
    return false;
  }

  // 1. Subir primero a Lightsail (HTTP directo, rápido y no consume memoria TLS)
  uploadPhotoToLightsail(fb);

  // 2. Proceder con el envío seguro a Telegram
  WiFiClientSecure netClientSecure;
  netClientSecure.setInsecure();
  netClientSecure.setTimeout(6000);

  Serial.println("Conectando a la API de Telegram...");
  if (!netClientSecure.connect("api.telegram.org", 443)) {
    Serial.println("❌ Falló la conexión HTTPS con Telegram");
    esp_camera_fb_return(fb);
    return false;
  }

  // Cabecera multipart construida en stack buffer para evitar fragmentación de memoria (heap)
  char head[256];
  int headLen = snprintf(head, sizeof(head),
    "--BoundaryESP32S3\r\n"
    "Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n"
    "%s\r\n"
    "--BoundaryESP32S3\r\n"
    "Content-Disposition: form-data; name=\"photo\"; filename=\"esp32.jpg\"\r\n"
    "Content-Type: image/jpeg\r\n\r\n",
    TELEGRAM_CHAT_ID);

  const char tail[] = "\r\n--BoundaryESP32S3--\r\n";
  const size_t tailLen = sizeof(tail) - 1;

  size_t imageLen = fb->len;
  size_t totalLen = (size_t)headLen + imageLen + tailLen;

  netClientSecure.print("POST /bot");
  netClientSecure.print(TELEGRAM_BOT_TOKEN);
  netClientSecure.println("/sendPhoto HTTP/1.1");
  netClientSecure.println("Host: api.telegram.org");
  netClientSecure.println("Content-Type: multipart/form-data; boundary=BoundaryESP32S3");
  netClientSecure.println("Connection: close");
  netClientSecure.print("Content-Length: ");
  netClientSecure.println(totalLen);
  netClientSecure.println();
  netClientSecure.write((const uint8_t *)head, headLen);

  // Transferencia de datos de imagen en bloques de 1024 bytes
  uint8_t *fbBuf = fb->buf;
  const size_t bufferSize = 1024;
  for (size_t n = 0; n < imageLen; n += bufferSize) {
    size_t chunk = (n + bufferSize < imageLen) ? bufferSize : (imageLen - n);
    netClientSecure.write(fbBuf + n, chunk);
    yield();
  }

  netClientSecure.write((const uint8_t *)tail, tailLen);
  netClientSecure.flush(); // Enviar de inmediato los últimos bytes pendientes

  // Liberar el Frame Buffer inmediatamente para recuperar memoria
  esp_camera_fb_return(fb);

  // Espera de respuesta con timeout de 5 segundos sin concatenación de Strings
  unsigned long startWait = millis();
  while (netClientSecure.connected() && !netClientSecure.available() && millis() - startWait < 5000) {
    delay(40);
    yield();
  }

  // Búsqueda directa en el stream: 0 bytes de asignación en Heap (evita fragmentación de RAM)
  bool ok = netClientSecure.find("\"ok\":true");
  if (ok) {
    Serial.println("📸 Foto enviada con éxito a Telegram");
  } else {
    char errSnippet[128] = {0};
    netClientSecure.readBytes(errSnippet, sizeof(errSnippet) - 1);
    Serial.println("❌ Error en la respuesta de Telegram:");
    if (strlen(errSnippet) > 0) {
      Serial.println(errSnippet);
    } else {
      Serial.println("(Sin respuesta o conexión reseteada por Telegram)");
    }
  }
  netClientSecure.stop();
  return ok;
}

// Subir un frame fotográfico en formato JPEG al servidor en la nube Amazon Lightsail
bool uploadPhotoToLightsail(camera_fb_t *fb) {
#if ENABLE_LIGHTSAIL_PUSH
  if (!fb || WiFi.status() != WL_CONNECTED) return false;

  WiFiClient client;
  HTTPClient http;
  http.begin(client, LIGHTSAIL_CAM_URL);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("Connection", "close");
  if (strlen(LIGHTSAIL_API_KEY) > 0) {
    http.addHeader("X-API-Key", LIGHTSAIL_API_KEY);
  }
  http.setTimeout(7000); // 7 segundos: suficiente para JPEG de ~35KB sin congelar el loop

  int httpResponseCode = http.POST(fb->buf, fb->len);
  bool ok = (httpResponseCode == 200);

  if (ok) {
    Serial.printf("📸 Foto subida a Lightsail (%u bytes, HTTP %d)\n", fb->len, httpResponseCode);
  } else {
    Serial.printf("⚠️ Error subiendo foto a Lightsail: %s (HTTP %d)\n",
                  http.errorToString(httpResponseCode).c_str(), httpResponseCode);
  }
  http.end();
  if (mqttClient.connected()) mqttClient.loop();
  return ok;
#else
  return false;
#endif
}

// Capturar frame independiente para mantener fresco el streaming web de Lightsail
void captureAndUploadToLightsail() {
  if (WiFi.status() != WL_CONNECTED) return;
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("⚠️ Error capturando imagen para Lightsail");
    return;
  }
  uploadPhotoToLightsail(fb);
  esp_camera_fb_return(fb);
}

// ==========================================
// 6. SETUP Y LOOP
// ==========================================
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);

  dht.begin();
  readSensors();

  if (!setupCamera()) {
    Serial.println("Reiniciando en 5s debido a fallo de la cámara");
    delay(5000);
    ESP.restart();
  }

  setupWifi();
  setupHttpServer();

#if ENABLE_CAMERA_SERVER
  startCameraServer();
#endif

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setKeepAlive(60);
  mqttClient.setBufferSize(512);

#if ENABLE_LOCAL_MQTT
  localMqttClient.setServer(LOCAL_MQTT_SERVER, LOCAL_MQTT_PORT);
  localMqttClient.setKeepAlive(60);
  localMqttClient.setBufferSize(512);
#endif

  // Conectar y publicar primera lectura inmediatamente
  reconnectMQTT();
  publishSensors();
}

void loop() {
  static unsigned long wifiLostTime = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiLostTime == 0) {
      wifiLostTime = millis();
      Serial.println("⚠️ Conexión Wi-Fi perdida. Intentando reconectar...");
      WiFi.reconnect();
    } else if (millis() - wifiLostTime > 60000) {
      Serial.println("❌ Tiempo máximo sin Wi-Fi (60s) excedido. Reiniciando ESP32...");
      ESP.restart();
    } else {
      delay(1000);
    }
    return;
  }
  wifiLostTime = 0; // Restablecer contador al recuperar conexión

  httpServer.handleClient();

  reconnectMQTT();
#if ENABLE_LOCAL_MQTT
  reconnectLocalMQTT();
#endif

  if (mqttClient.connected()) {
    mqttClient.loop();
  }
#if ENABLE_LOCAL_MQTT
  if (localMqttClient.connected()) {
    localMqttClient.loop();
  }
#endif

  unsigned long now = millis();

  if (now - lastPublishSensors >= SENSOR_INTERVAL) {
    lastPublishSensors = now;
    publishSensors();
  }

  if (now - lastTelegramPhoto >= PHOTO_INTERVAL) {
    sendPhotoToTelegram();
    lastTelegramPhoto = millis();
    lastCamUpload = millis(); // Sincronizado para no duplicar captura
  } else if (now - lastCamUpload >= CAM_UPLOAD_INTERVAL) {
    captureAndUploadToLightsail();
    lastCamUpload = millis();
  }
}