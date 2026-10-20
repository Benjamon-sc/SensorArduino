import { Component, inject } from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe } from '@angular/common';
import { SensorDataService } from '../../services/sensor-data';

@Component({
  selector: 'app-sensor-cards',
  standalone: true,
  imports: [AsyncPipe, DatePipe, DecimalPipe],
  templateUrl: './sensor-cards.html',
  styleUrl: './sensor-cards.scss',
})
export class SensorCardsComponent {
  private sensorService = inject(SensorDataService);
  currentData$ = this.sensorService.getCurrentData();

  constructor() {}

  getTempClass(temp: number): string {
    if (temp > 35) return 'danger';
    if (temp > 30) return 'warning';
    if (temp < 10) return 'cold';
    return 'normal';
  }

  getHumidityClass(hum: number): string {
    if (hum > 80) return 'warning';
    if (hum < 30) return 'danger';
    return 'normal';
  }

  getSoilClass(soil: number): string {
    if (soil < 20) return 'danger';
    if (soil < 40) return 'warning';
    return 'normal';
  }
}
