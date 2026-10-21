# 🚀 Plataforma Web Dashboard para ESP32-S3

Dashboard integral desarrollado con **Angular**, **Node.js** y **ESP32-S3** para monitorear sensores ambientales en tiempo real (DHT22 para temperatura/humedad y sensor analógico de humedad de suelo), visualizar la cámara en vivo (streaming MJPEG y capturas) y enviar alertas automáticas y fotos a **Telegram**.

---

## 🏗️ Arquitectura del Sistema

```
                  ┌────────────────────────┐
                  │    ESP32-S3 Board      │
                  │     (Sensores.ino)     │
                  │  IP: 192.168.1.X:80    │
                  └───────────┬────────────┘
                              │
             ┌────────────────┴────────────────┐
             │                                 │
     HTTP API (Puerto 80)            Telegram / Ubidots
     ├── GET /api/sensors            ├── Telegram API (HTTPS :443)
     ├── GET /api/capture            └── Ubidots MQTT (:1883)
     └── GET /api/stream
             │
             └────────────────┬────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Backend Node.js  │
                    │   (Puerto 3000)   │
                    │  Polling & Proxy  │
                    └─────────┬─────────┘
                              │ WebSocket (:3000/ws) + REST
                    ┌─────────▼─────────┐
                    │  Frontend Angular │
                    │   (Puerto 4200)   │
                    │  Interfaz Gráfica │
                    └───────────────────┘
```

> [!IMPORTANT]
> **Diferencia entre `localhost` y la IP del ESP32:**
> * **`localhost`** (127.0.0.1) corre en tu computadora para el backend (:3000) y Angular (:4200).
> * **El ESP32** tiene su propia dirección IP asignada por tu router Wi-Fi (por ejemplo `http://192.168.1.58`). El microcontrolador **no** corre en `localhost`.

---

## 📋 Requisitos Previos

