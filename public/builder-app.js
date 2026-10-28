/**
 * Christmas Builder.
 *
 * BF Content Banner Builder 와 같은 흐름: 왼쪽 팔레트에서 에셋 하나를 고르면
 * 캔버스가 미리보기를, Edit panel 이 원본 프레임과 편집 항목을 보여준다.
 * 아트가 없는 에셋(`art: null`)은 빈 박스로 남는다. 아트는 원본을 그대로 쓰지
 * 않고 scripts/build-assets.sh 가 구운 thumb / preview / frame / stage 를 쓴다.
 *
 * Product & Shadow — studio.html(studio-app.js)의 제품 가져오기·배치·그림자를 옮겨 왔다.
 *   합성은 stage(원본 해상도)에 그리고, 캔버스에는 그중 미리보기 창(PREVIEW_ZOOM)만 보인다.
 *   Edit panel 프레임과 PNG 다운로드는 정사각 전체다. 셋 다 같은 #comp 캔버스에서 나온다.
 * Scene Color — studio.html 의 Color mood 를 옮겨 왔다. 화면은 바꾸지 않는다:
 *   제품 사진 속 영역(1: 화면 클릭 자동 감지 / 2: 네 점 직접 지정)을 잘라 그 색으로 배경을 물들인다.
 *   그리는 순서 (화면과 다운로드가 같은 paint() 를 쓴다):
 *     물든 배경 → 화면 빛 번짐 → (제품마다) 그림자 → 제품
 *   영역 네 모서리는 제품 사각형 기준(0~1)으로 저장해서 제품을 옮기거나 키워도 따라간다.
 */

import { blobToDataUrl, loadImage, trimTransparent } from './lib/productApi.js';
import { importFromUrl, importFromFile, editProduct } from './lib/productImportFlow.js';
import { DEFAULT_FX, cloneFx, createBackground, drawComposite } from './lib/composite.js';
import { newCopyState, renderCopyPanel, bindCopyPanel } from './lib/channelCopy.js';
import { slotsForChannel, drawSlot, logosReady } from './lib/channelSlots.js';
import { orderQuad, warpInfill, colorField, detectObjects, adjustBackground, glowLayer } from './lib/infill.js';

/**
 * 팔레트 줄 — id 는 파일명 stem (예 b1-01-01), Dark 톤이면 끝에 -dark.
 * scripts/build-assets.sh 의 bake 목록과 맞춘다. 그림이 있는지·원본 크기는 그 스크립트가
 * 쓴 manifest.json 에서 읽는다 — 원본을 넣고 스크립트만 돌리면 박스가 채워진다.
 *   stage = 제품을 처음 놓을 자리, 배경 대비 비율 — cx: 가로 중심, bottom: 발끝(바닥선), h: 제품 높이.
 *           01·02 는 제품 있는 컷과 없는 컷의 차이로 원래 TV 자리를 쟀고, 03·04 는 냉장고 자리를 눈으로 쟀다.
 */
const ASSET_GROUPS = [
  // Main Theme — 가운데 선물 트리 KV 한 장 + 그 위에 쓰는 텍스트. 제품 합성이 아니라 Edit panel 의 Text 로 글자를 고쳐 쓴다.
  // 팔레트 타일(thumb)은 글자 있는 컷, 캔버스·다운로드 바탕(src)은 글자 없는 컷 — build-assets.sh 의 bake_kv
  // 기본 글자 자리·크기는 글자 있는/없는 컷 차이로 쟀다. Dark 톤 컷은 banner.dark: { src, thumb, w, h }
  // view: 캔버스 미리보기 창 — 가운데 선물 트리를 줌한 2:1 (바탕 대비 0~1). 팔레트 타일은 그 가운데를 1200:718 로 (bake_kv 의 thumb).
  //       Edit panel 은 3000×3000 전체를 보여 준다
  { key: 'main-theme', label: 'Main Theme', assets: [
    { id: 'kv-01', label: 'Main Theme', view: { x: 0.2819, y: 0.338, w: 0.4532, h: 0.2266 },
      banner: { src: 'image/kv-light.jpg', thumb: 'image/kv-light-thumb.jpg', w: 3000, h: 3000,
        dark: { src: 'image/kv-dark.jpg', thumb: 'image/kv-dark-thumb.jpg', w: 3000, h: 3000 } },
      text: { value: 'Christmas', font: 'benton', style: 'cream', x: 0.523, y: 0.448, size: 4.2, width: 116, spacing: 0, depth: 48, shadow: 100, rotate: -8.5, slant: 7 } },
  ] },
  // Product Type — 제품을 얹는 바탕 컷. 캡션 = 파일명.
  // full: 가로형 완성 배너 — 가운데를 잘라 보이지 않고 한 장 전체를 원래 비율로 보여 준다 (build-assets.sh 의 bake_full)
  // view: 캔버스 미리보기 창 (Main Theme 과 같은 2:1 줌, build-assets.sh 의 bake_view 와 맞춘다). 타일은 그 가운데 1200:718
  { key: 'product-type', label: 'Product Type', assets: [
    // 선물 상자 트리 위 제품 3종 컷 — 타일은 제품 있는 컷, 캔버스는 제품 없는 컷.
    // 처음 놓을 자리는 제품 있는/없는 컷 차이(가로 0.40~0.58, 바닥 0.538)의 가운데 TV 자리로 잡았다
    // examples: 미리보기 오른쪽 위 토글로 띄우는 합성 예시 (build-assets.sh 의 bake_example → <id>-ex-<key>.jpg)
    { id: 'pt-01', label: 'Product Type', examples: ['product', 'object'], view: { x: 0.3016, y: 0.37, w: 0.4068, h: 0.2034 }, stage: { cx: 0.5, bottom: 0.538, h: 0.08 } },
  ] },
];

/**
 * 잠시 내려 둔 Product Type 컷 (basic 01·02 정사각 무대) — 우선 배너 한 장만 쓴다. 다시 쓸 때 위 assets 로 옮기면 된다 (구운 에셋은 그대로 있다).
 *   basic 01 둥근 단상 — 02-01 TV+구형 · 03-01 냉장고 · 04-02 냉장고+구형 (03·04 는 냉장고 자리를 눈으로 쟀다)
 *   basic 02 흰 계단 단상 — 01-0N TV · 02-0N 냉장고. 빈 무대 컷이 아직 없어 자리는 눈으로 쟀다
 */
const PARKED_PRODUCT_TYPES = [
  // basic 01 둥근 단상 TV — 제품 있는/없는 컷 차이로 원래 TV 자리를 쟀다
  { id: 'b1-01-01', label: 'B1 01-01', stage: { cx: 0.461, bottom: 0.52, h: 0.098 } },
  { id: 'b1-02-01', label: 'B1 02-01', stage: { cx: 0.517, bottom: 0.48, h: 0.072 } },
  { id: 'b1-03-01', label: 'B1 03-01', stage: { cx: 0.462, bottom: 0.546, h: 0.184 } },
  { id: 'b1-04-02', label: 'B1 04-02', stage: { cx: 0.518, bottom: 0.536, h: 0.17 } },
  { id: 'b2-01-01', label: 'B2 01-01', stage: { cx: 0.537, bottom: 0.452, h: 0.068 } },
  { id: 'b2-01-02', label: 'B2 01-02', stage: { cx: 0.567, bottom: 0.452, h: 0.068 } },
  { id: 'b2-02-01', label: 'B2 02-01', stage: { cx: 0.543, bottom: 0.5, h: 0.136 } },
  { id: 'b2-02-02', label: 'B2 02-02', stage: { cx: 0.563, bottom: 0.5, h: 0.136 } },
];

/** manifest.json — 구워 둔 에셋 id → 원본 크기. 없으면 그 박스는 빈 박스. */
let manifest = new Map();

/**
 * 톤 — 팔레트에서 에셋마다 Light 칸과 Dark 칸이 나란히 놓인다 (캡션 = 톤 아이콘 + 이름).
 * Dark 에셋 id 는 끝에 -dark (build-assets.sh 와 맞춘다). 아직 없으면 빈 칸으로 자리만 잡아 둔다.
 */
const TONES = [
  { key: 'light', label: 'Light', icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
  { key: 'dark', label: 'Dark', icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>' },
];
const toneOf = key => TONES.find(t => t.key === key);

/** 팔레트 줄 — 에셋마다 Light·Dark 두 칸으로 펴고, 톤 id, 그림 유무, 원본 크기를 입힌다. */
const groupsFor = () => ASSET_GROUPS.map(g => ({
  ...g,
  assets: g.assets.flatMap(a => TONES.map(({ key: tone }) => {
    const id = `${a.id}${tone === 'dark' ? '-dark' : ''}`;
    const base = { ...a, base: a.id, id, tone };
    // 배너 컷은 굽지 않고 원본 한 장을 그대로 쓴다 — Dark 컷이 아직 없으면 빈 박스
    if (a.banner) {
      const banner = tone === 'dark' ? a.banner.dark : a.banner;
      if (!banner) return { ...base, banner: undefined, art: false, size: null };
      return { ...base, banner, art: true, size: [banner.w, banner.h] };
    }
    const m = manifest.get(id);
    return { ...base, art: !!m, size: m ? [m.w, m.h] : null };
  })),
}));

const ASSET_DIR = 'assets/christmas';
/** 줌 컷의 팔레트 타일 비율 — 미리보기 창(view) 가운데를 같은 높이로 자른다 */
const TILE_RATIO = 1200 / 718;
/** view 창의 가로:세로 (픽셀 기준) — 없으면 바탕 전체 */
const viewRatio = a => {
  const [w, h] = a.banner ? [a.banner.w, a.banner.h] : a.size || [1, 1];
  return a.view ? (a.view.w * w) / (a.view.h * h) : w / h;
};
const thumbUrl = a => (a.banner ? `${ASSET_DIR}/${a.banner.thumb}` : `${ASSET_DIR}/${a.id}-thumb.jpg`);
const previewUrl = a => `${ASSET_DIR}/${a.id}-preview.jpg`;
const frameUrl = a => `${ASSET_DIR}/${a.id}-frame.jpg`;
const stageUrl = a => `${ASSET_DIR}/${a.id}-stage.jpg`;
const exampleUrl = (a, key) => `${ASSET_DIR}/${a.id}-ex-${key}.jpg`;
/** 합성 예시 토글 — 베이스에 제품·오브젝트를 어떻게 얹는지 보여 주는 완성 컷 */
const EXAMPLE_LABEL = { product: 'Product', object: 'Object' };

/** 캔버스 미리보기 창 — 980:464 박스에 원본 높이의 1/3.3 (build-assets.sh 의 preview 와 같은 값). */
const PREVIEW_ZOOM = 3.3;
const PREVIEW_RATIO = 980 / 464;
const MAX_PRODUCTS = 6;
const MAX_OBJECTS = 6;
/** 제품마다 손잡이·탭 색 — 여러 개를 놓아도 어느 게 몇 번인지 보이게 (studio 와 같은 순서) */
const COLORS = ['#FD312E', '#2F6FE4', '#1F9D6B', '#8A5CF6', '#F08C00', '#0E9AAE'];
const colorOf = i => COLORS[i % COLORS.length];

/** 슬롯 종류별 번호 — 탭·목록·문구는 Product 1, 2… / Object 1, 2… 로 따로 센다 */
const KIND_LABEL = { product: 'Product', object: 'Object' };
const slotsOf = kind => state.slots.map((s, i) => (s.kind === kind ? i : -1)).filter(i => i >= 0);
const kindNo = i => slotsOf(state.slots[i].kind).indexOf(i) + 1;
const slotLabel = i => `${KIND_LABEL[state.slots[i].kind]} ${kindNo(i)}`;

/** 매체 — 두 줄로 놓는다: 윗줄 ALL·LG.com·주요 매체, 아랫줄 제휴 매체 (ALL = 전부). 사이즈 정의는 아직 없다 */
const CHANNEL_ROWS = [
  ['ALL', 'LG.com', 'Criteo', 'DV360', 'Pmax', 'META', 'Google SEM', 'Twitch', 'Quantcast', 'ECRM'],
  ['Rakuten', 'Venngo', 'Perkopolis', 'Awin', 'Data Audience', 'Vase kupony', 'Plna penezenka', 'Tipli', 'Taiwan Affiliate', 'Telus Health'],
].map(row => row.map(label => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label })));

/** 상단 스텝 — 누르면 그 화면으로 간다. 매체를 고르면 Edit(4) 로 넘어가고, Edit 은 매체를 고른 뒤에만 누를 수 있다 */
const STEPS = ['Select Visual Type', 'Image Edit', 'Select Channel', 'Edit'];
const STEP_READY = [true, true, true, true];

/**
 * 오브젝트 — 고르면 오브젝트 슬롯(kind: 'object')이 하나 생겨서 제품과 똑같이 옮기고·키우고·그림자를 준다.
 * 제품 링크·업로드는 제품 슬롯 전용이다.
 * 크리스마스 오브젝트 — source/obect/*.png 를 build-assets.sh 가 긴 변 800 으로 줄여 assets/christmas/object/ 에 둔다.
 *   scale: 처음 놓을 크기 — 제품 자리 높이(stage.h) 대비. 오브젝트 예시 컷(object-light.png)에 놓인 크기로 쟀다
 */
