// Kullanıcının AÇIK sözlerinden kodla öğrenme (model gerekmez; her yolda çalışır). Fuber AI 1'in hafıza kuralından
// (`shared/hafiza-kurali.ts` › `acikTercih`) uyarlandı ve kategorilere açıldı. Gerekçe: konuşan beyin Claude Code iken
// arka plan çıkarımı (`brain.extract`) abonelik kotasından harcamasın diye o yola gitmez; yerel 4B model de çıkarımda
// güvenilir değildir. "Bunu böyle isterim / bir daha böyle yapma" düzeltmesi modele bırakılmadan, o turda kayda geçer.
//
// İlke: emin olunmayan cümle öğrenilmez (soru, tek seferlik istek, hatırlatıcı isteği). Öğrenilen metin kullanıcının
// KENDİ cümlesidir (tırnak içinde, aynen): kod yeniden yazmaz, yanlış anlam üretmez.
import { foldForSearch } from '@fuber/shared';
import type { ProfileCategory, ProfileOrigin } from './types';

export interface Learned {
  category: ProfileCategory;
  /** Konu anahtarı (aynı konunun yeni sözü eskisinin yerini alır); bilinmiyorsa `null`. */
  key: string | null;
  text: string;
  confidence: number;
  origin: ProfileOrigin;
}

const fold = (text: string): string => foldForSearch(text);

/** Cümlelere böler (kaba; tırnak içi korunmaz). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Kullanıcının sözü tırnak içinde aynen saklanır. */
const quote = (sentence: string): string => `“${sentence.replace(/[“”"«»]/g, '').replace(/\s+/g, ' ').replace(/^(bir de|ayrica|bu arada|hayir|yok|tamam|peki|ya|bak)[,:]?\s+/i, '').trim()}”`;

// ── kalıplar (katlanmış metinde) ──

/** Kalıcılık işareti: "bundan sonra", "bir daha", "hep", "asla"… */
const LASTING = /\b(bundan sonra|bundan boyle|bundan sonrasi|bir daha|bi daha|\bhep\b|her zaman|daima|asla|hicbir zaman|hic bir zaman|her seferinde|her defasinda|kural olarak|genel olarak)\b/;
/** Tek seferlik istek işareti: kural değildir. */
const ONE_OFF = /\b(simdi|su an|su anda|simdilik|bugunluk|bu sefer|bu seferlik|bu kez|bir dakika|bir saniye|biraz)\b/;
/** Zamanlı iş / liste isteği: profil değil, planlar. */
const PLANNER_ASK = /hatirlat|animsat|alarm|yapilacak|listeye ekle|listesine ekle|gorev ekle|randevu/;
/** Asistana yönelen olumsuz emir (kapalı fiil listesi: "görüşme", "toplama" gibi adlar karışmasın). */
const NEGATIVE_ORDER =
  /\b(deme|yapma|koyma|yazma|gonderme|ekleme|kullanma|olma|sorma|soyleme|onerme|uzatma|anlatma|konusma|okuma|acma|kapatma|bekleme|tekrarlama|yineleme|bahsetme|verme|hatirlatma|girme|kesme|bolme|gosterme|cagirma|seslenme|baslama|bitirme|aciklama|ozetleme|sayma|karistirma|degistirme|silme|rahatsiz etme|hitap etme|araya girme|soz etme|tekrar etme|israr etme|ozur dileme|tesekkur etme)(yin|yiniz)?\b(?!\s+(mi|mu)\b)/;
/** Konuşma biçimini anlatan olumsuz emirler: bunlar kalıcılık işareti olmadan da asistanın davranışına kuraldır. */
const SPEECH_NEGATIVE = /\b(deme|soyleme|uzatma|anlatma|tekrarlama|yineleme|bahsetme|aciklama|ozetleme|sayma|seslenme|cagirma|onerme|sorma|hitap etme|araya girme|soz etme|tekrar etme|israr etme|ozur dileme|tesekkur etme|kesme|bolme)(yin|yiniz)?\b/;
/** Asistana ya da alışkanlığa işaret: "bana", "bu kadar", "sürekli", "hiç", "her şeyi". */
const HABIT_MARK = /\b(bana|beni|benimle|bu kadar|o kadar|surekli|durmadan|hic|hicbir|her seyi|her seferinde|uzun uzun|gereksiz|bosuna|ikide bir)\b/;
/** Kalıcılık işaretiyle birlikte kural sayılan olumlu emir / dilek. */
const POSITIVE_ORDER =
  /\b(tut|ver|yap|soyle|yaz|anlat|konus|kullan|sor|goster|ozetle|oku|basla|bitir|ekle|ac|kapat|hitap et|seslen|cagir|bildir|haber ver|uyar|kontrol et|onayla|bekle)(in|iniz|sana|sene)?\b|\bde\b(?=[.!,]|$)|\bolsun\b|\bolmasin\b|\bisterim\b|\bistiyorum\b|\bistemiyorum\b|\bistemem\b|\bgerek yok\b|\blazim\b/;
