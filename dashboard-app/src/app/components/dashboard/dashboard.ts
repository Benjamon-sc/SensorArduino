import { Component, inject } from '@angular/core';
import { SensorCardsComponent } from '../sensor-cards/sensor-cards';
import { CameraViewComponent } from '../camera-view/camera-view';
import { SensorChartsComponent } from '../sensor-charts/sensor-charts';
import { AlertsPanelComponent } from '../alerts-panel/alerts-panel';
import { SettingsPanelComponent } from '../settings-panel/settings-panel';
import { SensorDataService } from '../../services/sensor-data';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    SensorCardsComponent,
    CameraViewComponent,
    SensorChartsComponent,
    AlertsPanelComponent,
    SettingsPanelComponent,
    AsyncPipe,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent {
  private sensorService = inject(SensorDataService);
  esp32Online$ = this.sensorService.isEsp32Online();
  showSettings = false;

  constructor() {}

  toggleSettings(): void {
    this.showSettings = !this.showSettings;
  }
}