const OBJECTS = [
  { id: 'soldier-toy', label: 'Soldier toy', src: 'object/soldier-toy.png', scale: 0.75 },
  { id: 'drum', label: 'Drum', src: 'object/drum.png', scale: 0.67 },
  { id: 'calligraphy', label: 'Calligraphy', src: 'object/calligraphy.png', scale: 0.45 },
  { id: 'ornament1', label: 'Ornament 1', src: 'object/ornament1.png', scale: 0.4 },
  { id: 'ornament2', label: 'Ornament 2', src: 'object/ornament2.png', scale: 0.4 },
  { id: 'ornament3', label: 'Ornament 3', src: 'object/ornament3.png', scale: 0.4 },
];

const findAsset = id => {
  if (!id) return null;
  for (const g of groupsFor()) {
    const a = g.assets.find(x => x.id === id);
    if (a) return { asset: a, group: g };
  }
  return null;
};

/** 늘 펼쳐 두는 박스 — Main Theme 의 Text, Product Type 의 Product & Object. 머리를 눌러도 접히지 않는다 */
const PINNED = new Set(['text', 'product']);

/** Edit panel 의 접이식 기능 박스. */
const EDIT_SECTIONS = [
  { key: 'product', title: 'Product & Object', desc: 'Import products, pick objects, place them on the stage and add a ground shadow.' },
  // 숨김 — 크리스마스는 제품·오브젝트 합성만 쓴다. 기능 코드는 그대로 두었다 (hidden 을 지우면 다시 보인다)
  { key: 'scene', hidden: true, title: 'Scene Color', badge: '보류중 - 배경 컬러 선택방식으로 교체중', desc: 'Fill the TV screen and tint the background to match it.' },
];

/** 배너 컷의 Edit panel — 텍스트 하나만 다룬다. */
const BANNER_SECTIONS = [
  { key: 'text', title: 'Text', desc: 'Write your own headline on the visual — font, color, depth and angle.' },
];

/**
 * 텍스트 글꼴 — Google Fonts·Adobe Fonts 에서 읽는다 (builder.html). 종류마다 한 벌씩만, 목록에는 이름만 보인다.
 * style·weight 는 캔버스 font 문자열에 그대로 들어간다.
 * 맨 위 Benton Modern Display 가 메인 (Adobe Fonts 웹 프로젝트 xum4tfv)
 */
const FONTS = [
  // 포토샵 이름 'Benton Modern D XCn Light Italic' = 웹 키트의 benton-modern-display-extra italic 400
  { key: 'benton', label: 'Benton Modern', family: 'benton-modern-display-extra', style: 'italic', weight: 400 },
  // LG EI Headline Semibold — style.css 의 @font-face (fonts/LGEIHeadlineTTF-Semibold.ttf, 다른 빌더와 같은 파일)
  { key: 'lg-headline', label: 'LG EI Headline', family: 'LGEI Headline', style: 'normal', weight: 600 },
  { key: 'playfair', label: 'Playfair Display', family: 'Playfair Display', style: 'italic', weight: 400 },
  { key: 'cormorant', label: 'Cormorant Garamond', family: 'Cormorant Garamond', style: 'italic', weight: 700 },
  { key: 'vibes', label: 'Great Vibes', family: 'Great Vibes', style: 'normal', weight: 400 },
  { key: 'dancing', label: 'Dancing Script', family: 'Dancing Script', style: 'normal', weight: 700 },
  { key: 'cinzel', label: 'Cinzel', family: 'Cinzel', style: 'normal', weight: 700 },
  { key: 'montserrat', label: 'Montserrat', family: 'Montserrat', style: 'normal', weight: 800 },
];
const fontOf = t => FONTS.find(f => f.key === t.font) || FONTS[0];
const fontSpec = (t, px) => { const f = fontOf(t); return `${f.style} ${f.weight} ${px}px "${f.family}"`; };

/**
 * 글자 색 — 앞면은 위(밝음) → 아래(어두움) 그라데이션, 두께(Depth)는 side 색으로 겹쳐 쌓는다.
 * custom 은 고른 색 하나에서 밝기만 바꿔 만든다.
 */
const TEXT_STYLES = [
  { key: 'gold', label: 'Gold', face: ['#FFF4D8', '#EFD29A', '#C3924F'], side: '#8C6232' },
  { key: 'cream', label: 'Cream', face: ['#FFFBF3', '#F3E5CF', '#D9C2A0'], side: '#A88B64' },
  { key: 'white', label: 'White', face: ['#FFFFFF', '#F4F4F4', '#D9D9D9'], side: '#9E9E9E' },
  { key: 'red', label: 'Red', face: ['#F2545A', '#D3232B', '#9E0F18'], side: '#5E0A0F' },
  { key: 'green', label: 'Green', face: ['#4F9A7A', '#2E6E55', '#1D4D3B'], side: '#11301F' },
];

