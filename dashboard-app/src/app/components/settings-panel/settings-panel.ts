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

  saved = false;

  constructor(private sensorService: SensorDataService) {}

  ngOnInit(): void {
    this.sensorService.getThresholds().subscribe((t) => {
      this.thresholds = { ...t };
    });
  }

  async save(): Promise<void> {
    await this.sensorService.updateThresholds(this.thresholds);
    this.saved = true;
    setTimeout(() => (this.saved = false), 2000);
  }

  onClose(): void {
    this.close.emit();
  }
}
