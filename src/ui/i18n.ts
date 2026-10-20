// All UI text, in Chinese, English and Japanese, from one dictionary. Every key exists in every language (a test
// checks it). In-world signs are bilingual on the texture: a local line over an English line, like real expressway
// signs. The local line is Chinese (this is a Chinese highway) unless the UI is Japanese: then it is Japanese, like
// signs in Japan (sign(), signPrice()).
export type Lang = 'zh' | 'en' | 'ja';

const zh = {
  title: '飞跃收费站',
  subtitle: 'RDSTR · SpaceX 冷气推进套件',
  start: '按 Enter / 点击 开始',
  loading: '正在预热着色器…',
  'ctl.k0': 'W / ↑', 'ctl.d0': '加速',
  'ctl.k1': 'S / ↓', 'ctl.d1': '刹车；空中开着推进器时按住 = 定点悬停',
  'ctl.k2': 'A D / ← →', 'ctl.d2': '转向',
  'ctl.k3': '空格（按住）', 'ctl.d3': '冷气推进：升空、悬停；在墙上 = 脱离',
  'ctl.k4': 'Shift', 'ctl.d4': '后向喷气加速（最高约 380 km/h）',
  'ctl.k5': 'F', 'ctl.d5': '吸附 开 / 关（车自带的风扇系统）',
  'ctl.k6': 'Q / E', 'ctl.d6': '空中桶滚（落地前必须转完）',
  'ctl.k7': 'C', 'ctl.d7': '镜头：追尾 / 侧拍 / 无人机',
  'ctl.k8': 'L', 'ctl.d8': '切换语言：中文 / English / 日本語',
  'ctl.k9': 'Esc · M · R', 'ctl.d9': '暂停 · 静音 · 重来',
  'hud.score': '得分',
  'hud.lives': '生命',
  'hud.saved': '累计逃费',
  'hud.sucOn': '吸附 开',
  'hud.sucOff': '吸附 关',
  'hud.sucWarn': '吸附未开启 / SUCTION OFF',
  'popup.flyover': '飞跃收费站！省下 {0}',
  'popup.jump': '跳过收费杆！逃费 {0}',
  'popup.ram': '冲卡！罚款 {0}',
  'popup.etc': 'ETC 扣费 {0}',
  'popup.nearMiss': '擦肩 +100',
  'popup.roll': '桶滚 +500',
  'popup.crash': '撞车！',
  'popup.rollCrash': '翻滚中着陆！',
  'popup.landing': '平稳着陆',
  'popup.detach': '脱离 · 推进器点火',
  'popup.stunt': '特技完成 +2500',
  'popup.suctionOn': '吸附已开启',
  'popup.suctionOff': '吸附已关闭',
  'popup.arenaHint': '按 F 开启吸附 · W 上墙 · 空格脱离',
  'popup.gameOver': '车毁人亡',
  'screen.pauseTitle': '已暂停',
  'screen.overTitle': '游戏结束',
  'screen.resume': '继续',
  'screen.restart': '重新开始',
  'screen.distance': '行驶距离',
  'screen.tolls': '逃费次数',
  'screen.saved': '省下',
  'screen.fines': '罚款',
  'screen.best': '最高分',
  'screen.score': '得分',
  'screen.stunts': '特技',
  'screen.newBest': '新纪录',
  'screen.hintResume': 'Esc 继续 · R 重来',
  'screen.hintRestart': '按 R / 点击 重新开始',
  'cam.chase': '追尾镜头',
  'cam.side': '侧拍镜头',
  'cam.drone': '无人机镜头',
  'touch.brake': '刹',
  'touch.thrust': '推',
  'touch.boost': '冲',
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  title: 'TOLL JUMP',
  subtitle: 'RDSTR · SpaceX COLD-GAS THRUSTER PACKAGE',
  start: 'Press Enter / click to start',
  loading: 'Warming up shaders…',
  'ctl.k0': 'W / ↑', 'ctl.d0': 'Accelerate',
  'ctl.k1': 'S / ↓', 'ctl.d1': 'Brake; hold in the air with thrusters on = hover in place',
  'ctl.k2': 'A D / ← →', 'ctl.d2': 'Steer',
  'ctl.k3': 'Space (hold)', 'ctl.d3': 'Thrusters: lift and hover; on the wall = detach',
  'ctl.k4': 'Shift', 'ctl.d4': 'Rear boost jets (up to about 380 km/h)',
  'ctl.k5': 'F', 'ctl.d5': 'Suction on / off (the car\'s own fan system)',
  'ctl.k6': 'Q / E', 'ctl.d6': 'Barrel roll in the air (finish it before landing)',
  'ctl.k7': 'C', 'ctl.d7': 'Camera: chase / side / drone',
  'ctl.k8': 'L', 'ctl.d8': 'Switch language: 中文 / English / 日本語',
  'ctl.k9': 'Esc · M · R', 'ctl.d9': 'Pause · mute · restart',
  'hud.score': 'SCORE',
  'hud.lives': 'LIVES',
  'hud.saved': 'TOLL SAVED',
  'hud.sucOn': 'SUCTION ON',
  'hud.sucOff': 'SUCTION OFF',
  'hud.sucWarn': 'SUCTION OFF',
  'popup.flyover': 'Flew over the toll station! Saved {0}',
  'popup.jump': 'Cleared the boom! Skipped {0}',
  'popup.ram': 'Ran the gate! Fined {0}',
  'popup.etc': 'ETC: {0} paid',
  'popup.nearMiss': 'Close call +100',
  'popup.roll': 'Barrel roll +500',
  'popup.crash': 'Crash!',
  'popup.rollCrash': 'Landed mid-roll!',
  'popup.landing': 'Soft landing',
  'popup.detach': 'Detached · thrusters firing',
  'popup.stunt': 'Stunt complete +2500',
  'popup.suctionOn': 'Suction on',
  'popup.suctionOff': 'Suction off',
  'popup.arenaHint': 'F suction · W climb · Space detach',
  'popup.gameOver': 'Wrecked',
  'screen.pauseTitle': 'PAUSED',
  'screen.overTitle': 'GAME OVER',
  'screen.resume': 'Resume',
  'screen.restart': 'Restart',
  'screen.distance': 'Distance',
  'screen.tolls': 'Tolls skipped',
  'screen.saved': 'Saved',
  'screen.fines': 'Fines',
  'screen.best': 'Best',
  'screen.score': 'Score',
  'screen.stunts': 'Stunts',
  'screen.newBest': 'New record',
  'screen.hintResume': 'Esc resume · R restart',
  'screen.hintRestart': 'Press R / click to restart',
  'cam.chase': 'Chase camera',
  'cam.side': 'Side camera',
  'cam.drone': 'Drone camera',
  'touch.brake': 'BRAKE',
  'touch.thrust': 'LIFT',
  'touch.boost': 'BOOST',
};