/** 16진 색의 밝기를 k 만큼 옮긴다 (-1 검정 ~ 1 흰색) */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k));
  return `#${ch.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}
function textColors(t) {
  if (t.style !== 'custom') return TEXT_STYLES.find(s => s.key === t.style) || TEXT_STYLES[0];
  return { face: [shade(t.color, 0.45), t.color, shade(t.color, -0.25)], side: shade(t.color, -0.55) };
}

/**
 * 배너 텍스트 기본값 — x, y: 글자 가운데 (바탕 대비 0~1), size: 글자 크기 (바탕 높이의 %), width: 글자 폭 (%, 100 = 원래),
 * rotate·slant: 도, spacing: 글자 사이 (크기의 %), depth: 입체 두께, shadow: 아래 그림자 (0~100)
 */
const newText = asset => ({
  value: 'Text', font: 'benton', style: 'gold', color: '#C8A062',
  x: 0.5, y: 0.5, size: 18, width: 100, rotate: 0, slant: 0, spacing: 0, depth: 45, shadow: 40,
  ...asset.text,
});

/**
 * 슬롯 — 제품 하나 또는 오브젝트 하나. 위치는 배경 대비 비율(dx, dy)로 들고 있어서 다른 에셋으로 바꿔도 자리가 이어진다.
 * eraser 만 배경 픽셀 좌표라 에셋을 바꾸면 버린다. i 는 같은 종류 안에서 몇 번째인지 (놓을 자리를 비키는 데 쓴다).
 * 그리는 순서는 state.slots 순서 그대로 — 제품·오브젝트가 섞여 있다.
 */
const newSlot = (i, kind = 'product') => ({
  kind,            // 'product' (링크·업로드) | 'object' (OBJECTS 에서 고름)
  object: null,    // 오브젝트 슬롯이면 OBJECTS 항목
  product: null,   // ProductImage (productImportFlow.js) + img — 오브젝트도 같은 모양으로 담는다
  url: '',
  // 둘째부터는 좌우로 번갈아 비켜 놓는다 — 한자리에 겹쳐 나오면 뒤엣것을 못 찾는다
  place: { scale: 1, dx: i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.1 : 0, dy: 0 },
  fx: cloneFx(DEFAULT_FX),
  eraser: null,
  // 색 소스 영역. quadN: 제품 사각형 기준 0~1 네 점, infill: 그 영역을 제품 사진에서 펴서 잘라낸 것,
  // method: 1(화면 클릭 자동 감지) | 2(네 점 직접) — 패널에서 어느 카드에 불을 켤지
  screen: { quadN: null, infill: null, infillId: 0, method: null },
});

/**
 * open    : 펼쳐진 기능 박스 key — 둘 다 동시에 열어둘 수 있다.
 * bg      : 지금 에셋의 합성 바탕 { assetId, id, w, h, px, scene }
 *           px: createBackground() 결과, scene: 색 보정이 읽는 형태 (infill.js readImage 와 같은 모양)
 * active  : Placement · Shadow · Screen 이 다루는 슬롯
 * picking : 화면 모서리를 찍는 중인 슬롯 번호, pickPts: 찍은 점 (배경 좌표)
 * objects : 배경 속 오브젝트(단상·소품) 마스크 캔버스 — 알파 = 오브젝트. 에셋을 고를 때 자동 감지하고,
 *           Object tint 만큼만 물든다 (손으로 고치는 브러시는 뺐다)
 * 색 소스 화면 영역은 한 번에 하나 — 다른 제품에서 고르면 이전 것은 지운다
 */
const state = {
  selectedId: null,
  example: null, // 미리보기에 띄운 합성 예시 'product' | 'object' — null 이면 편집 중인 합성
  channel: null, // 고른 매체 key (CHANNEL_ROWS) — 한 번 더 누르면 해제
  step: 0, // 상단 스텝 (0 부터) — 에셋을 고르면 1, 매체를 고르면 2
  copy: newCopyState(), // 매체를 고르면 Edit panel 에 뜨는 Copy 값 (lib/channelCopy.js) — 매체를 바꿔도 이어진다
  open: new Set(),
  bg: null,
  slots: [newSlot(0)],
  active: 0,
  erasing: false,
  eraseMode: 'erase',
  eraseSize: 40,
  picking: null,
  pickPts: [],
  sampling: false, // 제품 화면을 클릭해 색 소스로 잡는 중
  mood: { on: true, strength: 60, vivid: 30, objectAmount: 15, glow: 25, centerClear: 50, floorAmount: 30 },
  objects: null,
  objVersion: 0,
  banner: null, // 배너 컷 바탕 { assetId, img, w, h }
  texts: {},    // 배너 에셋 id(톤 끝붙이 없는) → 텍스트 설정. 다른 컷을 보고 와도 남아 있다
};

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const IMAGE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
const CHEVRON = '<svg class="tb-acc-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

/** where: 'product' | 'object' | 'scene' — 메시지는 그 칸 아래에 뜬다 */
function setStatus(msg, isError = false, where = 'product') {
  const el = $({ scene: '#sceneStatus', object: '#objectStatus' }[where] || '#status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', isError);
}

// ── 배치 계산 ─────────────────────────────────────────────

/**
 * 제품이 놓일 사각형 (배경 픽셀). 발끝을 바닥선에 맞추고 가로 중심에 세운다.
 * 크기를 바꾸면 발끝이 그대로인 채 커지고 작아진다 — 단상 위에 선 채로.
 */
function productRect(slot) {
  const hit = findAsset(state.selectedId);
  if (!state.bg || !slot.product || !hit?.asset.stage) return null;
  const { w: W, h: H } = state.bg;
  const st = hit.asset.stage;
  const h = st.h * H * slot.place.scale;
  const w = h * (slot.product.w / slot.product.h);
  const cx = (st.cx + slot.place.dx) * W;
  const bottom = (st.bottom + slot.place.dy) * H;
  return { x: cx - w / 2, y: bottom - h, w, h };
}

/** 미리보기 창 (배경 픽셀) — 가운데에서 원본 높이의 1/PREVIEW_ZOOM. view 가 있으면 그 창, full 컷은 한 장 전체. */
function previewWindow() {
  const { w, h } = state.bg;
  const asset = findAsset(state.selectedId)?.asset;
  if (asset?.view) return { x: asset.view.x * w, y: asset.view.y * h, w: asset.view.w * w, h: asset.view.h * h };
  if (asset?.full) return { x: 0, y: 0, w, h };
  const ch = h / PREVIEW_ZOOM;
  const cw = Math.min(w, ch * PREVIEW_RATIO);
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

// ── 렌더 (에셋을 고를 때 화면 뼈대를 다시 만든다) ─────────────────

function renderSteps() {
  const active = state.selectedId ? state.step : 0;
  $('#bannerOverlay')?.classList.toggle('locked', state.step !== 1);
  $('#overlay')?.classList.toggle('locked', state.step !== 1);
  // 매체 목록은 3 단계(Select Channel)부터 — 그 전에는 Channel List 버튼만
  const gate = $('#channelGate'), body = $('#channelBody');
  if (gate && body) { gate.hidden = state.step >= 2; body.hidden = state.step < 2; }
  $('#steps').innerHTML = STEPS.map((label, i) => {
    // 에셋을 고르기 전에는 1 만, 매체를 고르기 전에는 Edit(4) 을 빼고 누를 수 있다
    const why = !STEP_READY[i] ? 'Coming soon' : i > 0 && !state.selectedId ? 'Pick a visual type first' : i === 3 && !state.channel ? 'Pick a channel first' : '';
    return `
    ${i > 0 ? '<div class="tb-step-line"></div>' : ''}
    <button type="button" class="tb-step${i === active ? ' active' : ''}" data-step="${i}"${why ? ` disabled title="${why}"` : ''}>
      <span class="tb-step-num">${i + 1}</span>
      <span class="tb-step-label">${esc(label)}</span>
    </button>`;
  }).join('');
}

/** 스텝을 누르면 그 화면으로 — 1 팔레트, 2 Edit panel 의 편집 박스, 3 미리보기 아래 매체 */
function goStep(i) {
  const panelChanged = (state.step >= 2) !== (i >= 2);
  state.step = i;
  renderSteps();
  // 2 ↔ 3·4 를 오가면 Edit panel 이 편집 박스 ↔ Copy 패널로 바뀐다
  if (panelChanged && state.selectedId) { renderEdit(); buildProductList(); update(); }
  const hit = findAsset(state.selectedId);
  if (i === 0) {
    const cell = $('#palette .tb-cell.selected') || $('#palette .tb-cell');
    cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cell?.focus({ preventScroll: true });
  } else if (i === 1 && hit) {
    const key = hit.asset.banner ? 'text' : 'product';
    const sec = $(`#editBody .tb-acc[data-key="${key}"]`);
    if (!sec) return;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (i === 2) {
    const box = $('.tb-channels');
    box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box?.classList.remove('flash');
    void box?.offsetWidth; // 애니메이션을 다시 걸려고 한 번 읽는다
    box?.classList.add('flash');
  } else if (i === 3 && SHOW_SLOTS) {
    $('#slots')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
$('#steps').addEventListener('click', e => {
  const btn = e.target.closest('[data-step]');
  if (btn && !btn.disabled) goStep(Number(btn.dataset.step));
});

function renderPalette() {
  $('#palette').innerHTML = groupsFor().map(g => `
    <section class="tb-group">
      <p class="tb-group-label">${esc(g.label)}</p>
      <div class="tb-grid">
        ${g.assets.map(a => `
          <button type="button" class="tb-cell${state.selectedId === a.id ? ' selected' : ''}" data-id="${a.id}">
            <span class="tb-tile${a.art ? ' has-art' : ''}"${a.view ? ` style="height:auto;aspect-ratio:${TILE_RATIO}"` : ''}>${a.art ? `<img src="${thumbUrl(a)}" alt="${esc(`${a.label} ${toneOf(a.tone).label}`)}" loading="lazy" draggable="false" />` : ''}</span>
            <span class="tb-caption tb-tone tb-tone-${a.tone}"><span class="tb-tone-dot">${toneOf(a.tone).icon}</span>${toneOf(a.tone).label}</span>
          </button>`).join('')}
      </div>
    </section>`).join('');
}

function renderCanvas() {
  const hit = findAsset(state.selectedId);
  if (!hit) {
    $('#canvas').innerHTML = `
      <div class="tb-empty">
        <div>
          <p class="tb-empty-title">Canvas</p>
          <p>Pick an asset on the left to preview it.</p>
          <p>You can preview the image being edited.</p>
        </div>
      </div>`;
    return;
  }
  const { asset, group } = hit;
  if (asset.banner) {
    // 배너 컷 — view 창만큼 줌해서 보여 준다. 바탕 전체 크기 판을 창 밖으로 키워 놓고 당겨 넣어서
    // 글자 상자·끌기 좌표는 그대로 바탕 대비 비율로 쓴다
    const v = asset.view || { x: 0, y: 0, w: 1, h: 1 };
    const board = `width:${100 / v.w}%;height:${100 / v.h}%;left:${(-v.x / v.w) * 100}%;top:${(-v.y / v.h) * 100}%`;
    $('#canvas').innerHTML = `
      <div class="tb-preview">
        <div class="tb-preview-art" style="aspect-ratio:${viewRatio(asset)}">
          <canvas id="bannerView" hidden></canvas>
          <div class="tb-banner" style="${board}">
            <img src="${ASSET_DIR}/${asset.banner.src}" alt="${esc(asset.label)}" draggable="false" />
            <canvas id="bannerComp" width="${asset.banner.w}" height="${asset.banner.h}" hidden></canvas>
            <div class="tb-banner-overlay" id="bannerOverlay"><div class="tb-text-box" id="textBox" title="Drag to move"></div></div>
          </div>
        </div>
        <div class="tb-preview-foot">
          <p class="name">${esc(asset.label)}</p>
          <p class="meta">${esc(group.label)} · ${toneOf(asset.tone).label}</p>
        </div>
      </div>
      ${channelPicker()}`;
    productEls.length = 0;
    return;
  }
  // 합성 바탕이 뜨기 전까지는 구워 둔 미리보기 이미지가 자리를 지킨다. full 컷은 박스를 원본 비율로
  const ratio = asset.size && (asset.view || asset.full) ? ` style="aspect-ratio:${viewRatio(asset)}"` : '';
  $('#canvas').innerHTML = `
    <div class="tb-preview">
      <div class="tb-preview-art"${ratio}>
        ${asset.art
          ? `<img src="${previewUrl(asset)}" alt="${esc(asset.label)}" draggable="false" />
             <div class="tb-scene" id="scene" hidden>
               <canvas id="comp"></canvas>
               <div class="overlay" id="overlay">
                 <canvas id="eraseView"></canvas>
                 <svg id="quadSvg" preserveAspectRatio="none"><polygon /></svg>
                 <div id="handles"></div>
                 <div id="brushCursor" hidden></div>
               </div>
             </div>
             ${asset.examples ? `
               <img class="tb-example" id="exampleImg" alt="" draggable="false" hidden />
               <div class="tb-example-toggle" role="group" aria-label="Example">
                 ${asset.examples.map(k => `<button type="button" data-example="${k}">${EXAMPLE_LABEL[k]}</button>`).join('')}
               </div>` : ''}`
          : `${IMAGE_ICON}<span>Artwork coming soon</span>`}
      </div>
      <div class="tb-preview-foot">
        <p class="name">${esc(asset.label)}</p>
        <p class="meta">${esc(group.label)} · ${toneOf(asset.tone).label}</p>
      </div>
    </div>
    ${channelPicker()}`;
  productEls.length = 0;
}

/**
 * 매체(Channel) 고르기 — 미리보기 아래 알약 버튼 (BF 빌더 OutputPicker 와 같은 모양).
 * 매체별 사이즈 작업 전이라 지금은 고르는 표시만 한다. 목록은 Sales Builder 매체 그대로.
 */
function channelPicker() {
  return `
    <div class="tb-channels">
      <p class="tb-channels-label">Channel</p>
      <div class="tb-channel-gate" id="channelGate">
        <button type="button" class="btn tb-channel-open" data-act="open-channels">Channel List</button>
        <p class="tb-channels-note">Finish editing the image in the Edit panel on the right, then press this button.</p>
      </div>
      <div class="tb-channels-body" id="channelBody">
      <div class="tb-channels-list">
        ${CHANNEL_ROWS.map(row => `
          <div class="tb-channels-row">
            ${row.map(c => `<button type="button" class="tb-channel${state.channel === c.key ? ' on' : ''}" data-channel="${c.key}">${esc(c.label)}</button>`).join('')}
          </div>`).join('')}
      </div>
      <p class="tb-channels-note">For LG.com, files are downloaded to match the image upload guide — every size is exported without copy, CTA, and indicators (icons and disclaimer included).</p>
      </div>
    </div>
    <div class="tb-slots" id="slots" hidden></div>`;
}

/**
 * 매체 사이즈 미리보기 — 3 단계에서 고른 매체의 사이즈를 미리보기 아래에 모두 그린다 (lib/channelSlots.js).
 * Main Theme 은 Figma Main Theme 보드, Product Type 은 Product Type 보드 값. ALL 은 매체별로 묶어 다 보인다.
 * 바탕은 3000² 완성 컷 — Main Theme 은 Text 까지 그린 #bannerComp, Product Type 은 제품·오브젝트까지 합성한 #comp. 카피는 Copy 패널 값.
 * 화면에서는 사이즈마다 긴 변 360 안으로 줄여 보이고 (BF 처럼 한 비율로 줄이지 않는다 — 한눈에 다 보이게),
 * 캔버스도 보이는 크기 × 화면 배율로만 만든다 (원래 픽셀로 만들면 ALL 에서 수백 MB 가 된다)
 */
// 매체 사이즈 미리보기는 지금 Criteo 만 공개한다 (ALL 도 Criteo 만) — 나머지 매체 데이터는 들어 있지만 화면에는 아직 안 띄운다.
// 공개할 매체 key 를 여기에 더하면 바로 보인다
const SHOW_SLOTS = true;
const PUBLIC_SLOTS = new Set(['criteo']);
let slotsQueued = false;
function renderSlots() {
  if (slotsQueued) return;
  slotsQueued = true;
  requestAnimationFrame(() => {
    slotsQueued = false;
    const box = $('#slots');
    if (!box) return;
    const hit = findAsset(state.selectedId);
    const on = SHOW_SLOTS && state.step >= 2 && state.channel && hit && (hit.asset.banner || hit.asset.art);
    box.hidden = !on;
    if (!on) return;
    const board = hit.asset.banner ? 'main' : 'product';
    const slots = state.channel === 'all'
      ? [...PUBLIC_SLOTS].flatMap(k => slotsForChannel(k, board))
      : PUBLIC_SLOTS.has(state.channel) ? slotsForChannel(state.channel, board) : [];
    if (!slots.length) {
      box.innerHTML = '<p class="tb-slots-empty">Sizes for this channel are coming soon.</p>';
      box.dataset.keys = '';
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const keys = `${board}|${dpr}|${slots.map(sl => sl.key).join()}`;
    if (box.dataset.keys !== keys) {
      box.dataset.keys = keys;
      box.innerHTML = slots.map((sl, i) => {
        const k = Math.min(1, 360 / Math.max(sl.w, sl.h));
        const head = state.channel === 'all' && sl.label !== slots[i - 1]?.label ? `<p class="tb-slots-group">${esc(sl.label)}</p>` : '';
        return `${head}
        <figure class="tb-slot">
          <canvas width="${Math.round(sl.w * k * dpr)}" height="${Math.round(sl.h * k * dpr)}" data-slot="${sl.key}" style="width:${sl.w * k}px"></canvas>
          <figcaption>${sl.key}</figcaption>
        </figure>`;
      }).join('');
    }
    const art = hit.asset.banner
      ? (state.banner?.assetId === state.selectedId ? $('#bannerComp') : null)
      : (state.bg?.assetId === state.selectedId ? $('#comp') : null);
    slots.forEach(sl => {
      const c = box.querySelector(`[data-slot="${sl.key}"]`);
      const ctx = c.getContext('2d');
      ctx.setTransform(c.width / sl.w, 0, 0, c.height / sl.h, 0, 0);
      drawSlot(ctx, sl, art, state.copy, hit.asset.tone);
    });
  });
}
// 배너 글꼴·로고가 늦게 읽히면 한 번 더
Promise.all([document.fonts.load('600 20px "LGEI Headline"'), document.fonts.load('400 20px "LGEI Text"'), logosReady()]).then(() => renderSlots());

function renderEdit() {
  const hit = findAsset(state.selectedId);
  if (!hit) {
    $('#editBody').innerHTML = '';
    return;
  }
  // 매체를 골라 3 단계에 있으면 Edit panel 은 그 매체의 Copy 패널 (BF Content Builder 와 같다)
  const channel = state.step >= 2 && CHANNEL_ROWS.flat().find(c => c.key === state.channel);
  if (channel) {
    $('#editBody').innerHTML = renderCopyPanel(state.copy, channel);
    return;
  }
  const { asset, group } = hit;
  if (asset.banner) {
    $('#editBody').innerHTML = `
      <div class="tb-edit-asset">
        <p class="name">${esc(asset.label)}</p>
        <p class="meta">${esc(group.label)} · ${toneOf(asset.tone).label} · ${asset.size[0]} × ${asset.size[1]}</p>
        <div class="tb-edit-frame" style="aspect-ratio:${asset.banner.w} / ${asset.banner.h}"><img src="${ASSET_DIR}/${asset.banner.src}" alt="${esc(asset.label)}" draggable="false" /><canvas id="bannerFull" hidden></canvas></div>
      </div>
      ${BANNER_SECTIONS.map(sec => `
        <section class="tb-acc${state.open.has(sec.key) ? ' open' : ''}${PINNED.has(sec.key) ? ' pinned' : ''}" data-key="${sec.key}">
          <button type="button" class="tb-acc-head" aria-expanded="${state.open.has(sec.key)}">
            <span class="tb-acc-text">
              <span class="tb-acc-title">${esc(sec.title)}</span>
              <span class="tb-acc-desc">${esc(sec.desc)}</span>
            </span>
            ${CHEVRON}
          </button>
          <div class="tb-acc-body"><div class="tb-acc-inner">${TEXT_PANEL}</div></div>
        </section>`).join('')}`;
    return;
  }
  $('#editBody').innerHTML = `
    <div class="tb-edit-asset">
      <p class="name">${esc(asset.label)}</p>
      <p class="meta">${esc(group.label)} · ${toneOf(asset.tone).label}${asset.size ? ` · ${asset.size[0]} × ${asset.size[1]}` : ''}</p>
      ${asset.art ? `<div class="tb-edit-frame"${asset.full ? ` style="aspect-ratio:${asset.size[0]} / ${asset.size[1]}"` : ''}><img src="${frameUrl(asset)}" alt="${esc(asset.label)}" draggable="false" /><canvas id="frameView" hidden></canvas>${asset.examples ? '<img class="tb-example" id="exampleFrame" alt="" draggable="false" hidden />' : ''}</div>` : ''}
    </div>
    ${EDIT_SECTIONS.filter(sec => !sec.hidden).map(sec => `
      <section class="tb-acc${state.open.has(sec.key) ? ' open' : ''}${PINNED.has(sec.key) ? ' pinned' : ''}" data-key="${sec.key}">
        <button type="button" class="tb-acc-head" aria-expanded="${state.open.has(sec.key)}">
          <span class="tb-acc-text">
            <span class="tb-acc-title">${esc(sec.title)}</span>
            ${sec.badge ? `<span class="tb-acc-badge">${esc(sec.badge)}</span>` : ''}
            <span class="tb-acc-desc">${esc(sec.desc)}</span>
          </span>
          ${CHEVRON}
        </button>
        <div class="tb-acc-body"><div class="tb-acc-inner">
          ${!asset.art
            ? '<div class="tb-acc-item"><div class="tb-acc-slot">Available once the artwork lands.</div></div>'
            : sec.key === 'product' ? PRODUCT_PANEL : SCENE_PANEL}
        </div></div>
      </section>`).join('')}`;
}

/** Product & Shadow 박스 안 — studio.html 의 Product Images / Placement / Shadow & Tone 과 같은 구성. */
const PRODUCT_PANEL = `
  <div class="tb-acc-item">
    <p class="tb-acc-item-label">Product Image</p>
    <div class="list" id="productList"></div>
    <button type="button" class="btn ghost full" data-act="add-product">+ Add product</button>
    <p class="status" id="status"></p>
  </div>

  <div class="tb-acc-item">
    <p class="tb-acc-item-label">Object</p>
    <div class="tb-obj-stage" id="objectStage" hidden>
      <p class="tb-obj-head"><span>On stage</span><span class="tb-obj-count" id="objectCount"></span></p>
      <div class="tb-placed" id="objectList"></div>
    </div>
    <p class="tb-obj-head tb-obj-lib-head"><span>Add object</span><span class="tb-obj-count" id="objectLibNote"></span></p>
    <div class="tb-objects" id="objectLib">
      ${OBJECTS.map(o => `
        <button type="button" class="tb-object" data-object="${o.id}" title="${esc(o.label)}">
          <img src="${ASSET_DIR}/${o.src}" alt="${esc(o.label)}" loading="lazy" draggable="false" />
        </button>`).join('')}
    </div>
    <p class="hint">Pick an object to add it to the stage — move, resize and shadow it like a product.</p>
    <p class="status" id="objectStatus"></p>
  </div>

  <div class="tb-acc-item">
    <p class="tb-acc-item-label">Placement</p>
    <div class="tb-place-tabs" id="placeTabs"></div>
    <div class="field">
      <div class="field-row"><span>Size</span><output id="scaleOut">100%</output></div>
      <input id="scale" type="range" min="20" max="300" value="100" />
    </div>
    <button type="button" class="btn ghost full" data-act="reset-pos">Reset size &amp; position</button>
    <p class="hint">Pick a product or object above, or drag it on the canvas to move it.</p>
  </div>

  <div class="tb-acc-item" id="fxPanel">
    <div class="group-row">
      <p class="tb-acc-item-label">Shadow &amp; Tone</p>
      <span class="fx-for"><b id="fxFor">Product 1</b></span>
    </div>

    <div class="field">
      <div class="field-row"><span>Surface</span></div>
      <div class="seg" data-seg="surface">
        <button type="button" data-v="floor">Floor</button>
        <button type="button" data-v="wall">Wall</button>
        <button type="button" data-v="both">Floor + Wall</button>
      </div>
      <p class="hint" id="surfaceHint"></p>
    </div>

    <div class="field">
      <div class="field-row"><span>Shadow direction</span></div>
      <div class="seg" data-seg="direction">
        <button type="button" data-v="left">↙ Left</button>
        <button type="button" data-v="center">Center</button>
        <button type="button" data-v="right">Right ↘</button>
      </div>
    </div>

    <div class="fx-card" data-show="floor" data-toggle="contact.on">
      <label class="fx-head"><input type="checkbox" data-fx="contact.on" /> Contact shadow</label>
      <label class="fx-slider"><span>Strength</span><input type="range" min="0" max="100" data-fx="contact.strength" /><output></output></label>
    </div>

    <div class="fx-card" data-show="floor" data-toggle="floor.on">
      <label class="fx-head"><input type="checkbox" data-fx="floor.on" /> Floor shadow</label>
      <label class="fx-slider"><span>Strength</span><input type="range" min="0" max="100" data-fx="floor.strength" /><output></output></label>
      <label class="fx-slider"><span>Softness</span><input type="range" min="0" max="100" data-fx="floor.softness" /><output></output></label>
      <label class="fx-slider"><span>Length</span><input type="range" min="0" max="100" data-fx="floor.length" /><output></output></label>
    </div>

    <div class="fx-card" data-show="wall">
      <p class="fx-head">Wall shadow</p>
      <label class="fx-slider"><span>Strength</span><input type="range" min="0" max="100" data-fx="wall.strength" /><output></output></label>
      <label class="fx-slider"><span>Depth</span><input type="range" min="0" max="100" data-fx="wall.depth" /><output></output></label>
      <label class="fx-slider"><span>Vertical</span><input type="range" min="-50" max="50" data-fx="wall.offsetY" /><output></output></label>
      <p class="hint">Depth = distance from the wall (product thickness). Vertical moves the shadow up (−) or down (+).</p>
    </div>

    <div class="fx-card" data-show="floor" data-toggle="reflection.on">
      <label class="fx-head"><input type="checkbox" data-fx="reflection.on" /> Floor reflection</label>
      <label class="fx-slider"><span>Opacity</span><input type="range" min="0" max="100" data-fx="reflection.opacity" /><output></output></label>
      <label class="fx-slider"><span>Length</span><input type="range" min="0" max="100" data-fx="reflection.length" /><output></output></label>
    </div>

    <div class="fx-card">
      <p class="fx-head">Tone match</p>
      <label class="fx-slider"><span>Strength</span><input type="range" min="0" max="100" data-fx="tone.strength" /><output></output></label>
      <p class="hint">Pulls the product's color and brightness toward the background.</p>
    </div>

    <div class="fx-card" id="eraserCard">
      <p class="fx-head">Shadow eraser</p>
      <button id="eraseToggle" type="button" class="btn ghost full" data-act="erase-toggle">Paint to erase shadow</button>
      <div class="seg" id="eraseMode">
        <button type="button" data-v="erase">Erase</button>
        <button type="button" data-v="restore">Restore</button>
      </div>
      <label class="fx-slider"><span>Brush</span><input id="eraseSize" type="range" min="5" max="200" value="40" /><output></output></label>
      <button id="eraseClear" type="button" class="link" data-act="erase-clear">Clear erased areas</button>
      <p class="hint">Erased areas stay fixed on the background — move the product and they still block the shadow there.</p>
    </div>

    <div class="row">
      <button type="button" class="btn ghost" data-act="fx-reset">Reset</button>
      <button type="button" class="btn ghost" style="flex:1" data-act="fx-all">Apply to all</button>
    </div>
  </div>`;


/** Scene Color 박스 안 — studio.html 의 Screen infill / Color mood / Background objects 와 같은 구성. */
const SCENE_PANEL = `
  <div class="tb-acc-item" id="screenPanel">
    <div class="group-row">
      <p class="tb-acc-item-label">Screen Area</p>
      <span class="fx-for"><b id="screenFor">Product 1</b></span>
    </div>
    <!-- 화면을 고르는 두 방법 — 지금 쓰는 쪽 카드에 불이 들어온다 -->
    <div class="tb-method" id="method1">
      <div class="tb-method-head"><span class="tb-method-num">1</span><p>Screen Select 1 <span>· Keep the product screen</span></p></div>
      <p class="hint">Click the TV screen on the canvas. The background takes its colors — the screen itself is kept as is.</p>
      <button id="sampleScreen" type="button" class="btn ghost full" data-act="sample-screen">Click the screen</button>
    </div>
    <div class="tb-method" id="method2">
      <div class="tb-method-head"><span class="tb-method-num">2</span><p>Screen Select 2 <span>· Mark the area by hand</span></p></div>
      <p class="hint">Click four corners on the canvas to mark the area yourself. The background takes the colors inside it — nothing is replaced. Drag the points to adjust.</p>
      <button id="setCorners" type="button" class="btn ghost full" data-act="set-corners">Set four points</button>
    </div>
    <button type="button" class="link tb-clear-screen" data-act="clear-screen">Clear screen</button>
    <p class="status" id="sceneStatus"></p>
  </div>

  <div class="tb-acc-item" id="moodPanel">
    <div class="group-row">
      <p class="tb-acc-item-label">Color Mood</p>
      <!-- 물들이기 전/후 비교 — Before 는 원래 무대, 영역·설정은 그대로 남는다 -->
      <div class="seg tb-ba" data-mseg="on" title="Compare the background before and after coloring">
        <button type="button" data-v="before">Before</button>
        <button type="button" data-v="after">After</button>
      </div>
    </div>
    <p class="hint" id="moodSourceHint">Pick a screen area (Screen Select 1 or 2 above) to color the background from it.</p>
    <label class="fx-slider"><span>Strength</span><input type="range" min="0" max="100" data-m="strength" /><output></output></label>
    <label class="fx-slider"><span>Vividness</span><input type="range" min="0" max="100" data-m="vivid" /><output></output></label>
    <label class="fx-slider"><span>Object tint</span><input type="range" min="0" max="100" data-m="objectAmount" /><output></output></label>
    <label class="fx-slider"><span>Screen glow</span><input type="range" min="0" max="100" data-m="glow" /><output></output></label>
    <label class="fx-slider"><span>Center clear</span><input type="range" min="0" max="100" data-m="centerClear" /><output></output></label>
    <label class="fx-slider"><span>Floor tint</span><input type="range" min="0" max="100" data-m="floorAmount" /><output></output></label>
    <p class="hint">Object tint = how much the stands and props take the color. Center clear keeps the area around the screen clean; Floor tint colors the floor below the product.</p>
  </div>`;

/** Text 박스 안 — 글자 / 모양 / 자리 */
const TEXT_PANEL = `
  <div class="tb-acc-item" id="textPanel">
    <p class="tb-acc-item-label">Text</p>
    <textarea class="tb-text-input" data-t="value" rows="2" spellcheck="false" placeholder="Type your text"></textarea>
    <p class="hint">Press Enter for a new line.</p>
    <div class="field">
      <div class="field-row"><span>Font</span></div>
      <select class="tb-select" data-t="font">${FONTS.map(f => `<option value="${f.key}">${esc(f.label)}</option>`).join('')}</select>
    </div>
  </div>

  <div class="tb-acc-item">
    <p class="tb-acc-item-label">Color &amp; Depth</p>
    <div class="tb-swatches">
      ${TEXT_STYLES.map(s => `<button type="button" class="tb-swatch" data-tstyle="${s.key}" title="${s.label}" style="--a:${s.face[0]};--b:${s.face[2]}"></button>`).join('')}
      <label class="tb-swatch custom" data-tstyle="custom" title="Custom color"><input type="color" data-t="color" /></label>
    </div>
    <label class="fx-slider"><span>Size</span><input type="range" min="1.5" max="20" step="0.1" data-t="size" /><output></output></label>
    <label class="fx-slider"><span>Width</span><input type="range" min="50" max="150" data-t="width" /><output></output></label>
    <label class="fx-slider"><span>Spacing</span><input type="range" min="-10" max="40" data-t="spacing" /><output></output></label>
    <label class="fx-slider"><span>Depth</span><input type="range" min="0" max="100" data-t="depth" /><output></output></label>
    <label class="fx-slider"><span>Shadow</span><input type="range" min="0" max="100" data-t="shadow" /><output></output></label>
    <p class="hint">Depth stacks the letters for a 3D look; Shadow drops a soft shadow below them.</p>
  </div>

  <div class="tb-acc-item">
    <p class="tb-acc-item-label">Position</p>
    <label class="fx-slider"><span>Rotate</span><input type="range" min="-45" max="45" step="0.5" data-t="rotate" /><output></output></label>
    <label class="fx-slider"><span>Slant</span><input type="range" min="-30" max="30" data-t="slant" /><output></output></label>
    <button type="button" class="btn ghost full" data-act="text-reset">Reset text</button>
    <p class="hint">Drag the text on the canvas to move it.</p>
  </div>`;

/**
 * 에셋을 고르거나 풀 때 — 화면 뼈대를 다시 만들고 합성 바탕을 불러온다.
 * 합성 컷(Product Type)은 새 바탕·이미지를 다 준비한 다음에 한 번에 바꾼다 — 그 사이엔 지금 화면을 둔다
 * (뼈대를 먼저 비우면 라이트 ↔ 다크 전환이 깜빡이면서 두 번에 걸쳐 바뀐다)
 */
function selectAsset(id) {
  const hit = findAsset(id);
  const ticket = ++selectTicket;
  if (hit?.asset.art && !hit.asset.banner && state.bg?.assetId !== id && $('#canvas .tb-preview')) {
    const { asset } = hit;
    const example = findAsset(state.selectedId)?.asset.base === asset.base ? state.example : null;
    const urls = [previewUrl(asset), frameUrl(asset)];
    if (example) urls.push(exampleUrl(asset, example), `${ASSET_DIR}/${asset.id}-ex-${example}-frame.jpg`);
    void Promise.all([prepareStage(asset), ...urls.map(u => loadImage(u).then(img => img.decode()).catch(() => null))])
      .then(([bg]) => { if (ticket === selectTicket) commitSelect(id, example, bg); });
    return;
  }
  commitSelect(id, null, null);
}
let selectTicket = 0;

function commitSelect(id, example, bg) {
  state.selectedId = id;
  state.example = example;
  if (bg) applyStage(bg);
  state.step = state.channel ? 3 : 1;
  state.erasing = false;
  state.sampling = false;
  state.picking = null;
  state.pickPts = [];
  renderSteps();
  renderPalette();
  renderCanvas();
  const hit = findAsset(id);
  // 배너 컷은 Text 박스를 펼쳐 둔다 — 고르자마자 글자를 고칠 수 있게 (PINNED 라 접히지도 않는다)
  if (hit?.asset.banner) state.texts[hit.asset.base] ??= newText(hit.asset);
  PINNED.forEach(k => state.open.add(k));
  renderEdit();
  buildProductList();
  if (example) syncExample();
  update();
  if (hit?.asset.banner) void loadBanner(hit.asset);
  else if (hit?.asset.art) void loadStage(hit.asset);
}

/** 합성 바탕(원본 해상도)을 읽고 그늘색 지도까지 만들어 둔다. */
async function loadStage(asset) {
  if (state.bg?.assetId === asset.id) return showScene();
  const bg = await prepareStage(asset);
  if (!bg || state.selectedId !== asset.id) return; // 읽는 사이 다른 에셋을 골랐다
  applyStage(bg);
  showScene();
}

/** 바탕을 읽어 그늘색 지도·속 오브젝트까지 만든다 — state 는 건드리지 않는다 (실패하면 null) */
async function prepareStage(asset) {
  try {
    const img = await loadImage(stageUrl(asset));
    const w = img.naturalWidth, h = img.naturalHeight;
    const px = createBackground(img);
    const bg = { assetId: asset.id, id: Date.now(), w, h, px };
    // 색 보정이 읽을 형태 (readImage 와 같은 모양)
    bg.scene = { canvas: img, w, h, data: new ImageData(new Uint8ClampedArray(px.data), w, h) };
    // 단상·소품 같은 배경 속 오브젝트를 바로 한 번 나눠 둔다
    bg.objects = detectObjects(bg.scene, null);
    return bg;
  } catch (err) {
    console.error(err);
    setStatus(`Could not load the stage image: ${err.message}`, true);
    return null;
  }
}

function applyStage(bg) {
  // 지운 자리는 배경 좌표라 다른 배경에서는 의미가 없다
  if (state.bg) state.slots.forEach(s => { s.eraser = null; });
  const { objects, ...rest } = bg;
  state.bg = rest;
  state.objects = objects;
  state.objVersion++;
}

/** 합성 캔버스를 바탕 크기로 맞추고 미리보기 창만큼 잘라 보이게 놓는다. */
function showScene() {
  const scene = $('#scene');
  if (!scene || !state.bg) return;
  const { w, h } = state.bg;
  for (const c of [$('#comp'), $('#eraseView')]) { c.width = w; c.height = h; }
  // 박스(= 창) 기준 %로 장면 전체를 키워 놓고 창 위치만큼 당긴다
  const win = previewWindow();
  Object.assign(scene.style, {
    width: `${(w / win.w) * 100}%`,
    height: `${(h / win.h) * 100}%`,
    left: `${(-win.x / win.w) * 100}%`,
    top: `${(-win.y / win.h) * 100}%`,
  });
  scene.hidden = false;
  update();
}

// ── 갱신 (제품·설정이 바뀔 때 — 뼈대는 그대로 두고 값만 맞춘다) ─────────

const productEls = [];

function update() {
  renderSteps();
  $('#download').disabled = state.banner?.assetId === state.selectedId ? false : !state.bg || state.bg.assetId !== state.selectedId;
  syncText();
  syncHandles();
  syncProductList();
  syncPlacement();
  syncFxPanel();
  syncScene();
  scheduleDraw();
  renderSlots();
}

function pct(v, total) { return `${(v / total) * 100}%`; }

/** 캔버스가 그린 제품 위에 얹는 투명 손잡이 — 끌어서 옮긴다. */
function syncHandles() {
  const overlay = $('#overlay');
  if (!overlay) return;
  const n = state.slots.length;
  while (productEls.length < n) {
    const el = document.createElement('div');
    el.className = 'product';
    overlay.append(el);
    productEls.push(el);
  }
  while (productEls.length > n) productEls.pop().remove();
  state.slots.forEach((slot, i) => {
    const el = productEls[i];
    const r = productRect(slot);
    el.hidden = !r;
    if (!r) return;
    el.dataset.i = i;
    el.classList.toggle('active', i === state.active);
    el.style.setProperty('--c', colorOf(i));
    const { w, h } = state.bg;
    Object.assign(el.style, { left: pct(r.x, w), top: pct(r.y, h), width: pct(r.w, w), height: pct(r.h, h) });
  });
  overlay.classList.toggle('erasing', state.erasing);
}

/**
 * 제품 행 목록 + 놓인 오브젝트 목록 — 슬롯 수가 바뀔 때만 다시 만든다 (입력 중인 URL 이 날아가지 않게).
 * data-i 는 state.slots 의 자리, 화면에 보이는 번호는 종류별 번호.
 */
function buildProductList() {
  const list = $('#productList');
  if (!list) return;
  const products = slotsOf('product');
  list.innerHTML = products.map(i => state.slots[i]).map((slot, n) => {
    const i = products[n];
    return `
    <div class="item product-row" data-i="${i}">
      <div class="thumb">
        <span class="tag" style="--c:${colorOf(i)}">${n + 1}</span>
        <img alt="" hidden />
        <div class="thumb-actions" hidden>
          <button type="button" class="edit" data-act="edit" title="Edit (brush + crop)">Edit</button>
          <button type="button" class="remove" data-act="remove" title="Remove">×</button>
        </div>
      </div>
      <div class="product-inputs">
        <form class="row url-form">
          <input type="url" placeholder="LG.com product URL" value="${esc(slot.url)}" required />
          <button type="submit">Import</button>
        </form>
        <div class="row">
          <label class="file-btn ghost-btn">Upload<input type="file" accept="image/*" /></label>
          <button type="button" class="link change" data-act="change" hidden>Change from imported images</button>
          ${products.length > 1 ? '<button type="button" class="link tb-drop-slot" data-act="drop-slot">Delete</button>' : ''}
        </div>
        <p class="muted meta"></p>
      </div>
    </div>`;
  }).join('');

  // 놓인 것(On stage)과 고르는 목록(Add object)을 나눠 보인다 — 다 차면 목록을 흐리게
  const placed = slotsOf('object');
  $('#objectStage').hidden = !placed.length;
  $('#objectCount').textContent = `${placed.length} / ${MAX_OBJECTS}`;
  $('#objectLib').classList.toggle('full', placed.length >= MAX_OBJECTS);
  $('#objectLibNote').textContent = placed.length >= MAX_OBJECTS ? `Max ${MAX_OBJECTS}` : '';
  $('#objectList').innerHTML = placed.map((i, n) => `
    <div class="tb-placed-item" data-i="${i}">
      <button type="button" class="tb-placed-pick" data-tab="${i}" title="${esc(state.slots[i].object.label)}">
        <img src="${ASSET_DIR}/${state.slots[i].object.src}" alt="${esc(state.slots[i].object.label)}" draggable="false" />
        <span class="tag" style="--c:${colorOf(i)}">${n + 1}</span>
      </button>
      <button type="button" class="tb-placed-remove" data-act="drop-object" title="Remove">×</button>
    </div>`).join('');
}

function syncProductList() {
  const list = $('#productList');
  if (!list) return;
  list.querySelectorAll('.item').forEach(row => {
    const p = state.slots[Number(row.dataset.i)]?.product;
    const img = row.querySelector('.thumb img');
    img.hidden = !p;
    if (p && img.getAttribute('src') !== p.src) img.src = p.src;
    row.querySelector('.thumb-actions').hidden = !p;
    row.querySelector('.change').hidden = !(p?.images?.length);
    row.querySelector('.meta').textContent = p?.meta ? [p.meta.name, p.meta.model].filter(Boolean).join(' · ') : '';
  });
  const add = $('[data-act="add-product"]');
  if (add) add.disabled = slotsOf('product').length >= MAX_PRODUCTS;
  document.querySelectorAll('.tb-placed-item').forEach(el => el.classList.toggle('on', Number(el.dataset.i) === state.active));
}

function syncPlacement() {
  const tabs = $('#placeTabs');
  if (!tabs) return;
  // 하나뿐이면 탭은 고를 게 없다. 제품 줄 / 오브젝트 줄로 나눠 종류별 번호를 단다
  tabs.hidden = state.slots.length < 2;
  tabs.innerHTML = ['product', 'object'].map(kind => {
    const idx = slotsOf(kind);
    if (!idx.length) return '';
    return `
      <div class="tb-tab-row">
        <span class="tb-tab-kind">${KIND_LABEL[kind]}</span>
        <div class="tabs">
          ${idx.map((i, n) => `
            <button type="button" class="tab${i === state.active ? ' on' : ''}${state.slots[i].product ? '' : ' empty'}" data-tab="${i}"
              style="--c:${colorOf(i)}" title="${KIND_LABEL[kind]} ${n + 1}${state.slots[i].product ? '' : ' (empty)'}">${n + 1}</button>`).join('')}
        </div>
      </div>`;
  }).join('');
  const s = state.slots[state.active].place.scale;
  $('#scale').value = Math.round(s * 100);
  $('#scaleOut').textContent = `${Math.round(s * 100)}%`;
}

// ── 합성 그리기 ───────────────────────────────────────────

let drawQueued = false;
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const comp = $('#comp');
    if (!state.bg || !comp || state.bg.assetId !== state.selectedId) return;
    paint(comp.getContext('2d'));
    // Edit panel 프레임은 같은 합성의 전체를 줄여 보여준다.
    // 크기는 그릴 때마다 맞춘다 — 단계를 오가며 Edit panel 을 다시 그리면 캔버스가 기본 300×150 으로 새로 생겨 찌그러졌다
    const frame = $('#frameView');
    if (frame) {
      const fh = Math.round((800 * state.bg.h) / state.bg.w);
      if (frame.width !== 800 || frame.height !== fh) { frame.width = 800; frame.height = fh; }
      frame.getContext('2d').drawImage(comp, 0, 0, frame.width, frame.height);
      if (frame.hidden) {
        frame.hidden = false;
        frame.previousElementSibling.hidden = true;
      }
    }
    drawEraseView();
  });
}

