/* ==========================================================================
   Optik — TYT / AYT / KPSS çalışma merkezi
   Tek dosyada: içerik + soru üreticileri + test motoru + yapay zekâ köprüsü
   Not: Bütün veriler tarayıcıda (localStorage) tutulur, sunucu yoktur.
   ========================================================================== */
'use strict';

/* ----------------------------- küçük yardımcılar ----------------------------- */
const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const R  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = R(0, i); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const esc = s => String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
const frac = (a, b) => { const g = (x, y) => y ? g(y, x % y) : x; const d = g(Math.abs(a), Math.abs(b)) || 1; return (b / d === 1) ? `${a / d}` : `${a / d}/${b / d}`; };
const bugun = () => new Date().toISOString().slice(0, 10);

/** Soru nesnesi üretir: 5 şıklı, karışık sıralı. */
function Q(q, correct, wrongs, sol) {
  correct = String(correct);
  let w = [...new Set(wrongs.map(String))].filter(v => v !== correct).slice(0, 4);
  let i = 1;
  while (w.length < 4) { const c = `${correct} (?${i})`; if (!w.includes(c)) w.push(c); i++; }
  const opts = shuffle([correct, ...w]);
  return { q, opts, ans: opts.indexOf(correct), sol };
}

/** Sayısal çeldiriciler. */
function numOpts(correct, spread = 6, dec = 0) {
  const seen = new Set([+(+correct).toFixed(dec)]), out = [];
  let guard = 0;
  while (out.length < 4 && guard++ < 300) {
    let c = +correct + (Math.random() < .5 ? -1 : 1) * R(1, spread) * (dec ? 0.5 : 1);
    c = +c.toFixed(dec);
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  let k = 1;
  while (out.length < 4) { const c = +(+correct + 10 * k).toFixed(dec); if (!seen.has(c)) { seen.add(c); out.push(c); } k++; }
  return out;
}

/** Veri listesinden soru üretir (eser-yazar, olay-yıl gibi eşleşmeler). */
function pairQ(list, valF, tpl, solTpl) {
  const it = pick(list);
  const others = [...new Set(list.map(x => x[valF]))].filter(v => v !== it[valF]);
  return Q(tpl(it), it[valF], shuffle(others).slice(0, 4), solTpl ? solTpl(it) : `Doğru cevap: ${it[valF]}`);
}

/** Hazır soru havuzundan rastgele çeker. */
function bankQ(bank) {
  const it = pick(bank);
  return Q(it.q, it.d, it.y, it.c || `Doğru cevap: ${it.d}`);
}

/* ----------------------------- durum / depolama ----------------------------- */
const KEY = 'optik.v1';
const varsayilan = {
  stats: { total: 0, correct: 0, byDers: {}, byDay: {} },
  wrong: [],
  streak: { last: '', count: 0 },
  ai: { provider: 'gemini', key: '' },
  settings: { sound: true, hideTimer: false, light: false }
};
let S = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...varsayilan, ...raw, stats: { ...varsayilan.stats, ...(raw.stats || {}) }, settings: { ...varsayilan.settings, ...(raw.settings || {}) }, ai: { ...varsayilan.ai, ...(raw.ai || {}) } };
  } catch { return structuredClone(varsayilan); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }

function kaydetSonuc(soru, dogruMu) {
  const g = bugun();
  S.stats.total++;
  if (dogruMu) S.stats.correct++;
  const d = S.stats.byDers[soru.ders] || (S.stats.byDers[soru.ders] = { t: 0, c: 0 });
  d.t++; if (dogruMu) d.c++;
  const day = S.stats.byDay[g] || (S.stats.byDay[g] = { t: 0, c: 0 });
  day.t++; if (dogruMu) day.c++;

  if (!dogruMu) {
    if (!S.wrong.some(w => w.q === soru.q)) {
      S.wrong.unshift({ q: soru.q, opts: soru.opts, ans: soru.ans, a: soru.opts[soru.ans], sol: soru.sol, ders: soru.ders, konu: soru.konu, tarih: g });
      S.wrong = S.wrong.slice(0, 300);
    }
  } else {
    S.wrong = S.wrong.filter(w => w.q !== soru.q);   // doğru çözülen soru defterden düşer
  }
  seriGuncelle();
  save();
}

function seriGuncelle() {
  const g = bugun();
  if (S.streak.last === g) return;
  const dun = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  S.streak.count = (S.streak.last === dun) ? S.streak.count + 1 : 1;
  S.streak.last = g;
}

/* ----------------------------- yönlendirme ----------------------------- */
function router() {
  const r = (location.hash.replace('#/', '') || 'home').split('?')[0];
  $$('.view').forEach(v => v.classList.toggle('on', v.dataset.view === r));
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.route === r));
  $('#nav').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (r === 'istatistik') cizIstatistik();
  if (r === 'defter') cizDefter();
  if (r === 'home') cizPanel();
}

/* ----------------------------- pomodoro ----------------------------- */
let pomo = { left: 25 * 60, on: false, mola: false, id: null };
function pomoCiz() {
  const m = String(Math.floor(pomo.left / 60)).padStart(2, '0');
  const s = String(pomo.left % 60).padStart(2, '0');
  $('#pomoTime').textContent = `${m}:${s}`;
}
function pomoTick() {
  if (!pomo.on) return;
  pomo.left--;
  if (pomo.left <= 0) {
    pomo.mola = !pomo.mola;
    pomo.left = pomo.mola ? 5 * 60 : 25 * 60;
    bip(pomo.mola ? 'ok' : 'no');
    alert(pomo.mola ? 'Süre doldu, 5 dakika mola.' : 'Mola bitti, 25 dakikalık tur başlıyor.');
  }
  pomoCiz();
}

/* ----------------------------- ses ----------------------------- */
let AC = null;
function bip(tip) {
  if (!S.settings.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.frequency.value = tip === 'ok' ? 720 : 220;
    g.gain.setValueAtTime(.06, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + .22);
    o.start(); o.stop(AC.currentTime + .22);
  } catch { }
}

/* ==========================================================================
   1) KONU ANLATIMLARI
   ========================================================================== */
