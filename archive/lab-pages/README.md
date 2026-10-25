# Lab pages (보관)

Trade In-Up Builder 를 만들기 전에 기능을 따로 검증하던 테스트 페이지들. 2026-10-16 에 서비스에서 내리고 여기 보관했다.
기능은 전부 builder(public/builder-app.js)로 옮겨 갔고, 이 폴더는 서버가 서빙하지 않는다.

| 파일 | 예전 주소 | 내용 |
|---|---|---|
| composite.html + app.js | `/` → `/composite.html` | Product Composite Builder — 배경 업로드 → 제품 영역 → URL Import·누끼·브러시·크롭 → 배치 → 그림자·톤 |
| infill.html + infill-app.js + infill.css | `/infill.html` | Screen Infill Builder — TV 화면 4점 → 인필 원근 끼우기 → 배경 Hue shift / Tint, Screen glow, 보호 브러시 |
| studio.html + studio-app.js + studio.css (+ infill.css) | `/studio.html` | Studio Scene Builder — 단상 배경 + 제품 합성·그림자 + 화면 인필 + Color mood(레퍼런스 예시) + 배경 오브젝트 브러시 |

## 다시 꺼내려면

이 폴더의 파일을 `public/` 으로 되돌리면 그대로 뜬다 (`git mv archive/lab-pages/<파일> public/`).
공용으로 쓰는 `public/style.css`, `public/lib/`(productImportFlow·bgRemoval·composite·infill 등)는 builder 도 쓰므로 public 에 남아 있다.