const ja: Record<Key, string> = {
  title: '料金所ジャンプ',
  subtitle: 'RDSTR · SpaceX パッケージ（コールドガス・スラスター）',
  start: 'Enter キーまたはクリックでスタート',
  loading: 'グラフィックを準備中…',
  'ctl.k0': 'W / ↑', 'ctl.d0': 'アクセル',
  'ctl.k1': 'S / ↓', 'ctl.d1': 'ブレーキ（噴射中に長押しするとその場でホバリング）',
  'ctl.k2': 'A D / ← →', 'ctl.d2': 'ハンドル',
  'ctl.k3': 'スペース（長押し）', 'ctl.d3': 'スラスター噴射：上昇・ホバリング（壁面では離脱）',
  'ctl.k4': 'Shift', 'ctl.d4': 'リアスラスターで加速（最高 約380 km/h）',
  'ctl.k5': 'F', 'ctl.d5': '吸着オン / オフ（車体下のファンで路面や壁に吸い付く）',
  'ctl.k6': 'Q / E', 'ctl.d6': '空中でバレルロール（着地前に回り切ること）',
  'ctl.k7': 'C', 'ctl.d7': 'カメラ切替：チェイス / サイド / ドローン',
  'ctl.k8': 'L', 'ctl.d8': '言語切替：中文 / English / 日本語',
  'ctl.k9': 'Esc · M · R', 'ctl.d9': 'ポーズ · ミュート · リスタート',
  'hud.score': 'スコア',
  'hud.lives': 'ライフ',
  'hud.saved': '浮いた通行料',
  'hud.sucOn': '吸着オン',
  'hud.sucOff': '吸着オフ',
  'hud.sucWarn': '吸着オフ / SUCTION OFF',
  'popup.flyover': '料金所を飛び越えた！{0}浮いた',
  'popup.jump': '開閉バーを飛び越えた！{0}踏み倒し',
  'popup.ram': '強行突破！罰金 {0}',
  'popup.etc': 'ETC 料金 {0}',
  'popup.nearMiss': 'ニアミス +100',
  'popup.roll': 'バレルロール +500',
  'popup.crash': 'クラッシュ！',
  'popup.rollCrash': '回転中に着地！',
  'popup.landing': 'ソフトランディング',
  'popup.detach': '離脱 · スラスター噴射',
  'popup.stunt': 'スタント成功 +2500',
  'popup.suctionOn': '吸着オン',
  'popup.suctionOff': '吸着オフ',
  'popup.arenaHint': 'F 吸着 · W 壁を登る · スペース 離脱',
  'popup.gameOver': '大破',
  'screen.pauseTitle': 'ポーズ中',
  'screen.overTitle': 'ゲームオーバー',
  'screen.resume': '続ける',
  'screen.restart': 'リスタート',
  'screen.distance': '走行距離',
  'screen.tolls': '踏み倒し回数',
  'screen.saved': '浮いた通行料',
  'screen.fines': '罰金',
  'screen.best': 'ハイスコア',
  'screen.score': 'スコア',
  'screen.stunts': 'スタント',
  'screen.newBest': '新記録',
  'screen.hintResume': 'Esc で続ける · R でリスタート',
  'screen.hintRestart': 'R キーまたはクリックでリスタート',
  'cam.chase': 'チェイスカメラ',
  'cam.side': 'サイドカメラ',
  'cam.drone': 'ドローンカメラ',
  'touch.brake': '減速',
  'touch.thrust': '噴射',
  'touch.boost': '加速',
};

