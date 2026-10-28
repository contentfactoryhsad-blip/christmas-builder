#!/bin/sh
# Christmas Builder 에셋 굽기 — source/ 의 3077×3077 원본(장당 6~9MB)을 그대로 못 쓰므로
# BF 빌더(buildContentTemplateAssets)처럼 팔레트 썸네일 / 캔버스 미리보기 / Edit panel 원본 프레임을 따로 만든다.
#   thumb   : 팔레트 타일(140×64)용 — 가운데를 잘라 280×128 (2x)
#   preview : 캔버스 980×464 박스용 — 원본 높이의 1/3.3 을 가운데에서 잘라 1960×928 (BF 는 2.5 — 무대가 작아 더 당겼다)
#   frame   : Edit panel 정사각 전체 프레임 — 1200×1200
#   stage   : 합성 바탕 — 원본 해상도 그대로 (PNG 다운로드가 이 크기로 나간다)
#
# id = b<라인>-<파일명> (source/<라인>/…)
# 줄마다 Light / Dark 톤 — Dark 는 source/dark/ 아래 같은 이름으로 둔다 → id 끝에 -dark (예 b1-01-01-dark)
# 원본이 없는 박스는 건너뛰고(빈 박스로 남는다), 구운 목록은 manifest.json 에 적는다 — 빌더가 이걸 읽는다.
#
#   sh scripts/build-assets.sh
set -e
cd "$(dirname "$0")/.."
SRC=source
OUT=public/assets/christmas
mkdir -p "$OUT"

# 원본마다 크기가 달라서(01 = 3077², 02 = 2533²) 자르는 영역은 원본 한 변에 대한 비율로 잡는다
#   thumb   : 가로 0.52 × 세로 0.2376 (140:64) — 키 큰 제품 컷은 넷째 인자로 가로 비율을 넓힌다(%)
#   preview : 세로 1/3.3, 가로는 980:464 로
size_of() { sips -g pixelWidth "$1" | awk '/pixelWidth/ {print $2}'; }
height_of() { sips -g pixelHeight "$1" | awk '/pixelHeight/ {print $2}'; }
MANIFEST=""