/** 최종 이미지를 ctx 에 그린다. 화면과 다운로드가 같이 쓴다. */
function paint(ctx) {
  const items = state.slots
    .map(slot => ({ slot, rect: productRect(slot) }))
    .filter(({ slot, rect }) => rect && slot.product.img)
    .map(({ slot, rect }) => {
      const scr = screenLayer(slot, rect);
      return {
        image: slot.product.img, rect, fx: slot.fx, eraser: slot.eraser,
        glow: scr && scr.glow && { canvas: scr.glow, x: Math.round(rect.x) - scr.pad, y: Math.round(rect.y) - scr.pad },
      };
    });
  drawComposite(ctx, coloredBackground() || state.bg.px, items, {
    // 화면 빛은 배경 위·그림자와 제품 아래에 번진다
    afterBackground: c => {
      if (!state.mood.on || !state.mood.glow) return;
      c.globalCompositeOperation = 'screen';
      c.globalAlpha = state.mood.glow / 100;
      for (const it of items) if (it.glow) c.drawImage(it.glow.canvas, it.glow.x, it.glow.y);
    },
  });
}

// ── 배너 텍스트 ───────────────────────────────────────────

/** 지금 고른 배너 컷의 텍스트 설정 (배너가 아니면 null) */
function activeText() {
  const hit = findAsset(state.selectedId);
  return hit?.asset.banner ? state.texts[hit.asset.base] : null;
}

