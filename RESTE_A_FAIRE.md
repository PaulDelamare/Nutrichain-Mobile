# Reste à faire — NutriChain

Liste vivante. **On l'augmente à chaque fois qu'on trouve quelque chose**, on coche quand c'est
fait ET vérifié (test vert + constaté à l'écran ou en base). Rien ne se coche parce que le code
est écrit.

Chaque ligne dit **la conséquence concrète** du manque, pas seulement son intitulé : une entrée
sans conséquence n'a rien à faire ici, elle ne sert qu'à se rassurer.

Base : audit multi-agents du 11/07/2026 (49 agents, 30 constats bruts → 18 trous réels après
vérification adversariale), **revérifié le 12/07**, **mis à jour le 13/07 au soir** — sauf mention
contraire, tout ce qui suit est encore ouvert aujourd'hui.

**Verdict global : l'API est plus complète que les interfaces.** Le patron qui revient sans cesse :
_la donnée est indispensable au métier, mais personne ne peut la créer_ ; et _l'endpoint existe,
mais personne ne l'appelle_.

---

## 0. État au 13/07/2026 (soir) — **0 PR ouverte sur les 3 dépôts**

Tout est mergé. Ce qui a été livré le 13/07 (et qui coche des lignes plus bas) :

- **Purge des données fabriquées** (front #13) — cf. §1 et §8.5, **fermé**.
- **Historique complet du lot** + frise (API #56/#57, front #15) — cf. §2, **fermé**.
- **Falsification d'identité sur la réception** (API #58) — cf. §8.1, **partiellement fermé**.
- **Barrière qualité de sortie d'usine** (API #60, front #16, mobile #22) — cf. §1, **fermé**.
- **Clé API durcie** (API #59, autre instance) — cf. §8.1, **fermé**.
- **Seed par rôle + rejouable** (API #55, puis #60) — cf. §8.4 et §8.7, **fermé**.

---

## 1. 🔴 Bloquant avant la soutenance

- [x] **Le front ment sans jamais planter — les mocks passent dans la branche `source:'api'`.**
      `rappels-produits`, `chaine-du-froid`, `tableau-de-bord` et `/integrations` injectent des
      données fabriquées **dans la branche succès** de l'appel API, ce qui désactive le bandeau
      « données de démonstration ». Sur une base saine sans rappel en cours, le jury voit un faux
      « RAP-2025-014 — 78 % de confirmations » **présenté comme réel, sur la page cœur du livrable**,
      et des connecteurs « SAP S/4HANA / WMS Reflex / TMS » entièrement inventés.
      _Conséquence : une donnée fausse, crédible, sans crash. Une seule question « c'est branché sur
      quoi ? » et toute la démo perd sa crédibilité, y compris ce qui est vrai._
      → Purger les mocks, états vides honnêtes à la place. **~1-2 h. FRONT.**

      ✅ **FAIT le 13/07** — front #13 : `src/lib/data/*`, `loadApiOrMock` et le champ `source` SUPPRIMÉS. La classe de bug est fermée, pas contournée. Vérifié à l'écran sur les 8 pages.

- [ ] **Multi-tenancy : la transformation ne vérifie pas l'organisation de `id_materiel`.**
      Le produit fini et chaque lot parent sont contrôlés ; la cuve, non — elle part telle quelle
      dans `batch.create` et dans le `readPoint` EPCIS.
      _Conséquence : un lot **produit fini** peut être rattaché au frigo d'un autre tenant et
      **échappe alors définitivement à la quarantaine automatique** (le filtre IoT croise
      `organization_id` + `id_materiel_actuel` : aucune des deux orgs ne correspond)._
      → Ajouter le `findFirst({ id, organization_id })` qui existe déjà côté réception. **API.**

- [x] **Barrière qualité de sortie d'usine : inexistante.** Trois pièces du même engrenage :
      le lot enfant d'une transformation naît **`EN_STOCK`** au lieu de quarantaine (donc
      immédiatement expédiable, **sans aucun contrôle**) ; `QualityControl` **n'est créable nulle
      part** (le rôle `quality` n'a aucune action de saisie dans tout le système) ; et les alertes
      ne sont clôturables par aucune UI web.
      _Question jury garantie : « qui valide le produit fini avant expédition ? » → personne._
      → 1 ligne pour le statut ; `POST /organization/quality-controls`. **API + FRONT.**

      ✅ **FAIT le 13/07** — API #60 + front #16 + mobile #22. Statut `EN_ATTENTE_QC` (bloquant) ; `POST /organization/quality-controls` ; le contrôle pilote le statut du lot. ⚠️ Table d'états stricte : un contrôle conforme ne libère JAMAIS un lot sous rappel. Prouvé par `npm run e2e:quality-gate`.

- [ ] **`Location` et `Supplier` ne sont créables nulle part** (aucun endpoint d'écriture).
      _Conséquence, deux fois : `POST /organization/equipment` exige un lieu → **toujours 400** sur
      une org neuve, le correctif matériel est mort-né hors seed. Et la réception exige un
      fournisseur → **aucune réception possible** → pas de lot → pas de généalogie → pas de rappel.
      Cul-de-sac total._
      → Dupliquer le patron `equipment.service.ts` (~70 lignes). **API (+ écran, cf. §3).**

- [ ] **`Equipment.temp_actuelle` est affiché par le front mais écrit par PERSONNE.** Le ping IoT
      n'écrit que dans MongoDB.
      _Conséquence : en démo, le frigo en excursion affichera **3,2 °C pendant l'alerte PANIC**. On
      montre l'alerte et la quarantaine **sans jamais afficher la température coupable** — sur
      l'écran phare de l'objectif SMART n°2._
      → 5 lignes après le `TelemetryModel.create`. **Trivial. API.**

- [ ] **La vitrine GS1/EPCIS est indémontrable.** Le seed démo écrit en direct via `prisma.*.create`
      en contournant les services → **zéro `EPCIS_Event`, zéro `Receipt`** : magasin d'événements
      vide et export CSV réduit à sa ligne d'en-têtes. `GET /traceability/events` n'a aucun
      consommateur. Et `GET /public/scan/:id` — la route consommateur, soignée — **n'a aucune page
      en face** : le QR renvoie du JSON brut.
      _Conséquence : l'argument central du projet (traçabilité GS1) et la partie prenante B2C du
      cahier des charges n'ont aucune surface visible. Le travail est fait, rien ne le prouve._
      → Semer les événements (ou mieux : faire appeler les services par le seed) + page `/evenements` + page publique `/scan/[id]`. **API (seed) + FRONT.**

## 2. 🟠 Important — si le temps le permet

- [ ] **Un lot ne peut JAMAIS changer d'emplacement.** `id_materiel_actuel` n'est écrit qu'à la
      création. Aucun `move`, et le `qr_code_id` du matériel n'a **aucun lecteur**.
      _Conséquence : la quarantaine automatique filtre sur une position qui cesse d'être vraie dès
      le premier déplacement réel (quai → chambre froide → production) : faux négatifs sanitaires
      ET faux positifs._ Non bloquant en démo (on place le lot dès la réception). **API + mobile.**

- [ ] **Étiquettes QR non imprimables.** Les endpoints `label` (lot et matériel) renvoient un PNG et
      n'ont **aucun appelant**. Or le mobile ne peut renseigner l'emplacement d'un lot **que** par
      scan de l'étiquette du frigo.
      _Conséquence : la boucle « je crée un frigo → j'imprime → je scanne » ne fonctionne pas._
      **Petit. FRONT.**

- [ ] **Réceptions : aucun lien Batch ↔ Receipt ↔ Supplier.** Le service crée la réception puis le
      lot dans la même transaction **sans jamais les relier** (pas de clé étrangère).
      _Conséquence : le récit « je remonte du produit fini jusqu'à la ferme » **s'arrête au lot de
      lait cru**. La maquette du cahier des charges montre pourtant « AMONT — Lait cru — Ferme Les
      Aubépines »._ **API + FRONT.**

- [x] **`Batch_Mouvement` n'est pas écrit à la réception, ni aux quarantaines, ni au rappel** (que
      sur transformation et expédition).
      _Conséquence : **un lot reçu et non transformé a un historique VIDE** à l'écran, et une
      quarantaine IoT ou un rappel n'y laisse aucune ligne — c'est exactement le scénario de démo._
      (Nuance : l'audit WORM et les EPCIS sont bien écrits ; c'est l'historique **matière** affiché
      qui est incomplet.) → 3 lignes × 4 endroits. **API.**

      ✅ **FAIT le 13/07** — API #56/#57. RECEPTION, QUARANTAINE_FROID (avec la CAUSE), LEVEE_QUARANTAINE (motif), RAPPEL, CONTROLE_QUALITE. Frise sur la fiche lot (front #15). ⚠️ Non rétroactif : les lots créés avant n'ont pas de trace.

- [ ] **Chaîne du froid sans courbe.** `GET /telemetry/:sensor_id/history` n'est affiché nulle part.
      _Conséquence : la démo la plus spectaculaire (pic → alerte → lot bloqué) ne montre **que
      l'effet, jamais la cause**._ Quasi gratuit : le `sensor_id` est déjà renvoyé. **FRONT.**

- [ ] **Rebut : impossible de sortir un lot du stock.** `ScrapRecord` n'a aucune occurrence, et un
      lot rappelé (statut `ALERTE`) ne peut plus être ni transformé, ni expédié, ni levé de
      quarantaine → **cul-de-sac définitif**, sa quantité reste aux livres indéfiniment.
      _« Que deviennent les lots rappelés ? » → aucune preuve de destruction opposable à la
      DGCCRF._ **API.**

## 3. Rôles et création de données — le modèle qu'on doit tenir

Le modèle voulu : **un admin a la main sur SON organisation** (ses matériels, emplacements,
fournisseurs, clients, produits) **mais ne crée pas d'autres organisations** — ça, c'est au-dessus
de lui.

Vocabulaire canonique de l'API, un rôle par membre : `owner` > `admin` > `quality` > `operator` >
`viewer`. Les décisions qualité (levée de quarantaine, résolution d'alerte) **excluent
l'opérateur** : séparation des tâches HACCP — celui qui réceptionne ne valide pas sa propre
marchandise.

- [x] **Créer un matériel** : endpoint gardé par `ADMIN_ROLES`. Un opérateur reçoit 403. Conforme.
- [ ] **Créer un emplacement, un fournisseur, un client, un produit** : **aucun endpoint** (cf. §1).
      À créer, gardés par `ADMIN_ROLES` comme le matériel.
- [ ] **Créer une organisation : ça n'existe nulle part.** La toute première inscription crée
      l'unique org « Siège Central NutriChain » et fait de son auteur un `owner` ; tous les autres
      doivent être **invités** dans une org existante. Il n'y a **aucun rôle au-dessus de
      l'organisation** — l'« admin général » n'existe pas dans le code, et une deuxième organisation
      ne peut naître que par le seed.
      **Décision à prendre** : rôle système + endpoint de création d'org, **ou** assumer « une
      organisation = un déploiement » et le dire au jury. Ne pas le laisser trouver le trou.
- [ ] **Aucun écran de configuration** (ni mobile, ni front) : même quand l'endpoint existe, le
      matériel se crée aujourd'hui en appelant l'API à la main. UNE page `/configuration` (lieu,
      fournisseur, matériel + import CSV) fermerait aussi plusieurs trous du §1 et du §2. **FRONT.**
- [ ] **Rejouer les parcours avec CHAQUE rôle.** Le seed connecte un `owner`, qui a tous les droits :
      **il masque tous les 403**. Tant qu'un `operator` n'a pas été testé sur la réception (autorisée)
      et sur la levée de quarantaine (refusée), on ne _sait_ pas que le cloisonnement tient.

## 4. Mobile — bugs constatés

- [ ] **Réception : les puces sont coupées au bord droit.** Fournisseur, Produit et Contrôle sont
      dans un défilement horizontal : la dernière option est tranchée et rien n'indique qu'il faut
      faire défiler. L'opérateur peut croire que la liste s'arrête là.
- [ ] **Réception : l'unité apparaît deux fois, « kg » et « KG ».** Les deux existent réellement en
      base (cf. §5) et remontent telles quelles des produits.
- [ ] **« Des boutons passent devant le menu » (Yoann).** Pas encore reproduit : **il me faut l'écran
      exact**. Probablement un bouton de bas de formulaire qui passe sous la barre d'onglets.
- [ ] **« Un bouton a disparu » (Yoann).** **Non confirmé** : `git log` montre que l'accueil a
      toujours eu les deux mêmes actions rapides depuis sa création. À préciser.

## 5. Mobile — manques fonctionnels

- [ ] **Parsing GS1 des codes scannés.** Le code part brut dans un champ texte. Un datamatrix GS1
      porte le GTIN (AI 01), le n° de lot (AI 10) et la DLC (AI 17) : tant qu'on ne les décode pas,
      **le scan ne remplit pas le formulaire tout seul** — ce qui est pourtant sa raison d'être.
- [ ] **Écran Quarantaine.** `GET /organization/quarantine-batches` n'a aucun appelant. Couvert
      seulement en partie par l'écran d'alerte de Yoann (on n'y voit que les lots bloqués **par une
      alerte froid**, pas ceux bloqués par un contrôle qualité).
- [ ] **Build APK (EAS)** pour démontrer sur un vrai téléphone : le web ne prouve ni la caméra, ni
      le hors-ligne.
- [ ] **TTL du cache catalogue.** Le cache n'expire jamais : un produit retiré du catalogue reste
      proposé indéfiniment sur un téléphone non resynchronisé. Dette connue, non bloquante.
- [ ] **Idempotence de la transformation.** L'endpoint n'a **aucune clé** : si le réseau coupe
      pendant l'envoi, le serveur peut avoir commité sans que le mobile le sache. Mitigé côté mobile
      (on annonce un statut _inconnu_, jamais un échec), mais la vraie correction est un
      `client_op_id` côté API, comme pour la réception.
- [ ] **`shipment_id` est `@unique` globalement**, pas par organisation : une org ne peut pas
      réutiliser un n° de transport qu'une autre a pris. **API.**
- [ ] **La table `Unit` contient à la fois `kg` et `KG`**, et `VALID_UNITS` référence des unités
      (`G`, `ML`, `UNIT`, `PALLET`, `BOX`) **absentes de la table** → erreurs de clé étrangère
      possibles. C'est la cause du doublon visible à la réception. **API.**

## 6. ⚪ Assumé — à expliquer au jury plutôt qu'à coder

- **Garde-fou de bilan matière (`RecipeComposition`)** — rien n'empêche de déclarer 1000 L de yaourt
  à partir de 1 L de lait. Le modèle est **inexploitable en l'état** (pas d'`organization_id`, et
  l'ingrédient ne référence aucune table). _Discours : « modélisé, implémentation en V2 — nous
  n'avons pas voulu livrer une version fausse. »_
- **Maintenance / hygiène HACCP** — table 100 % morte. On peut transformer dans une cuve jamais
  nettoyée. Aucune règle existante n'en dépend. _Discours : extension V2 — **et la retirer de l'ERD
  projeté**, ou l'y marquer hors périmètre. Un jury pardonne un périmètre assumé, pas une table
  fantôme._
- **Historique thermique du camion** — jamais écrit, aucun canal d'entrée ; `statut_controle` est
  **déclaré par le client** et recopié tel quel. _Nuance : le blocage fonctionne, c'est la preuve
  thermique qui manque. Si on a une heure : `detectExcursion()` est **déjà écrite et testée**, il
  suffit de l'appeler._
- **`PerformanceStat`** — table morte, aucun enjeu. À retirer de l'ERD.

## 7. Soutenance / livrables

- [ ] DPIA
- [ ] SIEM
- [ ] Dashboards
- [ ] Top 5 des risques
- [ ] Livret SCRUM

Référence : `Documents/PLAN_SOUTENANCE.md` et `FICHE_APPRENTISSAGE_NUTRICHAIN.md` (dépôt API).

- [ ] **Aucun support d'oral, aucune répétition chronométrée.** 30 min d'exposé + 30 de questions,
      **sans filet si la démo casse**, alors que la soutenance vaut **15 %** — autant que toute la
      CI/CD. La matière existe (`docs/20_DOSSIER_SOUTENANCE.md`, scénario en 12 étapes) : c'est du
      montage, pas de la création.
- [ ] **Le tableau des KPI n'est pas au format demandé.** Le barème (L1, item 3) exige
      **Baseline → Cible M6 → Cible M12** pour 6-8 KPI. Le nôtre a d'autres colonnes et aligne
      ~25 KPI. « Cadrage & choix » vaut **20 %** de la note : un correcteur coche « format non
      conforme » sur un livrable par ailleurs solide, **pour deux colonnes manquantes**. ~30 min,
      zéro ligne de code. **Le meilleur ratio du projet.**
- [ ] **Le dossier de soutenance coche ✅ des objectifs non atteints** : « Auth + MFA + contrôle
      d'accès » (ni OIDC, ni MFA obligatoire, ni ABAC — 2 tiers sur 3 manquent), « Alerte < 30 s p95 »
      et « scan rapide » (les scripts invoqués **ne chronomètrent rien**), « CI/CD industrielle »
      (cf. §8.3). Le ✅ est ce qui attire l'œil du jury. **Dégrader ces lignes en « partiel »**, et
      assumer à l'oral.

---

## 8. Audit du 12/07 — 26 trous qui n'étaient pas dans cette liste

Second audit multi-agents (8 angles, chaque trouvaille passée devant un agent chargé de la
**réfuter**). Ce qui suit était absent de tout ce qui précède.

### 8.1 🔴 La vraie clé API est dans git, et cette clé contourne TOUS les contrôles de rôle

**Vérifié à la main.** La clé de 64 caractères est commitée dans `.env.example` sur `origin/develop`
— **identique** à celle de l'API, du mobile (donc en clair dans le bundle) et du front (`VITE_…`,
donc livrée au navigateur). Et dans `mixedAuth.ts` :

```ts
if (req.headers["x-api-key"] && !hasUserSession(req)) {
  return checkApiKey()(req, res, ensureOrg); // allowedRoles n'est JAMAIS évalué
}
```

_Conséquence : un `git clone` + un `curl`, **sans aucun compte**, permet d'écrire des réceptions,
des expéditions, des scans, des trames capteur, et de lire l'annuaire nominatif des salariés (donnée
personnelle → enjeu DPIA). C'est borné à l'organisation de la clé — pas de cross-tenant — mais c'est
exploitable en trente secondes, et c'est la réponse à « où sont vos secrets ? »._
→ Refuser la branche clé API quand `allowedRoles` n'est pas vide ; régénérer la clé ; `.env.example`
factice. **API + INFRA. ~1 h.**

C'est aussi ce qui rend **`received_by` encore falsifiable** en mode clé (le `member.findFirst` du
module sync, qui fait le bon contrôle, n'a jamais été copié dans la réception ni l'expédition).

### 8.2 🔴 La chaîne d'audit WORM peut se rompre — devant le jury

L'écriture n'est pas sérialisée : le `SELECT … FOR UPDATE` verrouille la _dernière ligne existante_,
il n'empêche pas un INSERT concurrent de lire le même maillon. Aucun index unique sur
`(organization_id, prev_hash)`, aucune reprise sur erreur de sérialisation, aucun test de
concurrence. Pire : la création de matériel journalise **hors transaction**.

_Conséquence : un ping IoT pendant une synchronisation, et la chaîne **forke définitivement** → le
bouton « vérifier l'intégrité de l'audit », qu'on a mis au front, affiche **« chaîne rompue »**, sur
l'objectif 7, sans réparation possible (c'est du WORM)._
→ Verrou consultatif par organisation + reprise + la transaction manquante. **API. Petit.**

### 8.3 🔴 Rien n'est déployé, et les portes de qualité de la CI sont fictives

- Le seul pipeline qui monte une base, applique les migrations et **build** se déclenche sur `main`
  — **morte depuis le 13 avril**. Le tronc réel est `develop`, où la CI s'arrête à lint + tests :
  **ni build, ni `tsc`, ni migrations**. Une erreur de typage se merge en vert.
- Les seuils de couverture à 70 % (« la CI échoue en dessous », dit le Readme) ne s'appliquent
  qu'avec `--coverage`, **jamais passé**. Le garde-fou n'existe pas.
- `npm test` dans l'API répond `Error: no test specified` — sur un projet dont la stratégie de test
  est un critère du barème.
- Les **11 scripts e2e** (dont `e2e-recall-impact`, exactement le test bout-en-bout exigé par le
  cahier des charges) ne sont lancés par **aucun** workflow.
- Aucun environnement déployé, aucune URL, aucun rollback. Or le dossier coche « CI/CD
  industrielle ✅ ».

_Conséquence : « Montrez l'environnement, quel commit tourne, comment vous revenez en arrière ? » —
sans réponse, sur une ligne cochée._

### 8.4 🔴 Aucun compte `operator` / `quality` / `viewer` n'existe, et on ne peut pas en créer

Le seed crée **un seul** utilisateur, **sans mot de passe** (aucune ligne `Account`) : il ne peut
même pas se connecter. Le seul chemin d'inscription passe par une invitation dont le mail part vers
une boîte factice, dont le front **jette le jeton**, et qu'aucune route ne permet de relister.

_Conséquence : le « rejouer les parcours avec chaque rôle » du §3 est **matériellement impossible**.
« Connectez-vous en opérateur » → il n'y a pas de compte opérateur._
→ Trois `upsert` avec une ligne `Account` dans le seed. **API. 30 min — et ça débloque trois autres
trous.**

### 8.5 🔴 La purge des mocks prévue au §1 ne suffira pas : les faux chiffres sont dans les _mappers_

Le « 78 % de confirmations » n'est **pas** dans les fichiers de mock : il est écrit en dur dans le
mapper des **données réelles** (`progress: a.statut === 'ACTIVE' ? 78 : 100`). Idem pour le brief du
Portail magasins et une étape fantôme de l'arbre de traçabilité.

_Conséquence : supprimer `src/lib/data/*` **compile parfaitement** et laisse tout en place. Le jour J,
un rappel réellement déclenché affichera encore « Retrait rayon — 78 % », **sous le bandeau « données
issues de la base »**. Le vrai périmètre de purge est `mappers.ts`._

Et le badge **« 3 alertes froid » du header est une valeur par défaut en dur**, affichée sur **toutes
les pages, en permanence** — avant comme après l'excursion. Ce n'est pas un mock de page : la purge
prévue ne l'enlèvera pas.

### 8.6 🔴 Aucun lot reçu n'a de date de péremption → la garde « lot périmé » est du code mort

Le champ n'existe ni dans le formulaire mobile, ni dans le payload, ni dans le schéma de l'API. Or la
réception est le **seul** chemin de création de lot en production : **100 % des lots réels naissent
sans DLC** → on peut expédier ou transformer un lot périmé, en 200 OK. Les lots du seed, eux, ont une
DLC : **le trou est masqué en démo**. Le test qui « prouve » la garde fabrique lui-même la date.

→ **~2 lignes** dans `receipt.service.ts` (`Product.duree_conservation_defaut` existe, est seedé, et
n'est lu nulle part). **API.**

### 8.7 🔴 Le seed de démo n'est pas rejouable

Il purge par liste d'identifiants figée, alors que les clés étrangères sont en `RESTRICT`. Donc : je
répète, je crée un frigo, je relance `npm run seed:demo` → **erreur, seed mort**. Seule issue : tout
détruire (`prisma migrate reset`), commande documentée nulle part. Et le seed de base n'est pas
idempotent sur les produits : le lancer deux fois **double le catalogue** dans le sélecteur mobile.

### 8.8 🔴 Personne d'autre que toi ne peut démarrer le projet

Le Readme s'arrête avant `seed:demo` (**jamais cité dans aucun `.md`** — or sans lui, Traçabilité,
Chaîne du froid et Rappels sont vides). Les identifiants de connexion ne sont documentés nulle part.
Le seed crée un utilisateur **non connectable**, et toute inscription ultérieure est refusée en 403.
Deux scripts cités dans le code **n'existent pas** dans `package.json`.

_Conséquence : un correcteur qui clone et suit le Readme obtient une base vide et **ne peut pas se
connecter**. Le livrable « projet reproductible » tombe._ → **DOCS. Trivial.**

### 8.9 🔴 La boucle du rappel ne se ferme jamais

Le barème du POC mobile exige « scan → vérifier le lot → **marquer le retrait** → synchro offline ».
« Marquer le retrait » n'existe **ni sur mobile, ni côté API, ni sur le portail magasins** (qui
n'affiche que deux compteurs, alors que le menu promet « confirmations »). Le cahier des charges pose
pourtant un KPI « taux de rappel complété > 90 % » : il n'a **aucune source de données**.

_« Et ensuite, le magasin fait quoi ? » → rien._ → **Gros.** _À défaut : l'assumer explicitement._

### 8.10 🟠 Les trous importants (résumé)

- **Aucune authentification des capteurs** : avec la clé (§8.1) et un `sensor_id`, on peut forger des
  trames → **bloquer tout le stock d'un frigo**, ou **noyer une vraie excursion** pour qu'aucune
  alerte ne parte. Les trames forgées sont conservées comme preuve.
- **Survoler « Déconnexion » déconnecte** (le préchargement SvelteKit exécute le `load`, qui révoque
  la session). Un `load` ne doit jamais muter l'état.
- **Le front ignore complètement le rôle** : même menu, mêmes boutons pour tous ; les décisions
  qualité répondent 403 en rouge, indistinguable d'un bug. La séparation des tâches HACCP existe en
  base et dans l'API, mais elle est **invisible, donc indémontrable**.
- **Comptes** : ni MFA enrôlable, ni révocation, ni changement de rôle, ni mot de passe oublié. Et
  **activer la 2FA — le geste exigé par le barème — verrouille le compte hors du front** (boucle de
  redirection silencieuse).
- **Aucun écran des réceptions ni des expéditions** : le siège ne voit jamais ce que le terrain
  scanne (fournisseur, quantité, contrôle) — pour deux endpoints finis et testés.
- **La liste des lots écrase 6 statuts en 3 pastilles** (un lot expédié reste « Conforme » en vert) et
  sa colonne « Dernière temp. » est **vide en dur**.
- **`statut_livraison` figé à `EN_ROUTE`** : au rappel, impossible de distinguer « encore dans le
  camion » de « déjà livré ». Et le KPI « expéditions en cours » ne peut que croître indéfiniment.
- **RGPD** : ni effacement, ni pseudonymisation, ni durée de conservation ; les IP sont journalisées
  sans expiration. **Le DPIA sera intenable** — il faudrait y écrire « conservation : indéfinie ».
- **Les allergènes n'existent nulle part**, alors que le cahier des charges les dit « obligatoires ».
  Le scénario de rappel le plus fréquent du secteur est structurellement inciblable.
- **Bouton « Exporter la liste »** (écran quarantaine) branché sur une fonction **vide**.
- **Le rappel produit se déclenche seul**, alors que l'énoncé exige une **double validation
  Qualité + Direction**. L'action la plus irréversible du système est à un clic d'un seul utilisateur.

### 8.11 🟠 Mobile (à moi)

- [ ] **La déconnexion ne purge pas la base SQLite** → sur un terminal partagé, la file de scans de
      l'opérateur A **part sous l'identité de B**, en base et dans l'audit WORM. C'est exactement la
      falsification du §8.1, réintroduite par le mobile. **Petit — et grave.**
- [ ] **Un 403 est classé comme une panne réseau** → la réception d'un `quality` ou d'un `viewer`
      (rôles qui n'ont pas le droit d'écrire) reste « En attente » **à l'infini**, ni remédiable ni
      supprimable, et retape l'API toutes les 30 minutes pour l'éternité — pendant que l'écran lui
      affiche « sera synchronisée dès que le réseau reviendra ». **Le mobile ment.**
- [ ] **Caméra refusée définitivement** : le bouton « Autoriser l'accès » devient un **no-op
      silencieux** (`canAskAgain` n'est jamais lu, aucun renvoi vers les réglages).
- [ ] **Scanner un lot existant ouvre un formulaire de réception** : le geste le plus évident de la
      démo n'affiche jamais la fiche du lot. _(Nécessite aussi un endpoint de recherche de lot par
      code, qui n'existe pas.)_
- [ ] **Choisir « ALERTE » ou « NONCONFORME » à la réception met le lot en quarantaine sans le
      dire** — décision sanitaire lourde, irréversible depuis le terrain, déclenchée par une puce
      anodine. _(Et `CONFORME` est une quatrième valeur pour trois états, qui ne sert à rien.)_

---

## Fait et vérifié

- [x] Chaîne de synchronisation hors-ligne complète (file SQLite, `clientOpId`, 207 Multi-Status,
      backoff, remédiation) — prouvée en base.
- [x] Réception avec emplacement du lot (double scan : le lot, puis le frigo).
- [x] Création de matériel + étiquette QR (`POST /organization/equipment`, `GET .../label`).
- [x] Authentification mobile — la fuite **inter-organisation** par `x-api-key` corrigée à la
      racine. _(Le contournement de rôle **intra-organisation**, lui, reste entier : cf. §8.1.)_
- [x] Décision d'alerte froid sur mobile (Yoann, PR #12).
- [x] CI mobile : lint, typecheck, tests **et build** — c'est le build qui avait rattrapé
      l'application qui ne démarrait plus.

### Deux lignes décochées le 12/07 — elles étaient fausses

- [ ] ~~« `received_by` n'est plus falsifiable »~~ — **faux**. Corrigé sur le chemin _session_
      uniquement. En mode clé API il n'y a pas de `req.auth.user`, donc **l'auteur retombe sur le
      corps de la requête**, et le service ne vérifie que l'_existence_ de l'utilisateur, jamais son
      appartenance à l'organisation. L'identité scellée dans l'audit WORM reste choisie par le
      client. Voir §8.1.
- [ ] ~~« l'audit WORM et les EPCIS sont bien écrits »~~ — **à ne plus tenir pour acquis** : la
      chaîne d'audit n'est pas sérialisée et n'a aucune contrainte en base. Voir §8.2.

---

## 10. Le scan — livré le 14/07, et ce qu'il a mis au jour

**Fait et vérifié** (API #62, #64 + mobile #24) : scanner un lot déjà reçu ouvre **sa fiche**, plus
un formulaire de réception. Vu à l'écran contre la vraie base.

_Le fait qui commandait tout : **l'étiquette d'un lot imprimée par NutriChain n'encode pas son
numéro, mais une URL GS1 Digital Link** (`…/gs1/01/{gtin}/10/{lot}`). Aucun code scanné n'était donc
résoluble. « Scanner → fiche du lot » et « parsing GS1 » n'étaient pas deux chantiers : c'était le
même._

- [x] **La réception jetait le numéro de lot du fournisseur** (le serveur en générait un) → la même
      palette rescannée était un lot **inconnu à jamais**, donc réceptionnée deux fois,
      indéfiniment. (API #62.)
- [x] **Aucun lot reçu n'avait de DLC** → la garde « lot périmé » était du code mort. Repli sur
      `Product.duree_conservation_defaut`, qui existait et n'était lu nulle part. (API #62 — ferme
      le §8.6.)
- [x] **Résoudre un lot par son numéro** : `GET /logistics/batches/resolve`. (API #64.)
- [x] **Le mobile décode le code scanné** (`src/lib/gs1.ts`) et l'étiquette d'un **matériel**
      (`EQP-…`) n'ouvre plus une réception. (Mobile #24.)

### 10.1 🔴 Ce qui reste ouvert sur le scan

- [ ] **Au-delà de 100 lots, la transformation et l'expédition MENTENT.** Elles résolvent le code
      **localement**, contre `GET /traceability/batches` — plafonné à `take: 100` côté serveur, sans
      pagination ni recherche par numéro.
      _Conséquence : un lot d'ingrédient à longue conservation (sucre, poudre de lait) créé il y a
      plus de 100 lots est annoncé **« Lot inconnu — ce code ne correspond à aucun lot de votre
      organisation »** devant le camion. C'est faux : le lot existe, il est en stock, son étiquette
      est bonne. Et l'onglet Scan, lui, le trouve (il interroge le serveur). **Même étiquette, deux
      réponses contradictoires selon l'écran.**_
      → Replier sur `resolveBatch()` (qui existe déjà) quand la liste locale ne donne rien. **MOBILE.**

- [ ] **La saisie manuelle est INACCESSIBLE tant que la caméra n'est pas autorisée.** L'écran de
      permission remplace *tout* le contenu de l'onglet Scan.
      _Conséquence : la saisie manuelle est le recours prévu quand le code est abîmé ou givré — mais
      un opérateur qui a refusé la caméra ne peut même pas taper un numéro. L'app est morte pour
      lui._ (Constaté en pilotant l'écran, pas par un test.) À traiter avec le trou `canAskAgain`
      du §8.11. **MOBILE.**

- [ ] **Le code scanné part encore brut dans le champ « N° d'expédition (SSCC) »** quand le lot est
      inconnu : une URL Digital Link de 60 caractères y atterrit. Le GTIN, le numéro de lot et la
      DLC sont **décodés puis jetés**, alors que l'API accepte `lot_number` et `date_peremption`
      depuis #62. → Pré-remplir la réception. **MOBILE.**

---

## 9. ⏯️ REPRENDRE ICI — 14/07/2026

### 9.1 🔵 Décisions qui attendent Paul (bloquantes pour la suite)

- [ ] **La séparation des tâches HACCP n'est PAS tenue.** `owner` et `admin` sont à la fois dans
      `WRITE_ROLES` (ils transforment) et dans `QUALITY_ROLES` (ils valident) : ils peuvent donc
      **valider leur propre production**. La barrière qualité a été livrée en le revendiquant —
      c'était faux.
      _Deux issues : l'assumer devant le jury (« axe d'amélioration »), ou refuser qu'un contrôle
      soit signé par l'auteur de la transformation (~4 lignes dans la même transaction)._
- [ ] **`/integrations`** : la page a un état vide honnête. **Décision de Paul : la brancher sur le
      vrai module `connectors`** de l'API (import CSV produits/clients + export EPCIS). À faire.
- [ ] **Le dossier `nutrichain-api-wt-histo`** est abîmé (worktree supprimé à moitié) et inutile.
      **Ne pas le supprimer sans l'accord de Paul.**

### 9.2 🔴 Le meilleur rapport effort/effet qui reste

- [ ] **`Equipment.temp_actuelle` n'est écrite par PERSONNE** (le ping IoT n'écrit que dans Mongo).
      _Conséquence : en démo, le frigo affiche **3,2 °C pendant l'alerte PANIC**. On montre l'alerte
      et la quarantaine **sans jamais afficher la température coupable** — sur l'écran phare de
      l'objectif SMART n°2._ **~5 lignes. API.** ← _le meilleur coup suivant_

### 9.3 Trous découverts le 13/07 (nouveaux)

- [ ] **`resolveLotMapLocation` fabrique des coordonnées GPS** par regex sur le NOM du site
      (« Loire » → pin de Nantes), et les marque **`precise: true`**. Le pin de la fiche lot est
      donc inventé, sous un bandeau « Données en direct depuis la base ». **PR séparée (décision
      Paul). FRONT (+ API si on veut de vraies coordonnées sur `Location`).**
- [ ] **Le panneau « Lots en quarantaine » affiche l'UUID brut** du lot au lieu de son numéro :
      `GET /organization/quarantine-batches` ne renvoie pas `lot_number`. **Petite PR API.**
- [ ] **L'historique n'est pas rétroactif** : les lots créés avant le 13/07 n'ont aucune trace de
      réception. Pour une démo propre, **recevoir un lot neuf** (ou reseeder).

### 9.4 ⚠️ Pièges d'environnement (vécus, coûteux)

- **`tsx` sans `watch` garde le code en mémoire.** Après un merge/rebase, **REDÉMARRER l'API** —
  sinon on teste l'ancien code. _Vécu : le bug d'horodatage semblait non corrigé alors que le
  correctif était mergé ; deux heures d'écart affichées sur la frise, pour un serveur périmé._
- **La clé API a été TOURNÉE** (API #59). Les trois `.env` doivent être alignés. Le front l'a été
  (sauvegarde `.env.bak`) ; **vérifier le mobile**.
- **Les scripts e2e écrivent dans la base de DEV.** Un run planté a laissé **2008 lots** dans la
  base de démo (purgés après accord de Paul). **Toujours vérifier `prisma.batch.count()` après un
  e2e.**
- **Les tests unitaires mockent `$queryRaw`** : ils ne prouvent RIEN sur le SQL. Seuls les e2e le
  font.

### 9.5 🧭 La méthode qui a payé (ne pas la lâcher)

**Faire RÉFUTER le plan AVANT d'écrire une ligne.** Le 13/07, sur trois plans successifs :

- la purge des mocks : mon plan **crashait 2 pages en 500** et **ratait la pire fabrication** (le
  donut qualité déclarait conformes tous les lots jamais contrôlés) ;
- l'historique du lot : mon plan pouvait **faire ROLLBACK un rappel produit** (plafond de 65535
  paramètres liés de PostgreSQL) — soit zéro lot bloqué, la pire issue sanitaire ;
- la barrière qualité : mon plan **annulait les rappels produits** (un contrôle conforme libérait un
  lot rappelé) **et ouvrait un trou dans la chaîne du froid** (le lot en attente échappait à
  l'excursion thermique).

**Trois prémisses fausses par plan, en moyenne.** Et l'écran trouve ce qu'aucun test ne donne :
le badge « 1 alertes », le décalage de +2 h, la réception affichée en vert alors qu'elle était non
conforme. ⚠️ **Un scanner automatique doit échouer bruyamment** : le mien a annoncé « aucun
mensonge détecté »… sur une page de connexion.
