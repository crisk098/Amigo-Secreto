@echo off
chcp 65001 > nul
echo ===================================================
echo 🚀 Enviando projeto Amigo Secreto para o GitHub...
echo ===================================================
git add .
git commit -m "Atualizacoes do Amigo Secreto"
git push -u origin main
echo.
echo ===================================================
echo ✅ Concluido! Verifique seu repositorio no GitHub:
echo https://github.com/Gathin23/Amigo-Secreto
echo ===================================================
pause
