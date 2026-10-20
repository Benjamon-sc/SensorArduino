import { Component } from '@angular/core';
import { SensorDataService } from '../../services/sensor-data';

@Component({
  selector: 'app-camera-view',
  standalone: true,
  templateUrl: './camera-view.html',
  styleUrl: './camera-view.scss',
})
export class CameraViewComponent {
  streamUrl: string;
  captureUrl: string;
  isStreaming = true;
  lastCaptureUrl: string | null = null;

  constructor(private sensorService: SensorDataService) {
    this.streamUrl = this.sensorService.getCameraStreamUrl();
    this.captureUrl = this.sensorService.getCameraCaptureUrl();
  }

  toggleMode(): void {
    this.isStreaming = !this.isStreaming;
    if (!this.isStreaming) {
      this.takeSnapshot();
    }
  }

  takeSnapshot(): void {
    // Añadir timestamp para evitar cache
    this.lastCaptureUrl = `${this.captureUrl}?t=${Date.now()}`;
  }

  onImageError(): void {
    this.lastCaptureUrl = null;
  }
}
