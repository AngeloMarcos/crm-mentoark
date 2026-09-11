// [AUDITORIA] LÓGICA (Sprint Padronizar Planilhas, 2026-09-11 — pedido do usuário: "precisamos
// padronizar as planilhas e criar um modelo de importação"): antes desta sprint, NENHUM dos 3
// pontos de import de planilha do sistema (Leads.tsx → contatos, Disparos.tsx → alvo de
// campanha, ImportExcelModal.tsx → catálogo/produtos) tinha um arquivo de modelo pra baixar — o
// operador tinha que adivinhar o nome das colunas só pelo texto de ajuda do modal. Os dois
// primeiros já importam pra MESMA tabela (`contatos`), mas com parsers levemente diferentes
// (sinônimos de coluna aceitos não eram idênticos) — este módulo não reescreve os parsers (risco
// alto mexer em import de dado real de cliente), só fixa e exporta o CABEÇALHO CANÔNICO
// compartilhado, pra qualquer novo "Baixar modelo" gerar sempre a mesma planilha, e pra futuras
// telas de import reaproveitarem em vez de reinventar o próprio formato.
//
// Colunas de contato = exatamente as já documentadas em Leads.tsx ("2. Exportação do próprio
// CRM") e usadas por `exportarCsv` (Leads.tsx) — não é uma lista nova, é a que já era o padrão de
// fato, só nunca tinha virado um arquivo baixável.

/** Gera e dispara o download de um arquivo CSV (mesmo padrão de `exportarCsv`, Leads.tsx). */
function baixarCsv(nomeArquivo: string, linhas: string[][]): void {
  const csv = linhas
    .map(linha => linha.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  // BOM (﻿) — sem ele, Excel no Windows abre acento/ç como caractere quebrado.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Cabeçalho canônico de importação/exportação de contatos — usado por Leads e Disparos. */
export const COLUNAS_MODELO_CONTATOS = [
  "nome", "telefone", "email", "empresa", "cargo", "origem", "status", "tags", "notas",
] as const;

const EXEMPLOS_MODELO_CONTATOS: string[][] = [
  ["João Silva", "11999999999", "joao@email.com", "Empresa XYZ Ltda", "Gerente Financeiro", "Instagram", "novo", "vip;consorcio", "Pediu retorno no fim do dia"],
  ["Maria Souza", "21988887777", "", "", "", "Indicação", "novo", "", ""],
];

/**
 * Baixa o modelo de planilha de contatos — mesmas colunas aceitas por Leads.tsx e Disparos.tsx
 * (ambos leem pra tabela `contatos`). Duas linhas de exemplo: uma com todos os campos
 * preenchidos, outra só com o mínimo obrigatório (nome + telefone) — deixa claro que o resto é
 * opcional sem precisar de outro texto de ajuda.
 */
export function baixarModeloContatosCSV(): void {
  baixarCsv("modelo_importacao_contatos.csv", [[...COLUNAS_MODELO_CONTATOS], ...EXEMPLOS_MODELO_CONTATOS]);
}

/** Cabeçalho canônico de importação de produtos do Catálogo — mesmas colunas já documentadas em `ImportExcelModal.tsx`. */
export const COLUNAS_MODELO_PRODUTOS = ["nome", "descricao", "preco", "codigo", "estoque"] as const;

const EXEMPLOS_MODELO_PRODUTOS: string[][] = [
  ["Consórcio de Imóvel 200 parcelas", "Carta de crédito para compra de imóvel", "1500.00", "COD-001", "50"],
];

/** Baixa o modelo de planilha de produtos do Catálogo. */
export function baixarModeloProdutosCSV(): void {
  baixarCsv("modelo_importacao_produtos.csv", [[...COLUNAS_MODELO_PRODUTOS], ...EXEMPLOS_MODELO_PRODUTOS]);
}
