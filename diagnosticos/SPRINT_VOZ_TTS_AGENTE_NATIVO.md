# Sprint — Resposta em Voz (TTS) no Motor Nativo de IA

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Contexto: o levantamento sobre dependência do n8n (`diagnosticos/PLANO_MIGRACAO_N8N_PARA_CRM_NATIVO.md`) concluiu que nenhum tenant depende do n8n hoje (0 linhas com `n8n_webhook_url` preenchido, workflows nunca ativados). O usuário decidiu implementar nativamente, uma de cada vez, as capacidades reais que esses workflows mostravam e o motor nativo (`agentEngine.ts`) ainda não tem. Esta é a primeira: **resposta em voz (TTS)**, a de menor complexidade.

Esta é a **primeira de 3 sprints** dessa linha (as outras duas — agendamento via Google Calendar, e ingestão automática de documentos via Google Drive — ficam para sessões seguintes, não implementar aqui).

---

## Estado atual (confirmado no levantamento anterior)

- Existe uma rota `/api/elevenlabs/tts` (`backend/src/routes/elevenlabs.ts`) já funcional e usada em algum lugar do sistema (confirmar onde ao ler o arquivo).
- `agentEngine.ts` **nunca chama essa rota** — toda resposta automática da IA sai como texto, mesmo quando faria sentido responder em áudio (ex: cliente mandou um áudio, ou pediu explicitamente "manda um áudio").
- O workflow de referência do n8n usava ElevenLabs + `Enviar audio` (Evolution API, `operation: send-audio`) como alternativa ao texto — sem lógica sofisticada de quando escolher voz, aparentemente sempre que configurado.

## TAREFA

1. Ler `backend/src/routes/elevenlabs.ts` por completo — confirmar assinatura da função de síntese de voz (texto → áudio), formato de retorno (base64? URL? buffer?), tratamento de erro, e se já tem timeout (foi corrigido na auditoria de fetch anterior, confirmar que segue com `AbortController`).
2. Ler `agentEngine.ts` — localizar a função que envia a resposta final da IA pro cliente (provavelmente `enviarResposta()` ou equivalente) e como ela hoje monta a chamada de envio de texto via Evolution (`resilientFetch`/`evolutionFetch`).
3. Definir e implementar o gatilho de quando responder em voz. Sugestão de critério simples e seguro pra começar (ajustar se encontrar algo melhor já modelado no schema): responder em áudio quando a **mensagem recebida do cliente foi um áudio** (espelha o canal — cliente manda áudio, recebe áudio) E/OU quando existir uma flag por agente/tenant (`agent_configs` ou `agentes`) tipo `resposta_voz_habilitada` (boolean) — se essa coluna não existir, criar via migration, default `false` (opt-in, não muda comportamento de ninguém sem querer).
4. Implementar: texto da resposta da IA → `elevenlabs.ts` (síntese) → salvar/obter áudio → enviar via Evolution como áudio (mesmo padrão do `send-audio` da Evolution API, ver como `whatsapp.ts`/`webhook.ts` já enviam mídia de saída — reaproveitar `garantirMidiaEstavel()` se fizer sentido pro arquivo gerado).
5. Fallback obrigatório: se a síntese de voz falhar por qualquer motivo (rate limit, erro de API, timeout), **cair pro texto normal** — nunca deixar a mensagem sem resposta por causa de uma falha no TTS.
6. Não mexer em nada do fluxo de texto existente para tenants que não tiverem a flag ativada — mudança deve ser estritamente aditiva/opt-in.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Testar via `IA_TEST_MODE` (já existe, sandbox sem envio real) antes de qualquer teste com envio de verdade. Se testar em homolog com envio real, usar só os números da whitelist de IA já configurada lá (ver `[AUDITORIA]` em `webhook.ts`). Build (`npm run build` backend) antes de considerar pronto. Não fazer deploy sem confirmação.

## AO FINALIZAR, REPORTAR

- Onde ficou o gatilho de decisão voz-vs-texto (arquivo/linha) e qual critério foi usado.
- Se precisou de migration nova (coluna `resposta_voz_habilitada` ou nome equivalente).
- Confirmação do fallback pra texto funcionando (testar um cenário forçando erro no TTS).
- Resultado do teste em `IA_TEST_MODE` e, se houver, teste real em homolog.
- Atualizar `STATUS.md` e `diagnosticos/PLANO_MIGRACAO_N8N_PARA_CRM_NATIVO.md` (marcar item "Resposta em voz" como concluído na tabela de gap).
