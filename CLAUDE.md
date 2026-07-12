# game-heaven 작업 규칙

## 던전 서바이버즈 릴리스 프로세스 (필수)

`dungeon-survivors/`를 변경하는 모든 커밋은 아래 3가지를 함께 포함해야 한다.
`.githooks/pre-commit`이 강제하며, 클론 직후 `git config core.hooksPath .githooks`로 활성화한다.

1. **CHANGELOG.md** — 최상단에 `## vX.Y.Z — 날짜 (sw ds-vN)` 섹션 추가 (유저 관점 문구)
2. **게임 내 패치노트** — `index.html`의 `GAME_VER`를 CHANGELOG 최신 버전과 일치시키고
   `PATCH_NOTES` 배열 맨 앞에 같은 버전 항목 추가 (타이틀 패치노트 화면 + 미확인 배지에 노출)
3. **sw.js 캐시 버전 범프** — `ds-vN` +1 (PWA 유저가 새 버전을 받도록)

버전 규칙: 콘텐츠 추가 = minor(+0.1.0), 버그·밸런스만 = patch(+0.0.1).

## 개발 참고

- 단일 HTML 파일(`dungeon-survivors/index.html`) · 데이터 주도 테이블
  (CHARS/WEAPONS/EVOS/PASSIVES/ENEMIES/BOSSES/STAGES/SHOP/ACHS/CONTRACTS/PATCH_NOTES)
- 게임플레이 난수는 반드시 `RNG()`(rand/randi/pick) 경유 — 데일리 시드런 결정론.
  렌더·BGM 등 프레임 의존 경로는 `Math.random` 직접 사용
- 스탯 계산은 `recomputeStats()` 단일 소스 — makePlayer에 수치 중복 금지
- 치명 피해는 최소 0.6s 텔레그래프(spawnZone/예고선) — "내 잘못이 아닌 죽음" 금지
- 충돌 핫패스는 `Grid.query()` 사용, 시체(hp<=0) 스킵
- 밸런스 튜닝: 브라우저 콘솔 `dumpDPS()` (Lv1 목표 밴드 10~14)
- 검증: 브라우저 팬이 가려지면 rAF 정지 → update 함수 수동 호출 시뮬레이션으로 테스트
  (`Grid.build()` 선행 필수). 배포는 push → GitHub Pages 자동
