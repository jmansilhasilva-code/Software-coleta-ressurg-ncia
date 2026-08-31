#!/bin/bash
# Wrapper para o preview/launch: injeta o PATH do Node (instalado em ~/.local/node)
# e sobe o dev server do Angular na porta 4200.
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")"
exec ng serve --host 127.0.0.1 --port 4200