/** "Böyle isterim", "bu şekilde yap": bir önceki yanıta gönderme yapan düzeltme. */
const DEICTIC_RULE = /\b(boyle|bu sekilde|bu bicimde|su sekilde|oyle)\b.*\b(isterim|istiyorum|yap|olsun|soyle|yaz|ver|anlat|devam et)\b|\b(boyle|bu sekilde|oyle)\b.*\b(istemiyorum|istemem|yapma|olmasin|soyleme|yazma|verme|anlatma)\b/;
/** Cümle önceki yanıta gönderme yapıyor (bağlamı yanına yazılır). */
const DEICTIC = /\b(boyle|bunu|bu kadar|bu sekilde|oyle|sunu|bu tarz|bu bicimde|az onceki gibi|demin(ki)? gibi)\b/;

const DISLIKE = /\b(sevmem|sevmiyorum|hoslanmam|hoslanmiyorum|nefret ed(erim|iyorum)|ilgilenmiyorum|ilgilenmem|ilgimi cekm(ez|iyor)|sikiliyorum|sikilirim|rahatsiz (oluyorum|olurum|ediyor|eder)|katlanamam|katlanamiyorum|tahammul edem(em|iyorum)|gicik (olurum|oluyorum)|hazzetmem|hazzetmiyorum)\b/;
const PREFERENCE = /\b(tercih ed(erim|iyorum)|tercihim|severim|seviyorum|hosuma gid(er|iyor)|bayilirim|bayiliyorum|daha cok severim|icerim|icmem|yerim|yemem)\b/;
/** "… içerim / yerim" yalnız alışkanlık bildiriyorsa tercihtir (ne, nasıl içtiği). */
const HABIT_FOOD = /\b(kahve|cay|su|yemek|kahvalti|sut|seker|et|tavuk|balik|sebze|tatli|alkol|sigara)\w*\b/;
const INTEREST = /\b(ilgileniyorum|ilgilenirim|ilgi duyuyorum|ilgi duyarim|ilgimi cek(er|iyor)|merakliyim|meraklisiyim|takip ed(iyorum|erim)|yakindan (izliyorum|takip ediyorum)|hayraniyim|tutkunuyum|kafa yoruyorum|okuyorum surekli)\b/;
const ROUTINE_MARK = /\b(her sabah|sabahlari|her aksam|aksamlari|her gece|geceleri|her gun|hafta sonlari|hafta sonu|hafta ici|genelde|genellikle|cogu zaman|cogunlukla|her hafta|her ay|pazartesileri|salilari|carsambalari|persembeleri|cumalari|cumartesileri|pazarlari|ogle arasinda|ogleden sonralari)\b/;
/** Birinci tekil geniş / şimdiki zaman: "kalkarım", "çalışıyorum", "yaparım". */
const FIRST_PERSON = /\b\p{L}{2,}(rim|rum|arim|erim|irim|urum|iyorum|uyorum|ayorum|eyorum|mam|mem|maktayim|mekteyim)\b/u;
const ONGOING_MARK = /\b(su siralar|bu aralar|bu gunlerde|su gunlerde|son zamanlarda|su donemde|bu donemde|halihazirda|su aralar)\b/;

/**
 * Sık düzeltilen davranış konuları: aynı anahtar aynı konudur, yeni söz eskisinin yerini alır. Zıt sıfatlar ("kısa
 * tut" → "uzun anlat") kök örtüşmesiyle eşlenemediği için buradan anahtarlanır.
 */