/** 배너 바탕을 읽는다. 글꼴도 같이 기다려야 첫 그림부터 제 글꼴로 나온다. */
async function loadBanner(asset) {
  try {
    const t = state.texts[asset.base];
    const [img] = await Promise.all([
      loadImage(`${ASSET_DIR}/${asset.banner.src}`),
      document.fonts.load(fontSpec(t, 64), t.value).catch(() => null),
    ]);
    if (state.selectedId !== asset.id) return;
    state.banner = { assetId: asset.id, img, w: img.naturalWidth, h: img.naturalHeight };
    update();
  } catch (err) {
    console.error(err);
  }
}

/** 텍스트 한 덩어리의 크기 (회전 전, 바탕 픽셀). 줄마다 가운데 정렬 */
function measureText(ctx, t, H) {
  const px = (t.size / 100) * H;
  ctx.font = fontSpec(t, px);
  ctx.letterSpacing = `${(t.spacing / 100) * px}px`;
  const lines = String(t.value || '').split('\n');
  const lh = px * 1.08;
  const w = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
  return { px, lines, lh, w, h: lh * lines.length };
}

/**
 * 바탕 위에 텍스트를 그린다 — 화면과 다운로드가 같이 쓴다.
 * 순서: 그림자 → 두께(뒤에서 앞으로 겹쳐 쌓기) → 앞면 그라데이션 → 윗가장자리 하이라이트
 */
