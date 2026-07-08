# 🕹️ 게임천국 (Game Heaven)

브라우저 미니 게임 아케이드. 허브에서 게임을 골라 바로 플레이합니다.

**▶ Play: https://2222min.github.io/game-heaven/**

| 경로 | 게임 | 설명 |
|---|---|---|
| `/` | 🕹️ 게임천국 | 게임 선택 허브 (멀티 서버 상태·접속자 실시간 표시) |
| `/kkomuri/` | 🐍 꼬물이.io | 실시간 멀티플레이 스네이크 아레나 — 게임 서버 필요 (아래 참고) |
| `/solo/` | 🤖 꼬물이.io 싱글 | AI 뱀 26마리와 겨루는 오프라인 버전 |
| `/pirate/` | 🏴‍☠️ 해적왕 랜덤 디펜스 | 랜덤 소환·합성·승급 디펜스 ([원본 레포](https://github.com/2222min/pirate-random-defense)) |

모든 게임은 외부 의존성 0의 단일 HTML 파일이며, 그래픽·사운드는 코드로 생성한 자체 제작 에셋입니다.

## 구조

```
index.html          ← 게임천국 허브 (GitHub Pages 루트)
config.js           ← 멀티플레이 서버 주소 설정 (Pages에서만 사용)
kkomuri/index.html  ← 꼬물이.io 멀티플레이 클라이언트
solo/index.html     ← 꼬물이.io 싱글
pirate/index.html   ← 해적왕 랜덤 디펜스
server.js           ← 꼬물이.io 멀티플레이 게임 서버 (Node, 의존성 0)
start.command       ← 맥에서 더블클릭: 서버 + 공개 터널 실행
```

## 멀티플레이 서버 (꼬물이.io)

GitHub Pages는 정적 호스팅이라 게임 서버는 별도로 실행해야 합니다.

**방법 A — 내 맥에서 (임시 공개)**
1. `start.command` 더블클릭 → 서버 실행 + `https://xxxx.trycloudflare.com` 공개 주소 생성
2. 그 주소를 `config.js`의 `ARCADE_SERVER`에 넣고 커밋/푸시
3. Pages 허브의 꼬물이 카드가 그 서버로 연결됩니다 (터널 주소는 재실행 시마다 바뀜)

**방법 B — 클라우드 상시 배포 (24시간)**
Render / Railway / Fly.io 등에 이 레포를 연결하고 시작 명령을 `node server.js`로 지정
(포트는 `PORT` 환경변수 자동 사용). 발급된 주소를 `config.js`에 한 번만 넣으면 끝.

서버가 꺼져 있으면 허브에 "멀티 서버 오프라인"으로 표시되고, 나머지 게임은 항상 동작합니다.
`start.command`로 직접 서빙할 때는 config와 무관하게 전 게임 + 멀티가 같은 주소에서 동작합니다.

## 새 게임 추가

1. `새게임폴더/index.html` 로 게임을 넣는다
2. `index.html`(허브)의 `GAMES` 배열에 한 줄 추가한다
3. 커밋 & 푸시 — 끝

## 해적왕 랜덤 디펜스 업데이트 반영

`pirate/`는 [원본 레포](https://github.com/2222min/pirate-random-defense)의 복사본입니다.
GitHub Action이 **30분마다 자동 동기화**하며, 급하면 두 가지 방법으로 즉시 반영할 수 있습니다:

- GitHub → Actions → "해적왕 랜덤 디펜스 자동 동기화" → **Run workflow**
- 또는 로컬에서:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/2222min/pirate-random-defense/main/index.html -o pirate/index.html
  git commit -am "sync pirate" && git push
  ```

## 조작 (꼬물이.io)

- **PC**: 마우스 또는 방향키/WASD 조종 · 클릭/`Space` 꾹 = 부스터
- **모바일**: 화면 터치 → 가상 조이스틱 드래그 · ⚡ 버튼 = 부스터
- 머리가 다른 뱀 몸통에 닿으면 사망 · 죽은 뱀은 빛나는 먹이가 됨
