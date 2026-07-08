#!/bin/bash
# 꼬물이.io 멀티플레이 — 더블클릭으로 서버 + 공개 터널 실행
cd "$(dirname "$0")"
PORT="${PORT:-8808}"
SERVER_PID=""
cleanup(){ echo ""; echo "게임 서버를 종료합니다..."; [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; exit 0; }
trap cleanup INT TERM

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js 가 필요합니다.  https://nodejs.org 에서 설치 후 다시 실행하세요."
  read -r _; exit 1
fi

echo "🐍  꼬물이.io 멀티플레이 서버 시작 (포트 $PORT)"
node server.js "$PORT" &
SERVER_PID=$!
sleep 1

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
echo ""
echo "──────────────────────────────────────────────"
echo "  로컬(내 컴퓨터):     http://localhost:$PORT"
[ -n "$LAN_IP" ] && echo "  같은 와이파이 친구:  http://$LAN_IP:$PORT"
echo "──────────────────────────────────────────────"

if command -v cloudflared >/dev/null 2>&1; then
  echo ""
  echo "🌐  인터넷 공개 주소를 생성합니다..."
  echo "    잠시 후 아래에 나오는  https://....trycloudflare.com  주소를 친구에게 보내세요."
  echo "    (이 창을 닫거나 Ctrl+C 를 누르면 게임이 종료됩니다)"
  echo ""
  cloudflared tunnel --url "http://localhost:$PORT"
else
  echo ""
  echo "ℹ️  인터넷 공개(터널)를 쓰려면:  brew install cloudflared  후 다시 실행"
  echo "    지금은 위의 로컬/와이파이 주소로 플레이할 수 있습니다."
  echo "    (Ctrl+C 로 종료)"
  wait "$SERVER_PID"
fi
cleanup
