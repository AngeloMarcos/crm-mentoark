# Prompt para o Lovable — Endpoint pra receber corridas vindas do CRM (WhatsApp)

Cole isto no Lovable, no projeto do sistema de gestão de corridas do cliente. Ajuste nomes de tabela/campo pro que já existir no projeto — o importante é o contrato do endpoint (rota, autenticação, formato do corpo da requisição e da resposta).

---

## Contexto

Este sistema vai passar a receber pedidos de corrida vindos de um CRM externo (Mentoark), que atende clientes pelo WhatsApp com um agente de IA. Quando alguém pede uma corrida pelo WhatsApp, o CRM extrai os dados e manda pra este sistema via uma chamada HTTP. Preciso de um endpoint novo que receba isso e crie a corrida no sistema, do mesmo jeito que uma corrida importada por planilha ou cadastrada manualmente.

## O que implementar

### 1. Endpoint novo: `POST /api/integracoes/corridas` (ajustar o caminho pro padrão de rotas já usado no projeto, se houver um)

**Autenticação:** um token fixo enviado no header `Authorization: Bearer {TOKEN}`, comparado contra uma variável de ambiente/segredo configurado no projeto (ex: `CRM_INTEGRATION_TOKEN`). Requisição sem o token certo deve responder `401`, sem processar nada.

**Corpo da requisição (JSON) esperado:**
```json
{
  "origem_sistema": "mentoark_crm",
  "id_externo": "uuid-gerado-pelo-crm",
  "passageiro": { "nome": "string", "telefone": "string (formato E.164 quando possível, ex: 5511999998888)" },
  "origem": "string (endereço/local de partida)",
  "destino": "string (endereço/local de destino)",
  "horario_solicitado": "string em texto livre por enquanto (ex: 'amanhã 8h', 'agora') — ainda não vem como data estruturada",
  "observacoes": "string ou null",
  "criado_em": "string ISO 8601 (data/hora que o pedido foi feito no CRM)"
}
```

**Validações mínimas:**
- Campos obrigatórios: `id_externo`, `passageiro.telefone`, `origem`, `destino`. Se algum faltar, responder `400` com uma mensagem clara de qual campo faltou.
- `id_externo` é a chave de idempotência: se já existir uma corrida com esse `id_externo` cadastrada, **não duplicar** — responder `200` com os dados da corrida já existente (o CRM pode reenviar a mesma requisição em caso de timeout/retry, e isso não pode virar corrida duplicada no sistema).

**O que fazer com o dado:**
- Criar a corrida na tabela/entidade já usada pelo sistema (a mesma que recebe as corridas importadas por planilha), marcando de alguma forma a origem como "WhatsApp/CRM" (campo de origem/canal, se já existir esse conceito no sistema; se não existir, pode ser um campo novo simples).
- `horario_solicitado` sendo texto livre: se o sistema espera uma data/hora estruturada pra agendar a corrida, tratar esse campo como "a preencher depois"/rascunho, e sinalizar visualmente que precisa de confirmação humana do horário exato — não tentar adivinhar/parsear a data automaticamente por enquanto.

**Resposta esperada em caso de sucesso (`200`/`201`):**
```json
{
  "ok": true,
  "id_corrida": "id da corrida criada neste sistema",
  "status": "string (o status inicial que a corrida recebe aqui, ex: 'aguardando_confirmacao')"
}
```
Esse `id_corrida` é importante — o CRM vai guardar isso pra rastrear a corrida do lado dele também.

**Resposta em caso de erro:** `400`/`401`/`500` com `{ "ok": false, "erro": "mensagem clara" }` — o CRM vai logar essa mensagem, então quanto mais específica, melhor pra debugar depois (ex: "telefone em formato inválido" é mais útil que só "erro").

### 2. Onde essas corridas aparecem no sistema

Confirmar que uma corrida criada por este endpoint aparece na mesma tela/lista onde já aparecem as corridas importadas por planilha — não é pra ser um fluxo paralelo escondido. Se fizer sentido, um indicador visual de "veio do WhatsApp" ajuda o time do cliente a saber a origem.

### 3. Segurança

- Responder rápido (idealmente abaixo de 5s) — o CRM tem timeout configurado do lado dele e vai considerar falha se demorar demais.
- Não expor esse endpoint sem o header de autenticação funcionando de verdade — validar isso com um teste manual (chamada sem token deve dar 401, com token errado também).

## Ao finalizar

Me diga: (1) a URL final do endpoint (para eu configurar do lado do CRM), (2) o token de autenticação gerado (vou guardar de forma segura na configuração da integração), (3) se o formato de resposta ficou exatamente como proposto ou se você ajustou algo — preciso saber pra alinhar do lado do CRM.
