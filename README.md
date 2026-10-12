# LG 트윈스 AI 제구 예측 플랫폼 (DEMO MVP)

투수·구종·구속·상황(볼카운트·투구 수·피로도·타자 좌우)·목표 코스를 입력하면 **제구 성공 확률(%)**을 예측하고,
스트라이크존 9분할 히트맵과 투수별 맞춤 전략을 보여주는 웹 앱입니다.

> ⚠️ **중요 고지**
> - 학습·표시되는 **모든 데이터는 확률 모델로 생성한 가상(DEMO) 데이터**입니다. 실제 선수·경기와 무관합니다.
> - 화면의 ROC-AUC·Brier 등은 *합성 데이터를 만든 규칙을 모델이 얼마나 재현하는가*를 보는 **자기일관성 점검**이며, **실제 투수 제구 예측 성능이 아닙니다.**
> - 실데이터(KBO·공개 데이터)로 전환하면 **재학습과 독립 홀드아웃 재검증이 필수**입니다.
> - LG 트윈스·KBO와 제휴되지 않은 비공식 학습용 프로젝트입니다.

## 구조

```
ml/                       Python: 데이터 생성 · 검증 · 학습 · 모델 내보내기
  generate_data.py        가상 투수 20명 × 5,000구 = 100,000구 합성(시드 고정, 전 행 DEMO 표시)
  validate_data.py        데이터 품질/패턴 검증 → data/quality_report.json
  train.py                XGBoost 학습 → 보정 방식 자동 선택 → 평가 → 이력 기록 → JSON 모델 내보내기
  build_assets.py         그래프 집계, 앱 번들 자산, DEMO CSV 복사
  test_pipeline.py        누출 방지·재현성·산출물 테스트
src/lib/model.ts          Vercel 호환 추론 엔진 (XGBoost 트리 JSON을 순수 TypeScript로 평가)
src/model/                학습 산출물(model.json 등) — 서버 번들에 포함
src/app/api/*             predict · compare · graph · metrics · data · upload · download · meta · health
src/components/dashboard  LG 테마 대시보드(예측/비교/관계 그래프/데이터/모델 5탭)
supabase/schema.sql       DEMO/REAL 분리 테이블 + RLS
tests/                    vitest (Python↔TS 추론 패리티, API, 정제 로직)
scripts/                  smoke.mjs(배포 후 점검), seed-supabase.mjs
```

## AI Engineering 5 Layers

| 레이어 | 구현 |
|---|---|
| **1 Prompt** | `/api/predict`: 제구 성공 확률 + 투수·상황별 추천 TOP5·인사이트(`src/lib/strategy.ts`). 점수 = 모델 확률 × 상황 가중치(규칙 기반 휴리스틱, 학습값 아님). LLM 확장용 프롬프트 컨텍스트 템플릿 포함(현재 호출하지 않음) |
| **2 Context** | 합성 데이터 생성·검증(`validate_data.py`: 범위·라벨·단조 패턴 12개 검사), 품질 리포트·학습 이력(`data/`) 관리, 대시보드 데이터 탭에 노출 |
| **3 Harness** | zod 입력 검증, 오류 코드(400/401/404/413/422/429), 인스턴스 단위 레이트리밋, 업로드 4MB 제한, 쓰기·실데이터 접근 토큰, Supabase 서버 전용 키, Python↔TS 패리티 테스트 |
| **4 Loop** | 학습→예측→평가→개선: 시간순 경기 단위 70/15/15 분할, ROC-AUC·Brier·Log loss·ECE·신뢰도 곡선, 보정 방식(none/Platt/Isotonic) CV 선택, 이력(`training_history.json`) |
| **5 Graph** | 투수→구종→구속대→상황→목표구역 5계층 가중 그래프(`/api/graph`, 관계 그래프 탭) |

### 데이터 누출 방지
- 특징은 **투구 전 정보만** 사용(`ml/common.py`): 구속·투구 수·피로도·목표 좌표·볼카운트·타자/투수 손·구종·투수. `actual_x/y`, `miss_distance`, `success`, `in_zone`은 제외(테스트로 강제).
- 학습/보정/평가는 **경기 날짜순, 경기(game_id) 단위 분할**. 조기 종료용 검증셋은 train의 가장 최근 15% 경기로 따로 두고, 보정은 calib 분할로만, 최종 지표는 test 분할로만 계산.
- 합성 데이터에서는 *그날 컨디션* 같은 잠재 변수가 관측되지 않는 잡음으로 들어가 있어(실제로도 그렇듯) 모델 성능에 상한이 있습니다. (현재 AUC≈0.68, 로지스틱 회귀 기준선과 거의 동일)

### 모델 → Vercel 호환 추론
Python 런타임 없이 배포하기 위해 학습된 XGBoost 트리를 `src/model/model.json`(≈190KB)으로 내보내고
`src/lib/model.ts`가 float32 비교 규칙까지 맞춰 평가합니다. `tests/model.test.ts`가 고정 샘플 40개의 확률이 Python과 1e-5 이내로 일치함을 검증합니다.

## 로컬 실행

```bash
npm install
npm run dev            # http://localhost:3000
```

