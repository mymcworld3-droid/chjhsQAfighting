'use strict';

const { randomUUID, createHash, createHmac } = require('node:crypto');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const PROMPT_VERSION = 'xianxia-moba-item-icon-v7-name-visual';
const PROMPT_MAX = 2048;
const CONFIGS = Object.freeze({
  artifact: { doc: 'artifactCatalogV1', folder: 'artifacts' },
  material: { doc: 'materialCatalogV1', folder: 'materials' }
});
const IMAGE_FIELDS = Object.freeze([
  'imageUrl','imageStatus','imageModel','imagePromptVersion','imageStoragePath',
  'imageUpdatedAtMs','imageError','imageJobId'
]);

function clean(value, max = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeVisualText(value, max = 180) {
  return clean(value, Math.max(max * 2, max))
    .replace(/\b(?:nsfw|porn(?:ography)?|nude|nudity|naked|sexual|sex|fetish|erotic|explicit)\b/gi, ' ')
    .replace(/(?:色情|情色|裸照|裸體|裸露|性行為|性交|性器官|乳房|乳頭|陰部|陰莖|陰道|精液|自慰|強姦|強暴|斷肢|內臟|腐屍|血淋淋|流血傷口)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function isSafetyRejection(value) {
  return /(?:nsfw|unsafe|safety|content\s*(?:policy|filter|moderation)|moderation|adult content|prompt contains)/i
    .test(String(value || ''));
}

function safeArtifactForm(value) {
  const text = safeVisualText(value, 72).toLowerCase();
  if (/劍|刀|刃|sword|blade|saber/.test(text)) return 'sword-like magical relic';
  if (/盾|shield/.test(text)) return 'shield-like magical relic';
  if (/符|talisman|seal/.test(text)) return 'talisman-like magical relic';
  if (/鏡|mirror/.test(text)) return 'mirror-like magical relic';
  if (/鐘|鈴|bell/.test(text)) return 'bell-like magical relic';
  if (/鼎|爐|cauldron|furnace/.test(text)) return 'cauldron-like magical relic';
  if (/靴|鞋|boot|shoe/.test(text)) return 'boot-like magical relic';
  if (/環|戒|ring/.test(text)) return 'ring-like magical relic';
  if (/弓|bow/.test(text)) return 'bow-like magical relic';
  if (/扇|fan/.test(text)) return 'fan-like magical relic';
  if (/珠|orb|pearl/.test(text)) return 'orb-like magical relic';
  return 'compact mystical relic';
}

function buildSafetyFallbackPrompt(kind, item = {}) {
  const common = [
    'Create a clean 1:1 square fantasy RPG inventory icon.',
    'Show exactly one inanimate game item, centered, fully visible, uncropped, on a simple dark navy or indigo gradient background.',
    'Use a clear silhouette, restrained highlights, minimal glow, and a polished mobile-game icon finish.',
    'Keep the image object-only and scene-free.',
    'Do not include characters, creatures, portraits, hands, text, letters, numbers, labels, watermark, logo, UI frame, stand, shelf, pedestal, or duplicated objects.'
  ];
  if (kind === 'material') {
    return finalizePrompt([
      ...common,
      'Depict a compact abstract crafting resource such as a crystal, ore chunk, wood fragment, fiber bundle, or refined fantasy component.',
      'Use this palette: ' + materialColorTheme(item) + '.',
      'Keep the resource simple, non-figurative, and easy to recognize at thumbnail size.'
    ]);
  }
  const identity = inferNameVisualIdentity(item?.name || '');
  return finalizePrompt([
    ...common,
    'Depict a ' + artifactFormVisual(item) + '.',
    identity.palette.length
      ? 'Use this safe name-derived palette: ' + identity.palette.join(' with ') + '.'
      : 'Use a deep sapphire, jade, violet, or warm gold magical color family with at most one restrained accent.',
    identity.motifs.length
      ? 'Integrate these safe name-derived motifs into the object: ' + identity.motifs.slice(0, 3).join(', ') + '.'
      : 'Keep ornament limited to a few engravings and one subtle magical core or rune detail.',
    'Use a bold three-quarter presentation and a strong readable silhouette.'
  ]);
}

function finalizePrompt(parts) {
  return clean((Array.isArray(parts) ? parts : []).filter(Boolean).join(' '), PROMPT_MAX);
}

function itemKind(value) {
  const kind = String(value || '').toLowerCase();
  return Object.hasOwn(CONFIGS, kind) ? kind : '';
}

function imageConfig(env = process.env) {
  return {
    accountId: clean(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || env.CLOUDFLARE_AI_ACCOUNT_ID, 160),
    apiToken: clean(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || env.CLOUDFLARE_AI_TOKEN, 4096)
  };
}

function r2Config(env = process.env) {
  return {
    accountId: clean(env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || env.CLOUDFLARE_AI_ACCOUNT_ID, 160),
    accessKeyId: clean(env.R2_ACCESS_KEY_ID, 512),
    secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY, 4096),
    bucketName: clean(env.R2_BUCKET_NAME || env.R2_BUCKET, 160),
    publicBaseUrl: clean(env.R2_PUBLIC_BASE_URL || env.R2_PUBLIC_URL, 700).replace(/\/+$/, '')
  };
}

function sha256(value, encoding = 'hex') {
  return createHash('sha256').update(value).digest(encoding);
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function encodeR2Key(key) {
  return String(key || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function formatAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signedR2PutRequest({ accountId, accessKeyId, secretAccessKey, bucketName, key, body, now = new Date() }) {
  const encodedBucket = encodeURIComponent(bucketName);
  const encodedKey = encodeR2Key(key);
  const host = accountId + '.r2.cloudflarestorage.com';
  const url = 'https://' + host + '/' + encodedBucket + '/' + encodedKey;
  const payloadHash = sha256(body);
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders =
    'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    '/' + encodedBucket + '/' + encodedKey,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const scope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest)
  ].join('\n');
  const dateKey = hmac('AWS4' + secretAccessKey, dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + scope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;

  return {
    url,
    headers: {
      Authorization: authorization,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public,max-age=31536000,immutable',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
  };
}
function materialColorTheme(item = {}) {
  const text = [
    item?.id || '',
    item?.name || '',
    item?.category || '',
    item?.description || '',
    item?.story || ''
  ].join(' ').toLowerCase();

  const semanticThemes = [
    { re: /木|wood|樹|靈木|神木/, theme: 'emerald green with warm brown accents' },
    { re: /火|炎|焰|熔岩|赤|fire|flame|lava/, theme: 'crimson red with restrained orange accents' },
    { re: /冰|霜|雪|寒|水|ice|frost|snow|water/, theme: 'icy blue with soft white accents' },
    { re: /雷|電|lightning|thunder/, theme: 'electric violet with cool blue accents' },
    { re: /毒|瘴|venom|poison|toxic/, theme: 'deep jade green with dark green accents' },
    { re: /虛空|暗|影|冥|夜|void|shadow|dark|abyss/, theme: 'deep violet with black accents' },
    { re: /風|storm|wind|air/, theme: 'cyan teal with pale cyan accents' },
    { re: /金|鐵|鋼|礦|晶|玉|metal|iron|steel|ore|crystal|jade/, theme: 'golden amber with restrained metallic highlights' },
    { re: /土|石|岩|砂|沙|earth|stone|rock|sand/, theme: 'earth brown with muted amber accents' },
    { re: /魂|魄|靈|spirit|soul|ghost/, theme: 'pale cyan with silver accents' }
  ];
  const semantic = semanticThemes.find((entry) => entry.re.test(text));
  if (semantic) return semantic.theme;

  const fallbackThemes = [
    'sapphire blue with pale blue accents',
    'emerald green with muted gold accents',
    'crimson red with restrained orange accents',
    'violet purple with cool blue accents',
    'golden amber with warm ivory accents',
    'cyan teal with pale cyan accents'
  ];
  const seed = String(item?.id || item?.name || item?.category || 'material');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash * 31) + seed.charCodeAt(i)) >>> 0;
  return fallbackThemes[hash % fallbackThemes.length];
}

function effectSummary(item = {}) {
  return (Array.isArray(item.effects) ? item.effects : []).slice(0, 3).map((effect) => {
    const type = clean(effect?.type, 48);
    if (!type) return '';
    if (Number.isFinite(Number(effect?.value))) return type + ' ' + Number(effect.value);
    if (Number.isFinite(Number(effect?.multiplier))) return type + ' x' + Number(effect.multiplier);
    return type;
  }).filter(Boolean).join(', ');
}

const NAME_VISUAL_RULES = Object.freeze([
  { re: /雷|霆|電|天雷|劫雷/, palette: 'electric violet and cool blue', motifs: ['thin lightning arcs', 'thunder-rune engravings'], mood: 'charged and forceful' },
  { re: /火|炎|焰|焚|地火/, palette: 'crimson red and molten gold', motifs: ['flame-shaped engravings', 'heated glowing edges'], mood: 'fierce and radiant' },
  { re: /冰|霜|雪|寒/, palette: 'icy blue and pearl white', motifs: ['frost crystal facets', 'delicate ice-vein patterns'], mood: 'cold and precise' },
  { re: /風|嵐|颶/, palette: 'cyan teal and pale silver', motifs: ['swept wind curves', 'spiral airflow engravings'], mood: 'light and swift' },
  { re: /水|海|潮|河|滄/, palette: 'deep sapphire and cyan', motifs: ['flowing wave patterns', 'water-ripple rings'], mood: 'fluid and calm' },
  { re: /毒|瘴/, palette: 'deep jade and dark emerald', motifs: ['jade mist channels', 'serpentine alchemical markings'], mood: 'mysterious and dangerous' },
  { re: /青/, palette: 'jade green and clear cyan', motifs: ['clean jade-like highlights'], mood: 'elegant and fresh' },
  { re: /赤|朱|丹/, palette: 'crimson and warm gold', motifs: ['crimson enamel accents'], mood: 'bold and ceremonial' },
  { re: /紫/, palette: 'royal violet and muted gold', motifs: ['violet crystal accents'], mood: 'noble and mystical' },
  { re: /金|黃金|仙金/, palette: 'warm gold and ivory', motifs: ['refined golden filigree'], mood: 'prestigious and luminous' },
  { re: /玄|冥|幽|夜|暗/, palette: 'deep indigo and blackened metal', motifs: ['subtle dark rune bands'], mood: 'profound and mysterious' },
  { re: /太虛|虛空|空冥|虛/, palette: 'deep indigo and cosmic violet', motifs: ['concentric spatial rings', 'subtle void-like geometric gaps'], mood: 'ethereal and otherworldly' },
  { re: /混沌|鴻蒙/, palette: 'primordial violet and muted gold', motifs: ['slow spiral primordial patterns', 'layered origin sigils'], mood: 'ancient and transcendent' },
  { re: /星|辰|九霄|九天/, palette: 'midnight blue and starlight silver', motifs: ['small star-point inlays', 'celestial orbit engravings'], mood: 'celestial and lofty' },
  { re: /月/, palette: 'moon silver and pale blue', motifs: ['crescent-moon ornament', 'soft lunar halo'], mood: 'serene and refined' },
  { re: /日|陽|曜/, palette: 'sun gold and warm ivory', motifs: ['sun-disc engraving', 'short radial light marks'], mood: 'bright and sovereign' },
  { re: /龍|蛟/, motifs: ['dragon-scale engravings', 'a restrained coiling-dragon ornament'], mood: 'majestic and commanding' },
  { re: /鳳|凰/, motifs: ['phoenix-feather engravings', 'upward feather-like flame curves'], mood: 'noble and reborn' },
  { re: /蓮/, motifs: ['lotus-petal geometry', 'a lotus-shaped guard or central ornament'], mood: 'pure and elegant' },
  { re: /雲/, motifs: ['traditional cloud-scroll engravings', 'soft flowing cloud curves'], mood: 'graceful and airy' },
  { re: /山|嶽|峰/, motifs: ['layered mountain-ridge geometry', 'heavy stepped contours'], mood: 'stable and imposing' },
  { re: /木|樹|枝/, motifs: ['refined wood-grain lines', 'leaf or branch-shaped details'], mood: 'natural and enduring' },
  { re: /玉/, palette: 'jade green and warm ivory', motifs: ['translucent jade surface', 'smooth carved-jade edges'], mood: 'refined and auspicious' },
  { re: /晶|琉璃|琥珀/, motifs: ['faceted crystal core', 'clean gem-like reflections'], mood: 'precise and luminous' },
  { re: /魂|魄|神魂/, palette: 'pale cyan and silver', motifs: ['spirit-flame shaped glow', 'soul-binding rune loops'], mood: 'mystical and solemn' },
  { re: /道|悟道|天道|大道|法則/, motifs: ['concentric dao sigils', 'balanced geometric law patterns'], mood: 'disciplined and transcendent' },
  { re: /鎮|封|禁/, motifs: ['sealing rune bands', 'symmetrical suppressing geometry'], mood: 'heavy and suppressive' },
  { re: /獄/, motifs: ['interlocking dark-metal bands', 'strict vertical rune bars'], mood: 'severe and imposing' },
  { re: /破|斬|裂|滅|軍/, motifs: ['sharp split-line engravings', 'forward-driving angular geometry'], mood: 'aggressive and martial' },
  { re: /守|護|御/, motifs: ['protective outer rune ring', 'layered defensive edging'], mood: 'steadfast and protective' },
  { re: /長生|不朽|永生/, motifs: ['longevity-knot engravings', 'subtle evergreen vine curves'], mood: 'calm and enduring' },
  { re: /七寶|玲瓏|寶/, motifs: ['small jewel inlays', 'fine symmetrical treasure filigree'], mood: 'precious and intricate' },
  { re: /戰|武/, motifs: ['martial rivet bands', 'bold ceremonial battle markings'], mood: 'martial and resolute' },
  { re: /靈/, motifs: ['a compact luminous spirit core'], mood: 'alive with restrained magical energy' },
  { re: /五行/, palette: 'warm gold with restrained five-gem accents', motifs: ['five balanced elemental nodes around one center'], mood: 'balanced and harmonious' },
  { re: /界|世界/, motifs: ['nested boundary rings', 'layered dimensional frame geometry'], mood: 'vast and structural' },
  { re: /古|太古|遠古/, motifs: ['archaic seal-script inspired engravings', 'aged bronze-like structural details'], mood: 'ancient and venerable' },
  { re: /仙/, palette: 'pearl white and soft gold', motifs: ['fine immortal-cloud filigree'], mood: 'pristine and transcendent' }
]);

function uniqueLimited(values, limit) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function inferNameVisualIdentity(name = '') {
  const text = safeVisualText(name, 100);
  const palettes = [];
  const motifs = [];
  const moods = [];
  for (const rule of NAME_VISUAL_RULES) {
    if (!rule.re.test(text)) continue;
    if (rule.palette) palettes.push(rule.palette);
    if (Array.isArray(rule.motifs)) motifs.push(...rule.motifs);
    if (rule.mood) moods.push(rule.mood);
  }
  return {
    palette: uniqueLimited(palettes, 2),
    motifs: uniqueLimited(motifs, 5),
    mood: uniqueLimited(moods, 3)
  };
}

function artifactFormVisual(item = {}) {
  const text = [
    item?.weaponForm || '',
    item?.name || '',
    item?.category || ''
  ].join(' ').toLowerCase();
  const forms = [
    [/飛劍|flying sword/, 'flying sword'],
    [/匕首|dagger/, 'dagger'],
    [/劍|sword/, 'sword'],
    [/刀|blade|saber/, 'saber or broad blade'],
    [/槍|spear/, 'spear'],
    [/弓|bow/, 'bow'],
    [/斧|axe/, 'battle axe'],
    [/錘|hammer/, 'war hammer'],
    [/戟|halberd/, 'halberd'],
    [/棍|staff/, 'combat staff'],
    [/鞭|whip/, 'ritual whip'],
    [/盾|法盾|shield/, 'magical shield'],
    [/杖|法杖|wand/, 'ritual staff'],
    [/符|符籙|talisman/, 'talisman'],
    [/陣盤|formation|array/, 'formation disk'],
    [/寶珠|珠|orb|pearl/, 'mystical orb'],
    [/玉佩|佩飾|pendant|jade pendant/, 'jade pendant'],
    [/法鏡|鏡|mirror/, 'ritual mirror'],
    [/鈴|bell charm/, 'ritual hand bell'],
    [/幡|banner/, 'ritual banner'],
    [/印|seal/, 'square ritual seal'],
    [/鼎|cauldron/, 'ritual cauldron'],
    [/鐘|bell/, 'large ritual bell'],
    [/鼓|drum/, 'ceremonial war drum'],
    [/燈|lamp|lantern/, 'ritual lamp'],
    [/甲|armor|armour/, 'ornate magical armor'],
    [/尺|ruler/, 'ritual ruler'],
    [/扇|fan/, 'ritual folding fan'],
    [/環|戒|ring/, 'mystical ring']
  ];
  return forms.find(([re]) => re.test(text))?.[1] || 'compact mystical relic';
}

function realmVisualStyle(realm = '') {
  const styles = {
    '凡人': 'plain handcrafted construction with almost no ornament',
    '煉氣': 'simple low-tier magical craftsmanship with one small glow accent',
    '築基': 'refined craftsmanship with clear engraved details and controlled polish',
    '金丹': 'high-grade craftsmanship with a distinct luminous core and polished finish',
    '元嬰': 'rare ornate craftsmanship with layered runes and elegant magical depth',
    '化神': 'masterwork craftsmanship with sophisticated symbolic detailing',
    '煉虛': 'ethereal high-tier craftsmanship with spatial depth and floating geometry',
    '合體': 'grand balanced masterwork with integrated motifs and unified structure',
    '大乘': 'legendary craftsmanship with powerful but controlled aura',
    '渡劫': 'tribulation-grade relic with premium scorched-metal and lightning-tested details',
    '真仙': 'immortal-grade masterpiece, exceptionally refined, luminous and pristine'
  };
  return styles[String(realm || '').trim()] || 'refined magical craftsmanship';
}

function effectVisualIdentity(item = {}) {
  const effects = Array.isArray(item.effects) ? item.effects : [];
  const cues = [];
  for (const effect of effects) {
    const type = String(effect?.type || '');
    if (/attack|damage_percent/.test(type)) cues.push('sharpened energy channels and assertive forward geometry');
    if (/hp|reduction|shield|damage_cap/.test(type)) cues.push('protective rune bands and robust reinforced edges');
    if (/crit/.test(type)) cues.push('starburst facets around a focused power core');
    if (/combo/.test(type)) cues.push('paired echo-lines suggesting rapid chained strikes');
    if (/lifesteal/.test(type)) cues.push('a ruby life-force gem with inward flowing light');
    if (/reflect|copy_enemy/.test(type)) cues.push('mirror-polished facets and twin symmetrical glyphs');
    if (/true_damage/.test(type)) cues.push('a narrow white-gold piercing rune through the center');
    if (/cheat_death/.test(type)) cues.push('a restrained phoenix-like rebirth sigil');
    if (/timed_cultivation/.test(type)) cues.push('calm concentric spiritual rings around the core');
    if (/timed_attack/.test(type)) cues.push('a compact pulsing martial aura close to the object');
    if (/remove_wrong_option/.test(type)) cues.push('precise ordered jewel markers suggesting discernment and selection');
  }
  return uniqueLimited(cues, 3);
}

function nameIdentityPrompt(identity) {
  const parts = [];
  if (identity.palette.length) parts.push('Name-derived palette: ' + identity.palette.join(' with ') + '.');
  if (identity.motifs.length) parts.push('Name-derived motifs that MUST be visibly integrated into the object: ' + identity.motifs.join(', ') + '.');
  if (identity.mood.length) parts.push('Name-derived mood: ' + identity.mood.join(', ') + '.');
  return parts;
}

function buildItemImagePrompt(kind, item = {}) {
  const name = safeVisualText(item.name || (kind === 'artifact' ? 'Unnamed magical artifact' : 'Unnamed crafting material'), 80);
  const realm = safeVisualText(item.realm || '凡人', 30);
  const category = safeVisualText(item.category || (kind === 'artifact' ? '法寶' : '材料'), 50);
  const description = safeVisualText(item.description || '', 150);
  const identity = inferNameVisualIdentity(name);

  const common = [
    'Create a polished 1:1 square inventory icon for a Chinese xianxia RPG.',
    'Show exactly one large inanimate item, centered, fully visible, uncropped, filling about 82 to 90 percent of the frame.',
    'Use a dark navy, indigo, or black gradient background with only a faint localized glow; no scene or environment.',
    'Use one dominant color family with at most one restrained accent, a crisp readable silhouette, and minimal particles or bloom.',
    'Do not include characters, creatures, portraits, hands, text, letters, numbers, labels, watermark, logo, UI frame, duplicated object, stand, shelf, pedestal, or floor.'
  ];

  if (kind === 'material') {
    const colorTheme = materialColorTheme(item);
    return finalizePrompt([
      ...common,
      'This is a crafting MATERIAL, not finished equipment.',
      'The visual identity MUST reflect the material name instead of looking like a generic resource.',
      'Base material palette: ' + colorTheme + '.',
      ...nameIdentityPrompt(identity),
      'Use a compact resource silhouette such as ore, crystal, wood, fiber, paper, or a refined fantasy component, whichever best matches the name and category.',
      'Realm finish: ' + realmVisualStyle(realm) + '.',
      'Item name reference: ' + name + '.',
      'Material category: ' + category + '.',
      description ? 'Secondary visual hint only: ' + description + '.' : ''
    ]);
  }

  const form = artifactFormVisual(item);
  const effectCues = effectVisualIdentity(item);
  return finalizePrompt([
    ...common,
    'This is a finished magical ARTIFACT rendered as a polished MOBA-style equipment icon.',
    'The visual identity MUST clearly communicate this specific artifact name; do not generate a generic fantasy item.',
    'Primary object form: ' + form + '. The silhouette must unmistakably read as this object type.',
    ...nameIdentityPrompt(identity),
    'Realm craftsmanship: ' + realmVisualStyle(realm) + '.',
    effectCues.length ? 'Gameplay-effect visual cues, lower priority than the name: ' + effectCues.join('; ') + '.' : '',
    'Integrate only the strongest 2 to 4 name motifs into the actual object geometry, guard, core, engravings, edges, or inlays; do not scatter unrelated decorations.',
    'Keep glow tight around the artifact and keep the object itself dominant.',
    'Item name reference: ' + name + '.',
    'Artifact category: ' + category + '.',
    description ? 'Secondary visual hint only: ' + description + '.' : ''
  ]);
}

function cloudflareError(payload, status) {
  const message = payload?.errors?.[0]?.message || payload?.error || payload?.result?.error;
  return clean(message || ('Cloudflare image request failed (' + status + ')'), 360);
}

async function generateFluxImage(prompt, { env = process.env, fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const config = imageConfig(env);
  if (!config.accountId || !config.apiToken) {
    const missing = [
      !config.accountId ? 'CLOUDFLARE_ACCOUNT_ID' : '',
      !config.apiToken ? 'CLOUDFLARE_API_TOKEN' : ''
    ].filter(Boolean).join('、');
    const error = new Error('Render 尚缺少 ' + missing);
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(
      'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(config.accountId) +
        '/ai/run/@cf/black-forest-labs/flux-1-schnell',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          steps: 4
        }),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Cloudflare 生圖逾時，請稍後重試');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const error = new Error(cloudflareError(payload, response.status));
    error.status = response.status || 502;
    throw error;
  }
  const base64 = String(payload?.result?.image || payload?.image || '').replace(/\s+/g, '').slice(0, 20 * 1024 * 1024);
  if (!base64) {
    const error = new Error('Cloudflare 未回傳圖片資料');
    error.status = 502;
    throw error;
  }
  return { base64, mimeType: 'image/jpeg' };
}

async function uploadGeneratedImage(kind, id, base64, {
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date()
} = {}) {
  const cfg = r2Config(env);
  const missing = [
    !cfg.accountId ? 'R2_ACCOUNT_ID（或 CLOUDFLARE_ACCOUNT_ID）' : '',
    !cfg.accessKeyId ? 'R2_ACCESS_KEY_ID' : '',
    !cfg.secretAccessKey ? 'R2_SECRET_ACCESS_KEY' : '',
    !cfg.bucketName ? 'R2_BUCKET_NAME' : '',
    !cfg.publicBaseUrl ? 'R2_PUBLIC_BASE_URL' : ''
  ].filter(Boolean);

  if (missing.length) {
    const error = new Error('Render 尚缺少 Cloudflare R2 設定：' + missing.join('、'));
    error.status = 503;
    throw error;
  }
  if (!/^https:\/\//i.test(cfg.publicBaseUrl)) {
    const error = new Error('R2_PUBLIC_BASE_URL 必須是 https:// 開頭的公開 R2 網址或自訂網域');
    error.status = 503;
    throw error;
  }

  const safeId = clean(id, 80).replace(/[^a-zA-Z0-9_-]+/g, '-') || 'item';
  const storagePath =
    'generated-items/' + CONFIGS[kind].folder + '/' + safeId + '/' +
    Date.now() + '-' + randomUUID() + '.jpg';
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    const error = new Error('生成圖片解碼失敗');
    error.status = 502;
    throw error;
  }

  const signed = signedR2PutRequest({
    accountId: cfg.accountId,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    bucketName: cfg.bucketName,
    key: storagePath,
    body: buffer,
    now: now()
  });

  let response;
  try {
    response = await fetchImpl(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: buffer
    });
  } catch (error) {
    const wrapped = new Error('Cloudflare R2 上傳連線失敗：' + clean(error?.message || 'network error', 260));
    wrapped.status = 502;
    throw wrapped;
  }

  if (!response.ok) {
    const detail = clean(await response.text().catch(() => ''), 320);
    const error = new Error(
      'Cloudflare R2 上傳失敗 (' + response.status + ')' +
      (detail ? '：' + detail : '')
    );
    error.status = response.status === 401 || response.status === 403 ? 502 : (response.status || 502);
    throw error;
  }

  const imageUrl = cfg.publicBaseUrl + '/' + encodeR2Key(storagePath);
  return { imageUrl, storagePath, bucketName: cfg.bucketName };
}
async function authenticatedPlayer(req, { resolve = role => adminProject(role) } = {}) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!bearer) {
    const error = new Error('請先登入');
    error.status = 401;
    throw error;
  }
  const project = resolve('A');
  let verified;
  try { verified = await project.auth.verifyIdToken(bearer[1], true); }
  catch (_) {
    const error = new Error('登入已失效，請重新登入');
    error.status = 401;
    throw error;
  }
  if (!verified?.uid || (verified.aud && verified.aud !== PROJECT_IDS.A) ||
      (verified.iss && verified.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A)) {
    const error = new Error('登入專案驗證失敗');
    error.status = 401;
    throw error;
  }
  const userSnap = await project.db.collection('users').doc(verified.uid).get();
  if (!userSnap.exists) {
    const error = new Error('玩家資料不存在');
    error.status = 404;
    throw error;
  }
  return { project, uid: verified.uid, data: userSnap.data() || {} };
}

