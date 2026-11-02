# 🚀 Plataforma Web Dashboard para ESP32-S3

Dashboard integral desarrollado con **Angular**, **Node.js**, **EMQX** y **ESP32-S3** para monitorear sensores ambientales en tiempo real (DHT22 para temperatura/humedad y sensor analógico de humedad de suelo), visualizar la cámara en vivo (streaming MJPEG y capturas), gestionar telemetría MQTT de alto rendimiento y enviar alertas automáticas y fotos a **Telegram**.

---

## 🏗️ Arquitectura del Sistema

```
                   ┌────────────────────────┐
                   │    ESP32-S3 Board      │
                   │     (Sensores.ino)     │
                   │  IP: 192.168.1.X:80    │
                   └───────────┬────────────┘
                               │
       ┌───────────────────────┼────────────────────────┐
       │ (HTTP Rest :80)       │ (MQTT Pub :1883)       │ (HTTPS :443)
       ▼                       ▼                        ▼
┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  EndPoints   │     │    EMQX Broker    │     │  Telegram API    │
│  HTTP Locales│     │ (Podman / Docker) │     │ (Alertas & Fotos)│
│  /api/sensors│     │  :1883 (TCP MQTT) │     └──────────────────┘
│  /api/capture│     │  :8083 (WS MQTT)  │
│  /api/stream │     │  :18083 (Web UI)  │
└──────────────┘     └─────────┬─────────┘
                               │ (Sub: esp32/sensors)
                     ┌─────────▼─────────┐
                     │  Backend Node.js  │
                     │   (Puerto 3000)   │
                     │ Ingesta, WS, Proxy│
                     └─────────┬─────────┘
                               │ WebSocket (:3000/ws) + REST
                     ┌─────────▼─────────┐
                     │  Frontend Angular │
                     │   (Puerto 4200)   │
                     │  Interfaz Gráfica │
                     └───────────────────┘
```

> [!IMPORTANT]
> **Diferencia entre `127.0.0.1` y la IP del ESP32:**
> * **`127.0.0.1`**: Corre en tu computadora para el backend (:3000), Angular (:4200) y el dashboard de EMQX (:18083).
> * **El ESP32**: Tiene su propia dirección IP asignada por tu router Wi-Fi (por ejemplo `http://192.168.1.58`). El microcontrolador **no** corre en `127.0.0.1`.

---

## 📋 Requisitos Previos

