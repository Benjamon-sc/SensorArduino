import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SensorDataService } from '../../services/sensor-data';
import { AlertThresholds } from '../../models/sensor.models';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
})
export class SettingsPanelComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  thresholds: AlertThresholds = {
    temp_max: 35,
    temp_min: 5,
    humidity_max: 90,
    humidity_min: 20,
    soil_min: 20,
  };

  apiKey = '';
  errorMessage = '';
  saved = false;

  constructor(private sensorService: SensorDataService) {}

  ngOnInit(): void {
    if (typeof localStorage !== 'undefined') {
      this.apiKey = localStorage.getItem('dashboard_api_key') || '';
    }
    this.sensorService.getThresholds().subscribe((t) => {
      this.thresholds = { ...t };
    });
  }

  async save(): Promise<void> {
    try {
      this.errorMessage = '';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dashboard_api_key', this.apiKey);
      }
      await this.sensorService.updateThresholds(this.thresholds, this.apiKey);
      this.saved = true;
      setTimeout(() => (this.saved = false), 2000);
    } catch (err: any) {
      this.errorMessage = err.message || 'Error al guardar los umbrales';
      setTimeout(() => (this.errorMessage = ''), 4000);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