const ANLATIM = [
/* ---------------- TYT MATEMATİK ---------------- */
{ders:'mat',konu:'temel',ad:'Temel kavramlar',grup:'TYT Matematik',html:`
<h2>Temel kavramlar</h2>
<p>Sayıların hangi kümede olduğunu ve birbirleriyle ilişkisini bilmek, sonraki bütün konuların zeminidir. TYT'de doğrudan 1-2 soru, dolaylı olarak neredeyse her soruda karşına çıkar.</p>
<h4>Sayı kümeleri</h4>
<ul>
<li><b>Doğal sayılar</b> N = {0, 1, 2, 3, …}</li>
<li><b>Tam sayılar</b> Z = {…, -2, -1, 0, 1, 2, …}</li>
<li><b>Rasyonel sayılar</b> Q: a/b biçiminde yazılabilen sayılar (b ≠ 0). Devirli ondalıklar da rasyoneldir.</li>
<li><b>İrrasyonel sayılar</b>: √2, π gibi kesir olarak yazılamayanlar.</li>
</ul>
<h4>Tek - çift kuralları</h4>
<div class="formula">T + T = Ç      T + Ç = T      Ç + Ç = Ç
T · T = T      T · Ç = Ç      Ç · Ç = Ç</div>
<p>Toplamada "tek sayıda tek varsa sonuç tektir", çarpmada "bir tane bile çift varsa sonuç çifttir" diye aklında tut.</p>
<h4>Ardışık sayılar</h4>
<div class="formula">1'den n'e kadar:            n(n+1)/2
1'den n'e kadar tek sayılar:  n²
1'den n'e kadar çift sayılar: n(n+1)</div>
<div class="tip"><b>Sınav taktiği:</b> Ardışık sayıların ortalaması, ortadaki terime eşittir. 5 ardışık sayının toplamı soruluyorsa ortadakine x deyip 5x yaz; işlem yarıya iner.</div>`},

{ders:'mat',konu:'bolme',ad:'Bölme ve bölünebilme',grup:'TYT Matematik',html:`
<h2>Bölme ve bölünebilme</h2>
<div class="formula">Bölünen = Bölen × Bölüm + Kalan      (0 ≤ Kalan &lt; Bölen)</div>
<h4>Bölünebilme kuralları</h4>
<ul>
<li><b>2</b>: son rakam çift</li>
<li><b>3</b>: rakamlar toplamı 3'ün katı</li>
<li><b>4</b>: son iki rakamın oluşturduğu sayı 4'ün katı</li>
<li><b>5</b>: son rakam 0 veya 5</li>
<li><b>8</b>: son üç rakam 8'in katı</li>
<li><b>9</b>: rakamlar toplamı 9'un katı</li>
<li><b>11</b>: rakamların birer atlayarak toplamları farkı 0 veya 11'in katı</li>
<li><b>6, 12, 15</b>: aralarında asal çarpanlarının ikisine birden bölünüyorsa (6 için 2 ve 3)</li>
</ul>
<div class="tip"><b>Kalan sorularında:</b> "5 ile bölündüğünde 3 kalanını veren sayı" demek, sayının <span class="mono">5k + 3</span> biçiminde olması demektir. Soruyu bu forma çevirmeden çözmeye çalışma.</div>`},

{ders:'mat',konu:'ebob',ad:'EBOB - EKOK',grup:'TYT Matematik',html:`
<h2>EBOB - EKOK</h2>
<p>EBOB: iki sayıyı da tam bölen en büyük sayı. EKOK: iki sayının da böldüğü en küçük sayı.</p>
<div class="formula">EBOB(a,b) × EKOK(a,b) = a × b</div>
<h4>Nerede hangisi?</h4>
<ul>
<li><b>EBOB</b>: bir şeyi <u>eşit parçalara bölme</u>, en büyük kare/parça bulma, artansız paylaştırma.</li>
<li><b>EKOK</b>: <u>tekrar buluşma</u>, aynı anda çalma, en küçük ortak süre, farklı sayılara bölündüğünde aynı kalanı verme.</li>
</ul>
<p>Örnek: 24 ve 36. Çarpanlarına ayır: 24 = 2³·3, 36 = 2²·3². EBOB ortak çarpanların küçük üslüsü = 2²·3 = 12. EKOK bütün çarpanların büyük üslüsü = 2³·3² = 72.</p>
<div class="tip"><b>Dikkat:</b> "3, 4 ve 5 ile bölündüğünde 2 kalanını veren en küçük sayı" → EKOK(3,4,5) + 2 = 62.</div>`},

{ders:'mat',konu:'uslu',ad:'Üslü sayılar',grup:'TYT Matematik',html:`
<h2>Üslü sayılar</h2>
<div class="formula">a^m · a^n = a^(m+n)
a^m / a^n = a^(m-n)
(a^m)^n = a^(m·n)
a^0 = 1  (a ≠ 0)
a^(-n) = 1 / a^n
(a·b)^n = a^n · b^n</div>
<h4>Sık düşülen tuzaklar</h4>
<ul>
<li>(-2)⁴ = 16 ama -2⁴ = -16. Parantez varsa işaret de üsse girer.</li>
<li>2³ + 2³ = 2·2³ = 2⁴. Toplamada üsler toplanmaz, ortak çarpan parantezine alınır.</li>
<li>Taban eşitlenmeden üsler karşılaştırılamaz: 9^x = 3^(2x).</li>
</ul>
<div class="tip"><b>Denklem çözerken</b> iki tarafı aynı tabana çevir. 4^(x+1) = 32 → 2^(2x+2) = 2⁵ → 2x + 2 = 5 → x = 1,5.</div>`},

{ders:'mat',konu:'koklu',ad:'Köklü sayılar',grup:'TYT Matematik',html:`
<h2>Köklü sayılar</h2>
<div class="formula">√a · √b = √(ab)          √a / √b = √(a/b)
a√c + b√c = (a+b)√c     ⁿ√(a^m) = a^(m/n)</div>
<h4>Paydayı kökten kurtarma</h4>
<p>1/√3 = √3/3. İki terimliyse eşleniğiyle çarp: 1/(√5 - √3) = (√5 + √3) / 2.</p>
<h4>Kök dışına çıkarma</h4>
<p>√72 = √(36·2) = 6√2. Kök içindeki sayıyı tam kare çarpanına ayırmak neredeyse her soruda ilk adımdır.</p>
<div class="tip"><b>Karşılaştırmada</b> sayıları kök içine sok: 3√2 = √18, 2√5 = √20 → 2√5 daha büyüktür.</div>`},

{ders:'mat',konu:'denklem',ad:'Denklemler ve eşitsizlikler',grup:'TYT Matematik',html:`
<h2>Denklemler ve eşitsizlikler</h2>
<h4>İkinci dereceden denklem</h4>
<div class="formula">ax² + bx + c = 0
Δ = b² - 4ac       x = (-b ± √Δ) / 2a
Kökler toplamı = -b/a      Kökler çarpımı = c/a</div>
<ul>
<li>Δ &gt; 0 → iki farklı gerçek kök</li>
<li>Δ = 0 → çakışık (tek) kök</li>
<li>Δ &lt; 0 → gerçek kök yok</li>
</ul>
<h4>Eşitsizlikler</h4>
<p>Negatif bir sayıyla çarparken ya da bölerken eşitsizliğin yönü değişir. -2x &gt; 6 → x &lt; -3.</p>
<div class="tip"><b>Zaman kazandıran hamle:</b> kökleri sorulmayan sorularda Δ ile uğraşma; kökler toplamı ve çarpımı formülleri çoğu zaman tek satırda sonucu verir.</div>`},

{ders:'mat',konu:'mutlak',ad:'Mutlak değer',grup:'TYT Matematik',html:`
<h2>Mutlak değer</h2>
<div class="formula">|x| = x   (x ≥ 0)
|x| = -x  (x &lt; 0)
|a·b| = |a|·|b|      |a| = |-a|</div>
<h4>Denklem ve eşitsizlik</h4>
<ul>
<li>|x| = a → x = a veya x = -a (a ≥ 0 olmalı)</li>
<li>|x| &lt; a → -a &lt; x &lt; a (arada)</li>
<li>|x| &gt; a → x &lt; -a veya x &gt; a (dışarıda)</li>
</ul>
<div class="tip"><b>Sözel yorum:</b> |x - 3| ifadesi "x'in 3'e uzaklığı" demektir. Uzaklık gözüyle bakınca eşitsizlik sorularının çoğu sayı doğrusunda 5 saniyede çözülür.</div>`},

{ders:'mat',konu:'oran',ad:'Oran - orantı',grup:'TYT Matematik',html:`
<h2>Oran - orantı</h2>
<p>a/b = c/d ise içler çarpımı dışlar çarpımına eşittir: a·d = b·c.</p>
<h4>Doğru ve ters orantı</h4>
<ul>
<li><b>Doğru orantı</b>: biri artarken diğeri artar, bölümleri sabittir (a/b = k).</li>
<li><b>Ters orantı</b>: biri artarken diğeri azalır, çarpımları sabittir (a·b = k).</li>
</ul>
<p>İşçi-gün, hız-zaman, musluk-süre ilişkileri ters orantıdır. "Daha fazla işçi → daha az süre" mantığını soruyu okurken kur.</p>
<div class="tip"><b>k ile çözüm:</b> a/2 = b/3 = c/5 verildiyse a = 2k, b = 3k, c = 5k yaz. Bilinmeyen sayısı üçten bire iner.</div>`},

{ders:'mat',konu:'yuzde',ad:'Yüzde, kâr - zarar, faiz',grup:'TYT Matematik',html:`
<h2>Yüzde, kâr - zarar, faiz</h2>
<div class="formula">Yüzde:  x'in %a'sı = x · a/100
Kâr:    Satış = Maliyet · (1 + k/100)
Zarar:  Satış = Maliyet · (1 - z/100)
Faiz:   Faiz = Anapara · n(yıl) · f/100</div>
<h4>Ardışık değişim tuzağı</h4>
<p>%20 zam sonra %20 indirim, başa döndürmez. 100 → 120 → 96. Toplam %4 <u>kayıp</u> vardır. Ardışık yüzdelerde çarpanlarla çalış: 1,2 · 0,8 = 0,96.</p>
<div class="tip"><b>Hangi sayının yüzdesi?</b> Kâr maliyet üzerinden, indirim etiket fiyatı üzerinden hesaplanır. Soru "hangisi üzerinden" diye sormuyorsa bile bunu kontrol et; çeldiriciler tam buradan üretilir.</div>`},

{ders:'mat',konu:'problem',ad:'Problemler (sayı, yaş, işçi, hız, karışım)',grup:'TYT Matematik',html:`
<h2>Problemler</h2>
<h4>Sayı problemleri</h4>
<p>"Bir sayının 3 katının 5 fazlası" → 3x + 5. Cümleyi soldan sağa okuyarak yaz, sondan başa değil.</p>
<h4>Yaş problemleri</h4>
<ul>
<li>İki kişinin yaş <b>farkı</b> hiç değişmez. En güçlü denklem budur.</li>
<li>n yıl sonra herkesin yaşına n eklenir; kişi sayısı kadar toplam artar.</li>
</ul>
<h4>İşçi - havuz</h4>
<div class="formula">Bir işçinin 1 günde yaptığı iş = 1/gün
Beraber: 1/a + 1/b = 1/x</div>
<h4>Hız - hareket</h4>
<div class="formula">Yol = Hız × Zaman
Yaklaşma (zıt yön): v₁ + v₂
Uzaklaşma (aynı yön): |v₁ - v₂|</div>
<h4>Karışım</h4>
<p>Tuz miktarı korunur. %20'lik 50 litrede 10 litre tuz vardır; su eklersen tuz sabit kalır, yüzdeyi yeniden hesapla.</p>
<div class="tip"><b>Genel kural:</b> Problemi okuyup bilinmeyeni <u>en çok ilişkiye giren</u> büyüklüğe ver. Yanlış bilinmeyen seçimi, doğru kurulmuş bir denklemi bile uzatır.</div>`},

{ders:'mat',konu:'kume',ad:'Kümeler',grup:'TYT Matematik',html:`
<h2>Kümeler</h2>
<div class="formula">s(A ∪ B) = s(A) + s(B) - s(A ∩ B)
s(A ∪ B ∪ C) = s(A)+s(B)+s(C) - s(A∩B) - s(A∩C) - s(B∩C) + s(A∩B∩C)
Alt küme sayısı = 2^n        Öz alt küme = 2^n - 1</div>
<p>Venn şeması çizmeden kümelerde soru çözme. İçten dışa doğru doldur: önce üçünün kesişimi, sonra ikililer, en son yalnızlar.</p>
<div class="tip"><b>"Yalnızca A"</b> ile <b>"A"</b> farklıdır. Soruda "sadece", "yalnız", "en az bir" ifadeleri şemanın hangi bölgesi olduğunu söyler; altını çizerek oku.</div>`},

{ders:'mat',konu:'fonksiyon',ad:'Fonksiyonlar',grup:'TYT Matematik',html:`
<h2>Fonksiyonlar</h2>
<p>Fonksiyon, tanım kümesindeki her elemanı değer kümesinde <u>bir tek</u> elemana eşleyen kuraldır.</p>
<div class="formula">Bileşke: (f∘g)(x) = f(g(x))
Ters:    f(x) = y  →  f⁻¹(y) = x
(f∘g)⁻¹ = g⁻¹ ∘ f⁻¹</div>
<h4>Ters fonksiyon bulma</h4>
<p>f(x) = 3x - 5. y = 3x - 5 yaz, x'i çek: x = (y + 5)/3. Sonra harfleri değiştir: f⁻¹(x) = (x + 5)/3.</p>
<div class="tip"><b>Bileşkede sıra önemlidir:</b> f∘g ile g∘f genelde eşit değildir. İçteki fonksiyon önce çalışır.</div>`},

{ders:'mat',konu:'olasilik',ad:'Permütasyon, kombinasyon, olasılık',grup:'TYT Matematik',html:`
<h2>Permütasyon, kombinasyon, olasılık</h2>
<div class="formula">P(n,r) = n! / (n-r)!        (sıra önemli)
C(n,r) = n! / (r!·(n-r)!)   (sıra önemsiz)
P(olay) = istenen durum / tüm durum</div>
<h4>Hangisi?</h4>
<ul>
<li>Başkan-yardımcı seçimi, sıraya dizilme, şifre → <b>permütasyon</b></li>
<li>Komisyon kurma, takım seçme, el seçimi → <b>kombinasyon</b></li>
</ul>
<h4>Tekrarlı permütasyon</h4>
<p>"KİTAP" 5! = 120 farklı sıralanır. "ANANAS" gibi harfleri tekrar edenlerde 6!/(3!·2!) yapılır.</p>
<div class="tip"><b>"En az bir"</b> gördüğünde tümleyenden git: P(en az bir) = 1 - P(hiçbiri). Doğrudan saymak neredeyse her zaman daha uzundur.</div>`},

{ders:'mat',konu:'dizi',ad:'Diziler ve seriler',grup:'TYT Matematik',html:`
<h2>Diziler</h2>
<div class="formula">Aritmetik:  aₙ = a₁ + (n-1)·d        Toplam = n·(a₁ + aₙ)/2
Geometrik:  aₙ = a₁ · r^(n-1)         Toplam = a₁(rⁿ - 1)/(r - 1)</div>
<p>Ardışık terimler arasındaki <b>fark</b> sabitse aritmetik, <b>oran</b> sabitse geometriktir. İlk işin bu farkı/oranı bulmak olsun.</p>
<div class="tip"><b>Orta terim:</b> aritmetik dizide ortadaki terim, komşularının aritmetik ortalamasıdır; geometrikte geometrik ortalamasıdır (b² = a·c).</div>`},

/* ---------------- GEOMETRİ ---------------- */
{ders:'geo',konu:'ucgen',ad:'Üçgenler',grup:'Geometri',html:`
<h2>Üçgenler</h2>
<div class="formula">İç açılar toplamı = 180°
Alan = taban × yükseklik / 2
Pisagor (dik üçgen): a² + b² = c²
Üçgen eşitsizliği: |b - c| &lt; a &lt; b + c</div>
<h4>Özel üçgenler</h4>
<ul>
<li>30-60-90: kenarlar x, x√3, 2x</li>
<li>45-45-90: kenarlar x, x, x√2</li>
<li>Pisagor üçlüleri: (3,4,5), (5,12,13), (8,15,17) ve katları</li>
</ul>
<h4>Benzerlik</h4>
<p>Açıları eşit olan üçgenler benzerdir; kenarları orantılıdır. Benzerlik oranı k ise <b>alan oranı k²</b>'dir. Bu ayrıntı en çok kaybedilen puandır.</p>
<div class="tip"><b>Açıortay-kenarortay karışıklığı:</b> kenarortay kenarı ikiye böler, açıortay açıyı. Şekle çizdiğin her bilgiyi kalemle işaretle; zihinden takip etme.</div>`},

{ders:'geo',konu:'dortgen',ad:'Dörtgenler',grup:'Geometri',html:`
<h2>Dörtgenler</h2>
<div class="formula">Kare:        A = a²            Köşegen = a√2
Dikdörtgen:  A = a·b
Paralelkenar:A = taban × yükseklik
Eşkenar dörtgen: A = köşegen çarpımı / 2
Yamuk:       A = (alt taban + üst taban) × yükseklik / 2</div>
<p>Dörtgenin iç açıları toplamı 360°'dir. Paralelkenarda karşılıklı açılar eşit, ardışık açılar bütünlerdir.</p>
<div class="tip"><b>Köşegenleri dik kesişen</b> her dörtgende alan, köşegenlerin çarpımının yarısıdır. Eşkenar dörtgen ve deltoid bu ailededir.</div>`},

{ders:'geo',konu:'cember',ad:'Çember ve daire',grup:'Geometri',html:`
<h2>Çember ve daire</h2>
<div class="formula">Çevre = 2πr        Alan = πr²
Yay uzunluğu = 2πr · (α/360)
Daire dilimi alanı = πr² · (α/360)</div>
<h4>Açılar</h4>
<ul>
<li><b>Merkez açı</b> gördüğü yaya eşittir.</li>
<li><b>Çevre açı</b> gördüğü yayın yarısıdır.</li>
<li>Çapı gören çevre açı 90°'dir.</li>
<li>Teğet, değme noktasındaki yarıçapa diktir.</li>
</ul>
<div class="tip"><b>İlk hamle:</b> soruda merkez varsa, merkezden her noktaya yarıçap çiz. Ortaya çıkan ikizkenar üçgenler çözümün yarısını verir.</div>`},

{ders:'geo',konu:'kati',ad:'Katı cisimler',grup:'Geometri',html:`
<h2>Katı cisimler</h2>
<div class="formula">Dikdörtgen prizma: V = a·b·c
Küp:      V = a³        Yüzey = 6a²
Silindir: V = πr²h      Yanal yüzey = 2πrh
Koni:     V = πr²h/3
Küre:     V = 4πr³/3    Yüzey = 4πr²</div>
<div class="tip"><b>Ölçek etkisi:</b> bir cismin bütün kenarları k katına çıkarsa alanı k², hacmi k³ katına çıkar. "Hacmi 8 katına çıktı" demek, kenarların 2 katına çıktığı demektir.</div>`},

{ders:'geo',konu:'analitik',ad:'Analitik geometri',grup:'Geometri',html:`
<h2>Analitik geometri</h2>
<div class="formula">İki nokta arası: √((x₂-x₁)² + (y₂-y₁)²)
Orta nokta: ((x₁+x₂)/2, (y₁+y₂)/2)
Eğim: m = (y₂-y₁)/(x₂-x₁)
Doğru: y = mx + n
Çember: (x-a)² + (y-b)² = r²</div>
<ul>
<li>Paralel doğrularda eğimler eşittir: m₁ = m₂</li>
<li>Dik doğrularda m₁ · m₂ = -1</li>
</ul>
<div class="tip"><b>Eksenleri kesen doğru:</b> x = 0 koyarsan y eksenini, y = 0 koyarsan x eksenini kestiği noktayı bulursun. Üçgen alanı soruları çoğunlukla bu iki noktadan çözülür.</div>`},

/* ---------------- TÜRKÇE ---------------- */
{ders:'turkce',konu:'sozcuk',ad:'Sözcükte anlam',grup:'Türkçe',html:`
<h2>Sözcükte anlam</h2>
<ul>
<li><b>Gerçek anlam</b>: sözcüğün ilk akla gelen anlamı. "Soğuk su içti."</li>
<li><b>Mecaz anlam</b>: bambaşka bir kavrama aktarılmış anlam. "Soğuk bir adamdı."</li>
<li><b>Terim anlam</b>: bir bilim, sanat veya meslek dalına ait. "Cümlenin ögeleri."</li>
<li><b>Yan anlam</b>: gerçek anlamla ilgisi süren yeni anlam. "Şişenin ağzı."</li>
<li><b>Deyim aktarması</b>: insana ait özelliğin doğaya verilmesi. "Rüzgâr ağlıyordu."</li>
</ul>
<h4>Karıştırılanlar</h4>
<p><b>Eş anlamlı</b> (kara-siyah), <b>zıt anlamlı</b> (uzun-kısa), <b>eş sesli</b> (yüz: sayı / surat / fiil), <b>yakın anlamlı</b> (dilemek-istemek: hep birbirinin yerine geçmez).</p>
<div class="tip"><b>Mecaz mı yan anlam mı?</b> Sözcüğün ilk anlamıyla mantıklı bir bağ kalmışsa yan anlamdır ("masanın ayağı" hâlâ destek işi görür); bağ tamamen kopmuşsa mecazdır.</div>`},

{ders:'turkce',konu:'cumle',ad:'Cümlede anlam',grup:'Türkçe',html:`
<h2>Cümlede anlam</h2>
<ul>
<li><b>Neden-sonuç</b>: "Yağmur yağdığı <u>için</u> maç ertelendi."</li>
<li><b>Amaç-sonuç</b>: "Sınavı kazanmak <u>için</u> çalışıyor." (henüz gerçekleşmemiş bir istek)</li>
<li><b>Koşul</b>: "Çalışırsa kazanır." (-se/-sa, -dikçe, üzere)</li>
<li><b>Karşılaştırma</b>: iki varlık aynı yönden ölçülür.</li>
<li><b>Öznellik</b>: doğruluğu kişiden kişiye değişir. <b>Nesnellik</b>: kanıtlanabilir.</li>
<li><b>Varsayım</b>: "Diyelim ki", "tut ki". <b>Olasılık</b>: "belki, -ebilir".</li>
</ul>
<div class="tip"><b>Neden-sonuç / amaç-sonuç ayrımı:</b> "için" bağlacından önceki yargı gerçekleşmişse neden, gerçekleşmemiş bir hedefse amaçtır. Bu ikili her yıl sorulur.</div>`},

{ders:'turkce',konu:'paragraf',ad:'Paragraf',grup:'Türkçe',html:`
<h2>Paragraf</h2>
<p>TYT Türkçe'nin yarısına yakını paragraftır. Konuyu bilmek değil, metni doğru okumak gerekir.</p>
<h4>Okuma sırası</h4>
<ul>
<li>Önce <u>soru kökünü</u> oku. Ne aradığını bilmeden metne girme.</li>
<li>İlk ve son cümle, ana düşüncenin genelde bulunduğu yerdir.</li>
<li>"Ancak, fakat, ne var ki" gibi bağlaçlardan sonrası yazarın asıl söylemek istediğidir.</li>
</ul>
<h4>Soru tipleri</h4>
<ul>
<li><b>Ana düşünce</b>: metnin tamamını kapsar, tek bir cümleye sıkışmaz.</li>
<li><b>Yardımcı düşünce</b>: "değinilmemiştir" sorularında 4 şıkkın karşılığını metinde işaretle, kalan cevaptır.</li>
<li><b>Anlatım biçimi</b>: açıklama, tartışma, betimleme, öyküleme.</li>
<li><b>Akışı bozan cümle</b>: konudan değil, <u>düşüncenin yönünden</u> kopan cümleyi ara.</li>
</ul>
<div class="tip"><b>Zaman tuzağı:</b> Paragrafta bir soruya 75 saniyeden fazla harcama. Takıldıysan işaretle, geç, dönüşte bak. Denemede en çok net, bu disiplinden kazanılır.</div>`},

{ders:'turkce',konu:'yazim',ad:'Yazım kuralları',grup:'Türkçe',html:`
<h2>Yazım kuralları</h2>
<ul>
<li><b>de / da</b> bağlacı ayrı yazılır ve "ve" anlamı taşır: "Ben de geldim." Bulunma eki bitişiktir: "Evde kimse yok."</li>
<li><b>ki</b> bağlacı ayrı: "Duydum ki…" Sadece <u>oysaki, mademki, halbuki, sanki, belki, çünkü</u> bitişiktir.</li>
<li><b>mi</b> her zaman ayrı yazılır, ekleri bitişik alır: "Geldi mi?", "Güzel miydi?"</li>
<li>Sayılar ayrı yazılır: "üç yüz elli". Bitişik yazılanlar: para senedi gibi resmî belgeler.</li>
<li>Özel ada gelen ekler kesme ile ayrılır: "Ankara'da". Yapım eki ve unvandan sonra ayrılmaz: "Türkçede", "Ahmet Bey'e".</li>
<li>Pekiştirmeler bitişik: "apaçık, sapasağlam, tertemiz".</li>
</ul>
<div class="tip"><b>de/da testi:</b> Cümleden çıkardığında anlam bozuluyorsa ektir (bitişik), bozulmuyorsa bağlaçtır (ayrı).</div>`},

{ders:'turkce',konu:'noktalama',ad:'Noktalama işaretleri',grup:'Türkçe',html:`
<h2>Noktalama işaretleri</h2>
<ul>
<li><b>Virgül</b>: eş görevli sözcükleri ayırır, özneyi vurgular ("Yaşlı adam, yavaşça yürüdü."), sıralı cümleleri böler. <u>"ve" bağlacından önce ve sonra virgül konmaz.</u></li>
<li><b>Noktalı virgül</b>: virgülle ayrılmış grupları birbirinden ayırır; "ama, fakat, ancak" bağlaçlarından önce kullanılır.</li>
<li><b>İki nokta</b>: açıklama ya da örnek sıralanacaksa, alıntı yapılacaksa.</li>
<li><b>Üç nokta</b>: tamamlanmamış cümle, sözün kesilmesi, alıntıda atlanan bölüm.</li>
<li><b>Kesme</b>: özel adlardan sonra gelen çekim eklerini ayırır.</li>
</ul>
<div class="tip"><b>Anlam değiştiren virgül:</b> "Genç, adama baktı." ile "Genç adama baktı." aynı cümle değildir. Soruda virgülün yeri değiştiriliyorsa özneyi arıyorlardır.</div>`},

{ders:'turkce',konu:'ses',ad:'Ses bilgisi',grup:'Türkçe',html:`
<h2>Ses bilgisi</h2>
<ul>
<li><b>Ünsüz yumuşaması</b>: p, ç, t, k → b, c, d, g/ğ. "kitap → kitabı"</li>
<li><b>Ünsüz benzeşmesi (sertleşme)</b>: sert ünsüzden sonra c, d, g sertleşir. "sokak + da → sokakta"</li>
<li><b>Ünlü düşmesi</b>: "burun + u → burnu", "ileri + le → ilerle"</li>
<li><b>Ünlü daralması</b>: a, e → ı, i. "başla + yor → başlıyor"</li>
<li><b>Ünsüz türemesi</b>: "his + etmek → hissetmek", "af + etmek → affetmek"</li>
<li><b>Kaynaştırma</b>: y, ş, s, n. "iki + şer", "oda + s + ı"</li>
</ul>
<div class="tip"><b>Yumuşama olmayan yerler:</b> tek heceli sözcüklerin çoğu (at → atı), özel adlar (Zonguldak'a) ve yabancı kökenli bazı sözcükler. Bu istisnalar doğrudan soru olur.</div>`},

{ders:'turkce',konu:'turler',ad:'Sözcük türleri',grup:'Türkçe',html:`
<h2>Sözcük türleri</h2>
<ul>
<li><b>İsim</b>: varlıkları karşılar. Çoğul, iyelik, hâl eki alabilir.</li>
<li><b>Sıfat</b>: ismi niteler (nasıl?) ya da belirtir (kaç? hangi?). Tek başına kullanılırsa adlaşmış sıfat olur.</li>
<li><b>Zamir</b>: ismin yerini tutar (ben, bu, kim, -ki, iyelik ekleri).</li>
<li><b>Zarf</b>: fiili, sıfatı ya da başka bir zarfı etkiler (ne zaman, nasıl, ne kadar, nerede).</li>
<li><b>Edat</b>: tek başına anlamsız, ad soylu sözcüklerle öbek kurar (gibi, kadar, için, ile).</li>
<li><b>Bağlaç</b>: aynı görevli sözleri bağlar, çıkarıldığında anlam bozulmaz (ve, ama, çünkü).</li>
<li><b>Ünlem</b>: duygu bildirir (eyvah, of).</li>
</ul>
<div class="tip"><b>Sıfat mı zarf mı?</b> Sözcük isimden önceyse sıfat, fiilden önceyse zarftır: "hızlı tren" (sıfat) - "hızlı koştu" (zarf).</div>`},

{ders:'turkce',konu:'fiilimsi',ad:'Fiilimsiler',grup:'Türkçe',html:`
<h2>Fiilimsiler</h2>
<p>Fiilden türeyip cümlede isim, sıfat ya da zarf görevi üstlenen sözcüklerdir. Yan cümlecik kurarlar, kip ve kişi eki almazlar.</p>
<ul>
<li><b>İsim-fiil</b>: -ma, -ış, -mak → "koşmak, bakış, gülme"</li>
<li><b>Sıfat-fiil</b>: -an, -ası, -mez, -ar, -dik, -ecek, -miş → "gelen yolcu, okunacak kitap"</li>
<li><b>Zarf-fiil</b>: -ken, -alı, -ince, -ip, -arak, -madan, -dıkça, -e…-e → "gülerek anlattı"</li>
</ul>
<div class="tip"><b>Ezber cümlesi:</b> sıfat-fiil için "an-ası-mez-ar-dik-ecek-miş", isim-fiil için "ma-ış-mak". Bu iki diziyi bilirsen fiilimsi sorularının tamamını hızlı elersin. Dikkat: "dondurma, çakmak" gibi kalıplaşıp isim olmuş sözcükler fiilimsi değildir.</div>`},

{ders:'turkce',konu:'ogeler',ad:'Cümlenin ögeleri',grup:'Türkçe',html:`
<h2>Cümlenin ögeleri</h2>
<ul>
<li><b>Yüklem</b>: önce onu bul. Cümlenin yargı bildiren sözüdür.</li>
<li><b>Özne</b>: yükleme "kim / ne" sorulur. "Kitap okundu" → gizli özne yok, sözde özne vardır.</li>
<li><b>Belirtili nesne</b>: "kimi / neyi". <b>Belirtisiz nesne</b>: "ne".</li>
<li><b>Dolaylı tümleç</b>: "kime, kimde, kimden, nereye, nerede, nereden".</li>
<li><b>Zarf tümleci</b>: "ne zaman, nasıl, ne kadar, niçin".</li>
</ul>
<div class="tip"><b>Sıra:</b> yüklem → özne → nesne → tümleçler. Bu sırayı bozarsan aynı sözcüğü iki farklı ögeye yazarsın. Ayrıca "nereye/nerede" soruları yer bildirdiğinde dolaylı tümleç, zaman bildirdiğinde zarf tümlecidir.</div>`},

{ders:'turkce',konu:'bozukluk',ad:'Anlatım bozuklukları',grup:'Türkçe',html:`
<h2>Anlatım bozuklukları</h2>
<h4>Anlamsal</h4>
<ul>
<li><b>Gereksiz sözcük</b>: "yukarı çıktı", "geri iade etti"</li>
<li><b>Anlamca çelişme</b>: "kesinlikle belki gelir"</li>
<li><b>Sıralama hatası</b>: "önce yendi sonra pişirildi"</li>
<li><b>Deyim yanlışı</b>: "göz atmak" yerine "göz gezdirmek dikmek"</li>
</ul>
<h4>Yapısal</h4>
<ul>
<li><b>Özne-yüklem uyumsuzluğu</b>: "Çocuklar bahçede oynuyor<u>lar</u>dı" - insan dışı çoğullarda -ler almaz.</li>
<li><b>Nesne / tümleç eksikliği</b>: "Kitabı okudu ve çok beğendi" (nesne ortak olamaz → "onu" eklenmeli).</li>
<li><b>Tamlama yanlışı</b>: "ekonomik ve siyasi sorunlar" doğru, "ekonomik ve siyaset sorunları" yanlış.</li>
<li><b>Çatı uyuşmazlığı</b>: "Odaya girildi ve ışıkları yaktı."</li>
</ul>
<div class="tip"><b>Yöntem:</b> Cümleyi kısalt. Yüklemle özneyi yan yana getir, sonra yüklemle nesneyi. Uyumsuzluk çıplak kalır.</div>`},

/* ---------------- AYT MATEMATİK ---------------- */
{ders:'aytmat',konu:'limit',ad:'Limit ve süreklilik',grup:'AYT Matematik',html:`
<h2>Limit ve süreklilik</h2>
<p>Limit, fonksiyonun bir noktaya <u>yaklaşırken</u> gittiği değerdir; o noktadaki değeri olmak zorunda değildir.</p>
<div class="formula">Soldan limit = Sağdan limit  →  limit vardır
0/0 belirsizliği → çarpanlara ayır ya da eşleniğiyle çarp
∞/∞ (polinomlarda) → en büyük dereceli terimlerin oranı</div>
<p><b>Süreklilik</b> için üç şart: f(a) tanımlı olmalı, limit var olmalı, ikisi eşit olmalı.</p>
<div class="tip"><b>Parçalı fonksiyonlarda</b> limit her zaman kırılma noktasında sorulur. Sağdan ve soldan ayrı ayrı hesapla, sonra eşitle.</div>`},

{ders:'aytmat',konu:'turev',ad:'Türev',grup:'AYT Matematik',html:`
<h2>Türev</h2>
<div class="formula">(xⁿ)' = n·x^(n-1)
(sin x)' = cos x        (cos x)' = -sin x
(eˣ)' = eˣ              (ln x)' = 1/x
(u·v)' = u'v + uv'
(u/v)' = (u'v - uv') / v²
Zincir: [f(g(x))]' = f'(g(x)) · g'(x)</div>
<h4>Ne işe yarar?</h4>
<ul>
<li>Bir noktadaki <b>teğetin eğimi</b>: m = f'(x₀)</li>
<li>f'(x) &gt; 0 ise fonksiyon artan, f'(x) &lt; 0 ise azalandır.</li>
<li>f'(x) = 0 noktaları <b>yerel maksimum/minimum</b> adaylarıdır.</li>
<li>Fizikte: konumun türevi hız, hızın türevi ivmedir.</li>
</ul>
<div class="tip"><b>Maksimum-minimum problemlerinde</b> önce değişkeni tek harfe indir, sonra türev al, sıfıra eşitle. Alan/hacim en büyükleme soruları hep bu üç adımdır.</div>`},

{ders:'aytmat',konu:'integral',ad:'İntegral',grup:'AYT Matematik',html:`
<h2>İntegral</h2>
<div class="formula">∫xⁿ dx = x^(n+1)/(n+1) + c   (n ≠ -1)
∫(1/x) dx = ln|x| + c
∫eˣ dx = eˣ + c
∫sin x dx = -cos x + c
Belirli integral: ∫[a,b] f(x)dx = F(b) - F(a)</div>
<p>Belirli integral, eğri ile x ekseni arasındaki <b>alanı</b> verir. Eğri x ekseninin altındaysa sonuç negatif çıkar; alan sorulduğunda mutlak değer al.</p>
<div class="tip"><b>İki eğri arasındaki alan:</b> ∫(üstteki - alttaki) dx. Hangisinin üstte olduğunu bulmak için aralıktan bir sayı seçip yerine koy.</div>`},

{ders:'aytmat',konu:'log',ad:'Logaritma',grup:'AYT Matematik',html:`
<h2>Logaritma</h2>
<div class="formula">log_a b = c  ⟺  a^c = b
log(a·b) = log a + log b
log(a/b) = log a - log b
log(a^n) = n · log a
Taban değiştirme: log_a b = log b / log a</div>
<p>Tanımlı olması için: taban a &gt; 0 ve a ≠ 1, argüman b &gt; 0 olmalı. Soruların bir kısmı doğrudan bu koşullardan sorulur.</p>
<div class="tip"><b>log_a a = 1</b> ve <b>log_a 1 = 0</b>. Bu ikisini refleks haline getir; uzun ifadelerin çoğu bunlarla sadeleşir.</div>`},

{ders:'aytmat',konu:'trigo',ad:'Trigonometri',grup:'AYT Matematik',html:`
<h2>Trigonometri</h2>
<div class="formula">sin²x + cos²x = 1
tan x = sin x / cos x
sin(2x) = 2·sin x·cos x
cos(2x) = cos²x - sin²x
1 derece = π/180 radyan</div>
<h4>Temel değerler</h4>
<div class="formula">       0°    30°     45°     60°    90°
sin    0    1/2    √2/2    √3/2    1
cos    1   √3/2    √2/2     1/2    0
tan    0   √3/3     1       √3     —</div>
<div class="tip"><b>Bölgeler:</b> I. bölgede hepsi +, II. bölgede sin +, III. bölgede tan +, IV. bölgede cos +. Kısaca: "hepsi - sinüs - tanjant - kosinüs".</div>`},

{ders:'aytmat',konu:'karmasik',ad:'Karmaşık sayılar',grup:'AYT Matematik',html:`
<h2>Karmaşık sayılar</h2>
<div class="formula">i = √-1     i² = -1     i³ = -i     i⁴ = 1
z = a + bi
Eşlenik: z̄ = a - bi
|z| = √(a² + b²)</div>
<p>i'nin kuvvetleri 4 adımda bir tekrar eder. i^2026 için üssü 4'e böl, kalana bak: 2026 = 4·506 + 2 → i² = -1.</p>
<div class="tip"><b>Bölme işlemi:</b> paydayı eşlenikle çarp. (1+i)/(1-i) = (1+i)² / 2 = 2i/2 = i.</div>`},

/* ---------------- FİZİK / KİMYA / BİYOLOJİ ---------------- */
{ders:'fizik',konu:'hareket',ad:'Hareket',grup:'Fizik',html:`
<h2>Hareket</h2>
<div class="formula">Ortalama hız = alınan yol / geçen süre
Sabit ivmeli: v = v₀ + a·t
x = v₀·t + a·t²/2
Serbest düşme: h = g·t²/2   (g ≈ 10 m/s²)</div>
<p><b>Yol</b> skaler, <b>yer değiştirme</b> vektörel büyüklüktür. Kapalı bir yolda yer değiştirme sıfırdır ama yol sıfır değildir.</p>
<div class="tip"><b>Grafik okuma:</b> Konum-zaman grafiğinin eğimi hızı, hız-zaman grafiğinin eğimi ivmeyi, hız-zaman grafiğinin altındaki alan yer değiştirmeyi verir.</div>`},

{ders:'fizik',konu:'kuvvet',ad:'Kuvvet, iş ve enerji',grup:'Fizik',html:`
<h2>Kuvvet, iş ve enerji</h2>
<div class="formula">F = m·a                     (Newton II)
W = F·x·cosθ                (iş, birim: joule)
Ek = m·v²/2                 (kinetik enerji)
Ep = m·g·h                  (potansiyel enerji)
P = W / t                   (güç, birim: watt)</div>
<p>Sürtünmesiz ortamda mekanik enerji korunur: Ek + Ep = sabit. Sürtünme varsa kaybolan enerji ısıya dönüşür.</p>
<div class="tip"><b>İş sıfır olur</b> eğer kuvvet ile yer değiştirme dikse (θ = 90°). Bir cismi elinde tutarak yatay yürümek fiziksel olarak iş yapmak değildir.</div>`},

{ders:'kimya',konu:'atom',ad:'Atom ve periyodik sistem',grup:'Kimya',html:`
<h2>Atom ve periyodik sistem</h2>
<ul>
<li><b>Proton sayısı = atom numarası</b> ve elementin kimliğidir.</li>
<li>Nötr atomda proton = elektron.</li>
<li><b>Kütle numarası = proton + nötron</b></li>
<li><b>İzotop</b>: proton aynı, nötron farklı. <b>İyon</b>: elektron alıp vermiş atom.</li>
</ul>
<p>Periyodik tabloda soldan sağa atom yarıçapı küçülür, iyonlaşma enerjisi artar. Yukarıdan aşağı yarıçap büyür.</p>
<div class="tip"><b>Grup numarası</b> değerlik elektron sayısını verir. 1A: 1 elektron verir, 7A: 1 elektron alır, 8A (soy gazlar) tepkimeye girmez.</div>`},

{ders:'kimya',konu:'mol',ad:'Mol kavramı',grup:'Kimya',html:`
<h2>Mol kavramı</h2>
<div class="formula">1 mol = 6,02 × 10²³ tanecik (Avogadro)
mol = kütle (g) / mol kütlesi (g/mol)
Normal koşullarda 1 mol gaz = 22,4 litre</div>
<p>Örnek: 36 g suyun mol sayısı? H₂O = 18 g/mol → 36/18 = 2 mol. İçinde 2 × 6,02·10²³ molekül vardır.</p>
<div class="tip"><b>Denklem denkleştirmede</b> atom sayısı iki tarafta eşit olmalıdır. Önce metal, sonra ametal, en son hidrojen ve oksijeni denkleştir.</div>`},

{ders:'biyo',konu:'hucre',ad:'Hücre ve organeller',grup:'Biyoloji',html:`
<h2>Hücre ve organeller</h2>
<ul>
<li><b>Mitokondri</b>: oksijenli solunum, ATP üretimi</li>
<li><b>Ribozom</b>: protein sentezi (zarsız, tüm hücrelerde var)</li>
<li><b>Kloroplast</b>: fotosentez (yalnız bitki hücresinde)</li>
<li><b>Lizozom</b>: sindirim enzimleri (hayvan hücresinde belirgin)</li>
<li><b>Golgi</b>: salgı üretimi ve paketleme</li>
<li><b>ER</b>: granüllü olan protein, granülsüz olan yağ taşır</li>
<li><b>Koful</b>: bitkilerde büyük ve tek, hayvanlarda küçük ve çok</li>
</ul>
<div class="tip"><b>Bitki hücresini ayıran üç şey:</b> hücre duvarı, kloroplast, büyük koful. Hayvan hücresini ayıran: sentrozom ve belirgin lizozom.</div>`},

{ders:'biyo',konu:'bolunme',ad:'Mitoz ve mayoz',grup:'Biyoloji',html:`
<h2>Mitoz ve mayoz</h2>
<ul>
<li><b>Mitoz</b>: 1 hücreden 2 hücre, kromozom sayısı korunur (2n → 2n). Büyüme, onarım, eşeysiz üreme.</li>
<li><b>Mayoz</b>: 1 hücreden 4 hücre, kromozom sayısı yarılanır (2n → n). Üreme hücresi oluşumu.</li>
</ul>
<p>Mayozda <b>krossing-over</b> (parça değişimi) ve homolog kromozomların rastgele dağılımı genetik çeşitliliği sağlar. Mitozda çeşitlilik oluşmaz.</p>
<div class="tip"><b>Sık çıkan ayrım:</b> krossing-over yalnızca mayoz I'in profaz evresinde olur. Bir soruda "genetik çeşitlilik" geçiyorsa cevap neredeyse her zaman mayozdur.</div>`},

/* ---------------- TARİH / COĞRAFYA / VATANDAŞLIK ---------------- */
{ders:'tarih',konu:'ilkturk',ad:'İlk Türk devletleri',grup:'Tarih',html:`
<h2>İslamiyet öncesi Türk devletleri</h2>
<ul>
<li><b>Asya Hun</b>: bilinen ilk teşkilatlı Türk devleti, Mete Han ordu düzenini (onluk sistem) kurdu.</li>
<li><b>Göktürk</b>: "Türk" adını devlet adı olarak ilk kullanan devlet. Bumin Kağan kurdu.</li>
<li><b>II. Göktürk (Kutluk)</b>: Orhun Yazıtları burada dikildi — Türk edebiyatının ilk yazılı ürünleri.</li>
<li><b>Uygur</b>: yerleşik hayata geçen ilk Türk devleti, kendi alfabelerini kullandılar, Mani dinini benimsediler.</li>
</ul>
<div class="tip"><b>Kesin bilgiler:</b> ilk teşkilatlı = Asya Hun, "Türk" adını ilk kullanan = Göktürk, yerleşik hayata ilk geçen = Uygur. Bu üçlü doğrudan soru olur.</div>`},

{ders:'tarih',konu:'osmanli',ad:'Osmanlı Devleti',grup:'Tarih',html:`
<h2>Osmanlı Devleti</h2>
<ul>
<li><b>1299</b> kuruluş (Osman Bey) · <b>1326</b> Bursa'nın fethi, başkent</li>
<li><b>1389</b> I. Kosova · <b>1402</b> Ankara Savaşı ve Fetret Devri</li>
<li><b>1453</b> İstanbul'un fethi — Orta Çağ'ın sonu</li>
<li><b>1514</b> Çaldıran · <b>1517</b> Ridaniye, halifelik Osmanlı'ya geçti</li>
<li><b>1526</b> Mohaç · <b>1571</b> İnebahtı (donanma yakıldı)</li>
<li><b>1699</b> Karlofça — ilk kez büyük toprak kaybı, gerileme başlangıcı</li>
<li><b>1839</b> Tanzimat · <b>1856</b> Islahat · <b>1876</b> I. Meşrutiyet</li>
</ul>
<div class="tip"><b>Antlaşma mantığı:</b> Karlofça (1699) ve Küçük Kaynarca (1774) dönüm noktalarıdır. Küçük Kaynarca ile Rusya Ortodoksların koruyuculuğunu üstlendi; sonraki bütün Rus müdahalelerinin dayanağı budur.</div>`},

{ders:'tarih',konu:'kurtulus',ad:'Kurtuluş Savaşı ve inkılaplar',grup:'Tarih',html:`
<h2>Kurtuluş Savaşı ve inkılaplar</h2>
<ul>
<li><b>19 Mayıs 1919</b> Samsun · <b>22 Haziran 1919</b> Amasya Genelgesi (kurtuluşun yöntemi ilk kez açıklandı)</li>
<li><b>Erzurum ve Sivas Kongreleri</b> (1919) · <b>23 Nisan 1920</b> TBMM açıldı</li>
<li><b>I. ve II. İnönü</b> (1921) · <b>Sakarya</b> (1921, savunmadan taarruza) · <b>Büyük Taarruz</b> (30 Ağustos 1922)</li>
<li><b>11 Ekim 1922</b> Mudanya Ateşkesi · <b>24 Temmuz 1923</b> Lozan</li>
<li><b>29 Ekim 1923</b> Cumhuriyet ilan edildi · <b>3 Mart 1924</b> halifelik kaldırıldı, Tevhid-i Tedrisat</li>
<li><b>1928</b> Harf İnkılabı · <b>1934</b> soyadı kanunu ve kadınlara seçilme hakkı</li>
</ul>
<div class="tip"><b>Ayrım:</b> Amasya Genelgesi kurtuluşun <u>gerekçesi ve yöntemi</u>, Erzurum <u>bölgesel</u>, Sivas <u>ulusal</u> karar organıdır. Soru bu sıradaki farkı ölçer.</div>`},

{ders:'cografya',konu:'turkiye',ad:'Türkiye’nin coğrafi konumu',grup:'Coğrafya',html:`
<h2>Türkiye'nin konumu</h2>
<ul>
<li><b>Matematik konum</b>: 36°-42° kuzey enlemleri, 26°-45° doğu boylamları arasında.</li>
<li>Kuzey yarım kürede, orta kuşakta yer alır → dört mevsim belirgin yaşanır.</li>
<li>Doğu-batı arasında 76 dakikalık <u>yerel saat farkı</u> vardır (19° × 4 dk).</li>
<li>Ortalama yükselti 1132 m; doğuya gidildikçe yükselti artar, sıcaklık düşer.</li>
</ul>
<h4>İklim</h4>
<p>Akdeniz iklimi: yazlar sıcak kurak, kışlar ılık yağışlı, maki bitki örtüsü. Karadeniz: her mevsim yağışlı, orman. Karasal: kışlar sert, yazlar kurak, bozkır.</p>
<div class="tip"><b>Enlem etkisi</b> sıcaklığı, <b>yükselti</b> hem sıcaklığı hem yağışı, <b>denize uzaklık</b> nem ve sıcaklık farkını belirler. Bir yerin iklimini yorumlarken bu üç başlığı sırayla sor.</div>`},

{ders:'vatandaslik',konu:'anayasa',ad:'Anayasa ve temel ilkeler',grup:'KPSS Vatandaşlık',html:`
<h2>Anayasa ve temel ilkeler</h2>
<ul>
<li>1982 Anayasası'nın ilk dört maddesi <b>değiştirilemez, değiştirilmesi teklif edilemez</b>.</li>
<li>Madde 1: Devletin şekli Cumhuriyettir.</li>
<li>Madde 2: Türkiye Cumhuriyeti demokratik, laik, sosyal bir hukuk devletidir.</li>
<li>Madde 3: Devlet ülkesi ve milletiyle bölünmez bir bütündür; dili Türkçedir, bayrağı, milli marşı ve başkenti Ankara'dır.</li>
<li>Madde 4: İlk üç maddenin değiştirilemezliğini düzenler.</li>
</ul>
<h4>Erkler</h4>
<ul>
<li><b>Yasama</b>: TBMM — 600 milletvekili, seçilme yaşı 18.</li>
<li><b>Yürütme</b>: Cumhurbaşkanı — 5 yıllık görev, en fazla iki dönem.</li>
<li><b>Yargı</b>: bağımsız mahkemeler; Anayasa Mahkemesi, Yargıtay, Danıştay, Sayıştay.</li>
</ul>
<div class="tip"><b>Sayı ezberi:</b> 600 milletvekili, 18 seçilme yaşı, 5 yıl görev süresi, ilk 4 madde değiştirilemez. KPSS'de bu dört sayı neredeyse her yıl sorulur.</div>`},

{ders:'edebiyat',konu:'akimlar',ad:'Edebî dönemler ve akımlar',grup:'AYT Edebiyat',html:`
<h2>Edebî dönemler</h2>
<ul>
<li><b>Divan edebiyatı</b>: aruz ölçüsü, beyit birimi, Arapça-Farsça ağırlıklı dil. Fuzuli, Baki, Nedim, Şeyh Galip.</li>
<li><b>Halk edebiyatı</b>: hece ölçüsü, dörtlük, sade dil. Karacaoğlan, Yunus Emre, Aşık Veysel.</li>
<li><b>Tanzimat</b> (1860): Batı'dan roman, tiyatro, makale geldi. "Sanat toplum için" anlayışı. Şinasi, Namık Kemal, Ziya Paşa.</li>
<li><b>Servet-i Fünun</b> (1896): ağır dil, "sanat sanat içindir", karamsarlık. Tevfik Fikret, Halit Ziya.</li>
<li><b>Milli Edebiyat</b> (1911): sade dil, hece ölçüsü, Anadolu. Ömer Seyfettin, Ziya Gökalp, Mehmet Emin.</li>
<li><b>Cumhuriyet dönemi</b>: toplumcu gerçekçilik, Garip ve İkinci Yeni şiiri. Nâzım Hikmet, Orhan Veli, Sait Faik, Yaşar Kemal.</li>
</ul>
<div class="tip"><b>Hızlı ayrım:</b> dil sade + hece ölçüsü + Anadolu konusu → Milli Edebiyat. Dil ağır + bireysel karamsarlık → Servet-i Fünun.</div>`}
];

