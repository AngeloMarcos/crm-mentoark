// [AUDITORIA] LÓGICA (Sprint Padronizar Planilhas, 2026-09-11 — pedido do usuário: "precisamos
// padronizar as planilhas e criar um modelo de importação"): antes desta sprint, NENHUM dos 3
// pontos de import de planilha do sistema (Leads.tsx → contatos, Disparos.tsx → alvo de
// campanha, ImportExcelModal.tsx → catálogo/produtos) tinha um arquivo de modelo pra baixar — o
// operador tinha que adivinhar o nome das colunas só pelo texto de ajuda do modal. Os dois
// primeiros já importam pra MESMA tabela (`contatos`), mas com parsers levemente diferentes
// (sinônimos de coluna aceitos não eram idênticos) — este módulo não reescreve os parsers (risco
// alto mexer em import de dado real de cliente), só fixa e exporta o CABEÇALHO CANÔNICO
// compartilhado, pra qualquer novo "Baixar modelo" gerar sempre a mesma planilha.
//
// [AUDITORIA] LÓGICA (revisão 2026-09-11, mesma sessão — pedido do usuário: "todas as colunas da
// planilha tem que ser uma variavel do sistema... nome e telefone é obrigatorios... quando formos
// adicionar a variavel no template tem que ser a mesma variavel dessa coluna"): `CAMPOS_CONTATO`
// abaixo é a ÚNICA fonte de verdade — cada entrada é ao mesmo tempo (1) uma coluna do modelo
// baixável, (2) a variável `{{...}}` correspondente em `motorTexto.ts` (mesmo nome, sempre) e (3)
// um dos botões "Inserir variável" em Disparos.tsx/DisparoTemplateEditor.tsx, que importam esta
// lista em vez de manter a própria cópia — sem isso, as 3 pontas divergem de novo com o tempo,
// exatamente o problema que motivou esta sprint. `status`/`tags`/`notas`/`origem` (usados em
// Leads.tsx pro CRM em si) ficaram DE FORA de propósito: não fazem sentido como variável dentro de
// uma mensagem pro cliente, e a regra do usuário é estrita — só entra no modelo o que vira
// variável de verdade.

/** Uma coluna do modelo de planilha de contatos — sempre com uma variável `{{...}}` de mesmo nome. */
export interface CampoContato {
  /** Nome da coluna na planilha E nome da variável (`{{coluna}}`) — sempre idênticos, de propósito. */
  coluna: string;
  /** `true` pros 2 campos sem os quais não dá pra disparar mensagem nenhuma (sem telefone não tem
   *  pra quem mandar; sem nome, {{nome}}/{{primeiro_nome}} saem vazios pra praticamente todo
   *  contato da planilha — mensagem sem personalização nenhuma). */
  obrigatorio: boolean;
  label: string;
  /** Valor de exemplo na linha "tudo preenchido" do modelo. */
  exemplo: string;
}

export const CAMPOS_CONTATO: CampoContato[] = [
  { coluna: "nome", obrigatorio: true, label: "Nome", exemplo: "João Silva" },
  { coluna: "telefone", obrigatorio: true, label: "Telefone", exemplo: "11999999999" },
  { coluna: "email", obrigatorio: false, label: "E-mail", exemplo: "joao@email.com" },
  { coluna: "cidade", obrigatorio: false, label: "Cidade", exemplo: "São Paulo" },
  { coluna: "estado", obrigatorio: false, label: "Estado (UF)", exemplo: "SP" },
  { coluna: "interesse", obrigatorio: false, label: "Interesse", exemplo: "Consórcio de imóvel" },
  { coluna: "data_nascimento", obrigatorio: false, label: "Data de nascimento", exemplo: "12/05/1990" },
  { coluna: "empresa", obrigatorio: false, label: "Empresa", exemplo: "Empresa XYZ Ltda" },
  { coluna: "cargo", obrigatorio: false, label: "Cargo", exemplo: "Gerente Financeiro" },
];

/** `{{variavel}}` pronta pra inserir num template — mesmo texto usado pelos botões "Inserir variável". */
export function variavelDoCampo(campo: CampoContato): string {
  return `{{${campo.coluna}}}`;
}

// [AUDITORIA] LÓGICA (Sprint Padronizar Planilhas — Variáveis, 2026-09-11): lista única de botões
// "Inserir variável", importada por Disparos.tsx (StepMessage) e DisparoTemplateEditor.tsx — as
// duas telas que hoje oferecem esse botão. `{{primeiro_nome}}` e `{{data}}` são as 2 únicas
// variáveis SEM coluna própria na planilha (derivadas: primeiro nome extraído de `nome`; `data` é
// a data do envio, não um dado do contato) — mantidas aqui, na mesma lista, pra quem for inserir
// uma variável não precisar pensar "essa é de coluna ou derivada", só ver todas juntas.
export const VARIAVEIS_MENSAGEM_CONTATO: string[] = [
  "{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{data}}",
  ...CAMPOS_CONTATO.filter(c => c.coluna !== "nome" && c.coluna !== "telefone").map(variavelDoCampo),
];

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
export const COLUNAS_MODELO_CONTATOS = CAMPOS_CONTATO.map(c => c.coluna);

/**
 * Baixa o modelo de planilha de contatos — mesmas colunas aceitas por Leads.tsx e Disparos.tsx
 * (ambos leem pra tabela `contatos`), cada uma com a variável `{{...}}` de mesmo nome disponível
 * no editor de template. Duas linhas de exemplo: uma com todos os campos preenchidos, outra só
 * com os 2 obrigatórios (nome + telefone) — deixa claro que o resto é opcional sem precisar de
 * outro texto de ajuda.
 */
export function baixarModeloContatosCSV(): void {
  // [AUDITORIA] BUG EVITADO: header PRECISA ser o nome exato da coluna, sem marcador nenhum de
  // "obrigatório" (ex: "nome*") — Leads.tsx (`importarCSV`, `get()`) casa o cabeçalho por
  // igualdade exata, então um asterisco colado quebraria a reimportação do próprio modelo que
  // este arquivo gera. "Obrigatório" é comunicado só no texto de ajuda ao lado do botão, nunca no
  // cabeçalho em si.
  const header = CAMPOS_CONTATO.map(c => c.coluna);
  const linhaCompleta = CAMPOS_CONTATO.map(c => c.exemplo);
  const linhaMinima = CAMPOS_CONTATO.map(c => c.obrigatorio ? (c.coluna === "nome" ? "Maria Souza" : "21988887777") : "");
  baixarCsv("modelo_importacao_contatos.csv", [header, linhaCompleta, linhaMinima]);
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