function stripImageRuntimeFields(item = {}) {
  const next = { ...item };
  delete next.imageJobId;
  delete next.imageError;
  return next;
}

async function reserveImageJob({ project, kind, id, overwrite = false, requesterUid = '', admin = false }) {
  const cfg = CONFIGS[kind];
  const ref = project.db.collection('gameConfig').doc(cfg.doc);
  const jobId = randomUUID();
  let reserved = null;

  await project.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const error = new Error('找不到 ' + cfg.doc + ' 設定');
      error.status = 404;
      throw error;
    }
    const data = snap.data() || {};
    const items = Array.isArray(data.items) ? data.items.map((row) => ({ ...row })) : [];
    const index = items.findIndex((row) => String(row?.id || '') === id);
    if (index < 0) {
      const error = new Error('找不到物品：' + id);
      error.status = 404;
      throw error;
    }

    const current = items[index] || {};
    if (!admin) {
      if (kind !== 'artifact' || current.generatedByAI !== true ||
          String(current.recipeOwnerUid || '') !== requesterUid) {
        const error = new Error('只有此 AI 法寶的配方首發者可自動補圖');
        error.status = 403;
        throw error;
      }
    }
    if (current.imageUrl && !overwrite) {
      reserved = { skipped: true, item: current, ref };
      return;
    }
    if (current.imageStatus === 'generating' && current.imageJobId && !overwrite) {
      const error = new Error('此物品正在生成圖片');
      error.status = 409;
      throw error;
    }

    items[index] = {
      ...current,
      imageStatus: 'generating',
      imageJobId: jobId,
      imageError: '',
      imagePromptVersion: PROMPT_VERSION,
      imageModel: MODEL
    };
    tx.set(ref, {
      items,
      itemImageJobAtMs: Date.now(),
      itemImageJobItemId: id
    }, { merge: true });
    reserved = { skipped: false, item: current, ref, jobId };
  });
  return reserved;
}