/* ==========================================================================
   2) VERİ HAVUZLARI  (soru üreticileri bunlardan beslenir)
   ========================================================================== */
const D_YAZIM = [
 {d:'herkes',y:'herkez'},{d:'yalnız',y:'yalnış'},{d:'yanlış',y:'yanlız'},{d:'sürpriz',y:'süpriz'},
 {d:'orijinal',y:'orjinal'},{d:'makine',y:'makina'},{d:'kılavuz',y:'klavuz'},{d:'şoför',y:'şöför'},
 {d:'egzoz',y:'egzos'},{d:'yarın',y:'yarin'},{d:'ağabey',y:'abey'},{d:'direkt',y:'direk'},
 {d:'eşofman',y:'eşortman'},{d:'kirpik',y:'kiprik'},{d:'poğaça',y:'pogaça'},
 {d:'pantolon',y:'pantalon'},{d:'kapasite',y:'kapesite'},{d:'ambulans',y:'anbulans'},{d:'kontrol',y:'kontrul'},
 {d:'meyve',y:'meyva'},{d:'mahsus',y:'mahsuz'},{d:'tıraş',y:'traş'},{d:'yağmur',y:'yagmur'},
 {d:'yalnızca',y:'yanlızca'},{d:'hiçbir',y:'hiç bir'},
 {d:'birçok',y:'bir çok'},{d:'herhangi',y:'her hangi'},{d:'hiçbiri',y:'hiç biri'},{d:'birkaç',y:'bir kaç'},
 {d:'çünkü',y:'çünki'},{d:'aşağı yukarı',y:'aşağıyukarı'},{d:'şarj',y:'şarz'},
 {d:'laboratuvar',y:'labaratuvar'},{d:'entelektüel',y:'entellektüel'},
 {d:'tabii',y:'tabi (elbette anlamı)'},
 {d:'değil',y:'diğil'},{d:'sadece',y:'sedece'},{d:'üzere',y:'üzre'},{d:'nasılsa',y:'nasıl sa'},
 {d:'biraz',y:'bir az'},{d:'hoş geldiniz',y:'hoşgeldiniz'},{d:'bugün',y:'bu gün'},{d:'her şey',y:'herşey'}
];

const D_SES = [
 {k:'kitabı',v:'Ünsüz yumuşaması'},{k:'ağacı',v:'Ünsüz yumuşaması'},{k:'rengi',v:'Ünsüz yumuşaması'},
 {k:'kanadı',v:'Ünsüz yumuşaması'},{k:'çorabı',v:'Ünsüz yumuşaması'},
 {k:'sokakta',v:'Ünsüz benzeşmesi'},{k:'ağaçtan',v:'Ünsüz benzeşmesi'},{k:'ipte',v:'Ünsüz benzeşmesi'},
 {k:'kitapçı',v:'Ünsüz benzeşmesi'},{k:'çiftçi',v:'Ünsüz benzeşmesi'},
 {k:'burnu',v:'Ünlü düşmesi'},{k:'oğlu',v:'Ünlü düşmesi'},{k:'alnı',v:'Ünlü düşmesi'},
 {k:'sabrı',v:'Ünlü düşmesi'},{k:'ilerlemek',v:'Ünlü düşmesi'},
 {k:'başlıyor',v:'Ünlü daralması'},{k:'gelmiyor',v:'Ünlü daralması'},{k:'anlıyor',v:'Ünlü daralması'},
 {k:'söylüyor',v:'Ünlü daralması'},
 {k:'hissetmek',v:'Ünsüz türemesi'},{k:'affetmek',v:'Ünsüz türemesi'},{k:'zannetmek',v:'Ünsüz türemesi'},
 {k:'odası',v:'Kaynaştırma ünsüzü'},{k:'kapıya',v:'Kaynaştırma ünsüzü'},{k:'ikişer',v:'Kaynaştırma ünsüzü'},
 {k:'ne + için → niçin',v:'Ünlü düşmesi'},{k:'kahve + altı → kahvaltı',v:'Ünlü düşmesi'}
];

const D_FIILIMSI = [
 {k:'Koşarak eve girdi.',v:'Zarf-fiil (-arak)'},{k:'Gülüşü herkesi rahatlattı.',v:'İsim-fiil (-ış)'},
 {k:'Okunacak kitapları ayırdım.',v:'Sıfat-fiil (-ecek)'},{k:'Gelen misafiri karşıladık.',v:'Sıfat-fiil (-en)'},
 {k:'Yemek yapmayı seviyorum.',v:'İsim-fiil (-mak)'},{k:'Eve gelince beni ara.',v:'Zarf-fiil (-ince)'},
 {k:'Bakışları çok anlamlıydı.',v:'İsim-fiil (-ış)'},{k:'Çalışmadan başarı gelmez.',v:'Zarf-fiil (-madan)'},
 {k:'Tanıdık bir yüz gördüm.',v:'Sıfat-fiil (-dik)'},{k:'Yürüdükçe içi açıldı.',v:'Zarf-fiil (-dikçe)'},
 {k:'Susuz kalmış toprak gibiydi.',v:'Sıfat-fiil (-miş)'},{k:'Beklemek en zoruydu.',v:'İsim-fiil (-mek)'},
 {k:'Kapıyı açıp içeri girdi.',v:'Zarf-fiil (-ip)'},{k:'Geçilmez yollar vardı.',v:'Sıfat-fiil (-mez)'},
 {k:'Ders çalışırken uyuyakaldı.',v:'Zarf-fiil (-ken)'}
];

const D_TARIH = [
 {o:'Malazgirt Savaşı',y:'1071'},{o:'İstanbul\'un fethi',y:'1453'},{o:'Çaldıran Savaşı',y:'1514'},
 {o:'Mohaç Meydan Muharebesi',y:'1526'},{o:'Preveze Deniz Zaferi',y:'1538'},{o:'İnebahtı Deniz Savaşı',y:'1571'},
 {o:'Karlofça Antlaşması',y:'1699'},{o:'Pasarofça Antlaşması',y:'1718'},{o:'Küçük Kaynarca Antlaşması',y:'1774'},
 {o:'Tanzimat Fermanı',y:'1839'},{o:'Islahat Fermanı',y:'1856'},{o:'I. Meşrutiyet\'in ilanı',y:'1876'},
 {o:'II. Meşrutiyet\'in ilanı',y:'1908'},{o:'Trablusgarp Savaşı\'nın başlaması',y:'1911'},
 {o:'Balkan Savaşları\'nın başlaması',y:'1912'},{o:'I. Dünya Savaşı\'nın başlaması',y:'1914'},
 {o:'Çanakkale Deniz Zaferi',y:'1915'},{o:'Mondros Ateşkes Antlaşması',y:'1918'},
 {o:'Mustafa Kemal\'in Samsun\'a çıkışı',y:'1919'},{o:'Sevr Antlaşması',y:'1920'},
 {o:'TBMM\'nin açılışı',y:'1920'},{o:'Sakarya Meydan Muharebesi',y:'1921'},{o:'Büyük Taarruz',y:'1922'},
 {o:'Mudanya Ateşkes Antlaşması',y:'1922'},{o:'Lozan Barış Antlaşması',y:'1923'},
 {o:'Cumhuriyet\'in ilanı',y:'1923'},{o:'Halifeliğin kaldırılması',y:'1924'},
 {o:'Tevhid-i Tedrisat Kanunu',y:'1924'},{o:'Şapka Kanunu',y:'1925'},{o:'Medeni Kanun\'un kabulü',y:'1926'},
 {o:'Harf İnkılabı',y:'1928'},{o:'Soyadı Kanunu',y:'1934'},{o:'Kadınlara milletvekili seçilme hakkı',y:'1934'},
 {o:'Montrö Boğazlar Sözleşmesi',y:'1936'},{o:'Hatay\'ın anavatana katılması',y:'1939'},
 {o:'Türkiye\'nin NATO\'ya üye olması',y:'1952'},{o:'Anadolu Selçuklu Devleti\'nin kurulması',y:'1077'},
 {o:'Kösedağ Savaşı',y:'1243'},{o:'Osmanlı Devleti\'nin kuruluşu',y:'1299'},{o:'Ankara Savaşı',y:'1402'},
 {o:'I. Kosova Savaşı',y:'1389'},{o:'Ridaniye Savaşı ve halifeliğin geçişi',y:'1517'},
 {o:'Zitvatorok Antlaşması',y:'1606'},{o:'Vaka-i Hayriye (Yeniçeri Ocağı\'nın kaldırılması)',y:'1826'}
];

const D_ESER = [
 {e:'Çalıkuşu',y:'Reşat Nuri Güntekin'},{e:'Kürk Mantolu Madonna',y:'Sabahattin Ali'},
 {e:'İnce Memed',y:'Yaşar Kemal'},{e:'Tutunamayanlar',y:'Oğuz Atay'},{e:'Saatleri Ayarlama Enstitüsü',y:'Ahmet Hamdi Tanpınar'},
 {e:'Huzur',y:'Ahmet Hamdi Tanpınar'},{e:'Yaban',y:'Yakup Kadri Karaosmanoğlu'},
 {e:'Kiralık Konak',y:'Yakup Kadri Karaosmanoğlu'},{e:'Mai ve Siyah',y:'Halit Ziya Uşaklıgil'},
 {e:'Aşk-ı Memnu',y:'Halit Ziya Uşaklıgil'},{e:'Araba Sevdası',y:'Recaizade Mahmut Ekrem'},
 {e:'İntibah',y:'Namık Kemal'},{e:'Vatan yahut Silistre',y:'Namık Kemal'},
 {e:'Şair Evlenmesi',y:'Şinasi'},{e:'Taaşşuk-ı Talat ve Fitnat',y:'Şemsettin Sami'},
 {e:'Eylül',y:'Mehmet Rauf'},{e:'Memleket Hikâyeleri',y:'Refik Halit Karay'},
 {e:'Sinekli Bakkal',y:'Halide Edip Adıvar'},{e:'Ateşten Gömlek',y:'Halide Edip Adıvar'},
 {e:'Dokuzuncu Hariciye Koğuşu',y:'Peyami Safa'},{e:'Fatih-Harbiye',y:'Peyami Safa'},
 {e:'Yorgun Savaşçı',y:'Kemal Tahir'},{e:'Devlet Ana',y:'Kemal Tahir'},
 {e:'Bereketli Topraklar Üzerinde',y:'Orhan Kemal'},{e:'Anayurt Oteli',y:'Yusuf Atılgan'},
 {e:'Aylak Adam',y:'Yusuf Atılgan'},{e:'Semaver',y:'Sait Faik Abasıyanık'},
 {e:'Efruz Bey',y:'Ömer Seyfettin'},{e:'Safahat',y:'Mehmet Akif Ersoy'},
 {e:'Han Duvarları',y:'Faruk Nafiz Çamlıbel'},{e:'Rübab-ı Şikeste',y:'Tevfik Fikret'},
 {e:'Memleketimden İnsan Manzaraları',y:'Nâzım Hikmet'},{e:'Garip',y:'Orhan Veli Kanık'},
 {e:'Otuz Beş Yaş',y:'Cahit Sıtkı Tarancı'},{e:'Leyla ile Mecnun',y:'Fuzuli'},
 {e:'Hüsn ü Aşk',y:'Şeyh Galip'},{e:'Divan-ı Hikmet',y:'Ahmet Yesevi'},
 {e:'Kutadgu Bilig',y:'Yusuf Has Hacip'},{e:'Divanü Lügati\'t-Türk',y:'Kaşgarlı Mahmut'},
 {e:'Atabetü\'l-Hakayık',y:'Edip Ahmet Yükneki'},{e:'Risaletü\'n-Nushiyye',y:'Yunus Emre'},
 {e:'Seyahatname',y:'Evliya Çelebi'},{e:'Şikâyetname',y:'Fuzuli'},
 {e:'Cemile',y:'Orhan Kemal'},{e:'Sessiz Ev',y:'Orhan Pamuk'},{e:'Benim Adım Kırmızı',y:'Orhan Pamuk'},
 {e:'Esir Şehrin İnsanları',y:'Kemal Tahir'},{e:'Küçük Ağa',y:'Tarık Buğra'},
 {e:'Bir Bilim Adamının Romanı',y:'Oğuz Atay'},{e:'Yılanların Öcü',y:'Fakir Baykurt'}
];

