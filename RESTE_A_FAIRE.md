# Reste à faire — NutriChain

Liste vivante. **On l'augmente à chaque fois qu'on trouve quelque chose**, on coche quand c'est
fait ET vérifié (test vert + constaté à l'écran ou en base). Rien ne se coche parce que le code
est écrit.

Chaque ligne dit **la conséquence concrète** du manque, pas seulement son intitulé : une entrée
sans conséquence n'a rien à faire ici, elle ne sert qu'à se rassurer.

Base : audit multi-agents du 11/07/2026 (49 agents, 30 constats bruts → 18 trous réels après
vérification adversariale), **revérifié le 12/07** — sauf mention contraire, tout ce qui suit est
encore ouvert aujourd'hui.

**Verdict global : l'API est plus complète que les interfaces.** Le patron qui revient sans cesse :
*la donnée est indispensable au métier, mais personne ne peut la créer* ; et *l'endpoint existe,
mais personne ne l'appelle*.

---

## 0. En attente de merge (plus rien à coder dessus)

- [ ] **`fix/tabbar-labels`** — libellés d'onglets rognés. Poussée, tests verts, vérifiée au rendu.
- [ ] **`docs/reste-a-faire`** — ce document.
- [ ] **`feat/transformation`** — transformation + expédition sur mobile. Poussée et verte, mais
      **jamais ouverte en PR**, et désormais **en conflit avec `develop`** (Yoann a créé de son côté
      un `src/lib/batches.ts` et étendu `alerts.ts`). À rebaser avant d'ouvrir.

---

## 1. 🔴 Bloquant avant la soutenance

- [ ] **Le front ment sans jamais planter — les mocks passent dans la branche `source:'api'`.**
      `rappels-produits`, `chaine-du-froid`, `tableau-de-bord` et `/integrations` injectent des
      données fabriquées **dans la branche succès** de l'appel API, ce qui désactive le bandeau
      « données de démonstration ». Sur une base saine sans rappel en cours, le jury voit un faux
      « RAP-2025-014 — 78 % de confirmations » **présenté comme réel, sur la page cœur du livrable**,
      et des connecteurs « SAP S/4HANA / WMS Reflex / TMS » entièrement inventés.
      *Conséquence : une donnée fausse, crédible, sans crash. Une seule question « c'est branché sur
      quoi ? » et toute la démo perd sa crédibilité, y compris ce qui est vrai.*
      → Purger les mocks, états vides honnêtes à la place. **~1-2 h. FRONT.**

- [ ] **Multi-tenancy : la transformation ne vérifie pas l'organisation de `id_materiel`.**
      Le produit fini et chaque lot parent sont contrôlés ; la cuve, non — elle part telle quelle
      dans `batch.create` et dans le `readPoint` EPCIS.
      *Conséquence : un lot **produit fini** peut être rattaché au frigo d'un autre tenant et
      **échappe alors définitivement à la quarantaine automatique** (le filtre IoT croise
      `organization_id` + `id_materiel_actuel` : aucune des deux orgs ne correspond).*
      → Ajouter le `findFirst({ id, organization_id })` qui existe déjà côté réception. **API.**

- [ ] **Barrière qualité de sortie d'usine : inexistante.** Trois pièces du même engrenage :
      le lot enfant d'une transformation naît **`EN_STOCK`** au lieu de quarantaine (donc
      immédiatement expédiable, **sans aucun contrôle**) ; `QualityControl` **n'est créable nulle
      part** (le rôle `quality` n'a aucune action de saisie dans tout le système) ; et les alertes
      ne sont clôturables par aucune UI web.
      *Question jury garantie : « qui valide le produit fini avant expédition ? » → personne.*
      → 1 ligne pour le statut ; `POST /organization/quality-controls`. **API + FRONT.**

- [ ] **`Location` et `Supplier` ne sont créables nulle part** (aucun endpoint d'écriture).
      *Conséquence, deux fois : `POST /organization/equipment` exige un lieu → **toujours 400** sur
      une org neuve, le correctif matériel est mort-né hors seed. Et la réception exige un
      fournisseur → **aucune réception possible** → pas de lot → pas de généalogie → pas de rappel.
      Cul-de-sac total.*
      → Dupliquer le patron `equipment.service.ts` (~70 lignes). **API (+ écran, cf. §3).**

- [ ] **`Equipment.temp_actuelle` est affiché par le front mais écrit par PERSONNE.** Le ping IoT
      n'écrit que dans MongoDB.
      *Conséquence : en démo, le frigo en excursion affichera **3,2 °C pendant l'alerte PANIC**. On
      montre l'alerte et la quarantaine **sans jamais afficher la température coupable** — sur
      l'écran phare de l'objectif SMART n°2.*
      → 5 lignes après le `TelemetryModel.create`. **Trivial. API.**

- [ ] **La vitrine GS1/EPCIS est indémontrable.** Le seed démo écrit en direct via `prisma.*.create`
      en contournant les services → **zéro `EPCIS_Event`, zéro `Receipt`** : magasin d'événements
      vide et export CSV réduit à sa ligne d'en-têtes. `GET /traceability/events` n'a aucun
      consommateur. Et `GET /public/scan/:id` — la route consommateur, soignée — **n'a aucune page
      en face** : le QR renvoie du JSON brut.
      *Conséquence : l'argument central du projet (traçabilité GS1) et la partie prenante B2C du
      cahier des charges n'ont aucune surface visible. Le travail est fait, rien ne le prouve.*
      → Semer les événements (ou mieux : faire appeler les services par le seed) + page `/evenements`
      + page publique `/scan/[id]`. **API (seed) + FRONT.**

## 2. 🟠 Important — si le temps le permet

- [ ] **Un lot ne peut JAMAIS changer d'emplacement.** `id_materiel_actuel` n'est écrit qu'à la
      création. Aucun `move`, et le `qr_code_id` du matériel n'a **aucun lecteur**.
      *Conséquence : la quarantaine automatique filtre sur une position qui cesse d'être vraie dès
      le premier déplacement réel (quai → chambre froide → production) : faux négatifs sanitaires
      ET faux positifs.* Non bloquant en démo (on place le lot dès la réception). **API + mobile.**

- [ ] **Étiquettes QR non imprimables.** Les endpoints `label` (lot et matériel) renvoient un PNG et
      n'ont **aucun appelant**. Or le mobile ne peut renseigner l'emplacement d'un lot **que** par
      scan de l'étiquette du frigo.
      *Conséquence : la boucle « je crée un frigo → j'imprime → je scanne » ne fonctionne pas.*
      **Petit. FRONT.**

- [ ] **Réceptions : aucun lien Batch ↔ Receipt ↔ Supplier.** Le service crée la réception puis le
      lot dans la même transaction **sans jamais les relier** (pas de clé étrangère).
      *Conséquence : le récit « je remonte du produit fini jusqu'à la ferme » **s'arrête au lot de
      lait cru**. La maquette du cahier des charges montre pourtant « AMONT — Lait cru — Ferme Les
      Aubépines ».* **API + FRONT.**

- [ ] **`Batch_Mouvement` n'est pas écrit à la réception, ni aux quarantaines, ni au rappel** (que
      sur transformation et expédition).
      *Conséquence : **un lot reçu et non transformé a un historique VIDE** à l'écran, et une
      quarantaine IoT ou un rappel n'y laisse aucune ligne — c'est exactement le scénario de démo.*
      (Nuance : l'audit WORM et les EPCIS sont bien écrits ; c'est l'historique **matière** affiché
      qui est incomplet.) → 3 lignes × 4 endroits. **API.**

- [ ] **Chaîne du froid sans courbe.** `GET /telemetry/:sensor_id/history` n'est affiché nulle part.
      *Conséquence : la démo la plus spectaculaire (pic → alerte → lot bloqué) ne montre **que
      l'effet, jamais la cause**.* Quasi gratuit : le `sensor_id` est déjà renvoyé. **FRONT.**

- [ ] **Rebut : impossible de sortir un lot du stock.** `ScrapRecord` n'a aucune occurrence, et un
      lot rappelé (statut `ALERTE`) ne peut plus être ni transformé, ni expédié, ni levé de
      quarantaine → **cul-de-sac définitif**, sa quantité reste aux livres indéfiniment.
      *« Que deviennent les lots rappelés ? » → aucune preuve de destruction opposable à la
      DGCCRF.* **API.**

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
      et sur la levée de quarantaine (refusée), on ne *sait* pas que le cloisonnement tient.

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
      (on annonce un statut *inconnu*, jamais un échec), mais la vraie correction est un
      `client_op_id` côté API, comme pour la réception.
- [ ] **`shipment_id` est `@unique` globalement**, pas par organisation : une org ne peut pas
      réutiliser un n° de transport qu'une autre a pris. **API.**
- [ ] **La table `Unit` contient à la fois `kg` et `KG`**, et `VALID_UNITS` référence des unités
      (`G`, `ML`, `UNIT`, `PALLET`, `BOX`) **absentes de la table** → erreurs de clé étrangère
      possibles. C'est la cause du doublon visible à la réception. **API.**

## 6. ⚪ Assumé — à expliquer au jury plutôt qu'à coder

- **Garde-fou de bilan matière (`RecipeComposition`)** — rien n'empêche de déclarer 1000 L de yaourt
  à partir de 1 L de lait. Le modèle est **inexploitable en l'état** (pas d'`organization_id`, et
  l'ingrédient ne référence aucune table). *Discours : « modélisé, implémentation en V2 — nous
  n'avons pas voulu livrer une version fausse. »*
- **Maintenance / hygiène HACCP** — table 100 % morte. On peut transformer dans une cuve jamais
  nettoyée. Aucune règle existante n'en dépend. *Discours : extension V2 — **et la retirer de l'ERD
  projeté**, ou l'y marquer hors périmètre. Un jury pardonne un périmètre assumé, pas une table
  fantôme.*
- **Historique thermique du camion** — jamais écrit, aucun canal d'entrée ; `statut_controle` est
  **déclaré par le client** et recopié tel quel. *Nuance : le blocage fonctionne, c'est la preuve
  thermique qui manque. Si on a une heure : `detectExcursion()` est **déjà écrite et testée**, il
  suffit de l'appeler.*
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
if (req.headers['x-api-key'] && !hasUserSession(req)) {
  return checkApiKey()(req, res, ensureOrg);   // allowedRoles n'est JAMAIS évalué
}
```

*Conséquence : un `git clone` + un `curl`, **sans aucun compte**, permet d'écrire des réceptions,
des expéditions, des scans, des trames capteur, et de lire l'annuaire nominatif des salariés (donnée
personnelle → enjeu DPIA). C'est borné à l'organisation de la clé — pas de cross-tenant — mais c'est
exploitable en trente secondes, et c'est la réponse à « où sont vos secrets ? ».*
→ Refuser la branche clé API quand `allowedRoles` n'est pas vide ; régénérer la clé ; `.env.example`
factice. **API + INFRA. ~1 h.**

C'est aussi ce qui rend **`received_by` encore falsifiable** en mode clé (le `member.findFirst` du
module sync, qui fait le bon contrôle, n'a jamais été copié dans la réception ni l'expédition).

### 8.2 🔴 La chaîne d'audit WORM peut se rompre — devant le jury

L'écriture n'est pas sérialisée : le `SELECT … FOR UPDATE` verrouille la *dernière ligne existante*,
il n'empêche pas un INSERT concurrent de lire le même maillon. Aucun index unique sur
`(organization_id, prev_hash)`, aucune reprise sur erreur de sérialisation, aucun test de
concurrence. Pire : la création de matériel journalise **hors transaction**.

*Conséquence : un ping IoT pendant une synchronisation, et la chaîne **forke définitivement** → le
bouton « vérifier l'intégrité de l'audit », qu'on a mis au front, affiche **« chaîne rompue »**, sur
l'objectif 7, sans réparation possible (c'est du WORM).*
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

*Conséquence : « Montrez l'environnement, quel commit tourne, comment vous revenez en arrière ? » —
sans réponse, sur une ligne cochée.*

### 8.4 🔴 Aucun compte `operator` / `quality` / `viewer` n'existe, et on ne peut pas en créer

Le seed crée **un seul** utilisateur, **sans mot de passe** (aucune ligne `Account`) : il ne peut
même pas se connecter. Le seul chemin d'inscription passe par une invitation dont le mail part vers
une boîte factice, dont le front **jette le jeton**, et qu'aucune route ne permet de relister.

*Conséquence : le « rejouer les parcours avec chaque rôle » du §3 est **matériellement impossible**.
« Connectez-vous en opérateur » → il n'y a pas de compte opérateur.*
→ Trois `upsert` avec une ligne `Account` dans le seed. **API. 30 min — et ça débloque trois autres
trous.**

### 8.5 🔴 La purge des mocks prévue au §1 ne suffira pas : les faux chiffres sont dans les *mappers*

Le « 78 % de confirmations » n'est **pas** dans les fichiers de mock : il est écrit en dur dans le
mapper des **données réelles** (`progress: a.statut === 'ACTIVE' ? 78 : 100`). Idem pour le brief du
Portail magasins et une étape fantôme de l'arbre de traçabilité.

*Conséquence : supprimer `src/lib/data/*` **compile parfaitement** et laisse tout en place. Le jour J,
un rappel réellement déclenché affichera encore « Retrait rayon — 78 % », **sous le bandeau « données
issues de la base »**. Le vrai périmètre de purge est `mappers.ts`.*

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

*Conséquence : un correcteur qui clone et suit le Readme obtient une base vide et **ne peut pas se
connecter**. Le livrable « projet reproductible » tombe.* → **DOCS. Trivial.**

### 8.9 🔴 La boucle du rappel ne se ferme jamais

Le barème du POC mobile exige « scan → vérifier le lot → **marquer le retrait** → synchro offline ».
« Marquer le retrait » n'existe **ni sur mobile, ni côté API, ni sur le portail magasins** (qui
n'affiche que deux compteurs, alors que le menu promet « confirmations »). Le cahier des charges pose
pourtant un KPI « taux de rappel complété > 90 % » : il n'a **aucune source de données**.

*« Et ensuite, le magasin fait quoi ? » → rien.* → **Gros.** *À défaut : l'assumer explicitement.*

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
      démo n'affiche jamais la fiche du lot. *(Nécessite aussi un endpoint de recherche de lot par
      code, qui n'existe pas.)*
- [ ] **Choisir « ALERTE » ou « NONCONFORME » à la réception met le lot en quarantaine sans le
      dire** — décision sanitaire lourde, irréversible depuis le terrain, déclenchée par une puce
      anodine. *(Et `CONFORME` est une quatrième valeur pour trois états, qui ne sert à rien.)*

---

## Fait et vérifié

- [x] Chaîne de synchronisation hors-ligne complète (file SQLite, `clientOpId`, 207 Multi-Status,
      backoff, remédiation) — prouvée en base.
- [x] Réception avec emplacement du lot (double scan : le lot, puis le frigo).
- [x] Création de matériel + étiquette QR (`POST /organization/equipment`, `GET .../label`).
- [x] Authentification mobile — la fuite **inter-organisation** par `x-api-key` corrigée à la
      racine. *(Le contournement de rôle **intra-organisation**, lui, reste entier : cf. §8.1.)*
- [x] Décision d'alerte froid sur mobile (Yoann, PR #12).
- [x] CI mobile : lint, typecheck, tests **et build** — c'est le build qui avait rattrapé
      l'application qui ne démarrait plus.

### Deux lignes décochées le 12/07 — elles étaient fausses

- [ ] ~~« `received_by` n'est plus falsifiable »~~ — **faux**. Corrigé sur le chemin *session*
      uniquement. En mode clé API il n'y a pas de `req.auth.user`, donc **l'auteur retombe sur le
      corps de la requête**, et le service ne vérifie que l'*existence* de l'utilisateur, jamais son
      appartenance à l'organisation. L'identité scellée dans l'audit WORM reste choisie par le
      client. Voir §8.1.
- [ ] ~~« l'audit WORM et les EPCIS sont bien écrits »~~ — **à ne plus tenir pour acquis** : la
      chaîne d'audit n'est pas sérialisée et n'a aucune contrainte en base. Voir §8.2.