async function finishImageJob({ project, reserved, kind, id, imageUrl, storagePath }) {
  let output = null;
  await project.db.runTransaction(async (tx) => {
    const snap = await tx.get(reserved.ref);
    if (!snap.exists) throw new Error('物品設定已不存在');
    const data = snap.data() || {};
    const items = Array.isArray(data.items) ? data.items.map((row) => ({ ...row })) : [];
    const index = items.findIndex((row) => String(row?.id || '') === id);
    if (index < 0) throw new Error('物品已被刪除');
    const current = items[index] || {};
    if (current.imageJobId !== reserved.jobId) {
      const error = new Error('圖片任務已被新的生成要求取代');
      error.status = 409;
      throw error;
    }
    output = stripImageRuntimeFields({
      ...current,
      imageUrl,
      imageStatus: 'ready',
      imageModel: MODEL,
      imagePromptVersion: PROMPT_VERSION,
      imageStoragePath: storagePath,
      imageUpdatedAtMs: Date.now()
    });
    items[index] = output;
    tx.set(reserved.ref, {
      items,
      itemImageUpdatedAtMs: Date.now(),
      itemImageUpdatedId: id
    }, { merge: true });
  });
  return output;
}

async function failImageJob({ project, reserved, id, error }) {
  if (!reserved?.ref || reserved.skipped) return;
  try {
    await project.db.runTransaction(async (tx) => {
      const snap = await tx.get(reserved.ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const items = Array.isArray(data.items) ? data.items.map((row) => ({ ...row })) : [];
      const index = items.findIndex((row) => String(row?.id || '') === id);
      if (index < 0 || items[index]?.imageJobId !== reserved.jobId) return;
      items[index] = {
        ...items[index],
        imageStatus: 'error',
        imageError: clean(error?.message || '圖片生成失敗', 260),
        imageUpdatedAtMs: Date.now()
      };
      delete items[index].imageJobId;
      tx.set(reserved.ref, { items }, { merge: true });
    });
  } catch (_) {}
}

async function generateCatalogItemImage({
  project,
  kind,
  id,
  overwrite = false,
  requesterUid = '',
  admin = false,
  env = process.env,
  fetchImpl = fetch,
  storageFetchImpl = fetch
}) {
  const normalizedKind = itemKind(kind);
  const normalizedId = clean(id, 80);
  if (!normalizedKind || !normalizedId) {
    const error = new Error('缺少合法的 kind 或 id');
    error.status = 400;
    throw error;
  }

  const reserved = await reserveImageJob({
    project,
    kind: normalizedKind,
    id: normalizedId,
    overwrite: !!overwrite,
    requesterUid,
    admin
  });
  if (reserved.skipped) return { skipped: true, item: reserved.item };

  try {
    const prompt = buildItemImagePrompt(normalizedKind, reserved.item);
    let generated;
    let safetyFallbackUsed = false;
    try {
      generated = await generateFluxImage(prompt, { env, fetchImpl });
    } catch (error) {
      if (!isSafetyRejection(error?.message)) throw error;
      safetyFallbackUsed = true;
      const fallbackPrompt = buildSafetyFallbackPrompt(normalizedKind, reserved.item);
      try {
        generated = await generateFluxImage(fallbackPrompt, { env, fetchImpl });
      } catch (retryError) {
        if (isSafetyRejection(retryError?.message)) {
          const safeError = new Error('此物品的圖片描述未通過內容審核，已自動改用安全提示詞重試但仍未成功');
          safeError.status = 422;
          safeError.code = 'IMAGE_SAFETY_REJECTED';
          throw safeError;
        }
        throw retryError;
      }
    }
    const uploaded = await uploadGeneratedImage(normalizedKind, normalizedId, generated.base64, {
      env, fetchImpl: storageFetchImpl
    });
    const item = await finishImageJob({
      project, reserved, kind: normalizedKind, id: normalizedId,
      imageUrl: uploaded.imageUrl, storagePath: uploaded.storagePath
    });
    return { skipped: false, item, model: MODEL, promptVersion: PROMPT_VERSION, safetyFallbackUsed };
  } catch (error) {
    await failImageJob({ project, reserved, id: normalizedId, error });
    throw error;
  }
}

function createAdminItemImageHandler(options = {}) {
  return async function adminItemImageHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    try {
      const auth = await authenticatedPlayer(req, options);
      if (auth.data?.isAdmin !== true) {
        return res.status(403).json({ ok: false, error: '僅管理員可以執行補圖' });
      }
      const result = await generateCatalogItemImage({
        project: auth.project,
        kind: req.body?.kind,
        id: req.body?.id,
        overwrite: req.body?.overwrite === true,
        requesterUid: auth.uid,
        admin: true,
        env: options.env || process.env,
        fetchImpl: options.fetchImpl || fetch,
        storageFetchImpl: options.storageFetchImpl || fetch
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        ok: false,
        code: clean(error?.code || '', 80) || undefined,
        error: clean(error?.message || '補圖失敗', 360)
      });
    }
  };
}

