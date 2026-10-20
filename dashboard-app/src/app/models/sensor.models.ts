export interface SensorData {
  temperatura: number;
  humedad: number;
  humedad_suelo: number;
  timestamp: number;
}

export interface AlertData {
  id: string;
  alertType: string;
  message: string;
  timestamp: number;
  dismissed: boolean;
}

export interface AlertThresholds {
  temp_max: number;
  temp_min: number;
  humidity_max: number;
  humidity_min: number;
  soil_min: number;
}

export interface WSMessage {
  type: 'init' | 'sensor_data' | 'alert' | 'thresholds' | 'status';
  data: any;
}

export interface InitData {
  last: SensorData | null;
  history: SensorData[];
  thresholds: AlertThresholds;
  alerts: AlertData[];
  esp32_online: boolean;
}
