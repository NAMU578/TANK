# 탱크 클래시 3D (Tank Clash 3D)

친구와 실시간으로 즐기는 **3D 온라인 탱크 대전 게임**입니다.
별도 서버 없이 **방 코드만 공유하면** 브라우저에서 바로 붙을 수 있습니다.

- ⚔️ **대전 모드** — 1:1 · 3판 2선승
- 🤝 **협동 모드** — 둘이 힘을 합쳐 적 웨이브 방어 (목숨 공유)
- 🗺️ **3개 맵** — 벙커 · 십자로 · 투기장
- 💎 **파워업** — 회복 / 실드 / 연사
- 🎨 **고품질 3D** — PBR 텍스처, IBL 환경광, 블룸 후처리, 실시간 그림자

---

## 🎮 조작법

| 동작 | 키 |
|------|----|
| 이동 | `W` `A` `S` `D` |
| 조준 | 마우스 이동 |
| 발포 | 마우스 좌클릭 |
| 부스트 | `Shift` (연료 소모) |

---

## 🚀 플레이 방법

1. 배포된 주소(예: `https://<사용자명>.github.io/tank-clash/`)에 접속
2. **친구와 플레이** → 모드 · 맵 선택
3. 한 명이 **방 만들기** → 나온 4자리 코드를 친구에게 전달
4. 친구가 **참가하기** → 코드 입력 → 자동으로 시작
5. 상대가 없어도 **혼자 연습하기 (AI 대전)**로 바로 플레이 가능

> 연결은 WebRTC(P2P)로 이루어집니다. 시그널링은 PeerJS 공개 서버를 사용하며, 게임 데이터는 두 브라우저 간에 직접 오갑니다.

---

## 🌐 GitHub Pages 배포 방법

### 방법 A. 자동 스크립트 (가장 쉬움)

터미널에서 이 폴더로 이동한 뒤:

```bash
# 1) GitHub CLI 로그인 (최초 1회)
gh auth login

# 2) 배포 스크립트 실행
bash deploy.sh
```

스크립트가 저장소 생성 → 파일 업로드 → GitHub Pages 활성화까지 모두 처리하고,
완료되면 접속 URL을 출력합니다.

---

### 방법 B. 수동 배포 (웹 UI만 사용)

1. GitHub에서 새 저장소 생성 (예: `tank-clash`), **Public**으로 설정
2. 이 폴더의 **모든 파일**을 저장소에 업로드
   (`index.html`, `js/`, `assets/`, `.nojekyll` 포함 — `.nojekyll` 반드시 포함!)
3. 저장소 → **Settings → Pages**
4. **Source**를 `Deploy from a branch`로 설정
5. **Branch**를 `main` / `/(root)`로 지정 후 **Save**
6. 1~2분 뒤 `https://<사용자명>.github.io/tank-clash/` 로 접속

---

### 방법 C. 수동 배포 (git 명령어)

```bash
cd tank-clash
git init
git add .
git commit -m "탱크 클래시 3D 배포"
git branch -M main
git remote add origin https://github.com/<사용자명>/tank-clash.git
git push -u origin main
```

이후 저장소 **Settings → Pages**에서 방법 B의 3~6단계를 진행하세요.

---

## ⚠️ 중요 안내

- **`file://`로 직접 열지 마세요.** ES 모듈과 WebRTC는 `https://`(또는 `localhost`) 환경에서만 정상 동작합니다. 반드시 GitHub Pages 같은 웹 서버로 열어야 합니다.
- **로컬 테스트**를 하려면 이 폴더에서 다음 중 하나를 실행하세요:
  ```bash
  python3 -m http.server 8080
  # 또는
  npx serve
  ```
  그 후 브라우저에서 `http://localhost:8080` 접속.
- 드물게 방화벽/대칭형 NAT 환경에서는 P2P 연결이 막힐 수 있습니다. 이 경우 TURN 서버 설정이 추가로 필요합니다.

---

## 📁 파일 구조

```
tank-clash/
├── index.html              # 진입점 (import map + UI)
├── .nojekyll               # GitHub Pages가 js/ 폴더를 무시하지 않게 함
├── deploy.sh               # 자동 배포 스크립트
├── README.md
├── LICENSE
├── js/
│   ├── main.js             # UI 연결 + 초기화
│   ├── game.js             # 게임 로직 (렌더링/물리/모드)
│   ├── net.js              # PeerJS P2P 연결
│   ├── assets.js           # 텍스처/재질/환경광
│   └── tankmodel.js        # 3D 탱크 모델
└── assets/
    └── textures/           # 절차적 생성 PBR 텍스처 (albedo + normal)
```

---

## 🛠️ 사용 기술

- [Three.js](https://threejs.org/) — 3D 렌더링 (CDN)
- [PeerJS](https://peerjs.com/) — WebRTC P2P 연결 (CDN)
- 순수 HTML/CSS/JS — 빌드 과정 없음

## 📜 라이선스

MIT License. 자유롭게 수정·배포하세요.