const B_BIYO = [
 {q:'ATP üretiminin büyük bölümünün gerçekleştiği organel hangisidir?',d:'Mitokondri',y:['Ribozom','Golgi','Lizozom','Koful']},
 {q:'Protein sentezinden sorumlu, zarsız organel hangisidir?',d:'Ribozom',y:['Mitokondri','Kloroplast','Lizozom','Sentrozom']},
 {q:'Fotosentezin gerçekleştiği organel hangisidir?',d:'Kloroplast',y:['Mitokondri','Golgi','Ribozom','Lizozom']},
 {q:'Hücre içi sindirimden sorumlu organel hangisidir?',d:'Lizozom',y:['Golgi','Ribozom','Koful','Mitokondri']},
 {q:'Aşağıdakilerden hangisi yalnızca bitki hücresinde bulunur?',d:'Hücre duvarı',y:['Mitokondri','Ribozom','Hücre zarı','Sitoplazma']},
 {q:'Mayoz bölünme sonucunda oluşan hücre sayısı kaçtır?',d:'4',y:['2','1','8','6']},
 {q:'Krossing-over hangi evrede gerçekleşir?',d:'Mayoz I profaz',y:['Mitoz profaz','Mayoz II metafaz','Mitoz anafaz','Mayoz II telofaz']},
 {q:'Kalıtım maddesi olan molekül hangisidir?',d:'DNA',y:['ATP','Protein','Lipit','Glikojen']},
 {q:'DNA\'da bulunup RNA\'da bulunmayan baz hangisidir?',d:'Timin',y:['Urasil','Adenin','Guanin','Sitozin']},
 {q:'Kanın pıhtılaşmasında görevli kan hücresi hangisidir?',d:'Trombosit',y:['Alyuvar','Akyuvar','Plazma','Lenfosit']},
 {q:'Oksijen taşıyan protein hangisidir?',d:'Hemoglobin',y:['İnsülin','Kolajen','Keratin','Amilaz']},
 {q:'Proteinlerin yapı birimi nedir?',d:'Aminoasit',y:['Glikoz','Yağ asidi','Nükleotit','Gliserol']},
 {q:'İnsanda kan şekerini düşüren hormon hangisidir?',d:'İnsülin',y:['Glukagon','Adrenalin','Tiroksin','Testosteron']},
 {q:'Besinlerin kimyasal sindiriminin başladığı organ hangisidir?',d:'Ağız',y:['Mide','İnce bağırsak','Kalın bağırsak','Yemek borusu']},
 {q:'Vücudun savunmasında görevli kan hücresi hangisidir?',d:'Akyuvar',y:['Alyuvar','Trombosit','Plazma','Hemoglobin']},
 {q:'Fotosentezde açığa çıkan gaz hangisidir?',d:'Oksijen',y:['Karbondioksit','Azot','Hidrojen','Metan']},
 {q:'Bir türe ait bireylerin belirli bir alandaki topluluğuna ne denir?',d:'Popülasyon',y:['Komünite','Ekosistem','Biyom','Habitat']},
 {q:'Hücre zarından enerji harcanarak yapılan taşımaya ne denir?',d:'Aktif taşıma',y:['Difüzyon','Osmoz','Plazmoliz','Turgor']}
];

const B_KIMYA = [
 {q:'Suyun kimyasal formülü hangisidir?',d:'H₂O',y:['CO₂','NaCl','H₂O₂','CH₄']},
 {q:'Sodyumun sembolü hangisidir?',d:'Na',y:['S','So','N','Sd']},
 {q:'Potasyumun sembolü hangisidir?',d:'K',y:['P','Po','Pt','Ka']},
 {q:'Demirin sembolü hangisidir?',d:'Fe',y:['De','Fr','Dm','F']},
 {q:'Periyodik tabloda 8A grubundaki elementlere ne ad verilir?',d:'Soy gazlar',y:['Halojenler','Alkali metaller','Toprak alkaliler','Geçiş metalleri']},
 {q:'1 mol gazın normal koşullardaki hacmi kaç litredir?',d:'22,4',y:['11,2','24,4','6,02','18']},
 {q:'Avogadro sayısı yaklaşık kaçtır?',d:'6,02 × 10²³',y:['3,01 × 10²³','6,02 × 10²²','1,6 × 10¹⁹','9,8 × 10²³']},
 {q:'Asitlerin sulu çözeltilerinde arttırdığı iyon hangisidir?',d:'H⁺',y:['OH⁻','Na⁺','Cl⁻','O²⁻']},
 {q:'pH değeri 7 olan bir çözelti nasıl tanımlanır?',d:'Nötr',y:['Kuvvetli asit','Zayıf asit','Baz','Tuz']},
 {q:'Atom numarası neyi ifade eder?',d:'Proton sayısı',y:['Nötron sayısı','Kütle numarası','Elektron katmanı','Değerlik']},
 {q:'İzotop atomlarda hangi tanecik sayısı farklıdır?',d:'Nötron',y:['Proton','Elektron','Katman','Değerlik elektronu']},
 {q:'Homojen karışımlara ne ad verilir?',d:'Çözelti',y:['Süspansiyon','Emülsiyon','Aerosol','Bileşik']},
 {q:'Tuz ruhunun (HCl) sulu çözeltisi hangi özelliktedir?',d:'Asidik',y:['Bazik','Nötr','Amfoter','Tuz']},
 {q:'Karbondioksitin formülü hangisidir?',d:'CO₂',y:['CO','C₂O','CaO','CH₄']},
 {q:'Yemek tuzunun formülü hangisidir?',d:'NaCl',y:['KCl','NaOH','HCl','CaCO₃']},
 {q:'Aşağıdakilerden hangisi fiziksel değişimdir?',d:'Suyun donması',y:['Kâğıdın yanması','Demirin paslanması','Sütün ekşimesi','Elmanın çürümesi']}
];

const B_COG = [
 {q:'Türkiye\'nin en yüksek dağı hangisidir?',d:'Ağrı Dağı',y:['Erciyes','Uludağ','Süphan','Kaçkar']},
 {q:'Türkiye\'nin en uzun akarsuyu hangisidir?',d:'Kızılırmak',y:['Fırat','Sakarya','Yeşilırmak','Dicle']},
 {q:'Türkiye\'nin en büyük gölü hangisidir?',d:'Van Gölü',y:['Tuz Gölü','Beyşehir','İznik','Eğirdir']},
 {q:'Her mevsim yağışlı olan iklim tipi hangisidir?',d:'Karadeniz iklimi',y:['Akdeniz iklimi','Karasal iklim','Çöl iklimi','Muson iklimi']},
 {q:'Akdeniz ikliminin doğal bitki örtüsü nedir?',d:'Maki',y:['Bozkır','Orman','Tundra','Savan']},
 {q:'Türkiye\'de yüzölçümü en büyük il hangisidir?',d:'Konya',y:['Sivas','Ankara','Erzurum','Şanlıurfa']},
 {q:'Türkiye kaç coğrafi bölgeye ayrılır?',d:'7',y:['5','6','8','9']},
 {q:'Türkiye\'nin en kalabalık ili hangisidir?',d:'İstanbul',y:['Ankara','İzmir','Bursa','Antalya']},
 {q:'Ekvator\'un uzunluğu yaklaşık kaç kilometredir?',d:'40.000 km',y:['20.000 km','60.000 km','100.000 km','10.000 km']},
 {q:'İki meridyen arasındaki yerel saat farkı kaç dakikadır?',d:'4 dakika',y:['1 dakika','15 dakika','60 dakika','30 dakika']},
 {q:'Yükselti arttıkça sıcaklık her 200 metrede yaklaşık kaç °C azalır?',d:'1 °C',y:['0,5 °C','2 °C','5 °C','10 °C']},
 {q:'Türkiye\'de tarım alanlarının en geniş olduğu bölge hangisidir?',d:'İç Anadolu',y:['Karadeniz','Ege','Marmara','Doğu Anadolu']},
 {q:'Karasal iklimin doğal bitki örtüsü nedir?',d:'Bozkır (step)',y:['Maki','Orman','Çalı','Garig']},
 {q:'Türkiye\'nin en çok göç veren bölgesi hangisidir?',d:'Doğu Anadolu',y:['Marmara','Ege','Akdeniz','İç Anadolu']},
 {q:'Dünya\'nın kendi ekseni etrafında dönmesinin sonucu nedir?',d:'Gece ve gündüzün oluşması',y:['Mevsimlerin oluşması','Gün uzunluğunun yıl içinde değişmesi','Ekvator\'un şişkinliği','İklim kuşakları']},
 {q:'Türkiye hangi yarım kürelerde yer alır?',d:'Kuzey ve Doğu',y:['Kuzey ve Batı','Güney ve Doğu','Güney ve Batı','Yalnız Kuzey']}
];

const B_VAT = [
 {q:'1982 Anayasası\'na göre değiştirilemeyecek madde sayısı kaçtır?',d:'4',y:['2','3','5','6']},
 {q:'TBMM\'de kaç milletvekili bulunur?',d:'600',y:['550','450','500','650']},
 {q:'Milletvekili seçilme yaşı kaçtır?',d:'18',y:['21','25','30','20']},
 {q:'Cumhurbaşkanının görev süresi kaç yıldır?',d:'5 yıl',y:['4 yıl','7 yıl','6 yıl','3 yıl']},
 {q:'Anayasa Mahkemesi\'nin temel görevi nedir?',d:'Kanunların anayasaya uygunluğunu denetlemek',y:['Ceza davalarına bakmak','İdari uyuşmazlıkları çözmek','Devlet harcamalarını denetlemek','Seçimleri yönetmek']},
 {q:'Seçimlerin yönetimi ve denetiminden sorumlu kurum hangisidir?',d:'Yüksek Seçim Kurulu',y:['Danıştay','Sayıştay','Yargıtay','Anayasa Mahkemesi']},
 {q:'Devletin gelir ve giderlerini TBMM adına denetleyen kurum hangisidir?',d:'Sayıştay',y:['Danıştay','Yargıtay','Maliye Bakanlığı','Merkez Bankası']},
 {q:'İdari yargının en yüksek mahkemesi hangisidir?',d:'Danıştay',y:['Yargıtay','Sayıştay','Anayasa Mahkemesi','Bölge Adliye Mahkemesi']},
 {q:'Adli yargının en yüksek mahkemesi hangisidir?',d:'Yargıtay',y:['Danıştay','Sayıştay','AYM','AİHM']},
 {q:'1982 Anayasası\'na göre egemenlik kime aittir?',d:'Millete',y:['TBMM\'ye','Cumhurbaşkanına','Hükümete','Yargıya']},
 {q:'Türkiye Cumhuriyeti\'nin başkenti neresidir? (Anayasa m.3)',d:'Ankara',y:['İstanbul','İzmir','Bursa','Konya']},
 {q:'Yasama yetkisi hangi organa aittir?',d:'TBMM',y:['Cumhurbaşkanı','Bakanlar','Danıştay','Anayasa Mahkemesi']},
 {q:'Kanun hükmünde olmayan, hukukun yazısız kaynağı hangisidir?',d:'Örf ve âdet',y:['Kanun','Tüzük','Yönetmelik','Anayasa']},
 {q:'Hak ve fiil ehliyetine sahip olma durumu hangi yaşta tamamlanır?',d:'18',y:['15','16','21','20']},
 {q:'Kamu görevlilerinin tabi olduğu temel kanun hangisidir?',d:'657 sayılı Devlet Memurları Kanunu',y:['4857 sayılı İş Kanunu','5510 sayılı Kanun','2709 sayılı Anayasa','6098 sayılı Borçlar Kanunu']}
];

const B_FELSEFE = [
 {q:'Bilginin kaynağını akıl olarak gören görüş hangisidir?',d:'Rasyonalizm',y:['Empirizm','Kritisizm','Pozitivizm','Sezgicilik']},
 {q:'Bilginin kaynağını deney olarak gören görüş hangisidir?',d:'Empirizm',y:['Rasyonalizm','İdealizm','Nihilizm','Dogmatizm']},
 {q:'"Bilgi doğuştan gelir" diyen ve idealar kuramını ortaya atan filozof kimdir?',d:'Platon',y:['Aristoteles','Sokrates','Descartes','Kant']},
 {q:'"Düşünüyorum, öyleyse varım" sözü kime aittir?',d:'Descartes',y:['Kant','Hume','Locke','Spinoza']},
 {q:'Varlık felsefesinin adı nedir?',d:'Ontoloji',y:['Epistemoloji','Etik','Estetik','Mantık']},
 {q:'Bilgi felsefesinin adı nedir?',d:'Epistemoloji',y:['Ontoloji','Aksiyoloji','Estetik','Metafizik']},
 {q:'Doğru bilginin imkânsız olduğunu savunan yaklaşım hangisidir?',d:'Septisizm',y:['Dogmatizm','Rasyonalizm','Realizm','Pragmatizm']},
 {q:'Ahlak felsefesinin adı nedir?',d:'Etik',y:['Estetik','Mantık','Ontoloji','Sosyoloji']},
 {q:'"İnsan her şeyin ölçüsüdür" sözü hangi düşünce akımına aittir?',d:'Sofizm',y:['Stoacılık','Kinizm','Hedonizm','Epikürcülük']},
 {q:'Faydayı doğruluk ölçütü sayan yaklaşım hangisidir?',d:'Pragmatizm',y:['İdealizm','Realizm','Nihilizm','Materyalizm']}
];

const B_DIN = [
 {q:'İslam\'ın şartlarından biri olan, yılda bir kez varlıklı Müslümanların vermekle yükümlü olduğu ibadet hangisidir?',d:'Zekât',y:['Sadaka','Fitre','Kurban','Adak']},
 {q:'Kur\'an-ı Kerim kaç sureden oluşur?',d:'114',y:['112','116','120','99']},
 {q:'Namazın farzlarından biri olan, kıbleye yönelme şartına ne ad verilir?',d:'İstikbal-i kıble',y:['Setr-i avret','Niyet','Tahrime','Kıyam']},
 {q:'Hicret hangi iki şehir arasında gerçekleşmiştir?',d:'Mekke - Medine',y:['Medine - Taif','Mekke - Taif','Mekke - Kudüs','Medine - Şam']},
 {q:'Kur\'an\'ın ilk suresi hangisidir?',d:'Fatiha',y:['Bakara','İhlas','Nas','Alak']},
 {q:'Ramazan ayında tutulan orucun İslam\'ın şartları içindeki sırası kaçtır?',d:'4',y:['2','3','5','1']},
 {q:'Peygamberimizin doğduğu yıl hangi olayla anılır?',d:'Fil Vakası',y:['Hendek Savaşı','Bedir Savaşı','Veda Haccı','Hicret']},
 {q:'Din ve vicdan özgürlüğü hangi temel ilkeyle güvence altındadır?',d:'Laiklik',y:['Milliyetçilik','Halkçılık','Devletçilik','İnkılapçılık']}
];

const B_TR_ANLAM = [
 {q:'"Bu konuda eli çok açıktır." cümlesindeki altı çizili deyim ne anlama gelir?',d:'Cömert olmak',y:['Çalışkan olmak','Beceriksiz olmak','Aceleci olmak','Tutumlu olmak']},
 {q:'"Soğuk bir insandı, kimseyle konuşmazdı." cümlesinde "soğuk" sözcüğü hangi anlamdadır?',d:'Mecaz anlam',y:['Gerçek anlam','Terim anlam','Yan anlam','Eş sesli']},
 {q:'"Dağın eteğinde kamp kurduk." cümlesinde "etek" sözcüğü hangi anlamdadır?',d:'Yan anlam',y:['Gerçek anlam','Mecaz anlam','Terim anlam','Soyut anlam']},
 {q:'"Üçgenin iç açıları toplamı 180 derecedir." cümlesindeki "açı" sözcüğü hangi anlamdadır?',d:'Terim anlam',y:['Mecaz anlam','Yan anlam','Gerçek anlam','Deyim anlamı']},
 {q:'Aşağıdakilerden hangisi soyut bir kavramdır?',d:'Özlem',y:['Kalem','Deniz','Ağaç','Taş']},
 {q:'"Pes etmek" deyiminin anlamı nedir?',d:'Yenilgiyi kabul etmek',y:['Israr etmek','Öfkelenmek','Sevinmek','Susmak']},
 {q:'"Ağzı kulaklarına varmak" deyiminin anlamı nedir?',d:'Çok sevinmek',y:['Çok konuşmak','Şaşırmak','Kızmak','Utanmak']},
 {q:'"Yağmur yağdığı için maç ertelendi." cümlesinde hangi anlam ilişkisi vardır?',d:'Neden-sonuç',y:['Amaç-sonuç','Koşul','Karşılaştırma','Benzetme']},
 {q:'"Sınavı kazanmak için gece gündüz çalışıyor." cümlesinde hangi anlam ilişkisi vardır?',d:'Amaç-sonuç',y:['Neden-sonuç','Koşul','Karşılaştırma','Olasılık']},
 {q:'"Bence bu film yılın en iyisiydi." cümlesi için hangisi söylenir?',d:'Öznel yargı',y:['Nesnel yargı','Tanım cümlesi','Koşul cümlesi','Kesinlik bildirir']},
 {q:'"Kitap 320 sayfadan oluşuyor." cümlesi için hangisi doğrudur?',d:'Nesnel yargı',y:['Öznel yargı','Varsayım','Olasılık','Abartma']},
 {q:'"Çalışırsan başarırsın." cümlesinde hangi anlam vardır?',d:'Koşul (şart)',y:['Neden-sonuç','Amaç-sonuç','Karşılaştırma','Eşitlik']},
 {q:'"Diyelim ki sınavı kazandın." cümlesinde hangi anlam vardır?',d:'Varsayım',y:['Olasılık','Koşul','Öneri','Eleştiri']},
 {q:'"Bu yazı, öncekinden daha akıcı." cümlesinde hangi anlam vardır?',d:'Karşılaştırma',y:['Neden-sonuç','Koşul','Varsayım','Tanım']}
];

const B_TR_NOKTA = [
 {q:'"Yaşlı adam( yavaşça ayağa kalktı." cümlesinde parantezle gösterilen yere hangi işaret gelmelidir?',d:'Virgül (,)',y:['Nokta (.)','İki nokta (:)','Noktalı virgül (;)','Üç nokta (…)']},
 {q:'Aşağıdakilerden hangisinde noktalama yanlışı vardır?',d:'Ali, ve Veli geldi.',y:['Ali, Veli ve Ayşe geldi.','Geldi mi?','Eyvah, geç kaldım!','Şunları aldım: kalem, defter.']},
 {q:'Bir cümlede açıklama yapılacaksa hangi işaret kullanılır?',d:'İki nokta (:)',y:['Üç nokta (…)','Virgül (,)','Kesme (\')','Tırnak ("")']},
 {q:'"Ankara( da hava çok soğuk." ifadesinde boşluğa hangi işaret gelir?',d:'Kesme işareti (\')',y:['Virgül (,)','Hiçbiri (bitişik yazılır)','Nokta (.)','Tire (-)']},
 {q:'Sıralı cümleleri birbirinden ayırmak için kullanılan işaret hangisidir?',d:'Virgül (,)',y:['İki nokta (:)','Üç nokta (…)','Ünlem (!)','Soru işareti (?)']},
 {q:'"ama, fakat, ancak" bağlaçlarından önce hangi işaret kullanılır?',d:'Noktalı virgül (;)',y:['İki nokta (:)','Üç nokta (…)','Ünlem (!)','Tire (-)']},
 {q:'Alıntı yapılırken kullanılan işaret hangisidir?',d:'Tırnak işareti ("")',y:['Parantez ()','Tire (-)','Kesme (\')','Ünlem (!)']}
];

const B_TR_TURLER = [
 {q:'"Kırmızı elbiseyi çok sevdim." cümlesinde "kırmızı" sözcüğünün türü nedir?',d:'Sıfat',y:['Zarf','İsim','Zamir','Edat']},
 {q:'"Hızlı koştuğu için yetişti." cümlesinde "hızlı" sözcüğünün türü nedir?',d:'Zarf',y:['Sıfat','İsim','Bağlaç','Ünlem']},
 {q:'"Bunu daha önce görmüştüm." cümlesinde "bunu" sözcüğünün türü nedir?',d:'Zamir',y:['Sıfat','Zarf','Edat','Bağlaç']},
 {q:'"Buz gibi soğuktu." ifadesindeki "gibi" sözcüğünün türü nedir?',d:'Edat',y:['Bağlaç','Zarf','Sıfat','Ünlem']},
 {q:'"Geldi ve oturdu." cümlesindeki "ve" sözcüğünün türü nedir?',d:'Bağlaç',y:['Edat','Zarf','Zamir','Ünlem']},
 {q:'"Eyvah, otobüsü kaçırdım!" cümlesindeki "eyvah" sözcüğünün türü nedir?',d:'Ünlem',y:['Bağlaç','Edat','Zarf','Sıfat']},
 {q:'"Üç kalem aldım." cümlesinde "üç" sözcüğü hangi sıfat türüdür?',d:'Sayı sıfatı',y:['Niteleme sıfatı','İşaret sıfatı','Belgisiz sıfat','Soru sıfatı']},
 {q:'"Şu kitabı ver." cümlesinde "şu" sözcüğü hangi sıfat türüdür?',d:'İşaret sıfatı',y:['Sayı sıfatı','Niteleme sıfatı','Soru sıfatı','Belgisiz sıfat']},
 {q:'"Yarın geleceğim." cümlesinde "yarın" sözcüğü hangi zarf türüdür?',d:'Zaman zarfı',y:['Durum zarfı','Yer-yön zarfı','Miktar zarfı','Soru zarfı']},
 {q:'"İçeri girdi." cümlesinde "içeri" sözcüğü hangi zarf türüdür?',d:'Yer-yön zarfı',y:['Zaman zarfı','Durum zarfı','Miktar zarfı','Soru zarfı']}
];

const B_TR_OGE = [
 {q:'"Ali, dün akşam kitabı okudu." cümlesinde "kitabı" hangi ögedir?',d:'Belirtili nesne',y:['Özne','Dolaylı tümleç','Zarf tümleci','Yüklem']},
 {q:'"Çocuk okula gitti." cümlesinde "okula" hangi ögedir?',d:'Dolaylı tümleç',y:['Nesne','Özne','Zarf tümleci','Yüklem']},
 {q:'"Dün çok yoruldum." cümlesinde "dün" hangi ögedir?',d:'Zarf tümleci',y:['Dolaylı tümleç','Nesne','Özne','Yüklem']},
 {q:'"Camı kim kırdı?" cümlesinde "kim" hangi ögedir?',d:'Özne',y:['Nesne','Dolaylı tümleç','Zarf tümleci','Yüklem']},
 {q:'"Yarın sabah erkenden yola çıkacağız." cümlesinin yüklemi hangisidir?',d:'yola çıkacağız',y:['yarın sabah','erkenden','yola','sabah erkenden']},
 {q:'"Kapı yavaşça açıldı." cümlesinde özne nedir?',d:'Kapı (sözde özne)',y:['yavaşça','açıldı','gizli özne "o"','nesne yoktur, özne de yoktur']},
 {q:'"Kitap okumayı severim." cümlesinde "kitap okumayı" hangi ögedir?',d:'Belirtili nesne',y:['Özne','Zarf tümleci','Dolaylı tümleç','Yüklem']}
];

