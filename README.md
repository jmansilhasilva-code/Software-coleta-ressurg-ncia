# Software PIC — Experimento de Ressurgência Comportamental

Aplicação web (mobile-first, responsiva) para conduzir o experimento de **ressurgência
comportamental em humanos** descrito no *Projeto PIC 2026* (UniCEUB), baseado em
Martinez-Perez et al. (2024) com punidor sonoro aversivo.

- **Frontend:** Angular 19 (toda a lógica temporal roda no cliente, por precisão).
- **Backend:** Django 4.2 + DRF.
- **Banco:** PostgreSQL no Supabase (com fallback SQLite local para desenvolvimento).

Estado atual: **protótipo jogável**. A análise estatística (taxas por fase, ressurgência
absoluta/relativa/recuperação relativa, ANOVA) e o refino visual ficam para a próxima
iteração.

> ⚠️ **Calibração de dB:** o nível de 80–90 dB **não é garantível por software** — depende
> do fone/dispositivo e exige calibração física externa. O app toca num ganho fixo
> normalizado.

> ✅ **Decisão do orientador (15/09/2026):** não existe mais custo de resposta
> universal. Tocar em qualquer botão — inclusive os de controle — não tem nenhuma
> consequência por si só. O único custo de −1 pt que resta é técnico, não
> comportamental: cobre o caso de o participante tocar em 2+ botões ao mesmo tempo
> (comum em telas touchscreen, por sobreposição/erro dos dedos). Ver seção
> "Custo de resposta" abaixo.

> ⚠️ **Opacidade dos botões:** o PDF descreve o esmaecimento para 2 botões, mas há 4
> (R1, R2, CONTROL1, CONTROL2). Implementado: último botão tocado a 100%, os
> demais a 50%.

---

## Pré-requisitos

- **Node.js** (instalado localmente em `~/.local/node` nesta máquina). Garanta o PATH:
  ```bash
  export PATH="$HOME/.local/node/bin:$PATH"
  ```
  (Adicione essa linha ao seu `~/.zshrc` para tornar permanente.)
- **Python 3.9+** (a máquina tem 3.9.6 → usamos Django 4.2 LTS).

## Backend

```bash
cd "Software PIC"
python3 -m venv backend_venv
source backend_venv/bin/activate
pip install -r backend/requirements.txt

# Configurar o banco (opcional p/ dev: sem .env usa SQLite)
cp backend/.env.example backend/.env   # preencha DATABASE_URL do Supabase

cd backend
python manage.py migrate
python manage.py runserver 0.0.0.0:8000   # 0.0.0.0 p/ acessar do celular na LAN
```

Endpoints (DRF browsable em `http://localhost:8000/api/`):

- `POST /api/sessions/` — cria sessão (grupo balanceado + contrabalanceamento) e retorna a config do cliente.
- `POST /api/sessions/{id}/events/` — upload em lote do log de eventos.
- `PATCH /api/sessions/{id}/` — atualiza status (`running` / `finished`).
- `GET /api/sessions/{id}/export/` — exporta o log em CSV.

Testes do backend:

```bash
cd backend && python manage.py test experiment
```

### Supabase

Em *Supabase → Project Settings → Database → Connection string (URI)*, copie a URI e
coloque em `backend/.env` como `DATABASE_URL`. Depois rode `migrate`. SSL é exigido
(já configurado).

## Frontend

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd "Software PIC/frontend"
npm install        # só na primeira vez
ng serve --host 0.0.0.0   # 0.0.0.0 p/ acessar do celular na LAN
```

Abra `http://localhost:4200`. Para testar no celular, use o IP da máquina na rede local
(ex.: `http://192.168.0.10:4200`) — o app chama a API automaticamente no mesmo host na
porta 8000. Para liberar CORS de outros IPs durante o teste, defina `CORS_ALLOW_ALL=True`
em `backend/.env`.

> O arquivo de áudio `WorstSound1.mp3` já está em `frontend/public/assets/` (baixado de
> github.com/nmeshe/TimedAudioExperiment, Meshes et al., 2024).

## Fluxo de uso

1. **Tela do operador:** informe o ID do participante (idade/sexo opcionais), escolha o
   grupo (ou deixe em *Automático/balanceado*) e marque **Modo dev** para fases curtas de
   30 s durante os testes.
2. **Tarefa:** toque em "Começar" (desbloqueia o áudio). Três fases de 5 min (ou 30 s em
   modo dev), sem sinalização de troca. Toque nos símbolos.
3. **Fim:** baixe o JSON da sessão (fallback) e/ou inicie nova sessão. Com backend ativo,
   os eventos são enviados ao fim de cada fase e ficam no banco.

## Grupos experimentais (diferem só na contingência de R1 na Fase 2)