export const dict = { zh, en, ja } as const;
export type DictKey = Key;

/** The order L and the language button cycle through, the button labels, and the <html lang> value. */
export const LANGS: readonly Lang[] = ['zh', 'en', 'ja'];
export const LANG_LABEL: Record<Lang, string> = { zh: '中文', en: 'EN', ja: '日本語' };
export const HTML_LANG: Record<Lang, string> = { zh: 'zh-CN', en: 'en', ja: 'ja' };
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

/** Bilingual in-world sign text: [Chinese line, English line]. */
export const SIGNS = {
  fascia: ['火星高速 · 星舰收费站', 'MARS EXPRESSWAY · STARSHIP TOLL STATION'] as [string, string],
  ahead: ['前方收费站 500m', 'TOLL STATION AHEAD 500 m'] as [string, string],
  etcAhead: ['ETC 通道 收费站 250m', 'ETC LANES · TOLL 250 m'] as [string, string],
  etc: ['ETC', 'ETC'] as [string, string],
  etcLanes: ['ETC 通道', 'ETC LANES'] as [string, string],
  price: (p: number): [string, string] => [`小型车 ¥${p}`, `CAR ¥${p}`],
  exitFar: ['特技场出口 1 km', 'STUNT ARENA EXIT 1 km'] as [string, string],
  exitNear: ['特技场出口 500 m', 'STUNT ARENA EXIT 500 m'] as [string, string],
  arena: ['特技场', 'STUNT ARENA'] as [string, string],
  gateOut: ['出口 回高速', 'EXIT TO HIGHWAY'] as [string, string],
  backOn: ['回到高速', 'BACK ON THE HIGHWAY'] as [string, string],
};

const KEY = 'flying-roadster.lang';
export const detectLang = (nav: string | undefined): Lang => {
  const n = (nav ?? '').toLowerCase();
  return n.startsWith('zh') ? 'zh' : n.startsWith('ja') ? 'ja' : 'en';
};

function stored(): Lang | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

let lang: Lang = stored() ?? detectLang(typeof navigator !== 'undefined' ? navigator.language : undefined);
const listeners: (() => void)[] = [];

export const getLang = (): Lang => lang;

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, l);
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
  for (const f of listeners) f();
}

export const toggleLang = (): Lang => { setLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]); return lang; };
export const onLang = (f: () => void): void => { listeners.push(f); };

/** Translate a key, filling {0}, {1}... */
export function t(key: Key, ...args: (string | number)[]): string {
  let s = dict[lang][key];
  for (let i = 0; i < args.length; i++) s = s.replace(`{${i}}`, String(args[i]));
  return s;
}

type SignKey = Exclude<keyof typeof SIGNS, 'price'>;

/** The Japanese local line of each sign, shown over the same English line when the UI is Japanese. */
const SIGNS_JA: Record<SignKey, string> = {
  fascia: '火星高速道路 · スターシップ料金所',
  ahead: '料金所 500m',
  etcAhead: 'ETC 料金所 250m',
  etc: 'ETC',
  etcLanes: 'ETC専用',
  exitFar: 'スタントアリーナ 出口 1km',
  exitNear: 'スタントアリーナ 出口 500m',
  arena: 'スタントアリーナ',
  gateOut: '出口 · 本線へ',
  backOn: '本線に合流',
};

/** A sign's two lines in the current UI language: Japanese + English for ja, otherwise Chinese + English. */
export const sign = (k: SignKey): [string, string] => [lang === 'ja' ? SIGNS_JA[k] : SIGNS[k][0], SIGNS[k][1]];
export const signPrice = (p: number): [string, string] => (lang === 'ja' ? [`普通車 ${amount(p)}円`, `CAR ¥${amount(p)}`] : SIGNS.price(p));

/** The game keeps money in yuan. The Japanese UI shows it in yen instead, at the market rate, which puts a plaza at
 *  900円 and up: a believable expressway toll in Japan. */
export const JPY_PER_CNY = 20;
/** An amount for display, without the currency mark: yuan as is, or yen rounded to 10 for ja. */
export const amount = (cny: number): string =>
  lang === 'ja' ? (Math.round((cny * JPY_PER_CNY) / 10) * 10).toLocaleString('ja-JP') : cny.toLocaleString('en-US');
/** Money with the currency mark for the UI language: ¥45 (zh, en) or 900円 (ja). */
export const money = (cny: number): string => (lang === 'ja' ? `${amount(cny)}円` : `¥${amount(cny)}`);
