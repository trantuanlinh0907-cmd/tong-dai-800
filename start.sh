#!/bin/bash
echo "Dang cai dat va chay Tong Dai 800 Brain..."
echo ""
echo "BUOC 1: Kiem tra Node.js..."
node -v
if [ $? -ne 0 ]; then
  echo "Chua cai Node.js! Vao https://nodejs.org tai ve"
  exit 1
fi
echo ""
echo "BUOC 2: Cai thu vien..."
npm install
echo ""
echo "BUOC 3: Chay server..."
echo "Neu thay dong 'Tong Dai 800 Brain running' la thanh cong!"
echo "Giua nguyen cua so nay, mo cua so moi chay: npx ngrok http 3000"
echo ""
node server.js