function createArtifactAutoImageHandler(options = {}) {
  return async function artifactAutoImageHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    try {
      const auth = await authenticatedPlayer(req, options);
      const result = await generateCatalogItemImage({
        project: auth.project,
        kind: 'artifact',
        id: req.body?.id,
        overwrite: false,
        requesterUid: auth.uid,
        admin: auth.data?.isAdmin === true,
        env: options.env || process.env,
        fetchImpl: options.fetchImpl || fetch,
        storageFetchImpl: options.storageFetchImpl || fetch
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        ok: false,
        code: clean(error?.code || '', 80) || undefined,
        error: clean(error?.message || '法寶自動補圖失敗', 360)
      });
    }
  };
}

function registerItemImageApi(app, options = {}) {
  app.post('/api/admin/item-image', createAdminItemImageHandler(options));
  app.post('/api/item-image/ensure-artifact', createArtifactAutoImageHandler(options));
}

module.exports = {
  MODEL,
  PROMPT_VERSION,
  buildItemImagePrompt,
  buildSafetyFallbackPrompt,
  inferNameVisualIdentity,
  artifactFormVisual,
  realmVisualStyle,
  effectVisualIdentity,
  isSafetyRejection,
  safeVisualText,
  materialColorTheme,
  imageConfig,
  r2Config,
  signedR2PutRequest,
  uploadGeneratedImage,
  generateFluxImage,
  generateCatalogItemImage,
  createAdminItemImageHandler,
  createArtifactAutoImageHandler,
  registerItemImageApi
};
