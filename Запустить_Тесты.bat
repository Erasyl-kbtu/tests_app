@echo off
chcp 65001 >nul
title Тесты Алтын Каппасовны — Сервер

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] На этом компьютере не установлен Node.js!
    echo Скачайте и установите Node.js (версию 22 или 24 LTS) с сайта https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Устанавливаю зависимости сервера...
    call npm install --omit=dev
    if %errorlevel% neq 0 (
        echo [ОШИБКА] Не удалось установить зависимости. Проверьте интернет.
        pause
        exit /b 1
    )
)

echo Запускаю сайт «Тесты Алтын Каппасовны»...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000/teacher"
node server/index.js
pause
