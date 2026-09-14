# ProMoms

ProMoms는 전문 관리 인력의 신뢰성과 엄마·아기를 위한 따뜻한 케어를 연결하는 운영 웹앱입니다. 고객·관리사·관리자 계정, 서비스 신청과 승인, 일정 배정, 케어 기록과 리포트를 하나의 흐름으로 관리하며, 비공개 파일 저장을 위한 Storage 기반과 접근 정책도 포함합니다.

이 문서는 로컬 개발부터 Supabase 마이그레이션, Vercel 자동 배포, 운영 인증 설정까지의 단일 운영 기준입니다. 공용 데모 계정이나 고정 비밀번호는 사용하지 않습니다.

## 아키텍처

```text
로컬 개발
  → GitHub main 브랜치
  → Vercel 빌드·배포
  → ProMoms 웹앱
  → Supabase Auth + PostgreSQL + Private Storage
```

- Vercel에는 브라우저에서 사용 가능한 Supabase Project URL과 Publishable key만 저장합니다.
- `service_role` 키, 데이터베이스 비밀번호, SMTP 비밀번호는 GitHub와 `VITE_` 환경변수에 절대 저장하지 않습니다.
- 실제 데이터의 접근 권한은 화면 숨김이 아니라 Supabase RLS와 데이터베이스 함수에서 강제합니다.

## 계정과 권한 원칙

- `CLIENT`: 고객이 직접 가입하고 자신의 가족·예약·기록만 사용합니다.
- `CAREGIVER`: 관리사가 직접 가입한 뒤 관리자 승인과 배정을 받아 사용합니다.
- `ADMIN`: 웹앱에서 회원 상태·회원 종류·서비스 승인·일정과 운영 데이터를 관리합니다.
- `OWNER`: 최초 운영 책임자용 최고 권한입니다. 일반 회원 화면에서 부여하지 않고 데이터베이스 관리자만 최초 1회 설정합니다.

운영자마다 개인 계정을 사용하고 공용 ID나 짧은 공용 비밀번호를 만들지 않습니다. 퇴사·역할 변경 시에는 해당 개인 계정을 즉시 정지하고 역할을 회수합니다.

## 로컬 실행

Node.js 22 LTS와 pnpm을 준비한 뒤 프로젝트 루트에서 실행합니다.

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item -LiteralPath .env.example -Destination .env.local
pnpm run dev
```

Supabase Dashboard의 **Project Settings → API**에서 현재 프로젝트 값을 확인해 `.env.local`의 두 항목을 채웁니다.

| 환경변수 | 용도 | 공개 여부 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL | 브라우저 공개 가능 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable key | 브라우저 공개 가능 |

배포 전 로컬 빌드도 반드시 확인합니다.

```powershell
pnpm run build
pnpm run preview
```

## Supabase 연결과 마이그레이션

CLI 인증은 열린 Supabase 브라우저 화면에서 직접 승인합니다. 액세스 토큰, 데이터베이스 비밀번호, 로그인용 임시 코드는 채팅·이슈·커밋에 남기지 않습니다.

```powershell
npx supabase@latest login
$supabaseProjectRef = Read-Host 'Supabase project ref'
npx supabase@latest link --project-ref $supabaseProjectRef
npx supabase@latest migration list
npx supabase@latest db push --dry-run
npx supabase@latest db push
npx supabase@latest config push
```

`db push --dry-run` 결과에서 예상하지 않은 삭제나 타입 변경이 보이면 적용하지 않습니다. `db push` 성공 후 다시 `migration list`를 실행해 Local과 Remote가 모두 동일한지 확인합니다.

`supabase/config.toml`의 운영 인증 기준은 다음과 같습니다.

- 비밀번호 최소 8자
- 대·소문자, 숫자, 특수문자 조합 강제 없음
- 이메일 가입 확인 비활성화: 가입 직후 로그인 가능
- 비밀번호 변경 시 최근 로그인 또는 재인증 요구
- 이메일 주소 변경은 기존·신규 주소 확인 유지

이메일 가입 확인을 끄는 것과 비밀번호 재설정 이메일은 서로 다른 기능입니다. 가입 확인을 끄더라도 비밀번호 찾기와 이메일 변경을 운영하려면 SMTP 설정이 필요합니다.

## Vercel 환경변수와 자동 배포

Vercel 프로젝트를 연결한 뒤 두 공개 환경변수를 Production, Preview, Development에 각각 등록합니다. 각 명령이 값을 요청하면 Supabase Dashboard에서 복사한 현재 프로젝트 값을 붙여 넣습니다.

```powershell
npx vercel@latest login
npx vercel@latest link
npx vercel@latest env add VITE_SUPABASE_URL production
npx vercel@latest env add VITE_SUPABASE_URL preview
npx vercel@latest env add VITE_SUPABASE_URL development
npx vercel@latest env add VITE_SUPABASE_PUBLISHABLE_KEY production
npx vercel@latest env add VITE_SUPABASE_PUBLISHABLE_KEY preview
npx vercel@latest env add VITE_SUPABASE_PUBLISHABLE_KEY development
npx vercel@latest env ls
npx vercel@latest env pull .env.local --environment=development
```

환경변수를 변경하면 기존 배포에는 자동 반영되지 않으므로 Vercel에서 Redeploy하거나 새 커밋을 푸시합니다.
이미 같은 이름의 변수가 있으면 `env add` 대신 `env update`를 사용합니다. 예: `npx vercel@latest env update VITE_SUPABASE_URL production`.

```powershell
pnpm run build
git status --short
git push origin main
```

Vercel의 Framework Preset은 `Vite`, Build Command는 `pnpm run build`, Output Directory는 `dist`, Production Branch는 `main`으로 설정합니다.

## 운영 URL 설정

최종 ProMoms 도메인이 확정되면 다음 세 위치를 같은 값으로 맞춥니다.

1. Vercel **Settings → Domains**
2. Supabase **Authentication → URL Configuration**의 Site URL과 Redirect URLs
3. `supabase/config.toml`의 `site_url`과 `additional_redirect_urls`

로컬 개발 주소는 `http://localhost:4173`과 `http://127.0.0.1:4173`만 허용합니다. Preview URL은 팀이 소유한 Vercel 주소만 추가하고 광범위한 와일드카드는 사용하지 않습니다. 설정 변경 후 아래 명령으로 원격 Auth 설정을 동기화합니다.

