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

> ⚠️ **Ambiguidade do protocolo (confirmar com o orientador):** o PDF diz que o custo de
> resposta universal (−1) vale "em todas as fases", mas descreve a Fase 3 como extinção
> total. O padrão experimental de um teste de ressurgência é Fase 3 em **extinção pura**.
> Implementado assim; alternável na constante `UNIVERSAL_COST_IN_PHASE3` em
> `frontend/src/app/experiment/experiment.component.ts`.

> ⚠️ **Opacidade dos botões:** o PDF descreve o esmaecimento para 2 botões, mas há 3.
> Implementado: último botão tocado a 100%, os demais a 50%.

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
| `EXT`    | Extinção simples (só custo universal −1)         |
| `RC1000` | Custo de −1000 pts (sem som)                     |
| `SOM2`   | Custo −1 + som aversivo de 2 s                   |
| `SOM5`   | Custo −1 + som aversivo de 5 s                   |

## Estrutura

```
Software PIC/
  backend/        # Django + DRF (models, protocol, views, serializers)
  frontend/       # Angular (core/ operator/ experiment/)
  backend_venv/   # virtualenv (gitignored)
```
