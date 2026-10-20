import { Component } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { SensorDataService } from '../../services/sensor-data';
import { Observable, map } from 'rxjs';
import { AlertData } from '../../models/sensor.models';

@Component({
  selector: 'app-alerts-panel',
  standalone: true,
  imports: [AsyncPipe, DatePipe],
  templateUrl: './alerts-panel.html',
  styleUrl: './alerts-panel.scss',
})
export class AlertsPanelComponent {
  activeAlerts$: Observable<AlertData[]>;
  showAll = false;

  constructor(private sensorService: SensorDataService) {
    this.activeAlerts$ = this.sensorService.getAlerts().pipe(
      map((alerts) => alerts.filter((a) => !a.dismissed))
    );
  }

  dismiss(id: string): void {
    this.sensorService.dismissAlert(id);
  }

  dismissAll(): void {
    this.sensorService.dismissAlert('all');
  }
}
