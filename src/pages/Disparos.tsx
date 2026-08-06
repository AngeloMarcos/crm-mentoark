import { useState, useMemo, useEffect } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ShieldCheck, ShieldAlert, Shield, Play, Pause, Square,
  Settings2, AlertOctagon, RefreshCw, Users, Upload,
  Clock, Calendar, MessageSquare, Image as ImageIcon,
  FileText, Headphones, AlertTriangle, CheckCircle2,
  Table as TableIcon, Send, XCircle, Activity, AlertCircle,
  LayoutTemplate, Loader2, Save, Trash2, Pencil
} from "lucide-react";
import { toast } from "sonner";
import { api, getFreshToken } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { useStatusEnvio, chaveTelefone } from "@/hooks/useStatusEnvio";
import { TagStatusEnvio } from "@/components/TagStatusEnvio";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

// [AUDITORIA] BUG (Sprint Disparos/Importação, revisão 2026-07-25): usuário reportou nomes
// corrompidos na importação real (ex: "GraÃ§a" em vez de "Graça", "JosÃ©" em vez de "José") —
// assinatura clássica de um CSV exportado pelo Excel em Windows-1252/"ANSI" (o padrão do Excel
// pt-BR pra "Salvar como > CSV", não "CSV UTF-8") sendo decodificado como se fosse UTF-8.
// `file.text()` SEMPRE decodifica como UTF-8 (é fixo na spec do navegador, não dá pra escolher
// outra codificação com esse método) — não tem como esse método sozinho ler um arquivo
// Windows-1252 corretamente. [AUDITORIA] FIX APLICADO: lê o arquivo como bytes crus
// (`arrayBuffer`) e tenta decodificar como UTF-8 estrito (`fatal: true`); bytes acentuados em
// Windows-1252 (ex: "ç" = 0xE7 sozinho) não formam uma sequência UTF-8 válida e o decoder estoura
// — nesse caso, cai pro fallback Windows-1252, que sempre decodifica com sucesso (todo byte
// 0-255 mapeia pra algum caractere nessa codificação) e é o padrão de fato do Excel brasileiro.
function decodeTextoTolerante(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

// [AUDITORIA] LÓGICA (Sprint Disparos/Importação, 2026-07-25): parser de CSV tolerante — separa
// campos por vírgula OU ponto e vírgula (detecta o delimitador pela linha de cabeçalho, contando
// qual aparece mais vezes: exportações de Excel em pt-BR costumam usar ";"), e remove aspas duplas
// que envelopam valores (inclusive `""` escapado dentro de um campo entre aspas). Usado só pra CSV
// — XLSX/XLS é lido nativamente via XLSX.read + sheet_to_json (ver handleImportFile), sem precisar
// desse parser.
function parseCsvRowsTolerante(text: string): string[][] {
  // [AUDITORIA] FIX APLICADO (Sprint Disparos/Importação, revisão 2026-07-25): CSV exportado pelo
  // Excel em "UTF-8 com BOM" começa com o caractere invisível BOM (code point U+FEFF, decimal
  // 65279), que gruda no primeiro cabeçalho (ex: vira "<BOM>Nome Completo") e faz o mapeamento de
  // coluna por nome falhar silenciosamente pra esse campo específico. Removido via
  // String.fromCharCode(65279) em vez de um caractere/escape literal no código-fonte — invisível
  // direto no arquivo é frágil (fácil de corromper sem perceber num editor ou diff).
  const BOM = String.fromCharCode(65279);
  const clean = (text.startsWith(BOM) ? text.slice(BOM.length) : text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const firstLine = clean.split("\n", 1)[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delim = semiCount > commaCount ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      row.push(cur.trim()); cur = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(cur.trim()); cur = "";
      if (row.some(c => c.length > 0)) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur.trim());
    if (row.some(c => c.length > 0)) rows.push(row);
  }
  return rows;
}

interface TelefoneImportado {
  telefone: string | null; // já com DDI 55, ou null se descartado
  corrigido: boolean;      // true se o 55 e/ou o 9º dígito foram adicionados automaticamente
}

// [AUDITORIA] LÓGICA (Sprint Disparos/Importação, 2026-07-25): sanitização de telefone própria
// desta tela — DELIBERADAMENTE diferente de `normalizarTelefoneBR` (src/lib/phone.ts, usada por
// Leads.tsx e pelo motor de disparo/whatsapp). Aquela função rejeita fixos e exige formato exato
// de celular (9 dígitos após o DDD); aqui a instrução explícita foi "nunca descartar um lead" a
// não ser por telefone com menos de 10 dígitos após a sanitização — ou seja, mais permissiva de
// propósito, pra não perder contatos importados por um filtro rígido demais. Não é duplicação por
// descuido: é uma política de validação diferente para este fluxo específico de importação.
function sanitizarTelefoneImportacao(raw: string): TelefoneImportado {
  // [AUDITORIA] FIX APLICADO (2026-07-29): coluna de origem pode trazer mais de um telefone na
  // mesma célula (ex: campo "telefones" plural de exportação de CNPJ, um por sócio/filial/contato).
  // Sem isolar o primeiro valor antes de tirar os separadores, `replace(/\D/g,'')` colava os
  // números um no outro (ex: "11 2222-2222, 11 98765-4321" virava "112222222211987654321", 21
  // dígitos) — que passava pelo único critério de descarte anterior (<10 dígitos) como um
  // telefone "válido" gigante, e ia pro disparo real como lixo. Pega só o primeiro valor quando
  // há mais de um separado por vírgula, ponto e vírgula, barra, pipe ou quebra de linha.
  const primeiro = (raw || "").split(/[,;/|\n]+/)[0] || "";
  const d = primeiro.replace(/\D/g, "");
  if (d.length < 10) return { telefone: null, corrigido: false };
  // Acima de 13 dígitos não existe telefone brasileiro válido (55 + DDD + 9 dígitos). Mesmo após
  // isolar o primeiro valor acima, um separador fora da lista (ex: só espaço) ainda pode ter
  // colado dois números — descarta em vez de importar um valor que só vai falhar no envio.
  if (d.length > 13) return { telefone: null, corrigido: false };

  // Já tem DDI 55 (12 ou 13 dígitos) — mantém como está.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) {
    return { telefone: d, corrigido: false };
  }

  // 10 ou 11 dígitos sem DDI — insere o 9º dígito preventivamente (celular antigo: DDD + 8
  // dígitos começando em 6-9) antes de adicionar o "55" na frente.
  if (d.length === 10 || d.length === 11) {
    const ddd = d.slice(0, 2);
    let resto = d.slice(2);
    if (resto.length === 8 && /^[6-9]/.test(resto)) {
      resto = "9" + resto;
    }
    return { telefone: "55" + ddd + resto, corrigido: true };
  }

  // Comprimento fora do esperado mas dentro do teto de 13 (ex: 12/13 dígitos sem começar com 55)
  // — não descarta, mantém os dígitos como vieram.
  return { telefone: d, corrigido: false };
}

interface ContatoImportado {
  nome: string; telefone: string; email: string; empresa: string; cargo: string; notas: string;
}

interface LinhaSuspeita { linha: number; motivo: string }

interface AnaliseImportacao {
  novos: ContatoImportado[];
  totalLinhas: number;
  corrigidos: number;
  descartados: number;
  suspeitos: LinhaSuspeita[];
}

// [AUDITORIA] LÓGICA (Sprint Importação Upsert, 2026-08-06): DDDs brasileiros válidos hoje — lista
// fechada (não "adivinhada" por faixa contínua, já que a numeração real tem buracos: não existe
// DDD 20, 23(SP não usa), 26, 29, 30, 36, 39, 40, 50, 52, 56-60, 70, 72, 76, 78, 80, 83... alguns
// desses na real existem — por isso a lista é explícita, conferida, não uma regex de faixa).
const DDDS_BRASIL_VALIDOS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24",
  "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

// [AUDITORIA] LÓGICA (Sprint Importação Upsert, 2026-08-06): validação de linha suspeita — só
// regras determinísticas, sem IA, decisão explícita do usuário (custo zero por importação, motivada
// pelo incidente de esgotamento de crédito OpenAI já registrado em AUDITORIA_LOG.md). Sinaliza,
// nunca bloqueia — a linha sinalizada continua entrando em `novos` normalmente.
function nomePareceTelefone(nome: string): boolean {
  const limpo = nome.replace(/[\s.\-()]/g, "");
  return limpo.length >= 8 && /^\d+$/.test(limpo);
}

function telefoneParecePlaceholder(telefone: string): boolean {
  // Ignora o prefixo DDI "55" fixo pra não confundir esses 2 dígitos repetidos com o padrão —
  // o que importa é DDD+número, que é o que a planilha realmente "digitou" errado/de teste.
  const digitos = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  if (digitos.length < 8) return false;
  if (/^(\d)\1+$/.test(digitos)) return true; // todos os dígitos iguais (ex: 11111111111)
  // Sequência ascendente/descendente de 6+ dígitos CONSECUTIVOS em qualquer trecho do número
  // (não precisa ser o número inteiro) — cobre "12345678900" e também um número real com um
  // trecho de teste colado no meio. 6 dígitos seguidos em ordem é praticamente impossível por
  // acaso num telefone real.
  let runAsc = 1, runDesc = 1;
  for (let i = 1; i < digitos.length; i++) {
    const anterior = Number(digitos[i - 1]);
    const atual = Number(digitos[i]);
    runAsc = atual === anterior + 1 ? runAsc + 1 : 1;
    runDesc = atual === anterior - 1 ? runDesc + 1 : 1;
    if (runAsc >= 6 || runDesc >= 6) return true;
  }
  return false;
}

function dddInvalido(telefone: string): string | null {
  // Só valida quando o formato bate exatamente com o que `sanitizarTelefoneImportacao` produz
  // pra um celular/fixo brasileiro normal (55 + DDD + número, 12 ou 13 dígitos) — telefone fora
  // desse formato (o caso raro "mantém como veio" da sanitização) não tem DDD confiável pra
  // checar, e sinalizar nesse caso daria falso positivo.
  if (!telefone.startsWith("55") || (telefone.length !== 12 && telefone.length !== 13)) return null;
  const ddd = telefone.slice(2, 4);
  return DDDS_BRASIL_VALIDOS.has(ddd) ? null : ddd;
}