```powershell
npx supabase@latest config push
```

현재 설정에 남아 있는 자동 생성 배포 주소와 프로젝트 ID는 연결을 유지하기 위한 인프라 식별자입니다. 최종 도메인을 연결하기 전 임의로 이름만 바꾸면 로그인 리디렉션과 배포 연결이 끊어질 수 있습니다.

## 운영 SMTP와 비밀번호 찾기

Supabase의 기본 메일 발송은 운영용 대량 발송 수단이 아닙니다. 실제 사용자 공개 전 다음을 완료합니다.

1. 전용 발신 도메인을 정하고 SMTP 제공업체에서 SPF, DKIM, DMARC를 검증합니다.
2. Supabase **Authentication → Email → SMTP Settings**에 호스트, 포트, 사용자, 비밀번호, 발신 이메일을 등록합니다.
3. 발신자 이름을 `ProMoms`로 설정합니다.
4. 비밀번호 재설정 URL이 최종 ProMoms 도메인으로만 돌아오는지 확인합니다.
5. 정상 주소, 존재하지 않는 주소, 만료된 링크, 이미 사용한 링크를 각각 테스트합니다.
6. 발송 실패율과 반송 로그에 대한 운영 알림을 설정합니다.

CLI로 SMTP 설정을 관리할 경우 `supabase/config.toml`의 `[auth.email.smtp]` 블록을 활성화하고 비밀번호와 발신 주소는 각각 `PROMOMS_SMTP_PASSWORD`, `PROMOMS_SMTP_FROM_EMAIL` 환경변수로 주입한 뒤 동기화합니다.

```powershell
$promomsSmtpSecret = Read-Host 'SMTP password' -AsSecureString
$env:PROMOMS_SMTP_PASSWORD = [System.Net.NetworkCredential]::new('', $promomsSmtpSecret).Password
$env:PROMOMS_SMTP_FROM_EMAIL = Read-Host 'Verified sender email'
npx supabase@latest config push
Remove-Item Env:PROMOMS_SMTP_PASSWORD
Remove-Item Env:PROMOMS_SMTP_FROM_EMAIL
$promomsSmtpSecret = $null
```

SMTP 비밀번호는 `.env.local`에도 저장하지 않는 것을 권장합니다. 위 환경변수는 설정 반영 직후 현재 터미널에서 제거합니다.

## 최초 OWNER 설정

`OWNER`는 Supabase 조직 권한이 아니라 ProMoms 웹앱의 `public.user_roles` 권한입니다. 다음 순서로 한 번만 부여합니다.

1. 운영 책임자가 자신의 실제 이메일로 웹앱 회원가입을 완료합니다.
2. Supabase Dashboard에서 같은 이메일의 Auth 사용자와 `public.profiles` 행이 정확히 하나씩 존재하는지 확인합니다.
3. Dashboard의 **Database → Connect**에서 표시되는 `psql` 접속 명령으로 데이터베이스에 연결합니다.
4. 아래 블록을 `psql`에 그대로 실행하고 프롬프트에 운영 책임자 이메일을 입력합니다.

```sql
\set ON_ERROR_STOP on
\prompt 'ProMoms OWNER email: ' owner_email

begin;

select set_config('promoms.bootstrap_owner_email', :'owner_email', true);

do $promoms$
declare
  selected_user_id uuid;
begin
  select id
    into strict selected_user_id
  from public.profiles
  where lower(email) = lower(current_setting('promoms.bootstrap_owner_email'));

  delete from public.user_roles
  where user_id = selected_user_id;

  insert into public.user_roles (user_id, role)
  values (selected_user_id, 'OWNER'::public.app_role);

  update public.profiles
  set requested_role = 'ADMIN',
      account_status = 'ACTIVE',
      deleted_at = null,
      deleted_by = null,
      updated_at = now()
  where id = selected_user_id;
end
$promoms$;

select p.email, p.account_status, array_agg(ur.role order by ur.role) as roles
from public.profiles p
join public.user_roles ur on ur.user_id = p.id
where lower(p.email) = lower(current_setting('promoms.bootstrap_owner_email'))
group by p.email, p.account_status;

commit;
```