function drawBannerText(ctx, t, W, H) {
  if (!String(t.value || '').trim()) return;
  // 그림자 흐림·거리는 변환을 안 따라가서 화면 배율만큼 곱한다 (미리보기 창은 키워서 그린다)
  const k = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  ctx.save();
  const m = measureText(ctx, t, H);
  const col = textColors(t);
  ctx.translate(t.x * W, t.y * H);
  ctx.rotate((t.rotate * Math.PI) / 180);
  ctx.transform(1, 0, Math.tan((-t.slant * Math.PI) / 180), 1, 0, 0);
  // 글자 폭 — 글자 하나하나를 가로로 늘이고 줄인다 (100 = 원래 폭). 높이는 그대로
  ctx.scale((t.width ?? 100) / 100, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y0 = -m.h / 2 + m.lh / 2;
  const each = fn => m.lines.forEach((l, i) => fn(l, y0 + i * m.lh));
  // 두께는 아래·조금 오른쪽으로 — 원래 컷의 빛이 왼쪽 위에서 온다
  const steps = Math.round((t.depth / 100) * m.px * 0.09);
  const dir = { x: 0.35, y: 0.94 };

  if (t.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(70, 30, 15, ${(t.shadow / 100) * 0.55})`;
    ctx.shadowBlur = m.px * 0.18 * k;
    ctx.shadowOffsetX = m.px * 0.04 * k;
    ctx.shadowOffsetY = m.px * 0.07 * k;
    ctx.fillStyle = col.side;
    each((l, y) => ctx.fillText(l, steps * dir.x, y + steps * dir.y));
    ctx.restore();
  }
  ctx.fillStyle = col.side;
  for (let i = steps; i >= 1; i--) each((l, y) => ctx.fillText(l, i * dir.x, y + i * dir.y));

  each((l, y) => {
    const g = ctx.createLinearGradient(0, y - m.px * 0.45, 0, y + m.px * 0.45);
    g.addColorStop(0, col.face[0]);
    g.addColorStop(0.5, col.face[1]);
    g.addColorStop(1, col.face[2]);
    ctx.fillStyle = g;
    ctx.fillText(l, 0, y);
  });
  // 윗가장자리만 살짝 밝게 — 금속 모서리처럼
  if (steps > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, m.px * 0.012);
    each((l, y) => ctx.strokeText(l, -m.px * 0.006, y - m.px * 0.01));
  }
  ctx.restore();
}

function paintBanner(ctx) {
  const { img, w, h } = state.banner;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  drawBannerText(ctx, activeText(), w, h);
}

/** Text 패널 값 · 캔버스 위 끌기 상자를 맞추고 다시 그린다. */
function syncText() {
  const t = activeText();
  if (!t) return;
  const panel = $('#textPanel')?.closest('.tb-acc-inner');
  if (panel) {
    panel.querySelectorAll('[data-t]').forEach(input => {
      const v = t[input.dataset.t];
      // 입력 중인 칸은 건드리지 않는다 — 커서가 튀지 않게
      if (document.activeElement !== input && String(input.value) !== String(v)) input.value = v;
      if (input.type === 'range') input.nextElementSibling.textContent = v;
    });
    panel.querySelectorAll('[data-tstyle]').forEach(b => b.classList.toggle('on', b.dataset.tstyle === t.style));
    panel.querySelector('.tb-swatch.custom').style.setProperty('--c', t.color);
  }
  const box = $('#textBox');
  const comp = $('#bannerComp');
  if (!box || !comp || state.banner?.assetId !== state.selectedId) return;
  const { w: W, h: H } = state.banner;
  const m = measureText(comp.getContext('2d'), t, H);
  const pad = m.px * 0.12;
  Object.assign(box.style, {
    left: pct(t.x * W, W), top: pct(t.y * H, H),
    width: pct((m.w * (t.width ?? 100)) / 100 + pad * 2, W), height: pct(m.h + pad * 2, H),
    transform: `translate(-50%, -50%) rotate(${t.rotate}deg) skewX(${-t.slant}deg)`,
  });
  box.hidden = !String(t.value || '').trim();
  $('#bannerOverlay').classList.toggle('guides', state.open.has('text'));
  $('#bannerOverlay').classList.toggle('locked', state.step !== 1);
  paintBanner(comp.getContext('2d'));
  paintBannerView();
  // Edit panel — 같은 그림을 줄여서 전체로
  const full = $('#bannerFull');
  if (full) {
    const k = Math.min(1, 1200 / Math.max(W, H));
    if (full.width !== Math.round(W * k)) { full.width = Math.round(W * k); full.height = Math.round(H * k); }
    full.getContext('2d').drawImage(comp, 0, 0, full.width, full.height);
    if (full.hidden) { full.hidden = false; full.previousElementSibling.hidden = true; }
  }
}

/**
 * 캔버스 미리보기 — 원본 판(3000²)을 줄였다 키웠다 하면 글자가 뭉개지므로, 보이는 창만 화면 픽셀(× devicePixelRatio)로 바로 그린다.
 * 원본 판(#bannerComp)은 다운로드·Edit panel 용으로 숨겨 둔다.
 */
function paintBannerView() {
  const view = $('#bannerView');
  const asset = findAsset(state.selectedId)?.asset;
  if (!view || !asset || !state.banner) return;
  const { w: W, h: H } = state.banner;
  const v = asset.view || { x: 0, y: 0, w: 1, h: 1 };
  const box = view.parentElement;
  const cw = Math.round(box.clientWidth * (window.devicePixelRatio || 1));
  const ch = Math.round(box.clientHeight * (window.devicePixelRatio || 1));
  if (!cw || !ch) return;
  if (view.width !== cw || view.height !== ch) { view.width = cw; view.height = ch; }
  const ctx = view.getContext('2d');
  const s = cw / (v.w * W);
  ctx.setTransform(s, 0, 0, s, -v.x * W * s, -v.y * H * s);
  ctx.imageSmoothingQuality = 'high';
  paintBanner(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view.hidden) { view.hidden = false; $('.tb-banner img')?.setAttribute('hidden', ''); }
}
window.addEventListener('resize', () => { paintBannerView(); renderSlots(); });

/** 글꼴을 바꾸면 읽힌 뒤에 한 번 더 그린다 (처음 쓰는 글꼴은 바로는 없다) */
function ensureFont(t) {
  document.fonts.load(fontSpec(t, 64), t.value || 'A').then(() => update()).catch(() => {});
}

// ── 제품 가져오기 ─────────────────────────────────────────

/**
 * 팝업 흐름 하나를 돌려 슬롯에 넣는다. 취소하면 아무것도 안 바꾼다.
 * keep 을 주면 결과에 빠진 정보(메타·이미지 목록)를 이전 것에서 이어받는다.
 */
async function runImport(i, flow, keep) {
  setStatus('');
  try {
    const out = await flow();
    if (!out) return;
    const slot = state.slots[i];
    if (!slot) return; // 그새 슬롯을 지웠다
    // 합성 엔진은 이미지 요소로 그리므로 미리 디코드해 둔다
    const img = await loadImage(out.src);
    slot.product = { ...out, img, meta: out.meta ?? keep?.meta, images: out.images ?? keep?.images };
    // 제품 사진이 바뀌었으니 화면 영역의 색도 새 사진에서 다시 읽는다
    if (slot.screen.quadN) sampleQuad(slot);
    state.active = i;
    update();
    const m = slot.product.meta;
    if (slot.kind === 'object') setStatus(`${slotLabel(i)} placed · ${slot.object.label}`, false, 'object');
    else setStatus(`${slotLabel(i)} placed · ${out.w} × ${out.h}px${m?.model ? ` · ${m.model}` : ''}`);
  } catch (err) {
    console.error(err);
    setStatus(`Image processing failed: ${err.message}`, true, state.slots[i]?.kind);
  }
}

/**
 * 오브젝트 슬롯을 하나 더 만들어 넣는다. 누끼·크롭 팝업 없이 투명 여백만 자른다.
 */
function placeObject(o) {
  const n = slotsOf('object').length;
  if (n >= MAX_OBJECTS) return setStatus(`Up to ${MAX_OBJECTS} objects — remove one first.`, true, 'object');
  const slot = newSlot(n, 'object');
  slot.object = o;
  slot.place.scale = o.scale;
  state.slots.push(slot);
  const i = state.slots.length - 1;
  state.active = i;
  buildProductList();
  update();
  runImport(i, async () => {
    const res = await fetch(`${ASSET_DIR}/${o.src}`);
    if (!res.ok) throw new Error(`Object load failed (${res.status})`);
    const original = await blobToDataUrl(await res.blob());
    const t = await trimTransparent(original);
    return { original, brushed: original, cropRect: null, src: t.dataUrl, w: t.width, h: t.height, meta: { name: o.label, model: 'Object' } };
  });
}

// ── 그림자 · 톤 ───────────────────────────────────────────

const SURFACE_HINT = {
  floor: 'Standing on the floor — fridges, washers, TVs on a stand.',
  wall: 'Mounted on the wall — wall TVs, air conditioners.',
  both: 'Standing on the floor in front of a wall.',
};
const activeFx = () => state.slots[state.active].fx;
const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, path, v) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((v2, k) => v2[k], o)[last] = v;
}

/** 패널을 활성 제품의 fx 값으로 맞춘다. */
function syncFxPanel() {
  const panel = $('#fxPanel');
  if (!panel) return;
  const fx = activeFx();
  $('#fxFor').textContent = slotLabel(state.active);
  panel.querySelectorAll('[data-seg]').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === fx[seg.dataset.seg]));
  });
  $('#surfaceHint').textContent = SURFACE_HINT[fx.surface];
  panel.querySelectorAll('[data-fx]').forEach(input => {
    const v = getPath(fx, input.dataset.fx);
    if (input.type === 'checkbox') input.checked = !!v;
    else {
      input.value = v;
      input.nextElementSibling.textContent = v;
    }
  });
  // 바닥 쪽 카드는 Wall 에서, 벽 카드는 Floor 에서 숨긴다
  panel.querySelectorAll('[data-show]').forEach(card => {
    card.hidden = card.dataset.show === 'floor' ? fx.surface === 'wall' : fx.surface === 'floor';
  });
  panel.querySelectorAll('[data-toggle]').forEach(card => card.classList.toggle('off', !getPath(fx, card.dataset.toggle)));

  $('#eraseToggle').classList.toggle('active', state.erasing);
  $('#eraseToggle').textContent = state.erasing ? 'Done erasing' : 'Paint to erase shadow';
  $('#eraseMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state.eraseMode));
  $('#eraseSize').value = state.eraseSize;
  $('#eraseSize').nextElementSibling.textContent = state.eraseSize;
  $('#eraseClear').hidden = !state.slots[state.active].eraser;
  const cursor = $('#brushCursor');
  if (cursor) cursor.classList.toggle('restore', state.eraseMode === 'restore');
}

// ── 그림자 지우개 ─────────────────────────────────────────

/** 활성 제품의 지우개 캔버스 (없으면 만든다). */
function activeEraser() {
  const slot = state.slots[state.active];
  if (!slot.eraser) {
    const c = document.createElement('canvas');
    c.width = state.bg.w;
    c.height = state.bg.h;
    slot.eraser = c;
  }
  return slot.eraser;
}

/** a → b 선을 따라 부드러운 원형 브러시로 칠한다. Erase 는 알파를 더하고, Restore 는 뺀다. */
function paintEraser(a, b) {
  const ctx = activeEraser().getContext('2d');
  const r = state.eraseSize / 2;
  ctx.globalCompositeOperation = state.eraseMode === 'erase' ? 'source-over' : 'destination-out';
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.25)));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  update();
}

/** 지우개 모드일 때 지운 자리를 붉게 비춰 보여준다. */
function drawEraseView() {
  const view = $('#eraseView');
  if (!view || !state.erasing) return;
  const ctx = view.getContext('2d');
  ctx.clearRect(0, 0, view.width, view.height);
  const er = state.slots[state.active].eraser;
  if (!er) return;
  ctx.drawImage(er, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(253, 49, 46, 0.35)';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalCompositeOperation = 'source-over';
}

function moveBrushCursor(e) {
  const overlay = $('#overlay');
  const rect = overlay.getBoundingClientRect();
  const d = state.eraseSize * (rect.width / state.bg.w);
  Object.assign($('#brushCursor').style, {
    left: `${e.clientX - rect.left}px`, top: `${e.clientY - rect.top}px`, width: `${d}px`, height: `${d}px`,
  });
  $('#brushCursor').hidden = false;
}

function setErasing(on) {
  if (on && !state.slots[state.active].product) return setStatus(`Add product ${state.active + 1} first.`, true);
  state.erasing = on;
  if (on) { state.picking = null; state.pickPts = []; state.sampling = false; }
  const cursor = $('#brushCursor');
  if (cursor) cursor.hidden = true;
  update();
  if (on) setStatus(`Erasing shadow of product ${state.active + 1}. Paint on the canvas, then click Done erasing (Esc).`);
}

// ── 화면 인필 ─────────────────────────────────────────────

const screenCache = new Map(); // 슬롯 → { key, layer, glow, pad }

/**
 * 화면 빛 번짐. 잘라 둔 영역을 제자리(quad)에 다시 끼운 레이어를 크게 흐린다 — 화면 자체는 그리지 않는다.
 * 제품이 같은 크기로 움직이는 동안은 다시 계산하지 않고 위치만 옮겨 그린다.
 */
function screenLayer(slot, rect) {
  const sc = slot.screen;
  if (!sc.quadN || !sc.infill) return null;
  const w = Math.max(1, Math.round(rect.w)), h = Math.max(1, Math.round(rect.h));
  const key = JSON.stringify([sc.infillId, w, h, sc.quadN.map(p => [p.x.toFixed(4), p.y.toFixed(4)])]);
  const hit = screenCache.get(slot);
  if (hit && hit.key === key) return hit;
  const quad = sc.quadN.map(p => ({ x: p.x * w, y: p.y * h }));
  const { layer } = warpInfill({ w, h }, sc.infill, quad, 'stretch');
  // 번짐은 제품 밖으로 퍼져야 하므로 여백을 둔 캔버스에서 만든다
  const pad = Math.round(Math.max(w, h) * 0.8);
  const padded = document.createElement('canvas');
  padded.width = w + pad * 2; padded.height = h + pad * 2;
  padded.getContext('2d').drawImage(layer, pad, pad);
  const out = { key, layer, glow: glowLayer(padded, 0.5), pad };
  screenCache.set(slot, out);
  return out;
}

/** 슬롯의 화면 네 모서리 (배경 좌표). 없으면 null */
function screenQuad(slot) {
  const r = productRect(slot);
  if (!r || !slot.screen.quadN) return null;
  return slot.screen.quadN.map(p => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h }));
}

/** 색 소스는 한 번에 하나 — 이 슬롯 말고 다른 제품에 잡힌 영역은 지운다. */
function keepOnlyScreen(slot) {
  for (const s of state.slots) if (s !== slot) Object.assign(s.screen, { quadN: null, infill: null, method: null });
}

/**
 * 슬롯의 영역(quadN)을 제품 사진에서 반듯한 사각형으로 펴서 잘라 색 소스(infill)로 둔다.
 * 네 모서리를 쌍선형으로 이어 픽셀을 집는다 — 비스듬히 찍어도 둘레의 베젤·배경이 덜 섞인다.
 */
function sampleQuad(slot) {
  const img = slot.product?.img, q = slot.screen.quadN;
  if (!img || !q) return;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = iw; src.height = ih;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const sd = sctx.getImageData(0, 0, iw, ih).data;
  // 결과 크기 — 위·왼쪽 변 길이 비율 그대로, 긴 쪽 400px (색 배치만 쓰므로 충분)
  const top = Math.hypot((q[1].x - q[0].x) * iw, (q[1].y - q[0].y) * ih);
  const left = Math.hypot((q[3].x - q[0].x) * iw, (q[3].y - q[0].y) * ih);
  const k = 400 / Math.max(top, left, 1);
  const w = Math.max(2, Math.round(top * k)), h = Math.max(2, Math.round(left * k));
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const px = ((1 - u) * (1 - v) * q[0].x + u * (1 - v) * q[1].x + u * v * q[2].x + (1 - u) * v * q[3].x) * iw;
      const py = ((1 - u) * (1 - v) * q[0].y + u * (1 - v) * q[1].y + u * v * q[2].y + (1 - u) * v * q[3].y) * ih;
      const sx = Math.min(iw - 1, Math.max(0, Math.round(px))), sy = Math.min(ih - 1, Math.max(0, Math.round(py)));
      const si = (sy * iw + sx) * 4, oi = (y * w + x) * 4;
      out.data[oi] = sd[si]; out.data[oi + 1] = sd[si + 1]; out.data[oi + 2] = sd[si + 2]; out.data[oi + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(out, 0, 0);
  slot.screen.infill = { canvas: c, w, h, data: out };
  slot.screen.infillId = Date.now();
}

function pickCorner(p) {
  state.pickPts.push(p);
  if (state.pickPts.length === 4) {
    const i = state.picking;
    const slot = state.slots[i];
    const r = productRect(slot);
    slot.screen.quadN = orderQuad(state.pickPts).map(q => ({ x: (q.x - r.x) / r.w, y: (q.y - r.y) / r.h }));
    slot.screen.method = 2;
    sampleQuad(slot);
    keepOnlyScreen(slot);
    state.picking = null;
    state.pickPts = [];
    setStatus(`Background now takes its colors from the marked area of product ${i + 1}.`, false, 'scene');
  }
  update();
}

function setPicking(on) {
  const slot = state.slots[state.active];
  if (on && !productRect(slot)) return setStatus(`Place product ${state.active + 1} first (Product & Shadow).`, true, 'scene');
  state.picking = on ? state.active : null;
  state.pickPts = [];
  if (on) { state.erasing = false; state.sampling = false; }
  update();
  if (on) setStatus(`Click four corners of the area on product ${state.active + 1} (any order). Esc cancels.`, false, 'scene');
}

/**
 * 제품 사진 속 화면 영역 찾기. 클릭한 점에서 시작해 "베젤이 아닌" 픽셀(밝거나 색이 있는)을
 * 이어 칠하고, 그 범위를 화면으로 본다 — 둘레의 검은 베젤에서 번짐이 멈춘다.
 * u, v: 제품 이미지 기준 0~1 클릭 위치. @returns 0~1 사각형 { x0, y0, x1, y1 } 또는 null
 */
function detectScreen(img, u, v) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const S = Math.min(1, 500 / Math.max(iw, ih));
  const w = Math.max(8, Math.round(iw * S)), h = Math.max(8, Math.round(ih * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const ok = i => {
    const p = i * 4;
    if (d[p + 3] < 200) return false;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return 0.299 * r + 0.587 * g + 0.114 * b > 40 || mx - mn > 40;
  };
  // 찍은 자리가 하필 어두운 픽셀이면 가까운 밝은 픽셀에서 시작한다
  let sx = Math.min(w - 1, Math.max(0, Math.round(u * w))), sy = Math.min(h - 1, Math.max(0, Math.round(v * h)));
  if (!ok(sy * w + sx)) {
    let best = null;
    const R = Math.round(Math.max(w, h) * 0.05);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || !ok(y * w + x)) continue;
      const dist = dx * dx + dy * dy;
      if (!best || dist < best.dist) best = { x, y, dist };
    }
    if (!best) return null;
    sx = best.x; sy = best.y;
  }
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[stack[0]] = 1;
  let x0 = sx, x1 = sx, y0 = sy, y1 = sy, n = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !seen[j] && ok(j)) { seen[j] = 1; stack.push(j); }
    }
  }
  // 너무 작으면 화면이 아니라 반사광 같은 조각을 찍은 것
  if (n < w * h * 0.02) return null;
  // 가장자리 안티에일리어싱 줄은 살짝 안으로
  const ix = (x1 - x0) * 0.01, iy = (y1 - y0) * 0.01;
  return { x0: (x0 + ix) / w, y0: (y0 + iy) / h, x1: (x1 + 1 - ix) / w, y1: (y1 + 1 - iy) / h };
}

/** 클릭한 제품의 화면을 찾아 그 화면 자체를 색 소스(인필)로 잡는다. 화면은 바꾸지 않는다. */
function sampleScreen(p) {
  // 위에 그려진(뒷번호) 제품부터 — 겹쳐 있으면 보이는 쪽을 집는다
  let i = -1, r = null;
  for (let k = state.slots.length - 1; k >= 0; k--) {
    const rk = productRect(state.slots[k]);
    if (rk && p.x >= rk.x && p.x <= rk.x + rk.w && p.y >= rk.y && p.y <= rk.y + rk.h) { i = k; r = rk; break; }
  }
  if (i < 0) return setStatus('Click on the screen of a product.', true, 'scene');
  const slot = state.slots[i];
  const img = slot.product.img;
  const box = detectScreen(img, (p.x - r.x) / r.w, (p.y - r.y) / r.h);
  if (!box) return setStatus('Could not find a screen there. Click the middle of the TV screen, or mark it with Screen Select 2.', true, 'scene');
  slot.screen.quadN = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  slot.screen.method = 1;
  sampleQuad(slot);
  keepOnlyScreen(slot);
  state.active = i;
  state.sampling = false;
  update();
  setStatus(`Background now takes its colors from ${slotLabel(i)}'s screen.`, false, 'scene');
}

function setSampling(on) {
  if (on && !state.slots.some(s => productRect(s))) return setStatus('Place a product first (Product & Shadow).', true, 'scene');
  state.sampling = on;
  if (on) { state.erasing = false; state.picking = null; state.pickPts = []; }
  update();
  if (on) setStatus('Click the TV screen on the canvas. Esc cancels.', false, 'scene');
}

// ── 배경 컬러 (Color mood) ────────────────────────────────

/** 색을 가져올 슬롯 — 화면 영역이 잡힌 제품 (한 번에 하나뿐이다) */
function moodSourceSlot() {
  return state.slots.find(s => s.screen.infill && s.screen.quadN && productRect(s)) || null;
}

const moodCache = { key: null, bg: null, fieldKey: null, field: null, objKey: null, objData: null };

/**
 * 인필 색으로 물든 배경 (createBackground 형태 — 그림자 색도 물든 배경을 따른다).
 * 바뀐 입력이 없으면 캐시를 그대로 쓴다. 색을 뽑는 TV 를 끄는 동안(드래그)은 다시 계산하지
 * 않고, 손을 뗄 때 한 번 계산한다 — 2~3백 ms 걸려서 드래그가 끊기면 안 되기 때문.
 */
function coloredBackground() {
  const m = state.mood;
  const src = m.on ? moodSourceSlot() : null;
  if (!src || m.strength <= 0) return null;
  const { w, h } = state.bg;
  const quad = screenQuad(src);
  const cx = quad.reduce((a, p) => a + p.x, 0) / 4, cy = quad.reduce((a, p) => a + p.y, 0) / 4;
  const srcRect = productRect(src);
  const key = JSON.stringify([
    state.bg.id, src.screen.infillId, m.strength, m.vivid, m.objectAmount, state.objVersion,
    Math.round(cx / 8), Math.round(cy / 8), m.centerClear, m.floorAmount, Math.round((srcRect.y + srcRect.h) / 8),
  ]);
  if (key === moodCache.key) return moodCache.bg;
  if (gesture && gesture.kind === 'move' && moodCache.bg && moodCache.srcId === src.screen.infillId && moodCache.bgId === state.bg.id) return moodCache.bg;

  const fk = `${src.screen.infillId}:${m.vivid}:${state.bg.id}`;
  if (fk !== moodCache.fieldKey) { moodCache.fieldKey = fk; moodCache.field = colorField(src.screen.infill, w, h, m.vivid / 100); }
  if (moodCache.objKey !== state.objVersion) {
    moodCache.objKey = state.objVersion;
    moodCache.objData = state.objects ? state.objects.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data : null;
  }
  const data = adjustBackground(state.bg.scene, {
    mode: 'palette', strength: m.strength / 100, saturation: 0, protectNeutrals: true,
    from: { h: 0, s: 0 }, to: { h: 0, s: 0 },
    field: moodCache.field,
    objectAmount: m.objectAmount / 100,
    weightMap: null,
    center: { x: cx, y: cy, r: (m.centerClear / 100) * 0.7 * Math.hypot(w, h) },
    // 바닥선 = 색을 뽑는 제품의 발끝. 그 아래(바닥)는 Floor tint 만큼만
    floor: { y: srcRect.y + srcRect.h, amount: m.floorAmount / 100 },
  }, null, moodCache.objData);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(data, 0, 0);
  moodCache.key = key;
  moodCache.srcId = src.screen.infillId;
  moodCache.bgId = state.bg.id;
  moodCache.bg = createBackground(c);
  return moodCache.bg;
}

/** Scene Color 패널 · 화면 모서리 핸들을 지금 상태로 맞춘다. */
function syncScene() {
  const ov = $('#overlay');
  if (ov) {
    ov.classList.toggle('picking', state.picking !== null || state.sampling);
    // 화면 모서리 핸들 — 찍는 중이면 찍은 점, 아니면 활성 제품의 네 점
    const slot = state.slots[state.active];
    const pts = state.picking !== null ? state.pickPts : (screenQuad(slot) || []);
    const handles = $('#handles');
    while (handles.children.length < pts.length) { const hd = document.createElement('div'); hd.className = 'handle'; handles.append(hd); }
    while (handles.children.length > pts.length) handles.lastElementChild.remove();
    if (state.bg) {
      pts.forEach((p, k) => {
        const hd = handles.children[k];
        hd.dataset.k = k;
        hd.textContent = state.picking === null ? k + 1 : '';
        hd.style.left = pct(p.x, state.bg.w);
        hd.style.top = pct(p.y, state.bg.h);
      });
      // 가이드 사각형은 Scene Color 박스가 열려 있을 때만 — 결과를 볼 때 거슬리지 않게
      ov.classList.toggle('screen-guides', state.open.has('scene') || state.picking !== null);
      $('#quadSvg').setAttribute('viewBox', `0 0 ${state.bg.w} ${state.bg.h}`);
      $('#quadSvg polygon').setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    }
  }

  if (!$('#screenPanel')) return;
  const sc = state.slots[state.active].screen;
  $('#screenFor').textContent = slotLabel(state.active);
  $('#sampleScreen').classList.toggle('active', state.sampling);
  $('#sampleScreen').textContent = state.sampling ? 'Click the TV screen on the canvas…' : sc.method === 1 ? 'Click the screen again' : 'Click the screen';
  $('#setCorners').classList.toggle('active', state.picking !== null);
  $('#setCorners').textContent = state.picking !== null ? `Click point ${state.pickPts.length + 1} of 4…` : sc.method === 2 ? 'Set four points again' : 'Set four points';
  // 지금 쓰는 방법의 카드에 불 — 고르는 중이면 그 방법
  const on = state.sampling ? 1 : state.picking !== null ? 2 : sc.method;
  $('#method1').classList.toggle('on', on === 1);
  $('#method2').classList.toggle('on', on === 2);
  $('.tb-clear-screen').hidden = !(sc.quadN || sc.infill);

  const m = state.mood;
  $('#moodPanel').classList.toggle('off', !m.on);
  document.querySelectorAll('[data-mseg="on"] button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'after') === m.on));
  $('#moodSourceHint').hidden = !!moodSourceSlot();
  document.querySelectorAll('[data-m]').forEach(input => { input.value = m[input.dataset.m]; input.nextElementSibling.textContent = m[input.dataset.m]; });
}

// ── 이벤트: 팔레트 · 기능 박스 ────────────────────────────

$('#palette').addEventListener('click', e => {
  const cell = e.target.closest('.tb-cell');
  if (!cell) return;
  // 같은 타일을 다시 누르면 선택 해제 (BF 와 동일)
  selectAsset(state.selectedId === cell.dataset.id ? null : cell.dataset.id);
});

const editBody = $('#editBody');

// Copy 패널 입력 — 다시 그릴 때마다 묶지 않도록 editBody 에 한 번만 건다 (안에서 .cc 만 본다)
bindCopyPanel(editBody, state.copy, () => { renderEdit(); renderSlots(); }, () => renderSlots());

editBody.addEventListener('click', e => {
  // 기능 박스 펼치기/접기 — 다시 그리지 않고 클래스만 바꿔야 높이 전환이 보인다
  const head = e.target.closest('.tb-acc-head');
  if (head) {
    const sec = head.parentElement;
    const key = sec.dataset.key;
    if (PINNED.has(key)) return;
    const open = !state.open.has(key);
    if (open) state.open.add(key); else state.open.delete(key);
    sec.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
    syncScene();
    syncText();
    return;
  }

  const tab = e.target.closest('[data-tab]');
  if (tab) { state.active = Number(tab.dataset.tab); update(); return; }

  const segBtn = e.target.closest('#fxPanel [data-seg] button');
  if (segBtn) { activeFx()[segBtn.closest('[data-seg]').dataset.seg] = segBtn.dataset.v; update(); return; }

  const modeBtn = e.target.closest('#eraseMode button');
  if (modeBtn) { state.eraseMode = modeBtn.dataset.v; update(); return; }

  const baBtn = e.target.closest('[data-mseg="on"] button');
  if (baBtn) { state.mood.on = baBtn.dataset.v === 'after'; update(); return; }

  // 글자 색 — 색 견본. Custom 은 안의 색 고르개가 열리고 값은 input 이벤트로 들어온다
  const sw = e.target.closest('[data-tstyle]');
  if (sw && activeText()) { activeText().style = sw.dataset.tstyle; update(); return; }


  const ob = e.target.closest('[data-object]');
  if (ob) { placeObject(OBJECTS.find(o => o.id === ob.dataset.object)); return; }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const row = e.target.closest('.product-row, .tb-placed-item');
  const i = row ? Number(row.dataset.i) : state.active;
  const slot = state.slots[i];
  switch (act) {
    case 'add-product': {
      const n = slotsOf('product').length;
      if (n >= MAX_PRODUCTS) return;
      state.slots.push(newSlot(n));
      state.active = state.slots.length - 1;
      buildProductList();
      update();
      break;
    }
    case 'drop-slot':
    case 'drop-object':
      if (act === 'drop-slot' && slot.product && !confirm(`Remove ${slotLabel(i)}?`)) return;
      state.slots.splice(i, 1);
      // 지운 자리 뒤를 고르고 있었으면 한 칸 당겨진다
      if (state.active > i) state.active--;
      state.active = Math.min(state.active, state.slots.length - 1);
      // 번호가 당겨지니 "Object 3 placed" 같은 지난 문구는 지운다
      setStatus('', false, slot.kind);
      buildProductList();
      update();
      break;
    case 'edit':
      if (slot.product) runImport(i, () => editProduct(slot.product), slot.product);
      break;
    case 'remove':
      slot.product = null;
      update();
      break;
    case 'change':
      runImport(i, () => importFromUrl(slot.url, { images: slot.product?.images }), slot.product);
      break;
    case 'reset-pos':
      Object.assign(slot.place, newSlot(kindNo(i) - 1).place, slot.object ? { scale: slot.object.scale } : {});
      update();
      break;
    case 'fx-reset':
      state.slots[state.active].fx = cloneFx(DEFAULT_FX);
      update();
      break;
    case 'fx-all': {
      const src = activeFx();
      state.slots.forEach(s => { s.fx = cloneFx(src); });
      update();
      setStatus(`Shadow & tone settings of ${slotLabel(state.active)} applied to all ${state.slots.length} products and objects.`);
      break;
    }
    case 'erase-toggle':
      setErasing(!state.erasing);
      break;
    case 'erase-clear':
      state.slots[state.active].eraser = null;
      update();
      break;
    case 'sample-screen':
      setSampling(!state.sampling);
      break;
    case 'set-corners':
      setPicking(state.picking === null);
      break;
    case 'text-reset': {
      const hit = findAsset(state.selectedId);
      if (hit?.asset.banner) { state.texts[hit.asset.base] = newText(hit.asset); ensureFont(activeText()); update(); }
      break;
    }
    case 'clear-screen':
      Object.assign(state.slots[state.active].screen, { quadN: null, infill: null, method: null });
      state.picking = null;
      state.pickPts = [];
      update();
      break;
  }
});

editBody.addEventListener('submit', e => {
  const form = e.target.closest('.url-form');
  if (!form) return;
  e.preventDefault();
  const i = Number(form.closest('.product-row').dataset.i);
  runImport(i, () => importFromUrl(form.querySelector('input').value.trim()));
});

editBody.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('.url-form input')) {
    const slot = state.slots[Number(t.closest('.product-row').dataset.i)];
    slot.url = t.value;
    // URL 을 바꾸면 이전 크롤링 목록은 더 이상 이 URL 것이 아니다
    if (slot.product) slot.product.images = null;
    syncProductList();
    return;
  }
  if (t.dataset.t && activeText()) {
    const tx = activeText();
    const k = t.dataset.t;
    tx[k] = t.type === 'range' ? Number(t.value) : t.value;
    if (k === 'color') tx.style = 'custom';
    if (k === 'font' || k === 'value') ensureFont(tx);
    update();
    return;
  }
  if (t.id === 'scale') { state.slots[state.active].place.scale = Number(t.value) / 100; update(); return; }
  if (t.id === 'eraseSize') { state.eraseSize = Number(t.value); update(); return; }
  if (t.dataset.m) { state.mood[t.dataset.m] = Number(t.value); update(); return; }
  const path = t.dataset.fx;
  if (path) { setPath(activeFx(), path, t.type === 'checkbox' ? t.checked : Number(t.value)); update(); }
});

