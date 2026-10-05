# Compose de homologação (referência)

Cópia dos `docker-compose.yml` que rodam em `/opt/crm-homolog` na VPS (147.93.9.172).
Não são usados por nenhum script — servem só para versionar como homologação difere de
produção (nomes de serviço `crm-homolog`/`crm-api-homolog`, banco `crm_hml`, domínios
`homolog`/`api-homolog`). Os de produção são os da raiz (`docker-compose.yml`) e
`backend/docker-compose.yml`. Segredos ficam no `.env` de cada diretório na VPS, nunca aqui.
