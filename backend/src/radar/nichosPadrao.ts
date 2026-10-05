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
  n('Advogados', ['advogados', 'escritório de advocacia'], ['advogado', 'advocacia', 'jurídico', 'oab']),
  n('Dentistas', ['dentistas', 'clínica odontológica'], ['dentista', 'odontologia', 'clínica odontológica', 'cro']),
  n('Psicólogos/Terapeutas', ['psicólogos', 'terapeutas'], ['psicólogo', 'psicologia', 'terapia', 'crp']),
  n('Personal trainers', ['personal trainer', 'educadores físicos'], ['personal', 'educação física', 'treinador', 'cref']),
  n('Nutricionistas', ['nutricionistas'], ['nutricionista', 'nutrição', 'crn']),
  n('Arquitetos/Design de interiores', ['arquitetos', 'design de interiores'], ['arquiteto', 'arquitetura', 'design de interiores', 'cau']),
  n('Franquias', ['franqueados', 'franquias'], ['franquia', 'franqueado', 'franchising']),
  n('Representantes comerciais', ['representantes comerciais'], ['representante comercial', 'representação comercial', 'representada']),
  n('Logística/Transportadoras', ['transportadoras', 'logística'], ['transportadora', 'logística', 'frete', 'fretes']),
  n('Eventos/Cerimonial', ['cerimonialistas', 'produtores de eventos'], ['cerimonial', 'eventos', 'buffet', 'decoração de festas']),
  n('Pet shops/Veterinários', ['pet shop', 'veterinários'], ['petshop', 'pet shop', 'veterinário', 'veterinária', 'crmv']),
  n('Construção civil/Engenheiros', ['engenheiros civis', 'construção civil'], ['engenheiro', 'construção civil', 'crea', 'obra']),
  n('Infoprodutores/Educação online', ['infoprodutores', 'cursos online'], ['infoproduto', 'curso online', 'mentoria', 'lançamento digital']),
  n('Investimentos/Assessoria financeira', ['investidores', 'assessoria de investimentos'], ['investidor', 'investimentos', 'assessoria de investimentos', 'renda fixa']),
  n('Importação/Comércio exterior', ['importadores', 'comércio exterior'], ['importação', 'importador', 'comex', 'exportação']),
];
