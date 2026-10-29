# ODDBOUT 도메인 설정과 운영 안내서

Spaceship DNS와 GitHub Pages를 연결하고 정책 페이지까지 공개하는 방법

운영자 Lucas Foundation  |  기준일 2026년 10월 22일

현재 oddbout.com은 이미 정상 연결되어 있습니다. 이 문서는 현재 구성을 유지하거나 다시 설정할 때 사용할 실행 안내서입니다. 새 정책 페이지는 같은 도메인의 하위 경로로 배포하면 되므로 별도 도메인 구입이나 DNS 추가가 필요하지 않습니다.

## 현재 구성

| 항목 | 현재 값 |
| --- | --- |
| 대표 주소 | https://oddbout.com/ |
| 제작 및 게임 | https://oddbout.com/creator.html<br>https://oddbout.com/fighter.html |
| 권한 있는 DNS | launch1.spaceship.net<br>launch2.spaceship.net |
| 사이트 호스팅 | GitHub Pages |
| 공개 저장소 | jeonghwanko/ai-fighter-dots-starter |
| 게시 브랜치 | codex/creator-pages |
| 웹 원본 | jeonghwanko/crashbang-heroes의 kaito_web |
| 백엔드 | 기존 Supabase 프로젝트 유지<br>ztfxxhtmtrvxvuxlqmgz.supabase.co |

확인 결과: 대표 주소·제작 페이지·게임·기존 개인정보 페이지는 HTTPS 200 응답이며, www.oddbout.com은 대표 주소로 이동합니다. 2026년 10월 22일 플러그인 정책 페이지 6개를 배포했고, /ai-fighter-creator/privacy.html 및 국문 페이지를 포함한 공개 파일이 검증된 빌드와 일치함을 확인했습니다.

아래 순서는 공개 DNS, 저장소 설정 파일, 공식 문서를 바탕으로 작성했습니다. GitHub의 도메인 검증 배지와 HTTPS 강제 옵션, Supabase·Google 관리자 설정은 이번 문서 작업에서 재확인하거나 변경하지 않았습니다.

## 1 GitHub Pages와 DNS 설정

### GitHub에서 도메인을 먼저 등록

최초 연결 시 GitHub 계정 Settings → Pages → Add a domain에서 oddbout.com을 추가하고 안내된 TXT 레코드로 소유권을 확인합니다. 검증은 저장소 설정이 아니라 해당 저장소를 소유한 계정의 설정에서 합니다. TXT 값은 화면에 표시된 실제 값을 쓰고, 검증 후에도 유지합니다.

이후 저장소 jeonghwanko/ai-fighter-dots-starter의 Settings → Pages를 엽니다. 현재 브랜치 게시 구성을 유지하고 게시 원본을 codex/creator-pages, 폴더를 /(root)로 확인합니다. Custom domain에는 프로토콜이나 경로 없이 oddbout.com만 입력합니다. 저장한 뒤 DNS를 연결합니다.

### Spaceship의 Advanced DNS 값

Spaceship에서 Advanced DNS를 열고 oddbout.com을 선택합니다. 현재 네임서버는 Spaceship이므로 활성 레코드를 여기서 관리합니다. 기존 웹 연결값과 충돌하는 항목만 정리하고 메일용 MX·SPF·DKIM·다른 소유권 확인 TXT는 보존합니다.

| 유형 | 호스트 | 값 | TTL |
| --- | --- | --- | --- |
| A | @ | 185.199.108.153 | 1800초 |
| A | @ | 185.199.109.153 | 1800초 |
| A | @ | 185.199.110.153 | 1800초 |
| A | @ | 185.199.111.153 | 1800초 |
| CNAME | www | jeonghwanko.github.io | 1800초 |
| TXT | GitHub가 지정한 호스트 | GitHub 화면에 표시된 검증값 | 기본값 |

@는 루트 도메인 oddbout.com을 뜻합니다. CNAME 값에는 https://나 /ai-fighter-dots-starter 같은 경로를 넣지 않습니다. 도메인 전체를 호스트 칸에 넣어야 하는 관리 화면인지도 확인하세요.

위 A 4개와 www CNAME은 현재 공개 DNS에서 확인된 값입니다. 루트 AAAA 레코드는 이번 조회에서 발견되지 않았습니다. IPv6는 선택 사항이며 추가할 경우 GitHub 공식 문서의 현재 AAAA 값을 사용합니다. 와일드카드 DNS는 추가하지 않습니다.

