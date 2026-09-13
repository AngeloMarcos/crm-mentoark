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
// lista em vez de manter a própria cópia. `status`/`tags`/`notas`/`origem` (usados em Leads.tsx
// pro CRM em si) ficaram DE FORA de propósito: não fazem sentido como variável dentro de uma
// mensagem pro cliente, e a regra do usuário é estrita — só entra no modelo o que vira variável
// de verdade.
//
// [AUDITORIA] FIX APLICADO (revisão 2026-09-11, mesma sessão — achado real do usuário, print de
// Excel em PT-BR: "modelo esta vindo em csv bem mal estruturado e sem colunas... quero que faça
// em excel"): CSV puro quebra em qualquer Excel configurado em locale PT-BR — nesse locale a
// vírgula é o separador DECIMAL, então o Excel abre um CSV separado por vírgula como uma coluna
// só, sem nenhum split (exatamente o print do usuário: cabeçalho inteiro numa célula A1 só).
// Trocado por `.xlsx` de verdade via ExcelJS — chega já com colunas reais (não depende de
// nenhuma configuração regional pra separar), cabeçalho colorido (laranja para obrigatório,
// cinza para opcional — pedido explícito: "tabelas coloridas e padronizado"), largura de coluna
// ajustada, bordas, congelamento da 1ª linha e filtro automático.
import ExcelJS from "exceljs";

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
  /** Largura da coluna no Excel gerado (unidade ExcelJS ~ nº de caracteres). */
  largura: number;
}

