// 국가(법인) 선택 목록 — Builder Hub(12 All/public/regions.js)와 **같은 목록**이다.
// 허브에서 나라를 고치면 여기도 똑같이 고친다 (세일즈·블프·크리스마스 빌더 모두).
//
// 지역(아코디언) > 국가, 지역 안에서는 ABC 순. 지역 구분은 lg.com Select your region 과 같다.
// code 는 빌더 stats 에 "지역/국가" 로 찍힌다 (예: ASIA/KR).
// 국가는 ISO 3166 두 글자.
export const REGIONS = [
  {
    name: 'Asia', code: 'ASIA',
    countries: [
      ['Australia', 'AU'], ['China', 'CN'], ['Hong Kong', 'HK'], ['India', 'IN'], ['Indonesia', 'ID'], ['Japan', 'JP'],
      ['Korea', 'KR'], ['Malaysia', 'MY'], ['Philippines', 'PH'], ['Singapore', 'SG'], ['Taiwan', 'TW'], ['Thailand', 'TH'],
      ['Vietnam', 'VN'],
    ],
  },
  {
    name: 'Europe', code: 'EUROPE',
    countries: [
      ['Austria', 'AT'], ['Belgium', 'BE'], ['Czech Republic', 'CZ'], ['Denmark', 'DK'], ['France', 'FR'],
      ['Germany', 'DE'], ['Hungary', 'HU'], ['Italy', 'IT'], ['Netherlands', 'NL'], ['Poland', 'PL'],
      ['Portugal', 'PT'], ['Spain', 'ES'], ['Sweden', 'SE'], ['Switzerland', 'CH'], ['United Kingdom', 'GB'],
    ],
  },
  {
    name: 'Middle East & Africa', code: 'MEA',
    countries: [
      ['Egypt', 'EG'], ['Morocco', 'MA'], ['Saudi Arabia', 'SA'], ['South Africa', 'ZA'], ['Türkiye', 'TR'],
      ['U.A.E', 'AE'],
    ],
  },
  {
    name: 'North America', code: 'N.AMERICA',
    countries: [['Canada', 'CA'], ['Mexico', 'MX'], ['U.S.A', 'US']],
  },
  {
    name: 'Central America and Caribbean', code: 'CAC',
    countries: [['Panama', 'PA']],
  },
  {
    name: 'South America', code: 'S.AMERICA',
    countries: [['Brazil', 'BR'], ['Chile', 'CL'], ['Colombia', 'CO'], ['Peru', 'PE']],
  },
  {
    name: 'CIS', code: 'CIS',
    countries: [['Kazakhstan', 'KZ'], ['Russia', 'RU']],
  },
];
