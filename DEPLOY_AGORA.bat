@echo off
cd /d "C:\Users\angel\Desktop\claudio\crm-mentoark"
echo.
echo ========================================
echo   MentoArk CRM - Deploy
echo ========================================
echo.

:: Instalar ssh2 se necessario
echo [1/3] Verificando dependencias...
call npm install ssh2 --save-dev 2>nul
echo.

:: Executar o script de deploy
echo [2/3] Executando deploy...
node deploy.mjs

echo.
echo [3/3] Concluido!
echo.
pause
