import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { SensorDataService } from '../../services/sensor-data';
import { SensorData } from '../../models/sensor.models';

Chart.register(...registerables);

@Component({
  selector: 'app-sensor-charts',
  standalone: true,
  templateUrl: './sensor-charts.html',
  styleUrl: './sensor-charts.scss',
})
export class SensorChartsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tempChart') tempCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('humChart') humCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('soilChart') soilCanvas!: ElementRef<HTMLCanvasElement>;

  private tempChart!: Chart;
  private humChart!: Chart;
  private soilChart!: Chart;
  private sub!: Subscription;

  constructor(private sensorService: SensorDataService) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.createCharts();

    this.sub = this.sensorService.getHistory().subscribe((history) => {
      this.updateCharts(history);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.tempChart?.destroy();
    this.humChart?.destroy();
    this.soilChart?.destroy();
  }

  private getChartColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      text: styles.getPropertyValue('--text').trim() || '#1e293b',
      textSecondary: styles.getPropertyValue('--text-secondary').trim() || '#64748b',
      border: styles.getPropertyValue('--border').trim() || '#e2e8f0',
      grid: styles.getPropertyValue('--hover').trim() || '#f1f5f9',
    };
  }

  private commonOptions(title: string, yUnit: string): any {
    const colors = this.getChartColors();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: title,
          color: colors.text,
          font: { size: 14, weight: '600' },
          padding: { bottom: 10 },
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => `${ctx.parsed.y}${yUnit}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: colors.textSecondary,
            maxTicksLimit: 8,
            font: { size: 11 },
          },
          grid: { color: colors.grid },
        },
        y: {
          ticks: {
            color: colors.textSecondary,
            font: { size: 11 },
            callback: (v: number) => `${v}${yUnit}`,
          },
          grid: { color: colors.grid },
        },
      },
      elements: {
        point: { radius: 0, hitRadius: 8 },
        line: { tension: 0.3, borderWidth: 2 },
      },
    };
  }

  private createCharts(): void {
    this.tempChart = new Chart(this.tempCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Temperatura',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
        }],
      },
      options: this.commonOptions('🌡️ Temperatura', '°C'),
    });

    this.humChart = new Chart(this.humCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Humedad',
          data: [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
        }],
      },
      options: this.commonOptions('💧 Humedad Ambiente', '%'),
    });

    this.soilChart = new Chart(this.soilCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Humedad del Suelo',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
        }],
      },
      options: this.commonOptions('🌱 Humedad del Suelo', '%'),
    });
  }

  private updateCharts(history: SensorData[]): void {
    const labels = history.map((d) => {
      const date = new Date(d.timestamp);
      return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    });

    this.tempChart.data.labels = labels;
    this.tempChart.data.datasets[0].data = history.map((d) => d.temperatura);
    this.tempChart.update('none');

    this.humChart.data.labels = labels;
    this.humChart.data.datasets[0].data = history.map((d) => d.humedad);
    this.humChart.update('none');

    this.soilChart.data.labels = labels;
    this.soilChart.data.datasets[0].data = history.map((d) => d.humedad_suelo);
    this.soilChart.update('none');
  }
}
