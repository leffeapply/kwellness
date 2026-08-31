# K-Wellness 운영 배포 가이드

## 확정 아키텍처

```text
Codex 로컬 개발
  → GitHub 비공개 저장소: k-wellness-careos
  → Vercel 자동 빌드·배포
  → Vercel API
  → Supabase Auth + PostgreSQL + Private Storage
```

## 필요한 계정

### 1. GitHub

- 가입: https://github.com/signup
- 저장소 이름: `k-wellness-careos`
- 공개 범위: `Private`
- README, `.gitignore`, License 자동 생성: 모두 선택하지 않음
- 이유: 현재 로컬 저장소에 이미 전체 코드와 Git 이력이 있기 때문

저장소가 생성되면 브라우저 주소만 Codex에 전달합니다. Codex가 정확한 Git remote를 연결하고 `main` 브랜치를 업로드합니다.

### 2. Vercel

- 가입: https://vercel.com/signup
- 로그인 방식: `Continue with GitHub`
- GitHub 앱 권한: `k-wellness-careos` 저장소만 허용
- Framework Preset: `Vite`
- Build Command: `pnpm run build`
- Output Directory: `dist`
- Production Branch: `main`

GitHub 저장소를 Import하면 이후 `main` 브랜치의 모든 변경이 자동 배포됩니다.

### 3. Supabase

- 대시보드: https://supabase.com/dashboard
- 프로젝트 이름: `k-wellness-careos`
- Region: 미국 동부 리전
- Database Password: 비밀번호 관리자에 저장하고 채팅이나 GitHub에 공유하지 않음

프로젝트 생성 후 다음 두 값만 Vercel의 Project Settings → Environment Variables에 등록합니다.

- `VITE_SUPABASE_URL`: Supabase Project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabase Publishable key

브라우저 앱에는 Publishable key만 사용합니다. `service_role` 키와 데이터베이스 비밀번호에는 절대 `VITE_` 접두사를 붙이지 않으며 GitHub에 저장하지 않습니다.

## 데이터베이스와 파일 저장소

`supabase/migrations`의 001부터 017까지를 순서대로 적용합니다. 마지막 마이그레이션은 다음 비공개 버킷과 RLS 정책을 생성합니다.

- `profile-photos`
- `caregiver-certificates`
- `contracts`
- `care-reports`
- `attachments`

고객은 자기 가족 자료만, 관리사는 현재 배정된 고객 자료만, 관리자는 운영 범위 전체를 접근하도록 정책이 설계되어 있습니다.

## 실제 고객 데이터 저장 전 필수 점검

- Supabase Auth 이메일 확인과 비밀번호 재설정 활성화
- 관리자·리테일 공용 데모 비밀번호 제거
- 모든 테이블과 Storage의 RLS 테스트
- 감사 로그와 데이터 보관·삭제 정책 확정
- 결제 사업자와 예약금·환불 웹훅 연결
- 개인정보 처리방침·이용약관·전자동의 법률 검토
- PHI를 취급한다면 Vercel 및 Supabase와 BAA/HIPAA 옵션 검토

계정 연결 전 현재 앱은 기존 데모 모드로 작동합니다. Supabase 환경변수가 등록되면 클라우드 연결 준비 상태로 전환되며, 실제 화면별 CRUD 전환은 인증부터 순차적으로 진행합니다.