const TOPIC_KEYS: ReadonlyArray<{ key: string; test: RegExp }> = [
  { key: 'yanit-uzunlugu', test: /(kisa|uzun|ayrinti|detay|ozet|\boz\b|uzatma|lafi|tek cumle|madde madde|net\b).*(yanit|cevap|anlat|konus|soyle|yaz|acikla|\bver|\btut|\bkes|\bol)|(yanit|cevap|anlat|konus|soyle|yaz|acikla)\w*.*(kisa|uzun|ayrinti|detay|ozet|\boz\b|net\b)|lafi uzat|uzatma/ },
  { key: 'hitap', test: /hitap|diye (seslen|cagir|soyle|de\b)|\b(efendim|patron|hocam|sefim|abi|kardesim)\b.*\b(de\b|deme|diye)|\b(bey|hanim)\b.*\b(de\b|deme|diye)|\b(sen|siz) diye/ },
  { key: 'resmiyet', test: /\bresmi|samimi|senli benli|ciddi ol|kibar|argo|laubali/ },
  { key: 'espri', test: /espri|\bsaka|komik|mizah|gir gir/ },
  { key: 'emoji', test: /emoji|ifade simge|gulen yuz/ },
  { key: 'dil', test: /\b(turkce|ingilizce|almanca|fransizca)\b.*\b(konus|yaz|yanit|cevap|anlat)/ },
  { key: 'soz-kesme', test: /sozumu kes|sozumu bol|araya gir|lafimi kes/ },
  { key: 'tekrar', test: /tekrarla|yinele|ayni seyi|tekrar etme|papagan/ },
  { key: 'onay-sorma', test: /sormadan|onay (isteme|sorma|alma)|bana sorma|soru sorma|teyit/ },
  { key: 'ozur', test: /ozur dile|kusura bakma/ },
  { key: 'brifing', test: /brifing|sabah (ozet|rapor)|gunluk ozet/ },
  { key: 'sayi-bicimi', test: /yuvarla|kurus|ondalik|virgulden sonra/ },
];

function topicKey(folded: string): string | null {
  return TOPIC_KEYS.find((topic) => topic.test.test(folded))?.key ?? null;
}

const clipQuote = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text);

// ── kimlik, çevre, iş (özgün metinde; ad büyük harfle başlar) ──

const NAME = '[A-ZÇĞİÖŞÜ][\\p{L}\'’]+(?:\\s[A-ZÇĞİÖŞÜ][\\p{L}\'’]+){0,2}';
const RELATIONS: ReadonlyArray<{ re: string; key: string; label: string }> = [
  { re: 'eşim|esim|hanımım|karım', key: 'es', label: 'Eşi' },
  { re: 'kocam', key: 'es', label: 'Eşi' },
  { re: 'kızım', key: 'kiz', label: 'Kızı' },
  { re: 'oğlum', key: 'ogul', label: 'Oğlu' },
  { re: 'annem', key: 'anne', label: 'Annesi' },
  { re: 'babam', key: 'baba', label: 'Babası' },
  { re: 'kardeşim', key: 'kardes', label: 'Kardeşi' },
  { re: 'abim|ağabeyim', key: 'abi', label: 'Ağabeyi' },
  { re: 'ablam', key: 'abla', label: 'Ablası' },
  { re: 'ortağım', key: 'ortak', label: 'Ortağı' },
  { re: 'muhasebecim|mali müşavirim', key: 'muhasebeci', label: 'Muhasebecisi' },
  { re: 'avukatım', key: 'avukat', label: 'Avukatı' },
  { re: 'asistanım|sekreterim', key: 'asistan', label: 'Asistanı' },
  { re: 'doktorum', key: 'doktor', label: 'Doktoru' },
  { re: 'patronum', key: 'patron', label: 'Patronu' },
  { re: 'müdürüm|yöneticim', key: 'yonetici', label: 'Yöneticisi' },
  { re: 'nişanlım', key: 'nisanli', label: 'Nişanlısı' },
  { re: 'sevgilim|kız arkadaşım|erkek arkadaşım', key: 'sevgili', label: 'Sevgilisi' },
];
const RELATION_RE = new RegExp(`(?:^|[\\s,;:])(${RELATIONS.map((relation) => relation.re).join('|')})(?:ın|in|un|ün)?\\s+(?:adı\\s+|ismi\\s+)?(${NAME}(?:\\s(?:Bey|Hanım))?)`, 'u');
/** Ad sanılabilecek ama ad olmayan cümle başı sözcükleri. */
const NOT_NAME = new Set(['bugün', 'yarın', 'dün', 'şimdi', 'bana', 'beni', 'bunu', 'şunu', 'evet', 'hayır', 'tamam', 'acaba', 'ama', 'çok', 'bir', 'ben', 'sen', 'biz', 'siz', 'jarvis']);

