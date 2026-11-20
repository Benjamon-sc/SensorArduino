import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map, combineLatest } from 'rxjs';
import { PlantProfile, PLANT_PROFILES, calculateVPD } from '../models/plant-profiles.models';
import { SensorDataService } from './sensor-data';
import { SensorData } from '../models/sensor.models';

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

  private activeProfile$ = new BehaviorSubject<PlantProfile>(
    this.loadInitialProfile()
  );

  private loadInitialProfile(): PlantProfile {
    if (typeof localStorage !== 'undefined') {
      const savedId = localStorage.getItem(this.STORAGE_KEY);
      const found = PLANT_PROFILES.find((p) => p.id === savedId);
      if (found) return found;
    }
    return PLANT_PROFILES[0]; // Cannabis medicinal por defecto
  }

  getActiveProfile(): Observable<PlantProfile> {
    return this.activeProfile$.asObservable();
  }

  getCurrentProfileSync(): PlantProfile {
    return this.activeProfile$.value;
  }

  getProfiles(): PlantProfile[] {
    return PLANT_PROFILES;
  }

  selectProfile(profileId: string): void {
    const profile = PLANT_PROFILES.find((p) => p.id === profileId);
    if (!profile) return;
    this.activeProfile$.next(profile);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, profile.id);
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
    let vpdLabel = 'Óptimo';
    let vpdMessage = 'Transpiración balanceada';

    if (vpd < profile.idealVpd.min) {
      vpdStatus = 'low';
      vpdLabel = 'Bajo (Riesgo Condensación)';
      vpdMessage = 'Poca evaporación. Riesgo de hongos o estomas cerrados.';
    } else if (vpd > profile.idealVpd.max) {
      vpdStatus = 'high';
      vpdLabel = 'Alto (Estrés Hídrico)';
      vpdMessage = 'Evaporación excesiva. La planta transpira más rápido de lo que absorbe.';
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
    let label = 'Ambiente Ideal';
    let advice = profile.recommendations.climate;

    if (tempStatus !== 'ideal' || humidityStatus !== 'ideal' || soilStatus !== 'ideal' || vpdStatus !== 'ideal') {
      if (
        sensor.temperatura >= profile.thresholds.temp_max + 3 ||
        sensor.temperatura <= profile.thresholds.temp_min - 3 ||
        sensor.humedad_suelo < profile.thresholds.soil_min - 10
      ) {
        status = 'critical';
        label = 'Condición Crítica';
        advice = profile.recommendations.riskAlert;
      } else {
        status = 'warning';
        label = 'Atención Requerida';
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
