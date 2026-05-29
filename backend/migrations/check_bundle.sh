#!/bin/bash
JS=$(ls /usr/share/nginx/html/assets/*.js | head -1)
echo "Bundle: $JS"
echo "Tamanho: $(wc -c < $JS) bytes"

# Verificar se tem o dnd-kit (DnD Kanban)
if grep -q "SortableContext" "$JS"; then
  echo "DND-KIT: OK (SortableContext encontrado)"
else
  echo "DND-KIT: NAO ENCONTRADO — build antigo!"
fi

# Verificar se tem o processarComDebounce (motor IA)
# (nao estara no frontend, serve so para confirmar que eh build novo)
if grep -q "KanbanColuna" "$JS"; then
  echo "KANBAN: OK (KanbanColuna encontrado)"
else
  echo "KANBAN: NAO ENCONTRADO"
fi

echo ""
echo "Data do build: $(stat -c %y $JS)"
