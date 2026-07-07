# Prompt 4 — Separar em páginas: Home (serviços) e Portfólio (sites)

> Continuação dos prompts 1, 2 e 3, no MESMO projeto Lovable. Cole na mesma conversa.

---

## Cole no Lovable a partir daqui

Hoje está tudo numa página só, empilhado. Quero separar em duas rotas de verdade:

- **`/` (Home):** página institucional da Mentoark, mostrando os serviços que a gente oferece (BM Facebook, Tráfego Pago, Disparo em Massa, IA + Secretária Virtual, Design Gráfico). É a página principal, quem entra no domínio cai aqui.
- **`/portfolio`:** página separada, só com os 5 sites de nicho (Advocacia, Médico, Corretor, Dentista, Estética), um atrás do outro, sem a seção de Serviços.

Use `react-router-dom` (ou o roteador que já estiver no projeto) pra isso — não é mais scroll único, agora é navegação de página de verdade.

### Home (`/`)

Mantém, nesta ordem:
1. Header/hero escuro com o efeito aurora (o que já existe).
2. Seção "Serviços" com o bento grid assimétrico e os 5 cards de mini-case (BM Facebook, Tráfego Pago, Disparo em Massa, IA + Secretária Virtual, Design Gráfico) — exatamente como definido no prompt 3, com os `id`s de cada card mantidos.
3. Seção "Contato" no final.

As 5 sections de nicho (Advocacia, Médico, Corretor, Dentista, Estética) **saem da Home** e vão só pra `/portfolio`.

### Portfólio (`/portfolio`)

Só as 5 sections de nicho, na mesma ordem e com as mesmas regras de identidade visual própria por section (sem gradiente Mentoark dentro delas, sem clichê — regras dos prompts 1 e 2 continuam valendo). No topo da página, antes da primeira section, um cabeçalho curto e enxuto (não repete o header pesado da Home): título "Portfólio de Sites" + uma linha de contexto tipo "5 nichos, 5 identidades diferentes — veja como cada site fica quando é feito sob medida". Nada de hero gigante aqui, é só uma transição rápida pro conteúdo.

### Menu (ajustar o comportamento)

O menu fixo continua aparecendo nas duas páginas, mas agora precisa lidar com dois tipos de link:

- **"Portfólio"** vira um link de rota de verdade (`<Link to="/portfolio">`), não mais scroll anchor.
- Os 5 itens de serviço (**BM Facebook**, **Tráfego Pago**, **Disparo em Massa**, **IA + Secretária Virtual**, **Design Gráfico**) continuam sendo anchors — mas eles só existem na Home. Se o usuário estiver em `/portfolio` e clicar em um desses itens, o menu precisa: navegar de volta pra `/`, esperar a página montar, e então rolar suavemente até a seção certa (guarde a âncora pretendida, por exemplo via `navigate("/", { state: { scrollTo: "servico-trafego" } })` e um `useEffect` na Home que lê esse state assim que monta e faz o `scrollIntoView`).
- **"Contato"** segue a mesma lógica dos itens de serviço (só existe na Home).
- O indicador de item ativo do menu (aquele que desliza) deve: destacar "Portfólio" como ativo quando a rota for `/portfolio`, e continuar fazendo scroll-spy normal (via IntersectionObserver) quando estiver na Home.
- Logo "Mentoark" no menu sempre leva pra `/`.

### Regra de continuidade

Tudo que já foi definido nos prompts 1, 2 e 3 continua valendo: paleta própria de cada nicho no Portfólio, sem gradiente Mentoark dentro das 5 sections, bento grid assimétrico nos serviços, CTA de WhatsApp específico por card, nada de blocos clichê.

---

## Checklist antes de fechar

- `/` mostra só header + Serviços + Contato, sem as 5 sections de nicho?
- `/portfolio` mostra só as 5 sections de nicho, com um cabeçalho curto no topo, sem repetir o hero pesado?
- Clicar em "Portfólio" no menu navega de página, não faz scroll?
- Clicar num item de serviço estando em `/portfolio` volta pra Home e rola até a seção certa, sem esse comportamento nunca resultar em página em branco ou erro de rota?
- O indicador de item ativo do menu funciona corretamente nas duas páginas?

---

## Fim do prompt 4
