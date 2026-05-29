#!/bin/bash
JS=$(ls /usr/share/nginx/html/assets/*.js | head -1)
echo "=== Verificando strings do bundle ==="

# Strings literais que NAO sao minificadas (aparecem como texto no bundle)
for TERMO in "Quadro de Tarefas" "Nova coluna" "Pesquisar" "closestCorners" "dnd-kit" "Arrastar"; do
  COUNT=$(grep -c "$TERMO" "$JS" 2>/dev/null || echo 0)
  echo "$TERMO: $COUNT ocorrencias"
done

echo ""
echo "=== Data e tamanho ==="
ls -lh $JS
