import { extrairLinks, LinkGrupo } from './extrairLinks';

export interface LinhaImportada {
  link: LinkGrupo;
  nome: string | null;
  nicho: string | null;
  regiao: string | null;
  linha: number;
}

export interface ResultadoImportacao {
  itens: LinhaImportada[];
  duplicados: number;
  semLink: number;
}

/** Divide o CSV respeitando aspas. Detecta ; ou , como separador pela primeira linha. */
export function parseCsv(texto: string): string[][] {
  const limpo = texto.replace(/^﻿/, '');
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpo[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(x => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some(x => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const achar = (cab: string[], ...nomes: string[]) => cab.findIndex(h => nomes.some(n => norm(h).includes(n)));

/** Lê um CSV de grupos (qualquer coluna com link de convite). Cabeçalhos nome/nicho/região são opcionais. */
export function importarCsv(texto: string): ResultadoImportacao {
  const linhas = parseCsv(texto);
  const res: ResultadoImportacao = { itens: [], duplicados: 0, semLink: 0 };
  if (!linhas.length) return res;
  const cab = linhas[0];
  const temCabecalho = !cab.some(c => extrairLinks(c).length);
  const iNome = temCabecalho ? achar(cab, 'nome', 'grupo', 'titulo') : -1;
  const iNicho = temCabecalho ? achar(cab, 'nicho', 'categoria', 'segmento') : -1;
  const iRegiao = temCabecalho ? achar(cab, 'regiao', 'cidade', 'estado', 'local') : -1;
  const vistos = new Set<string>();

  linhas.slice(temCabecalho ? 1 : 0).forEach((cols, idx) => {
    const numero = idx + (temCabecalho ? 2 : 1);
    const links = extrairLinks(cols.join(' '));
    if (!links.length) { res.semLink++; return; }
    for (const link of links) {
      const chave = `${link.plataforma}:${link.codigo}`;
      if (vistos.has(chave)) { res.duplicados++; continue; }
      vistos.add(chave);
      const pega = (i: number) => (i >= 0 && cols[i]?.trim() ? cols[i].trim() : null);
      res.itens.push({ link, nome: pega(iNome), nicho: pega(iNicho), regiao: pega(iRegiao), linha: numero });
    }
  });
  return res;
}