* **Node.js** (v18 o superior) y **npm**.
* **Arduino IDE** configurado con soporte para ESP32 (Espressif).
* Librerías requeridas en Arduino IDE:
  * `DHT sensor library` (Adafruit)
  * `PubSubClient` (Nick O'Leary)
  * `WiFiClientSecure` (incluida en el core ESP32)
  * `esp_camera` (incluida en el core ESP32)

---

## ⚡ Guía de Inicio Rápido

### Paso 1: Configurar y Flashear el ESP32

1. Abre `Sensores.ino` en el **Arduino IDE**.
2. Verifica que las credenciales Wi-Fi coincidan con tu red:
   ```cpp
   const char *WIFI_SSID = "Tu_Red_WiFi";
   const char *WIFI_PASS = "Tu_Password";
   ```
3. Selecciona tu placa (ej: `ESP32S3 Dev Module`), habilita `OPI PSRAM` si tu placa cuenta con PSRAM, y súbelo.
4. Abre el **Monitor Serie** (115200 baudios) y anota la IP asignada, por ejemplo:
   ```text
   ¡Wi-Fi Conectado!
   📡 IP del ESP32 en la red: http://192.168.1.58
   ```

### Paso 2: Iniciar el Proyecto (Método Automático - Recomendado)

En la raíz del proyecto, ejecuta el script `start.sh`:

```bash
./start.sh
```

> [!TIP]
> Si la IP de tu ESP32 cambió, puedes pasarla directamente como parámetro en cualquier formato (el script la sanitiza automáticamente):
> ```bash
> ./start.sh 192.168.1.80
> # o también:
> ./start.sh http://192.168.1.80/
> ```

El script iniciará el backend en el puerto `3000` y el frontend en el puerto `4200`. Para detener ambos servidores, presiona `Ctrl + C`.

### Paso 3: Iniciar Manualmente (Alternativo)

Si prefieres abrir cada servicio en terminales separadas:

1. **Terminal 1 - Backend:**
   ```bash
   cd dashboard
   ESP32_IP=192.168.1.58 npm start
   ```
2. **Terminal 2 - Frontend:**
   ```bash
   cd dashboard-app
   npm start
   ```

### Paso 4: Abrir el Dashboard

Ingresa desde tu navegador a:
👉 **`http://localhost:4200`**

---

## ⏱️ ¿Dónde Modificar los Lapsos de Tiempo (Intervalos)?

Todos los intervalos están expresados en **milisegundos** (`1000 ms = 1 segundo`). Dependiendo de qué parte desees acelerar o ralentizar, modifica los siguientes archivos:

### 1. Frecuencia de actualización del Dashboard Web
* **Archivo:** `dashboard/server.js` (alrededor de la línea 338)
* **Código:**
  ```javascript
  // Modifica el número 3000 por los milisegundos deseados:
  pollingInterval = setInterval(pollESP32, 3000); // 3000 ms = cada 3 segundos
  ```
  * Si deseas lecturas casi instantáneas en pantalla, puedes cambiarlo a `1500` (1.5 segundos).

### 2. Frecuencia de envío de fotos a Telegram
* **Archivo:** `Sensores.ino` (alrededor de la línea 71)
* **Código:**
  ```cpp
  const unsigned long PHOTO_INTERVAL = 60000;  // Enviar foto cada 60 s (1 min)
  ```
  * Para enviar cada **30 segundos**: cámbialo a `30000`.
  * Para enviar cada **10 segundos**: cámbialo a `10000`.

### 3. Frecuencia de publicación a Ubidots / MQTT
* **Archivo:** `Sensores.ino` (alrededor de la línea 70)
* **Código:**
  ```cpp
  const unsigned long SENSOR_INTERVAL = 10000;  // Publicar cada 10 s
  ```
  * Para enviar cada **5 segundos**: cámbialo a `5000`.
  * > [!WARNING]
    > **Límite físico del DHT22:** El sensor DHT22 requiere al menos **2 segundos** entre lecturas para estabilizarse. No fijes `SENSOR_INTERVAL` por debajo de `2000` para evitar lecturas de error (`NaN`).

### 4. Fluidez / FPS del Stream de la Cámara
* **Archivo:** `Sensores.ino` (alrededor de la línea 156 en `handleStream`)
* **Código:**
  ```cpp
  delay(100); // ~10 FPS (100 ms entre cada frame capturado)
  ```
  * Para más fotogramas por segundo (~20 FPS): cámbialo a `delay(50);`.

---

## ✨ Características del Dashboard

| Módulo | Descripción |
|---|---|
| 🌡️ **Temperatura (DHT22)** | Lectura continua en °C con semáforo visual de rangos. |
| 💧 **Humedad (DHT22)** | Porcentaje de humedad relativa del ambiente. |
| 🌱 **Humedad de Suelo** | Lectura analógica calibrada en porcentaje (0% seco a 100% húmedo). |
| 📷 **Cámara ESP32** | Transmisión en vivo MJPEG continua o captura manual bajo demanda. |
| 📊 **Gráficos Históricos** | Curvas evolutivas en tiempo real impulsadas por Chart.js. |
| 🔔 **Alertas Automáticas** | Avisos cuando la temperatura o humedad superan límites críticos. |
| ⚙️ **Panel de Ajustes** | Modificación de umbrales de alerta directamente desde el navegador. |
| 🤖 **Bot de Telegram** | Envío automático de fotos capturadas al chat ID configurado. |
| ☁️ **Soporte Ubidots** | Envío telemétrico MQTT a Ubidots Industrial. |

---

## 🛠️ Diagnóstico y Pruebas Rápidas

* **Probar API directa del ESP32:**
  ```bash
  curl http://192.168.1.58/api/sensors
  ```
* **Probar captura directa de foto:**
  ```bash
  curl http://192.168.1.58/api/capture -o foto.jpg
  ```
* **Verificar estado del backend:**
  ```bash
  curl http://localhost:3000/api/status
  ```

---

## 🔒 Despliegue Seguro en AWS Lightsail (Protección de Ancho de Banda)

Si despliegas este proyecto en una instancia gratuita de **Amazon Lightsail**, sigue estas medidas para evitar agotamiento de cuota de datos (*Egress*) y cargos imprevistos:

### 1. Variables de Entorno de Seguridad en el Servidor
En tu instancia Lightsail (o archivo `.env` / servicio `systemd`), define:
```bash
PORT=3000
CLOUD_MODE=true
API_KEY=tu_clave_secreta_aqui
MAX_STREAM_CLIENTS=3
MAX_STREAM_MINUTES=10
```
Y en tu `secrets.h` local del microcontrolador ESP32:
```cpp
const char *SECRET_LIGHTSAIL_API_KEY = "tu_clave_secreta_aqui";
```

### 2. Configurar Firewall en la Consola de Lightsail
En **Networking** de tu instancia en AWS:
* **Permitir solo:** Puerto `22` (SSH), Puerto `80` (HTTP) y `443` (HTTPS si tienes SSL).
* **Bloquear:** Asegúrate de que los puertos `3000` (Node.js) y `1883` **NO** estén en la lista del firewall público.

### 3. Activar Alarma de Presupuesto en AWS Billing
* Ve a **AWS Billing & Cost Management** ➔ **Budgets**.
* Crea una alerta de presupuesto de **$1.00 USD / mes** con aviso a tu correo electrónico ante cualquier consumo imprevisto de transferencia de red.

### 4. Usar Cloudflare (Plan Gratuito) como Escudo Perimetral
* Apunta tu dominio a Cloudflare con el **Proxy activo (nube naranja)**.
* Cloudflare enmascara la IP de Lightsail, absorbe ataques DDoS y almacena en caché el frontend y las fotos, reduciendo drásticamente la salida de datos de AWS.

