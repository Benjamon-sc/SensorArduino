import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlantProfileService } from '../../services/plant-profile.service';
import { PlantProfile } from '../../models/plant-profiles.models';

@Component({
  selector: 'app-profile-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-selector.html',
  styleUrl: './profile-selector.scss',
})
export class ProfileSelectorComponent {
  private plantService = inject(PlantProfileService);

  profiles: PlantProfile[] = this.plantService.getProfiles();
  activeProfile$ = this.plantService.getActiveProfile();
  healthStatus$ = this.plantService.getCropHealthStatus();

  applied = false;
  applying = false;
  errorMsg = '';

  selectProfile(id: string): void {
    this.plantService.selectProfile(id);
  }

  async applyToCloud(): Promise<void> {
    try {
      this.applying = true;
      this.errorMsg = '';
      await this.plantService.applyProfileThresholds();
      this.applied = true;
      setTimeout(() => (this.applied = false), 2500);
    } catch (err: any) {
      this.errorMsg = err.message || 'Error al sincronizar con la nube';
      setTimeout(() => (this.errorMsg = ''), 4000);
    } finally {
      this.applying = false;
    }
  }
}
