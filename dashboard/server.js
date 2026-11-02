const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
let ExcelJS = null;
try {
  ExcelJS = require('exceljs');
} catch (err) {
  console.warn('ℹ️ [Aviso] exceljs no está instalado en este entorno. Se utilizará fallback automático sin dependencias.');
}
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const cors = require('cors');

// Cargar archivo .env local si existe (para producción en Lightsail)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
    }
  }
}

// ==========================================
// CONFIGURACIÓN
// ==========================================
const PORT = process.env.PORT || 3000;
const CLOUD_MODE = process.env.CLOUD_MODE === 'true' || process.env.PUSH_MODE === 'true';
const HOST = process.env.HOST || (CLOUD_MODE ? '127.0.0.1' : '0.0.0.0');
const rawEsp32Ip = process.env.ESP32_IP || '192.168.1.58';
const ESP32_IP = rawEsp32Ip.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
const ESP32_PORT = process.env.ESP32_PORT || '80';
const ESP32_BASE_URL = `http://${ESP32_IP}${ESP32_PORT === '80' ? '' : ':' + ESP32_PORT}`;
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const HISTORY_MAX = 500; // Máximo de puntos en el historial
const API_KEY = process.env.API_KEY || ''; // Clave de seguridad para ingesta y configuración
const MAX_STREAM_CLIENTS = parseInt(process.env.MAX_STREAM_CLIENTS, 10) || 4; // Máximo de clientes streaming simultáneos
const MAX_STREAM_DURATION_MS = (parseInt(process.env.MAX_STREAM_MINUTES, 10) || 10) * 60 * 1000; // Duración máx por sesión (10 min)

// ==========================================
// ESTADO
// ==========================================
let sensorHistory = [];
let lastSensorData = null;
let esp32Online = false;
let lastSeenTimestamp = 0;
let alerts = [];
let lastUploadedFrame = null;
let lastUploadedFrameTime = 0;
const activeMjpegClients = new Set();

function touchEsp32() {
  lastSeenTimestamp = Date.now();
  if (!esp32Online) {
    esp32Online = true;
    console.log('📡 ESP32 conectado / detectado en línea');
    broadcastWS({ type: 'status', data: { esp32_online: true } });
  }
}

// Watchdog de inactividad: si el ESP32 no envía datos ni fotos en 25s, marcar OFFLINE
const ESP32_TIMEOUT_MS = 25000;
setInterval(() => {
  if (esp32Online && (Date.now() - lastSeenTimestamp > ESP32_TIMEOUT_MS)) {
    esp32Online = false;
    console.log(`⚠️ ESP32 marcado como OFFLINE por inactividad (> ${ESP32_TIMEOUT_MS / 1000}s sin reportar)`);
    broadcastWS({ type: 'status', data: { esp32_online: false } });
  }
}, 5000);

function broadcastFrameToMjpeg(frame) {
  if (!frame || activeMjpegClients.size === 0) return;
  const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
  for (const clientRes of activeMjpegClients) {
    try {
      clientRes.write(header);
      clientRes.write(frame);
      clientRes.write('\r\n');
    } catch {
      activeMjpegClients.delete(clientRes);
    }
  }
}

// Umbrales de alerta (configurables desde el frontend)
let alertThresholds = {
  temp_max: 35,
  temp_min: 5,
  humidity_max: 90,
  humidity_min: 20,
  soil_min: 20,
};

// ==========================================
// EXPRESS + HTTP SERVER
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Middleware de autenticación para endpoints protegidos
function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return next(); // Si no está configurada, permitir (compatible en desarrollo local)
  }
  const providedKey = req.headers['x-api-key'] || req.query.key || (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));
  if (providedKey === API_KEY) {
    return next();
  }
  return res.status(401).json({ error: 'Acceso no autorizado: API Key inválida o ausente' });
}

// API REST endpoints
app.get('/api/status', (req, res) => {
  res.json({
    esp32_online: esp32Online,
    last_data: lastSensorData,
    history_count: sensorHistory.length,
    alert_count: alerts.filter(a => !a.dismissed).length,
    uptime: process.uptime(),
  });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || HISTORY_MAX;
  const since = req.query.since ? new Date(req.query.since).getTime() : 0;
  const filtered = sensorHistory.filter(d => d.timestamp > since);
  res.json(filtered.slice(-limit));
});

app.get('/api/alerts', (req, res) => {
  res.json(alerts.slice(-100));
});