const COMPANY_RE = new RegExp(`(?:^|[\\s,;:])(şirketim|firmam|girişimim|ajansım|markam|işletmem|dükkanım|dükkânım|startup['’]?ım)(?:ın|in|un|ün)?\\s+(?:adı\\s+|ismi\\s+)?([A-ZÇĞİÖŞÜ0-9][\\p{L}\\p{N}.&-]*(?:\\s[A-ZÇĞİÖŞÜ0-9][\\p{L}\\p{N}.&-]*){0,3})`, 'u');
const PROJECT_RE = new RegExp(`([A-ZÇĞİÖŞÜ][\\p{L}\\p{N}.-]*(?:\\s[A-ZÇĞİÖŞÜ0-9][\\p{L}\\p{N}.-]*){0,2})\\s+(?:projesi|uygulaması|ürünü|sitesi)(?:ni|nin|ne|nde|yle)?\\s+(?:üzerinde\\s+|üstünde\\s+|için\\s+)?(?:çalışıyorum|geliştiriyorum|yapıyorum|uğraşıyorum|kuruyorum)`, 'u');
const CITY_RE = new RegExp(`([A-ZÇĞİÖŞÜ][\\p{L}]+)['’]?(?:da|de|ta|te)\\s+(?:yaşıyorum|oturuyorum|ikamet ediyorum|kalıyorum)`, 'u');
const AGE_RE = /\b(\d{2})\s+yaşındayım\b/iu;
const JOBS = 'girişimci|kurucu|yazılımcı|mühendis|doktor|avukat|öğretmen|tasarımcı|öğrenci|muhasebeci|mimar|yönetici|geliştirici|pazarlamacı|esnaf|akademisyen|danışman|satıcı|gazeteci|yatırımcı|eczacı|hemşire|diş hekimi|psikolog|editör|yazar|fotoğrafçı|müzisyen|emekli|serbest çalışan|freelancer';
/** "Ben … mühendisiyim" ya da cümle sonunda "… yazılımcıyım.": "doktorum Ayşe Hanım" (doktoru) meslek değildir. */
const JOB_RE = new RegExp(`(?:^|\\s)(?:(ben)\\s+(?:bir\\s+)?)?((?:[\\p{L}]+\\s){0,2}(?:${JOBS}))(?:i|ı|u|ü|si|sı|su|sü)?(?:yim|yım|yum|yüm|im|ım|um|üm)(\\s*[.!,]?\\s*$)?`, 'iu');
const JOB2_RE = /(?:^|\s)mesleğim\s+([\p{L} ]{3,40}?)(?:[.,!]|$)/iu;

function relationOf(word: string): { key: string; label: string } | null {
  const folded = fold(word);
  const hit = RELATIONS.find((relation) => relation.re.split('|').some((form) => fold(form) === folded));
  return hit ? { key: hit.key, label: hit.label } : null;
}

/**
 * Kullanıcının sözünden açık öğrenmeler. `previousReply`: asistanın bir önceki yanıtı (düzeltme "böyle yapma" gibi ona
 * gönderme yapıyorsa kuralın yanına kısa alıntısı yazılır ki kural tek başına anlaşılsın).
 */
