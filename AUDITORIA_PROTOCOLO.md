# Protocolo de Auditoria de Código — CRM Mentoark

Este é o protocolo-base para varreduras de código módulo por módulo (WhatsApp, Kanban, Catálogo, etc.). Cada módulo tem seu próprio prompt de "kickoff" que referencia este protocolo. Não faça uma varredura de "todos os arquivos do sistema" de uma vez — módulo por módulo, como já combinado.

## Regra de ouro

Nunca faça deploy (scp + docker compose) como parte de uma auditoria. Auditoria só lê, comenta e corrige **localmente**. Deploy é um passo separado, decidido pelo usuário depois de revisar o diff.

## Convenção de comentário (grepável)

Use sempre estas tags, para que qualquer sprint futuro consiga encontrar o que falta só com `grep`:

```ts
// [AUDITORIA] LÓGICA: explica em 1-3 linhas o que este trecho faz e por quê.
// [AUDITORIA] BUG: descreve o problema encontrado, por que é um bug, e o impacto real (ex: "mensagens de grupo não são filtradas aqui, então X quebra").
// [AUDITORIA] FIX APLICADO: descreve a mudança feita e por que é segura.
// [AUDITORIA] FIX PENDENTE (motivo: <motivo>): descreve o bug e por que não foi corrigido agora (risco alto, precisa de decisão do usuário, precisa de acesso à VPS, precisa de teste manual, etc.) — deixe claro o que a próxima sessão precisa fazer.
```

Regra: **nunca deixe um `BUG:` sem um `FIX APLICADO:` ou `FIX PENDENTE:` correspondente logo abaixo.** Todo bug encontrado tem que terminar em uma dessas duas conclusões.

## Critério para corrigir na hora vs. deixar pendente

**Pode corrigir direto** quando TODAS forem verdade:
- A mudança é pequena e isolada (não mexe em múltiplos arquivos de uma vez).
- Você tem certeza alta (>90%) de que não quebra nada que já funciona.
- É reversível com um `git diff`/`git checkout` simples.
- Não envolve escrita em produção (banco, .env da VPS, config de serviço externo) — essas SEMPRE ficam como `FIX PENDENTE`, mesmo que a correção pareça óbvia, porque exigem confirmação do usuário antes de tocar em produção.

**Deixe como `FIX PENDENTE`** quando:
- A correção depende de uma decisão de produto/negócio (ex: qual das duas instâncias deve ficar ativa).
- Envolve migração de banco, variável de ambiente de produção, ou serviço externo (Evolution, OpenAI, N8N).
- Você não tem certeza do comportamento esperado sem perguntar ao usuário.
- É um arquivo morto/duplicado (ex: dois arquivos com a mesma responsabilidade) — comente qual está em uso e qual parece morto, mas não delete sem confirmação.

## Processo por arquivo

1. Ler o arquivo inteiro antes de comentar qualquer linha.
2. Adicionar um bloco de cabeçalho (se não existir) resumindo o papel do arquivo no sistema em 3-5 linhas.
3. Percorrer a lógica de cima a baixo, comentando trechos não óbvios com `[AUDITORIA] LÓGICA:`.
4. Sempre que achar algo suspeito, parar e confirmar lendo os arquivos relacionados (quem chama esta função, quem consome esta rota) antes de marcar como `BUG:` — evita falso positivo.
5. Aplicar o fix ou marcar `FIX PENDENTE` conforme o critério acima.
6. Rodar `npm run build` (frontend) ou `npm run build` (backend, gera `dist/`) no arquivo/módulo tocado antes de passar pro próximo — garante que o TypeScript ainda compila.
7. `git add` + `git commit` com mensagem `audit(<módulo>): <arquivo> — <resumo>` a cada arquivo ou pequeno grupo de arquivos relacionados. Isso cria histórico revisável e reversível.
8. Atualizar `AUDITORIA_LOG.md` (tabela abaixo) com o resultado do arquivo.

## AUDITORIA_LOG.md — formato

Manter um único arquivo `AUDITORIA_LOG.md` na raiz do projeto, atualizado a cada arquivo revisado:

```md
| Módulo   | Arquivo                              | Status                  | Resumo                                      |
|----------|---------------------------------------|--------------------------|----------------------------------------------|
| WhatsApp | backend/src/routes/webhook.ts         | ✅ revisado, sem bug novo | Lookup de userId e UPSERT de contato ok      |
| WhatsApp | backend/src/services/whatsapp.ts      | ⚠️ pendente              | Arquivo morto (não importado) — ver Fix Pend.|
```

Status possíveis: `✅ revisado sem bug` · `🔧 corrigido` · `⚠️ pendente (precisa decisão)` · `🗑️ candidato a remoção`.

## Ao final de cada módulo

Reportar: quantos arquivos revisados, quantos bugs corrigidos, quantos pendentes (com motivo de cada um), e sugestão do próximo módulo a auditar.