결과가 `ACTIVE`와 `OWNER` 한 행인지 확인한 뒤 로그아웃·로그인하여 관리자 메뉴와 회원 관리가 열리는지 확인합니다. 이후 `ADMIN` 역할은 OWNER가 웹앱의 회원 관리에서 부여하며, OWNER 자체는 웹앱에서 변경할 수 없도록 유지합니다.

운영 배포 전에는 아래 감사 쿼리로 모든 고권한 계정을 직접 검토합니다.

```sql
select p.id, p.email, p.account_status, ur.role, ur.created_at
from public.profiles p
join public.user_roles ur on ur.user_id = p.id
where ur.role in ('OWNER', 'ADMIN')
order by ur.role, p.email;
```

목록에 담당자가 확인하지 못한 계정, 공용 계정, 테스트 도메인 계정이 있으면 공개 전에 역할을 회수합니다.

## 릴리스 체크리스트

### 보안과 데이터

- [ ] Git 이력과 Vercel 환경변수에 `service_role`, 데이터베이스 비밀번호, SMTP 비밀번호가 없음
- [ ] 모든 Supabase 마이그레이션이 원격에 적용됨
- [ ] 테이블과 Storage 버킷의 RLS를 CLIENT, CAREGIVER, ADMIN, OWNER별로 검증함
- [ ] 확인된 개인 계정만 ADMIN 또는 OWNER 역할을 가짐
- [ ] 비밀번호 찾기와 이메일 변경 메일이 운영 SMTP로 도착함
- [ ] 데이터 보관·삭제·백업·복구 정책과 감사 로그를 확인함

### 핵심 사용자 흐름

- [ ] 고객 가입 → 로그인 → 프로필 수정 → 서비스 신청
- [ ] 관리사 가입 → 승인 대기 → 관리자 승인 → 배정 확인
- [ ] 관리자 신청 승인·거절 → 일정 배정 → 변경·취소 처리
- [ ] 환불 필요 건의 결제사 환불 처리 → 외부 환불번호 기록 → 감사 로그 확인
- [ ] 진행 중 세션이 없는 관리사만 재배정하고, 계정 정지 시 열린 세션 강제 종료 로그를 확인함
- [ ] 산후조리와 베이비시팅의 기간·시간·중복 제한 검증
- [ ] 관리사 근무 시작·종료와 케어 기록이 다른 기기에서도 동기화됨
- [ ] 완료된 케어 세션의 고객 리포트·후기가 재로그인 후 유지됨
- [ ] 파일 업로드 기능을 공개할 경우 배정 단위 경로와 서명 URL을 구현·검증함
- [ ] 정지·삭제된 회원이 보호 데이터에 접근하지 못함

### UI와 배포

- [ ] iPhone Safari, Android Chrome, 데스크톱 Chrome·Safari에서 주요 화면 확인
- [ ] 작은 화면에서 모달, 날짜 선택, 하단 버튼이 겹치거나 잘리지 않음
- [ ] 키보드만으로 로그인, 신청, 승인, 변경·취소가 가능함
- [ ] 404 라우팅, 새로고침, 오프라인 복귀, 오래된 서비스 워커 캐시를 확인함
- [ ] 배포 후 프로덕션 URL에서 신규 가입과 관리자 승인을 다시 확인함

## 운영 시 주의사항

- 이 앱은 의료 진단 도구가 아니라 케어 기록과 운영 지원 도구입니다.
- 건강·가족 정보는 민감 정보로 취급하고 최소 권한, 보관 기한, 접근 감사와 사고 대응 절차를 적용합니다.
- HIPAA 적용 여부, 고객 계약, 취소·환불, 보험 및 W-2 표기는 미국·조지아주 법률·보험·세무 전문가의 검토를 거칩니다.
- 실제 결제는 서버에서 금액과 상태를 재검증하고 결제 제공업체 웹훅을 원장으로 사용합니다.
- 현재 환불 완료 기능은 관리자가 결제사에서 환불한 뒤 외부 환불번호를 기록하는 방식입니다. 결제 제공업체 웹훅 연동 전까지 웹앱이 직접 돈을 이동시키지는 않습니다.
- 계약서·자격증·프로필 사진·첨부파일의 버킷과 기본 정책은 준비되어 있지만, 업로드·미리보기·서명 URL UI는 배정 단위 경로 설계와 함께 별도 출시해야 합니다.
- 운영 장애 시 Supabase Auth, Database, Storage와 Vercel Deployment 로그를 함께 확인합니다.

세부 제품 범위는 [`docs/PRODUCT_PLAN.md`](./docs/PRODUCT_PLAN.md), 간단한 배포 진입점은 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)를 참고합니다.
