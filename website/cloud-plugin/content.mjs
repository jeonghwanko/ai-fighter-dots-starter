export const identity = { publisher: '정환 고', service: 'ODDBOUT', support: 'turbo08@gmail.com', effective: '2026-10-24' };
export const content = {
  en: {
    nav:['Overview','Privacy','Terms','Support'],
    index:{title:'Your fighter. Connected.',intro:'Connect ODDBOUT to Dots with Google. No local MCP installation or API key.',sections:[
      ['What you can do','Read fighter requirements, check your account’s registration access, list your fighters, upload a reviewed package and follow its registration status.'],
      ['Make it yours','Image generation, animation authoring, visual review and packaging use your chosen host and generation account. Connecting ODDBOUT does not provide a generation subscription or approve unfinished artwork.'],
      ['Connect from Dots','Open ODDBOUT in Dots and choose Connect, sign in with the Google account that will own your fighters, then review and approve access. The public plugin is awaiting submission/review; it is not yet listed for everyone.'],
      ['Register when ready','Ask to register the final package after reviewing it. The service validates all required files. Queued processing is not completed registration; check the final status. Registered fighter profiles and game assets are public.'] ]},
    privacy:{title:'Privacy notice',intro:'How the ODDBOUT cloud plugin handles your account and character files.',sections:[
      ['Who provides this plugin','The public plugin is published by 정환 고 for ODDBOUT. The ODDBOUT service is operated by Lucas Foundation. Contact turbo08@gmail.com for privacy questions or data requests.'],
      ['Information received','Google sign-in provides your account identity, basic profile and email. Provisioned email accounts can also sign in; their passwords are sent directly to Supabase Auth over HTTPS and are not included in connector requests. The connector receives OAuth authorization and the tool arguments and files selected for an operation: fighter metadata, manifests, animation assets, submission identifiers and status requests. It does not require your Google password, generation-provider credentials or a local PC installation.'],
      ['Why we use it','We use this information to identify the owner, enforce access to their own submissions, validate packages, process registration, serve registered fighters and investigate service failures or abuse. The connector’s authorization cannot be used as a general database or storage login.'],
      ['Providers and public data','Google provides social sign-in. Supabase hosts authentication, registration data and storage. Render forwards the public MCP requests, including OAuth access tokens, to the fixed Supabase MCP server and processes package validation. GitHub Pages hosts the connection and information pages. OpenAI operates Dots and the connector host. These providers may process data outside your country. Registered character profiles, artwork, animation and gameplay packages are public; sign-in email and authentication tokens are not part of a public fighter package.'],
      ['Retention and choices','You can request fighter deletion in Dots. After ownership and deletion confirmation, it leaves your list, public rosters and new matches, and its account slot is released. Private original packages and historical records are retained; this is not file erasure. Previously issued asset links expire within 10 minutes. Contact support for account-data access, correction or erasure requests. Disconnecting alone does not delete fighters. Downloaded public copies cannot necessarily be recalled.'],
      ['Contact safely','Include only the affected account email, public fighter ID and a short description. Never send passwords, OAuth callbacks, access tokens or signed download links. Changes to this notice will be published here.'] ]},
    terms:{title:'Terms of service',intro:'Using the ODDBOUT cloud plugin to connect and register your characters.',sections:[
      ['Provider and scope','This plugin is published by 정환 고 for ODDBOUT, operated by Lucas Foundation. It supports account connection, requirements, upload, validation and registration status. It does not sell generation credits or process payments. Contact turbo08@gmail.com for help.'],
      ['Your account and content','Use your own account and submit only content you own or are authorized to use. Do not upload secrets, another person’s private information or content that violates others’ rights. You are responsible for reviewing your fighter before requesting registration.'],
      ['Registration and publication','An explicit registration request authorizes processing of the uploaded package. Packages must pass the service’s validation. Registered fighter profiles and game assets become public and usable in ODDBOUT. Registered packages are immutable; revisions require a new package. Moderation or removal can occur separately from technical validation.'],
      ['Generation and service limits','A connection is not evidence that your chosen host can generate, display or package images. Generation providers have their own terms, limits and charges. Processing may be queued or unavailable, including startup delays in the free validation service. A queued result is not a completed registration.'],
      ['Disconnect and support','You may disconnect the plugin in Dots. To delete a fighter, request deletion in Dots and confirm the owning account, character and scope. This removes active listings and new matches while retaining private packages and history. Contact support for account-data erasure; disconnecting alone does not delete data. We may restrict misuse that threatens others or the service. Applicable rights are not waived by these terms.'] ]},
    support:{title:'Let’s get you connected.',intro:'Support for Google connection and fighter registration.',sections:[
      ['Contact','Email turbo08@gmail.com. Public plugin publisher: 정환 고. Include your language, the visible error, and the submission or fighter ID when available. Do not send passwords, tokens or OAuth callback URLs.'],
      ['Connection expired','Return to the ODDBOUT plugin in Dots and start Connect again. Sign in with the account that owns your fighters. Use the EN / KR switch to change language without restarting an active request.'],
      ['Registration is queued','Ask Dots to check your submission status. Validation can take time, especially while the free validation host starts. Reuse the same submission and retry key; do not regenerate your artwork because delivery or validation is waiting.'],
      ['Package rejected','Review the validation reason and correct the affected package files. Revalidate before registering. A connection or valid JSON does not replace visual review of the animation.'],
      ['Privacy and removal','Ask Dots to delete your fighter. Check the account and character in its confirmation; the server rechecks ownership before removing active listings and freeing the slot. Private package files and history remain. For account-data or original-file erasure, contact support with only the information needed to locate the record.'] ]}
  },
  ko: {
    nav:['소개','개인정보','이용약관','지원'],
    index:{title:'나의 캐릭터, Dots와 연결.',intro:'Google로 ODDBOUT에 연결하세요. 로컬 MCP 설치나 API 키가 필요하지 않습니다.',sections:[
      ['할 수 있는 일','캐릭터 규격 확인, 계정의 등록 가능 여부 점검, 내 캐릭터 조회, 검토한 패키지 업로드와 등록 상태 확인을 지원합니다.'],
      ['제작은 내가 선택한 환경에서','이미지 생성·애니메이션 제작·시각 검토·패키징은 선택한 호스트와 생성 계정을 사용합니다. ODDBOUT 연결만으로 생성 구독이 제공되거나 미완성 작업이 승인되지는 않습니다.'],
      ['Dots에서 연결하기','Dots의 ODDBOUT에서 연결을 선택하고, 캐릭터를 소유할 Google 계정으로 로그인한 뒤 권한을 확인해 승인하세요. 공개 플러그인은 제출·심사 준비 중이며 아직 일반 공개 목록에 등록되지 않았습니다.'],
      ['준비되면 등록하기','최종 패키지를 검토한 뒤 등록을 요청하세요. 서버가 필요한 파일을 검증합니다. 대기 중은 등록 완료가 아니므로 최종 상태를 확인하세요. 등록된 캐릭터 프로필과 게임 에셋은 공개됩니다.'] ]},
    privacy:{title:'개인정보 처리 안내',intro:'ODDBOUT 클라우드 플러그인이 계정과 캐릭터 파일을 처리하는 방법입니다.',sections:[
      ['제공자','공개 플러그인 게시자는 정환 고이며, ODDBOUT 서비스는 Lucas Foundation이 운영합니다. 개인정보 문의와 데이터 요청은 turbo08@gmail.com으로 보내 주세요.'],
      ['받는 정보','Google 로그인에서 계정 식별 정보·기본 프로필·이메일을 받습니다. 발급된 이메일 계정도 로그인할 수 있으며, 비밀번호는 HTTPS로 Supabase Auth에 직접 전달되고 연결 도구 요청에는 포함되지 않습니다. 연결 도구는 OAuth 권한과 작업에 선택된 인자·파일을 처리합니다. 여기에는 캐릭터 메타데이터, 매니페스트, 애니메이션 에셋, 제출 식별자와 상태 조회 요청이 포함됩니다. Google 비밀번호나 생성 제공자 인증정보, PC 설치는 요구하지 않습니다.'],
      ['이용 목적','소유자 식별, 본인 제출물 접근 제한, 패키지 검증, 등록 처리, 등록 캐릭터 제공, 장애·오용 조사에 사용합니다. 연결 도구의 권한은 일반 데이터베이스·스토리지 로그인 권한으로 사용할 수 없습니다.'],
      ['처리 제공자와 공개 정보','Google은 소셜 로그인을, Supabase는 인증·등록 데이터·스토리지를 제공합니다. Render는 OAuth 접근 토큰을 포함한 공개 MCP 요청을 고정된 Supabase MCP 서버로 전달하고 패키지를 검증합니다. GitHub Pages는 연결·안내 페이지를, OpenAI는 Dots와 연결 호스트를 제공합니다. 제공자는 이용자의 국가 밖에서 정보를 처리할 수 있습니다. 등록된 캐릭터 프로필·그림·애니메이션·게임 패키지는 공개되며, 로그인 이메일과 인증 토큰은 공개 패키지에 포함되지 않습니다.'],
      ['보관과 선택','Dots에서 캐릭터 삭제를 요청할 수 있습니다. 소유권과 삭제 의사를 확인한 뒤 내 목록·공개 목록·새 대전에서 제거하고 등록 슬롯을 비웁니다. 비공개 원본 패키지와 과거 기록은 보관하며 파일 완전 삭제는 아닙니다. 이미 발급된 에셋 링크는 최대 10분 이내 만료됩니다. 계정 데이터 열람·정정·완전 삭제는 지원 주소로 문의하세요. 연결 해제만으로 캐릭터가 삭제되지는 않으며 이미 내려받은 공개 사본은 회수할 수 없을 수 있습니다.'],
      ['안전한 문의','관련 계정 이메일, 공개 캐릭터 ID와 간단한 설명만 보내 주세요. 비밀번호·OAuth 콜백·접근 토큰·서명된 다운로드 주소는 보내지 마세요. 이 안내가 바뀌면 이 페이지에 게시합니다.'] ]},
    terms:{title:'이용약관',intro:'ODDBOUT 클라우드 플러그인 연결과 캐릭터 등록에 적용되는 안내입니다.',sections:[
      ['제공자와 범위','정환 고가 게시하는 ODDBOUT 플러그인이며 서비스 운영자는 Lucas Foundation입니다. 계정 연결·규격 확인·업로드·검증·등록 상태를 지원합니다. 생성 크레딧 판매나 결제 처리는 제공하지 않습니다. 문의: turbo08@gmail.com.'],
      ['계정과 콘텐츠','본인 계정을 사용하고 소유권이나 사용 권한이 있는 콘텐츠만 제출하세요. 비밀정보, 타인의 사적 정보, 타인의 권리를 침해하는 콘텐츠를 올리지 마세요. 등록 요청 전에 캐릭터를 직접 검토해야 합니다.'],
      ['등록과 공개','명시적인 등록 요청에 따라 업로드한 패키지를 처리합니다. 패키지는 서비스의 검증을 통과해야 합니다. 등록된 프로필과 게임 에셋은 공개되고 ODDBOUT에서 사용할 수 있습니다. 등록 패키지는 변경할 수 없으며 수정본은 새 패키지로 등록해야 합니다. 기술 검증과 별도로 운영 정책에 따른 제한·삭제가 있을 수 있습니다.'],
      ['생성과 서비스 제한','연결 성공은 선택한 호스트의 생성·표시·패키징 가능 여부를 보장하지 않습니다. 생성 제공자에는 별도의 약관·사용 한도·요금이 적용됩니다. 무료 검증 호스트의 시작 지연 등을 포함해 처리 대기나 일시 장애가 있을 수 있습니다. 대기 결과는 등록 완료가 아닙니다.'],
      ['해제와 지원','Dots에서 플러그인을 연결 해제할 수 있습니다. 캐릭터 삭제는 Dots에 요청하고 소유 계정·대상·범위를 확인하세요. 활성 목록과 새 대전에서 제거하며 비공개 패키지와 과거 기록은 보관합니다. 계정 데이터 완전 삭제는 지원 주소로 문의하세요. 연결 해제만으로 데이터가 삭제되지는 않습니다. 다른 이용자나 서비스를 위협하는 오용은 제한할 수 있으며 이 약관으로 법률상 권리를 포기하게 하지는 않습니다.'] ]},
    support:{title:'연결을 도와드릴게요.',intro:'Google 연결과 캐릭터 등록 관련 지원 안내입니다.',sections:[
      ['문의','turbo08@gmail.com으로 문의하세요. 공개 플러그인 게시자: 정환 고. 사용 언어, 표시된 오류, 제출·캐릭터 ID가 있다면 함께 적어 주세요. 비밀번호·토큰·OAuth 콜백 주소는 보내지 마세요.'],
      ['연결 요청이 만료되었어요','Dots의 ODDBOUT 플러그인으로 돌아가 연결을 다시 시작하세요. 캐릭터를 소유한 계정을 선택하세요. 진행 중에는 EN / KR 버튼으로 연결을 다시 시작하지 않고 언어를 바꿀 수 있습니다.'],
      ['등록이 대기 중이에요','Dots에 제출 상태 확인을 요청하세요. 무료 검증 호스트가 시작되는 동안 시간이 더 걸릴 수 있습니다. 같은 제출물과 재시도 키를 유지하세요. 전달·검증 대기 때문에 그림을 다시 생성하지 마세요.'],
      ['패키지가 반려되었어요','검증 사유에 해당하는 파일을 수정하고 다시 검증하세요. 연결 성공이나 JSON 형식 검사는 애니메이션 시각 검토를 대신하지 않습니다.'],
      ['개인정보·삭제 요청','Dots에 내 캐릭터 삭제를 요청하세요. 확인 안내의 계정과 캐릭터가 맞는지 확인하면 서버가 소유권을 다시 검사하고 활성 목록에서 제거하며 슬롯을 비웁니다. 비공개 패키지 파일과 과거 기록은 남습니다. 계정 데이터·원본 파일 완전 삭제는 지원 주소로 문의하고 기록을 찾는 데 필요한 최소 정보만 보내 주세요.'] ]}
  }
};
