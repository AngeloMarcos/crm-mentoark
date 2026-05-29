@echo off
echo.
echo ============================================
echo   DEPLOY CRM MENTOARK — Commit + Push + VPS
echo ============================================
echo.

cd /d "C:\Users\angel\Desktop\claudio\cris\crm-mentoark"

echo [1/3] Verificando node...
node --version
if errorlevel 1 (
    echo ERRO: Node.js nao encontrado!
    pause
    exit /b 1
)

echo.
echo [2/3] Instalando dependencia ssh2 se necessario...
npm list ssh2 --prefix . >nul 2>&1 || npm install ssh2 --save-dev >nul 2>&1

echo.
echo [3/3] Executando deploy...
node deploy.mjs

echo.
if errorlevel 1 (
    echo ============================================
    echo   ERRO no deploy! Verifique os logs acima.
    echo ============================================
) else (
    echo ============================================
    echo   Deploy concluido com sucesso!
    echo   Aguarde 30 segundos e acesse:
    echo   https://crm.mentoark.com.br
    echo ============================================
)

pause
