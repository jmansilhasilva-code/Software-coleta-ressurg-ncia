#!/bin/bash
# Dê dois cliques para abrir a tela de administrador no navegador.
# (O sistema precisa estar ligado — ou seja, o "Iniciar PIC" aberto.)
if curl -s -o /dev/null http://localhost:8000/admin/login/; then
  open "http://localhost:8000/admin/"
  echo "Abrindo a tela de administrador no navegador..."
  echo "Esta janela pode ser fechada."
else
  echo "============================================================"
  echo "  O sistema ainda não está ligado."
  echo "  Dê dois cliques primeiro em 'Iniciar PIC' e espere abrir,"
  echo "  depois clique de novo neste atalho."
  echo "============================================================"
fi
