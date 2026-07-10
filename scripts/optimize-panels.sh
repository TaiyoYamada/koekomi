#!/bin/bash
# パネル画像を Web 表示向けに整える。
#   1. CMYK(4ch) JPEG は sRGB に変換する（544KB の印刷用 ICC が剥がれ、ブラウザでの色化けも防ぐ）
#   2. 長辺が 1280px を超えるものだけ縮小する（拡大はしない）
#   3. 上記のどちらかに該当したものだけ品質 82 で再エンコードする
# 縦横比は変えない（Editor の focusY で見せたい位置を調整できる自由度を残すため）。
set -euo pipefail

DIR="${1:?usage: optimize.sh <panels-dir>}"
MAX=1280
QUALITY=82
SRGB="/System/Library/ColorSync/Profiles/sRGB Profile.icc"

printf "%-30s %9s %9s %8s  %s\n" "FILE" "BEFORE" "AFTER" "SAVED" "ACTION"
printf -- "%.0s-" {1..76}; echo

total_before=0; total_after=0

for f in "$DIR"/*.jpg "$DIR"/*.jpeg; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  before=$(stat -f%z "$f")

  w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  long=$(( w > h ? w : h ))
  # components 4 == CMYK/YCCK
  is_cmyk=$(file "$f" | grep -c "components 4" || true)

  actions=()
  [ "$is_cmyk" -gt 0 ] && actions+=("CMYK→sRGB")
  [ "$long" -gt "$MAX" ] && actions+=("${long}px→${MAX}px")

  if [ ${#actions[@]} -eq 0 ]; then
    total_before=$((total_before + before)); total_after=$((total_after + before))
    printf "%-30s %8sK %8sK %8s  %s\n" "$name" "$((before/1024))" "$((before/1024))" "-" "そのまま"
    continue
  fi

  cp "$f" "$f.orig"
  [ "$is_cmyk" -gt 0 ] && sips --matchTo "$SRGB" "$f" >/dev/null 2>&1
  [ "$long" -gt "$MAX" ] && sips --resampleHeightWidthMax "$MAX" "$f" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions "$QUALITY" "$f" --out "$f" >/dev/null 2>&1

  after=$(stat -f%z "$f")
  # 縮小しても太るなら元のほうが良い（元が既に強く圧縮されている）。CMYK は色の都合で必ず変換する。
  if [ "$after" -ge "$before" ] && [ "$is_cmyk" -eq 0 ]; then
    mv "$f.orig" "$f"
    total_before=$((total_before + before)); total_after=$((total_after + before))
    printf "%-30s %8sK %8sK %8s  %s\n" "$name" "$((before/1024))" "$((before/1024))" "-" "そのまま(再圧縮すると増える)"
    continue
  fi
  rm -f "$f.orig"
  total_before=$((total_before + before)); total_after=$((total_after + after))
  saved=$(( 100 - after * 100 / before ))
  printf "%-30s %8sK %8sK %7s%%  %s\n" "$name" "$((before/1024))" "$((after/1024))" "$saved" "$(IFS=', '; echo "${actions[*]}")"
done

echo
printf "合計: %sK -> %sK (%s%% 削減)\n" \
  "$((total_before/1024))" "$((total_after/1024))" "$(( 100 - total_after * 100 / total_before ))"
