#!/usr/bin/env bash
# 탱크 클래시 3D — GitHub Pages 자동 배포 스크립트
# 사용법:  bash deploy.sh [저장소이름]
# 예시:    bash deploy.sh tank-clash
set -e

REPO_NAME="${1:-tank-clash}"

echo "=============================================="
echo "  탱크 클래시 3D — GitHub Pages 배포"
echo "=============================================="

# 0) gh CLI 설치/로그인 확인
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ GitHub CLI(gh)가 설치되어 있지 않습니다."
  echo "   https://cli.github.com/ 에서 설치 후 다시 실행하세요."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "🔑 GitHub 로그인이 필요합니다. 브라우저 인증을 진행합니다..."
  gh auth login
fi

USER=$(gh api user --jq '.login')
echo "✅ 로그인 사용자: $USER"

# 1) git 초기화
if [ ! -d .git ]; then
  git init -q
  git branch -M main
fi

git add .
git commit -q -m "탱크 클래시 3D 배포" || echo "ℹ️  커밋할 변경사항이 없습니다."

# 2) 원격 저장소 생성 (이미 있으면 재사용)
if gh repo view "$USER/$REPO_NAME" >/dev/null 2>&1; then
  echo "ℹ️  저장소가 이미 존재합니다: $USER/$REPO_NAME (재사용)"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO_NAME.git"
  git push -u origin main --force
else
  echo "📦 새 저장소를 생성하고 업로드합니다: $USER/$REPO_NAME"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
fi

# 3) GitHub Pages 활성화 (main 브랜치 / 루트)
echo "🌐 GitHub Pages 활성화 중..."
gh api -X POST "repos/$USER/$REPO_NAME/pages" \
  -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$USER/$REPO_NAME/pages" \
       -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || echo "ℹ️  Pages가 이미 설정되어 있거나, Settings→Pages에서 수동 활성화가 필요할 수 있습니다."

URL="https://$USER.github.io/$REPO_NAME/"
echo ""
echo "=============================================="
echo "✅ 배포 완료!"
echo ""
echo "   접속 주소: $URL"
echo ""
echo "   ⏳ 최초 배포는 1~2분 정도 반영에 시간이 걸립니다."
echo "   접속이 안 되면 잠시 후 다시 시도하거나,"
echo "   저장소 Settings → Pages 에서 상태를 확인하세요."
echo "=============================================="
