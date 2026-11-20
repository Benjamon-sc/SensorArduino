import { AlertThresholds } from './sensor.models';

export interface PlantProfile {
  id: 'cannabis' | 'chloraea' | 'changle' | 'custom';
  name: string;
  scientificName?: string;
  category: 'Medicinal' | 'Orquídea Nativa' | 'Hongo Gourmet' | 'Personalizado';
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
    description: 'Ajustado para floración sana bajo cultivo doméstico legal (Ley 20.000 Chile).',
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
      irrigation: 'Riega solo cuando la superficie de la tierra se sienta seca. A las raíces les hace bien respirar aire entre cada riego.',
      climate: 'Temperatura agradable (21° a 26°C). Si la humedad sube de 65%, enciende ventiladores para evitar que salga moho en las flores.',
      riskAlert: '⚠️ ¡Humedad muy alta! Hay riesgo de que aparezca moho blanco/gris y se pudran las flores. Ventila de inmediato.',
    },
  },
  {
    id: 'chloraea',
    name: 'Orquídea Gavilu',
    scientificName: 'Chloraea verteroana Phil.',
    category: 'Orquídea Nativa',
    icon: '🌸',
    description: 'Orquídea silvestre chilena de clima fresco y semisombra.',
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
      irrigation: 'Mantén la maceta con tierra húmeda pero suelta y con buen drenaje. Nunca dejes agua acumulada abajo porque pudre sus raíces.',
      climate: 'Le gusta el aire fresco (14° a 22°C) y la luz suave. Evita ponerla bajo el sol directo del mediodía.',
      riskAlert: '⚠️ ¡Mucho calor o aire seco! Sus hojas se arrugarán rápido. Cámbiala a un lugar más fresco y con sombra.',
    },
  },
  {
    id: 'changle',
    name: 'Hongo Changle',
    scientificName: 'Ramaria flava (Schaeff.) Quél.',
    category: 'Hongo Gourmet',
    icon: '🍄',
    description: 'Hongo silvestre del bosque sureño chileno. Requiere aire muy húmedo constante.',
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
      irrigation: 'El sustrato debe estar siempre húmedo y fresco, imitando la tierra húmeda del bosque nativo.',
      climate: 'Ambiente fresco (12° a 18°C) y con neblina o humedad casi al 90%. Evita corrientes de viento que sequen el hongo.',
      riskAlert: '⚠️ ¡El aire está demasiado seco! Las puntas del hongo se secarán y morirán en pocas horas. Rocía humedad urgente.',
    },
  },
  {
    id: 'custom',
    name: 'Personalizado',
    scientificName: 'Configuración libre',
    category: 'Personalizado',
    icon: '⚙️',
    description: 'Define tus propios valores de temperatura, humedad y riego según la planta o cultivo que quieras cuidar.',
    thresholds: {
      temp_max: 30,
      temp_min: 15,
      humidity_max: 80,
      humidity_min: 35,
      soil_min: 30,
    },
    idealVpd: {
      min: 0.8,
      max: 1.2,
    },
    recommendations: {
      irrigation: 'Ajusta la cantidad de agua según lo que pida tu variedad de planta y el drenaje de tu maceta.',
      climate: 'Procura mantener la temperatura y humedad dentro de los valores que definiste.',
      riskAlert: '⚠️ Los sensores detectaron valores fuera de tus límites configurados. Échale un vistazo a tu cultivo.',
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
  const vpsat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const vpair = vpsat * (Math.max(0, Math.min(100, humidityPct)) / 100);
  const vpd = vpsat - vpair;
  return Math.round(vpd * 100) / 100;
}