app.post('/api/alerts/dismiss', (req, res) => {
  const { id } = req.body;
  if (id === 'all') {
    alerts.forEach(a => a.dismissed = true);
  } else {
    const alert = alerts.find(a => a.id === id);
    if (alert) alert.dismissed = true;
  }
  res.json({ ok: true });
});

app.get('/api/thresholds', (req, res) => {
  res.json(alertThresholds);
});

app.post('/api/thresholds', requireApiKey, (req, res) => {
  alertThresholds = { ...alertThresholds, ...req.body };
  broadcastWS({ type: 'thresholds', data: alertThresholds });
  res.json(alertThresholds);
});

// ==========================================
// ENDPOINTS PUSH (INGESTIÓN DESDE ESP32)
// ==========================================

// Ingestión de telemetría de sensores por HTTP POST desde el ESP32
app.post('/api/sensors/data', requireApiKey, (req, res) => {
  const { temperatura, humedad, humedad_suelo } = req.body;
  if (temperatura !== undefined && humedad !== undefined) {
    const data = {
      temperatura: parseFloat(temperatura),
      humedad: parseFloat(humedad),
      humedad_suelo: parseFloat(humedad_suelo !== undefined ? humedad_suelo : 0),
    };
    processSensorData(data);
    return res.json({ ok: true, timestamp: Date.now() });
  }
  res.status(400).json({ error: 'Faltan parámetros requeridos: temperatura y humedad' });
});

// Ingestión de captura JPEG desde el ESP32 (límite reducido a 2 MB por seguridad)
app.post('/api/camera/upload', requireApiKey, express.raw({ type: ['image/jpeg', 'image/png', 'application/octet-stream'], limit: '2mb' }), (req, res) => {
  if (req.body && req.body.length > 0) {
    lastUploadedFrame = req.body;
    lastUploadedFrameTime = Date.now();
    touchEsp32();
    broadcastWS({ type: 'camera_update', timestamp: lastUploadedFrameTime });
    broadcastFrameToMjpeg(lastUploadedFrame);
    console.log(`📸 Nuevo frame de cámara recibido (${req.body.length} bytes)`);
    return res.json({ ok: true, size: req.body.length, timestamp: lastUploadedFrameTime });
  }
  res.status(400).json({ error: 'Buffer de imagen vacío' });
});