const B_TR_BOZUK = [
 {q:'Aşağıdaki cümlelerin hangisinde gereksiz sözcük kullanımından kaynaklanan anlatım bozukluğu vardır?',d:'Yukarı yukarı çıkarken nefesi kesildi.',y:['Yağmur yağınca maç ertelendi.','Kitabı okudu ve onu çok beğendi.','Öğrenciler sınava hazırlanıyor.','Toplantı saat üçte başlayacak.']},
 {q:'Aşağıdakilerin hangisinde özne-yüklem uyumsuzluğu vardır?',d:'Ağaçlar rüzgârda sallanıyorlardı.',y:['Çocuklar bahçede oynuyorlardı.','Öğretmenler toplantıya katıldı.','Kuşlar göç etti.','Misafirler geldiler.']},
 {q:'"Kitabı okudu ve çok beğendi." cümlesindeki anlatım bozukluğunun nedeni nedir?',d:'Nesne eksikliği',y:['Özne eksikliği','Yüklem eksikliği','Tamlama yanlışı','Gereksiz sözcük']},
 {q:'"Hem çalışıyor hem de okuyordu." cümlesindeki bozukluğun nedeni nedir?',d:'Fiil kipi uyumsuzluğu',y:['Nesne eksikliği','Özne eksikliği','Deyim yanlışı','Tamlama yanlışı']},
 {q:'Aşağıdakilerin hangisinde anlamca çelişen sözler bir arada kullanılmıştır?',d:'Kesinlikle belki yarın gelir.',y:['Muhtemelen yarın gelir.','Kesinlikle yarın gelir.','Sanırım yarın gelir.','Yarın gelecek.']},
 {q:'"Öğrencilere ve velilere duyuruldu." benzeri cümlelerde sık görülen "ekonomik ve siyaset sorunları" hatası hangi türdendir?',d:'Tamlama yanlışı',y:['Özne eksikliği','Nesne eksikliği','Çatı uyuşmazlığı','Gereksiz sözcük']},
 {q:'"Odaya girildi ve ışıkları yaktı." cümlesindeki bozukluğun nedeni nedir?',d:'Çatı (etken-edilgen) uyuşmazlığı',y:['Tamlama yanlışı','Deyim yanlışı','Gereksiz sözcük','Kip uyumsuzluğu']}
];

const B_PARAGRAF = [
 {q:'"Okumak, başkalarının düşüncelerini tanımaktır; yazmak ise kendi düşünceni ortaya koymaktır. Biri olmadan diğeri eksik kalır. Çok okuyup hiç yazmayan kişi, biriktirdiğini hiçbir zaman kullanmamış olur."\n\nBu parçanın ana düşüncesi nedir?',
  d:'Okuma ve yazma birbirini tamamlayan iki eylemdir.',
  y:['Yazmak okumaktan daha değerlidir.','Çok okuyan kişi iyi yazar olur.','Düşünceleri tanımak için okumak yeterlidir.','Yazmak yalnızca yetenekli kişilerin işidir.']},
 {q:'"Şehirde yaşayan insan, doğayı çoğu zaman bir tatil fikri olarak düşünür. Oysa doğa, uzaklara gidilerek ziyaret edilecek bir yer değil, içinde yaşanılan bir bütündür."\n\nYazar bu parçada neyi eleştirmektedir?',
  d:'Doğanın yalnızca tatil zamanlarına ait bir yer sayılmasını',
  y:['Şehirlerde yeşil alan bulunmamasını','İnsanların tatile çıkamamasını','Doğanın korunmaması için yasa olmamasını','Köyden kente göçün hızlanmasını']},
 {q:'"Bir işi sevmek, onu kolay yapmak demek değildir. Sevdiğiniz iş de sizi yorar, hatta bazen bıktırır. Fark şudur: sevilen işte yorgunluk, insanı işten uzaklaştırmaz."\n\nBu parçadan aşağıdakilerden hangisi çıkarılabilir?',
  d:'Sevilen işlerde de zorlanmak olağandır.',
  y:['Sevilen iş hiç yormaz.','Yorucu işler sevilmez.','Her iş zamanla sıkıcı hale gelir.','Başarı yalnızca sevilen işlerde gelir.']},
 {q:'"Çeviri, iki dil arasında sözcük taşımak değildir. Çevirmen, bir cümlenin tonunu, ritmini ve kültürel yükünü de taşımak zorundadır. Bu yüzden iyi bir çeviri, aslında yeniden yazmaktır."\n\nBu parçada çeviriyle ilgili olarak asıl vurgulanan nedir?',
  d:'Çevirinin yaratıcı bir yeniden yazma süreci olduğu',
  y:['Çeviride sözcük seçiminin önemsiz olduğu','Çevirmenin iki dili de ana dili gibi bilmesi gerektiği','Çevirinin kısa sürede yapılamayacağı','Edebi metinlerin çevrilemeyeceği']},
 {q:'"Alışkanlıklar, küçük kararların zamanla kalıplaşmasıdır. Bugün verdiğiniz karar tek başına hayatınızı değiştirmez; ama aynı kararı yüz kez verdiğinizde artık karar vermeyi bırakır, sadece yaşarsınız."\n\nBu parçada anlatılmak istenen nedir?',
  d:'Alışkanlıklar, tekrarlanan küçük kararlarla oluşur.',
  y:['Büyük kararlar hayatı değiştirir.','Karar vermek zor bir iştir.','Alışkanlıklardan kurtulmak imkânsızdır.','İnsan davranışları doğuştan gelir.']},
 {q:'"Yeni bir dil öğrenirken en büyük engel, hata yapma korkusudur. Dil, doğru cümleler ezberleyerek değil, yanlış cümleler kurup düzeltilerek öğrenilir."\n\nBu parçaya göre dil öğreniminde hata nedir?',
  d:'Öğrenmenin doğal ve gerekli bir parçası',
  y:['Kaçınılması gereken bir başarısızlık','Yalnızca yetişkinlerin sorunu','Ezber eksikliğinin göstergesi','Öğretmenin sorumluluğu']},
 {q:'"Bir kentin kimliğini binalar değil, sokaklarda kurulan ilişkiler belirler. Aynı mimariye sahip iki mahalleden biri canlı, diğeri sessizse aradaki fark betonda değil, insanlardadır."\n\nBu parçanın ana düşüncesi nedir?',
  d:'Kentin kimliğini insan ilişkileri oluşturur.',
  y:['Mimari, kentlerin tek belirleyicisidir.','Eski mahalleler yenilerden güzeldir.','Kentleşme hızla artmaktadır.','Binalar mahallelerin canlılığını belirler.']},
 {q:'"Müzik dinlerken beynimiz yalnızca sesleri işlemez; hafızayı, duyguyu ve hareketi yöneten bölgeler aynı anda çalışır. Bu yüzden yıllar önce dinlediğimiz bir şarkı, unuttuğumuzu sandığımız bir anı geri getirebilir."\n\nBu parçada müzikle ilgili olarak ne belirtilmektedir?',
  d:'Müziğin beyinde birden fazla bölgeyi aynı anda çalıştırdığı',
  y:['Müziğin hafızayı zayıflattığı','Her müziğin aynı etkiyi yarattığı','Eski şarkıların yenilerden iyi olduğu','Müziğin yalnızca duyguyla ilgili olduğu']}
];

const B_EDEB = [
 {q:'"Sanat toplum içindir" anlayışını benimseyen edebiyat dönemi hangisidir?',d:'Tanzimat I. Dönem',y:['Servet-i Fünun','Fecr-i Ati','Divan edebiyatı','İkinci Yeni']},
 {q:'Türk edebiyatında ilk yerli roman hangisidir?',d:'Taaşşuk-ı Talat ve Fitnat',y:['İntibah','Araba Sevdası','Mai ve Siyah','Sergüzeşt']},
 {q:'Türk edebiyatında ilk çeviri roman hangisidir?',d:'Telemak',y:['İntibah','Şair Evlenmesi','Sergüzeşt','Eylül']},
 {q:'İlk yerli tiyatro eseri hangisidir?',d:'Şair Evlenmesi',y:['Vatan yahut Silistre','Zavallı Çocuk','Akif Bey','Hamlet']},
 {q:'Garip (Birinci Yeni) akımının öncüsü kimdir?',d:'Orhan Veli Kanık',y:['Nâzım Hikmet','Cemal Süreya','Necip Fazıl','Ahmet Haşim']},
 {q:'Aruz ölçüsü ve beyit birimi hangi edebiyatın özelliğidir?',d:'Divan edebiyatı',y:['Halk edebiyatı','Milli Edebiyat','Cumhuriyet dönemi','Tanzimat']},
 {q:'Milli Edebiyat akımının dil anlayışı nasıldır?',d:'Sade, konuşma diline yakın Türkçe',y:['Arapça-Farsça ağırlıklı ağır dil','Fransızca terimlerle süslü dil','Yalnızca Osmanlıca','Halk ağzından uzak süslü dil']},
 {q:'"Sanat sanat içindir" anlayışıyla bilinen, ağır dil kullanan topluluk hangisidir?',d:'Servet-i Fünun',y:['Milli Edebiyat','Tanzimat I. Dönem','Garip','Beş Hececiler']},
 {q:'Koşma, semai, varsağı hangi edebiyatın nazım biçimleridir?',d:'Halk edebiyatı',y:['Divan edebiyatı','Servet-i Fünun','Tanzimat','Fecr-i Ati']},
 {q:'Gazel, kaside, mesnevi hangi edebiyata aittir?',d:'Divan edebiyatı',y:['Halk edebiyatı','Milli Edebiyat','Cumhuriyet dönemi','Tanzimat tiyatrosu']}
];


const D_DEYIM = [
 {k:'etekleri zil çalmak',v:'Çok sevinmek'},{k:'pabucu dama atılmak',v:'Değerini yitirmek'},
 {k:'burnu havada olmak',v:'Kibirli davranmak'},{k:'göz yummak',v:'Görmezden gelmek'},
 {k:'kulak kabartmak',v:'Gizlice dinlemek'},{k:'dört gözle beklemek',v:'Sabırsızlıkla beklemek'},
 {k:'iğneyle kuyu kazmak',v:'Çok zor bir işi sabırla yapmak'},{k:'ağzı kulaklarına varmak',v:'Çok sevinmek'},
 {k:'eli kulağında olmak',v:'Gerçekleşmesi çok yakın olmak'},{k:'başından savmak',v:'Uzaklaştırıp kurtulmak'},
 {k:'kafa yormak',v:'Uzun uzun düşünmek'},{k:'küplere binmek',v:'Çok öfkelenmek'},
 {k:'ateş pahası',v:'Çok pahalı'},{k:'burnundan kıl aldırmamak',v:'Çok huysuz ve kibirli olmak'},
 {k:'göze girmek',v:'Beğeni kazanmak'},{k:'ipe un sermek',v:'Bahane uydurup yapmamak'},
 {k:'dilinin altında bir şey olmak',v:'Söylemek isteyip söylememek'},{k:'yüz çevirmek',v:'İlgiyi kesmek'},
 {k:'gözden düşmek',v:'Saygınlığını yitirmek'},{k:'su götürmez',v:'Kesin, tartışılmaz'},
 {k:'pişkinliğe vurmak',v:'Duymazlıktan gelmek'},{k:'içi geçmek',v:'Uykuya dalmak'},
 {k:'eli ağır olmak',v:'Yavaş çalışmak'},{k:'kulağına küpe olmak',v:'Unutulmayacak bir ders olmak'},
 {k:'göz ardı etmek',v:'Önemsememek'},{k:'yüreği ağzına gelmek',v:'Çok korkmak'},
 {k:'diken üstünde olmak',v:'Tedirgin biçimde beklemek'},{k:'baltayı taşa vurmak',v:'Farkında olmadan kırıcı konuşmak'},
 {k:'çantada keklik',v:'Kolayca elde edileceği sanılan'},{k:'kaş yaparken göz çıkarmak',v:'Düzelteyim derken bozmak'},
 {k:'ağzından baklayı çıkarmak',v:'Sabrı tükenip gizlediğini söylemek'},{k:'el üstünde tutmak',v:'Çok değer vermek'}
];

const D_ESANLAM = [
 {k:'siyah',v:'kara'},{k:'beyaz',v:'ak'},{k:'öğretmen',v:'muallim'},{k:'okul',v:'mektep'},
 {k:'anı',v:'hatıra'},{k:'yanıt',v:'cevap'},{k:'sözcük',v:'kelime'},{k:'yapıt',v:'eser'},
 {k:'konuk',v:'misafir'},{k:'yaşam',v:'hayat'},{k:'kent',v:'şehir'},{k:'us',v:'akıl'},
 {k:'olanak',v:'imkân'},{k:'özgürlük',v:'hürriyet'},{k:'tanık',v:'şahit'},{k:'kanıt',v:'delil'},
 {k:'doğa',v:'tabiat'},{k:'ulus',v:'millet'},{k:'öykü',v:'hikâye'},{k:'sınav',v:'imtihan'}
];

const D_ZIT = [
 {k:'uzun',v:'kısa'},{k:'sıcak',v:'soğuk'},{k:'aydınlık',v:'karanlık'},{k:'zengin',v:'yoksul'},
 {k:'ileri',v:'geri'},{k:'sevinç',v:'üzüntü'},{k:'cesur',v:'korkak'},{k:'gerçek',v:'yalan'},
 {k:'bolluk',v:'kıtlık'},{k:'cömert',v:'cimri'},{k:'başlangıç',v:'son'},{k:'iyimser',v:'kötümser'},
 {k:'somut',v:'soyut'},{k:'kalabalık',v:'tenha'},{k:'alçak',v:'yüksek'},{k:'savaş',v:'barış'}
];

/* ==========================================================================
   3) SORU ÜRETİCİLERİ
   Her konu, bir üretici dizisidir; her çağrıda rastgele biri çalışır.
   Sayılar rastgele olduğu için soru havuzu pratikte tükenmez.
   ========================================================================== */
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const lcm = (a, b) => a * b / gcd(a, b);
const C = (n, r) => { let x = 1; for (let i = 0; i < r; i++) x = x * (n - i) / (i + 1); return Math.round(x); };

const TEK_IFADE = ['3x + 2y', 'x + 2y', 'x·y + x', 'x² + y', '5x - 4y', 'x + y'];
const CIFT_IFADE = ['x + y + 1', '2x + y', 'x·y', 'x² - x', '3x + y + 1', '4x + 2y', 'x² + x'];