ML 파이프라인(선택 — 결과물은 이미 저장소에 포함):

```bash
pip install -r ml/requirements.txt
npm run ml:data        # 합성 데이터 100,000건 생성 + 품질 검증
npm run ml:train       # 학습·평가·내보내기 + 앱 자산 갱신
```

## 환경변수 (모두 선택)

`.env.example` 참고. **하나도 없어도 DEMO 모델·데이터로 완전히 동작**합니다.

| 변수 | 설명 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용. 설정 시 REAL 영속 저장·조회·다운로드 활성화. **절대 `NEXT_PUBLIC_`로 노출 금지** |
| `UPLOAD_TOKEN` | 실데이터 업로드 저장·조회·다운로드 보호 토큰. 미설정이면 업로드는 검증 미리보기만 |
| `LOG_PREDICTIONS` | `true`면 예측 호출을 `prediction_logs`에 기록 |

### Supabase 연결
1. 프로젝트 생성 → SQL Editor에서 `supabase/schema.sql` 실행
2. Vercel(또는 `.env.local`)에 위 환경변수 설정
3. (선택) DEMO 100,000행 적재: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run db:seed`

DEMO(`pitches_demo`)와 REAL(`pitches_real`)은 테이블이 분리되어 있고 `CHECK (data_source = …)`로 섞이지 않게 강제됩니다. RLS는 켜져 있고 정책이 없어 anon 키로는 접근할 수 없습니다.

## 실데이터 전환 절차 (재학습·재검증 필수)

1. **업로드/정제**: 대시보드 *데이터* 탭에서 CSV 업로드 → 헤더 자동 매핑(한/영 동의어) → 구종·좌우 표준화, 범위·중복 검사, 제구 성공 라벨(목표-실제 거리 ≤ 0.45) 자동 생성. 필수 컬럼: `pitcher_id, pitch_type, velocity, pitch_count, target_x/y, actual_x/y, balls, strikes, batter_hand` (+ 권장 `game_id, game_date, pitcher_hand`). 좌표는 정규화(-1~1) 또는 피트(근사 변환) 지원.
   > 공개 KBO 데이터는 보통 **목표 좌표(포수 미트 위치)가 없습니다.** 제구 라벨에는 목표·실제 좌표가 모두 필요하므로, 데이터 확보 가능성부터 확인하세요.
2. **재학습**: 실데이터 5,000행 이상 + `game_date` 필요(미달 시 학습 거부)
   `python ml/train.py --source mixed --real-csv data/real/pitches_real.csv` (REAL 단독은 `--source real`) → `python ml/build_assets.py`
3. **재검증**: 시간순 홀드아웃의 ROC-AUC·Brier·ECE를 확인하고, **합성 데이터 성능과 비교·주장하지 않음**. 모델 메타의 `data_source`가 `MIXED/REAL`로 바뀌면 배지가 자동 반영됩니다.
4. 커밋 → Vercel 재배포.

## API

| 메서드·경로 | 설명 |
|---|---|
| `POST /api/predict` | `{pitcher_id, pitch_type, pitch_count, balls, strikes, batter_hand, target_zone, velocity?}` → 확률, 9구역 히트맵, 추천 TOP5, 인사이트 |
| `POST /api/compare` | 같은 상황에서 여러 투수의 성공 확률 비교 |
| `GET /api/graph?pitcher=P01` | 5계층 관계 그래프 |
| `GET /api/metrics` | 성능 지표·학습 이력·품질 리포트 |
| `GET /api/data?source=demo\|real&pitcher=&page=` | 데이터 조회(REAL은 `x-upload-token` 필요) |
| `POST /api/upload` | CSV 매핑·정제·(권한 시) 저장 |
| `GET /api/download?source=demo\|real` | CSV 다운로드(REAL은 토큰 필요) |
| `GET /api/health`, `GET /api/meta` | 상태·메타 |

## 테스트

```bash
npm test               # vitest 15개: TS↔Python 추론 패리티, API(성공/오류), 업로드 정제
npm run test:py        # unittest 6개: 누출 방지, 재현성, 라벨 일관성, 산출물
npm run smoke -- https://배포-URL   # 배포된 서버 스모크 테스트
npm run lint && npx tsc --noEmit && npm run build
```

## 배포 (GitHub → Vercel)

1. GitHub 저장소에 push
2. [vercel.com/new](https://vercel.com/new) → 저장소 Import → Framework: Next.js(자동 감지), Root: `/`
3. (선택) Environment Variables에 위 변수 추가 → Deploy
4. `npm run smoke -- https://<프로젝트>.vercel.app`

## 알려진 한계

- 모든 성능 수치는 합성 데이터 기준 → 실제 성능 아님. 결과 해석 시 반드시 DEMO 배지를 확인하세요.
- 레이트리밋은 서버리스 인스턴스 단위(best-effort)입니다. 공개 운영 시 Vercel Firewall/WAF 등을 추가하세요.
- Vercel 요청 본문 한도(4.5MB)로 업로드는 4MB까지입니다. 대용량은 `ml/` 스크립트나 Supabase 직접 적재를 사용하세요.
- 전략 추천의 상황 가중치는 학습된 값이 아닌 규칙 기반 휴리스틱입니다.