export function explicitLearnings(userText: string, previousReply: string | null = null): Learned[] {
  const out: Learned[] = [];
  const push = (learned: Learned) => {
    if (out.length < 4 && !out.some((existing) => existing.category === learned.category && existing.text === learned.text)) out.push(learned);
  };
  for (const sentence of sentencesOf(userText)) {
    if (sentence.length < 6 || sentence.length > 400) continue;
    const folded = fold(sentence);
    const question = /\?\s*$/.test(sentence) || /\b(mi|mu|misin|musun|miyim|muyum|midir|mudur)\b\s*$/.test(folded);

    // Kimlik, çevre, iş: soru cümlesinde de geçebilir ("eşim Ayşe'nin doğum günü ne zaman?" → eşinin adı Ayşe).
    // Cümle başındaki büyük harf ad sanılmasın diye ilk harf küçültülür (adlar cümle içinde büyük harfle başlar).
    const lead = sentence.charAt(0).toLocaleLowerCase('tr') + sentence.slice(1);
    const relation = RELATION_RE.exec(lead);
    if (relation) {
      const who = relationOf(relation[1]!);
      const name = relation[2]!.replace(/['’].*$/, '').trim();
      if (who && name.length >= 2 && !NOT_NAME.has(name.toLocaleLowerCase('tr'))) push({ category: 'circle', key: who.key, text: `${who.label}: ${name}.`, confidence: 0.9, origin: 'said' });
    }
    if (question) continue;

    const company = COMPANY_RE.exec(lead);
    if (company) {
      const name = company[2]!.replace(/['’].*$/, '').replace(/[.,]+$/, '').trim();
      if (name.length >= 2 && !NOT_NAME.has(name.toLocaleLowerCase('tr'))) push({ category: 'work', key: `sirket-${fold(name)}`, text: `Şirketi: ${name}.`, confidence: 0.9, origin: 'said' });
    }
    const project = PROJECT_RE.exec(sentence);
    if (project) push({ category: 'work', key: `proje-${fold(project[1]!)}`, text: `${project[1]!.trim()} üzerinde çalışıyor.`, confidence: 0.85, origin: 'said' });
    const city = CITY_RE.exec(sentence);
    if (city) push({ category: 'identity', key: 'sehir', text: `Yaşadığı yer: ${city[1]}.`, confidence: 0.95, origin: 'said' });
    const age = AGE_RE.exec(sentence);
    if (age) push({ category: 'identity', key: 'yas', text: `${age[1]} yaşında olduğunu söyledi.`, confidence: 0.95, origin: 'said' });
    const job = relation ? null : JOB_RE.exec(sentence);
    const jobName = job && (job[1] || job[3] !== undefined) ? job[2]! : (JOB2_RE.exec(sentence)?.[1] ?? null);
    if (jobName) push({ category: 'identity', key: 'meslek', text: `Mesleği: ${jobName.trim().toLocaleLowerCase('tr')}.`, confidence: 0.9, origin: 'said' });

    const planner = PLANNER_ASK.test(folded);
    const negative = NEGATIVE_ORDER.test(folded);
    const lasting = LASTING.test(folded);

    // 1) Davranış kuralı: kalıcılık işareti + emir/dilek, asistanın DAVRANIŞINA yönelen olumsuz emir, ya da "böyle isterim".
    // Yalın olumsuz emir ("Ali'ye mesaj gönderme", "konuşma") tek seferlik bir istektir; kural sayılması için ya konuşma
    // biçimini anlatan bir fiil ("uzatma", "deme", "tekrarlama") ya da asistana/alışkanlığa işaret ("bana", "bu kadar",
    // "sürekli", "hiç") ve en az üç sözcük (ya da konu sözlüğünde karşılığı: "efendim deme") gerekir.
    const deicticRule = DEICTIC_RULE.test(folded);
    const wordCount = folded.split(/\s+/).filter(Boolean).length;
    const lastingNegative = negative && (SPEECH_NEGATIVE.test(folded) || HABIT_MARK.test(folded) || DEICTIC.test(folded)) && (wordCount >= 3 || topicKey(folded) !== null);
    const rule = (lasting && (negative || POSITIVE_ORDER.test(folded))) || (lastingNegative && !ONE_OFF.test(folded)) || deicticRule;
    if (rule && !(planner && !negative) && !(ONE_OFF.test(folded) && !lasting)) {
      let text = quote(sentence);
      if (previousReply && DEICTIC.test(folded)) text += ` (asistanın şu yanıtı üzerine: “${clipQuote(previousReply.replace(/\s+/g, ' ').trim(), 140)}”)`;
      push({ category: 'rule', key: topicKey(folded), text, confidence: 1, origin: 'said' });
      continue;
    }
    // Kısa söz ("Seviyorum.", "Hâlâ bekliyorum.") kalıcı bilgi taşımaz; asistana söylenen söz ("seni seviyorum") tercih değildir.
    if (planner || wordCount < 3 || /\b(seni|sizi|sana|size)\b/.test(folded)) continue;

    // 2) Sevmedikleri.
    if (DISLIKE.test(folded)) {
      push({ category: 'dislike', key: topicKey(folded), text: quote(sentence), confidence: 1, origin: 'said' });
      continue;
    }
    // 3) İlgi alanları.
    if (INTEREST.test(folded)) {
      push({ category: 'interest', key: null, text: quote(sentence), confidence: 1, origin: 'said' });
      continue;
    }
    // 4) Tercihler ("… içerim / yerim" yalnız yiyecek-içecek alışkanlığında).
    const preference = PREFERENCE.exec(folded);
    if (preference && (!/^(icerim|icmem|yerim|yemem)$/.test(preference[1]!) || HABIT_FOOD.test(folded))) {
      push({ category: 'preference', key: topicKey(folded), text: quote(sentence), confidence: 1, origin: 'said' });
      continue;
    }
    // 5) Sürmekte olan meseleler.
    if (ONGOING_MARK.test(folded) && FIRST_PERSON.test(folded)) {
      push({ category: 'ongoing', key: null, text: quote(sentence), confidence: 0.8, origin: 'said' });
      continue;
    }
    // 6) Rutinler.
    if (ROUTINE_MARK.test(folded) && FIRST_PERSON.test(folded)) {
      push({ category: 'routine', key: null, text: quote(sentence), confidence: 0.8, origin: 'said' });
    }
  }
  return out;
}

/** İlgi / sevmediği kaydından konunun kendisi: “Spor haberlerini sevmem.” → "spor". Haber puanlaması bunu kullanır. */
const TOPIC_NOISE = new Set(
  [
    'haber', 'haberler', 'haberleri', 'haberlerini', 'haberlerle', 'konu', 'konusu', 'konular', 'konulari', 'hakkinda', 'ile', 'ilgili', 'gelismeler', 'gelismeleri', 'gundem', 'gundemi',
    'sevmem', 'sevmiyorum', 'hoslanmam', 'hoslanmiyorum', 'nefret', 'ederim', 'ediyorum', 'ilgilenmiyorum', 'ilgilenmem', 'ilgimi', 'cekmez', 'cekmiyor', 'ceker', 'cekiyor', 'sikiliyorum',
    'ilgileniyorum', 'ilgilenirim', 'ilgi', 'duyuyorum', 'duyarim', 'merakliyim', 'meraklisiyim', 'takip', 'yakindan', 'izliyorum', 'hayraniyim', 'tutkunuyum', 'istemiyorum', 'istemem',
    'ben', 'bana', 'cok', 'hic', 'pek', 'asla', 'artik', 'hep', 'de', 'da', 've', 'bir', 'bu', 'su', 'en', 'daha', 'ozellikle', 'surekli', 'gosterme', 'soyleme', 'sorma', 'anlatma', 'verme',
    'kullanici', 'kullanicinin', 'alani', 'alanlari', 'ilgisi', 'yok', 'var', 'seviyor', 'sevmez', 'sever', 'ilgilenir', 'ilgilenmez', 'ediyor', 'eder', 'istemiyor', 'istemez', 'okuyorum', 'kafa', 'yoruyorum',
  ].map(fold),
);

/** Çekimli halleriyle atılan konu-dışı kökler: "haberlerini", "gelişmelerini", "konusunda". */
const TOPIC_NOISE_ROOTS = /^(haber|gelisme|konu|gundem)/;

export function topicOf(text: string): string {
  const words = text.replace(/[“”"«».,!?;:()]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter((word) => !TOPIC_NOISE.has(fold(word)) && !TOPIC_NOISE_ROOTS.test(fold(word)));
  // Sondaki belirgin hal ekleri atılır ("yapay zekâyla" → "yapay zekâ", "OpenAI'yi" → "OpenAI"); yalın ünlü atılmaz
  // ("ekonomi" kök olarak kalır; başlık eşleşmesi zaten kökle yapılır).
  const cleaned = kept.map((word, index) => (index === kept.length - 1 ? word.replace(/['’]\p{L}+$/u, '').replace(/(yla|yle|ları|leri|ını|ini|unu|ünü)$/u, (suffix) => (word.length - suffix.length >= 4 ? '' : suffix)) : word));
  return cleaned.join(' ').trim().slice(0, 60);
}
