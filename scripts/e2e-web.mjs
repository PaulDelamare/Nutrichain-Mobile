/**
 * E2E WEB — ce que les tests unitaires ne PEUVENT pas voir.
 *
 * ⚠️ Le préréglage Jest de ce dépôt est `jest-expo` en mode NATIF : il ne rend jamais l'application
 * dans un navigateur. Trois bugs sont déjà passés par ce trou, tous avec une suite verte :
 *
 *   - `Alert.alert` est un no-op littéral sur react-native-web : les boutons de décision d'une
 *     alerte froid étaient MORTS (on cliquait, rien ne se passait) ;
 *   - la caméra ne scannait strictement RIEN sur le web, faute de `BarcodeDetector` ;
 *   - l'en-tête HTTP `Date` n'est pas dans la liste blanche CORS : l'application n'aurait jamais
 *     appris l'heure du serveur, et aurait refusé TOUS les lots portant une DLC.
 *
 * Et la démonstration se fait dans un navigateur.
 *
 * ⚠️ CE QUE CE SCRIPT NE FAIT PAS. Il ne re-teste pas la logique de l'application : c'est le travail
 * de la suite Jest, qui le fait mieux. Une première version cherchait « Impossible de vérifier la
 * péremption » sur les écrans de transformation et d'expédition — un FAUX TEST : ces écrans
 * n'affichent un lot qu'après un scan, le message n'apparaissait donc jamais, et la vérification
 * restait verte même avec le bug réintroduit. Un test qui ne peut pas échouer ne protège de rien.
 *
 * Ce script vérifie UNIQUEMENT les hypothèses que le navigateur, lui seul, peut confirmer ou
 * démentir. Le reste est couvert par Jest (`api.test.ts` : « apprend l'heure depuis le CORPS »).
 *
 * Prérequis, une fois :  npx playwright install chromium
 * Lancement :            npm run e2e:web
 *   API sur :3000 et Expo web sur :8081 par défaut ; sinon E2E_API / E2E_WEB.
 */
import { chromium } from 'playwright';

const WEB = process.env.E2E_WEB ?? 'http://localhost:8081';
const API = process.env.E2E_API ?? 'http://localhost:3000';
const EMAIL = process.env.E2E_EMAIL ?? 'first.admin@nutrichain.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'NutriChain!2026';

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => {
  console.error(`  ❌ ${m}`);
  failed += 1;
};

async function signIn(page) {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const email = page.locator('input[type="email"], input[placeholder*="mail" i]').first();
  if (!(await email.count())) return;

  await email.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page
    .locator('div[tabindex]')
    .filter({ hasText: /connexion|se connecter/i })
    .first()
    .click();
  await page.waitForTimeout(7000);
}

/**
 * L'HYPOTHÈSE : l'application peut lire l'heure du serveur depuis un navigateur.
 *
 * L'en-tête `Date` ne suffit PAS — la liste blanche CORS n'expose que `content-type` et
 * `content-length`, donc JavaScript ne le voit pas. C'est le corps de `/api/health` qui porte
 * l'heure. Sans elle, la garde de péremption est aveugle et refuse tout lot daté.
 *
 * Aucun test unitaire ne peut valider ça : il faudrait un vrai navigateur et un vrai serveur.
 */
async function verifierHorlogeLisible(page) {
  console.log("\n[1] L'heure du serveur est lisible DEPUIS UN NAVIGATEUR");

  const vu = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/health`);
    const body = await response.json();
    const exposes = [];
    response.headers.forEach((_, nom) => exposes.push(nom));
    return { entete: response.headers.get('date'), corps: body?.data?.timestamp, exposes };
  }, API);

  console.log(`  en-têtes exposés par CORS : ${vu.exposes.join(', ')}`);

  if (!vu.entete) {
    ok("l'en-tête `Date` est bien invisible — c'est pourquoi on ne s'y fie pas.");
  } else {
    console.log('  ℹ️ l’en-tête `Date` est exposé sur cette API. Tant mieux, mais on n’en dépend pas.');
  }

  if (typeof vu.corps !== 'string' || !Number.isFinite(Date.parse(vu.corps))) {
    fail("`/api/health` ne porte plus d'horloge dans son corps : la garde de péremption est aveugle.");
    return;
  }

  const ecartSecondes = Math.round((Date.parse(vu.corps) - Date.now()) / 1000);
  ok(`l'heure est lue dans le corps de /api/health (écart avec cette machine : ${ecartSecondes} s).`);
}

/**
 * L'HYPOTHÈSE : `navigator.onLine` ment.
 *
 * Il vaut `true` sur un Wi-Fi sans Internet, derrière un portail captif, ou face à une API éteinte.
 * Le badge ne doit pas s'y fier : la seule question qui compte est « le serveur répond-il ». Ici
 * encore, seul un vrai navigateur peut le démontrer.
 */
async function verifierBadgeReseau(page, context) {
  console.log('\n[2] Le badge réseau ne croit pas `navigator.onLine` sur parole');

  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  if (/En ligne/.test(await page.locator('body').innerText())) {
    ok('« En ligne » quand le serveur répond.');
  } else {
    fail('le badge ne dit pas « En ligne » alors que le serveur répond.');
  }

  await context.route('**/api/health**', (route) => route.abort());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);

  const body = await page.locator('body').innerText();
  const seCroitEnLigne = await page.evaluate(() => navigator.onLine);

  if (!seCroitEnLigne) {
    console.log('  ℹ️ le navigateur se dit hors ligne : le test perd son sens, on ne conclut pas.');
  } else if (/Hors ligne/.test(body)) {
    ok('« Hors ligne » alors que `navigator.onLine` vaut TRUE — le badge interroge le serveur.');
  } else if (/En ligne/.test(body)) {
    fail("le badge annonce « En ligne » alors que l'API ne répond pas.");
  } else {
    fail('badge introuvable.');
  }

  await context.unroute('**/api/health**');
}

async function main() {
  console.log(`[E2E WEB] ${WEB} → ${API}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 420, height: 950 } });
  const page = await context.newPage();

  try {
    await signIn(page);
    await verifierHorlogeLisible(page);
    await verifierBadgeReseau(page, context);
  } finally {
    await browser.close();
  }

  console.log(
    failed === 0
      ? '\n✅ E2E web OK.'
      : `\n❌ ${failed} vérification(s) en échec — un défaut invisible aux tests unitaires.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