// Stream MJPEG generado de forma no bloqueante a partir de capturas individuales
app.get('/api/camera/stream', (req, res) => {
  // Límite estricto de clientes concurrentes para proteger la cuota de transferencia
  if (activeMjpegClients.size >= MAX_STREAM_CLIENTS) {
    return res.status(429).json({
      error: `Límite de streaming alcanzado (${MAX_STREAM_CLIENTS} clientes simultáneos). Cierra otras conexiones para ahorrar ancho de banda.`,
    });
  }

  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'close',
    'Access-Control-Allow-Origin': '*',
  });

  activeMjpegClients.add(res);

  // Desconexión automática tras tiempo máximo continuo (evita pestañas olvidadas)
  const maxDurationTimer = setTimeout(() => {
    activeMjpegClients.delete(res);
    try {
      res.end();
    } catch {}
  }, MAX_STREAM_DURATION_MS);

  // Si estamos en modo Cloud o tenemos frames subidos por push
  if (CLOUD_MODE || (lastUploadedFrame && !rawEsp32Ip.includes('192.168.'))) {
    // Enviar inmediatamente la última foto disponible
    if (lastUploadedFrame) {
      try {
        const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${lastUploadedFrame.length}\r\n\r\n`;
        res.write(header);
        res.write(lastUploadedFrame);
        res.write('\r\n');
      } catch {
        activeMjpegClients.delete(res);
      }
    }

    // Keepalive cada 20 segundos para evitar cortes por inactividad
    const keepaliveTimer = setInterval(() => {
      if (lastUploadedFrame) {
        try {
          const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${lastUploadedFrame.length}\r\n\r\n`;
          res.write(header);
          res.write(lastUploadedFrame);
          res.write('\r\n');
        } catch {
          activeMjpegClients.delete(res);
          clearInterval(keepaliveTimer);
        }
      }
    }, 20000);

    req.on('close', () => {
      clearTimeout(maxDurationTimer);
      activeMjpegClients.delete(res);
      clearInterval(keepaliveTimer);
    });
    return;
  }

  let fetching = false;

  const sendFrame = () => {
    if (!active || fetching) return;
    fetching = true;

    const captureReq = http.get(`${ESP32_BASE_URL}/api/capture`, (captureRes) => {
      if (captureRes.statusCode !== 200) {
        captureRes.resume();
        fetching = false;
        return;
      }

      const chunks = [];
      captureRes.on('data', chunk => chunks.push(chunk));
      captureRes.on('end', () => {
        if (!active) return;
        const buffer = Buffer.concat(chunks);
        const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`;
        try {
          res.write(header);
          res.write(buffer);
          res.write('\r\n');
        } catch {
          active = false;
        }
        fetching = false;
      });
    });

    captureReq.setTimeout(2500, () => {
      captureReq.destroy();
      fetching = false;
    });

    captureReq.on('error', () => {
      fetching = false;
    });
  };

  let active = true;
  // Enviar frame cada 150 ms (~7 FPS fluido sin saturar el microcontrolador)
  const timer = setInterval(sendFrame, 150);
  sendFrame();

  req.on('close', () => {
    active = false;
    clearTimeout(maxDurationTimer);
    activeMjpegClients.delete(res);
    clearInterval(timer);
  });
});

// Proxy de captura de foto (o último frame subido en modo Push)
app.get('/api/camera/capture', (req, res) => {
  if (lastUploadedFrame) {
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': lastUploadedFrame.length,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(lastUploadedFrame);
  }

  // En modo Cloud, si aún no hay frames, devolver 503 sin bloquear el servidor
  if (CLOUD_MODE || !rawEsp32Ip || rawEsp32Ip.includes('192.168.')) {
    return res.status(503).json({
      error: 'Cámara en espera: el ESP32 aún no ha subido la primera foto a la nube.',
    });
  }

  const url = `${ESP32_BASE_URL}/api/capture`;
  http.get(url, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', () => {
    res.status(502).json({ error: 'ESP32 camera not reachable' });
  });
});

// Proxy de datos de sensores directos (HTTP polling fallback)
app.get('/api/sensors/poll', (req, res) => {
  const url = `${ESP32_BASE_URL}/api/sensors`;
  http.get(url, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        processSensorData(data);
        res.json(data);
      } catch {
        res.status(502).json({ error: 'Invalid response from ESP32' });
      }
    });
  }).on('error', () => {
    res.status(502).json({ error: 'ESP32 not reachable' });
  });
});

// ==========================================
// WEBSOCKET SERVER
// ==========================================
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('📱 Cliente WebSocket conectado');

  // Enviar estado inicial
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      last: lastSensorData,
      history: sensorHistory.slice(-100),
      thresholds: alertThresholds,
      alerts: alerts.filter(a => !a.dismissed).slice(-20),
      esp32_online: esp32Online,
    },
  }));

  ws.on('close', () => console.log('📱 Cliente WebSocket desconectado'));
});

function broadcastWS(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(payload);
    }
  });
}

// ==========================================
// PERSISTENCIA HISTÓRICA EN DISCO (CSV)
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const CSV_FILE = path.join(DATA_DIR, 'sensor_history.csv');
if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(CSV_FILE, 'timestamp,fecha,temperatura,humedad,humedad_suelo\n', 'utf-8');
}

// Cargar las últimas lecturas persistidas al iniciar el servidor para no arrancar en blanco
function loadRecentHistory() {
  try {
    if (fs.existsSync(CSV_FILE)) {
      const content = fs.readFileSync(CSV_FILE, 'utf-8');
      const lines = content.trim().split('\n').slice(1); // Omitir cabecera
      const recentLines = lines.slice(-HISTORY_MAX);
      const parsed = recentLines.map(line => {
        const [ts, , temp, hum, soil] = line.split(',');
        return {
          timestamp: parseInt(ts, 10),
          temperatura: parseFloat(temp),
          humedad: parseFloat(hum),
          humedad_suelo: parseInt(soil, 10),
        };
      }).filter(d => !isNaN(d.timestamp));
      if (parsed.length > 0) {
        sensorHistory = parsed;
        lastSensorData = parsed[parsed.length - 1];
        console.log(`📂 Cargadas ${parsed.length} lecturas previas desde ${CSV_FILE}`);
      }
    }
  } catch (err) {
    console.error('⚠️ Error al cargar historial inicial:', err.message);
  }
}
loadRecentHistory();

function appendToCsv(entry) {
  const line = `${entry.timestamp},${new Date(entry.timestamp).toISOString()},${entry.temperatura},${entry.humedad},${entry.humedad_suelo}\n`;
  fs.appendFile(CSV_FILE, line, (err) => {
    if (err) console.error('⚠️ Error al registrar en sensor_history.csv:', err.message);
  });
}

// Formateador de fecha legible para reportes descargables: YYYY-MM-DD / HH:mm:ss
function formatDisplayDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} / ${hours}:${minutes}:${seconds}`;
}

// Descarga estilizada de historial filtrado por tiempo (soporta .xlsx con colores/fuente y .csv)
app.get('/api/history/download', async (req, res) => {
  const months = parseFloat(req.query.months) || 3;
  const days = parseFloat(req.query.days) || (months * 30);
  const cutoffTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);
  const isCsv = req.query.format === 'csv';

  const dateStr = new Date().toISOString().slice(0, 10);
  const extension = isCsv ? 'csv' : 'xlsx';
  const filename = `historial_sensores_${Math.round(days)}dias_${dateStr}.${extension}`;

  if (isCsv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (!fs.existsSync(CSV_FILE)) {
      res.write('Fecha,Temperatura,Humedad,Humedad Suelo\n');
      return res.end();
    }

    const fileStream = fs.createReadStream(CSV_FILE, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (isHeader) {
        res.write('Fecha,Temperatura,Humedad,Humedad Suelo\n');
        isHeader = false;
        return;
      }
      const parts = trimmed.split(',');
      const ts = parseInt(parts[0], 10);
      if (!isNaN(ts) && ts >= cutoffTimestamp) {
        res.write(`${formatDisplayDate(ts)},${parts[2]},${parts[3]},${parts[4]}\n`);
      }
    });

    rl.on('close', () => res.end());
    rl.on('error', (err) => {
      console.error('⚠️ Error al transmitir CSV:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Error al generar CSV' });
      else res.end();
    });

    req.on('close', () => { rl.close(); fileStream.destroy(); });
    return;
  }

  // Generación en formato Excel (.xlsx) con fuente moderna, paleta de colores por columna y bordes
  try {
    if (!ExcelJS) {
      console.warn('⚠️ exceljs no disponible en el servidor: entregando fallback CSV compatible.');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="historial_sensores_${Math.round(days)}dias_${dateStr}.csv"`);
      res.write('Fecha,Temperatura,Humedad,Humedad Suelo\n');
      if (fs.existsSync(CSV_FILE)) {
        const fileStream = fs.createReadStream(CSV_FILE, { encoding: 'utf-8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let isHeader = true;
        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (isHeader) { isHeader = false; continue; }
          const parts = trimmed.split(',');
          const ts = parseInt(parts[0], 10);
          if (!isNaN(ts) && ts >= cutoffTimestamp) {
            res.write(`${formatDisplayDate(ts)},${parts[2]},${parts[3]},${parts[4]}\n`);
          }
        }
      }
      return res.end();
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ESP32 Sensor Dashboard';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Historial de Sensores', {
      views: [{ showGridLines: true }],
    });

    worksheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 26 },
      { header: 'Temperatura (°C)', key: 'temperatura', width: 20 },
      { header: 'Humedad (%)', key: 'humedad', width: 18 },
      { header: 'Humedad Suelo (%)', key: 'humedad_suelo', width: 24 },
    ];

    // Estilos de la cabecera: Títulos con mayúscula, fuente Segoe UI y color temático por columna
    const headerRow = worksheet.getRow(1);
    headerRow.height = 30;
    // Pizarra oscuro (Fecha), Naranja térmico (Temp), Azul agua (Humedad), Verde naturaleza (Suelo)
    const headerColors = ['334155', 'EA580C', '0284C7', '059669'];

    headerRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + headerColors[colNumber - 1] } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });

    const bgColors = ['F8FAFC', 'FFF7ED', 'F0F9FF', 'ECFDF5'];
    const textColors = ['1E293B', '9A3412', '075985', '065F46'];

    if (fs.existsSync(CSV_FILE)) {
      const fileStream = fs.createReadStream(CSV_FILE, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let isHeader = true;
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (isHeader) {
          isHeader = false;
          continue;
        }

        const parts = trimmed.split(',');
        const ts = parseInt(parts[0], 10);
        if (!isNaN(ts) && ts >= cutoffTimestamp) {
          const row = worksheet.addRow([
            formatDisplayDate(ts),
            parseFloat(parts[2]),
            parseFloat(parts[3]),
            parseInt(parts[4], 10),
          ]);
          row.height = 22;
          row.eachCell((cell, colNumber) => {
            cell.font = { name: 'Segoe UI', size: 10.5, color: { argb: 'FF' + textColors[colNumber - 1] } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgColors[colNumber - 1] } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            };
          });
        }
      }
    }

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('⚠️ Error al generar archivo Excel:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar reporte Excel' });
    } else {
      res.end();
    }
  }
});

// ==========================================
// PROCESAMIENTO DE DATOS
// ==========================================
function processSensorData(data) {
  const entry = {
    temperatura: typeof data.temperatura === 'number' ? Number(data.temperatura.toFixed(2)) : data.temperatura,
    humedad: typeof data.humedad === 'number' ? Number(data.humedad.toFixed(2)) : data.humedad,
    humedad_suelo: data.humedad_suelo,
    timestamp: Date.now(),
  };

  lastSensorData = entry;
  sensorHistory.push(entry);
  touchEsp32();
  appendToCsv(entry);

  // Limitar historial en memoria RAM (para visualización en tiempo real)
  if (sensorHistory.length > HISTORY_MAX) {
    sensorHistory = sensorHistory.slice(-HISTORY_MAX);
  }

  // Verificar alertas
  checkAlerts(entry);

  // Enviar a todos los clientes WebSocket
  broadcastWS({ type: 'sensor_data', data: entry });
}

function checkAlerts(data) {
  const now = Date.now();
  const newAlerts = [];

  if (data.temperatura > alertThresholds.temp_max) {
    newAlerts.push(createAlert('temp_high', `🌡️ Temperatura alta: ${data.temperatura}°C (máx: ${alertThresholds.temp_max}°C)`));
  }
  if (data.temperatura < alertThresholds.temp_min) {
    newAlerts.push(createAlert('temp_low', `🥶 Temperatura baja: ${data.temperatura}°C (mín: ${alertThresholds.temp_min}°C)`));
  }
  if (data.humedad > alertThresholds.humidity_max) {
    newAlerts.push(createAlert('hum_high', `💧 Humedad alta: ${data.humedad}% (máx: ${alertThresholds.humidity_max}%)`));
  }
  if (data.humedad < alertThresholds.humidity_min) {
    newAlerts.push(createAlert('hum_low', `🏜️ Humedad baja: ${data.humedad}% (mín: ${alertThresholds.humidity_min}%)`));
  }
  if (data.humedad_suelo < alertThresholds.soil_min) {
    newAlerts.push(createAlert('soil_low', `🌱 Suelo seco: ${data.humedad_suelo}% (mín: ${alertThresholds.soil_min}%)`));
  }

  newAlerts.forEach(alert => {
    // No repetir la misma alerta en menos de 60 segundos
    const recent = alerts.find(a => a.alertType === alert.alertType && (now - a.timestamp) < 60000);
    if (!recent) {
      alerts.push(alert);
      broadcastWS({ type: 'alert', data: alert });
    }
  });

  // Limitar alertas almacenadas
  if (alerts.length > 200) {
    alerts = alerts.slice(-200);
  }
}

let alertIdCounter = 0;
function createAlert(alertType, message) {
  return {
    id: `alert_${++alertIdCounter}`,
    alertType,
    message,
    timestamp: Date.now(),
    dismissed: false,
  };
}

// ==========================================
// MQTT CLIENT (datos del ESP32)
// ==========================================
let mqttClient = null;
let mqttUnreachableLogged = false;

function connectMQTT() {
  if (process.env.DISABLE_MQTT === 'true') {
    console.log('📡 MQTT deshabilitado por variable DISABLE_MQTT.');
    return;
  }

  console.log(`📡 Conectando a MQTT broker: ${MQTT_BROKER}`);
  mqttClient = mqtt.connect(MQTT_BROKER, {
    reconnectPeriod: 15000,
    connectTimeout: 4000,
    clientId: `dashboard-${Date.now()}`,
  });

  mqttClient.on('connect', () => {
    mqttUnreachableLogged = false;
    console.log('✅ Conectado a MQTT broker local');
    mqttClient.subscribe('esp32/sensors', (err) => {
      if (!err) console.log('📡 Suscrito a esp32/sensors');
    });
  });

  mqttClient.on('message', (topic, message) => {
    if (topic === 'esp32/sensors') {
      try {
        const data = JSON.parse(message.toString());
        processSensorData(data);
      } catch (e) {
        console.error('❌ Error parseando mensaje MQTT:', e.message);
      }
    }
  });

  mqttClient.on('error', (err) => {
    if (!mqttUnreachableLogged) {
      console.warn(`ℹ️ Broker MQTT local no encontrado en ${MQTT_BROKER} (${err.code || err.message || 'conexión fallida'}).`);
      console.log('🔄 Modo HTTP Polling activo como respaldo para comunicarse con el ESP32.');
      mqttUnreachableLogged = true;
    }
  });

  mqttClient.on('offline', () => {
    // Si ya notificamos, no hace falta spam
  });
}

// ==========================================
// HTTP POLLING FALLBACK
// ==========================================
// Si no hay MQTT, hacemos polling HTTP al ESP32 cada 3s como fallback
let pollingInterval = null;

function pollESP32() {
  const req = http.get(`${ESP32_BASE_URL}/api/sensors`, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return;
    }
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        processSensorData(data);
      } catch { /* ignorar */ }
    });
  });

  req.setTimeout(3500, () => {
    req.destroy();
    if (esp32Online) {
      esp32Online = false;
      broadcastWS({ type: 'status', data: { esp32_online: false } });
    }
  });

  req.on('error', () => {
    if (esp32Online) {
      esp32Online = false;
      broadcastWS({ type: 'status', data: { esp32_online: false } });
    }
  });
}

function startHTTPPolling() {
  if (CLOUD_MODE) {
    console.log('☁️  Modo Cloud / Push activado: Polling HTTP local desactivado');
    return;
  }
  console.log(`🔄 Iniciando polling HTTP al ESP32 (${ESP32_BASE_URL}) cada 3s como fallback`);
  // Ejecutar inmediatamente al inicio
  pollESP32();
  // Y luego periódicamente cada 3 segundos
  pollingInterval = setInterval(pollESP32, 2000);
}

// ==========================================
// SERVIR FRONTEND ESTÁTICO (PRODUCCIÓN / NUBE)
// ==========================================
const possibleDistPaths = [
  path.join(__dirname, '../dashboard-app/dist/dashboard-app/browser'),
  path.join(__dirname, 'public'),
];

for (const distPath of possibleDistPaths) {
  if (fs.existsSync(distPath)) {
    console.log(`📦 Sirviendo frontend compilado desde: ${distPath}`);
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      next();
    });
    break;
  }
}

// ==========================================
// INICIO
// ==========================================
server.listen(PORT, HOST, () => {
  console.log(`\n🚀 Dashboard Backend corriendo en http://${HOST}:${PORT}`);
  console.log(`   Modo:          ${CLOUD_MODE ? 'Cloud / Push Ingest' : 'Local / LAN Proxy'}`);
  console.log(`   Host Bind:     ${HOST} ${HOST === '127.0.0.1' ? '(Protegido: Solo accesible vía Nginx)' : '(Abierto a la red)'}`);
  console.log(`   WebSocket:     /ws`);
  console.log(`   Push Ingest:   POST /api/sensors/data`);
  console.log(`   Camera Upload: POST /api/camera/upload`);
  console.log(`   Camera Stream: GET /api/camera/stream`);
  console.log(`   Camera Snap:   GET /api/camera/capture`);
  console.log(`   Sensor Data:   GET /api/status`);
  console.log(`   History:       GET /api/history`);
  console.log(`\n📋 Variables y Configuración de Seguridad:`);
  console.log(`   PORT=${PORT}`);
  console.log(`   CLOUD_MODE=${CLOUD_MODE}`);
  console.log(`   ESP32 URL=${ESP32_BASE_URL}`);
  console.log(`   MQTT_BROKER=${MQTT_BROKER}`);
  if (API_KEY) {
    console.log(`   API_KEY=CONFIGURADA (Endpoints protegidos)`);
  } else {
    console.warn(`   ⚠️  API_KEY=NO CONFIGURADA (Endpoints públicos, configurar en entorno para producción)`);
  }
  console.log(`   Límite Stream: Máx ${MAX_STREAM_CLIENTS} clientes concurrentes (${MAX_STREAM_DURATION_MS / 60000} min máx)\n`);
});

// Intentar conectar MQTT, si falla usar polling HTTP
connectMQTT();
startHTTPPolling();