중요: 네임서버를 바꾸는 작업과 DNS 레코드를 편집하는 작업은 다릅니다. 현재 구성에서는 네임서버 변경이 필요하지 않습니다. 다른 제공자로 옮기면 기존 메일·검증 레코드도 함께 이전해야 합니다.

## 2 HTTPS와 Google 로그인 설정

### HTTPS 확인

GitHub Pages의 DNS 검사가 통과하고 인증서 준비가 끝나면 Enforce HTTPS를 켭니다. DNS 전파에는 최대 24시간이 걸릴 수 있습니다. 인증서가 준비되지 않은 동안 Custom domain을 반복해서 지우거나 인증서 경고를 우회하지 말고 DNS와 발급 상태를 확인합니다.

https://oddbout.com과 https://www.oddbout.com을 각각 열어 인증서 오류가 없는지 확인합니다. 대표 도메인을 oddbout.com으로 유지하면 www 주소도 이 주소로 이동해야 합니다. CSS·이미지·폰트가 HTTPS로 정상 로드되는지도 확인합니다.

### Supabase의 로그인 후 복귀 주소

Supabase의 Authentication → URL Configuration에서 실제 제작 페이지가 허용되어 있는지 확인합니다. Site URL은 redirectTo가 없을 때 사용하는 기본 복귀 주소이므로 이 서비스에서는 https://oddbout.com/creator.html을 기본값으로 검토합니다. 기존 다른 앱이 공유하는 설정이라면 영향 범위를 먼저 확인합니다.

현재 소스는 언어와 캠페인 또는 관리자 화면 값을 유지해 복귀 URL을 만듭니다. 운영 Redirect URLs에는 실제 사용하는 조합을 허용합니다. 예시는 다음과 같습니다. 기존 정상 복귀 주소를 일괄 삭제하지 않습니다.

```text
https://oddbout.com/creator.html
https://oddbout.com/creator.html?lang=ko
https://oddbout.com/creator.html?lang=en
https://oddbout.com/creator.html?lang=ko&apply=founding-league
https://oddbout.com/creator.html?lang=en&apply=founding-league
```

관리자 화면을 운영하면 ?lang=ko&admin=applications 및 영어 조합 등 실제 소스가 만드는 복귀 주소도 포함합니다. 운영에서는 가능한 정확한 주소를 쓰고, 넓은 https://** 같은 패턴을 허용하지 않습니다. 테스트는 일반 제작 진입과 캠페인 진입, 한국어와 영어 모두 수행합니다.

### Google의 OAuth 콜백 주소

Google Auth Platform의 웹 OAuth 클라이언트에서 Authorized redirect URIs는 Supabase의 Google 제공자 화면에 표시되는 콜백 주소와 정확히 같아야 합니다. 현재 프로젝트 기준 확인 대상은 다음 주소입니다.

```text
https://ztfxxhtmtrvxvuxlqmgz.supabase.co/auth/v1/callback
```

웹사이트 도메인을 연결했다고 이 콜백을 oddbout.com/creator.html로 바꾸지 않습니다. Supabase API 도메인을 그대로 쓰므로 데이터베이스나 요금제를 바꿀 필요가 없습니다. Google Branding의 홈페이지·정책 URL은 실제 배포 후 공개 주소로 갱신합니다.

## 3 저장소 설정과 사이트 배포

### 설정 파일의 기준값

이 저장소의 deploy/creator-site.json에서 다음 값을 유지합니다. apiBase와 publishableKey는 현재 프로젝트 설정을 그대로 사용합니다. 비밀키·service_role 키·토큰을 웹 번들이나 문서에 넣지 않습니다.

```text
"siteUrl": "https://oddbout.com/creator.html"
"gameUrl": "https://oddbout.com/fighter.html"
"base": "/"
"branch": "codex/creator-pages"
"customDomain": "oddbout.com"
```

base가 /인 이유는 사이트가 도메인 루트에 게시되기 때문입니다. 예전 GitHub 프로젝트 경로를 다시 넣으면 JS·CSS·폰트 주소가 어긋날 수 있습니다. 빌더가 만드는 CNAME 파일은 사이트 결과물 루트에 위치하고, 내용은 oddbout.com 한 줄이어야 합니다.

### 빌드 전 준비

