import { Component, inject } from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe, CommonModule } from '@angular/common';
import { SensorDataService } from '../../services/sensor-data';
import { PlantProfileService } from '../../services/plant-profile.service';
import { calculateVPD } from '../../models/plant-profiles.models';

@Component({
  selector: 'app-sensor-cards',
  standalone: true,
  imports: [AsyncPipe, DatePipe, DecimalPipe, CommonModule],
  templateUrl: './sensor-cards.html',
  styleUrl: './sensor-cards.scss',
})
export class SensorCardsComponent {
  private sensorService = inject(SensorDataService);
  private plantService = inject(PlantProfileService);

  currentData$ = this.sensorService.getCurrentData();
  activeProfile$ = this.plantService.getActiveProfile();

  getTempClass(temp: number): string {
    const profile = this.plantService.getCurrentProfileSync();
    if (temp > profile.thresholds.temp_max) return 'danger';
    if (temp < profile.thresholds.temp_min) return 'cold';
    if (temp > profile.thresholds.temp_max - 2 || temp < profile.thresholds.temp_min + 2) return 'warning';
    return 'normal';
  }

  getHumidityClass(hum: number): string {
    const profile = this.plantService.getCurrentProfileSync();
    if (hum > profile.thresholds.humidity_max) return 'warning';
    if (hum < profile.thresholds.humidity_min) return 'danger';
    return 'normal';
  }

  getSoilClass(soil: number): string {
    const profile = this.plantService.getCurrentProfileSync();
    if (soil < profile.thresholds.soil_min) return 'danger';
    if (soil < profile.thresholds.soil_min + 15) return 'warning';
    return 'normal';
  }

  getVPD(temp: number, hum: number): number {
    return calculateVPD(temp, hum);
  }

  getVpdClass(vpd: number): string {
    const profile = this.plantService.getCurrentProfileSync();
    if (vpd < profile.idealVpd.min) return 'warning';
    if (vpd > profile.idealVpd.max) return 'danger';
    return 'normal';
  }
}