export const CAMPOS_CONTATO: CampoContato[] = [
  { coluna: "nome", obrigatorio: true, label: "Nome", exemplo: "João Silva", largura: 24 },
  { coluna: "telefone", obrigatorio: true, label: "Telefone", exemplo: "11999999999", largura: 16 },
  { coluna: "email", obrigatorio: false, label: "E-mail", exemplo: "joao@email.com", largura: 26 },
  { coluna: "cidade", obrigatorio: false, label: "Cidade", exemplo: "São Paulo", largura: 16 },
  { coluna: "estado", obrigatorio: false, label: "Estado (UF)", exemplo: "SP", largura: 12 },
  { coluna: "interesse", obrigatorio: false, label: "Interesse", exemplo: "Consórcio de imóvel", largura: 24 },
  { coluna: "data_nascimento", obrigatorio: false, label: "Data de nascimento", exemplo: "12/05/1990", largura: 18 },
  { coluna: "empresa", obrigatorio: false, label: "Empresa", exemplo: "Empresa XYZ Ltda", largura: 24 },
  { coluna: "cargo", obrigatorio: false, label: "Cargo", exemplo: "Gerente Financeiro", largura: 20 },
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

// [AUDITORIA] LÓGICA (melhoria Preview de Template, 2026-09-13 — achado numa revisão pedida pelo
// usuário): contato fictício pra prévia de mensagem resolver `{{variável}}` de verdade em vez de
// mostrar a sintaxe crua — usa os MESMOS valores de `exemplo` já definidos acima (linha "tudo
// preenchido" do modelo baixável), então o exemplo do preview e o exemplo da planilha nunca
// divergem sozinhos. Antes desta revisão, `Disparos.tsx` tinha uma cópia solta desse objeto
// (faltando `cargo`) e `DisparoTemplateEditor.tsx` não resolvia variável nenhuma no preview —
// mostrava `{{primeiro_nome}}`/`{{empresa}}` literais na bolha de WhatsApp simulada.
export const CONTATO_EXEMPLO: Record<string, string> = Object.fromEntries(
  CAMPOS_CONTATO.map(c => [c.coluna, c.exemplo]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Paleta — mesmo laranja de marca usado nos botões primários do CRM (ver index.css / gradient-brand)
// ─────────────────────────────────────────────────────────────────────────────
const COR_OBRIGATORIO = "F97316"; // laranja — coluna que precisa vir preenchida
const COR_OPCIONAL = "475569"; // slate escuro — coluna opcional
const COR_TEXTO_HEADER = "FFFFFF";
const COR_EXEMPLO_FUNDO = "F8FAFC"; // cinza quase branco — linha de exemplo, não é dado real
const COR_EXEMPLO_TEXTO = "64748B";
const COR_BORDA = "CBD5E1";

const bordaFina = {
  top: { style: "thin" as const, color: { argb: `FF${COR_BORDA}` } },
  left: { style: "thin" as const, color: { argb: `FF${COR_BORDA}` } },
  bottom: { style: "thin" as const, color: { argb: `FF${COR_BORDA}` } },
  right: { style: "thin" as const, color: { argb: `FF${COR_BORDA}` } },
};

/** Dispara o download de um Blob gerado (mesmo padrão de anchor+click já usado no resto do sistema). */
function baixarBlob(nomeArquivo: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Baixa o modelo de planilha de contatos em .xlsx — mesmas colunas aceitas por Leads.tsx e
 * Disparos.tsx (ambos leem pra tabela `contatos`), cada uma com a variável `{{...}}` de mesmo
 * nome disponível no editor de template. Cabeçalho colorido (laranja = obrigatório, cinza =
 * opcional, com nota explicando o porquê em cada uma dessas 2 células), 2 linhas de exemplo
 * (uma com tudo preenchido, outra só com o mínimo obrigatório) marcadas visualmente como
 * exemplo, filtro automático e 1ª linha congelada.
 */
export async function baixarModeloContatosXLSX(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MentoArk CRM";
  wb.created = new Date();

  const ws = wb.addWorksheet("Contatos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = CAMPOS_CONTATO.map(c => ({ header: c.coluna, width: c.largura }));

  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  CAMPOS_CONTATO.forEach((campo, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = campo.coluna;
    cell.font = { bold: true, color: { argb: `FF${COR_TEXTO_HEADER}` }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${campo.obrigatorio ? COR_OBRIGATORIO : COR_OPCIONAL}` } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = bordaFina;
    if (campo.obrigatorio) {
      cell.note = {
        texts: [{ text: `Obrigatório — sem "${campo.coluna}" preenchido essa linha não entra na importação.` }],
      } as ExcelJS.Comment;
    } else {
      cell.note = { texts: [{ text: `Opcional — vira a variável {{${campo.coluna}}} disponível nos templates de Disparos.` }] } as ExcelJS.Comment;
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CAMPOS_CONTATO.length } };

  // Linha 2 — exemplo com todos os campos preenchidos. Linha 3 — só o mínimo obrigatório (deixa
  // claro que o resto é opcional sem precisar de outro texto de ajuda fora da planilha).
  const linhaCompleta = ws.addRow(CAMPOS_CONTATO.map(c => c.exemplo));
  const linhaMinima = ws.addRow(CAMPOS_CONTATO.map(c => c.obrigatorio ? (c.coluna === "nome" ? "Maria Souza" : "21988887777") : ""));
  for (const row of [linhaCompleta, linhaMinima]) {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { italic: true, color: { argb: `FF${COR_EXEMPLO_TEXTO}` } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COR_EXEMPLO_FUNDO}` } };
      cell.border = bordaFina;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  baixarBlob("modelo_importacao_contatos.xlsx", new Blob([buffer], { type: MIME_XLSX }));
}

/** Cabeçalho canônico de importação de produtos do Catálogo — mesmas colunas já documentadas em `ImportExcelModal.tsx`. */
interface CampoProduto { coluna: string; obrigatorio: boolean; exemplo: string; largura: number }
const CAMPOS_PRODUTO: CampoProduto[] = [
  { coluna: "nome", obrigatorio: true, exemplo: "Consórcio de Imóvel 200 parcelas", largura: 32 },
  { coluna: "descricao", obrigatorio: false, exemplo: "Carta de crédito para compra de imóvel", largura: 40 },
  { coluna: "preco", obrigatorio: false, exemplo: "1500.00", largura: 12 },
  { coluna: "codigo", obrigatorio: false, exemplo: "COD-001", largura: 14 },
  { coluna: "estoque", obrigatorio: false, exemplo: "50", largura: 10 },
];

/** Baixa o modelo de planilha de produtos do Catálogo, em .xlsx — mesmo padrão visual do modelo de contatos. */
export async function baixarModeloProdutosXLSX(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MentoArk CRM";
  wb.created = new Date();

  const ws = wb.addWorksheet("Produtos", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = CAMPOS_PRODUTO.map(c => ({ header: c.coluna, width: c.largura }));

  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  CAMPOS_PRODUTO.forEach((campo, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = campo.coluna;
    cell.font = { bold: true, color: { argb: `FF${COR_TEXTO_HEADER}` }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${campo.obrigatorio ? COR_OBRIGATORIO : COR_OPCIONAL}` } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = bordaFina;
    if (campo.obrigatorio) {
      cell.note = { texts: [{ text: `Obrigatório — sem "${campo.coluna}" preenchido o produto não é importado.` }] } as ExcelJS.Comment;
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CAMPOS_PRODUTO.length } };

  const linhaExemplo = ws.addRow(CAMPOS_PRODUTO.map(c => c.exemplo));
  linhaExemplo.eachCell({ includeEmpty: true }, cell => {
    cell.font = { italic: true, color: { argb: `FF${COR_EXEMPLO_TEXTO}` } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COR_EXEMPLO_FUNDO}` } };
    cell.border = bordaFina;
  });

  const buffer = await wb.xlsx.writeBuffer();
  baixarBlob("modelo_importacao_produtos.xlsx", new Blob([buffer], { type: MIME_XLSX }));
}
