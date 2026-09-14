# ProMoms 운영 배포 가이드

운영 절차의 단일 기준은 프로젝트 루트의 [`README.md`](../README.md)입니다. 인증 정책, 환경변수, SMTP, URL, 최초 OWNER 설정과 릴리스 검증을 모두 완료한 뒤 배포합니다.

## 빠른 배포 순서

```powershell
pnpm install --frozen-lockfile
pnpm run build
npx supabase@latest login
$supabaseProjectRef = Read-Host 'Supabase project ref'
npx supabase@latest link --project-ref $supabaseProjectRef
npx supabase@latest db push --dry-run
npx supabase@latest db push
npx supabase@latest config push
npx vercel@latest link
git push origin main
```

## 필수 원칙

- GitHub `main` 갱신으로 Vercel Production 배포를 시작합니다.
- Production, Preview, Development에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`를 각각 등록합니다.
- 브라우저 환경에는 `service_role` 키, 데이터베이스 비밀번호, SMTP 비밀번호를 넣지 않습니다.
- 마이그레이션과 Auth 설정은 Preview에서 먼저 검증한 뒤 Production에 반영합니다.
- 기존 GitHub·Vercel·Supabase의 기술 식별자는 최종 ProMoms 도메인 전환이 끝날 때까지 임의로 변경하지 않습니다.
- 배포 성공만으로 출시 완료로 보지 않으며 README의 릴리스 체크리스트를 전부 확인합니다.
