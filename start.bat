@echo off
echo Dang cai dat va chay Tong Dai 800 Brain...
echo.
echo BUOC 1: Kiem tra Node.js...
node -v
if %errorlevel% neq 0 (
  echo Chua cai Node.js! Vao https://nodejs.org tai ve cai dat roi chay lai.
  pause
  exit /b
)
echo.
echo BUOC 2: Cai thu vien...
call npm install
echo.
echo BUOC 3: Chay server...
echo Neu thay dong "Tong Dai 800 Brain running" la thanh cong!
echo Giua nguyen cua so nay, mo cua so moi chay ngrok de lay link https
echo.
node server.js
pause
