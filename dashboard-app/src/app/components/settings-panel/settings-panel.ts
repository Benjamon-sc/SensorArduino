import { Component, Output, EventEmitter, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SensorDataService } from '../../services/sensor-data';
import { PlantProfileService } from '../../services/plant-profile.service';
import { AlertThresholds } from '../../models/sensor.models';
import { PlantProfile } from '../../models/plant-profiles.models';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
})
export class SettingsPanelComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  private sensorService = inject(SensorDataService);
  private plantService = inject(PlantProfileService);
  private cdr = inject(ChangeDetectorRef);

  profiles: PlantProfile[] = this.plantService.getProfiles();
  activeProfile$ = this.plantService.getActiveProfile();

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

  ngOnInit(): void {
    if (typeof localStorage !== 'undefined') {
      this.apiKey = localStorage.getItem('dashboard_api_key') || '';
    }
    this.sensorService.getThresholds().subscribe((t) => {
      this.thresholds = { ...t };
      this.cdr.markForCheck();
    });
  }

  loadPreset(profile: PlantProfile): void {
    this.thresholds = { ...profile.thresholds };
    this.plantService.selectProfile(profile.id);
    this.cdr.markForCheck();
  }

  async save(): Promise<void> {
    try {
      this.errorMessage = '';
      this.cdr.markForCheck();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dashboard_api_key', this.apiKey);
      }
      await this.sensorService.updateThresholds(this.thresholds, this.apiKey);
      this.saved = true;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.saved = false;
        this.cdr.markForCheck();
      }, 2000);
    } catch (err: any) {
      this.errorMessage = err.message || 'Error al guardar los umbrales';
      this.cdr.markForCheck();
      setTimeout(() => {
        this.errorMessage = '';
        this.cdr.markForCheck();
      }, 4000);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
