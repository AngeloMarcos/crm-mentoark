/**
 * Funil que anda sozinho (2026-11-02, modelo atendIA): regras de quando a IA pode mover o card.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizarAcoesFunil, normalizarAutomacoes, etapasPermitidasIA, decidirMovimentoIA, montarFerramentaMover,
  type EtapaFunil,
} from '../src/services/funilAuto';

const ETAPAS: EtapaFunil[] = [
  { id: 'e1', nome: 'Novo lead', tipo: 'aberta' },
  { id: 'e2', nome: 'Em conversa', tipo: 'aberta' },
  { id: 'e3', nome: 'Interessado', tipo: 'aberta' },
  { id: 'e4', nome: 'Ganho', tipo: 'ganho' },
  { id: 'e5', nome: 'Perdido', tipo: 'perdido' },
];

describe('configuração do agente', () => {
  it('desligado por padrão e aceita lixo', () => {
    expect(normalizarAcoesFunil(null).mover).toEqual({ ativo: false, etapas: [], quando: '' });
    expect(normalizarAcoesFunil({ mover: { ativo: true, etapas: ['e2', 'e2', 3, ''], quando: '  quando pedir preço ' } }).mover)
      .toEqual({ ativo: true, etapas: ['e2'], quando: 'quando pedir preço' });
  });

  it('Ganho/Perdido nunca entram na lista da IA, mesmo liberados', () => {
    const acoes = normalizarAcoesFunil({ mover: { ativo: true, etapas: ['e2', 'e3', 'e4', 'e5', 'apagada'] } });
    expect(etapasPermitidasIA(acoes, ETAPAS).map(e => e.id)).toEqual(['e2', 'e3']);
    expect(etapasPermitidasIA({ mover: { ...acoes.mover, ativo: false } }, ETAPAS)).toEqual([]);
  });
});

describe('decisão do pedido da IA', () => {
  const permitidas = ETAPAS.filter(e => e.id === 'e2' || e.id === 'e3');

  it('aceita pelo nome, sem acento e sem diferença de maiúscula', () => {
    const d = decidirMovimentoIA(permitidas, ETAPAS, 'e1', 'interessado');
    expect(d.ok && d.etapa.id).toBe('e3');
    expect(decidirMovimentoIA(permitidas, ETAPAS, null, 'e2').ok).toBe(true);
  });

  it('recusa fora da lista, etapa fechada e "já estava"', () => {
    expect(decidirMovimentoIA(permitidas, ETAPAS, 'e1', 'Novo lead')).toMatchObject({ ok: false, motivo: 'fora_da_lista' });
    expect(decidirMovimentoIA(permitidas, ETAPAS, 'e1', 'Ganho')).toMatchObject({ ok: false, motivo: 'etapa_fechada' });
    expect(decidirMovimentoIA(permitidas, ETAPAS, 'e1', 'Inventada')).toMatchObject({ ok: false, motivo: 'fora_da_lista' });
    expect(decidirMovimentoIA(permitidas, ETAPAS, 'e3', 'Interessado')).toMatchObject({ ok: false, motivo: 'ja_estava' });
  });
});

describe('ferramenta oferecida ao modelo', () => {
  it('só as etapas liberadas, como lista fechada, com a regra de quando usar', () => {
    const t = montarFerramentaMover(ETAPAS.slice(1, 3), 'pediu preço ou demonstração', ETAPAS[0])!;
    expect(t.name).toBe('mover_no_funil');
    expect(t.input_schema.properties.etapa.enum).toEqual(['Em conversa', 'Interessado']);
    expect(t.description).toContain('Etapa atual: "Novo lead"');
    expect(t.description).toContain('pediu preço ou demonstração');
    expect(montarFerramentaMover([], '', null)).toBeNull();
  });
});

describe('automações da etapa', () => {
  it('mantém só tipos conhecidos, no máximo 10', () => {
    const r = normalizarAutomacoes([
      { tipo: 'adicionar_etiqueta', etiqueta: ' quente ' },
      { tipo: 'definir_responsavel', responsavel: 'Ana', ativo: false },
      { tipo: 'apagar_tudo' },
      'lixo',
    ]);
    expect(r).toEqual([
      { tipo: 'adicionar_etiqueta', ativo: true, etiqueta: 'quente' },
      { tipo: 'definir_responsavel', ativo: false, responsavel: 'Ana' },
    ]);
    expect(normalizarAutomacoes(Array(15).fill({ tipo: 'adicionar_etiqueta', etiqueta: 'x' }))).toHaveLength(10);
    expect(normalizarAutomacoes({})).toEqual([]);
  });
});
