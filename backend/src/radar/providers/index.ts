import { SearchProvider, SimulatedProvider } from '../searchProvider';
import { GoogleCseProvider } from './googleCse';
import { SerperProvider } from './serper';

export interface ConfigProvider {
  provider?: string | null;         // RADAR_SEARCH_PROVIDER: serper (padrão) | google_cse (legado) | simulado
  serperKey?: string | null;
  serperNum?: number | null;   // SERPER_NUM (padrão 10; 100 só em plano pago)
  googleApiKey?: string | null;
  googleCx?: string | null;
}

/** Escolhe o provider. Sem credenciais completas cai no simulado (busca real desligada, com aviso). */
export function criarProvider(cfg: ConfigProvider): { provider: SearchProvider; real: boolean; aviso?: string } {
  const escolhido = (cfg.provider || 'serper').toLowerCase();
  if (escolhido === 'serper') {
    if (cfg.serperKey) return { provider: new SerperProvider(cfg.serperKey, { num: cfg.serperNum ?? undefined }), real: true };
    return { provider: new SimulatedProvider(), real: false, aviso: 'Serper sem SERPER_API_KEY — busca real desligada' };
  }
  if (escolhido === 'google_cse') {
    if (cfg.googleApiKey && cfg.googleCx) return { provider: new GoogleCseProvider(cfg.googleApiKey, cfg.googleCx), real: true };
    return { provider: new SimulatedProvider(), real: false, aviso: 'Google CSE (legado) sem GOOGLE_CSE_API_KEY e/ou GOOGLE_CSE_CX' };
  }
  return { provider: new SimulatedProvider(), real: false };
}