| Grupo    | Contingência de R1 na Fase 2                     |
|----------|--------------------------------------------------|
| `EXT`    | Extinção pura (nenhuma consequência)             |
| `RC1000` | Custo de −1000 pts (sem som)                     |
| `SOM2`   | Som aversivo de 2 s (sem custo)                  |
| `SOM5`   | Som aversivo de 5 s (sem custo)                  |

## Custo de resposta (só existe 1 caso)

Não existe custo de resposta universal: tocar em R1, R2 ou nos botões de controle
não tem nenhuma consequência por si só (fora do reforço/punição já descritos acima).
O único custo que resta (−1 pt) é técnico, não comportamental — cobre o toque
simultâneo em 2+ botões diferentes (comum em telas touchscreen, por sobreposição/erro
dos dedos): a resposta é registrada, mas não conta para reforço/punição, só desconta
1 ponto. Detectado no cliente rastreando `pointerId`s simultâneos (ver
`hasOtherButtonPressed()` em `frontend/src/app/experiment/experiment.component.ts`);
valor em `MULTI_TOUCH_COST_POINTS`, `backend/experiment/protocol.py`.

## Changeover delay (COD)

Orientação do orientador: trocar de botão bloqueia o reforço no novo botão por
**2 segundos** (mesmo valor da média do VI da tarefa), para não reforçar a própria
alternância entre respostas. Aplica-se de forma geral entre quaisquer botões (R1, R2,
Controle), não só entre R1 e R2. Precedente na literatura: Sweeney & Shahan (2015)
usaram 3 s com o mesmo propósito num procedimento de ressurgência. Parâmetro
`CHANGEOVER_DELAY_MS` em `backend/experiment/protocol.py`.

## Interface adaptada do estudo original (Martinez-Perez et al., 2024)

Comparamos a interface com o apêndice do artigo original e adaptamos dois pontos:

- **Botões confinados a 4 quadrados (workspaces)**: cada botão se move 20px/0,2s em
  4 direções (igual ao artigo original), mas dentro do seu próprio quadrado fixo, numa
  grade 2x2 — nunca invade o espaço dos outros 3. Isso é fiel ao artigo original, que usa
  o mesmo mecanismo de movimento confinado a "workspaces" (só que com 2 botões; aqui
  são 4). Implementado em `computeZones()`/`moveButtons()` em
  `frontend/src/app/experiment/experiment.component.ts`.
- **Feedback ancorado no botão**: "Você acertou +100" aparece acima do botão que foi
  reforçado, e o custo ("−N") aparece abaixo do botão respondido — em vez de um banner
  genérico no topo da tela — imitando a Figura do Apêndice A do artigo original.

Não implementado (fora do escopo pedido): os 4 símbolos de baralho do artigo original,
o fundo de praia, e a pesquisa pós-sessão (estratégia, nível de estresse, daltonismo).

## Dados por fase e por bin (regra fixa deste projeto)

Além do log bruto de eventos, o backend recalcula automaticamente — a cada upload de
eventos de uma fase — três tabelas sempre desagregadas por fase:

- **PhaseStat**: pontuação da fase (início/fim/delta).
- **ButtonPhaseStat**: respostas/min e reforços/min por botão, por fase.
- **PhaseBin**: contagem de respostas por botão em blocos de 10s (30 bins numa fase de
  5 min) — unidade padrão de análise em pesquisas de ressurgência.

Cálculo em `backend/experiment/analytics.py`, exportável em CSV pelo admin (3 links por
sessão: Eventos / Por fase / Bins 10s) ou pelos endpoints
`GET /api/sessions/{id}/export-phase-stats/` e `.../export-bins/`.

## Planilha Excel por participante (regra fixa deste projeto)

Além dos CSVs por sessão, cada **participante** tem uma planilha Excel (.xlsx) própria,
para abrir direto no Excel — os dados nunca ficam soltos num único arquivo, sempre com
uma aba por tipo de dado (e sempre desagregados por fase/bin dentro de cada aba):

- **Resumo**: dados do participante (idade, sexo, data) e lista de suas sessões.
- **Eventos**: log bruto de respostas/reforços/custos/sons.
- **Por Fase**: pontuação, respostas/min e reforços/min por botão, por fase.
- **Bins 10s**: contagem de respostas por botão em blocos de 10s.

Cálculo em `backend/experiment/exports.py`. No admin (tela **Participants**), cada linha
tem um link "Baixar .xlsx"; selecionando vários e escolhendo a ação "Exportar
selecionados" baixa um `.zip` com um Excel por participante (nomeado com o ID
interno para não haver conflito caso dois participantes tenham o mesmo identificador
digitado pelo operador). Também disponível pelo endpoint
`GET /api/participants/{id}/export-xlsx/`, e um atalho na tela de Sessions.

## Estrutura

```
Software PIC/
  backend/        # Django + DRF (models, protocol, views, serializers)
  frontend/       # Angular (core/ operator/ experiment/)
  backend_venv/   # virtualenv (gitignored)
```