const DERSLER = {
/* ---------------------------- TYT MATEMATİK ---------------------------- */
mat: { ad: 'Matematik', sinavlar: ['tyt', 'kpss'], konular: {
  temel: { ad: 'Temel kavramlar', gen: [
    () => { const m = R(8, 60); return Q(`Ardışık 5 tam sayının toplamı ${5 * m} olduğuna göre en büyük sayı kaçtır?`, m + 2, numOpts(m + 2, 5), `Ortadaki sayı ${5 * m} / 5 = ${m}. En büyük sayı ${m} + 2 = ${m + 2}.`); },
    () => { const n = R(10, 60); return Q(`1'den ${n}'e kadar olan tam sayıların toplamı kaçtır?`, n * (n + 1) / 2, numOpts(n * (n + 1) / 2, 40), `n(n+1)/2 = ${n}·${n + 1}/2 = ${n * (n + 1) / 2}`); },
    () => { const c = pick(TEK_IFADE); return Q('x tek, y çift bir tam sayıdır. Buna göre aşağıdakilerden hangisi kesinlikle tektir?', c, shuffle(CIFT_IFADE).slice(0, 4), `x tek, y çift iken ${c} ifadesi tek sayı verir. Tek·çift = çift, tek+çift = tek kuralını kullan.`); },
    () => { const n = R(5, 30); return Q(`İlk ${n} tek doğal sayının toplamı kaçtır?`, n * n, numOpts(n * n, 30), `İlk n tek sayının toplamı n² = ${n}² = ${n * n}`); }
  ]},
  bolme: { ad: 'Bölme - bölünebilme', gen: [
    () => { const n = R(200, 999), b = pick([3, 4, 6, 7, 9, 11]); return Q(`${n} sayısının ${b} ile bölümünden kalan kaçtır?`, n % b, numOpts(n % b, b > 4 ? 4 : 2), `${n} = ${b}·${Math.floor(n / b)} + ${n % b}`); },
    () => { const m = pick([5, 7, 9, 11]), r = R(1, m - 1), k = R(2, 6); const s = (k * r) % m; return Q(`Bir x sayısının ${m} ile bölümünden kalan ${r}'dir. Buna göre ${k}x sayısının ${m} ile bölümünden kalan kaçtır?`, s, numOpts(s, m - 1), `x = ${m}k + ${r} → ${k}x = ${m}·(${k}k) + ${k * r}. ${k * r}'nin ${m} ile bölümünden kalan ${s}.`); },
    () => { const a = R(1, 8), c = R(0, 9); const bas = a * 100 + c; let A = -1; for (let d = 9; d >= 0; d--) { if ((a + d + c) % 3 === 0) { A = d; break; } } return Q(`${a}A${c} üç basamaklı sayısı 3 ile tam bölünebildiğine göre A yerine yazılabilecek en büyük rakam kaçtır?`, A, numOpts(A, 4), `Rakamlar toplamı ${a} + A + ${c} 3'ün katı olmalı. En büyük A = ${A}.`); }
  ]},
  ebob: { ad: 'EBOB - EKOK', gen: [
    () => { const a = R(12, 90), b = R(12, 90); return Q(`${a} ve ${b} sayılarının EBOB'u kaçtır?`, gcd(a, b), numOpts(gcd(a, b), 6), `Çarpanlarına ayırıp ortak çarpanların en küçük üslülerini çarparsan EBOB(${a}, ${b}) = ${gcd(a, b)}.`); },
    () => { const a = R(4, 20), b = R(4, 20); return Q(`${a} ve ${b} sayılarının EKOK'u kaçtır?`, lcm(a, b), numOpts(lcm(a, b), 12), `EBOB·EKOK = a·b kuralından EKOK(${a}, ${b}) = ${lcm(a, b)}.`); },
    () => { const [a, b, c] = [R(2, 9), R(2, 9), R(2, 9)], k = R(1, 5); const L = lcm(lcm(a, b), c); return Q(`${a}, ${b} ve ${c} sayılarının her biriyle bölündüğünde ${k} kalanını veren en küçük doğal sayı kaçtır? (Sayı ${k}'den büyüktür.)`, L + k, numOpts(L + k, 10), `EKOK(${a}, ${b}, ${c}) = ${L}. Aranan sayı ${L} + ${k} = ${L + k}.`); }
  ]},
  uslu: { ad: 'Üslü sayılar', gen: [
    () => { const a = R(2, 6), b = R(2, 5), c = R(1, 4); const s = a + b - c; return Q(`2^${a} · 2^${b} / 2^${c} işleminin sonucu kaçtır?`, 2 ** s, numOpts(2 ** s, 2 ** s > 60 ? 40 : 8), `Tabanlar eşit: 2^(${a}+${b}-${c}) = 2^${s} = ${2 ** s}`); },
    () => { const x = R(1, 5), k = R(1, 4); const sag = 2 ** (2 * x + k); return Q(`4^x · 2^${k} = ${sag} olduğuna göre x kaçtır?`, x, numOpts(x, 4), `4^x = 2^(2x) → 2^(2x+${k}) = 2^${2 * x + k} → 2x + ${k} = ${2 * x + k} → x = ${x}`); },
    () => { const a = R(2, 4), m = R(2, 3), n = R(2, 3); return Q(`(${a}^${m})^${n} işleminin sonucu kaçtır?`, a ** (m * n), numOpts(a ** (m * n), 60), `Üsler çarpılır: ${a}^(${m}·${n}) = ${a}^${m * n} = ${a ** (m * n)}`); },
    () => { const a = R(2, 5), n = R(2, 4); return Q(`${a}^(-${n}) ifadesinin eşiti aşağıdakilerden hangisidir?`, `1/${a ** n}`, [`-${a ** n}`, `${a ** n}`, `-1/${a ** n}`, `1/${a ** n + 1}`], `a^(-n) = 1/a^n = 1/${a ** n}`); }
  ]},
  koklu: { ad: 'Köklü sayılar', gen: [
    () => { const k = R(2, 9), m = pick([2, 3, 5, 6, 7]); return Q(`√${k * k * m} sayısı a√${m} biçiminde yazıldığına göre a kaçtır?`, k, numOpts(k, 5), `√${k * k * m} = √(${k * k}·${m}) = ${k}√${m} → a = ${k}`); },
    () => { const m = pick([2, 3, 5]), a = R(2, 9), b = R(2, 9), c = R(1, 5); return Q(`${a}√${m} + ${b}√${m} - ${c}√${m} işleminin sonucu kaç √${m}'dir?`, a + b - c, numOpts(a + b - c, 5), `Benzer köklü terimlerin katsayıları toplanır: ${a} + ${b} - ${c} = ${a + b - c}`); },
    () => { const [a, b] = pick([[2, 8], [3, 12], [5, 20], [2, 18], [3, 27], [6, 24], [2, 3], [3, 5], [2, 5], [5, 7], [3, 7], [2, 7]]); const p = a * b, kok = Math.sqrt(p), tam = Number.isInteger(kok); return Q(`√${a} · √${b} işleminin sonucu aşağıdakilerden hangisidir?`, tam ? String(kok) : `√${p}`, tam ? [`√${a + b}`, `${kok + 2}`, `${p}`, `${kok - 1}`] : [`√${a + b}`, `${p}`, `${a + b}`, `2√${p}`], `√a·√b = √(ab) = √${p}${tam ? ` = ${kok}` : ''}`); }
  ]},
  denklem: { ad: 'Denklemler', gen: [
    () => { const r1 = R(-6, 6), r2 = R(-6, 6); const b = -(r1 + r2), c = r1 * r2; return Q(`x² ${b >= 0 ? '+ ' + b : '- ' + -b}x ${c >= 0 ? '+ ' + c : '- ' + -c} = 0 denkleminin kökler toplamı kaçtır?`, r1 + r2, numOpts(r1 + r2, 5), `Kökler toplamı = -b/a = ${-b}/1 = ${r1 + r2}`); },
    () => { const r1 = R(-5, 5), r2 = R(-5, 5); const b = -(r1 + r2), c = r1 * r2; return Q(`x² ${b >= 0 ? '+ ' + b : '- ' + -b}x ${c >= 0 ? '+ ' + c : '- ' + -c} = 0 denkleminin kökler çarpımı kaçtır?`, c, numOpts(c, 6), `Kökler çarpımı = c/a = ${c}`); },
    () => { const a = R(2, 9), b = R(1, 20), x = R(2, 12); const d = a * x + b; return Q(`${a}x + ${b} = ${d} denkleminde x kaçtır?`, x, numOpts(x, 5), `${a}x = ${d} - ${b} = ${d - b} → x = ${x}`); },
    () => { const a = 1, b = R(-8, 8), c = R(-8, 8); const D = b * b - 4 * a * c; return Q(`x² ${b >= 0 ? '+ ' + b : '- ' + -b}x ${c >= 0 ? '+ ' + c : '- ' + -c} = 0 denkleminin diskriminantı (Δ) kaçtır?`, D, numOpts(D, 10), `Δ = b² - 4ac = (${b})² - 4·1·(${c}) = ${D}`); }
  ]},
  mutlak: { ad: 'Mutlak değer', gen: [
    () => { const a = R(-9, 9), b = R(1, 9); return Q(`|x ${a >= 0 ? '- ' + a : '+ ' + -a}| = ${b} denkleminin köklerinin toplamı kaçtır?`, 2 * a, numOpts(2 * a, 6), `x - ${a} = ±${b} → kökler ${a + b} ve ${a - b}; toplamı 2·${a} = ${2 * a}`); },
    () => { const a = R(-9, 9), b = R(-9, 9), c = R(-9, 9); const s = Math.abs(a - b) + Math.abs(c); return Q(`|${a} - (${b})| + |${c}| işleminin sonucu kaçtır?`, s, numOpts(s, 6), `|${a - b}| + |${c}| = ${Math.abs(a - b)} + ${Math.abs(c)} = ${s}`); },
    () => { const a = R(2, 8); return Q(`|x| < ${a} eşitsizliğini sağlayan x tam sayılarının sayısı kaçtır?`, 2 * a - 1, numOpts(2 * a - 1, 4), `-${a} < x < ${a} aralığında ${2 * a - 1} tam sayı vardır (0 dahil).`); }
  ]},
  oran: { ad: 'Oran - orantı', gen: [
    () => { const p = R(2, 7), q = R(2, 9), k = R(2, 9); const a = p * k, b = q * k; return Q(`a/b = ${frac(p, q)} ve a + b = ${a + b} olduğuna göre a kaçtır?`, a, numOpts(a, 8), `a = ${p}k, b = ${q}k → ${p + q}k = ${a + b} → k = ${k} → a = ${a}`); },
    () => { const x = R(2, 12), y = R(2, 12); return Q(`${x} işçi bir işi ${y} günde bitiriyor. Aynı işi ${2 * x} işçi kaç günde bitirir?`, y / 2 % 1 === 0 ? y / 2 : +(y / 2).toFixed(1), numOpts(y / 2, 4, y % 2 ? 1 : 0), `İşçi ile süre ters orantılıdır: ${x}·${y} = ${2 * x}·t → t = ${y / 2}`); },
    () => { const a = R(2, 9), b = R(2, 9), c = R(2, 9), k = R(2, 6); return Q(`a/${a} = b/${b} = c/${c} ve a + b + c = ${(a + b + c) * k} olduğuna göre b kaçtır?`, b * k, numOpts(b * k, 8), `Her birine k dersen ${a + b + c}k = ${(a + b + c) * k} → k = ${k} → b = ${b}·${k} = ${b * k}`); }
  ]},
  yuzde: { ad: 'Yüzde - kâr - zarar', gen: [
    () => { const f = R(20, 90) * 10, z = pick([10, 20, 25, 40, 50]); const s = f * (100 + z) / 100; return Q(`${f} TL'ye alınan bir ürün %${z} kârla satılıyor. Satış fiyatı kaç TL'dir?`, s, numOpts(s, 60), `${f} · (1 + ${z}/100) = ${s} TL`); },
    () => { const f = R(20, 80) * 10, i = pick([10, 20, 25, 50]); const s = f * (100 - i) / 100; return Q(`Etiket fiyatı ${f} TL olan bir ürüne %${i} indirim yapılıyor. Yeni fiyat kaç TL'dir?`, s, numOpts(s, 50), `${f} · (1 - ${i}/100) = ${s} TL`); },
    () => { const f = 100 * R(1, 9); return Q(`${f} TL olan bir ürüne önce %20 zam, sonra %20 indirim yapılıyor. Son fiyat kaç TL'dir?`, f * 0.96, numOpts(f * 0.96, 40), `1,2 · 0,8 = 0,96 → ${f} · 0,96 = ${f * 0.96} TL. Ardışık yüzdelerde başa dönülmez.`); },
    () => { const a = R(20, 90), x = R(20, 80) * 5; const s = x * a / 100; return Q(`${x} sayısının %${a}'si kaçtır?`, +s.toFixed(2), numOpts(s, 30, s % 1 ? 2 : 0), `${x} · ${a}/100 = ${+s.toFixed(2)}`); }
  ]},
  problem: { ad: 'Problemler', gen: [
    () => { const c = R(5, 15), d = c + R(3, 18); const t = d - c; return Q(`Bir babanın yaşı ${c + d}, oğlunun yaşı ${c}'dir. Kaç yıl sonra babanın yaşı oğlunun yaşının 2 katı olur?`, t, numOpts(t, 6), `${c + d} + t = 2(${c} + t) → t = ${t}. (Yaş farkı hiç değişmez: ${d}.)`); },
    () => { const a = R(2, 9), b = R(2, 9); const t = (a * b) / (a + b); return Q(`Bir işi A işçisi ${a} günde, B işçisi ${b} günde bitiriyor. İkisi birlikte çalışırsa iş kaç günde biter?`, +t.toFixed(2), numOpts(t, 4, 2), `1/${a} + 1/${b} = 1/t → t = (${a}·${b})/(${a}+${b}) = ${+t.toFixed(2)} gün`); },
    () => { const v = R(40, 120), t = R(2, 8); return Q(`Saatte ${v} km hızla giden bir araç ${t} saatte kaç km yol alır?`, v * t, numOpts(v * t, 60), `Yol = hız × zaman = ${v} · ${t} = ${v * t} km`); },
    () => { const v1 = R(40, 90), v2 = R(40, 90), d = R(100, 600); const t = d / (v1 + v2); return Q(`Aralarında ${d} km olan iki araç birbirine doğru ${v1} km/sa ve ${v2} km/sa hızla aynı anda hareket ediyor. Kaç saat sonra karşılaşırlar?`, +t.toFixed(2), numOpts(t, 4, 2), `Yaklaşma hızı ${v1} + ${v2} = ${v1 + v2} km/sa → t = ${d}/${v1 + v2} = ${+t.toFixed(2)} saat`); },
    () => { const L = R(20, 80), p = pick([10, 20, 25, 40]), su = R(10, 60); const tuz = L * p / 100; const yeni = +(tuz * 100 / (L + su)).toFixed(2); return Q(`%${p}'lik ${L} litre tuzlu suya ${su} litre saf su ekleniyor. Yeni karışımın yüzdesi kaçtır?`, yeni, numOpts(yeni, 8, 2), `Tuz miktarı sabit: ${tuz} litre. Yeni oran = ${tuz}/${L + su} = %${yeni}`); },
    () => { const x = R(5, 40), k = R(2, 6), e = R(3, 30); return Q(`Bir sayının ${k} katının ${e} fazlası ${k * x + e} olduğuna göre bu sayı kaçtır?`, x, numOpts(x, 8), `${k}x + ${e} = ${k * x + e} → ${k}x = ${k * x} → x = ${x}`); }
  ]},
  kume: { ad: 'Kümeler', gen: [
    () => { const a = R(10, 40), b = R(10, 40), k = R(2, Math.min(a, b) - 1); return Q(`s(A) = ${a}, s(B) = ${b} ve s(A ∩ B) = ${k} olduğuna göre s(A ∪ B) kaçtır?`, a + b - k, numOpts(a + b - k, 8), `s(A ∪ B) = ${a} + ${b} - ${k} = ${a + b - k}`); },
    () => { const n = R(3, 8); return Q(`${n} elemanlı bir kümenin alt küme sayısı kaçtır?`, 2 ** n, numOpts(2 ** n, 2 ** n > 50 ? 40 : 8), `2^n = 2^${n} = ${2 ** n}`); },
    () => { const t = R(30, 60), a = R(15, 28), b = R(15, 28), h = R(2, 8); const ikisi = a + b - (t - h); return Q(`Bir sınıftaki ${t} öğrenciden ${a}'i matematik, ${b}'i fizik kursuna gidiyor. ${h} öğrenci hiçbirine gitmiyorsa her ikisine birden giden kaç öğrenci vardır?`, ikisi, numOpts(ikisi, 6), `En az birine giden = ${t} - ${h} = ${t - h}. ${a} + ${b} - x = ${t - h} → x = ${ikisi}`); }
  ]},
  fonksiyon: { ad: 'Fonksiyonlar', gen: [
    () => { const a = R(2, 7), b = R(-8, 8), x = R(-5, 8); const y = a * x + b; return Q(`f(x) = ${a}x ${b >= 0 ? '+ ' + b : '- ' + -b} fonksiyonu için f(${x}) kaçtır?`, y, numOpts(y, 8), `f(${x}) = ${a}·${x} ${b >= 0 ? '+ ' + b : '- ' + -b} = ${y}`); },
    () => { const a = R(2, 6), b = R(-6, 6), y = R(-4, 20); const x = (y - b) / a; return Q(`f(x) = ${a}x ${b >= 0 ? '+ ' + b : '- ' + -b} fonksiyonu için f⁻¹(${y}) kaçtır?`, +x.toFixed(2), numOpts(x, 5, x % 1 ? 2 : 0), `${a}x ${b >= 0 ? '+ ' + b : '- ' + -b} = ${y} → x = ${+x.toFixed(2)}`); },
    () => { const a = R(2, 5), b = R(1, 6), c = R(2, 5), x = R(1, 6); const g = c * x, f = a * g + b; return Q(`f(x) = ${a}x + ${b} ve g(x) = ${c}x olduğuna göre (f∘g)(${x}) kaçtır?`, f, numOpts(f, 10), `g(${x}) = ${g}, f(${g}) = ${a}·${g} + ${b} = ${f}`); }
  ]},
  olasilik: { ad: 'Permütasyon - olasılık', gen: [
    () => { const n = R(5, 12); return Q(`${n} kişilik bir gruptan 2 kişilik komisyon kaç farklı şekilde seçilir?`, C(n, 2), numOpts(C(n, 2), 10), `C(${n}, 2) = ${n}·${n - 1}/2 = ${C(n, 2)}`); },
    () => { const n = R(4, 7); return Q(`${n} farklı kitap bir rafa kaç farklı şekilde dizilebilir?`, [1, 1, 2, 6, 24, 120, 720, 5040][n], numOpts([1, 1, 2, 6, 24, 120, 720, 5040][n], 40), `${n}! = ${[1, 1, 2, 6, 24, 120, 720, 5040][n]}`); },
    () => { const k = R(2, 6); let b = R(2, 6); if (b === k) b = k + 2; return Q(`İçinde ${k} kırmızı ve ${b} beyaz top bulunan torbadan rastgele çekilen bir topun kırmızı olma olasılığı kaçtır?`, frac(k, k + b), [frac(b, k + b), frac(k, b), frac(1, k + b), frac(k + b, k)], `İstenen/tüm = ${k}/${k + b} = ${frac(k, k + b)}`); },
    () => { const hedef = R(2, 12); const say = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1][hedef]; return Q(`İki zar atıldığında üste gelen sayıların toplamının ${hedef} olma olasılığı kaçtır?`, frac(say, 36), [1, -1, 2, -2, 3, 4, -3, 5].map(dx => say + dx).filter(x => x >= 1 && x <= 36).map(x => frac(x, 36)).slice(0, 4), `Toplam ${hedef} veren ${say} durum vardır, tüm durum 36 → ${frac(say, 36)}`); }
  ]},
  dizi: { ad: 'Diziler', gen: [
    () => { const a1 = R(1, 12), d = R(2, 9), n = R(5, 20); const an = a1 + (n - 1) * d; return Q(`İlk terimi ${a1}, ortak farkı ${d} olan aritmetik dizinin ${n}. terimi kaçtır?`, an, numOpts(an, 12), `aₙ = a₁ + (n-1)d = ${a1} + ${n - 1}·${d} = ${an}`); },
    () => { const a1 = R(1, 8), r = R(2, 4), n = R(4, 7); const an = a1 * r ** (n - 1); return Q(`İlk terimi ${a1}, ortak çarpanı ${r} olan geometrik dizinin ${n}. terimi kaçtır?`, an, numOpts(an, Math.max(10, an / 4)), `aₙ = a₁·r^(n-1) = ${a1}·${r}^${n - 1} = ${an}`); },
    () => { const a1 = R(1, 10), d = R(2, 7), n = R(5, 15); const an = a1 + (n - 1) * d, t = n * (a1 + an) / 2; return Q(`İlk terimi ${a1}, ortak farkı ${d} olan aritmetik dizinin ilk ${n} teriminin toplamı kaçtır?`, t, numOpts(t, 30), `aₙ = ${an}, toplam = n(a₁+aₙ)/2 = ${n}·${a1 + an}/2 = ${t}`); }
  ]}
}},

/* ---------------------------- GEOMETRİ ---------------------------- */
geo: { ad: 'Geometri', sinavlar: ['tyt', 'kpss'], konular: {
  ucgen: { ad: 'Üçgenler', gen: [
    () => { const [a, b, c] = pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25]]); return Q(`Dik kenarları ${a} cm ve ${b} cm olan dik üçgenin hipotenüsü kaç cm'dir?`, c, numOpts(c, 5), `a² + b² = c² → ${a * a} + ${b * b} = ${c * c} → c = ${c}`); },
    () => { const t = R(4, 20), h = R(4, 20); return Q(`Tabanı ${t} cm, bu tabana ait yüksekliği ${h} cm olan üçgenin alanı kaç cm²dir?`, t * h / 2, numOpts(t * h / 2, 20), `Alan = taban·yükseklik/2 = ${t}·${h}/2 = ${t * h / 2}`); },
    () => { const x = R(2, 9); return Q(`30-60-90 üçgeninde 30° karşısındaki kenar ${x} cm ise hipotenüs kaç cm'dir?`, 2 * x, numOpts(2 * x, 5), `30° karşısı x ise hipotenüs 2x = ${2 * x} cm`); },
    () => { const a = R(20, 80), b = R(20, 80); return Q(`Bir üçgenin iki iç açısı ${a}° ve ${b}° ise üçüncü açı kaç derecedir?`, 180 - a - b, numOpts(180 - a - b, 15), `İç açılar toplamı 180° → 180 - ${a} - ${b} = ${180 - a - b}`); },
    () => { const k = R(2, 5); return Q(`Benzerlik oranı ${k} olan iki üçgenin alanları oranı kaçtır?`, k * k, numOpts(k * k, 6), `Alan oranı, benzerlik oranının karesidir: ${k}² = ${k * k}`); }
  ]},
  dortgen: { ad: 'Dörtgenler', gen: [
    () => { const a = R(3, 20), b = R(3, 20); return Q(`Kısa kenarı ${a} cm, uzun kenarı ${b} cm olan dikdörtgenin alanı kaç cm²dir?`, a * b, numOpts(a * b, 25), `Alan = ${a}·${b} = ${a * b}`); },
    () => { const a = R(3, 15); return Q(`Bir kenarı ${a} cm olan karenin çevresi kaç cm'dir?`, 4 * a, numOpts(4 * a, 8), `Çevre = 4a = ${4 * a}`); },
    () => { const a = R(2, 12); return Q(`Bir kenarı ${a} cm olan karenin köşegen uzunluğu kaç cm'dir?`, `${a}√2`, [`${2 * a}√2`, `${a}√3`, `${a * 2}`, `${a}/√2`], `Karenin köşegeni a√2 = ${a}√2 cm`); },
    () => { const a = R(4, 14), b = R(4, 14), h = R(3, 10); return Q(`Alt tabanı ${a} cm, üst tabanı ${b} cm, yüksekliği ${h} cm olan yamuğun alanı kaç cm²dir?`, (a + b) * h / 2, numOpts((a + b) * h / 2, 18), `Alan = (${a} + ${b})·${h}/2 = ${(a + b) * h / 2}`); },
    () => { const e = R(4, 16), f = R(4, 16); return Q(`Köşegen uzunlukları ${e} cm ve ${f} cm olan eşkenar dörtgenin alanı kaç cm²dir?`, e * f / 2, numOpts(e * f / 2, 16), `Alan = köşegenlerin çarpımı/2 = ${e}·${f}/2 = ${e * f / 2}`); }
  ]},
  cember: { ad: 'Çember ve daire', gen: [
    () => { const r = R(3, 15); return Q(`Yarıçapı ${r} cm olan çemberin çevresi kaç cm'dir?`, `${2 * r}π`, [`${r}π`, `${4 * r}π`, `${r * r}π`, `${3 * r}π`, `${2 * r}`, `${r * r * 2}π`], `Çevre = 2πr = ${2 * r}π`); },
    () => { const r = R(3, 12); return Q(`Yarıçapı ${r} cm olan dairenin alanı kaç cm²dir?`, `${r * r}π`, [`${2 * r}π`, `${r}π`, `${r * r * 2}π`, `${4 * r}π`, `${r * r}`, `${r * r * r}π`], `Alan = πr² = ${r * r}π`); },
    () => { const y = R(2, 17) * 10; return Q(`Bir çemberde ${y}° lik yayı gören çevre açı kaç derecedir?`, y / 2, numOpts(y / 2, 15), `Çevre açı, gördüğü yayın yarısıdır: ${y}/2 = ${y / 2}`); },
    () => { const a = R(2, 17) * 10; return Q(`Bir çemberde merkez açısı ${a}° olan yayın ölçüsü kaç derecedir?`, a, numOpts(a, 20), `Merkez açı gördüğü yaya eşittir: ${a}°`); }
  ]},
  kati: { ad: 'Katı cisimler', gen: [
    () => { const a = R(2, 10); return Q(`Bir ayrıtı ${a} cm olan küpün hacmi kaç cm³tür?`, a ** 3, numOpts(a ** 3, Math.max(20, a ** 2)), `V = a³ = ${a}³ = ${a ** 3}`); },
    () => { const a = R(2, 10); return Q(`Bir ayrıtı ${a} cm olan küpün tüm yüzey alanı kaç cm²dir?`, 6 * a * a, numOpts(6 * a * a, 30), `Yüzey = 6a² = 6·${a * a} = ${6 * a * a}`); },
    () => { const a = R(2, 9), b = R(2, 9), c = R(2, 9); return Q(`Ayrıtları ${a}, ${b} ve ${c} cm olan dikdörtgenler prizmasının hacmi kaç cm³tür?`, a * b * c, numOpts(a * b * c, 30), `V = ${a}·${b}·${c} = ${a * b * c}`); },
    () => { const r = R(2, 8), h = R(2, 10); return Q(`Taban yarıçapı ${r} cm, yüksekliği ${h} cm olan silindirin hacmi kaç cm³tür?`, `${r * r * h}π`, [`${2 * r * h}π`, `${r * h}π`, `${r * r * h / 3}π`, `${2 * r * r * h}π`, `${r * h * h}π`, `${r * r * h}`], `V = πr²h = ${r * r * h}π`); }
  ]},
  analitik: { ad: 'Analitik geometri', gen: [
    () => { const x1 = R(-6, 6), y1 = R(-6, 6), d = pick([[3, 4], [6, 8], [5, 12], [8, 15]]); const x2 = x1 + d[0], y2 = y1 + d[1]; const u = Math.hypot(d[0], d[1]); return Q(`A(${x1}, ${y1}) ve B(${x2}, ${y2}) noktaları arasındaki uzaklık kaç birimdir?`, u, numOpts(u, 5), `√((${x2}-${x1})² + (${y2}-${y1})²) = √(${d[0] ** 2} + ${d[1] ** 2}) = ${u}`); },
    () => { const x1 = R(-8, 8), y1 = R(-8, 8), x2 = R(-8, 8), y2 = R(-8, 8); return Q(`A(${x1}, ${y1}) ve B(${x2}, ${y2}) noktalarını birleştiren doğru parçasının orta noktasının apsisi (x koordinatı) kaçtır?`, (x1 + x2) / 2, numOpts((x1 + x2) / 2, 5, (x1 + x2) % 2 ? 1 : 0), `Orta nokta x = (${x1} + ${x2})/2 = ${(x1 + x2) / 2}`); },
    () => { const m = R(-5, 5), n = R(-6, 6); return Q(`y = ${m}x ${n >= 0 ? '+ ' + n : '- ' + -n} doğrusunun eğimi kaçtır?`, m, numOpts(m, 5), `y = mx + n biçiminde eğim m = ${m}`); },
    () => { const m = R(2, 6); return Q(`Eğimi ${m} olan bir doğruya dik olan doğrunun eğimi kaçtır?`, frac(-1, m), [frac(1, m), String(m), String(-m), frac(-1, m + 1), frac(1, m + 1)], `Dik doğrularda m₁·m₂ = -1 → m₂ = -1/${m}`); }
  ]}
}},

/* ---------------------------- TÜRKÇE ---------------------------- */
turkce: { ad: 'Türkçe', sinavlar: ['tyt', 'kpss'], konular: {
  sozcuk: { ad: 'Sözcükte ve cümlede anlam', gen: [
    () => bankQ(B_TR_ANLAM),
    () => pairQ(D_DEYIM, 'v', it => `"${it.k}" deyiminin anlamı aşağıdakilerden hangisidir?`, it => `"${it.k}" → ${it.v.toLowerCase()}.`),
    () => pairQ(D_DEYIM, 'k', it => `"${it.v}" anlamına gelen deyim aşağıdakilerden hangisidir?`, it => `${it.v} → "${it.k}".`),
    () => pairQ(D_ESANLAM, 'v', it => `"${it.k}" sözcüğünün eş anlamlısı aşağıdakilerden hangisidir?`, it => `${it.k} = ${it.v}`),
    () => pairQ(D_ZIT, 'v', it => `"${it.k}" sözcüğünün zıt anlamlısı aşağıdakilerden hangisidir?`, it => `${it.k} ↔ ${it.v}`)
  ]},
  paragraf: { ad: 'Paragraf', gen: [() => bankQ(B_PARAGRAF)] },
  yazim: { ad: 'Yazım kuralları', gen: [
    () => { const it = pick(D_YAZIM); const dogrular = shuffle(D_YAZIM.filter(x => x !== it).map(x => x.d)).slice(0, 4); return Q('Aşağıdaki sözcüklerin hangisinde yazım yanlışı vardır?', it.y, dogrular, `Doğru yazımı "${it.d}" biçimindedir.`); },
    () => { const it = pick(D_YAZIM); const yanlislar = shuffle(D_YAZIM.filter(x => x !== it).map(x => x.y)).slice(0, 4); return Q('Aşağıdaki sözcüklerin hangisi doğru yazılmıştır?', it.d, yanlislar, `"${it.d}" doğru yazımdır.`); }
  ]},
  noktalama: { ad: 'Noktalama', gen: [() => bankQ(B_TR_NOKTA)] },
  ses: { ad: 'Ses bilgisi', gen: [
    () => pairQ(D_SES, 'v', it => `"${it.k}" sözcüğünde hangi ses olayı vardır?`, it => `"${it.k}" örneğinde ${it.v.toLowerCase()} görülür.`)
  ]},
  turler: { ad: 'Sözcük türleri', gen: [() => bankQ(B_TR_TURLER)] },
  fiilimsi: { ad: 'Fiilimsiler', gen: [
    () => pairQ(D_FIILIMSI, 'v', it => `"${it.k}" cümlesindeki fiilimsi hangi türdendir?`, it => `Bu cümledeki fiilimsi ${it.v} türündedir.`)
  ]},
  ogeler: { ad: 'Cümlenin ögeleri', gen: [() => bankQ(B_TR_OGE)] },
  bozukluk: { ad: 'Anlatım bozuklukları', gen: [() => bankQ(B_TR_BOZUK)] }
}},