editBody.addEventListener('change', async e => {
  const t = e.target;
  if (t.type !== 'file') return;
  const file = t.files[0];
  t.value = '';
  if (!file) return;
  if (t.closest('.product-row')) {
    runImport(Number(t.closest('.product-row').dataset.i), () => importFromFile(file));
  }
});

// ── 이벤트: 캔버스 (제품 끌기 · 지우개) ───────────────────

/** 화면 좌표 → 배경 픽셀 좌표 (장면이 창보다 커서 잘려 있어도 그대로 맞는다) */
function toBg(e) {
  const rect = $('#overlay').getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(state.bg.w, (e.clientX - rect.left) * (state.bg.w / rect.width))),
    y: Math.max(0, Math.min(state.bg.h, (e.clientY - rect.top) * (state.bg.h / rect.height))),
  };
}

let gesture = null; // { kind: 'move', i, from, dx, dy } | { kind: 'erase', last } | { kind: 'corner', i, k }

const canvasEl = $('#canvas');
// Channel List 버튼 — 이미지 편집을 마치고 누르면 3 단계(Select Channel)로 넘어가 매체 목록이 열린다
canvasEl.addEventListener('click', e => {
  if (e.target.closest('[data-act="open-channels"]')) goStep(2);
});

// 매체 알약 — 하나만 고른다, 한 번 더 누르면 해제
canvasEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-channel]');
  if (!btn) return;
  state.channel = state.channel === btn.dataset.channel ? null : btn.dataset.channel;
  canvasEl.querySelectorAll('[data-channel]').forEach(b => b.classList.toggle('on', b.dataset.channel === state.channel));
  // 고르면 4 (Edit), 풀면 3 (Select Channel) 에 머문다
  state.step = state.channel ? 3 : 2;
  renderSteps();
  renderEdit();
  buildProductList();
  update();
});