웹 원본 저장소와 이 호스팅 저장소의 변경을 검토하고 커밋된 깨끗한 상태를 준비합니다. 현재 빌더는 미커밋 변경이 있으면 중단합니다. 다른 작업자의 변경을 지우거나 검사를 우회하지 말고, 필요하면 검토된 커밋으로 별도 체크아웃을 사용합니다.

다음 명령은 이 저장소 루트에서 실행하는 예시입니다. 두 저장소가 같은 상위 폴더에 있을 때의 상대 경로이며, 그렇지 않으면 실제 경로를 사용합니다. 결과 디렉터리는 매번 새로운 빈 경로를 지정합니다.

```text
node scripts/build-creator-site.mjs ../crashbang-heroes/kaito_web output/domain-release-new

node scripts/publish-creator-site.mjs output/domain-release-new --dry-run
```

첫 명령은 전체 사이트를 로컬 빌드하고 파일 해시와 원본 커밋을 deployment.json에 기록합니다. --dry-run은 배포 조건만 확인하며 원격 저장소에 올리지 않습니다. 로컬 화면·링크·에셋을 검수한 뒤 실제 공개를 진행합니다.

```text
node scripts/publish-creator-site.mjs output/domain-release-new
```

마지막 명령은 GitHub 게시 브랜치에 실제 커밋을 푸시합니다. 스크립트는 배포 식별자와 파일을 다시 확인하고, 라이브 결과까지 검사합니다. GitHub 인증 또는 설정된 배포 권한이 필요합니다. 강제 푸시는 사용하지 않습니다.

이 문서를 만들면서 위 배포 명령이나 CI를 실행하지 않았습니다. 저장소 방침에 따라 소스 CI를 임의로 실행하지 않으며, GitHub Pages의 게시 처리와 로컬 검증을 구분합니다.

## 4 정책 페이지와 심사 영상 연결

이미 연결된 oddbout.com 아래에 새 디렉터리를 게시합니다. 아래 주소는 2026년 10월 22일 배포와 라이브 검증을 완료했습니다. 정책 변경 시 DNS는 그대로 두고 사이트 파일을 다시 빌드·배포합니다.

| 제출 항목 | 배포할 공개 주소 |
| --- | --- |
| 제품 소개 | https://oddbout.com/ai-fighter-creator/index.html |
| 개인정보 처리방침 | https://oddbout.com/ai-fighter-creator/privacy.html |
| 이용약관 | https://oddbout.com/ai-fighter-creator/terms.html |
| 고객 지원 | https://oddbout.com/ai-fighter-creator/support.html |

### 파일을 정상 배포 흐름에 포함

정책 원본은 website/ai-fighter-creator/content.mjs와 style.css이며, build-plugin-policy-site.mjs가 6개 정적 페이지를 만듭니다. 운영자명은 Lucas Foundation, 시행일은 2026-10-22입니다. 기본 단독 실행은 미리보기 표시가 있는 결과를 만들고 전체 사이트 빌드는 공개용 결과를 포함합니다. 보유·처리 위치 등 운영 방식이 바뀌면 정책 원본과 시행일을 함께 검토합니다.

```text
node scripts/build-plugin-policy-site.mjs output/policy-pages/ai-fighter-creator
```

전체 사이트 빌더는 정책 페이지를 공개용으로 생성해 사이트 결과물의 ai-fighter-creator/에 포함합니다. 이 단계는 fingerprint(output)와 deployment.json 생성보다 앞에 실행되므로 정책 파일도 배포 해시와 라이브 검증의 대상입니다. 위 개별 생성 명령은 로컬 미리보기이며, --publish를 추가하면 공개용 문구와 날짜로 렌더링합니다. 파일 렌더링 자체는 사이트 배포가 아닙니다.

빌드가 끝난 뒤 파일을 수동으로 덧붙이면 기록한 해시와 달라져 배포 검사가 실패합니다. 정책 변경을 검토·커밋한 다음 전체 사이트를 새로 빌드하고, 앞 페이지의 dry-run과 공개 절차를 따릅니다. 빌더는 기존 운영 개인정보 페이지의 운영자명을 Lucas Foundation으로 맞추고 새 정책 링크를 추가합니다.

### 영상과 플러그인 목록 연결

