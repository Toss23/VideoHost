@echo off
chcp 65001 >nul
title Совместный просмотр VK Video

echo ==================================================
echo   Локальный сервер для совместного просмотра VK
echo ==================================================
echo.

REM --- Проверяем, что файлы на месте ---
if not exist "index.html" (
    echo [ОШИБКА] index.html не найден в текущей папке.
    echo Положите start.bat рядом с файлами сайта.
    pause
    exit /b 1
)

REM --- Вариант 1: Python ---
where python >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Найден Python. Запускаю сервер на http://localhost:8000
    echo.
    echo Чтобы остановить сервер - нажмите Ctrl+C
    echo.
    start "" "http://localhost:8000"
    python -m http.server 8000
    goto :eof
)

REM --- Вариант 2: Node.js ---
where node >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Найден Node.js. Запускаю сервер на http://localhost:8000
    echo.
    echo Чтобы остановить сервер - нажмите Ctrl+C
    echo.
    start "" "http://localhost:8000"
    npx --yes http-server -p 8000 -c-1
    goto :eof
)

REM --- Ничего не найдено ---
echo [ОШИБКА] Не найден ни Python, ни Node.js.
echo.
echo Установите одно из:
echo   - Python:  https://www.python.org/downloads/  (галочка "Add Python to PATH")
echo   - Node.js: https://nodejs.org/
echo.
pause
exit /b 1