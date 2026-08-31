#!/bin/bash
# ============================================================
#  Software PIC — sobe a aplicação inteira com um comando só
#  Uso:  ./start.sh   (ou:  bash start.sh)
#  Parar tudo depois: tecle  Ctrl + C  nesta janela.
# ============================================================
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Node foi instalado em ~/.local/node nesta máquina:
export PATH="$HOME/.local/node/bin:$PATH"

echo "============================================"
echo "  Software PIC — iniciando..."
echo "============================================"

# 1) Backend: cria o ambiente e instala dependências só na 1ª vez
if [ ! -d "$ROOT/backend_venv" ]; then
  echo "[1/4] Instalando o backend (só na primeira vez, ~1 min)..."
  python3 -m venv "$ROOT/backend_venv"
  "$ROOT/backend_venv/bin/pip" install -q --upgrade pip
  "$ROOT/backend_venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
else
  echo "[1/4] Backend já instalado."
fi

# 2) Prepara o banco de dados
echo "[2/4] Preparando o banco de dados..."
"$ROOT/backend_venv/bin/python" "$ROOT/backend/manage.py" migrate --noinput >/dev/null

# 3) Frontend: instala dependências só na 1ª vez
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "[3/4] Instalando o frontend (só na primeira vez, pode levar alguns minutos)..."
  (cd "$ROOT/frontend" && npm install --silent)
else
  echo "[3/4] Frontend já instalado."
fi

# 4) Sobe os dois servidores
echo "[4/4] Ligando os servidores..."
"$ROOT/backend_venv/bin/python" "$ROOT/backend/manage.py" runserver 0.0.0.0:8000 >/tmp/pic_backend.log 2>&1 &
BACK_PID=$!

# Ao fechar (Ctrl+C), derruba o backend junto
trap "echo; echo 'Parando a aplicação...'; kill $BACK_PID 2>/dev/null; exit 0" EXIT INT TERM

echo ""
echo "============================================"
echo "  PRONTO!  Abra no navegador:"
echo "     http://localhost:4200"
echo ""
echo "  No celular (mesma rede Wi-Fi), use o IP"
echo "  do computador, ex.: http://192.168.0.10:4200"
echo ""
echo "  Para PARAR tudo: tecle  Ctrl + C  aqui."
echo "============================================"
echo ""

# Frontend em primeiro plano + abre o navegador automaticamente
(cd "$ROOT/frontend" && ng serve --host 0.0.0.0 --open)
