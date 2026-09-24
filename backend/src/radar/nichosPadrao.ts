import { NEGATIVAS_PADRAO } from './scoring';

export interface NichoPadrao {
  nome: string;
  termos_busca: string[];
  palavras_positivas: string[];
  palavras_negativas: string[];
  regioes: string[];
}

const SP = ['São Paulo', 'Campinas', 'Guarulhos', 'Santos'];

const n = (nome: string, termos: string[], positivas: string[], regioes: string[] = SP): NichoPadrao =>
  ({ nome, termos_busca: termos, palavras_positivas: positivas, palavras_negativas: NEGATIVAS_PADRAO, regioes });

export const NICHOS_PADRAO: NichoPadrao[] = [
  n('Imobiliário', ['corretores de imóveis', 'imobiliária'], ['corretores', 'imóveis', 'imobiliária', 'creci', 'lançamentos']),
  n('CORBAN/Consignado', ['correspondente bancário', 'corban', 'consignado'], ['corban', 'consignado', 'correspondente', 'crédito', 'inss']),
  n('Consórcio', ['consórcio', 'vendedores de consórcio'], ['consórcio', 'consorcio', 'cotas', 'contemplação']),
  n('Seguros/Plano de saúde', ['corretores de seguros', 'plano de saúde corretores'], ['seguros', 'corretor', 'plano de saúde', 'susep']),
  n('Gestores de tráfego', ['gestor de tráfego', 'tráfego pago'], ['tráfego', 'trafego', 'gestor', 'ads', 'meta ads', 'google ads']),
  n('Agências de marketing', ['agência de marketing', 'marketing digital'], ['agência', 'agencia', 'marketing', 'social media']),
  n('Automação/n8n/IA', ['automação whatsapp', 'n8n', 'inteligência artificial negócios'], ['automação', 'n8n', 'chatbot', 'ia', 'whatsapp api']),
  n('E-commerce/Fornecedores', ['lojistas e-commerce', 'fornecedores atacado'], ['e-commerce', 'lojista', 'fornecedor', 'dropshipping', 'atacado']),
  n('Energia solar', ['energia solar integradores', 'vendedores energia solar'], ['solar', 'fotovoltaico', 'integrador', 'energia']),
  n('Provedores de internet', ['provedores de internet', 'isp provedor'], ['provedor', 'isp', 'fibra', 'internet', 'mikrotik']),
  n('Estética', ['clínica de estética', 'esteticistas'], ['estética', 'estetica', 'esteticista', 'harmonização', 'clínica']),
  n('Contabilidade', ['contadores', 'escritório contábil'], ['contador', 'contabilidade', 'contábil', 'crc']),
  n('Revenda de veículos', ['revenda de veículos', 'lojistas de carros'], ['veículos', 'lojista', 'revenda', 'seminovos', 'carros']),
  n('Empresários SP', ['empresários', 'networking empresarial'], ['empresários', 'networking', 'negócios', 'empreendedores']),
];