// 합성 예시 토글 — 누르면 그 예시 컷을 미리보기·Edit panel 위에 덮고, 한 번 더 누르면 편집 화면으로 돌아온다
canvasEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-example]');
  if (!btn) return;
  state.example = state.example === btn.dataset.example ? null : btn.dataset.example;
  syncExample();
});

function syncExample() {
  const img = $('#exampleImg');
  const asset = findAsset(state.selectedId)?.asset;
  if (!img || !asset) return;
  const frame = $('#exampleFrame');
  if (state.example) {
    img.src = exampleUrl(asset, state.example);
    if (frame) frame.src = `${ASSET_DIR}/${asset.id}-ex-${state.example}-frame.jpg`;
  }
  img.hidden = !state.example;
  if (frame) frame.hidden = !state.example;
  canvasEl.querySelectorAll('[data-example]').forEach(b => b.classList.toggle('on', b.dataset.example === state.example));
}
// 배너 텍스트 끌기 — 자리는 바탕 대비 비율. 2 단계(Image Edit)에서만 — 3 단계부터는 자리가 고정된다
canvasEl.addEventListener('pointerdown', e => {
  const box = e.target.closest('#textBox');
  const t = activeText();
  if (!box || !t || !state.banner || state.step !== 1) return;
  e.preventDefault();
  const ov = $('#bannerOverlay');
  ov.setPointerCapture(e.pointerId);
  const r = ov.getBoundingClientRect();
  const move = ev => {
    t.x = Math.min(1, Math.max(0, x0 + (ev.clientX - e.clientX) / r.width));
    t.y = Math.min(1, Math.max(0, y0 + (ev.clientY - e.clientY) / r.height));
    update();
  };
  const x0 = t.x, y0 = t.y;
  const up = () => { ov.removeEventListener('pointermove', move); ov.removeEventListener('pointerup', up); ov.classList.remove('dragging'); };
  ov.classList.add('dragging');
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerup', up);
});

canvasEl.addEventListener('pointerdown', e => {
  const overlay = e.target.closest('#overlay');
  // 제품·오브젝트도 2 단계(Image Edit)에서만 옮긴다
  if (!overlay || !state.bg || state.step !== 1) return;
  if (state.sampling) {
    sampleScreen(toBg(e));
    return;
  }
  if (state.picking !== null) {
    pickCorner(toBg(e));
    return;
  }
  const handle = e.target.closest('.handle');
  if (handle) {
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    gesture = { kind: 'corner', i: state.active, k: Number(handle.dataset.k) };
    return;
  }
  if (state.erasing) {
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    const p = toBg(e);
    gesture = { kind: 'erase', last: p };
    paintEraser(p, p);
    return;
  }
  const target = e.target.closest('.product');
  if (!target) return;
  e.preventDefault();
  overlay.setPointerCapture(e.pointerId);
  const i = Number(target.dataset.i);
  const { dx, dy } = state.slots[i].place;
  gesture = { kind: 'move', i, from: toBg(e), dx, dy };
  state.active = i;
  update();
});

canvasEl.addEventListener('pointermove', e => {
  if (!e.target.closest('#overlay') || !state.bg) return;
  if (state.erasing) moveBrushCursor(e);
  if (!gesture) return;
  const p = toBg(e);
  if (gesture.kind === 'corner') {
    const slot = state.slots[gesture.i];
    const r = productRect(slot);
    if (r) slot.screen.quadN[gesture.k] = { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h };
    update();
    return;
  }
  if (gesture.kind === 'erase') {
    paintEraser(gesture.last, p);
    gesture.last = p;
    return;
  }
  // 위치는 배경 대비 비율로 — 다른 에셋으로 바꿔도 같은 자리에 선다
  const place = state.slots[gesture.i].place;
  place.dx = gesture.dx + (p.x - gesture.from.x) / state.bg.w;
  place.dy = gesture.dy + (p.y - gesture.from.y) / state.bg.h;
  update();
});

canvasEl.addEventListener('pointerup', () => {
  const moved = gesture?.kind === 'move';
  if (gesture?.kind === 'corner') {
    const slot = state.slots[gesture.i];
    slot.screen.method = 2; // 손으로 고친 영역
    sampleQuad(slot);
    gesture = null;
    update();
    return;
  }
  gesture = null;
  // 끄는 동안 미뤄 둔 배경 색 계산을 손을 뗄 때 한 번 한다
  if (moved) update();
});
canvasEl.addEventListener('pointerleave', () => { const c = $('#brushCursor'); if (c) c.hidden = true; }, true);

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || document.querySelector('.pi-backdrop')) return;
  if (state.erasing) setErasing(false);
  if (state.picking !== null) { state.picking = null; state.pickPts = []; update(); }
  if (state.sampling) setSampling(false);
});

// ── 다운로드 — 정사각 전체를 원본 해상도로 ───────────────────

$('#download').addEventListener('click', () => {
  if (activeText() && state.banner?.assetId === state.selectedId) {
    const out = document.createElement('canvas');
    out.width = state.banner.w;
    out.height = state.banner.h;
    paintBanner(out.getContext('2d'));
    out.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `christmas-${state.selectedId}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
    return;
  }
  const comp = $('#comp');
  if (!comp || !state.bg) return;
  // 화면용 캔버스를 그대로 쓰면 지우개 표시 등과 섞일 일이 없도록 새로 그린다
  const out = document.createElement('canvas');
  out.width = state.bg.w;
  out.height = state.bg.h;
  paint(out.getContext('2d'));
  out.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `christmas-${state.selectedId}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

/**
 * 사이드바 폭 드래그 — 값은 localStorage 에 남기고, 더블클릭하면 기본값으로.
 * side: 오른쪽으로 끌 때 폭이 늘어나는 쪽이 'left'.
 */
function dragWidth(panel, handle, key, initial, min, max, side) {
  const apply = w => { panel.style.width = `${w}px`; };
  let w = initial;
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved >= min && saved <= max) w = saved;
  } catch { /* storage unavailable */ }
  apply(w);
  const save = () => { try { localStorage.setItem(key, String(w)); } catch { /* ignore */ } };

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = w;
    handle.classList.add('dragging');
    const move = ev => {
      const d = ev.clientX - x0;
      w = Math.min(max, Math.max(min, side === 'left' ? w0 + d : w0 - d));
      apply(w);
    };
    const up = () => {
      handle.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      save();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  handle.addEventListener('dblclick', () => { w = initial; apply(w); save(); });
}

dragWidth($('#leftPanel'), $('#leftDrag'), 'tib.leftW', 320, 256, 520, 'left');
dragWidth($('#rightPanel'), $('#rightDrag'), 'tib.rightW', 384, 300, 640, 'right');

selectAsset(null);

// 구워 둔 에셋 목록을 읽고 팔레트를 다시 그린다 (스크립트를 다시 돌린 뒤 새로고침하면 반영)
fetch(`${ASSET_DIR}/manifest.json`, { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : []))
  .then(list => {
    manifest = new Map(list.map(m => [m.id, m]));
    renderPalette();
  })
  .catch(err => console.error('[manifest]', err));
