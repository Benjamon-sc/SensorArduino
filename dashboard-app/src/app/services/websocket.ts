import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { WSMessage } from '../models/sensor.models';

@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private messages$ = new Subject<WSMessage>();
  private reconnectTimer: any = null;
  private readonly WS_URL = 'ws://localhost:3000/ws';

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.WS_URL);

    this.ws.onopen = () => {
      console.log('✅ WebSocket conectado');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        this.messages$.next(msg);
      } catch (e) {
        console.error('Error parseando mensaje WS:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('⚠️ WebSocket desconectado. Reconectando en 3s...');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  getMessages(): Observable<WSMessage> {
    return this.messages$.asObservable();
  }

  ngOnDestroy(): void {
    this.ws?.close();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }
}
