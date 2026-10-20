import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { WebsocketService } from './websocket';
import {
  SensorData,
  AlertData,
  AlertThresholds,
  InitData,
} from '../models/sensor.models';

@Injectable({ providedIn: 'root' })
export class SensorDataService {
  private readonly API_URL = 'http://localhost:3000/api';

  private currentData$ = new BehaviorSubject<SensorData | null>(null);
  private history$ = new BehaviorSubject<SensorData[]>([]);
  private alerts$ = new BehaviorSubject<AlertData[]>([]);
  private thresholds$ = new BehaviorSubject<AlertThresholds>({
    temp_max: 35,
    temp_min: 5,
    humidity_max: 90,
    humidity_min: 20,
    soil_min: 20,
  });
  private esp32Online$ = new BehaviorSubject<boolean>(false);

  constructor(private wsService: WebsocketService) {
    this.wsService.connect();
    this.wsService.getMessages().subscribe((msg) => {
      switch (msg.type) {
        case 'init': {
          const init: InitData = msg.data;
          if (init.last) this.currentData$.next(init.last);
          this.history$.next(init.history || []);
          this.thresholds$.next(init.thresholds);
          this.alerts$.next(init.alerts || []);
          this.esp32Online$.next(init.esp32_online);
          break;
        }
        case 'sensor_data':
          this.currentData$.next(msg.data);
          const history = [...this.history$.value, msg.data];
          if (history.length > 500) history.splice(0, history.length - 500);
          this.history$.next(history);
          this.esp32Online$.next(true);
          break;
        case 'alert':
          this.alerts$.next([...this.alerts$.value, msg.data]);
          break;
        case 'thresholds':
          this.thresholds$.next(msg.data);
          break;
        case 'status':
          this.esp32Online$.next(msg.data.esp32_online);
          break;
      }
    });
  }

  getCurrentData(): Observable<SensorData | null> {
    return this.currentData$.asObservable();
  }

  getHistory(): Observable<SensorData[]> {
    return this.history$.asObservable();
  }

  getAlerts(): Observable<AlertData[]> {
    return this.alerts$.asObservable();
  }

  getThresholds(): Observable<AlertThresholds> {
    return this.thresholds$.asObservable();
  }

  isEsp32Online(): Observable<boolean> {
    return this.esp32Online$.asObservable();
  }

  async dismissAlert(id: string): Promise<void> {
    await fetch(`${this.API_URL}/alerts/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const updated = this.alerts$.value.map((a) =>
      a.id === id || id === 'all' ? { ...a, dismissed: true } : a
    );
    this.alerts$.next(updated);
  }

  async updateThresholds(thresholds: Partial<AlertThresholds>): Promise<void> {
    const res = await fetch(`${this.API_URL}/thresholds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(thresholds),
    });
    const data = await res.json();
    this.thresholds$.next(data);
  }

  getCameraStreamUrl(): string {
    return `${this.API_URL}/camera/stream`;
  }

  getCameraCaptureUrl(): string {
    return `${this.API_URL}/camera/capture`;
  }
}
