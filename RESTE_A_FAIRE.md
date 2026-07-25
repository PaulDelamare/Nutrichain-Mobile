# Reste à faire — NutriChain

> **⚠️ Depuis le 14/07/2026, le reste à faire vit dans les ISSUES GitHub, plus dans ce fichier.**
>
> Ce document n'en est plus que **l'index**. Le détail — et surtout **la conséquence concrète** de
> chaque manque — est dans l'issue. Une PR ferme son issue (`Closes #12`), ce qui donne l'historique
> réel du pilotage (et sert de livret SCRUM).
>
> **Ne recopiez rien ici.** Deux listes finissent toujours par diverger, et la plus jolie ment.

Les 37 issues ci-dessous viennent d'un audit du code **revérifié ligne à ligne le 14/07**. L'ancienne
liste s'était périmée : elle donnait encore pour ouverts une dizaine de trous **déjà bouchés**, et
une de ses lignes était **factuellement fausse**. C'est précisément pour ça qu'on ne tient plus une
liste à la main.

---

## 🔴 Bloquant avant la soutenance

### API — [Nutrichain-Api](https://github.com/PaulDelamare/Nutrichain-Api/issues)

| # | Le trou | Pourquoi c'est grave |
| --- | --- | --- |
| [#67](https://github.com/PaulDelamare/Nutrichain-Api/issues/67) | La chaîne d'audit WORM peut **forker** | Le bouton « vérifier l'intégrité » afficherait **« chaîne rompue »** devant le jury — et un fork est indiscernable d'une falsification |
| [#68](https://github.com/PaulDelamare/Nutrichain-Api/issues/68) | L'**alerte froid est avalée** (202 « succès » sur échec) | Les lots ne sont **pas mis en quarantaine**, ils restent expédiables — et le capteur croit avoir réussi |
| [#70](https://github.com/PaulDelamare/Nutrichain-Api/issues/70) | `Location` et `Supplier` **incréables** | Aucune réception possible hors seed → pas de lot → pas de rappel. Cul-de-sac |
| [#71](https://github.com/PaulDelamare/Nutrichain-Api/issues/71) | `Equipment.temp_actuelle` **jamais écrite** | Le frigo affichera **3,2 °C pendant l'alerte PANIC**. ~5 lignes : le meilleur rapport effort/effet qui reste |
| [#72](https://github.com/PaulDelamare/Nutrichain-Api/issues/72) | La vitrine **GS1/EPCIS est indémontrable** | Le seed contourne les services → zéro événement en base. L'argument central du projet n'a aucune surface visible |
| [#78](https://github.com/PaulDelamare/Nutrichain-Api/issues/78) | La CI de `develop` ne **build** pas, ne type pas, ne migre pas | Une erreur de typage se merge en vert — sur une ligne cochée « CI/CD industrielle ✅ » |

### Front — [Nutrichain-Front](https://github.com/PaulDelamare/Nutrichain-Front/issues)

| # | Le trou | Pourquoi c'est grave |
| --- | --- | --- |
| [#20](https://github.com/PaulDelamare/Nutrichain-Front/issues/20) | Aucun écran des **réceptions ni des expéditions** | Le siège ne voit **jamais** ce que le terrain scanne — pour deux endpoints finis |
| [#21](https://github.com/PaulDelamare/Nutrichain-Front/issues/21) | La **courbe de température** n'est nulle part | La démo la plus spectaculaire ne montre que l'effet, **jamais la cause** |
| [#23](https://github.com/PaulDelamare/Nutrichain-Front/issues/23) | Les **coordonnées GPS de la fiche lot sont fabriquées** | Un pin inventé par regex sur le nom du site, marqué `precise: true`, sous un bandeau « données réelles » |
| [#25](https://github.com/PaulDelamare/Nutrichain-Front/issues/25) | Aucun écran de **configuration** | Le matériel se crée aujourd'hui en appelant l'API **à la main** |

### Mobile — [Nutrichain-Mobile](https://github.com/PaulDelamare/Nutrichain-Mobile/issues)

| # | Le trou | Pourquoi c'est grave |
| --- | --- | --- |
| [#29](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/29) | Un **refus de caméra rend l'app inutilisable** | La saisie manuelle — le recours prévu — est cachée derrière la permission caméra |
| [#30](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/30) | `ALERTE`/`NONCONFORME` mettent le lot **en quarantaine sans le dire** | Décision sanitaire lourde, derrière une puce anodine libellée avec le code brut de l'énum |
| [#31](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/31) | Le **GTIN, le lot et la DLC décodés sont jetés** | Le scan ne remplit pas le formulaire tout seul — sa raison d'être |
| [#33](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/33) | **Aucun APK** | La démo ne prouve **ni la vraie caméra, ni le vrai hors-ligne** |

## 🟠 Important

**API** — [#69](https://github.com/PaulDelamare/Nutrichain-Api/issues/69) bruteforce login ·
[#73](https://github.com/PaulDelamare/Nutrichain-Api/issues/73) un lot ne change jamais d'emplacement ·
[#74](https://github.com/PaulDelamare/Nutrichain-Api/issues/74) rebut impossible (lot rappelé = cul-de-sac) ·
[#75](https://github.com/PaulDelamare/Nutrichain-Api/issues/75) unités incohérentes (enum ≠ table) ·
[#76](https://github.com/PaulDelamare/Nutrichain-Api/issues/76) transformation sans clé d'idempotence ·
[#77](https://github.com/PaulDelamare/Nutrichain-Api/issues/77) aucun lien Batch ↔ Receipt ·
[#79](https://github.com/PaulDelamare/Nutrichain-Api/issues/79) séparation des tâches HACCP non tenue **(décision de Paul)**

**Front** — [#22](https://github.com/PaulDelamare/Nutrichain-Front/issues/22) étiquettes QR non imprimables ·
[#24](https://github.com/PaulDelamare/Nutrichain-Front/issues/24) bouton « Exporter » vide ·
[#26](https://github.com/PaulDelamare/Nutrichain-Front/issues/26) colonne « Dernière temp. » vide en dur ·
[#27](https://github.com/PaulDelamare/Nutrichain-Front/issues/27) page publique de scan consommateur

**Mobile** — [#32](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/32) écran des lots en quarantaine ·
[#34](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/34) sur le web, la détection réseau ment ·
[#35](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/35) le cache catalogue n'expire jamais

## ⚪ Assumé — à expliquer au jury, pas à coder

[Mobile #36](https://github.com/PaulDelamare/Nutrichain-Mobile/issues/36) — **la file hors-ligne ne couvre que les réceptions.**
⚠️ Ne **jamais** revendiquer « tout fonctionne hors ligne » : c'est faux.

Également assumés (à mettre dans un « Limitations connues » du README) : garde-fou de bilan matière
(`RecipeComposition` inexploitable), maintenance/hygiène HACCP (table morte), historique thermique du
camion (déclaré par le client), `PerformanceStat` (table morte), secret partagé entre capteurs, ABAC
par site, rétention RGPD.

~~MFA non imposée~~ — la 2FA (TOTP) est codée et testée (`/verify-2fa`, suite unitaire verte).
⚠️ **Non vérifié sur appareil/simulateur** : le défi Better-Auth repose sur un cookie `two_factor`
signé, renvoyé par le serveur puis réémis par le client au `verify-totp` — l'app n'a AUCUNE gestion
de cookie explicite, elle compte sur le stockage natif (iOS/Android) qu'utilise React Native par
défaut. Web (front) avait le même mécanisme et cachait un vrai bug de relais, trouvé seulement en
testant dans un navigateur réel. À rejouer ici sur un appareil avant de considérer le parcours
prouvé.

## 🎓 Soutenance — [le meilleur ratio effort/note](https://github.com/PaulDelamare/Nutrichain-Api/labels/soutenance)

[#80](https://github.com/PaulDelamare/Nutrichain-Api/issues/80) **tableau des KPI au mauvais format**
(~30 min, zéro ligne de code — « Cadrage & choix » vaut **20 %**) ·
[#81](https://github.com/PaulDelamare/Nutrichain-Api/issues/81) **le dossier coche ✅ des objectifs non atteints** ·
[#82](https://github.com/PaulDelamare/Nutrichain-Api/issues/82) support d'oral + **répétition chronométrée** + plan B ·
[#83](https://github.com/PaulDelamare/Nutrichain-Api/issues/83) DPIA ·
[#84](https://github.com/PaulDelamare/Nutrichain-Api/issues/84) SIEM ·
[#85](https://github.com/PaulDelamare/Nutrichain-Api/issues/85) dashboards ·
[#86](https://github.com/PaulDelamare/Nutrichain-Api/issues/86) Top 5 des risques ·
[#87](https://github.com/PaulDelamare/Nutrichain-Api/issues/87) livret SCRUM

---

## Ce qui est fait, et **vérifié**

Rien n'est coché parce que le code est écrit : il faut un test vert **et** un constat à l'écran, en
base, ou dans une vraie réponse HTTP.

**Sécurité — 16 failles fermées sur ~22.** Clé API publiée et contournement des rôles ; falsification
de l'identité d'écriture ; fuite cross-tenant par `x-api-key` ; données personnelles servies au
`viewer` ; cloisonnement de la cuve ; `shipment_id` unique par organisation ; passthrough Better-Auth
sur les organisations ; 403 pris pour une panne réseau ; file de scans non persistée sur le web ;
file de scans repartant sous une autre identité ; **boutons de décision morts dans le navigateur**
(`Alert.alert` = no-op) ; **caméra qui ne scannait pas du tout** sur le web.

**Traçabilité.** Chaîne de synchronisation hors-ligne complète (file SQLite, `clientOpId`, backoff
30 s → 30 min, remédiation) — prouvée en base. Historique complet du lot. Barrière qualité de sortie
d'usine (`EN_ATTENTE_QC`). Numéro de lot et **DLC du fournisseur** enregistrés à la réception (la
garde « lot périmé » cesse d'être du code mort). Résolution d'un lot par le numéro de son étiquette.

**Le scan.** L'étiquette qu'imprime NutriChain n'encode **pas** le numéro de lot, mais une **URL GS1
Digital Link** : c'est pour ça que rien ne se résolvait. Scanner un lot déjà reçu ouvre désormais
**sa fiche** ; la cuve et le camion lisent enfin nos propres étiquettes ; « Lot inconnu » n'est plus
dit quand on **n'a pas pu vérifier** ; et le scan caméra fonctionne **hors ligne** (le décodeur
téléchargeait son moteur WebAssembly depuis un CDN — démo sans Wi-Fi = scan mort).

---

## ⚠️ Pièges d'environnement (vécus, coûteux)

- **`tsx` sans `watch` garde le code en mémoire.** Après un merge, **redémarrer l'API** — sinon on
  teste l'ancien code. _Vécu : deux heures perdues sur un bug d'horodatage déjà corrigé._
- **Les tests mobile exigent Node 22** (`node:sqlite`). En Node 20, `npm test` **saute 35 tests en
  silence** — un vert trompeur. →
  `npx -y -p node@22 node ./node_modules/jest/bin/jest.js`
- **Dans un worktree, les binaires ne sont pas linkés** : `npx vitest` échoue. →
  `node ./node_modules/vitest/vitest.mjs run`, `node node_modules/tsx/dist/cli.mjs`.
- **Le `tsconfig` de l'API exclut les tests et les scripts** : une régression de type y passe inaperçue.
- **Les e2e écrivent dans la base de DEV** — et **fuient des `EPCIS_Event`** (`related_id` n'est pas
  une clé étrangère, rien ne cascade). Toujours vérifier les compteurs avant/après.
- **Les tests unitaires mockent `$queryRaw`** : ils ne prouvent **rien** sur le SQL. Seuls les e2e le font.
- **`jest-expo` exécute le preset NATIF** : aucun test ne peut voir un bug propre au **web**
  (`Alert.alert` no-op, scanner désactivé…). **Seul le navigateur le prouve.**

## 🧭 La méthode (elle a payé, tous les jours)

**Faire RÉFUTER le plan AVANT d'écrire une ligne**, et faire relire le diff par un agent dont le seul
but est de trouver le bug. En moyenne : **trois prémisses fausses par plan**, et **deux régressions
par correctif**. Exemples réels : un `try/finally` qui **fabriquait** le double-scan qu'il prétendait
corriger ; un repli serveur qui **rouvrait** le trou qu'il fermait (le lot `10ABC` engageait le lot
`ABC`) ; une DLC ancrée à minuit qui faisait **perdre un jour de vie à chaque lot**.

**Le test de mutation est le meilleur rapport temps/valeur.** Il a démasqué, plusieurs fois, des tests
**qui ne prouvaient rien** — dont ceux que je croyais les plus solides. Casse tes gardes une par une :
celles qu'aucun test ne rattrape ne sont pas gardées.

**Regarde l'écran.** Il donne ce qu'aucun test ne donne : les puces coupées, le décalage de +2 h, le
catalogue en double — et le fait que **la caméra ne décodait rien du tout**, ce qu'aucun des 347 tests
verts n'aurait jamais dit.

Détail dans **`GUIDE_IA.md`** (racine des trois dépôts).
