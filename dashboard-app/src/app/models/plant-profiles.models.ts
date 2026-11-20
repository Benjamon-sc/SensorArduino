import { AlertThresholds } from './sensor.models';

export interface PlantProfile {
  id: 'cannabis' | 'chloraea' | 'changle';
  name: string;
  scientificName: string;
  category: 'Medicinal' | 'Orquídea Nativa' | 'Hongo Gourmet';
  icon: string;
  description: string;
  thresholds: AlertThresholds;
  idealVpd: {
    min: number; // en kPa
    max: number; // en kPa
  };
  recommendations: {
    irrigation: string;
    climate: string;
    riskAlert: string;
  };
}

export const PLANT_PROFILES: PlantProfile[] = [
  {
    id: 'cannabis',
    name: 'Cannabis Medicinal',
    scientificName: 'Cannabis sativa L.',
    category: 'Medicinal',
    icon: '🌿',
    description: 'Optimizado para fase de floración controlada bajo normativa chilena (Ley 20.000).',
    thresholds: {
      temp_max: 28,
      temp_min: 18,
      humidity_max: 65,
      humidity_min: 40,
      soil_min: 35,
    },
    idealVpd: {
      min: 1.0,
      max: 1.4,
    },
    recommendations: {
      irrigation: 'Mantener ciclos secado-riego en sustrato para oxigenar raíces (50-70% ideal).',
      climate: 'Temperatura entre 21°C y 26°C. Evitar HR > 65% para prevenir moho gris (Botrytis).',
      riskAlert: 'Peligro de Botrytis si la humedad ambiente supera el 65% con temperaturas bajo 20°C.',
    },
  },
  {
    id: 'chloraea',
    name: 'Orquídea Gavilu',
    scientificName: 'Chloraea verteroana Phil.',
    category: 'Orquídea Nativa',
    icon: '🌸',
    description: 'Orquídea terrestre endémica de Chile. Requiere microclima fresco y sustrato aireado.',
    thresholds: {
      temp_max: 25,
      temp_min: 10,
      humidity_max: 85,
      humidity_min: 50,
      soil_min: 30,
    },
    idealVpd: {
      min: 0.6,
      max: 1.0,
    },
    recommendations: {
      irrigation: 'Sustrato húmedo pero nunca encharcado; raíces susceptibles a anoxia.',
      climate: 'Rango fresco (14°C - 22°C) con semisombra y buena renovación de aire.',
      riskAlert: 'Sensible al estrés por calor excesivo (>26°C) que interrumpe la micorrización.',
    },
  },
  {
    id: 'changle',
    name: 'Hongo Changle',
    scientificName: 'Ramaria flava (Schaeff.) Quél.',
    category: 'Hongo Gourmet',
    icon: '🍄',
    description: 'Hongo silvestre comestible del bosque templado chileno (Nothofagus). Requiere altísima humedad.',
    thresholds: {
      temp_max: 21,
      temp_min: 8,
      humidity_max: 98,
      humidity_min: 80,
      soil_min: 60,
    },
    idealVpd: {
      min: 0.2,
      max: 0.5,
    },
    recommendations: {
      irrigation: 'Humedad de contacto alta constante (70-85%) simulando el sotobosque otoñal.',
      climate: 'Ambiente fresco (12°C - 18°C) con niebla o humedad relativa próxima a saturación.',
      riskAlert: 'Si la HR baja de 80%, las puntas coralinas se marchitan y abortan en pocas horas.',
    },
  },
];

/**
 * Calcula el Déficit de Presión de Vapor (VPD) en kPa utilizando la fórmula de Tetens.
 * @param tempC Temperatura en grados Celsius
 * @param humidityPct Humedad relativa en porcentaje (0 - 100)
 */
export function calculateVPD(tempC: number, humidityPct: number): number {
  if (tempC === null || tempC === undefined || humidityPct === null || humidityPct === undefined) {
    return 0;
  }
  // Presión de vapor de saturación (Tetens)
  const vpsat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  // Presión de vapor real
  const vpair = vpsat * (Math.max(0, Math.min(100, humidityPct)) / 100);
  const vpd = vpsat - vpair;
  return Math.round(vpd * 100) / 100;
}
