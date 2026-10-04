@echo off
chcp 65001 >nul
title DSS ท่าเรือ (Project 2) - http://localhost:3453
cd /d "%~dp0"

rem พอร์ตเฉพาะของกลุ่มเรา (ไม่ใช้ 3000 ที่โปรเจกต์ Node ทั่วไปใช้กัน) กันชนกับกลุ่มอื่นบนคอมส่วนกลาง
set PORT=3453

where node >nul 2>nul
if errorlevel 1 (
  echo [X] เครื่องนี้ไม่มี Node.js - ติดตั้งเวอร์ชัน 22.13 ขึ้นไปจาก https://nodejs.org
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo [X] Node.js เวอร์ชันเก่าเกินไป ต้อง 22.13 ขึ้นไป - เครื่องนี้มี:
  node -v
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [X] พอร์ต %PORT% ถูกโปรแกรมอื่นใช้อยู่ - ปิดหน้าต่างเว็บของกลุ่มก่อนหน้า แล้วดับเบิลคลิกไฟล์นี้ใหม่
  pause
  exit /b 1
)

echo กำลังเปิดเว็บ DSS ท่าเรือ ที่ http://localhost:%PORT%
echo ห้ามปิดหน้าต่างนี้ระหว่างนำเสนอ (ปิดหน้าต่าง = ปิดเว็บ)
echo.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
node server\index.js
pause