심사 영상은 로그인 없이 심사자가 접근할 수 있는 HTTPS 페이지 또는 영상 주소로 제공합니다. 현재 94초 영상은 실제 MCP 기능 검사만 담은 초안입니다. 실제 생성·수정·최종 등록 장면을 추가한 최종본을 공개하고, 브라우저에서 재생·자막·접근 권한을 확인합니다.

공개 페이지 응답을 확인하고 0.2.1의 plugin.json에 있는 extensions.com.openai.interface에 websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL을 반영했습니다. 정확한 주소와 배포 절차는 PLUGIN-DISTRIBUTION.md에 기록되어 있습니다. 조직 승인 후 새 ZIP을 올려야 공식 등록 화면에도 반영됩니다. 최종 영상이 준비되면 review.demo_recording_url에 연결합니다. 기존 0.2.0 파일을 덮어쓰지 않고 새 배포 버전으로 관리합니다.

공개 자료에는 로그인 세션, 일회성 로그인 링크, 생성 제공자 인증정보, 지원 승인 메일 또는 비공개 실행 폴더를 포함하지 않습니다. 도메인 연결은 OpenAI 조직 승인과 별도이며, 도메인만으로 공식 등록 자격이 생기지는 않습니다.

## 5 검증과 장애 복구

### 설정 후 확인

```text
Resolve-DnsName oddbout.com -Type A
Resolve-DnsName www.oddbout.com -Type CNAME
Resolve-DnsName oddbout.com -Type NS
curl.exe -I https://oddbout.com/
curl.exe -IL https://www.oddbout.com/
curl.exe -I https://oddbout.com/creator.html
```

A 응답은 앞의 GitHub IP 4개와 비교하고, www CNAME은 jeonghwanko.github.io인지 확인합니다. HTTPS 응답과 최종 이동 주소, 제작·게임 화면의 에셋, 한국어·영어 Google 로그인, 신규 정책 경로와 영상 재생을 확인하면 완료입니다. 관리자 설정을 읽지 않은 상태에서는 DNS 응답만으로 소유권 검증 배지나 로그인 설정까지 완료됐다고 판단하지 않습니다.

### 문제가 생겼을 때

| 증상 | 확인과 복구 |
| --- | --- |
| 도메인 전체 접속 실패 | 활성 NS와 A/CNAME을 확인합니다. 잘못 바꾼 레코드만 저장해 둔 이전 값으로 복구하고 전파를 기다립니다. |
| 정책 페이지만 404 | DNS가 아니라 배포 파일과 경로를 확인합니다. 파일이 해시 기록에 포함되도록 다시 빌드합니다. |
| HTTPS 인증서 오류 | GitHub Pages의 DNS 검사·인증서 상태와 충돌하는 A/AAAA를 확인합니다. 보안 경고를 우회하지 않습니다. |
| 로그인 후 잘못된 이동 | Supabase Redirect URLs, 실제 redirectTo, Google의 Supabase 콜백을 각각 구분해 점검합니다. |
| 배포 해시 불일치 | 빌드 후 수정된 결과물을 재사용하지 않습니다. 검토된 커밋에서 다시 빌드합니다. |

화면 배포만 잘못됐다면 DNS를 바꾸지 않고 이전 정상 소스 커밋을 별도 깨끗한 체크아웃에서 다시 빌드·검증해 새 배포로 복구합니다. 도메인을 이전하거나 Pages를 해제할 때에는 오래된 DNS가 비어 있는 Pages 대상을 계속 가리키지 않게 순서를 맞춥니다.

### 참고 자료

[GitHub 공식 문서  도메인 연결과 DNS 값](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

[GitHub 공식 문서  도메인 소유권 검증](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)

[Spaceship 공식 문서  활성 네임서버와 DNS 관리](https://www.spaceship.com/knowledgebase/connect-domain-custom-nameservers/)

[Supabase 공식 문서  로그인 복귀 URL](https://supabase.com/docs/guides/auth/redirect-urls)

[Supabase 공식 문서  Google OAuth 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)

[OpenAI 공식 문서  플러그인 제출](https://developers.openai.com/plugins/deploy/submission)

프로젝트 기준: docs/CREATOR-HOSTING.md, deploy/creator-site.json, scripts/build-creator-site.mjs, scripts/hosting-lib.mjs, scripts/publish-creator-site.mjs 및 제작 페이지의 로그인 복귀 함수. 기준일 이후에는 공식 문서와 실제 설정을 다시 확인합니다.