* **Node.js** (v18 o superior) y **npm**.
* **Podman** o **Docker** para ejecutar el broker EMQX.
* **Arduino IDE** con soporte para ESP32 (Espressif v3.x).
* Librerías requeridas en Arduino IDE:
  * `DHT sensor library` (Adafruit)
  * `PubSubClient` (Nick O'Leary)
  * `WiFiClientSecure` y `esp_camera` (incluidas en el core ESP32).

---

## ⚡ Guía de Inicio Rápido

### Paso 1: Levantar el Broker EMQX (MQTT)

El proyecto incluye un script de gestión automatizado compatible tanto con **Podman** (nativo en Fedora) como con **Docker**:

```bash
./emqx.sh start
```

* **Panel de Control Web de EMQX:** [http://127.0.0.1:18083/](http://127.0.0.1:18083/)  
  *(Usuario inicial: `admin`, Clave: `public`)*
* **Consultar estado:** `./emqx.sh status`
* **Ver registros en vivo:** `./emqx.sh logs`
* **Detener el broker:** `./emqx.sh stop`

*(Alternativamente, si tienes `docker-compose` o `podman-compose`, puedes ejecutar `docker compose up -d`).*

---

### Paso 2: Configurar y Flashear el ESP32

1. Copia la plantilla de credenciales si aún no lo has hecho:
   ```bash
   cp secrets.example.h secrets.h
   ```
2. Abre `Sensores.ino` en el **Arduino IDE** y verifica en `secrets.h` tus credenciales Wi-Fi y tokens.
3. En `Sensores.ino`, confirma que la IP del broker apunte a la IP de tu PC en la red Wi-Fi:
   *(Puedes obtener la IP de tu PC ejecutando `ip -4 route get 1.1.1.1 | awk '{print $7}'`)*
   ```cpp
   #define ENABLE_LOCAL_MQTT true
   const char *LOCAL_MQTT_SERVER = "192.168.1.28"; // IP local de tu PC
   const int   LOCAL_MQTT_PORT   = 1883;
   ```
4. Selecciona tu placa (ej: `ESP32S3 Dev Module`), activa `OPI PSRAM` si aplica, compila y sube el firmware.
5. Abre el **Monitor Serie** (115200 baudios) para verificar la conexión Wi-Fi y la conexión a EMQX (`esp32/sensors`).

---

### Paso 3: Iniciar Backend y Frontend

En la raíz del proyecto, ejecuta el script de arranque global:

```bash
./start.sh
```

> [!TIP]
> Si la IP de tu ESP32 cambió, puedes pasarla como parámetro:
> ```bash
> ./start.sh 192.168.1.80
> ```

El script iniciará el backend en el puerto `3000` y el frontend en el puerto `4200`. Para detener ambos, presiona `Ctrl + C`.

---

### Paso 4: Abrir el Dashboard

Ingresa desde tu navegador a:
👉 **`http://localhost:4200`** (o `http://localhost:3000` si usas el servidor compilado).

*(También puedes escanear el archivo `CodigoQR.jpg` con tu teléfono para acceder rápidamente si estás en la misma red Wi-Fi).*

---

## 📡 Guía Paso a Paso: Uso y Publicación con EMQX (MQTT Local)

### 1. Entendiendo la Arquitectura (Local vs Nube)
* **Broker EMQX Local (`http://127.0.0.1:18083`):** Corre en tu máquina personal. Cuando publicas en este broker, los datos viajan a tu servidor local (`http://localhost:3000` / `4200`).
* **Servidor en la Nube (`http://18.226.105.167/`):** La instancia en Lightsail recibe datos de forma directa mediante **HTTP POST (Push)** desde el ESP32; no está conectada al broker EMQX de tu PC.

### 2. Pasos para Iniciar Ambos Servicios Locales
Para que el dashboard local reciba y grafique los datos de EMQX, **ambos servicios deben estar corriendo simultáneamente**:

1. **Iniciar el Broker EMQX:**
   ```bash
   ./emqx.sh start
   ```
   *(Verifica con `./emqx.sh status` que el contenedor esté corriendo).*
2. **Iniciar el Backend y Frontend del Dashboard:**
   ```bash
   ./start.sh
   ```
   *(O solo el backend unificado: `cd dashboard && npm start`).*

### 3. Pasos para Publicar Datos a EMQX

#### Opción A: Desde el Panel Web de EMQX (Recomendado para pruebas rápidas)
1. Abre en tu navegador: [http://127.0.0.1:18083](http://127.0.0.1:18083) (Usuario: `admin`, Clave: `public`).
2. En el menú lateral izquierdo, haz clic en **Diagnóstico** -> **Cliente WebSocket**.
3. Haz clic en el botón verde **Conectar** (establece conexión al puerto local `8083/mqtt`).
4. En el panel inferior **Publicar**, completa los siguientes campos:
   * **Tema (Topic):** `esp32/sensors`
   * **QoS:** `0`
   * **Carga útil (Payload JSON):**
     ```json
     {"temperatura": 26.3, "humedad": 58.0, "humedad_suelo": 50}
     ```
5. Presiona el botón verde **Publicar**.
6. Abre [http://localhost:3000](http://localhost:3000) o [http://localhost:4200](http://localhost:4200) y verás la tarjeta de sensores y los gráficos actualizarse al instante.

#### Opción B: Desde la Terminal (CLI rápido con Node.js)
Desde la raíz del proyecto, ejecuta una publicación en un solo comando:
```bash
node -e "const mqtt = require('./dashboard/node_modules/mqtt'); const client = mqtt.connect('mqtt://localhost:1883'); client.on('connect', () => { client.publish('esp32/sensors', JSON.stringify({temperatura: 25.4, humedad: 60.1, humedad_suelo: 52}), () => { console.log('✅ Publicado en EMQX'); client.end(); }); });"
```

#### Opción C: Desde el Microcontrolador ESP32
En `Sensores.ino`, asegura:
1. `#define ENABLE_LOCAL_MQTT true`
2. `LOCAL_MQTT_SERVER = "<IP_DE_TU_PC>"` (puerto `1883`).
El ESP32 publicará automáticamente en el tema `esp32/sensors` cada `SENSOR_INTERVAL` (por defecto cada 5 segundos).

---

## 📥 Descarga de Historial de Sensores (.csv)

El dashboard cuenta con un módulo de persistencia continua en disco y descarga filtrada:
* **Ubicación:** En la cabecera de la sección **📊 Historial de Sensores** del dashboard web.
* **Rangos seleccionables:**
  * Últimos 3 meses (90 días) *(por defecto)*
  * Último mes (30 días)
  * Últimos 6 meses (180 días)
  * Último año (365 días)
* **Formato del archivo descargado:**
  Se genera un archivo `.csv` optimizado para Excel, PowerBI o Python sin columnas innecesarias de época (`timestamp`):
  ```csv
  fecha,temperatura,humedad,humedad_suelo
  2026-11-02T17:57:20.184Z,28.7,62.4,70
  ```
* **Endpoint REST directo:**
  ```http
  GET /api/history/download?months=3
  ```

---

## ⏱️ ¿Dónde Modificar los Intervalos y Frecuencias?

Todos los intervalos están expresados en **milisegundos** (`1000 ms = 1 segundo`):

### 1. Frecuencia de publicación MQTT local y Ubidots
* **Archivo:** `Sensores.ino`
* **Código:**
  ```cpp
  const unsigned long SENSOR_INTERVAL = 10000;  // Publicar cada 10 s
  ```
  > [!WARNING]
  > El sensor DHT22 requiere al menos **2 segundos** entre lecturas para estabilizarse. No fijes `SENSOR_INTERVAL` por debajo de `2000`.

### 2. Frecuencia de envío de fotos a Telegram
* **Archivo:** `Sensores.ino`
* **Código:**
  ```cpp
  const unsigned long PHOTO_INTERVAL = 60000;  // Enviar foto cada 60 s
  ```

### 3. Frecuencia de polling HTTP de respaldo (Fallback)
* **Archivo:** `dashboard/server.js`
* **Código:** Si EMQX no estuviera disponible, Node.js conmuta a HTTP polling cada `3000 ms`.

### 4. Fluidez / FPS del Stream de la Cámara
* **Archivo:** `Sensores.ino` (función `handleStream`)
* **Código:** `delay(100);` (~10 FPS). Cambia a `delay(50);` para ~20 FPS.

---

## ✨ Características del Dashboard

| Módulo | Descripción |
|---|---|
| 📡 **Broker EMQX** | Mensajería MQTT distribuida en tiempo real (`esp32/sensors`) con panel web de métricas. |
| 🌡️ **Temperatura (DHT22)** | Lectura continua en °C con semáforo visual de rangos. |
| 💧 **Humedad (DHT22)** | Porcentaje de humedad relativa del ambiente. |
| 🌱 **Humedad de Suelo** | Lectura analógica calibrada en porcentaje (0% seco a 100% húmedo). |
| 📷 **Cámara ESP32** | Transmisión en vivo MJPEG continua y captura bajo demanda. |
| 📊 **Gráficos Históricos** | Curvas evolutivas en tiempo real impulsadas por Chart.js. |
| 🔔 **Alertas Automáticas** | Avisos cuando los valores superan los límites configurados. |
| ⚙️ **Panel de Ajustes** | Modificación dinámica de umbrales protegidos por API Key. |
| 🤖 **Bot de Telegram** | Envío automático de fotos capturadas al chat ID configurado. |
| ☁️ **Soporte Ubidots** | Envío telemétrico simultáneo a Ubidots Industrial. |

---

## 🛠️ Diagnóstico y Pruebas Rápidas

* **Consultar estado del contenedor EMQX:**
  ```bash
  ./emqx.sh status
  ```
* **Probar API directa del ESP32:**
  ```bash
  curl http://192.168.1.58/api/sensors
  ```
* **Verificar estado del backend:**
  ```bash
  curl http://localhost:3000/api/status
  ```

---

## 🔒 Despliegue Seguro en AWS Lightsail (Protección de Ancho de Banda)

Si despliegas este proyecto en una instancia de **Amazon Lightsail**, sigue estas directivas para evitar consumo imprevisto de datos (*Egress*):

1. **Variables de Entorno en el Servidor (`.env`):**
   ```bash
   PORT=3000
   CLOUD_MODE=true
   API_KEY=tu_clave_secreta_aqui
   MQTT_BROKER=mqtt://localhost:1883
   MAX_STREAM_CLIENTS=3
   MAX_STREAM_MINUTES=10
   ```
2. **Reverse Proxy Seguro con Nginx:**
   Utiliza la configuración optimizada en `nginx.conf`, la cual implementa compresión Gzip, límites de tasa (*rate limiting* de 15 req/s) y timeout forzado para streams huérfanos.
3. **Firewall Perimetral:**
   Permite únicamente puertos `22` (SSH), `80` (HTTP) y `443` (HTTPS). Los puertos `3000`, `1883` y `18083` deben mantenerse inaccesibles al público exterior.