/* ---------------------------- FİZİK / KİMYA / BİYOLOJİ ---------------------------- */
fizik: { ad: 'Fizik', sinavlar: ['tyt'], konular: {
  hareket: { ad: 'Hareket', gen: [
    () => { const x = R(20, 300), t = R(2, 10); return Q(`${x} metrelik yolu ${t} saniyede alan bir aracın ortalama hızı kaç m/s'dir?`, +(x / t).toFixed(2), numOpts(x / t, 8, (x / t) % 1 ? 2 : 0), `v = x/t = ${x}/${t} = ${+(x / t).toFixed(2)} m/s`); },
    () => { const v0 = R(0, 20), a = R(1, 8), t = R(2, 10); return Q(`İlk hızı ${v0} m/s olan cisim ${a} m/s² ivmeyle ${t} saniye hızlanıyor. Son hızı kaç m/s'dir?`, v0 + a * t, numOpts(v0 + a * t, 12), `v = v₀ + a·t = ${v0} + ${a}·${t} = ${v0 + a * t} m/s`); },
    () => { const t = R(1, 6); return Q(`Serbest bırakılan bir cisim ${t} saniyede kaç metre düşer? (g = 10 m/s²)`, 5 * t * t, numOpts(5 * t * t, 20), `h = g·t²/2 = 10·${t * t}/2 = ${5 * t * t} m`); }
  ]},
  kuvvet: { ad: 'Kuvvet, iş, enerji', gen: [
    () => { const m = R(2, 20), a = R(2, 10); return Q(`Kütlesi ${m} kg olan cisme ${a} m/s² ivme kazandıran kuvvet kaç N'dur?`, m * a, numOpts(m * a, 20), `F = m·a = ${m}·${a} = ${m * a} N`); },
    () => { const f = R(10, 100), x = R(2, 20); return Q(`${f} N'luk kuvvet, cismi kuvvet doğrultusunda ${x} metre hareket ettiriyor. Yapılan iş kaç joule'dür?`, f * x, numOpts(f * x, 60), `W = F·x = ${f}·${x} = ${f * x} J`); },
    () => { const m = R(2, 10), v = R(2, 10); return Q(`Kütlesi ${m} kg, hızı ${v} m/s olan cismin kinetik enerjisi kaç joule'dür?`, m * v * v / 2, numOpts(m * v * v / 2, 40), `Ek = m·v²/2 = ${m}·${v * v}/2 = ${m * v * v / 2} J`); },
    () => { const m = R(2, 20), h = R(2, 20); return Q(`Kütlesi ${m} kg olan cisim ${h} metre yükseklikte tutuluyor. Potansiyel enerjisi kaç joule'dür? (g = 10)`, m * 10 * h, numOpts(m * 10 * h, 80), `Ep = m·g·h = ${m}·10·${h} = ${m * 10 * h} J`); },
    () => { const w = R(100, 900), t = R(2, 10); return Q(`${w} joule'lük iş ${t} saniyede yapılıyorsa güç kaç watttır?`, +(w / t).toFixed(1), numOpts(w / t, 30, (w / t) % 1 ? 1 : 0), `P = W/t = ${w}/${t} = ${+(w / t).toFixed(1)} W`); }
  ]}
}},
kimya: { ad: 'Kimya', sinavlar: ['tyt'], konular: {
  atom: { ad: 'Atom ve periyodik sistem', gen: [
    () => { const p = R(3, 30), n = R(3, 35); return Q(`Proton sayısı ${p}, kütle numarası ${p + n} olan atomun nötron sayısı kaçtır?`, n, numOpts(n, 6), `Nötron = kütle numarası - proton = ${p + n} - ${p} = ${n}`); },
    () => { const p = R(5, 25), y = R(1, 3); return Q(`Atom numarası ${p} olan bir atom ${y} elektron vererek iyon oluşturuyor. İyonun elektron sayısı kaçtır?`, p - y, numOpts(p - y, 5), `Nötr atomda elektron = ${p}. ${y} elektron verince ${p - y} kalır.`); },
    () => bankQ(B_KIMYA)
  ]},
  mol: { ad: 'Mol kavramı', gen: [
    () => { const M = pick([18, 44, 16, 32, 28, 40, 58.5]), n = R(1, 8); return Q(`Mol kütlesi ${M} g/mol olan bir maddenin ${(M * n).toFixed(1)} gramı kaç moldür?`, n, numOpts(n, 4), `n = kütle/mol kütlesi = ${(M * n).toFixed(1)}/${M} = ${n} mol`); },
    () => { const n = R(1, 6); return Q(`Normal koşullarda ${n} mol gazın hacmi kaç litredir?`, +(22.4 * n).toFixed(1), numOpts(22.4 * n, 20, 1), `V = n · 22,4 = ${n} · 22,4 = ${+(22.4 * n).toFixed(1)} L`); },
    () => bankQ(B_KIMYA)
  ]}
}},
biyo: { ad: 'Biyoloji', sinavlar: ['tyt'], konular: {
  hucre: { ad: 'Hücre ve organeller', gen: [() => bankQ(B_BIYO)] },
  bolunme: { ad: 'Mitoz - mayoz ve kalıtım', gen: [
    () => bankQ(B_BIYO),
    () => { const n = R(4, 23); return Q(`Kromozom sayısı 2n = ${2 * n} olan bir hücre mayoz bölünme geçirirse oluşan hücrelerin kromozom sayısı kaç olur?`, n, numOpts(n, 6), `Mayozda kromozom sayısı yarıya iner: ${2 * n} → ${n}`); },
    () => { const n = R(1, 5); return Q(`Bir hücre ${n} kez mitoz bölünme geçirirse kaç hücre oluşur?`, 2 ** n, numOpts(2 ** n, 8), `2^n = 2^${n} = ${2 ** n} hücre`); }
  ]}
}},

/* ---------------------------- SOSYAL ---------------------------- */
tarih: { ad: 'Tarih', sinavlar: ['tyt', 'ayt', 'kpss'], konular: {
  olaylar: { ad: 'Olaylar ve tarihleri', gen: [
    () => pairQ(D_TARIH, 'y', it => `${it.o} hangi yılda gerçekleşmiştir?`, it => `${it.o}: ${it.y}`),
    () => pairQ(D_TARIH, 'o', it => `${it.y} yılında gerçekleşen olay aşağıdakilerden hangisidir?`, it => `${it.y} → ${it.o}`)
  ]},
  ilkturk: { ad: 'İlk Türk devletleri', gen: [
    () => bankQ([
      {q:'Bilinen ilk teşkilatlı Türk devleti hangisidir?',d:'Asya Hun Devleti',y:['Göktürk','Uygur','Avar','Hazar']},
      {q:'"Türk" adını devlet adı olarak ilk kullanan Türk devleti hangisidir?',d:'Göktürk Devleti',y:['Asya Hun','Uygur','Kırgız','Karahanlı']},
      {q:'Yerleşik hayata geçen ilk Türk devleti hangisidir?',d:'Uygurlar',y:['Göktürkler','Asya Hunları','Avarlar','Peçenekler']},
      {q:'Orhun Yazıtları hangi dönemde dikilmiştir?',d:'II. Göktürk (Kutluk) Devleti',y:['Uygur Devleti','Asya Hun Devleti','Karahanlı Devleti','Selçuklu Devleti']},
      {q:'Onluk ordu sistemini kuran Türk hükümdarı kimdir?',d:'Mete Han',y:['Bumin Kağan','Bilge Kağan','Atilla','Alp Arslan']},
      {q:'İlk Müslüman Türk devleti hangisidir?',d:'Karahanlılar',y:['Gazneliler','Selçuklular','Uygurlar','Tolunoğulları']},
      {q:'Malazgirt Savaşı hangi hükümdar döneminde kazanılmıştır?',d:'Alp Arslan',y:['Tuğrul Bey','Melikşah','Osman Bey','Mete Han']}
    ])
  ]},
  osmanli: { ad: 'Osmanlı tarihi', gen: [
    () => pairQ(D_TARIH.filter(x => +x.y < 1900), 'y', it => `${it.o} hangi yılda gerçekleşmiştir?`),
    () => bankQ([
      {q:'İstanbul\'u fetheden Osmanlı padişahı kimdir?',d:'Fatih Sultan Mehmet',y:['Yavuz Sultan Selim','Kanuni Sultan Süleyman','II. Murat','I. Selim']},
      {q:'Halifelik hangi padişah döneminde Osmanlı\'ya geçmiştir?',d:'Yavuz Sultan Selim',y:['Fatih Sultan Mehmet','Kanuni Sultan Süleyman','II. Mahmut','Abdülhamit']},
      {q:'Osmanlı Devleti\'nin ilk büyük toprak kaybı hangi antlaşmayla olmuştur?',d:'Karlofça Antlaşması',y:['Pasarofça','Küçük Kaynarca','Zitvatorok','Edirne']},
      {q:'Yeniçeri Ocağı hangi padişah tarafından kaldırılmıştır?',d:'II. Mahmut',y:['III. Selim','Abdülmecit','Fatih','Yavuz']},
      {q:'Tanzimat Fermanı hangi padişah döneminde ilan edilmiştir?',d:'Abdülmecit',y:['II. Mahmut','Abdülaziz','II. Abdülhamit','III. Selim']}
    ])
  ]},
  kurtulus: { ad: 'Kurtuluş Savaşı ve inkılaplar', gen: [
    () => pairQ(D_TARIH.filter(x => +x.y >= 1900), 'y', it => `${it.o} hangi yılda gerçekleşmiştir?`),
    () => bankQ([
      {q:'Kurtuluş Savaşı\'nın yöntem ve gerekçesi ilk kez hangi belgede açıklanmıştır?',d:'Amasya Genelgesi',y:['Erzurum Kongresi','Sivas Kongresi','Misak-ı Milli','Tekalif-i Milliye']},
      {q:'"Manda ve himaye kabul edilemez" kararı ilk kez nerede kesinleşmiştir?',d:'Sivas Kongresi',y:['Amasya Genelgesi','Erzurum Kongresi','Lozan','TBMM']},
      {q:'Sakarya Savaşı\'nın en önemli sonucu nedir?',d:'Savunmadan taarruza geçilmesi',y:['Saltanatın kaldırılması','Cumhuriyetin ilanı','Mudanya\'nın imzalanması','Sevr\'in yürürlüğe girmesi']},
      {q:'TBMM hangi tarihte açılmıştır?',d:'23 Nisan 1920',y:['19 Mayıs 1919','29 Ekim 1923','30 Ağustos 1922','24 Temmuz 1923']},
      {q:'Yeni Türk harfleri hangi yıl kabul edilmiştir?',d:'1928',y:['1924','1926','1934','1930']},
      {q:'Türkiye\'de kadınlara milletvekili seçme ve seçilme hakkı hangi yıl verilmiştir?',d:'1934',y:['1930','1926','1928','1945']}
    ])
  ]}
}},
cografya: { ad: 'Coğrafya', sinavlar: ['tyt', 'ayt', 'kpss'], konular: {
  turkiye: { ad: 'Türkiye coğrafyası', gen: [() => bankQ(B_COG)] },
  genel: { ad: 'Genel coğrafya', gen: [() => bankQ(B_COG)] }
}},
felsefe: { ad: 'Felsefe', sinavlar: ['tyt'], konular: {
  genel: { ad: 'Felsefeye giriş', gen: [() => bankQ(B_FELSEFE)] }
}},
din: { ad: 'Din kültürü', sinavlar: ['tyt'], konular: {
  genel: { ad: 'Temel bilgiler', gen: [() => bankQ(B_DIN)] }
}},
vatandaslik: { ad: 'Vatandaşlık', sinavlar: ['kpss'], konular: {
  anayasa: { ad: 'Anayasa ve yönetim', gen: [() => bankQ(B_VAT)] }
}},
edebiyat: { ad: 'Türk Dili ve Edebiyatı', sinavlar: ['ayt'], konular: {
  eserler: { ad: 'Eser - yazar eşleştirme', gen: [
    () => pairQ(D_ESER, 'y', it => `"${it.e}" adlı eserin yazarı kimdir?`, it => `${it.e} → ${it.y}`),
    () => pairQ(D_ESER, 'e', it => `${it.y} aşağıdaki eserlerden hangisinin yazarıdır?`, it => `${it.y} → ${it.e}`)
  ]},
  akimlar: { ad: 'Dönemler ve akımlar', gen: [() => bankQ(B_EDEB)] }
}},

/* ---------------------------- AYT MATEMATİK ---------------------------- */
aytmat: { ad: 'AYT Matematik', sinavlar: ['ayt'], konular: {
  limit: { ad: 'Limit', gen: [
    () => { const a = R(1, 8); return Q(`lim(x→${a}) (x² - ${a * a}) / (x - ${a}) limitinin değeri kaçtır?`, 2 * a, numOpts(2 * a, 6), `(x-${a})(x+${a})/(x-${a}) = x + ${a} → x = ${a} için ${2 * a}`); },
    () => { const a = R(2, 9); let b = R(2, 9); if (b === a) b = a + 1; return Q(`lim(x→∞) (${a}x² + 3x) / (${b}x² - 1) limitinin değeri kaçtır?`, frac(a, b), [frac(b, a), '0', '∞', frac(a + b, 2), frac(a, b + 1)], `∞/∞ belirsizliğinde en büyük dereceli terimlerin katsayı oranı alınır: ${a}/${b}`); }
  ]},
  turev: { ad: 'Türev', gen: [
    () => { const a = R(1, 5), b = R(1, 6), x = R(1, 4); const t = 3 * a * x * x + 2 * b * x; return Q(`f(x) = ${a}x³ + ${b}x² + 7 fonksiyonunun x = ${x} noktasındaki türevi kaçtır?`, t, numOpts(t, 14), `f'(x) = ${3 * a}x² + ${2 * b}x → f'(${x}) = ${3 * a}·${x * x} + ${2 * b}·${x} = ${t}`); },
    () => { const a = R(2, 8), b = R(1, 9), x = R(1, 6); const m = 2 * a * x + b; return Q(`f(x) = ${a}x² + ${b}x fonksiyonunun grafiğine x = ${x} noktasında çizilen teğetin eğimi kaçtır?`, m, numOpts(m, 10), `Eğim = f'(${x}) = ${2 * a}·${x} + ${b} = ${m}`); },
    () => { const a = R(1, 6), b = R(2, 12); const x = +(b / (2 * a)).toFixed(2); return Q(`f(x) = ${a}x² - ${b}x fonksiyonu hangi x değerinde en küçük değerini alır?`, x, numOpts(x, 4, x % 1 ? 2 : 0), `f'(x) = ${2 * a}x - ${b} = 0 → x = ${x}`); }
  ]},
  integral: { ad: 'İntegral', gen: [
    () => { const a = R(1, 5), n = R(1, 4); const s = a * n * n / 2; return Q(`∫[0, ${n}] ${a}x dx integralinin değeri kaçtır?`, s, numOpts(s, 8, s % 1 ? 1 : 0), `${a}x²/2 ifadesinin 0 ile ${n} arasındaki değeri = ${a}·${n * n}/2 = ${s}`); },
    () => { const k = R(2, 9), n = R(1, 5); return Q(`∫[0, ${n}] ${k} dx integralinin değeri kaçtır?`, k * n, numOpts(k * n, 8), `Sabitin integrali ${k}x → ${k}·${n} - 0 = ${k * n}`); }
  ]},
  log: { ad: 'Logaritma', gen: [
    () => { const a = pick([2, 3, 5]), k = R(2, 5); return Q(`log_${a}(${a ** k}) ifadesinin değeri kaçtır?`, k, numOpts(k, 4), `${a}^x = ${a ** k} → x = ${k}`); },
    () => { const a = R(2, 5), b = R(2, 5); return Q(`log2(${2 ** a}) + log3(${3 ** b}) işleminin sonucu kaçtır?`, a + b, numOpts(a + b, 5), `${a} + ${b} = ${a + b}`); },
    () => { const x = R(2, 20), y = R(2, 20); return Q(`log(${x}) + log(${y}) ifadesinin eşiti aşağıdakilerden hangisidir?`, `log(${x * y})`, [`log(${x + y})`, `log(${x}/${y})`, `${x}·log(${y})`, `log(${x}) · log(${y})`], `log a + log b = log(a·b) = log(${x * y})`); }
  ]},
  trigo: { ad: 'Trigonometri', gen: [
    () => { const t = pick([[0, 'sin', '0'], [30, 'sin', '1/2'], [45, 'sin', '√2/2'], [60, 'sin', '√3/2'], [90, 'sin', '1'], [0, 'cos', '1'], [30, 'cos', '√3/2'], [45, 'cos', '√2/2'], [60, 'cos', '1/2'], [90, 'cos', '0'], [45, 'tan', '1'], [60, 'tan', '√3'], [30, 'tan', '√3/3']]); return Q(`${t[1]}${t[0]}° değeri kaçtır?`, t[2], shuffle(['0', '1', '1/2', '√2/2', '√3/2', '√3', '√3/3', '2'].filter(v => v !== t[2])).slice(0, 4), `${t[1]}${t[0]}° = ${t[2]}`); },
    () => { const d = pick([30, 45, 60, 90, 120, 180, 270, 360]); const r = frac(d, 180); return Q(`${d}° kaç radyandır?`, `${r === '1' ? '' : r}π`.replace('/', 'π/').replace('ππ', 'π'), [`${d}π`, `${frac(180, d)}π`, `${d / 90}π²`, `${frac(d, 360)}π`], `${d}° = ${d}·π/180 radyan`); }
  ]},
  karmasik: { ad: 'Karmaşık sayılar', gen: [
    () => { const n = R(5, 60); const v = ['1', 'i', '-1', '-i'][n % 4]; return Q(`i^${n} ifadesinin değeri kaçtır?`, v, ['1', 'i', '-1', '-i'].filter(x => x !== v).concat(['0']), `${n}'in 4 ile bölümünden kalan ${n % 4} → i^${n % 4} = ${v}`); },
    () => { const [a, b] = pick([[3, 4], [6, 8], [5, 12], [8, 15]]); const m = Math.hypot(a, b); return Q(`z = ${a} + ${b}i karmaşık sayısının modülü |z| kaçtır?`, m, numOpts(m, 5), `|z| = √(${a}² + ${b}²) = √${a * a + b * b} = ${m}`); }
  ]}
}}
};

/* ==========================================================================
   4) SORU HAVUZU KURMA
   ========================================================================== */
const SINAVLAR = { tyt: 'TYT', ayt: 'AYT', kpss: 'KPSS' };

function konuListesi(sinav, ders) {
  const out = [];
  Object.entries(DERSLER).forEach(([dk, d]) => {
    if (sinav && !d.sinavlar.includes(sinav)) return;
    if (ders && ders !== 'hepsi' && dk !== ders) return;
    Object.entries(d.konular).forEach(([kk, k]) => out.push({ ders: dk, dersAd: d.ad, konu: kk, konuAd: k.ad, gen: k.gen }));
  });
  return out;
}

function soruUret(hedef) {
  for (let deneme = 0; deneme < 6; deneme++) {
    try {
      const s = pick(hedef.gen)();
      if (s && s.ans >= 0 && s.opts.length === 5) {
        s.ders = hedef.dersAd; s.konu = hedef.konuAd;
        return s;
      }
    } catch (e) { /* üretici hata verirse yenisini dene */ }
  }
  return null;
}

function havuzKur(sinav, ders, konu, adet) {
  const tum = konuListesi(sinav, ders);
  let hedefler = (konu && konu !== 'hepsi') ? tum.filter(h => h.konu === konu) : tum;
  if (!hedefler.length) hedefler = tum;
  if (!hedefler.length) return [];
  const list = [], gorulen = new Set();
  const doldur = (kaynak, tur) => {
    let guard = 0;
    while (list.length < adet && guard++ < adet * tur) {
      const s = soruUret(pick(kaynak));
      if (!s) continue;
      const imza = s.q.slice(0, 80) + '|' + s.opts.join('~').slice(0, 80);
      if (gorulen.has(imza)) continue;    // aynı testte aynı soru iki kez çıkmaz
      gorulen.add(imza);
      list.push(s);
    }
  };
  doldur(hedefler, 25);
  if (list.length < adet && hedefler !== tum) doldur(tum, 20);  // konu havuzu küçükse aynı dersin diğer konuları
  return list;
}

/* ==========================================================================
   5) TEST MOTORU
   ========================================================================== */
let QZ = null;

