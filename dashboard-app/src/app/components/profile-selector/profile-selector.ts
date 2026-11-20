import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlantProfileService } from '../../services/plant-profile.service';
import { PlantProfile } from '../../models/plant-profiles.models';

@Component({
  selector: 'app-profile-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-selector.html',
  styleUrl: './profile-selector.scss',
})
export class ProfileSelectorComponent implements OnInit {
  private plantService = inject(PlantProfileService);
  private cdr = inject(ChangeDetectorRef);

  profiles: PlantProfile[] = this.plantService.getProfiles();
  activeProfile$ = this.plantService.getActiveProfile();
  healthStatus$ = this.plantService.getCropHealthStatus();

  isEditingCustom = false;
  applied = false;
  applying = false;
  errorMsg = '';
  apiKey = '';

  // Formulario del perfil personalizado
  customTempMax = 30;
  customTempMin = 15;
  customHumidityMax = 80;
  customHumidityMin = 35;
  customSoilMin = 30;
  customVpdMin = 0.8;
  customVpdMax = 1.2;

  ngOnInit(): void {
    if (typeof localStorage !== 'undefined') {
      this.apiKey = localStorage.getItem('dashboard_api_key') || '';
    }
    this.syncFormWithCustomProfile();
  }

  private syncFormWithCustomProfile(): void {
    const custom = this.profiles.find((p) => p.id === 'custom');
    if (custom) {
      this.customTempMax = custom.thresholds.temp_max;
      this.customTempMin = custom.thresholds.temp_min;
      this.customHumidityMax = custom.thresholds.humidity_max;
      this.customHumidityMin = custom.thresholds.humidity_min;
      this.customSoilMin = custom.thresholds.soil_min;
      this.customVpdMin = custom.idealVpd.min;
      this.customVpdMax = custom.idealVpd.max;
    }
  }

  selectProfile(id: string): void {
    this.plantService.selectProfile(id);
    if (id !== 'custom') {
      this.isEditingCustom = false;
    }
    this.cdr.markForCheck();
  }

  toggleEditCustom(): void {
    this.syncFormWithCustomProfile();
    this.isEditingCustom = !this.isEditingCustom;
    this.cdr.markForCheck();
  }

  async saveCustomProfile(): Promise<void> {
    try {
      this.applying = true;
      this.errorMsg = '';
      this.cdr.markForCheck();

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dashboard_api_key', this.apiKey);
      }

      this.plantService.updateCustomProfile(
        {
          temp_max: this.customTempMax,
          temp_min: this.customTempMin,
          humidity_max: this.customHumidityMax,
          humidity_min: this.customHumidityMin,
          soil_min: this.customSoilMin,
        },
        this.customVpdMin,
        this.customVpdMax
      );

      await this.plantService.applyProfileThresholds(this.apiKey);
      this.applied = true;
      this.isEditingCustom = false;
      this.cdr.markForCheck();

      setTimeout(() => {
        this.applied = false;
        this.cdr.markForCheck();
      }, 2500);
    } catch (err: any) {
      this.handleApiError(err);
    } finally {
      this.applying = false;
      this.cdr.markForCheck();
    }
  }

  async applyToCloud(): Promise<void> {
    try {
      this.applying = true;
      this.errorMsg = '';
      this.cdr.markForCheck();

      await this.plantService.applyProfileThresholds(this.apiKey);
      this.applied = true;
      this.cdr.markForCheck();

      setTimeout(() => {
        this.applied = false;
        this.cdr.markForCheck();
      }, 2500);
    } catch (err: any) {
      this.handleApiError(err);
    } finally {
      this.applying = false;
      this.cdr.markForCheck();
    }
  }

  private handleApiError(err: any): void {
    const msg = err.message || '';
    if (msg.includes('401') || msg.toLowerCase().includes('autorizado') || msg.toLowerCase().includes('api key')) {
      this.errorMsg = '🔒 Acceso protegido: Debes ingresar tu Clave de API en ⚙️ Ajustes para guardar en AWS Lightsail.';
    } else {
      this.errorMsg = msg || 'Error al conectar con el servidor en la nube.';
    }
    this.cdr.markForCheck();
    setTimeout(() => {
      this.errorMsg = '';
      this.cdr.markForCheck();
    }, 7000);
  }
}