# 원본이 source/ 에서 빠져도 이미 구운 에셋은 그대로 쓴다 — 구운 stage 크기로 manifest 에 다시 적는다
keep_baked() {
  id=$1
  if [ -f "$OUT/$id-stage.jpg" ]; then
    MANIFEST="$MANIFEST${MANIFEST:+,}
  { \"id\": \"$id\", \"w\": $(size_of "$OUT/$id-stage.jpg"), \"h\": $(height_of "$OUT/$id-stage.jpg") }"
    echo "  = $id 원본 없음 — 구워 둔 것 유지"
  else
    echo "  - $2 없음 — $id 는 빈 박스"
  fi
}

# 사용법: bake <id> <타일용 원본> <캔버스·패널용 원본> [타일 가로 비율 %, 기본 52]
# 빈 무대(_no product)가 아직 없으면 타일용 원본으로 대신 굽고 경고만 남긴다 — 들어오면 다시 돌리면 된다
bake() {
  id=$1; tile=$2; stage=$3; tw=${4:-52}
  if [ ! -f "$SRC/$tile" ]; then
    keep_baked "$id" "$tile"
    return 0
  fi
  if [ ! -f "$SRC/$stage" ]; then
    echo "  ! $stage 없음 — $tile 로 대신 굽는다"
    stage=$tile
  fi
  n=$(size_of "$SRC/$tile")
  tcw=$((n * tw / 100))
  sips -s format jpeg -s formatOptions 85 -c $((tcw * 64 / 140)) $tcw "$SRC/$tile" --out "$OUT/$id-thumb.jpg" >/dev/null
  sips -z 128 280 "$OUT/$id-thumb.jpg" >/dev/null
  n=$(size_of "$SRC/$stage")
  ph=$((n * 10 / 33))
  sips -s format jpeg -s formatOptions 85 -c $ph $((ph * 980 / 464)) "$SRC/$stage" --out "$OUT/$id-preview.jpg" >/dev/null
  sips -z 928 1960 "$OUT/$id-preview.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 85 -Z 1200 "$SRC/$stage" --out "$OUT/$id-frame.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 92 "$SRC/$stage" --out "$OUT/$id-stage.jpg" >/dev/null
  # 원본 크기는 Edit panel 표기용
  MANIFEST="$MANIFEST${MANIFEST:+,}
  { \"id\": \"$id\", \"w\": $(size_of "$SRC/$stage"), \"h\": $(height_of "$SRC/$stage") }"
  echo "baked $id"
}

# 팔레트에는 제품이 있는 컷, 캔버스에는 제품을 얹을 빈 무대(-no product)를 보여준다.
# source/ 는 라인(폴더)별로 나뉘고, 파일명 순서가 팔레트 순서다. id = b<라인>-<파일명>
#   basic 01 — 단상이 둥근 컷: 01-01 TV · 02-01 TV+구형 · 03-01 냉장고 · 04-02 냉장고+구형
#   basic 02 — 흰 계단 단상 컷: 01-0N TV · 02-0N 냉장고
# 냉장고처럼 키 큰 제품이 있는 컷과 basic 02(피사체가 위로 높다)는 타일을 넓게(70%) 잘라야 위가 안 잘린다
# 사용법: bake_set <그 톤의 source 하위 폴더> [id 끝붙이]
bake_set() {
  dir=$1; t=${2:-}
  bake b1-01-01$t "$dir/basic 01/01-01.png" "$dir/basic 01/01-01-no product.png"
  bake b1-02-01$t "$dir/basic 01/02-01.png" "$dir/basic 01/02-01-no product.png"
  bake b1-03-01$t "$dir/basic 01/03-01.png" "$dir/basic 01/03-01-no product.png" 70
  bake b1-04-02$t "$dir/basic 01/04-02.png" "$dir/basic 01/04-02-no product.png" 70
  bake b2-01-01$t "$dir/basic 02/01-01.png" "$dir/basic 02/01-01-no product.png" 70
  bake b2-01-02$t "$dir/basic 02/01-02.png" "$dir/basic 02/01-02-no product.png" 70
  bake b2-02-01$t "$dir/basic 02/02-01.png" "$dir/basic 02/02-01-no product.png" 70
  bake b2-02-02$t "$dir/basic 02/02-02.png" "$dir/basic 02/02-02-no product.png" 70
}

# 가로형 완성 배너 (Product Type) — 정사각 무대가 아니라 잘라 보이지 않는다. 제품 없는 컷이 따로 없어 한 장으로 다 굽는다
#   thumb : 가운데를 140:64 로 잘라 280×128 / preview·stage : 원본 그대로 / frame : 긴 변 1200
# 사용법: bake_full <id> <원본>
bake_full() {
  id=$1; src=$2
  if [ ! -f "$SRC/$src" ]; then
    keep_baked "$id" "$src"
    return 0
  fi
  w=$(size_of "$SRC/$src"); h=$(height_of "$SRC/$src")
  tw=$((h * 140 / 64)); th=$h
  if [ $tw -gt $w ]; then tw=$w; th=$((w * 64 / 140)); fi
  sips -s format jpeg -s formatOptions 85 -c $th $tw "$SRC/$src" --out "$OUT/$id-thumb.jpg" >/dev/null
  sips -z 128 280 "$OUT/$id-thumb.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 85 "$SRC/$src" --out "$OUT/$id-preview.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 85 -Z 1200 "$SRC/$src" --out "$OUT/$id-frame.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 92 "$SRC/$src" --out "$OUT/$id-stage.jpg" >/dev/null
  MANIFEST="$MANIFEST${MANIFEST:+,}
  { \"id\": \"$id\", \"w\": $w, \"h\": $h }"
  echo "baked $id"
}

# Main Theme KV (정사각 3000²) — 팔레트에는 글자 있는 컷, 캔버스·Edit panel 에는 글자 없는 컷(그 위에 Text 로 쓴다)
#   thumb : 캔버스 미리보기 창(view) 가운데를 같은 높이로 1200:718 로 잘라 280×168 — builder-app.js 의 view 와 맞춘다
#           x 0.319 · y 0.338 · 가로 0.379 · 세로 0.2266 (원본 한 변 대비)
#   바탕  : 원본 그대로 jpg (Edit panel 은 전체, 다운로드가 이 크기로 나간다)
# 사용법: bake_kv <톤> → source/main theme/{text,notext}/kv-<톤>.png → image/kv-<톤>{,-thumb}.jpg
bake_kv() {
  tone=$1; text="$SRC/main theme/text/kv-$tone.png"; plain="$SRC/main theme/notext/kv-$tone.png"
  if [ ! -f "$text" ] || [ ! -f "$plain" ]; then
    echo "  - main theme kv-$tone 없음 — 빈 박스"
    return 0
  fi
  mkdir -p "$OUT/image"
  n=$(size_of "$text")
  # 팔레트 썸네일은 빌더 기본 글자로 그린 것 (scripts/kv-thumbs.mjs) — 이미 있으면 원본의 글자로 덮어쓰지 않는다
  if [ ! -f "$OUT/image/kv-$tone-thumb.jpg" ]; then
    sips -s format jpeg -s formatOptions 85 -c $((n * 2266 / 10000)) $((n * 379 / 1000)) \
      --cropOffset $((n * 338 / 1000)) $((n * 319 / 1000)) "$text" --out "$OUT/image/kv-$tone-thumb.jpg" >/dev/null
    sips -z 168 280 "$OUT/image/kv-$tone-thumb.jpg" >/dev/null
  fi
  sips -s format jpeg -s formatOptions 90 "$plain" --out "$OUT/image/kv-$tone.jpg" >/dev/null
  echo "baked main theme kv-$tone ($(size_of "$plain") × $(height_of "$plain"))"
}

bake_kv light
bake_kv dark

# 정사각 무대 + 줌 창 (Product Type) — 캔버스 미리보기는 창(2:1), 팔레트 타일은 그 가운데를 같은 높이로 1200:718. builder-app.js 의 view 와 맞춘다
#   thumb : 타일용 원본(제품 있는 컷)을 타일 창으로 잘라 280×168 / preview : 무대(제품 없는 컷)를 창으로 잘라 원래 크기 그대로
#   frame : Edit panel 정사각 전체 1200 / stage : 합성 바탕 원본 그대로
# 사용법: bake_view <id> <타일용 원본> <무대 원본> <x> <y> <w> <h>  (미리보기 창 = 원본 한 변 대비 만분율)
bake_view() {
  id=$1; tile=$2; stage=$3; vx=$4; vy=$5; vw=$6; vh=$7
  if [ ! -f "$SRC/$tile" ] || [ ! -f "$SRC/$stage" ]; then
    keep_baked "$id" "$stage"
    return 0
  fi
  n=$(size_of "$SRC/$stage")
  crop="-c $((n * vh / 10000)) $((n * vw / 10000)) --cropOffset $((n * vy / 10000)) $((n * vx / 10000))"
  tw=$((vh * 1200 / 718))
  sips -s format jpeg -s formatOptions 85 -c $((n * vh / 10000)) $((n * tw / 10000)) \
    --cropOffset $((n * vy / 10000)) $((n * (vx + (vw - tw) / 2) / 10000)) "$SRC/$tile" --out "$OUT/$id-thumb.jpg" >/dev/null
  sips -z 168 280 "$OUT/$id-thumb.jpg" >/dev/null
  # 창이 원본에서 1000px 남짓이라 키우면 jpg 를 두 번 굽게 되어 더 뭉개진다 — 잘라 낸 크기 그대로
  sips -s format jpeg -s formatOptions 92 $crop "$SRC/$stage" --out "$OUT/$id-preview.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 85 -Z 1200 "$SRC/$stage" --out "$OUT/$id-frame.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 92 "$SRC/$stage" --out "$OUT/$id-stage.jpg" >/dev/null
  MANIFEST="$MANIFEST${MANIFEST:+,}
  { \"id\": \"$id\", \"w\": $n, \"h\": $(height_of "$SRC/$stage") }"
  echo "baked $id"
}

# 합성 예시 컷 — 캔버스 미리보기 오른쪽 위 토글(Product / Object)로 띄운다. 미리보기와 같은 창으로 잘라 그대로 겹친다
# 사용법: bake_example <id> <이름> <원본> <x> <y> <w> <h> → <id>-ex-<이름>.jpg (+ -frame.jpg)
bake_example() {
  id=$1; name=$2; src=$3; vx=$4; vy=$5; vw=$6; vh=$7
  if [ ! -f "$SRC/$src" ]; then
    echo "  - $src 없음 — $id 의 $name 예시 없음"
    return 0
  fi
  n=$(size_of "$SRC/$src")
  sips -s format jpeg -s formatOptions 92 -c $((n * vh / 10000)) $((n * vw / 10000)) \
    --cropOffset $((n * vy / 10000)) $((n * vx / 10000)) "$SRC/$src" --out "$OUT/$id-ex-$name.jpg" >/dev/null
  # Edit panel 정사각 전체 프레임 — 토글을 켜면 패널 그림도 이걸로 바뀐다
  sips -s format jpeg -s formatOptions 85 -Z 1200 "$SRC/$src" --out "$OUT/$id-ex-$name-frame.jpg" >/dev/null
  echo "baked $id-ex-$name"
}

# Product Type — source/product type/{product,noproduct,object}/<…>-<톤>.png. 창은 선물 트리 + 제품 전체가 들어오게
#   예시: product = 제품 있는 컷(타일과 같은 원본), object = 오브젝트를 얹은 컷
bake_view pt-01 "product type/product/product-light.png" "product type/noproduct/product-light.png" 3016 3700 4068 2034
bake_view pt-01-dark "product type/product/product-dark.png" "product type/noproduct/product-dark.png" 3016 3700 4068 2034
for tone in light dark; do
  id=pt-01; [ $tone = dark ] && id=pt-01-dark
  bake_example $id product "product type/product/product-$tone.png" 3016 3700 4068 2034
  bake_example $id object "product type/object/object-$tone.png" 3016 3700 4068 2034
done

bake_set "."
bake_set "dark" -dark

# 오브젝트 PNG (Product & Object 의 Object 목록) — source/obect/*.png 를 긴 변 800 투명 PNG 로. 목록·크기는 builder-app.js 의 OBJECTS
if [ -d "$SRC/obect" ]; then
  mkdir -p "$OUT/object"
  for f in "$SRC"/obect/*.png; do
    [ -f "$f" ] || continue
    sips -Z 800 "$f" --out "$OUT/object/$(basename "$f")" >/dev/null
    echo "baked object $(basename "$f")"
  done
fi

# Product 예시 제품 PNG — source/{tv,wm,ac,ref}.png 를 긴 변 1200 투명 PNG 로. 자리는 builder-app.js 의 PRODUCT_EXAMPLE
mkdir -p "$OUT/product"
for n in tv wm ac ref; do
  [ -f "$SRC/$n.png" ] || continue
  # 1200 보다 작으면 키우지 않고 그대로
  if [ "$(size_of "$SRC/$n.png")" -gt 1200 ] || [ "$(height_of "$SRC/$n.png")" -gt 1200 ]; then
    sips -Z 1200 "$SRC/$n.png" --out "$OUT/product/$n.png" >/dev/null
  else
    cp "$SRC/$n.png" "$OUT/product/$n.png"
  fi
  echo "baked product $n.png"
done

printf '[%s\n]\n' "$MANIFEST" > "$OUT/manifest.json"
echo "manifest: $OUT/manifest.json"
