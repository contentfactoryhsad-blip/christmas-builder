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

# 사용법: bake <id> <타일용 원본> <캔버스·패널용 원본> [타일 가로 비율 %, 기본 52]
# 빈 무대(_no product)가 아직 없으면 타일용 원본으로 대신 굽고 경고만 남긴다 — 들어오면 다시 돌리면 된다
bake() {
  id=$1; tile=$2; stage=$3; tw=${4:-52}
  if [ ! -f "$SRC/$tile" ]; then
    echo "  - $tile 없음 — $id 는 빈 박스"
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
    echo "  - $src 없음 — $id 는 빈 박스"
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

bake_full pt-01 "product type/pt-01.png"
bake_full pt-01-dark "dark/product type/pt-01.png"

bake_set "."
bake_set "dark" -dark

printf '[%s\n]\n' "$MANIFEST" > "$OUT/manifest.json"
echo "manifest: $OUT/manifest.json"
