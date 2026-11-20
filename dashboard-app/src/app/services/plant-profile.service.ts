import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map, combineLatest } from 'rxjs';
import { PlantProfile, PLANT_PROFILES, calculateVPD } from '../models/plant-profiles.models';
import { SensorDataService } from './sensor-data';
import { SensorData, AlertThresholds } from '../models/sensor.models';

export interface CropHealthStatus {
  status: 'optimal' | 'warning' | 'critical';
  label: string;
  vpd: number;
  vpdStatus: 'low' | 'ideal' | 'high';
  vpdLabel: string;
  vpdMessage: string;
  tempStatus: 'low' | 'ideal' | 'high';
  humidityStatus: 'low' | 'ideal' | 'high';
  soilStatus: 'low' | 'ideal' | 'high';
  advice: string;
}

@Injectable({ providedIn: 'root' })
export class PlantProfileService {
  private sensorService = inject(SensorDataService);
  private readonly STORAGE_KEY = 'active_plant_profile_id';
  private readonly CUSTOM_KEY = 'custom_plant_profile_data';

  private profiles = [...PLANT_PROFILES];
  private activeProfile$ = new BehaviorSubject<PlantProfile>(this.loadInitialProfile());

  constructor() {
    this.loadCustomProfileFromStorage();
  }

  private loadCustomProfileFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(this.CUSTOM_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const custom = this.profiles.find((p) => p.id === 'custom');
      if (custom && data.thresholds) {
        custom.thresholds = { ...custom.thresholds, ...data.thresholds };
        if (data.idealVpd) custom.idealVpd = { ...custom.idealVpd, ...data.idealVpd };
      }
    } catch {}
  }

  private loadInitialProfile(): PlantProfile {
    if (typeof localStorage !== 'undefined') {
      const savedId = localStorage.getItem(this.STORAGE_KEY);
      const found = this.profiles.find((p) => p.id === savedId);
      if (found) return found;
    }
    return this.profiles[0];
  }

  getActiveProfile(): Observable<PlantProfile> {
    return this.activeProfile$.asObservable();
  }

  getCurrentProfileSync(): PlantProfile {
    return this.activeProfile$.value;
  }

  getProfiles(): PlantProfile[] {
    return this.profiles;
  }

  selectProfile(profileId: string): void {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    this.activeProfile$.next(profile);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, profile.id);
    }
  }

  updateCustomProfile(thresholds: AlertThresholds, vpdMin = 0.8, vpdMax = 1.2): void {
    const custom = this.profiles.find((p) => p.id === 'custom');
    if (!custom) return;
    custom.thresholds = { ...thresholds };
    custom.idealVpd = { min: vpdMin, max: vpdMax };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        this.CUSTOM_KEY,
        JSON.stringify({ thresholds: custom.thresholds, idealVpd: custom.idealVpd })
      );
    }
    if (this.activeProfile$.value.id === 'custom') {
      this.activeProfile$.next({ ...custom });
    }
  }

  async applyProfileThresholds(apiKey?: string): Promise<void> {
    const profile = this.activeProfile$.value;
    const key = apiKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('dashboard_api_key') || '' : '');
    await this.sensorService.updateThresholds(profile.thresholds, key);
  }

  getCropHealthStatus(): Observable<CropHealthStatus | null> {
    return combineLatest([
      this.sensorService.getCurrentData(),
      this.activeProfile$,
    ]).pipe(
      map(([sensor, profile]) => {
        if (!sensor) return null;
        return this.computeHealthStatus(sensor, profile);
      })
    );
  }

  private computeHealthStatus(sensor: SensorData, profile: PlantProfile): CropHealthStatus {
    const vpd = calculateVPD(sensor.temperatura, sensor.humedad);
    let vpdStatus: 'low' | 'ideal' | 'high' = 'ideal';
    let vpdLabel = 'En punto ideal';
    let vpdMessage = 'La planta respira y absorbe agua en perfecto equilibrio.';

    if (vpd < profile.idealVpd.min) {
      vpdStatus = 'low';
      vpdLabel = 'Aire muy húmedo';
      vpdMessage = 'El aire está casi saturado. Ventila o baja la humedad para evitar hongos.';
    } else if (vpd > profile.idealVpd.max) {
      vpdStatus = 'high';
      vpdLabel = 'Aire muy seco';
      vpdMessage = 'La planta está perdiendo agua muy rápido. Aumenta la humedad o riega un poco.';
    }

    const tempStatus =
      sensor.temperatura > profile.thresholds.temp_max ? 'high' :
      sensor.temperatura < profile.thresholds.temp_min ? 'low' : 'ideal';

    const humidityStatus =
      sensor.humedad > profile.thresholds.humidity_max ? 'high' :
      sensor.humedad < profile.thresholds.humidity_min ? 'low' : 'ideal';

    const soilStatus =
      sensor.humedad_suelo < profile.thresholds.soil_min ? 'low' : 'ideal';

    let status: 'optimal' | 'warning' | 'critical' = 'optimal';
    let label = '¡Todo Perfecto!';
    let advice = profile.recommendations.climate;

    if (tempStatus !== 'ideal' || humidityStatus !== 'ideal' || soilStatus !== 'ideal' || vpdStatus !== 'ideal') {
      if (
        sensor.temperatura >= profile.thresholds.temp_max + 3 ||
        sensor.temperatura <= profile.thresholds.temp_min - 3 ||
        sensor.humedad_suelo < profile.thresholds.soil_min - 10
      ) {
        status = 'critical';
        label = '¡Alerta de Riesgo!';
        advice = profile.recommendations.riskAlert;
      } else {
        status = 'warning';
        label = 'Atención recomendada';
        advice = `${profile.recommendations.irrigation} ${profile.recommendations.riskAlert}`;
      }
    }

    return {
      status,
      label,
      vpd,
      vpdStatus,
      vpdLabel,
      vpdMessage,
      tempStatus,
      humidityStatus,
      soilStatus,
      advice,
    };
  }
}
