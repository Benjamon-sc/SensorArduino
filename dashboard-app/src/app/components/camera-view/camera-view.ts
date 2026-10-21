import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { SensorDataService } from '../../services/sensor-data';

@Component({
  selector: 'app-camera-view',
  standalone: true,
  templateUrl: './camera-view.html',
  styleUrl: './camera-view.scss',
})
export class CameraViewComponent implements OnInit, OnDestroy {
  streamUrl: string;
  captureUrl: string;
  isStreaming = false; // Modo captura reactiva por defecto (ahorro de ancho de banda)
  lastCaptureUrl: string | null = null;
  private sub?: Subscription;

  constructor(private sensorService: SensorDataService) {
    this.streamUrl = this.sensorService.getCameraStreamUrl();
    this.captureUrl = this.sensorService.getCameraCaptureUrl();
  }

  ngOnInit(): void {
    // Cargar captura inicial
    this.takeSnapshot();

    // Auto-actualizar la imagen cada vez que el ESP32 sube una nueva foto
    this.sub = this.sensorService.onCameraUpdate().subscribe((timestamp) => {
      this.lastCaptureUrl = `${this.captureUrl}?t=${timestamp}`;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  setStreaming(mode: boolean): void {
    this.isStreaming = mode;
    if (!this.isStreaming) {
      this.takeSnapshot();
    }
  }

  takeSnapshot(): void {
    // Añadir timestamp para evitar cache del navegador
    this.lastCaptureUrl = `${this.captureUrl}?t=${Date.now()}`;
  }

  onImageError(): void {
    this.lastCaptureUrl = null;
  }
}