function testBaslat(cfg) {
  if (QZ && QZ.timerId) clearInterval(QZ.timerId);
  const list = cfg.list || havuzKur(cfg.sinav, cfg.ders, cfg.konu, cfg.adet);
  if (!list.length) { alert('Bu seçimle soru üretilemedi. Başka bir konu dene.'); return; }
  QZ = { list, i: 0, cevap: new Array(list.length).fill(null), mode: cfg.mode || 'instant', sure: cfg.sure || 0, gecen: 0, baslangic: Date.now(), host: cfg.host || '#quizHost', baslik: cfg.baslik || 'Test' };
  QZ.timerId = setInterval(() => {
    if (!QZ) return;
    QZ.gecen++;
    if (QZ.sure && QZ.gecen >= QZ.sure) { testBitir(true); return; }
    const el = $('#qzTime'); if (el) el.textContent = sureYaz(QZ.sure ? QZ.sure - QZ.gecen : QZ.gecen);
  }, 1000);
  soruCiz();
  $(QZ.host).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const sureYaz = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function soruCiz() {
  const host = $(QZ.host);
  const s = QZ.list[QZ.i];
  const dogru = QZ.cevap.filter((c, i) => c !== null && c === QZ.list[i].ans).length;
  const yanlis = QZ.cevap.filter((c, i) => c !== null && c !== QZ.list[i].ans).length;
  const secili = QZ.cevap[QZ.i];
  const acik = QZ.mode === 'instant' && secili !== null;

  host.innerHTML = `
    <div class="quiz-bar">
      <div class="quiz-meta"><span>${QZ.i + 1} / ${QZ.list.length}</span>
        <span class="ok">✓ ${dogru}</span><span class="no">✕ ${yanlis}</span>
        ${S.settings.hideTimer && !QZ.sure ? '' : `<span id="qzTime">${sureYaz(QZ.sure ? QZ.sure - QZ.gecen : QZ.gecen)}</span>`}
      </div>
      <div class="prog"><i style="width:${(QZ.i / QZ.list.length) * 100}%"></i></div>
      <button class="btn small ghost" id="qzQuit">Bitir</button>
    </div>
    <div class="q-card">
      <div class="q-top"><span>${esc(s.ders)} · ${esc(s.konu)}</span><span>${QZ.baslik}</span></div>
      <div class="q-text">${esc(s.q)}</div>
      <div class="opts">
        ${s.opts.map((o, i) => {
          let cls = '';
          if (acik) { if (i === s.ans) cls = 'right'; else if (i === secili) cls = 'wrong'; }
          else if (i === secili) cls = 'sel';
          return `<button class="opt ${cls}" data-i="${i}" ${acik ? 'disabled' : ''}>
            <span class="bub">${'ABCDE'[i]}</span><span>${esc(o)}</span></button>`;
        }).join('')}
      </div>
      ${acik ? `<div class="sol"><b>Çözüm:</b>\n${esc(s.sol)}</div>` : ''}
      <div class="q-actions">
        ${QZ.i > 0 && QZ.mode === 'end' ? '<button class="btn ghost" id="qzPrev">Önceki</button>' : ''}
        <button class="btn primary" id="qzNext">${QZ.i === QZ.list.length - 1 ? 'Testi bitir' : 'Sonraki soru'}</button>
        ${acik ? '<button class="btn ghost" id="qzAsk">Yapay zekâya sor</button>' : ''}
      </div>
    </div>`;

  $$('.opt', host).forEach(b => b.onclick = () => cevapla(+b.dataset.i));
  $('#qzNext', host).onclick = () => { if (QZ.i === QZ.list.length - 1) testBitir(); else { QZ.i++; soruCiz(); } };
  const prev = $('#qzPrev', host); if (prev) prev.onclick = () => { QZ.i--; soruCiz(); };
  $('#qzQuit', host).onclick = () => { if (confirm('Test bitirilsin mi?')) testBitir(); };
  const ask = $('#qzAsk', host); if (ask) ask.onclick = () => soruyuSor(s);
}

function cevapla(i) {
  const s = QZ.list[QZ.i];
  if (QZ.mode === 'instant') {
    if (QZ.cevap[QZ.i] !== null) return;
    QZ.cevap[QZ.i] = i;
    const d = i === s.ans;
    bip(d ? 'ok' : 'no');
    kaydetSonuc(s, d);
    seriYaz();
  } else {
    QZ.cevap[QZ.i] = i;
  }
  soruCiz();
}

function testBitir(sureBitti) {
  clearInterval(QZ.timerId);
  if (QZ.mode === 'end') {
    QZ.list.forEach((s, i) => { if (QZ.cevap[i] !== null) kaydetSonuc(s, QZ.cevap[i] === s.ans); });
    seriYaz();
  }
  const d = QZ.cevap.filter((c, i) => c !== null && c === QZ.list[i].ans).length;
  const y = QZ.cevap.filter((c, i) => c !== null && c !== QZ.list[i].ans).length;
  const bos = QZ.list.length - d - y;
  const net = (d - y / 4).toFixed(2);
  const yuzde = QZ.list.length ? Math.round(d / QZ.list.length * 100) : 0;

  $(QZ.host).innerHTML = `
    <div class="q-card result">
      ${sureBitti ? '<p class="muted">Süre doldu, sınav toplandı.</p>' : ''}
      <div class="big">%${yuzde}</div>
      <p class="net">${d} doğru · ${y} yanlış · ${bos} boş · net ${net}</p>
      <p>${yuzde >= 80 ? 'Bu konuyu oturtmuşsun. Zorluğu artırmak için karma test çöz.' : yuzde >= 50 ? 'Temel var, eksik var. Yanlışlarını defterden tekrar et, aynı konudan bir tur daha çöz.' : 'Soru çözmeden önce konu anlatımını bir kez daha oku; sonra 10 soruluk kısa turlarla dön.'}</p>
      <div class="q-actions" style="justify-content:center">
        <button class="btn primary" id="rsAgain">Yeni test kur</button>
        <button class="btn ghost" id="rsReview">Soruları incele</button>
      </div>
      <div class="review" id="rsList" hidden></div>
    </div>`;
  $('#rsAgain').onclick = () => { $(QZ.host).innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('#rsReview').onclick = () => {
    const box = $('#rsList');
    box.hidden = !box.hidden;
    if (!box.innerHTML) box.innerHTML = QZ.list.map((s, i) => {
      const c = QZ.cevap[i];
      return `<div class="wrong-item" style="border-left-color:${c === s.ans ? 'var(--green)' : 'var(--red)'}">
        <div class="meta">${esc(s.ders)} · ${esc(s.konu)} · ${c === null ? 'boş' : c === s.ans ? 'doğru' : 'yanlış'}</div>
        <div class="q">${esc(s.q)}</div>
        <div class="a">Doğru cevap: ${esc(s.opts[s.ans])}</div>
        <div class="s">${esc(s.sol)}</div></div>`;
    }).join('');
  };
  cizIstatistik();
}

/* ==========================================================================
   6) EKRANLAR
   ========================================================================== */
function cizPanel() {
  const st = S.stats;
  $('#hsSolved').textContent = st.total;
  $('#hsAcc').textContent = '%' + (st.total ? Math.round(st.correct / st.total * 100) : 0);
  $('#hsToday').textContent = (st.byDay[bugun()] || { t: 0 }).t;
  seriYaz();

  // cevap kâğıdı süsü
  const sheet = $('#heroSheet');
  if (!sheet.dataset.done) {
    sheet.dataset.done = '1';
    sheet.innerHTML = Array.from({ length: 7 }, (_, r) => {
      const f = R(0, 4);
      return `<div class="sheet-row"><i>${r + 1}</i>${Array.from({ length: 5 }, (_, c) =>
        `<span class="dot ${c === f ? (r % 3 === 0 ? 'fill-g' : 'fill') : ''}"></span>`).join('')}</div>`;
    }).join('');
  }

  // öneri kartları
  const zayif = Object.entries(S.stats.byDers).filter(([, v]) => v.t >= 5).sort((a, b) => (a[1].c / a[1].t) - (b[1].c / b[1].t))[0];
  const oneri = [
    { tag: 'Günlük tur', h: '20 soruluk karma TYT', p: 'Her günü bir karma turla açmak, konu atlamanı engeller.', go: () => hizliTest('tyt', 'hepsi', 'hepsi', 20) },
    { tag: 'Türkçe', h: 'Paragraf çalışması', p: 'TYT netlerinin en hızlı arttığı yer paragraf sorularıdır.', go: () => hizliTest('tyt', 'turkce', 'paragraf', 10) },
    { tag: 'Matematik', h: 'Problemler turu', p: 'Yaş, işçi, hız ve karışım soruları her sınavda çıkar.', go: () => hizliTest('tyt', 'mat', 'problem', 10) },
    { tag: 'KPSS', h: 'Vatandaşlık tekrarı', p: 'Az konu, çok soru. Ezberi taze tutmak için kısa turlar yeterli.', go: () => hizliTest('kpss', 'vatandaslik', 'anayasa', 10) }
  ];
  if (zayif) {
    const dk = Object.keys(DERSLER).find(k => DERSLER[k].ad === zayif[0]) || Object.keys(DERSLER).find(k => k === zayif[0]);
    oneri.unshift({ tag: 'Eksiğin burada', h: `${zayif[0]} tekrarı`, p: `Bu derste doğru oranın %${Math.round(zayif[1].c / zayif[1].t * 100)}. 10 soruluk bir tur iyi gelir.`, go: () => hizliTest('', dk || 'hepsi', 'hepsi', 10) });
  }
  $('#suggestGrid').innerHTML = oneri.slice(0, 4).map((o, i) => `<button class="card" data-i="${i}"><span class="tag">${o.tag}</span><h3>${o.h}</h3><p>${o.p}</p></button>`).join('');
  $$('#suggestGrid .card').forEach(b => b.onclick = () => oneri[+b.dataset.i].go());

  $('#examGrid').innerHTML = [
    { k: 'tyt', h: 'TYT', p: 'Türkçe, Matematik, Geometri, Fen ve Sosyal. Temel yeterlilik.' },
    { k: 'ayt', h: 'AYT', p: 'Alan dersleri: AYT Matematik, Edebiyat, Tarih, Coğrafya.' },
    { k: 'kpss', h: 'KPSS', p: 'Genel Yetenek ve Genel Kültür: Türkçe, Matematik, Tarih, Coğrafya, Vatandaşlık.' }
  ].map(e => `<button class="card" data-k="${e.k}"><h3>${e.h}</h3><p>${e.p}</p></button>`).join('');
  $$('#examGrid .card').forEach(b => b.onclick = () => { $('#selExam').value = b.dataset.k; dersDoldur(); location.hash = '#/test'; });
}

function seriYaz() { $('#streakBadge').textContent = `${S.streak.count || 0} gün`; }

function hizliTest(sinav, ders, konu, adet) {
  location.hash = '#/test';
  setTimeout(() => {
    if (sinav) $('#selExam').value = sinav;
    dersDoldur();
    if (ders && DERSLER[ders]) { $('#selDers').value = ders; konuDoldur(); }
    if (konu && konu !== 'hepsi') $('#selKonu').value = konu;
    $('#selCount').value = String(adet);
    testBaslat({ sinav: $('#selExam').value, ders: $('#selDers').value, konu: $('#selKonu').value, adet, mode: $('#selMode').value, baslik: 'Hızlı tur' });
  }, 60);
}

/* ---------- konu anlatımı ---------- */
function cizKonuListesi(filtre = '') {
  const f = filtre.toLocaleLowerCase('tr');
  const gruplar = {};
  ANLATIM.filter(a => !f || a.ad.toLocaleLowerCase('tr').includes(f) || a.grup.toLocaleLowerCase('tr').includes(f) || a.html.toLocaleLowerCase('tr').includes(f))
    .forEach(a => (gruplar[a.grup] = gruplar[a.grup] || []).push(a));
  const el = $('#konuList');
  el.innerHTML = Object.entries(gruplar).map(([g, list]) => `<div class="konu-group"><b>${esc(g)}</b>
    ${list.map(a => `<button data-id="${ANLATIM.indexOf(a)}">${esc(a.ad)}</button>`).join('')}</div>`).join('')
    || '<p class="muted">Eşleşen konu yok.</p>';
  $$('#konuList button').forEach(b => b.onclick = () => konuAc(+b.dataset.id));
}

function konuAc(i) {
  const a = ANLATIM[i];
  $$('#konuList button').forEach(b => b.classList.toggle('on', +b.dataset.id === i));
  const varMi = DERSLER[a.ders] && DERSLER[a.ders].konular[a.konu];
  $('#konuReader').innerHTML = a.html + `<div class="reader-actions">
    ${varMi ? `<button class="btn primary" id="krTest">Bu konudan 10 soru çöz</button>` : ''}
    <button class="btn ghost" id="krAi">Yapay zekâya anlattır</button></div>`;
  $('#konuReader').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (varMi) $('#krTest').onclick = () => {
    const sinav = DERSLER[a.ders].sinavlar[0];
    hizliTest(sinav, a.ders, a.konu, 10);
  };
  $('#krAi').onclick = () => { location.hash = '#/ai'; setTimeout(() => { $('#aiInput').value = `"${a.ad}" konusunu bir lise öğrencisine anlatır gibi, örnekli ve sade biçimde anlat. Sonunda 3 maddelik sınav taktiği ver.`; aiGonder(); }, 80); };
}

/* ---------- test kurulum menüleri ---------- */
function sinavDoldur() {
  $('#selExam').innerHTML = `<option value="">Fark etmez</option>` + Object.entries(SINAVLAR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#selExam').value = 'tyt';
  dersDoldur();
}
function dersDoldur() {
  const sinav = $('#selExam').value;
  const list = Object.entries(DERSLER).filter(([, d]) => !sinav || d.sinavlar.includes(sinav));
  $('#selDers').innerHTML = `<option value="hepsi">Karma (hepsi)</option>` + list.map(([k, d]) => `<option value="${k}">${d.ad}</option>`).join('');
  konuDoldur();
}
function konuDoldur() {
  const ders = $('#selDers').value;
  if (ders === 'hepsi' || !DERSLER[ders]) { $('#selKonu').innerHTML = '<option value="hepsi">Karma (hepsi)</option>'; return; }
  $('#selKonu').innerHTML = `<option value="hepsi">Karma (hepsi)</option>` + Object.entries(DERSLER[ders].konular).map(([k, v]) => `<option value="${k}">${v.ad}</option>`).join('');
}

/* ---------- deneme ---------- */
const DENEMELER = [
  { ad: 'TYT mini deneme', p: '40 soru · 60 dakika · karma', sinav: 'tyt', adet: 40, sure: 3600 },
  { ad: 'TYT tam deneme', p: '90 soru · 135 dakika · karma', sinav: 'tyt', adet: 90, sure: 8100 },
  { ad: 'TYT Matematik oturumu', p: '30 soru · 45 dakika', sinav: 'tyt', ders: 'mat', adet: 30, sure: 2700 },
  { ad: 'TYT Türkçe oturumu', p: '30 soru · 40 dakika', sinav: 'tyt', ders: 'turkce', adet: 30, sure: 2400 },
  { ad: 'AYT deneme', p: '40 soru · 80 dakika · alan dersleri', sinav: 'ayt', adet: 40, sure: 4800 },
  { ad: 'KPSS Genel Yetenek - Genel Kültür', p: '60 soru · 60 dakika', sinav: 'kpss', adet: 60, sure: 3600 }
];
function cizDenemeler() {
  $('#denemeGrid').innerHTML = DENEMELER.map((d, i) => `<button class="card" data-i="${i}"><span class="tag">${SINAVLAR[d.sinav]}</span><h3>${esc(d.ad)}</h3><p>${esc(d.p)}</p></button>`).join('');
  $$('#denemeGrid .card').forEach(b => b.onclick = () => {
    const d = DENEMELER[+b.dataset.i];
    if (!confirm(`${d.ad} başlıyor.\n${d.p}\nSüre bitince sınav kendiliğinden toplanır. Hazır mısın?`)) return;
    testBaslat({ sinav: d.sinav, ders: d.ders || 'hepsi', konu: 'hepsi', adet: d.adet, mode: 'end', sure: d.sure, host: '#denemeHost', baslik: d.ad });
  });
}

/* ---------- yanlış defteri ---------- */
function cizDefter() {
  const el = $('#wrongList');
  if (!S.wrong.length) { el.innerHTML = '<p class="muted">Defter boş. Yanlış yaptığın sorular çözümleriyle birlikte burada toplanır.</p>'; return; }
  el.innerHTML = S.wrong.slice(0, 80).map((w, i) => `<div class="wrong-item">
    <div class="meta">${esc(w.ders)} · ${esc(w.konu)} · ${w.tarih}</div>
    <div class="q">${esc(w.q)}</div>
    <div class="a">Doğru cevap: ${esc(w.a)}</div>
    <div class="s">${esc(w.sol)}</div></div>`).join('');
}

/* ---------- istatistik ---------- */
function cizIstatistik() {
  const st = S.stats;
  const oran = st.total ? Math.round(st.correct / st.total * 100) : 0;
  $('#statCards').innerHTML = [
    ['Çözülen soru', st.total], ['Doğru oranı', '%' + oran],
    ['Bugün', (st.byDay[bugun()] || { t: 0 }).t], ['Seri', (S.streak.count || 0) + ' gün'],
    ['Yanlış defteri', S.wrong.length]
  ].map(([a, b]) => `<div class="card"><b>${b}</b><p>${a}</p></div>`).join('');

  const gunler = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
  const max = Math.max(1, ...gunler.map(g => (st.byDay[g] || { t: 0 }).t));
  $('#dayBars').innerHTML = gunler.map(g => {
    const t = (st.byDay[g] || { t: 0 }).t;
    return `<div style="height:${Math.max(3, t / max * 100)}%" title="${g}: ${t} soru"><span>${g.slice(8)}</span></div>`;
  }).join('');

  const ds = Object.entries(st.byDers);
  $('#dersLanes').innerHTML = ds.length ? ds.map(([ad, v]) => {
    const p = Math.round(v.c / v.t * 100);
    return `<div class="lane"><span>${esc(ad)}</span><div class="track"><i style="width:${p}%"></i></div><span class="pct">%${p}</span></div>`;
  }).join('') : '<p class="muted">Henüz veri yok. Birkaç test çözünce burası dolar.</p>';
}

/* ==========================================================================
   7) YAPAY ZEKÂ KÖPRÜSÜ
   ========================================================================== */
const SISTEM = `Sen Türkiye'deki TYT, AYT ve KPSS sınavlarına hazırlanan bir lise öğrencisine yardım eden bir çalışma asistanısın.
Kurallar: Türkçe yaz. Sade ve net anlat, gereksiz uzatma. Konu anlatırken önce tanım, sonra örnek, sonra sınav taktiği ver.
Soru çözerken adım adım ilerle ve sonunda doğru şıkkı açıkça belirt. Bilmediğin bir şeyi uydurma.`;

async function aiCagir(mesajlar) {
  const { provider, key } = S.ai;
  if (!key) throw new Error('Önce bir API anahtarı kaydet.');
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SISTEM }] },
        contents: mesajlar.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      })
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return (j.candidates?.[0]?.content?.parts || []).map(p => p.text).join('\n');
  }
  const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const model = provider === 'openai' ? 'gpt-4o-mini' : 'openai/gpt-4o-mini';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: SISTEM }, ...mesajlar] })
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.choices?.[0]?.message?.content || '';
}

let sohbet = [];
function mesajEkle(rol, metin, hata) {
  const d = document.createElement('div');
  d.className = `msg ${rol === 'user' ? 'me' : 'ai'}${hata ? ' err' : ''}`;
  d.textContent = metin;
  $('#chat').appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return d;
}

async function aiGonder(metin) {
  const input = $('#aiInput');
  const soru = (metin || input.value).trim();
  if (!soru) return;
  if (!S.ai.key) { mesajEkle('ai', 'Yapay zekâ için önce yukarıdaki alana kendi API anahtarını kaydetmen gerekiyor. Google AI Studio üzerinden ücretsiz bir Gemini anahtarı alabilirsin.', true); return; }
  input.value = '';
  mesajEkle('user', soru);
  sohbet.push({ role: 'user', content: soru });
  const bekle = mesajEkle('ai', 'Yazıyor…');
  try {
    const cevap = await aiCagir(sohbet.slice(-12));
    bekle.textContent = cevap || 'Boş yanıt döndü.';
    sohbet.push({ role: 'assistant', content: cevap });
  } catch (e) {
    bekle.className = 'msg ai err';
    bekle.textContent = 'Bağlanamadım: ' + e.message + '\nAnahtarını, internet bağlantını ve seçtiğin sağlayıcıyı kontrol et.';
  }
}

function soruyuSor(s) {
  location.hash = '#/ai';
  setTimeout(() => aiGonder(`Şu soruyu adım adım açıkla:\n\n${s.q}\n\nŞıklar: ${s.opts.map((o, i) => 'ABCDE'[i] + ') ' + o).join('  ')}\nDoğru cevap: ${s.opts[s.ans]}\n\nNeden bu cevabın doğru olduğunu ve diğerlerinin neden yanlış olduğunu anlat.`), 120);
}

/* ==========================================================================
   8) BAŞLAT
   ========================================================================== */
function init() {
  // menüler
  sinavDoldur();
  $('#selExam').onchange = dersDoldur;
  $('#selDers').onchange = konuDoldur;
  $('#btnStartTest').onclick = () => testBaslat({
    sinav: $('#selExam').value, ders: $('#selDers').value, konu: $('#selKonu').value,
    adet: +$('#selCount').value, mode: $('#selMode').value, baslik: 'Soru turu'
  });

  cizKonuListesi();
  $('#konuSearch').oninput = e => cizKonuListesi(e.target.value);
  cizDenemeler();
  cizPanel();

  // panel düğmeleri
  $$('[data-go]').forEach(b => b.onclick = () => location.hash = b.dataset.go);
  $('#btnMenu').onclick = () => $('#nav').classList.toggle('open');

  // yanlış defteri
  $('#btnRetryWrong').onclick = () => {
    if (!S.wrong.length) { alert('Defterde soru yok.'); return; }
    const list = S.wrong.filter(w => w.opts && w.opts.length === 5).slice(0, 20)
      .map(w => ({ q: w.q, opts: w.opts, ans: w.ans, sol: w.sol, ders: w.ders, konu: w.konu }));
    if (!list.length) { alert('Defterdeki eski kayıtlarda şıklar yok. Yeni çözeceğin yanlışlar tekrar testine dahil olacak.'); return; }
    testBaslat({ list: shuffle(list), mode: 'instant', host: '#quizHost', baslik: 'Yanlış tekrarı' });
    location.hash = '#/test';
  };
  $('#btnClearWrong').onclick = () => { if (confirm('Yanlış defteri tamamen silinsin mi?')) { S.wrong = []; save(); cizDefter(); } };

  // yapay zekâ
  $('#aiProvider').value = S.ai.provider;
  $('#aiKey').value = S.ai.key;
  $('#aiKeyHint').textContent = S.ai.key ? 'Anahtar kayıtlı. Sorularını sorabilirsin.' : 'Gemini anahtarını Google AI Studio üzerinden ücretsiz alabilirsin.';
  $('#btnSaveKey').onclick = () => {
    S.ai.provider = $('#aiProvider').value;
    S.ai.key = $('#aiKey').value.trim();
    save();
    $('#aiKeyHint').textContent = S.ai.key ? 'Kaydedildi. Anahtar yalnızca bu tarayıcıda duruyor.' : 'Anahtar silindi.';
  };
  $('#btnAsk').onclick = () => aiGonder();
  $('#aiInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiGonder(); } };
  $$('.chip').forEach(c => c.onclick = () => aiGonder(c.dataset.prompt));

  // pomodoro
  pomoCiz();
  setInterval(pomoTick, 1000);
  $('#pomoStart').onclick = e => { pomo.on = !pomo.on; e.target.textContent = pomo.on ? 'Duraklat' : 'Başlat'; };
  $('#pomoReset').onclick = () => { pomo.on = false; pomo.mola = false; pomo.left = 1500; $('#pomoStart').textContent = 'Başlat'; pomoCiz(); };

  // ayarlar
  const mdl = $('#settingsModal');
  $('#btnSettings').onclick = () => { mdl.hidden = false; $('#setSound').checked = S.settings.sound; $('#setTimerHide').checked = S.settings.hideTimer; $('#setLight').checked = S.settings.light; };
  $('#btnCloseSettings').onclick = () => mdl.hidden = true;
  mdl.onclick = e => { if (e.target === mdl) mdl.hidden = true; };
  $('#setSound').onchange = e => { S.settings.sound = e.target.checked; save(); };
  $('#setTimerHide').onchange = e => { S.settings.hideTimer = e.target.checked; save(); };
  $('#setLight').onchange = e => { S.settings.light = e.target.checked; document.body.classList.toggle('light', e.target.checked); save(); };
  document.body.classList.toggle('light', S.settings.light);
  $('#btnExport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = 'optik-yedek.json'; a.click();
  };
  $('#btnReset').onclick = () => {
    if (!confirm('Bütün istatistikler, seri ve yanlış defteri silinecek. Emin misin?')) return;
    S = structuredClone(varsayilan); save(); cizIstatistik(); cizPanel(); cizDefter();
  };

  window.addEventListener('hashchange', router);
  router();
}

document.addEventListener('DOMContentLoaded', init);