// [AUDITORIA] LÓGICA (Sprint Disparos/Importação, revisão 2026-07-25): extraída de dentro de
// `confirmarImportacao` pra ser compartilhada com o resumo de pré-validação mostrado assim que o
// arquivo é lido (antes de clicar "Confirmar Importação") — usuário reportou achar que a
// importação estava "trazendo contatos com telefone vazio" porque a PREVIEW (5 primeiras linhas
// cruas do arquivo, sem filtro nenhum) mostra o telefone em branco tal como está no arquivo; o
// filtro de verdade só acontecia no clique de confirmar, sem nenhum retorno visual antes disso.
// Mesma função agora roda nos dois lugares — sem duplicar a regra de validação, e garantindo que
// o número mostrado no resumo bate exatamente com o que será importado de fato.
function analisarLinhasImportacao(rows: string[][]): AnaliseImportacao {
  const headers = rows[0].map(h => (h || "").toLowerCase().trim());
  // [AUDITORIA] FIX APLICADO (2026-07-29): antes só existia o passo de "contém" — numa planilha
  // com colunas qualificadas (ex: exportação de CNPJ com "porte_empresa" e sem nenhuma coluna
  // literal "empresa"), a chave genérica "empresa" batia em "porte_empresa" por substring e trazia
  // o porte (ME/EPP/...) pro campo empresa em vez do nome de verdade. Passo extra de match EXATO
  // primeiro — só cai pro "contém" (mantido por compatibilidade com arquivos que já funcionavam)
  // quando nenhuma coluna bate igual à chave.
  const getPorSubstring = (cols: string[], ...keys: string[]) => {
    for (const key of keys) {
      const idx = headers.findIndex(h => h === key);
      if (idx >= 0 && cols[idx]) return cols[idx];
    }
    for (const key of keys) {
      const idx = headers.findIndex(h => h.includes(key));
      if (idx >= 0 && cols[idx]) return cols[idx];
    }
    return "";
  };

  const totalLinhas = rows.length - 1;
  let corrigidos = 0;
  let descartados = 0;
  const novos: ContatoImportado[] = [];
  const suspeitos: LinhaSuspeita[] = [];
  // [AUDITORIA] LÓGICA (Sprint Importação Upsert, 2026-08-06): telefone (já sanitizado) -> linhas
  // onde apareceu — detecta duplicata DENTRO do próprio arquivo depois do loop principal. Hoje
  // isso silenciosamente virava 2 tentativas de insert pro mesmo (user_id, telefone); com o
  // upsert de `/importar-lote` (backend) isso não quebra mais o lote, mas o operador continua sem
  // saber que a planilha tinha duplicata interna — vale sinalizar mesmo assim.
  const linhasPorTelefone = new Map<string, number[]>();

  for (let i = 1; i < rows.length; i++) {
    const cols = (rows[i] || []).map(c => (c || "").replace(/^["']|["']$/g, "").trim());
    const telefoneRaw = getPorSubstring(cols, "telefone", "celular", "whatsapp", "phone", "mobile", "tel", "fone", "contato");
    const { telefone, corrigido } = sanitizarTelefoneImportacao(telefoneRaw);

    // [AUDITORIA] LÓGICA: único critério de descarte é telefone inválido (<10 dígitos após
    // sanitização) — nome, e-mail e demais campos vazios NUNCA descartam o lead, só ficam
    // em branco no contato criado.
    if (!telefone) {
      descartados++;
      continue;
    }
    if (corrigido) corrigidos++;

    const nome = getPorSubstring(cols, "nome completo", "nome", "cliente", "name");
    // [AUDITORIA] LÓGICA: contatos.cpf não existe como coluna própria (confirmado por grep em
    // migrations.ts) — CPF, quando presente na planilha, é preservado em `notas` em vez de
    // descartado, sem exigir migração de schema pra este sprint.
    const cpf = getPorSubstring(cols, "cpf", "documento");
    // [AUDITORIA] FIX APLICADO (2026-07-29): usuário reportou que planilhas de empresas/CNPJ
    // (ex: import "cnpj_biz") perdiam profissão/atividade e várias outras colunas relevantes —
    // `contatos` só tem campos pra nome/telefone/email/empresa/cargo/notas, então qualquer coisa
    // sem chave reconhecida era descartada em silêncio. Amplia as chaves de "cargo" pra cobrir
    // ramo/atividade de negócio (planilha de empresa não tem "cargo" de pessoa, mas atividade
    // principal cumpre um papel parecido pra segmentar a campanha) e captura CNPJ/sócios/
    // atividade/endereço/natureza jurídica/porte em `notas` quando existirem — mesmo padrão já
    // usado pro CPF, sem exigir migração de schema.
    const cnpj = getPorSubstring(cols, "cnpj");
    const socios = getPorSubstring(cols, "socios", "sócios", "socio", "sócio");
    const atividade = getPorSubstring(cols, "atividades_principal", "atividade principal", "atividade", "cnae", "segmento", "ramo");
    const naturezaJuridica = getPorSubstring(cols, "natureza_juridica", "natureza jurídica");
    const porte = getPorSubstring(cols, "porte_empresa", "porte");
    const endereco = [
      getPorSubstring(cols, "logradouro"),
      getPorSubstring(cols, "numero", "número"),
      getPorSubstring(cols, "bairro"),
      getPorSubstring(cols, "municipio", "município"),
      getPorSubstring(cols, "estado", "uf"),
    ].filter(Boolean).join(", ");

    const notasExtra: string[] = [];
    if (cpf) notasExtra.push(`CPF: ${cpf}`);
    if (cnpj) notasExtra.push(`CNPJ: ${cnpj}`);
    if (socios) notasExtra.push(`Sócios: ${socios}`);
    if (naturezaJuridica) notasExtra.push(`Natureza jurídica: ${naturezaJuridica}`);
    if (porte) notasExtra.push(`Porte: ${porte}`);
    if (endereco) notasExtra.push(`Endereço: ${endereco}`);

    // [AUDITORIA] BUG (achado real — campanha "Importação cnpj_biz" já enviada em produção,
    // 2026-08-05): planilha de CNPJ/empresa não tem coluna de nome de PESSOA, só razão
    // social/nome fantasia (que só ia pro campo `empresa`) — `nome` ficava vazio e caía direto
    // pro fallback `nome || telefone`, então o "nome" do contato virava o próprio telefone.
    // `substituirPlaceholders()` não tinha nenhuma proteção contra isso, e `{{primeiro_nome}}`/
    // `{{nome}}` substituíam pelo telefone cru na mensagem real ("Oi 5511984849872, tudo
    // tranquilo?"). [AUDITORIA] FIX APLICADO: `empresa` extraída ANTES do `push()` (não mais
    // inline) pra poder entrar no fallback de `nome` — planilha de empresa sem nome de pessoa
    // agora usa a razão social/nome fantasia como "nome" do contato, só caindo pro telefone cru
    // quando NEM ISSO existir. Segunda camada de proteção (pro caso de nome==telefone escapar
    // mesmo assim, ou já existir na base de dados anterior) em `substituirPlaceholders()`, abaixo.
    const empresa = getPorSubstring(cols, "razão social", "razao_social", "nome fantasia", "nome_fantasia", "empresa", "company");
    const nomeFinal = nome || empresa || telefone;
    novos.push({
      nome: nomeFinal,
      telefone,
      email: getPorSubstring(cols, "e-mail", "email", "mail"),
      empresa,
      cargo: getPorSubstring(cols, "cargo", "função", "role", "profissão", "profissao") || atividade,
      notas: notasExtra.join(" | "),
    });

    // [AUDITORIA] LÓGICA (Sprint Importação Upsert, 2026-08-06): validação determinística de linha
    // suspeita, sem IA (decisão explícita — custo zero por importação). Sinaliza, nunca descarta;
    // a linha já entrou em `novos` acima igual antes.
    const linha = i + 1; // linha 1 = cabeçalho, primeira linha de dado = linha 2
    const motivos: string[] = [];
    if (nomePareceTelefone(nomeFinal)) motivos.push("nome parece ser um telefone");
    if (telefoneParecePlaceholder(telefone)) motivos.push("telefone com padrão de teste/placeholder (dígitos repetidos ou sequência óbvia)");
    const dddSuspeito = dddInvalido(telefone);
    if (dddSuspeito) motivos.push(`DDD ${dddSuspeito} fora da lista de DDDs brasileiros válidos`);
    if (motivos.length) suspeitos.push({ linha, motivo: motivos.join("; ") });

    const linhasExistentes = linhasPorTelefone.get(telefone) || [];
    linhasExistentes.push(linha);
    linhasPorTelefone.set(telefone, linhasExistentes);
  }

  // Duplicata dentro do próprio arquivo — checado depois do loop principal (só dá pra saber
  // depois de ver todas as linhas). Sinaliza TODAS as ocorrências do telefone repetido, não só a
  // 2ª em diante, pra o operador conseguir localizar todas no arquivo original.
  for (const [telefone, linhas] of linhasPorTelefone) {
    if (linhas.length > 1) {
      for (const linha of linhas) {
        suspeitos.push({ linha, motivo: `telefone duplicado no arquivo (também aparece na linha ${linhas.filter(l => l !== linha).join(", ")})` });
      }
    }
  }
  suspeitos.sort((a, b) => a.linha - b.linha);

  return { novos, totalLinhas, corrigidos, descartados, suspeitos };
}

// [AUDITORIA] FIX APLICADO (2026-07-29): busca de contatos-alvo (por tag/estágio/lista) caía no
// default silencioso de `limit=100` do GET genérico (`backend/src/crud.ts`) — qualquer lista/tag/
// estágio com mais de 100 contatos era truncada sem erro nenhum, e `handleStart` (StepReview)
// enfileirava só os 100 primeiros pro disparo real. Fix: pagina em lotes de 500 (teto máximo
// aceito por `crud.ts`) até a página vir incompleta, concatenando tudo — cobre qualquer tamanho
// de lista sem precisar de endpoint novo. `build` deve retornar uma QueryBuilder fresca (sem
// `.limit()`/`.page()` ainda aplicados) a cada chamada, já que o builder não é reutilizável após
// `_exec()`.
async function fetchAllContatos(build: () => any): Promise<any[]> {
  const PAGE_SIZE = 500;
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const { data } = await build().limit(PAGE_SIZE).page(page);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

// [AUDITORIA] BUG (achado na Sprint Placeholders/Upload, 2026-07-30): dos 5 atalhos de
// personalização oferecidos em StepMessage ({{nome}}, {{primeiro_nome}}, {{telefone}}, {{data}},
// {{empresa}}), só {{nome}}/{{primeiro_nome}} eram de fato substituídos (em StepReview.handleStart,
// via `.replace()` simples) — {{telefone}}/{{data}}/{{empresa}} chegavam LITERALMENTE escritos
// (com as chaves) na mensagem real recebida pelo cliente, sem nenhum erro visível pro operador.
// Confirmado que `disparoProcessor.ts` não faz nenhuma substituição adicional — ele só lê
// `disparo_logs.mensagem_enviada` já pronta (preenchida por `handleStart` abaixo). [AUDITORIA] FIX
// APLICADO: função única compartilhada entre a prévia (StepMessage) e o envio real
// (StepReview.handleStart) — evita que a prévia prometa uma substituição que o envio real não
// cumpre (ou vice-versa). `.replaceAll()` em vez de `.replace()` cobre múltiplas ocorrências do
// mesmo placeholder na mesma mensagem (antes, só a 1ª ocorrência era trocada).
// [AUDITORIA] LÓGICA (Sprint Fix Nome/Telefone na Saudação, 2026-08-05): remove um placeholder
// vazio (sem valor real pra usar) sem deixar pontuação solta ao redor — "Oi {{primeiro_nome}},
// tudo bem?" vira "Oi, tudo bem?" (vírgula preservada, colada na saudação), não "Oi , tudo
// bem?" (vírgula solta) nem "Oi tudo bem?" (perde a pausa da vírgula). Ordem das regras importa:
// mais específica primeiro (espaço+vírgula) até a mais genérica (placeholder bare, sem espaço/
// vírgula ao redor) — cada `replaceAll` só bate no que sobrou depois da regra anterior.
// Conferido contra os templates reais em produção (`disparo_templates`/`disparos.mensagem_template`):
// cobre tanto "Oi {{primeiro_nome}}, tudo bem?" (vírgula) quanto "Oi {{primeiro_nome}}! Vi que..."
// (exclamação, cai na regra de espaço sem vírgula — "Oi!", sem espaço duplo).
function removerPlaceholderVazio(texto: string, placeholder: string): string {
  return texto
    .replaceAll(` ${placeholder},`, ",")  // "Oi {{p}}, tudo bem?" -> "Oi, tudo bem?"
    .replaceAll(`${placeholder}, `, "")   // "{{p}}, tudo bem?" (placeholder no início) -> "tudo bem?"
    .replaceAll(` ${placeholder}`, "")    // "Oi {{p}}!" / "seu pedido {{p}} chegou" -> "Oi!" / "seu pedido chegou"
    .replaceAll(`${placeholder} `, "")    // "{{p}} chegou" (placeholder no início, sem vírgula) -> "chegou"
    .replaceAll(placeholder, "");         // sobra bare, sem espaço/vírgula ao redor
}

function substituirPlaceholders(mensagem: string, contato: { nome?: string; telefone?: string; empresa?: string }): string {
  // [AUDITORIA] BUG (achado real — campanha "Importação cnpj_biz" já enviada em produção,
  // 2026-08-05): contato importado sem coluna de nome de pessoa (só CNPJ/razão social) tinha
  // `nome` igual ao próprio `telefone` (fallback antigo de `analisarLinhasImportacao`, corrigido
  // acima pra tentar `empresa` primeiro) — sem nenhuma proteção aqui, `{{primeiro_nome}}`/
  // `{{nome}}` substituíam pelo telefone cru: mensagem real saiu como "Oi 5511984849872, tudo
  // tranquilo?". [AUDITORIA] FIX APLICADO: `nome === telefone` é tratado como "sem nome real" —
  // NÃO cai no fallback "cliente" (esse continua só pra quando `nome` está genuinamente vazio,
  // caso inalterado) nem usa o telefone como saudação; o placeholder é removido com limpeza de
  // pontuação (`removerPlaceholderVazio`, acima) em vez de virar texto vazio no meio da frase.
  // Segunda camada de proteção — a primeira é o fallback de importação (nome || empresa ||
  // telefone) — cobre contatos já contaminados na base antes deste fix e qualquer outro caminho
  // de criação de contato que possa gravar nome === telefone no futuro.
  const semNomeReal = !!contato.telefone && contato.nome === contato.telefone;
  const nome = semNomeReal ? "" : (contato.nome || "cliente");
  const primeiroNome = semNomeReal ? "" : nome.split(" ")[0];
  const dataHoje = new Date().toLocaleDateString("pt-BR");

  let resultado = mensagem;
  if (semNomeReal) {
    resultado = removerPlaceholderVazio(resultado, "{{nome}}");
    resultado = removerPlaceholderVazio(resultado, "{{primeiro_nome}}");
  } else {
    resultado = resultado.replaceAll("{{nome}}", nome).replaceAll("{{primeiro_nome}}", primeiroNome);
  }
  return resultado
    .replaceAll("{{telefone}}", contato.telefone || "")
    .replaceAll("{{data}}", dataHoje)
    .replaceAll("{{empresa}}", contato.empresa || "");
}

// [AUDITORIA] LÓGICA (Sprint Variação sem IA, 2026-08-06): motor de variação determinística
// (spintax) — zero custo de IA, decisão explícita pra reduzir a dependência de "Humanizar com IA"
// (que chama OpenAI uma vez por contato). Sintaxe `{opção 1|opção 2|opção 3}` (chave SIMPLES +
// pelo menos um `|` dentro) — nunca confundir com `{{placeholder}}` (chave DUPLA, nunca tem `|`).
// A regex abaixo casa qualquer bloco `{...sem chaves aninhadas...}`, inclusive — por construção
// de regex, não por checagem explícita de posição — o miolo de um `{{placeholder}}` (ex: bateria
// em `{primeiro_nome}` dentro de `{{primeiro_nome}}`). Isso é INOFENSIVO de propósito: como esse
// miolo nunca tem `|`, a regra "sem pipe = texto literal, devolve o próprio trecho casado sem
// mudar nada" reconstrói o placeholder duplo exatamente como era — as chaves externas nunca
// fazem parte de nenhum match, só sobram no lugar. Testado (ver AUDITORIA_LOG.md) com
// `{{primeiro_nome}}` ao lado de spintax real na mesma mensagem — cada um resolve certo, sem
// vazar um no outro. Escolha independente por chamada (`Math.random()`) — chamado uma vez por
// contato (`StepReview.handleStart`, depois de `substituirPlaceholders`), então cada destinatário
// sorteia sua própria combinação.
function resolverSpintax(texto: string): string {
  return texto.replace(/\{([^{}]+)\}/g, (match, conteudo: string) => {
    if (!conteudo.includes("|")) return match; // sem pipe — não é spintax, mantém literal (cobre {{placeholder}} e chave simples usada por outro motivo)
    const opcoes = conteudo.split("|").map(o => o.trim());
    return opcoes[Math.floor(Math.random() * opcoes.length)];
  });
}

// [AUDITORIA] LÓGICA (Sprint Variação sem IA, 2026-08-06): extraído do meio de
// `mensagemSemPersonalizacao` pra ser reaproveitado também na prévia (avisar que "esta prévia
// mostra só um exemplo" quando a mensagem realmente tem spintax) — mesma regex, um único lugar
// que sabe o que "conta como spintax de verdade" (bloco `{...}` com `|` dentro).
function textoTemSpintax(texto: string): boolean {
  return /\{([^{}]*\|[^{}]*)\}/.test(texto);
}

// [AUDITORIA] LÓGICA (Sprint Variação sem IA, 2026-08-06): usado tanto no aviso de "mensagem sem
// personalização" (StepMessage) quanto, potencialmente, em telas futuras que precisem da mesma
// checagem — mensagem sem NENHUM placeholder nem bloco spintax sai byte-idêntica pra todo mundo,
// o sinal de risco de spam mais citado na pesquisa desta sessão (política WhatsApp Business
// Platform 2026 + guias de anti-ban pra API não-oficial), mais forte que "ausência de IA".
function mensagemSemPersonalizacao(texto: string): boolean {
  if (!texto) return false; // mensagem vazia não é "sem personalização", é só vazia — StepMessage já valida isso separado
  const temPlaceholder = /\{\{\s*(nome|primeiro_nome|telefone|data|empresa)\s*\}\}/.test(texto);
  return !temPlaceholder && !textoTemSpintax(texto);
}

const Steps = ["Lista de Contatos", "Mensagem", "Proteção Anti-ban", "Revisar e Agendar"];

export default function DisparosPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  const [targetContacts, setTargetContacts] = useState<any[]>([]);
  const [loadingCount, setLoadingCount] = useState(false);

  const [form, setForm] = useState({
    nome: "",
    tipo_midia: "texto" as "texto" | "imagem" | "audio" | "documento",
    mensagem: "",
    perfil_velocidade: "safe" as "safe" | "moderate" | "fast",
    janela_inicio: "08:00",
    janela_fim: "21:00",
    pausa_fins_semana: true,
    pausa_erros_consecutivos: true,
    limite_erros_consecutivos: 5,
    // [AUDITORIA] FIX APLICADO (2026-07-29): campo existia na tabela `disparos`
    // (`limite_diario_mensagens`, default 500 no banco) mas não tinha nenhum controle na UI —
    // toda campanha nascia fixa em 500/dia sem o operador conseguir configurar algo mais
    // conservador pra chip novo/em aquecimento. Default aqui é mais baixo que o do banco de
    // propósito (200 vs. 500) — evita que quem nunca mexer neste campo herde o teto mais
    // permissivo sem perceber.
    limite_diario_mensagens: 200,
    // [AUDITORIA] FIX APLICADO (Sprint Cooldown de Disparos, 2026-07-30): janela (em horas) que
    // um contato precisa esperar antes de poder receber outra campanha — bloqueia reenvio pro
    // mesmo número em campanhas DIFERENTES (não confundir com a dedupe já existente, que só evita
    // duplicata DENTRO da mesma seleção de alvo). Configurável por campanha, default 24h.
    cooldown_horas: 24,
    // [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): antes o intervalo entre
    // mensagens só vinha dos 3 perfis fixos (5-60s no máximo). Agora editável livremente em
    // minutos (guardado em segundos no banco, ver migrations.ts) — os cards de perfil abaixo só
    // preenchem estes 2 campos como atalho, não travam mais o valor. Default aqui já nasce
    // preenchido com o equivalente do perfil "safe" (30-60s = 0.5-1min), mesmo perfil default de
    // `perfil_velocidade` acima, pra abrir a tela com os dois em sincronia.
    delay_min_minutos: 0.5,
    delay_max_minutos: 1,
    pausa_bloqueios_detectados: true,
    instancias_ids: [] as string[],
    contatos: [] as any[],
    tags_selecionadas: [] as string[],
    estagios_selecionados: [] as string[],
    listas_selecionadas: [] as string[],
    url_midia: "",
    legenda_midia: "",
    // [AUDITORIA] FIX APLICADO (Sprint Variação sem IA, 2026-08-06): default trocado de `true`
    // pra `false` — toda campanha nascia chamando OpenAI uma vez por contato (via
    // `disparoProcessor.ts`/`humanizationService.ts`), mesmo quando o operador nunca decidiu
    // isso ativamente (só via se quisesse desligar). Pesquisa registrada nesta sessão (política
    // de spam da WhatsApp Business Platform 2026, guias de anti-ban pra API não-oficial) aponta
    // texto byte-idêntico pra lista grande, sem personalização nenhuma, como o sinal de risco
    // mais citado — não "ausência de reescrita por IA". `substituirPlaceholders()` já resolve
    // isso de graça quando a mensagem usa `{{primeiro_nome}}`/etc, e o motor de spintax novo
    // (`resolverSpintax()`, abaixo) cobre variação de texto sem custo nenhum de IA — humanização
    // por IA vira reforço opcional, não o comportamento padrão de toda campanha nova. Campanhas
    // já criadas/agendadas não são afetadas (cada uma já tem `humanizar_ia` gravado no próprio
    // registro em `disparos`, só o valor inicial do formulário de campanha NOVA muda).
    humanizar_ia: false,
  });

  // Live contact count — recalcula sempre que os filtros mudam
  useEffect(() => {
    const fetchCount = async () => {
      if (
        form.tags_selecionadas.length === 0 &&
        form.estagios_selecionados.length === 0 &&
        form.listas_selecionadas.length === 0
      ) {
        setTargetContacts([]);
        return;
      }
      setLoadingCount(true);
      let list: any[] = [];
      // [AUDITORIA] FIX APLICADO (2026-07-29): as 3 buscas abaixo (tag/estágio/lista) agora usam
      // `fetchAllContatos` (pagina em lotes de 500 até esgotar) em vez de uma chamada única sem
      // `.limit()` — antes, qualquer lista/tag/estágio com mais de 100 contatos era truncada
      // silenciosamente pelo default do GET genérico (`backend/src/crud.ts`), e `targetContacts`
      // (usado por handleStart em StepReview pra criar os disparo_logs reais) nunca via o resto.
      // Ver causa raiz completa em diagnosticos/AUDITORIA_LOG.md, entrada 2026-07-29.
      // [AUDITORIA] LÓGICA: `opt_out` incluído no select das 3 fontes de alvo (tag/estágio/lista)
      // pra dar pro filtro final abaixo o que precisa — sem isso, contato que pediu remoção
      // entrava na campanha do mesmo jeito (ver diagnosticos/AUDITORIA_LOG.md).
      // [AUDITORIA] FIX APLICADO (Sprint Placeholders/Upload, 2026-07-30): `empresa` adicionado
      // ao select das 3 fontes — necessário pro atalho {{empresa}} (ver substituirPlaceholders
      // acima) ter o dado disponível em `c.empresa` no momento de montar `disparo_logs`. Coluna já
      // existe em `contatos` (confirmado via information_schema antes deste fix), sem precisar de
      // migração.
      // [AUDITORIA] FIX APLICADO (Sprint Cooldown de Disparos, 2026-07-30): `ultimo_disparo_em`
      // adicionado ao select das 3 fontes — usado por StepReview pra avisar o operador antes de
      // disparar quando algum contato selecionado já recebeu campanha dentro da janela de
      // cooldown (aviso no frontend; o bloqueio de verdade é no backend, ver disparoProcessor.ts).
      // [AUDITORIA] FIX APLICADO (Sprint Colunas de Status de Envio, 2026-07-31): `funil_estagio_id`
      // adicionado ao select das 3 fontes — usado pela coluna nova "Situação no CRM" na prévia de
      // contatos (StepContacts), mesma fonte já usada na aba "Por Estágio" desta mesma tela.
      if (form.tags_selecionadas.length > 0) {
        const data = await fetchAllContatos(() => api.from("contatos").select("id, nome, telefone, empresa, tags, opt_out, ultimo_disparo_em, funil_estagio_id"));
        const filtered = data.filter((c: any) =>
          Array.isArray(c.tags) && form.tags_selecionadas.some((t: string) => c.tags.includes(t))
        );
        list = [...list, ...filtered];
      }
      if (form.estagios_selecionados.length > 0) {
        const data = await fetchAllContatos(() =>
          api
            .from("contatos")
            .select("id, nome, telefone, empresa, opt_out, ultimo_disparo_em, funil_estagio_id")
            .in("funil_estagio_id", form.estagios_selecionados)
        );
        list = [...list, ...data];
      }
      if (form.listas_selecionadas.length > 0) {
        if (form.listas_selecionadas.includes("__all__")) {
          // [AUDITORIA] BUG (achado 2026-08-04 — Sprint Importar Contatos de Grupo): "Todas as
          // listas" busca contatos sem filtro nenhum além de opt_out — é o ÚNICO dos 3 modos de
          // seleção (tag/estágio/lista) que varreria participante de grupo importado
          // (`origem = 'Grupo WhatsApp'`, ver rota de importação em whatsapp.ts) sem o operador
          // ter feito nada explícito com aquele contato. Os outros dois modos (tag/estágio) já
          // exigem uma atribuição manual prévia por contato — não precisam do mesmo filtro.
          // [AUDITORIA] FIX APLICADO: `origem` incluído no select e filtrado no cliente (não
          // `.neq()` do QueryBuilder — é um no-op documentado em client.ts, nunca chega a filtrar
          // nada no backend; mesma classe de bug e mesma solução já usada no seletor de
          // instâncias do anti-ban nesta mesma tela). Operador ainda pode incluir esses contatos
          // de propósito atribuindo tag/lista/estágio manualmente — os outros 2 modos continuam
          // trazendo qualquer contato, sem essa exclusão.
          const data = await fetchAllContatos(() => api.from("contatos").select("id, nome, telefone, empresa, lista_id, opt_out, ultimo_disparo_em, funil_estagio_id, origem"));
          const semGrupo = data.filter((c: any) => c.origem !== "Grupo WhatsApp");
          list = [...list, ...semGrupo];
        } else {
          const data = await fetchAllContatos(() =>
            api
              .from("contatos")
              .select("id, nome, telefone, empresa, lista_id, opt_out, ultimo_disparo_em, funil_estagio_id")
              .in("lista_id", form.listas_selecionadas)
          );
          list = [...list, ...data];
        }
      }
      // [AUDITORIA] FIX APLICADO (2026-07-23): contato com opt_out=true nunca entra na lista de
      // alvos de campanha, independente de por qual filtro (tag/estágio/lista) ele foi
      // encontrado — mesma checagem reforçada no backend (get_next_disparo_batch, ver
      // migrations.ts), essa aqui evita que ele nem apareça na prévia/contagem.
      const semOptOut = list.filter((c: any) => c.opt_out !== true);
      const unique = Array.from(new Map(semOptOut.map(c => [c.telefone, c])).values());
      setTargetContacts(unique);
      setLoadingCount(false);
    };
    fetchCount();
  }, [form.tags_selecionadas, form.estagios_selecionados, form.listas_selecionadas]);

  // Validação por etapa — habilita "Próximo" só quando OK
  const stepValid = useMemo(() => {
    if (step === 0) return form.nome.trim().length > 0 && targetContacts.length > 0;
    if (step === 1) {
      if (form.tipo_midia === "texto") return form.mensagem.trim().length > 0;
      return form.url_midia.trim().length > 0;
    }
    if (step === 2) {
      // [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): antes só checava
      // instâncias selecionadas — intervalo customizado inválido (mín > máx, ou abaixo do piso
      // de segurança) agora também bloqueia "Próximo", mesma checagem usada dentro de
      // StepAntiBan pra mostrar o aviso em vermelho.
      const intervaloValido = form.delay_min_minutos >= DELAY_MIN_ABSOLUTO_MINUTOS
        && form.delay_max_minutos >= DELAY_MIN_ABSOLUTO_MINUTOS
        && form.delay_min_minutos <= form.delay_max_minutos;
      return form.instancias_ids.length > 0 && intervaloValido;
    }
    return true;
  }, [step, form, targetContacts.length]);

  const stepHint = useMemo(() => {
    if (stepValid) return null;
    if (step === 0) {
      if (!form.nome.trim()) return "Informe o nome da campanha";
      return "Selecione ao menos uma tag, lista, estágio ou importe um CSV";
    }
    if (step === 1) return form.tipo_midia === "texto" ? "Escreva a mensagem" : "Informe a URL do arquivo";
    if (step === 2) {
      if (form.instancias_ids.length === 0) return "Selecione ao menos uma instância";
      return "Corrija o intervalo customizado (mínimo não pode ser maior que o máximo, nem menor que o piso de segurança)";
    }
    return null;
  }, [stepValid, step, form]);

  if (activeCampaign) {
    return <MonitoringDashboard campaign={activeCampaign} onCancel={() => setActiveCampaign(null)} />;
  }

  return (
    <CRMLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Novo Disparo em Massa</h1>
            <p className="text-sm text-muted-foreground">Configure em 4 passos rápidos</p>
          </div>
          {/* Resumo ao vivo — sempre visível */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="gap-1 py-1.5 px-3">
              <Users className="h-3 w-3" />
              {loadingCount ? "..." : targetContacts.length} contato{targetContacts.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="gap-1 py-1.5 px-3">
              <Send className="h-3 w-3" />
              {form.instancias_ids.length} instância{form.instancias_ids.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="gap-1 py-1.5 px-3 capitalize">
              <ShieldCheck className="h-3 w-3" />
              {form.perfil_velocidade}
            </Badge>
          </div>
        </div>

        {/* Stepper clicável (só permite voltar) */}
        <div className="flex gap-2 sm:gap-4 mb-2 flex-wrap">
          {Steps.map((s, i) => {
            const clickable = i < step;
            return (
              <button
                key={s}
                type="button"
                onClick={() => clickable && setStep(i)}
                disabled={!clickable && i !== step}
                className={`flex items-center gap-2 transition-opacity ${i <= step ? "text-primary" : "text-muted-foreground"} ${clickable ? "hover:opacity-80 cursor-pointer" : i === step ? "" : "cursor-not-allowed"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${i < step ? "bg-primary/80 text-primary-foreground" : i === step ? "bg-primary text-primary-foreground" : ""}`}>
                  {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-sm font-medium hidden sm:inline">{s}</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-[400px]">
          {step === 0 && <StepContacts form={form} setForm={setForm} liveCount={targetContacts.length} loadingCount={loadingCount} targetContacts={targetContacts} />}
          {step === 1 && <StepMessage form={form} setForm={setForm} />}
          {step === 2 && <StepAntiBan form={form} setForm={setForm} />}
          {step === 3 && <StepReview form={form} targetContacts={targetContacts} loadingContacts={loadingCount} onStart={(campaignData: any) => setActiveCampaign(campaignData)} />}
        </div>

        {/* Footer: na revisão escondemos para evitar duplicidade com os CTAs internos */}
        {step < 3 && (
          <div className="flex justify-between items-center pt-6 border-t gap-4">
            <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Voltar</Button>
            <div className="flex items-center gap-3">
              {stepHint && <span className="text-xs text-muted-foreground hidden sm:inline">{stepHint}</span>}
              <Button onClick={() => setStep(Math.min(3, step + 1))} disabled={!stepValid}>
                Próximo
              </Button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="flex justify-start pt-6 border-t">
            <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
          </div>
        )}
      </div>
    </CRMLayout>
  );
}

function StepContacts({ form, setForm, liveCount, loadingCount, targetContacts = [] }: any) {
  const { user } = useAuth();
  const [previewSearch, setPreviewSearch] = useState("");
  const filteredPreview = targetContacts.filter((c: any) => {
    if (!previewSearch.trim()) return true;
    const q = previewSearch.toLowerCase();
    return (c.nome || "").toLowerCase().includes(q) || (c.telefone || "").toLowerCase().includes(q);
  });
  const [tags, setTags] = useState<any[]>([]);
  const [estagios, setEstagios] = useState<any[]>([]);
  const [listas, setListas] = useState<any[]>([]);
  const [listasCounts, setListasCounts] = useState<Record<string, number>>({});
  // [AUDITORIA] LÓGICA (Sprint Gerenciar Listas em Disparos, 2026-08-06): estado da aba "Por
  // Lista" pra excluir/renomear lista direto daqui, sem precisar ir em Leads.tsx — mesmo padrão
  // (api.from("listas"), makeCrud genérico já suporta DELETE/PATCH por id) já usado e validado
  // em produção por `removerLista()` de Leads.tsx.
  const [renomeandoLista, setRenomeandoLista] = useState<{ id: string; nome: string } | null>(null);
  const [salvandoRenomeio, setSalvandoRenomeio] = useState(false);
  const [limpandoVazias, setLimpandoVazias] = useState(false);
  const [totalContatos, setTotalContatos] = useState<number>(0);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [tagSearch, setTagSearch] = useState("");

  // [AUDITORIA] LÓGICA (Sprint Colunas de Status de Envio, 2026-07-31): mapa funil_estagio_id ->
  // {nome, cor} pra coluna "Situação no CRM" na prévia — mesma fonte (`estagios`, já buscada em
  // fetchTargets abaixo) já usada na aba "Por Estágio" desta mesma tela, sem query nova.
  const estagioPorId = useMemo(() => {
    const mapa: Record<string, any> = {};
    for (const e of estagios) mapa[e.id] = e;
    return mapa;
  }, [estagios]);

  // [AUDITORIA] LÓGICA (Sprint Colunas de Status de Envio, 2026-07-31): busca "última campanha"
  // só pros contatos REALMENTE VISÍVEIS na prévia (até 500, já limitado abaixo) — não pra
  // `targetContacts` inteiro, que pode ter milhares de linhas numa lista grande. `ultimo_disparo_em`
  // (pra "Nunca enviado"/"Já enviado" e a data) já vem direto em `c.ultimo_disparo_em` (mesmo select
  // usado pelo cooldown), sem custo extra — só o NOME da campanha precisa desta busca em lote.
  const telefonesVisiveis = filteredPreview.slice(0, 500).map((c: any) => c.telefone).filter(Boolean);
  const statusEnvioPorTelefone = useStatusEnvio(telefonesVisiveis);

  // [AUDITORIA] FIX APLICADO (Sprint Disparos/Importação, 2026-07-25): extraída pra fora do
  // useEffect (era uma função anônima só chamada no mount) pra poder ser rechamada depois de uma
  // importação bem-sucedida — sem isso, a lista recém-criada não apareceria na aba "Por Lista"
  // nem teria contagem, mesmo já estando selecionada em form.listas_selecionadas.
  const fetchTargets = async () => {
    const { data: tagsData } = await api.from("tags").select("*");
    const { data: estagiosData } = await api.from("funil_estagios").select("*");
    const { data: listasData } = await api.from("listas").select("*").order("nome", { ascending: true });
    setTags(tagsData || []);
    setEstagios(estagiosData || []);
    setListas(listasData || []);

    // Total geral de contatos (usado pela opção "Todos os Leads")
    const { count: totalCount } = await api.from("contatos").select("id", { count: "exact", head: true });
    setTotalContatos(totalCount || 0);

    // Buscar contagem de contatos por lista (em paralelo)
    if (listasData && listasData.length) {
      const counts: Record<string, number> = {};
      await Promise.all(
        listasData.map(async (l: any) => {
          const { count } = await api.from("contatos").select("id", { count: "exact", head: true }).eq("lista_id", l.id);
          counts[l.id] = count || 0;
        })
      );
      setListasCounts(counts);
    }
  };

  useEffect(() => { fetchTargets(); }, []);

  // [AUDITORIA] LÓGICA (Sprint Gerenciar Listas em Disparos, 2026-08-06): mesmo padrão de
  // removerLista() em Leads.tsx (confirm() nativo, api.from("listas").delete().eq("id", id),
  // backend já faz lista_id->null nos contatos via FK ON DELETE SET NULL — contato nunca é
  // apagado, só perde o vínculo com a lista). Diferença daqui pra lá: se a lista removida
  // estivesse selecionada em form.listas_selecionadas (alvo da campanha em edição), precisa sair
  // do array também — senão a campanha ficaria "mirando" um id que não existe mais.
  const removerLista = async (id: string, nome: string) => {
    if (!confirm(`Remover a lista "${nome}"? Os contatos ficarão sem lista mas não serão apagados.`)) return;
    const { error } = await api.from("listas").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover lista", { description: error.message });
      return;
    }
    setForm((prev: any) => ({
      ...prev,
      listas_selecionadas: prev.listas_selecionadas.filter((lid: string) => lid !== id),
    }));
    toast.success("Lista removida");
    fetchTargets();
  };

  // [AUDITORIA] LÓGICA: renomear é só um PATCH — makeCrud genérico (crud.ts) já expõe
  // PUT /api/listas/:id, nunca usado antes nesta tela (Leads.tsx só cria/exclui). Modal simples
  // reaproveitando os mesmos componentes Dialog já importados nesta página.
  const abrirRenomeio = (l: any) => setRenomeandoLista({ id: l.id, nome: l.nome });

  const confirmarRenomeio = async () => {
    if (!renomeandoLista) return;
    const nomeNovo = renomeandoLista.nome.trim();
    if (!nomeNovo) {
      toast.error("Nome não pode ficar vazio");
      return;
    }
    setSalvandoRenomeio(true);
    try {
      const { error } = await api.from("listas").update({ nome: nomeNovo }).eq("id", renomeandoLista.id);
      if (error) {
        toast.error("Erro ao renomear lista", { description: error.message });
        return;
      }
      toast.success("Lista renomeada");
      setRenomeandoLista(null);
      fetchTargets();
    } finally {
      setSalvandoRenomeio(false);
    }
  };

  // [AUDITORIA] LÓGICA: não existe endpoint de bulk-delete por lista de ids (makeCrud genérico
  // só faz um registro por vez) — dado que o cenário real (print do usuário) é umas poucas
  // dezenas de listas vazias de teste/reimportação, sequencial é aceitável (não vale criar rota
  // nova só pra isso). `listasCounts` já é a mesma contagem usada no badge de cada linha —
  // reaproveitada aqui, sem query nova.
  const listasVazias = useMemo(() => listas.filter(l => (listasCounts[l.id] ?? 0) === 0), [listas, listasCounts]);

  const limparListasVazias = async () => {
    if (listasVazias.length === 0) return;
    if (!confirm(`Excluir ${listasVazias.length} lista(s) vazia(s) (0 contatos)? Esta ação não pode ser desfeita.`)) return;
    setLimpandoVazias(true);
    try {
      let falhas = 0;
      for (const l of listasVazias) {
        const { error } = await api.from("listas").delete().eq("id", l.id);
        if (error) falhas++;
      }
      setForm((prev: any) => ({
        ...prev,
        listas_selecionadas: prev.listas_selecionadas.filter((lid: string) => !listasVazias.some(l => l.id === lid)),
      }));
      if (falhas > 0) {
        toast.error(`${falhas} lista(s) não puderam ser removidas`, { description: "As demais foram removidas normalmente." });
      } else {
        toast.success(`${listasVazias.length} lista(s) vazia(s) removida(s)`);
      }
      fetchTargets();
    } finally {
      setLimpandoVazias(false);
    }
  };

  // [AUDITORIA] BUG (Sprint Disparos/Importação, 2026-07-25, ver
  // diagnosticos/SPRINT_DISPAROS_IMPORTACAO_CSV_XLSX.md): `handleCsvUpload` só sabia ler XLSX
  // (readAsBinaryString + XLSX.read(type:'binary'), sem try/catch — arquivo .xlsx real
  // frequentemente falhava silenciosamente nesse modo, explicando o relato "Excel não subiu"), e
  // mesmo quando o parse funcionava (CSV), o resultado (`csvPreview`) só alimentava uma tabela de
  // preview — nunca virava contato de verdade nem entrava em `targetContacts`. O botão "Selecionar
  // Arquivo" era decorativo.
  // [AUDITORIA] FIX APLICADO: dois arquivos, duas etapas — (1) `handleImportFile` só lê e mostra
  // preview (csv via file.text() + parseCsvRowsTolerante; xlsx/xls via file.arrayBuffer() +
  // XLSX.read(type:'array'), padrão robusto igual Leads.tsx, dentro de try/catch com toast de
  // erro real); (2) botão novo "Confirmar Importação" (`confirmarImportacao`, abaixo) de fato cria
  // os contatos e uma lista de destino, e marca essa lista como selecionada — só então o
  // useEffect de targetContacts (linha ~57 do componente pai) passa a enxergar esses contatos.
  const [pendingImportRows, setPendingImportRows] = useState<string[][] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    try {
      let rows: string[][];
      if (ext === "csv") {
        const buf = await file.arrayBuffer();
        const texto = decodeTextoTolerante(buf);
        rows = parseCsvRowsTolerante(texto);
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        rows = raw.map(r => (r || []).map(c => (c === null || c === undefined ? "" : String(c).trim())));
      } else {
        toast.error("Formato não suportado", { description: "Use um arquivo .csv, .xlsx ou .xls." });
        e.target.value = "";
        return;
      }

      rows = rows.filter(r => r.some(c => c.length > 0));
      if (rows.length < 2) {
        toast.error("Arquivo vazio ou sem linhas de dados", { description: "É preciso ao menos uma linha de cabeçalho e uma linha de dados." });
        e.target.value = "";
        return;
      }

      setCsvPreview(rows.slice(0, 5));
      setPendingImportRows(rows);
      setImportFileName(file.name);
      toast.success(`${file.name} carregado`, {
        description: `${rows.length - 1} linha(s) de dados encontradas. Confira o preview e clique em "Confirmar Importação" para criar os contatos.`,
      });
    } catch (err: any) {
      toast.error("Não foi possível ler o arquivo", { description: err?.message || "Verifique o formato e tente novamente." });
    } finally {
      e.target.value = "";
    }
  };

  const cancelarImportacao = () => {
    setPendingImportRows(null);
    setCsvPreview([]);
    setImportFileName("");
  };

  // [AUDITORIA] FIX APLICADO (Sprint Disparos/Importação, revisão 2026-07-25): usuário reportou
  // achar que a importação estava "trazendo contatos com telefone vazio" — na prática, ele estava
  // vendo a PREVIEW (5 primeiras linhas cruas do arquivo, sem filtro nenhum) e interpretando isso
  // como o resultado final. Resumo de pré-validação abaixo roda a mesma análise que
  // `confirmarImportacao` vai aplicar de fato, mostrado assim que o arquivo é lido — não precisa
  // mais confirmar pra descobrir quantos vão ser aproveitados.
  const preAnalise = useMemo(
    () => (pendingImportRows ? analisarLinhasImportacao(pendingImportRows) : null),
    [pendingImportRows]
  );

  // [AUDITORIA] LÓGICA (Sprint Importação Upsert, 2026-08-06): pergunta ao backend quais telefones
  // já existem na conta assim que o arquivo é lido (antes de qualquer clique em "Confirmar
  // Importação") — abordagem escolhida (endpoint leve dedicado, `POST /contatos/checar-telefones`)
  // em vez de só mostrar o número real depois de confirmar: é pouco código a mais e entrega o que
  // foi pedido de verdade (resumo de PRÉ-importação com novos vs. já existentes, não só depois do
  // fato). `api.post` lança em erro HTTP — falha aqui não deve travar a tela de importação, só
  // deixa a contagem de "já existentes" temporariamente indisponível (cai pra 0, mostrado como
  // "não verificado" na UI abaixo).
  const [checandoExistentes, setCheckandoExistentes] = useState(false);
  const [telefonesExistentes, setTelefonesExistentes] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!preAnalise || !preAnalise.novos.length) { setTelefonesExistentes(null); return; }
    let cancelado = false;
    setCheckandoExistentes(true);
    (async () => {
      try {
        const { data } = await api.post("/api/contatos/checar-telefones", {
          telefones: preAnalise.novos.map(c => c.telefone),
        });
        if (!cancelado) setTelefonesExistentes(new Set(data?.existentes || []));
      } catch {
        if (!cancelado) setTelefonesExistentes(null);
      } finally {
        if (!cancelado) setCheckandoExistentes(false);
      }
    })();
    return () => { cancelado = true; };
  }, [preAnalise]);

  const jaExistiamCount = useMemo(
    () => (preAnalise && telefonesExistentes ? preAnalise.novos.filter(c => telefonesExistentes.has(c.telefone)).length : 0),
    [preAnalise, telefonesExistentes]
  );

  const confirmarImportacao = async () => {
    if (!pendingImportRows || !user) return;
    setImportLoading(true);
    try {
      const { novos: analisados, totalLinhas, corrigidos, descartados } = analisarLinhasImportacao(pendingImportRows);
      const novos = analisados.map(n => ({
        ...n,
        origem: "Importado (Disparos)",
        status: "novo",
        tags: [] as string[],
      }));

      if (!novos.length) {
        toast.error("Nenhum contato válido encontrado", {
          description: `${totalLinhas} linha(s) lida(s), todas com telefone inválido ou em branco (fora do padrão de 10 a 13 dígitos).`,
        });
        return;
      }

      const nomeLista = `Importação ${importFileName} ${new Date().toLocaleDateString("pt-BR")}`;
      const { data: listaCriada, error: listaError } = await api
        .from("listas")
        .insert({ user_id: user.id, nome: nomeLista })
        .select()
        .single();

      if (listaError || !listaCriada) {
        toast.error("Erro ao criar lista de importação", { description: listaError?.message });
        return;
      }

      // [AUDITORIA] FIX APLICADO (Sprint Importação Upsert, 2026-08-06): antes usava o bulk-insert
      // genérico (`api.from("contatos").insert(...)`, POST / de crud.ts), sem ON CONFLICT — UM
      // telefone colidindo (já existente na conta, ou duplicado dentro do próprio arquivo)
      // rejeitava o INSERT inteiro (23505), e NENHUMA linha do lote era gravada, mesmo as que não
      // colidiam com nada. Endpoint dedicado (`/api/contatos/importar-lote`) faz upsert real
      // (ON CONFLICT DO NOTHING) — contato já existente não é sobrescrito (nome/notas/tags/status
      // de um lead em atendimento continuam intocados), e as linhas novas do lote entram mesmo que
      // outras colidam. `api.post` lança exceção em erro HTTP (diferente de `.from()`, que devolve
      // `{data,error}`) — por isso dentro do try/catch já existente, não um `if (error)` separado.
      const { data: resultadoImportacao } = await api.post("/api/contatos/importar-lote", {
        contatos: novos.map(n => ({ ...n, lista_id: listaCriada.id })),
      });
      const inseridos: number = resultadoImportacao?.inseridos ?? 0;
      const jaExistiam: number = resultadoImportacao?.jaExistiam ?? 0;

      // [AUDITORIA] FIX APLICADO: marca a lista recém-criada como selecionada — é isso que faz o
      // useEffect de targetContacts (componente pai) de fato puxar esses contatos pra campanha,
      // fechando a ponte que faltava entre "arquivo importado" e "quem recebe o disparo". Mesmo
      // contatos que já existiam (não entraram de novo, mas já pertenciam à conta) ficam
      // acessíveis pela lista — ela foi criada de qualquer forma pra agrupar a importação.
      setForm({
        ...form,
        listas_selecionadas: Array.from(new Set([
          ...form.listas_selecionadas.filter((id: string) => id !== "__all__"),
          listaCriada.id,
        ])),
      });

      toast.success("Importação concluída", {
        description: `${totalLinhas} linha(s) lidas · ${inseridos} importado(s) · ${jaExistiam} já existia(m) na sua base (não sobrescritos) · ${corrigidos} telefone(s) corrigido(s) automaticamente · ${descartados} descartado(s) por telefone inválido.`,
      });

      await fetchTargets();
      cancelarImportacao();
    } catch (err: any) {
      toast.error("Erro inesperado na importação", { description: err?.message });
    } finally {
      setImportLoading(false);
    }
  };

  const filteredTags = tags.filter(t => t.nome?.toLowerCase().includes(tagSearch.toLowerCase()));
  const allTagsSelected = filteredTags.length > 0 && filteredTags.every(t => form.tags_selecionadas.includes(t.nome));
  const allEstagiosSelected = estagios.length > 0 && estagios.every(s => form.estagios_selecionados.includes(s.id));

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label>Nome da Campanha</Label>
          <Input placeholder="Ex: Campanha Black Friday" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} />
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-muted-foreground font-bold">Selecionados</p>
          <p className="text-2xl font-bold text-primary">
            {loadingCount ? "..." : liveCount}
            <span className="text-sm text-muted-foreground font-normal ml-1">contatos</span>
          </p>
        </div>
      </div>

      <Tabs defaultValue="lista" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="lista">Por Lista {form.listas_selecionadas.length > 0 && <Badge variant="secondary" className="ml-2 h-5">{form.listas_selecionadas.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="tags">Por Tag {form.tags_selecionadas.length > 0 && <Badge variant="secondary" className="ml-2 h-5">{form.tags_selecionadas.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="estagio">Por Estágio {form.estagios_selecionados.length > 0 && <Badge variant="secondary" className="ml-2 h-5">{form.estagios_selecionados.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="csv">Importar Arquivo</TabsTrigger>
        </TabsList>

        <TabsContent value="lista" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-medium">Selecione uma ou mais listas de leads:</p>
            <div className="flex items-center gap-2">
              {listasVazias.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  disabled={limpandoVazias}
                  onClick={limparListasVazias}
                >
                  {limpandoVazias
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <Trash2 className="h-3 w-3 mr-1" />}
                  Limpar {listasVazias.length} vazia{listasVazias.length > 1 ? "s" : ""}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const allIds = listas.map(l => l.id);
                  const allSelected = listas.length > 0 && listas.every(l => form.listas_selecionadas.includes(l.id));
                  setForm({ ...form, listas_selecionadas: allSelected ? [] : allIds });
                }}
              >
                {listas.length > 0 && listas.every(l => form.listas_selecionadas.includes(l.id)) ? "Limpar seleção" : "Selecionar todas"}
              </Button>
            </div>
          </div>

          {/* Opção especial: Todos os Leads (ignora lista_id) */}
          {(() => {
            const checked = form.listas_selecionadas.includes("__all__");
            return (
              <label
                htmlFor="lista-__all__"
                className={`flex items-center justify-between gap-2 p-3 border-2 rounded cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary" : "border-dashed border-primary/40 hover:bg-muted/50"}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    id="lista-__all__"
                    checked={checked}
                    className="h-4 w-4"
                    onChange={(e) => {
                      setForm({
                        ...form,
                        listas_selecionadas: e.target.checked ? ["__all__"] : [],
                      });
                    }}
                  />
                  <Users className="h-4 w-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">Todos os Leads</span>
                    <span className="text-[10px] text-muted-foreground">Puxa todos os contatos do módulo Leads, sem filtro de lista</span>
                  </div>
                </div>
                <Badge variant="default" className="text-[10px] flex-shrink-0">
                  {totalContatos}
                </Badge>
              </label>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
            {listas.map(l => {
              const checked = form.listas_selecionadas.includes(l.id);
              const disabled = form.listas_selecionadas.includes("__all__");
              return (
                <label
                  key={l.id}
                  htmlFor={`lista-${l.id}`}
                  className={`flex items-center justify-between gap-2 p-2 border rounded cursor-pointer transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${checked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50"}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      id={`lista-${l.id}`}
                      checked={checked}
                      disabled={disabled}
                      className="h-4 w-4"
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.listas_selecionadas.filter((id: string) => id !== "__all__"), l.id]
                          : form.listas_selecionadas.filter((id: string) => id !== l.id);
                        setForm({ ...form, listas_selecionadas: next });
                      }}
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: l.cor || "hsl(217 91% 45%)" }} />
                    <span className="text-sm truncate">{l.nome}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {listasCounts[l.id] ?? "..."}
                    </Badge>
                    {/* [AUDITORIA] LÓGICA: stopPropagation obrigatório nos dois botões — a linha
                        inteira é um <label> que dispara o toggle do checkbox ao clicar em
                        qualquer lugar dela, inclusive nestes ícones, se não fosse isolado aqui. */}
                    <button
                      type="button"
                      title="Renomear lista"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); abrirRenomeio(l); }}
                      className="p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Excluir lista"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removerLista(l.id, l.nome); }}
                      className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </label>
              );
            })}
            {listas.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full text-center py-2">
                Você ainda não criou listas. Use "Todos os Leads" acima ou crie listas no módulo Leads.
              </p>
            )}
          </div>
        </TabsContent>

        {/* [AUDITORIA] LÓGICA (Sprint Gerenciar Listas em Disparos, 2026-08-06): modal de
            renomeio — reaproveita os mesmos componentes Dialog já importados nesta página. */}
        <Dialog open={!!renomeandoLista} onOpenChange={(open) => { if (!open) setRenomeandoLista(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Renomear lista</DialogTitle>
              <DialogDescription>O novo nome fica visível em todas as telas que usam esta lista (Leads, Disparos).</DialogDescription>
            </DialogHeader>
            <Input
              value={renomeandoLista?.nome ?? ""}
              onChange={(e) => setRenomeandoLista(prev => prev ? { ...prev, nome: e.target.value } : prev)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmarRenomeio(); }}
              autoFocus
              maxLength={100}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenomeandoLista(null)} disabled={salvandoRenomeio}>Cancelar</Button>
              <Button onClick={confirmarRenomeio} disabled={salvandoRenomeio}>
                {salvandoRenomeio ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>



        <TabsContent value="tags" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Input
              placeholder="Buscar tag..."
              value={tagSearch}
              onChange={e => setTagSearch(e.target.value)}
              className="h-8 max-w-xs"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const names = filteredTags.map(t => t.nome);
                  setForm({
                    ...form,
                    tags_selecionadas: allTagsSelected
                      ? form.tags_selecionadas.filter((n: string) => !names.includes(n))
                      : Array.from(new Set([...form.tags_selecionadas, ...names])),
                  });
                }}
              >
                {allTagsSelected ? "Limpar" : "Selecionar todas"}
              </Button>
              {/* [AUDITORIA] BUG (achado na Sprint Placeholders/Upload, 2026-07-30): `<Switch checked />`
                  sem `onCheckedChange` — não é editável, mas parecia um controle de verdade.
                  Funcionalmente não era um bug (opt-out já é sempre filtrado, ver `fetchCount` no
                  componente pai), só um controle enganoso. [AUDITORIA] FIX APLICADO: trocado por
                  um indicador estático — comunica a mesma informação sem fingir ser clicável. */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                Opt-outs sempre excluídos
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
            {filteredTags.map(t => {
              const checked = form.tags_selecionadas.includes(t.nome);
              return (
                <label
                  key={t.id}
                  htmlFor={t.id}
                  className={`flex items-center space-x-2 p-2 border rounded cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50"}`}
                >
                  <input
                    type="checkbox"
                    id={t.id}
                    checked={checked}
                    className="h-4 w-4"
                    onChange={(e) => {
                      const newTags = e.target.checked
                        ? [...form.tags_selecionadas, t.nome]
                        : form.tags_selecionadas.filter((st: string) => st !== t.nome);
                      setForm({...form, tags_selecionadas: newTags});
                    }}
                  />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.cor }} />
                  <span className="text-sm">{t.nome}</span>
                </label>
              );
            })}
            {filteredTags.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full text-center py-4">Nenhuma tag encontrada</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="estagio" className="p-4 border rounded-lg bg-card space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Selecione os estágios do funil:</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setForm({
                  ...form,
                  estagios_selecionados: allEstagiosSelected ? [] : estagios.map(s => s.id),
                });
              }}
            >
              {allEstagiosSelected ? "Limpar" : "Selecionar todos"}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {estagios.map(s => {
              const checked = form.estagios_selecionados.includes(s.id);
              return (
                <label
                  key={s.id}
                  htmlFor={s.id}
                  className={`flex items-center space-x-2 p-2 border rounded cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50"}`}
                >
                  <input
                    type="checkbox"
                    id={s.id}
                    checked={checked}
                    className="h-4 w-4"
                    onChange={(e) => {
                      const newEstagios = e.target.checked
                        ? [...form.estagios_selecionados, s.id]
                        : form.estagios_selecionados.filter((se: string) => se !== s.id);
                      setForm({...form, estagios_selecionados: newEstagios});
                    }}
                  />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.cor }} />
                  <span className="text-sm">{s.nome}</span>
                </label>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="csv" className="p-4 border rounded-lg bg-card space-y-4 text-center">
          <div className="py-8 border-2 border-dashed rounded-lg">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Clique para fazer upload ou arraste o arquivo (CSV, XLSX ou XLS)</p>
            <input type="file" className="hidden" id="csv-upload" accept=".csv,.xlsx,.xls" onChange={handleImportFile} />
            <Button variant="outline" size="sm" className="mt-4" onClick={() => document.getElementById('csv-upload')?.click()}>
              Selecionar Arquivo
            </Button>
          </div>
          {csvPreview.length > 0 && (
            <div className="space-y-3 text-left">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Preview (Primeiras 5 linhas) — {importFileName}</p>
              <div className="border rounded overflow-hidden overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {csvPreview.map((row, i) => (
                      <tr key={i} className={`divide-x ${i === 0 ? "font-bold bg-muted/50" : ""}`}>
                        {row.map((cell, j) => <td key={j} className="p-1 whitespace-nowrap">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* [AUDITORIA] FIX APLICADO: preview acima mostra o arquivo cru (por isso telefone
                  aparece em branco quando o arquivo tem essas linhas) — este resumo roda a MESMA
                  validação que "Confirmar Importação" vai aplicar, então dá pra saber quantos
                  contatos de verdade vêm ANTES de confirmar, sem precisar adivinhar pela preview. */}
              {preAnalise && (
                <div className={`p-3 rounded-lg border text-xs space-y-1 ${preAnalise.novos.length === 0 ? "bg-destructive/10 border-destructive/30" : "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-500/30"}`}>
                  <p className="font-bold uppercase tracking-wider text-muted-foreground">Pré-validação (o que será importado de fato)</p>
                  <p>
                    <span className="font-bold text-emerald-600">{preAnalise.novos.length}</span> de {preAnalise.totalLinhas} linha(s) têm telefone válido e serão importadas
                    {preAnalise.corrigidos > 0 && <> (<span className="font-bold">{preAnalise.corrigidos}</span> com DDI/9º dígito corrigido automaticamente)</>}.
                  </p>
                  {preAnalise.descartados > 0 && (
                    <p className="text-muted-foreground">
                      <span className="font-bold text-destructive">{preAnalise.descartados}</span> linha(s) serão descartadas por telefone vazio ou inválido (fora do padrão de 10 a 13 dígitos, ou mais de um telefone colado na mesma célula) — a preview acima mostra o arquivo cru, essas linhas não geram contato.
                    </p>
                  )}
                  {/* [AUDITORIA] FIX APLICADO (Sprint Importação Upsert, 2026-08-06): novos vs. já
                      existentes na conta, checado contra o banco (POST /contatos/checar-telefones)
                      assim que o arquivo é lido — antes não tinha como saber isso ANTES de
                      confirmar (só depois, e olhe lá, já que o insert antigo nem devolvia essa
                      contagem separada). */}
                  {checandoExistentes ? (
                    <p className="text-muted-foreground italic">Verificando quais já existem na sua base...</p>
                  ) : telefonesExistentes && preAnalise.novos.length > 0 ? (
                    <p>
                      Desses, <span className="font-bold text-emerald-600">{preAnalise.novos.length - jaExistiamCount}</span> são novos
                      {jaExistiamCount > 0 && <> e <span className="font-bold text-amber-600">{jaExistiamCount}</span> já existem na sua base (não serão sobrescritos — nome/notas/tags de um contato já existente permanecem como estão)</>}.
                    </p>
                  ) : null}
                  {preAnalise.suspeitos.length > 0 && (() => {
                    const contagemMotivos: Record<string, number> = {};
                    for (const s of preAnalise.suspeitos) {
                      for (const m of s.motivo.split("; ")) contagemMotivos[m] = (contagemMotivos[m] || 0) + 1;
                    }
                    const motivoMaisComum = Object.entries(contagemMotivos).sort((a, b) => b[1] - a[1])[0];
                    // Linhas únicas (uma linha pode ter mais de 1 motivo, ex: nome=telefone E DDD inválido)
                    const linhasUnicas = new Set(preAnalise.suspeitos.map(s => s.linha)).size;
                    return (
                      <p className="text-amber-700 dark:text-amber-500">
                        ⚠️ <span className="font-bold">{linhasUnicas}</span> linha(s) sinalizada(s) como suspeita(s) — mais comum: "{motivoMaisComum?.[0]}" ({motivoMaisComum?.[1]}×). Serão importadas normalmente, só revise antes de disparar.
                      </p>
                    );
                  })()}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={cancelarImportacao} disabled={importLoading}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={confirmarImportacao} disabled={importLoading || (preAnalise?.novos.length ?? 0) === 0}>
                  {importLoading ? "Importando..." : "Confirmar Importação"}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview em tempo real dos contatos filtrados */}
      {targetContacts.length > 0 && (
        <div className="p-4 border rounded-lg bg-card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium">Contatos selecionados</p>
              <p className="text-xs text-muted-foreground">
                {filteredPreview.length} de {targetContacts.length} {previewSearch ? "(filtrados)" : "totais"}
              </p>
            </div>
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={previewSearch}
              onChange={e => setPreviewSearch(e.target.value)}
              className="h-8 max-w-xs"
            />
          </div>
          {/* [AUDITORIA] FIX APLICADO (achado 2026-07-28): faltava overflow-x-auto — só a tabela
              de importação de CSV/XLSX do sistema sem essa proteção (achado na auditoria de
              responsividade, todas as outras já tinham). */}
          {/* [AUDITORIA] FIX APLICADO (Sprint Colunas de Status de Envio, 2026-07-31): 4 colunas
              novas (Situação no CRM, Status de envio, Data do último envio, Nome da última
              campanha) — usuário revisou este passo e quis mais contexto antes de decidir quem
              entra na campanha. "Nome da última campanha" vem de `statusEnvioPorTelefone`
              (busca em lote só pros contatos visíveis, ver useStatusEnvio acima); o resto já
              está no próprio `c` (mesmo select usado pelo cooldown/empresa). */}
          <div className="max-h-72 overflow-y-auto overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-xs">Nome</th>
                  <th className="px-3 py-2 font-medium text-xs">Telefone</th>
                  <th className="px-3 py-2 font-medium text-xs">Situação no CRM</th>
                  <th className="px-3 py-2 font-medium text-xs">Status de envio</th>
                  <th className="px-3 py-2 font-medium text-xs">Último envio</th>
                  <th className="px-3 py-2 font-medium text-xs">Última campanha</th>
                </tr>
              </thead>
              <tbody>
                {filteredPreview.slice(0, 500).map((c: any, i: number) => {
                  const estagio = c.funil_estagio_id ? estagioPorId[c.funil_estagio_id] : null;
                  const statusEnvio = statusEnvioPorTelefone[chaveTelefone(c.telefone)];
                  return (
                    <tr key={c.id || c.telefone || i} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5 truncate max-w-[200px]">{c.nome || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.telefone || "—"}</td>
                      <td className="px-3 py-1.5">
                        {estagio ? (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: estagio.cor }} />
                            {estagio.nome}
                          </Badge>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <TagStatusEnvio ultimoDisparoEm={c.ultimo_disparo_em} compact />
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {c.ultimo_disparo_em ? new Date(c.ultimo_disparo_em).toLocaleDateString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[160px]">
                        {statusEnvio?.campanha_nome || "—"}
                      </td>
                    </tr>
                  );
                })}
                {filteredPreview.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum contato corresponde à busca.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredPreview.length > 500 && (
            <p className="text-[10px] text-muted-foreground text-center">Mostrando primeiros 500 de {filteredPreview.length}.</p>
          )}
        </div>
      )}
    </div>
  );
}


// [AUDITORIA] LÓGICA (Sprint Placeholders/Upload, 2026-07-30): mesmo teto usado pelo composer do
// chat (`WhatsAppInterface.tsx`) — precisa bater com `MAX_OUTBOUND_MEDIA_BYTES` do backend
// (`whatsapp.ts`, usado pelo `multer` da rota `/upload-media`), senão o aviso amigável aqui não
// bate com o que o servidor de fato aceita.
const MAX_OUTBOUND_MEDIA_BYTES = 5 * 1024 * 1024;
const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const TIPO_MIDIA_PARA_UPLOAD: Record<string, string> = { imagem: "image", audio: "audio", documento: "document" };
// [AUDITORIA] LÓGICA (Sprint Intervalo em Minutos, 2026-07-31): piso absoluto de 5s (mesmo mínimo
// já usado pelo perfil "Rápido") — compartilhado entre a validação do passo Anti-ban (StepAntiBan)
// e o gate de "Próximo" (DisparosPage.stepValid), pra não duplicar o número mágico em dois lugares
// que precisariam ser atualizados juntos. O backend (disparoProcessor.ts) aplica o mesmo piso de
// novo, independente desta validação de UI.
const DELAY_MIN_ABSOLUTO_MINUTOS = 5 / 60;

function StepMessage({ form, setForm }: any) {
  const { user } = useAuth();
  const mediaTypes = [
    { id: "texto", label: "Texto", icon: MessageSquare },
    { id: "imagem", label: "Imagem", icon: ImageIcon },
    { id: "audio", label: "Áudio", icon: Headphones },
    { id: "documento", label: "Documento", icon: FileText },
  ];

  // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): campo ativo do Textarea
  // compartilhado — "Mensagem" (`form.mensagem`) para tipo_midia='texto', "Legenda" (`form.legenda_midia`)
  // para os demais tipos. Único ponto de leitura/escrita usado pelo Textarea, contador de
  // caracteres, botões de placeholder e pela prévia abaixo — evita repetir a mesma ternária em 5
  // lugares e garante que os 4 usos nunca fiquem dessincronizados entre si.
  const campoAtivo: "mensagem" | "legenda_midia" = form.tipo_midia === "texto" ? "mensagem" : "legenda_midia";
  const textoAtivo: string = form[campoAtivo] || "";
  const setTextoAtivo = (valor: string) => setForm({ ...form, [campoAtivo]: valor });

  // [AUDITORIA] LÓGICA (Sprint Templates de Disparo, 2026-07-30): carregar/salvar template
  // reaproveita a mesma tabela genérica (`disparo_templates`, CRUD via makeCrud) usada pela tela
  // dedicada `DisparoTemplates.tsx`. `loadedTemplateId` rastreia se a mensagem atual veio de um
  // template salvo — permite diferenciar "Salvar alterações" (UPDATE) de "Salvar como novo"
  // (INSERT) no modal de salvar.
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);
  const [loadedTemplateNome, setLoadedTemplateNome] = useState("");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveNome, setSaveNome] = useState("");
  const [salvandoTemplate, setSalvandoTemplate] = useState(false);

  const abrirCarregarTemplate = async () => {
    setTemplatesModalOpen(true);
    setTemplatesLoading(true);
    const { data, error } = await api.from("disparo_templates").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setTemplates(data || []);
    setTemplatesLoading(false);
  };

  // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): agora que o Textarea lê
  // `form.mensagem`/`form.legenda_midia` diretamente conforme o tipo (ver `campoAtivo` acima), não
  // precisa mais espelhar os dois campos pra exibição — só popular o campo que o tipo do template
  // realmente usa. Fallback `tpl.legenda_midia || tpl.mensagem` mantido por compatibilidade com
  // templates antigos (salvos antes deste fix, que gravavam o mesmo texto nos dois campos).
  const carregarTemplate = (tpl: any) => {
    setForm({
      ...form,
      tipo_midia: tpl.tipo_midia,
      mensagem: tpl.tipo_midia === "texto" ? tpl.mensagem : "",
      legenda_midia: tpl.tipo_midia === "texto" ? "" : (tpl.legenda_midia || tpl.mensagem || ""),
      url_midia: tpl.url_midia || "",
    });
    setLoadedTemplateId(tpl.id);
    setLoadedTemplateNome(tpl.nome);
    setTemplatesModalOpen(false);
    toast.success(`Template "${tpl.nome}" carregado`);
  };

  const abrirSalvarTemplate = () => {
    setSaveNome(loadedTemplateId ? loadedTemplateNome : "");
    setSaveModalOpen(true);
  };

  // [AUDITORIA] BUG (achado na Sprint Placeholders/Upload, 2026-07-30): o botão de upload ao lado
  // do campo de URL de mídia não tinha nenhum `onClick` — puramente decorativo, o único jeito real
  // de anexar mídia era colar uma URL já hospedada em outro lugar. [AUDITORIA] FIX APLICADO:
  // reaproveita a mesma rota `POST /api/whatsapp/upload-media` já usada pelo composer do chat
  // (`WhatsAppInterface.tsx`) em vez de reinventar upload — devolve uma URL http(s) estável,
  // gravada em `UPLOADS_DIR` no backend, servida via `/uploads` (não expira, não depende de base64).
  // Essa mesma URL é a que `disparoProcessor.ts` usa pra todos os envios da campanha (via
  // `garantirMidiaEstavel()`, que já roda uma vez por campanha) — não precisa de lógica extra aqui
  // pra "subir uma vez, reaproveitar em massa": o upload em si já é o "subir uma vez".
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const handleUploadMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_OUTBOUND_MEDIA_BYTES) {
      toast.error(`Arquivo de ${(file.size / 1024 / 1024).toFixed(1)}MB excede o limite de ${(MAX_OUTBOUND_MEDIA_BYTES / 1024 / 1024).toFixed(0)}MB.`);
      e.target.value = "";
      return;
    }
    setUploadingMedia(true);
    try {
      const uploadForm = new FormData();
      uploadForm.append("arquivo", file, file.name);
      uploadForm.append("tipo", TIPO_MIDIA_PARA_UPLOAD[form.tipo_midia] || "document");
      const token = await getFreshToken();
      const res = await fetch(`${API_BASE}/api/whatsapp/upload-media`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: uploadForm,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Falha no upload do arquivo" }));
        throw new Error(err.message || "Falha no upload do arquivo");
      }
      const { url } = await res.json();
      setForm({ ...form, url_midia: url });
      toast.success("Arquivo enviado com sucesso");
    } catch (err: any) {
      toast.error("Erro ao enviar arquivo", { description: err?.message });
    } finally {
      setUploadingMedia(false);
      e.target.value = "";
    }
  };

  const confirmarSalvarTemplate = async (comoNovo: boolean) => {
    if (!user) return;
    if (!saveNome.trim()) { toast.error("Informe um nome para o template"); return; }
    setSalvandoTemplate(true);
    // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): antes espelhava
    // `form.mensagem` em `legenda_midia` pra contornar o Textarea escrevendo sempre em `mensagem`
    // — não precisa mais, cada campo já vem preenchido pelo tipo certo (ver `campoAtivo` acima).
    // Mesmo padrão de `mensagem`/`legenda_midia` já usado pela tela dedicada `DisparoTemplates.tsx`
    // (mensagem só populado pra texto puro, legenda_midia só pros demais tipos).
    const payload = {
      user_id: user.id,
      nome: saveNome.trim(),
      tipo_midia: form.tipo_midia,
      mensagem: form.tipo_midia === "texto" ? form.mensagem : "",
      url_midia: form.url_midia || null,
      legenda_midia: form.tipo_midia === "texto" ? null : form.legenda_midia,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = (!comoNovo && loadedTemplateId)
      ? await api.from("disparo_templates").update(payload).eq("id", loadedTemplateId).select().single()
      : await api.from("disparo_templates").insert(payload).select().single();
    setSalvandoTemplate(false);
    if (error) { toast.error(error.message); return; }
    toast.success(!comoNovo && loadedTemplateId ? "Alterações salvas no template!" : "Template salvo!");
    if (data) { setLoadedTemplateId(data.id); setLoadedTemplateNome(data.nome); }
    setSaveModalOpen(false);
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
            {mediaTypes.map(t => (
              <Button
                key={t.id}
                variant={form.tipo_midia === t.id ? "default" : "ghost"}
                size="sm"
                className="h-8 gap-2"
                onClick={() => setForm({...form, tipo_midia: t.id})}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {loadedTemplateNome && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <LayoutTemplate className="h-2.5 w-2.5" /> {loadedTemplateNome}
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={abrirCarregarTemplate}>
              <LayoutTemplate className="h-4 w-4" /> Carregar template
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={abrirSalvarTemplate}>
              <Save className="h-4 w-4" /> Salvar como template
            </Button>
          </div>
        </div>

        {form.tipo_midia !== 'texto' && (
          <div className="space-y-2">
            <Label>Arquivo de Mídia</Label>
            <div className="flex gap-2">
              <Input placeholder="URL do arquivo (ou faça upload)" value={form.url_midia} onChange={e => setForm({...form, url_midia: e.target.value})} />
              <input
                type="file"
                className="hidden"
                id="disparo-media-upload"
                accept={form.tipo_midia === "imagem" ? "image/*" : form.tipo_midia === "audio" ? "audio/*" : undefined}
                onChange={handleUploadMedia}
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploadingMedia}
                onClick={() => document.getElementById("disparo-media-upload")?.click()}
              >
                {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

        {/* [AUDITORIA] BUG (achado na Sprint Templates de Disparo, 2026-07-30): este Textarea era
            reaproveitado tanto pra "Mensagem" (tipo_midia='texto') quanto pra "Legenda" (demais
            tipos), mas SEMPRE escrevia em `form.mensagem` — nunca em `form.legenda_midia`, mesmo
            quando o label mostrado era "Legenda". `StepReview.handleStart` envia os dois campos
            separados pro backend (`mensagem_template` e `legenda_midia`), então toda campanha de
            mídia criada do zero (sem carregar template) gravava `legenda_midia` vazio de verdade.
            [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): Textarea, contador
            de caracteres e botões de placeholder abaixo passam a usar `textoAtivo`/`setTextoAtivo`
            (ver `campoAtivo` no topo do componente) — leem/escrevem em `form.mensagem` OU
            `form.legenda_midia` conforme `tipo_midia`, nunca mais sempre no mesmo campo. */}
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <Label>{form.tipo_midia === 'texto' ? 'Mensagem' : 'Legenda (opcional)'}</Label>
            <span className={`text-[10px] ${textoAtivo.length > 4096 ? "text-destructive font-bold" : "text-muted-foreground"}`}>{textoAtivo.length}/4096</span>
          </div>
          <Textarea
            className="min-h-[150px] font-mono text-sm"
            value={textoAtivo}
            onChange={e => setTextoAtivo(e.target.value)}
            placeholder={form.tipo_midia === 'texto' ? "Olá {{primeiro_nome}}, tudo bem?" : "Legenda do arquivo..."}
          />
          <div className="flex gap-2 flex-wrap">
            {["{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{data}}", "{{empresa}}"].map(v => (
              <Button key={v} size="sm" variant="secondary" className="text-[10px] h-7" onClick={() => {
                setTextoAtivo(textoAtivo + v);
              }}>+{v}</Button>
            ))}
          </div>
          {/* [AUDITORIA] FIX APLICADO (Sprint Variação sem IA, 2026-08-06): dica de sintaxe do
              spintax, perto dos atalhos de placeholder — mesmo lugar que `DisparoTemplates.tsx`
              usa pro texto de ajuda equivalente. */}
          <p className="text-[10px] text-muted-foreground">
            💡 Use <code className="px-1 rounded bg-muted">{"{opção 1|opção 2|opção 3}"}</code> pra variar o texto por contato sem custo de IA — ex: <code className="px-1 rounded bg-muted">{"{Oi|Olá|E aí}"}</code>.
          </p>
          {/* [AUDITORIA] FIX APLICADO (Sprint Variação sem IA, 2026-08-06): aviso NÃO bloqueante
              (mesmo espírito da decisão já tomada na sprint de importação — avisa, não trava) —
              mensagem sem nenhum placeholder nem spintax sai byte-idêntica pra todo mundo, o
              sinal de risco de spam mais citado na pesquisa desta sessão (política WhatsApp
              Business Platform 2026), mais forte que "sem humanização por IA". */}
          {mensagemSemPersonalizacao(textoAtivo) && (
            <p className="text-[10px] text-amber-700 dark:text-amber-500 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              Esta mensagem vai sair idêntica para todos os destinatários — considere usar {"{{primeiro_nome}}"} ou variações {"{a|b}"} para reduzir risco de bloqueio.
            </p>
          )}
        </div>

        {/* Preview Card */}
        <div className="p-4 border rounded-lg bg-emerald-50/30 dark:bg-emerald-950/10">
          <p className="text-[10px] font-bold uppercase text-emerald-600 mb-2">Preview do 1º Contato</p>
          <div className="p-3 bg-white dark:bg-zinc-900 rounded shadow-sm max-w-[80%] border-l-4 border-emerald-500">
            {form.tipo_midia !== 'texto' && (
              <div className="aspect-video bg-muted rounded mb-2 flex items-center justify-center">
                <ImageIcon className="h-8 w-8 opacity-20" />
              </div>
            )}
            {/* [AUDITORIA] FIX APLICADO (Sprint Placeholders/Upload, 2026-07-30): prévia agora usa
                a MESMA função de substituição do envio real (substituirPlaceholders, topo do
                arquivo) com um contato de exemplo completo — antes só {{nome}}/{{primeiro_nome}}
                eram trocados aqui, então a prévia nunca alertava que {{telefone}}/{{data}}/
                {{empresa}} ficavam literais na mensagem de verdade.
                [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): usa `textoAtivo`
                (mensagem OU legenda, conforme tipo_midia) em vez de `form.mensagem` sempre — pra
                mídia, a prévia agora mostra de fato o que vai virar `mensagem_enviada` (legenda
                personalizada) e não o campo errado (que ficava vazio).
                [AUDITORIA] FIX APLICADO (Sprint Variação sem IA, 2026-08-06): `resolverSpintax`
                encadeado por cima — mostra UMA resolução possível (a prévia já ajuda o operador a
                visualizar o formato), não promete que é o texto exato que todo mundo vai receber
                (aviso explícito logo abaixo, já que cada contato sorteia sua própria combinação
                no envio real). */}
            <p className="text-sm whitespace-pre-wrap">
              {resolverSpintax(substituirPlaceholders(textoAtivo, { nome: "João Silva", telefone: "5511999998888", empresa: "Empresa Exemplo" }))}
            </p>
            {textoTemSpintax(textoAtivo) && (
              <p className="text-[10px] text-muted-foreground italic mt-1">
                🎲 Mensagem tem variação (spintax) — cada contato recebe uma combinação sorteada de verdade; esta prévia mostra só um exemplo.
              </p>
            )}
            <span className="text-[10px] text-muted-foreground float-right">10:45</span>
          </div>
        </div>
      </div>

      {/* Modal: Carregar template */}
      <Dialog open={templatesModalOpen} onOpenChange={setTemplatesModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Carregar template</DialogTitle>
            <DialogDescription>Escolha um template salvo para preencher a mensagem deste passo.</DialogDescription>
          </DialogHeader>
          {templatesLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum template salvo ainda. Escreva uma mensagem e use "Salvar como template" para criar o primeiro.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {templates.map(tpl => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => carregarTemplate(tpl)}
                  className="w-full text-left p-3 border rounded-lg hover:bg-muted/50 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{tpl.nome}</span>
                    <Badge variant="outline" className="text-[10px] capitalize flex-shrink-0">{tpl.tipo_midia}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                    {tpl.tipo_midia === "texto" ? tpl.mensagem : (tpl.legenda_midia || tpl.mensagem || "(sem legenda)")}
                  </p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Salvar como template */}
      <Dialog open={saveModalOpen} onOpenChange={setSaveModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{loadedTemplateId ? "Salvar template" : "Salvar como novo template"}</DialogTitle>
            <DialogDescription>
              Grava a mensagem e o tipo de mídia atuais deste passo em Templates, pra reaproveitar em outra campanha depois.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nome do template</Label>
            <Input
              value={saveNome}
              onChange={e => setSaveNome(e.target.value)}
              placeholder="Ex: Promoção mensal"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setSaveModalOpen(false)}>Cancelar</Button>
            {loadedTemplateId && (
              <Button variant="secondary" disabled={salvandoTemplate} onClick={() => confirmarSalvarTemplate(true)}>
                Salvar como novo
              </Button>
            )}
            <Button disabled={salvandoTemplate} onClick={() => confirmarSalvarTemplate(false)}>
              {salvandoTemplate && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {loadedTemplateId ? "Salvar alterações" : "Criar template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


function StepAntiBan({ form, setForm }: any) {
  const [instancias, setInstancias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // [AUDITORIA] BUG (Sprint Disparos/Multi-instância, 2026-07-25): <Switch /> sem
  // checked/onCheckedChange — não filtrava nada, e o limiar (>70) nem batia com o hardcoded
  // (>=40) do botão "Selecionar todas" logo ao lado. [AUDITORIA] FIX APLICADO: estado local
  // ligado ao toggle, usado tanto para filtrar a lista abaixo quanto para decidir o limiar do
  // "Selecionar todas" (uniformizado: >70 quando o toggle está ativo, >=40 caso contrário).
  const [apenasSaudaveis, setApenasSaudaveis] = useState(false);
  const LIMIAR_SAUDAVEL = 70;
  const LIMIAR_PADRAO = 40;

  useEffect(() => {
    const fetchInstancias = async () => {
      // [AUDITORIA] BUG (achado 2026-07-27): `.not("evolution_instancia", "is", null)` é um
      // no-op no QueryBuilder (src/integrations/database/client.ts) — `not()` empilha o filtro
      // em `_filters`, mas `_buildParams()` não tem nenhum branch para o operador `not_is` (só
      // trata eq/in/gte/lte/gt/lt/ilike), e o backend (`crud.ts`) também não tem um parâmetro de
      // query equivalente a "_not_null"/"_ne". Resultado real: esta busca sempre trouxe TODOS os
      // `agentes` do usuário, inclusive linhas sem `evolution_instancia` (nunca conectaram a
      // Evolution) — apareciam como opção selecionável aqui, no seletor de instâncias do
      // anti-ban. Se o usuário selecionasse só essas linhas "fantasma", o backend
      // (`resolverInstanciasCampanha` em disparoProcessor.ts, que SIM filtra
      // `evolution_instancia IS NOT NULL` corretamente) devolveria uma lista vazia de instâncias
      // elegíveis, e o round-robin cairia silenciosamente no fallback de uma única instância
      // padrão — anulando a distribuição multi-instância que o usuário pensava ter configurado,
      // sem erro nenhum visível. [AUDITORIA] FIX APLICADO: filtro aplicado no cliente, no único
      // ponto do frontend que usa `.not()` — mudança isolada aqui em vez de implementar suporte
      // genérico a "not is null" no QueryBuilder/crud.ts (usados por muitas outras telas, maior
      // risco pra um fix não pedido). `.neq()`/`.not()` continuam sendo no-ops no cliente
      // compartilhado; comentado lá também para não pegar o próximo desenvolvedor de surpresa.
      const { data } = await api.from("agentes").select("*");
      setInstancias((data || []).filter((i: any) => !!i.evolution_instancia));
      setLoading(false);
    };
    fetchInstancias();
  }, []);

  const instanciasVisiveis = apenasSaudaveis
    ? instancias.filter(i => (i.whatsapp_score || 0) > LIMIAR_SAUDAVEL)
    : instancias;

  // [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): cada perfil agora carrega
  // seu equivalente em minutos (minMin/maxMin) — clicar no card só preenche os campos de
  // intervalo customizado abaixo (atalho de preenchimento), não trava mais o valor em segundos
  // fixos. "Ultra Seguro" é novo, cobre o caso de uso citado pelo usuário ("pelo menos 8-10
  // minutos de diferença") sem precisar digitar do zero.
  const profiles = [
    { id: "safe", label: "SEGURO", icon: ShieldCheck, color: "text-emerald-500", delay: "30-60s", minMin: 0.5, maxMin: 1, limit: "50", desc: "Recomendado para novos números" },
    { id: "moderate", label: "MODERADO", icon: Shield, color: "text-yellow-500", delay: "15-30s", minMin: 0.25, maxMin: 0.5, limit: "100", desc: "Equilíbrio entre velocidade e segurança" },
    { id: "fast", label: "RÁPIDO", icon: ShieldAlert, color: "text-red-500", delay: "5-15s", minMin: 5 / 60, maxMin: 15 / 60, limit: "200", desc: "Risco aumentado de banimento", alert: true },
    { id: "ultra_safe", label: "ULTRA SEGURO", icon: ShieldCheck, color: "text-blue-600", delay: "8-12min", minMin: 8, maxMin: 12, limit: "20", desc: "Máxima cautela — campanhas grandes demoram muito mais" },
  ];

  // Piso absoluto (DELAY_MIN_ABSOLUTO_MINUTOS, módulo-level) — decisão de segurança pra não deixar
  // o operador configurar, por engano, um intervalo perigosamente baixo digitando direto no campo
  // de minutos. O backend (disparoProcessor.ts) aplica o mesmo piso de novo, independente desta
  // validação de UI.
  const intervaloInvalido = form.delay_min_minutos < DELAY_MIN_ABSOLUTO_MINUTOS
    || form.delay_max_minutos < DELAY_MIN_ABSOLUTO_MINUTOS
    || form.delay_min_minutos > form.delay_max_minutos;

  return (
    <div className="space-y-6">
      {/* Instances Selection */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <Label className="font-bold">Instâncias para Disparar {form.instancias_ids.length > 0 && <Badge variant="secondary" className="ml-2">{form.instancias_ids.length}</Badge>}</Label>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const available = instancias
                  .filter(i => apenasSaudaveis ? (i.whatsapp_score || 0) > LIMIAR_SAUDAVEL : (i.whatsapp_score || 0) >= LIMIAR_PADRAO)
                  .map(i => i.id);
                const allSelected = available.length > 0 && available.every(id => form.instancias_ids.includes(id));
                setForm({ ...form, instancias_ids: allSelected ? [] : available });
              }}
            >
              Selecionar todas
            </Button>
            <div className="flex items-center gap-2">
              <Switch checked={apenasSaudaveis} onCheckedChange={setApenasSaudaveis} />
              <span className="text-xs">Apenas saudáveis (&gt;70)</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {instanciasVisiveis.map(inst => {
            const isBlocked = (inst.whatsapp_score || 0) < LIMIAR_PADRAO;
            return (
              <div key={inst.id} className={`flex items-center justify-between p-3 border rounded-lg ${isBlocked ? 'bg-red-50/50 dark:bg-red-950/10 border-red-200' : ''}`}>
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    disabled={isBlocked} 
                    checked={form.instancias_ids.includes(inst.id)}
                    onChange={(e) => {
                      const ids = e.target.checked 
                        ? [...form.instancias_ids, inst.id]
                        : form.instancias_ids.filter((id: string) => id !== inst.id);
                      setForm({...form, instancias_ids: ids});
                    }}
                    className="h-4 w-4" 
                  />
                  <div>
                    <p className="text-sm font-bold">{inst.nome}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{inst.evolution_instancia}</p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={isBlocked ? "destructive" : "outline"} className="text-[10px]">
                    Score: {inst.whatsapp_score || 0}
                  </Badge>
                  {isBlocked && <p className="text-[9px] text-red-500 font-bold mt-1 uppercase">Bloqueada</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Velocity Profiles */}
      {/* [AUDITORIA] FIX APLICADO (achado 2026-07-28): recolhe pra 1 coluna em telas pequenas
          (cards de perfil têm bastante texto, ficavam ilegíveis espremidos em 3 num celular).
          [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): grid ganhou uma 4ª
          coluna (Ultra Seguro) — 1 coluna em mobile, 2 em tablet, 4 em desktop. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {profiles.map(p => (
          <Card
            key={p.id}
            className={`p-4 cursor-pointer transition-all border-2 ${form.perfil_velocidade === p.id ? 'border-primary shadow-md' : 'border-transparent'}`}
            onClick={() => setForm({...form, perfil_velocidade: p.id, delay_min_minutos: p.minMin, delay_max_minutos: p.maxMin})}
          >
            <p.icon className={`h-8 w-8 mb-2 ${p.color}`} />
            <h3 className="font-bold text-sm">{p.label}</h3>
            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Delay: {p.delay}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Limite: {p.limit}/dia</p>
            </div>
            {p.alert && <p className="text-[9px] text-red-500 font-bold mt-2 uppercase flex items-center gap-1"><AlertOctagon className="h-3 w-3" /> Risco de Ban</p>}
          </Card>
        ))}
      </div>

      {/* [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): intervalo customizado
          em minutos — os cards acima só preenchem estes campos como atalho, o valor real que vai
          pra campanha é sempre este daqui (StepReview.handleStart manda `delay_min_minutos`/
          `delay_max_minutos` convertidos pra segundos, ver payload). Editável livremente, incluindo
          os 8-10+ minutos pedidos pelo usuário sem precisar clicar em "Ultra Seguro". */}
      <Card className="p-4 space-y-3">
        <Label className="font-bold flex items-center gap-2"><Clock className="h-4 w-4" /> Intervalo Customizado Entre Mensagens</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[10px] uppercase text-muted-foreground">Intervalo mínimo (minutos)</span>
            <Input
              type="number"
              step="0.1"
              min={DELAY_MIN_ABSOLUTO_MINUTOS}
              value={form.delay_min_minutos}
              onChange={e => setForm({ ...form, delay_min_minutos: parseFloat(e.target.value) })}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] uppercase text-muted-foreground">Intervalo máximo (minutos)</span>
            <Input
              type="number"
              step="0.1"
              min={DELAY_MIN_ABSOLUTO_MINUTOS}
              value={form.delay_max_minutos}
              onChange={e => setForm({ ...form, delay_max_minutos: parseFloat(e.target.value) })}
              className="h-8"
            />
          </div>
        </div>
        {intervaloInvalido ? (
          <p className="text-[10px] text-destructive font-medium">
            O mínimo não pode ser maior que o máximo, e nenhum dos dois pode ser menor que {DELAY_MIN_ABSOLUTO_MINUTOS.toFixed(2)} min (5s) — piso de segurança do sistema.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Cada mensagem espera um tempo aleatório dentro dessa faixa antes da próxima — os cards acima só preenchem estes campos, você pode digitar qualquer valor (ex: 8 a 10 minutos).
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Sending Window */}
        <Card className="p-4 space-y-4">
          <Label className="font-bold flex items-center gap-2"><Calendar className="h-4 w-4" /> Janela de Envio</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Início</span>
              <Input type="time" value={form.janela_inicio} onChange={e => setForm({...form, janela_inicio: e.target.value})} />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Término</span>
              <Input type="time" value={form.janela_fim} onChange={e => setForm({...form, janela_fim: e.target.value})} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Pausar nos fins de semana</span>
            <Switch checked={form.pausa_fins_semana} onCheckedChange={v => setForm({...form, pausa_fins_semana: v})} />
          </div>
        </Card>

        {/* Auto Pause */}
        <Card className="p-4 space-y-4">
          <Label className="font-bold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Pausa Automática</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs">Pausar em erros consecutivos</span>
              <Switch checked={form.pausa_erros_consecutivos} onCheckedChange={v => setForm({...form, pausa_erros_consecutivos: v})} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Pausar se bloqueios detectados</span>
              <Switch checked={form.pausa_bloqueios_detectados} onCheckedChange={v => setForm({...form, pausa_bloqueios_detectados: v})} />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Falhas seguidas para pausar</span>
              <Input type="number" value={form.limite_erros_consecutivos} onChange={e => setForm({...form, limite_erros_consecutivos: parseInt(e.target.value)})} className="h-8" />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Limite Diário de Mensagens por Instância</span>
              <Input
                type="number"
                value={form.limite_diario_mensagens}
                onChange={e => setForm({ ...form, limite_diario_mensagens: parseInt(e.target.value) })}
                className="h-8"
              />
              <p className="text-[10px] text-muted-foreground">
                Recomendado: 150 a 200 para chips novos/em aquecimento; até 500 para chips antigos.
              </p>
            </div>
            {/* [AUDITORIA] FIX APLICADO (Sprint Cooldown de Disparos, 2026-07-30): campo novo —
                sem ele, nada impedia o mesmo contato de receber duas campanhas diferentes em
                sequência rápida (achado real do usuário: mesmo contato de teste recebendo "Bom
                dia, tudo bem?" mais de uma vez). Bloqueio de verdade acontece no backend
                (disparoProcessor.ts/get_next_disparo_batch); este campo só configura a janela. */}
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">Cooldown Entre Campanhas (horas)</span>
              <Input
                type="number"
                value={form.cooldown_horas}
                onChange={e => setForm({ ...form, cooldown_horas: parseInt(e.target.value) })}
                className="h-8"
              />
              <p className="text-[10px] text-muted-foreground">
                Contato que já recebeu uma campanha dentro dessa janela não recebe outra. Padrão: 24h. Para campanhas de marketing mais espaçadas, considere 168h (7 dias).
              </p>
            </div>
          </div>
        </Card>

        {/* Humanização IA */}
        {/* [AUDITORIA] FIX APLICADO (Sprint Variação sem IA, 2026-08-06): texto atualizado pra
            deixar o trade-off explícito — antes sugeria que "reduzir risco de bloqueio" exigia
            IA, sem mencionar que o sistema já faz variação sem custo (placeholders + spintax,
            ver StepMessage). Card continua funcional (toggle liga/desliga normalmente) — só o
            texto e o default (acima) mudaram, nenhuma mudança no comportamento de quem ligar. */}
        <Card className="p-4 space-y-3 border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-bold">Humanizar com IA</Label>
              <p className="text-[11px] text-muted-foreground">
                Reescreve cada mensagem via IA (OpenAI) para variação adicional — tem custo por envio. O sistema já varia mensagens com placeholders/spintax sem custo (Passo 2); use isto só se quiser um nível extra de variação.
              </p>
            </div>
            <Switch
              checked={form.humanizar_ia}
              onCheckedChange={v => setForm({...form, humanizar_ia: v})}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}


function StepReview({ form, targetContacts, loadingContacts, onStart }: any) {
  // [AUDITORIA] BUG (achado na Sprint Placeholders/Upload, 2026-07-30): 60/120/240 msgs/hora
  // assumiam um delay fixo (60s/30s/15s) que nunca bateu com o real. Corrigido pra uma média real
  // por perfil (80/160/360 msgs/hora), mas ainda hardcoded pros 3 perfis antigos.
  // [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): agora que o intervalo é
  // sempre customizável em minutos (`form.delay_min_minutos`/`delay_max_minutos`, preenchido pelos
  // cards de perfil OU digitado livremente — ver StepAntiBan), a estimativa usa a MÉDIA real do
  // intervalo configurado em vez de uma tabela fixa — funciona igual pra um perfil de atalho
  // (30-60s) ou um valor customizado (8-10min), sem precisar manter 2 sistemas de cálculo em
  // paralelo nem sincronizar manualmente com `disparoProcessor.ts` a cada mudança de perfil.
  const estimate = useMemo(() => {
    const total = targetContacts.length || 0;
    const mediaSegundos = ((Number(form.delay_min_minutos) || 0) + (Number(form.delay_max_minutos) || 0)) / 2 * 60;
    const msgsPerHour = mediaSegundos > 0 ? 3600 / mediaSegundos : 0;
    const totalMinutes = msgsPerHour > 0 ? Math.ceil((total / msgsPerHour) * 60) : 0;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const dias = Math.floor(h / 24);
    const endDate = new Date(Date.now() + totalMinutes * 60_000);
    const endStr = endDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return {
      label: total === 0 ? "—" : `${h}h ${m}m`,
      end: total === 0 ? "—" : endStr,
      // [AUDITORIA] LÓGICA: aviso explícito quando a campanha vai durar mais de 1 dia corrido —
      // consequência esperada de um intervalo grande (ex: 8-10min) com muitos contatos, não é bug
      // a corrigir, mas o usuário precisa decidir com essa informação visível, não descobrir depois.
      longaDuracao: dias >= 1,
      dias,
    };
  }, [targetContacts.length, form.delay_min_minutos, form.delay_max_minutos]);

  const [agendarAt, setAgendarAt] = useState("");

  // [AUDITORIA] BUG (achado real do usuário, Sprint Cooldown de Disparos, 2026-07-30): mesmo
  // contato de teste recebendo a mesma mensagem mais de uma vez, em campanhas diferentes criadas
  // em sequência — a dedupe existente (`Array.from(new Map(...))` por telefone, componente pai)
  // só evita duplicata DENTRO da mesma seleção de alvo; nada avisava sobre contatos que já tinham
  // recebido OUTRA campanha recentemente. [AUDITORIA] FIX APLICADO (2026-07-30): aviso aqui
  // (camada 1, UI), exigindo confirmação explícita (checkbox) antes de habilitar os botões.
  // [AUDITORIA] BUG (achado do usuário, Sprint Cooldown vira filtro automático, 2026-08-06): o
  // checkbox nunca teve efeito real no envio — o bloqueio de verdade sempre foi (e continua
  // sendo) o backend (`disparoProcessor.ts` + `get_next_disparo_batch()`, `migrations.ts`), que
  // pula silenciosamente qualquer contato em cooldown (`status='cooldown'` no log) INDEPENDENTE
  // de qualquer coisa marcada aqui na tela — já testado com envio real na sprint original
  // (2026-07-30). Marcar o checkbox não forçava envio pros contatos em cooldown (o backend
  // continuava pulando); só liberava os botões pros DEMAIS contatos, sem problema nenhum,
  // poderem receber a campanha. Era uma trava de UI sem efeito prático, só atrapalhando o
  // operador com uma pergunta sobre algo que ele não tem como realmente forçar.
  // [AUDITORIA] FIX APLICADO: removido o checkbox `confirmarCooldown` e `bloqueadoPorCooldown` —
  // `contatosCooldown` (cálculo mantido, ainda usado pro aviso informativo abaixo) deixa de
  // travar os botões. O backend não muda em nada (já fazia — e continua fazendo — o descarte
  // real sozinho).
  const contatosCooldown = useMemo(() => {
    const cooldownMs = (Number(form.cooldown_horas) || 0) * 60 * 60 * 1000;
    if (cooldownMs <= 0) return [];
    return targetContacts.filter((c: any) =>
      c.ultimo_disparo_em && (Date.now() - new Date(c.ultimo_disparo_em).getTime()) < cooldownMs
    );
  }, [targetContacts, form.cooldown_horas]);

  const handleStart = async (now = true) => {
    try {
      if (targetContacts.length === 0) {
        toast.error("Nenhum contato encontrado com os filtros selecionados.");
        return;
      }

      const { data: { user } } = await api.auth.getUser();


      const payload: any = {
        user_id: user?.id,
        nome: form.nome || "Disparo em Massa " + new Date().toLocaleDateString(),
        status: now ? 'em_andamento' : 'rascunho',
        perfil_velocidade: form.perfil_velocidade,
        horario_inicio: form.janela_inicio,
        horario_fim: form.janela_fim,
        instancias_ids: form.instancias_ids,
        total_leads: targetContacts.length,
        // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): `form.mensagem` fica
        // vazio para campanhas de mídia agora que o Textarea escreve em `form.legenda_midia` pra
        // esses tipos (ver `campoAtivo` em StepMessage) — usa o campo certo pra `mensagem_template`
        // não gravar em branco. Coluna é só informativa/auditoria (não lida por `disparoProcessor.ts`
        // nem por `get_next_disparo_batch`, confirmado por grep), sem impacto no envio real.
        mensagem_template: form.tipo_midia === "texto" ? form.mensagem : form.legenda_midia,
        tipo_midia: form.tipo_midia,
        url_midia: form.url_midia,
        legenda_midia: form.legenda_midia,
        agendado_para: now ? null : agendarAt,
        pausa_fins_semana: form.pausa_fins_semana,
        pausa_erros_consecutivos: form.pausa_erros_consecutivos,
        limite_erros_consecutivos: form.limite_erros_consecutivos,
        limite_diario_mensagens: form.limite_diario_mensagens,
        pausa_bloqueios_detectados: form.pausa_bloqueios_detectados,
        humanizar_ia: form.humanizar_ia,
        cooldown_horas: form.cooldown_horas,
        // [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): sempre preenchido
        // pra campanhas novas (arredondado pra segundo inteiro) — `disparoProcessor.ts` usa estes
        // 2 campos com prioridade sobre `perfil_velocidade` quando ambos vêm não-nulos. Campanhas
        // criadas ANTES deste fix (já em produção) não têm essas colunas, então continuam caindo
        // no comportamento antigo por perfil — não é preciso fazer nada especial aqui pra isso,
        // só não sobrescrever campanhas antigas (o que este INSERT, sendo sempre uma linha nova,
        // nunca faria de qualquer forma).
        delay_min_segundos: Math.round((Number(form.delay_min_minutos) || 0) * 60),
        delay_max_segundos: Math.round((Number(form.delay_max_minutos) || 0) * 60),
      };


      const { data: campaignData, error: campaignError } = await api
        .from("disparos")
        .insert(payload)
        .select()
        .single();

      if (campaignError) throw campaignError;

      // 2. Criar logs individuais (mensagens pendentes)
      // [AUDITORIA] FIX APLICADO (Sprint Placeholders/Upload, 2026-07-30): usa substituirPlaceholders
      // (topo do arquivo) em vez do `.replace()` duplo que só cobria 2 dos 5 atalhos oferecidos na
      // tela — ver comentário completo na declaração da função.
      // [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): `disparo_logs` não tem
      // coluna própria de legenda — `mensagem_enviada` é o único lugar onde a personalização POR
      // CONTATO (substituirPlaceholders) sobrevive; `disparos.legenda_midia` é compartilhado pela
      // campanha inteira (sem personalização possível). Pra campanha de mídia, a fonte tem que ser
      // `form.legenda_midia` (não `form.mensagem`, que fica vazio pra esses tipos) — sem isso,
      // `mensagem_enviada` viraria "" pra cada contato e `disparoProcessor.ts` usaria a legenda
      // crua (com `{{placeholders}}` literais) da campanha, nunca a versão personalizada. Ver fix
      // relacionado em `disparoProcessor.ts` (prioridade de `legendaFinal` invertida pro mesmo motivo).
      // [AUDITORIA] FIX APLICADO (Sprint Variação sem IA, 2026-08-06): `resolverSpintax` encadeado
      // por cima de `substituirPlaceholders` (placeholders primeiro, spintax depois — mesma ordem
      // documentada na declaração de `resolverSpintax`). Chamado dentro do `.map()`, uma vez por
      // contato — cada `Math.random()` roda de forma independente, então dois contatos com a
      // mesma mensagem-base podem sortear opções diferentes, sem precisar tocar em
      // `disparoProcessor.ts` (o backend só lê `mensagem_enviada` já pronta).
      const logs = targetContacts.map(c => ({
        disparo_id: campaignData.id,
        user_id: user?.id,
        contato_id: c.id,
        telefone: c.telefone,
        nome: c.nome,
        mensagem_enviada: resolverSpintax(substituirPlaceholders(form.tipo_midia === "texto" ? form.mensagem : form.legenda_midia, c)),
        status: 'pending'
      }));


      const { error: logsError } = await api.from("disparo_logs").insert(logs);
      if (logsError) throw logsError;
      
      toast.success(now ? "Campanha iniciada!" : "Campanha agendada!");
      if (now) onStart(campaignData);
    } catch (err: any) {
      toast.error("Erro ao iniciar campanha: " + err.message);
    }
  };

  // [AUDITORIA] FIX APLICADO (achado 2026-07-28 — auditoria de responsividade): 3 colunas fixas
  // (com um card ocupando 2 delas) espremiam tudo numa tela pequena — abaixo de `lg` agora
  // empilha em coluna única; a partir de `lg`, layout idêntico ao anterior.
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 p-6 space-y-6">
        <h3 className="text-lg font-bold">Revisão da Configuração</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Destinatários</p>
              <div className="flex items-center gap-2 mt-1">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold">{loadingContacts ? "..." : targetContacts.length} contatos</span>

              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Duplicados removidos automaticamente</p>
              {/* [AUDITORIA] FIX APLICADO (Sprint Cooldown vira filtro automático, 2026-08-06,
                  item 4): número de quem efetivamente recebe já calculado (`contatosCooldown`,
                  usado também no aviso abaixo) — mostrado aqui em cima pra ficar visível de cara,
                  sem precisar rolar até o aviso. */}
              {contatosCooldown.length > 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-1 font-medium">
                  {targetContacts.length - contatosCooldown.length} serão enviados agora — {contatosCooldown.length} pulados por cooldown
                </p>
              )}
            </div>
            
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Proteção Ativa</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  <ShieldCheck className="h-3 w-3 mr-1" /> Perfil {form.perfil_velocidade}
                </Badge>
                {form.pausa_fins_semana && <Badge variant="outline">Pausa FDS</Badge>}
                <Badge variant="outline">Janela: {form.janela_inicio} - {form.janela_fim}</Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Tempo Estimado</p>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-xl font-bold">{estimate.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Término previsto: {estimate.end}</p>
              {/* [AUDITORIA] FIX APLICADO (Sprint Intervalo em Minutos, 2026-07-31): consequência
                  esperada de um intervalo grande (ex: 8-10min) com muitos contatos — não é bug,
                  mas o usuário precisa ver isso ANTES de disparar, não descobrir horas depois. */}
              {estimate.longaDuracao && (
                <p className="text-[10px] text-amber-600 font-medium mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Campanha vai durar {estimate.dias}+ dia(s) corrido(s) com o intervalo atual
                </p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Instâncias</p>
              <div className="flex gap-2 mt-2">
                {form.instancias_ids.length} selecionadas
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border">
          <p className="text-xs font-bold mb-2">Resumo da Mensagem:</p>
          {/* [AUDITORIA] FIX APLICADO (Sprint Fix Legenda de Mídia, 2026-08-02): `form.mensagem`
              fica vazio para campanhas de mídia (Textarea escreve em `form.legenda_midia` pra
              esses tipos, ver StepMessage) — sem este fix, o resumo mostrava sempre "" pra
              qualquer campanha de imagem/áudio/documento. */}
          <p className="text-xs italic text-muted-foreground line-clamp-3">"{form.tipo_midia === "texto" ? form.mensagem : form.legenda_midia}"</p>
        </div>

        {/* [AUDITORIA] FIX APLICADO (Sprint Cooldown vira filtro automático, 2026-08-06): virou
            informativo puro — sem checkbox, sem exigir ação nenhuma. O operador continua sabendo
            que X contatos serão pulados (informação útil), mas nada aqui bloqueia o início da
            campanha; quem decide de verdade quem recebe é sempre o backend (ver comentário
            completo na declaração de `contatosCooldown` acima). */}
        {contatosCooldown.length > 0 && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-400">
                <span className="font-bold">{contatosCooldown.length} de {targetContacts.length}</span> contatos selecionados já receberam campanha nas últimas {form.cooldown_horas}h e serão pulados automaticamente — os demais recebem normalmente.
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6 flex flex-col justify-between">
        <div className="space-y-4">
          <h3 className="font-bold">Ações</h3>
          <Button className="w-full gap-2 h-12 text-lg font-bold" onClick={() => handleStart(true)}>
            <Play className="h-5 w-5 fill-current" /> Disparar Agora
          </Button>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-background px-2 text-muted-foreground">OU</span></div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Agendar para:</Label>
            <Input type="datetime-local" value={agendarAt} onChange={e => setAgendarAt(e.target.value)} />
            <Button variant="outline" className="w-full gap-2" disabled={!agendarAt} onClick={() => handleStart(false)}>
              <Calendar className="h-4 w-4" /> Agendar Disparo
            </Button>
          </div>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-6 italic">
          Ao iniciar, o sistema respeitará as regras de delay e janela de envio configuradas.
        </p>
      </Card>
    </div>
  );
}

function MonitoringDashboard({ campaign, onCancel }: { campaign: any, onCancel: () => void }) {
  const [currentCampaign, setCurrentCampaign] = useState(campaign);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchProgress = async () => {
      // 1. Atualizar dados da campanha
      const { data: campaignData } = await api
        .from("disparos")
        .select("*")
        .eq("id", campaign.id)
        .single();
      
      if (campaignData) {
        setCurrentCampaign(campaignData);
      }

      // 2. Buscar logs recentes
      const { data: logsData } = await api
        .from("disparo_logs")
        .select("*")
        .eq("disparo_id", campaign.id)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (logsData) {
        setLogs(logsData);
      }
    };

    fetchProgress();
    const timer = setInterval(fetchProgress, 3000);
    return () => clearInterval(timer);
  }, [campaign.id]);

  const stats = [
    { label: "Enviados", val: currentCampaign.enviados || 0, total: currentCampaign.total_leads || 0, icon: Send, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Entregues", val: currentCampaign.entregues || 0, total: null, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Respondidos", val: currentCampaign.respondidos || 0, total: null, icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Falhas", val: currentCampaign.falhas || 0, total: null, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const failureRate = currentCampaign.enviados > 0 ? (currentCampaign.falhas / (currentCampaign.enviados + currentCampaign.falhas)) * 100 : 0;

  const handleStatusChange = async (newStatus: string) => {
    const { error } = await api
      .from("disparos")
      .update({ status: newStatus })
      .eq("id", campaign.id);
    
    if (error) {
      toast.error("Erro ao alterar status: " + error.message);
    } else {
      toast.success(`Campanha ${newStatus === 'pausado' ? 'pausada' : 'cancelada'}!`);
      if (newStatus === 'cancelado') onCancel();
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary animate-pulse" />
            Monitoramento: {currentCampaign.nome}
          </h2>
          <Badge className={`mt-1 ${currentCampaign.status === 'em_andamento' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-yellow-500/20 text-yellow-600'}`}>
            {currentCampaign.status.toUpperCase()}
          </Badge>
        </div>
        <div className="flex gap-2">
          {currentCampaign.status === 'em_andamento' ? (
            <Button variant="outline" onClick={() => handleStatusChange('pausado')}><Pause className="w-4 h-4 mr-2" /> Pausar</Button>
          ) : (
            <Button variant="outline" onClick={() => handleStatusChange('em_andamento')}><Play className="w-4 h-4 mr-2" /> Retomar</Button>
          )}
          <Button variant="destructive" onClick={() => handleStatusChange('cancelado')}><Square className="w-4 h-4 mr-2" /> Cancelar</Button>
        </div>
      </div>

      {failureRate > 10 && (
        <Alert variant={failureRate > 25 ? "destructive" : "default"} className={`animate-bounce ${failureRate <= 25 ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
          <AlertCircle className={`h-4 w-4 ${failureRate <= 25 ? 'text-yellow-500' : ''}`} />
          <AlertTitle className={failureRate <= 25 ? 'text-yellow-600' : ''}>{failureRate > 25 ? "Pausa Automática Ativada" : "Taxa de Falha Elevada"}</AlertTitle>
          <AlertDescription className={failureRate <= 25 ? 'text-yellow-600/80' : ''}>
            {failureRate > 25 
              ? "A campanha foi pausada automaticamente devido a uma taxa de erro superior a 25%." 
              : "Detectamos que mais de 10% dos disparos estão falhando. Recomendamos revisar suas instâncias."}
          </AlertDescription>
        </Alert>
      )}

      {/* [AUDITORIA] FIX APLICADO (achado 2026-07-28 — auditoria de responsividade): 4 colunas
          fixas espremiam os cards de estatística abaixo de ~768px; grid agora recolhe pra 2
          colunas em telas pequenas/médias antes de abrir pra 4 em desktop. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="p-5 border-none shadow-sm overflow-hidden relative group">
            <div className={`absolute top-0 right-0 p-4 transition-transform group-hover:scale-110`}>
              <s.icon className={`h-12 w-12 opacity-10 ${s.color}`} />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{s.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-3xl font-black ${s.color}`}>{s.val}</span>
              {s.total !== null && <span className="text-sm text-muted-foreground font-bold">/ {s.total}</span>}
            </div>
            {s.total !== null && <Progress value={(s.val/s.total)*100} className={`h-1.5 mt-3 ${s.bg}`} />}
            {s.label === "Respondidos" && s.val > 0 && (
              <p className="text-[10px] text-purple-600 font-bold mt-2">
                Conversão: {((s.val / currentCampaign.enviados) * 100).toFixed(1)}%
              </p>
            )}
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <div className="bg-muted/30 p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-2"><TableIcon className="h-4 w-4" /> Log de Envios (Tempo Real)</h3>
          <Badge variant="outline" className="text-[10px]">Atualizando a cada 3s</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="p-3 text-left font-bold">Nome</th>
                <th className="p-3 text-left font-bold">Número</th>
                <th className="p-3 text-left font-bold">Status</th>
                <th className="p-3 text-left font-bold">Erro</th>
                <th className="p-3 text-left font-bold">Horário</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log, i) => (
                <tr key={log.id} className="hover:bg-muted/5 transition-colors">
                  <td className="p-3 font-medium">{log.nome || "Contato"}</td>
                  <td className="p-3 text-xs font-mono">{log.telefone}</td>
                  <td className="p-3">
                    {/* [AUDITORIA] FIX APLICADO (Sprint Cooldown de Disparos, 2026-07-30): sem um
                        case explícito, 'cooldown' caía no fallback 'outline'/"Pendente" — enganoso,
                        já que um log em cooldown nunca vai ser processado (não é "pendente" de
                        verdade, foi bloqueado por design). */}
                    <Badge variant={
                      log.status === 'sent' ? 'secondary' :
                      log.status === 'failed' ? 'destructive' :
                      log.status === 'cooldown' ? 'outline' :
                      log.status === 'sending' ? 'default' : 'outline'
                    } className={`text-[10px] px-2 py-0 ${log.status === 'cooldown' ? 'border-amber-500 text-amber-600' : ''}`}>
                      {log.status === 'sent' ? 'Enviado' :
                       log.status === 'failed' ? 'Falha' :
                       log.status === 'cooldown' ? 'Bloqueado (cooldown)' :
                       log.status === 'sending' ? 'Enviando...' : 'Pendente'}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-red-500 max-w-[200px] truncate" title={log.erro}>
                    {log.erro || "-"}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(log.enviado_at || log.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground italic">
                    Nenhum envio registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}


