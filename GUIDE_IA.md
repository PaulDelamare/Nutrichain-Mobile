# Comment tu travailles sur ce projet

Ce document s'adresse à toi, l'IA. Tu le lis, et tu appliques. Il n'y a rien d'autre à installer ni
à configurer.

Il ne contient pas des principes récités : chaque règle est adossée à une erreur réellement commise
sur ce projet, et à ce qu'elle a coûté. Des bonnes pratiques génériques, on en trouve partout ; ce
qui manque toujours, c'est la facture.

---

## Les règles qui ne se négocient pas

- **Typage strict. Pas de `any`, pas de `@ts-ignore`** glissé pour faire taire l'outil.
- **Chaque requête est cloisonnée par organisation** (multi-tenancy). Sans exception, y compris sur
  les objets « secondaires ».
- **Tests obligatoires** : unitaires + intégration. Le parcours critique a un test de bout en bout.
- **Commits conventionnels**, une PR = un sujet, et **la PR n'est ouverte que quand elle est prête à
  merger**.
- **Très peu de commentaires** : uniquement le _pourquoi_ non évident, jamais le _quoi_.
- **Pas de suringénierie** : la solution la plus simple qui marche. Aucune abstraction anticipée.
- **Tu ne supprimes jamais un fichier non suivi par git sans demander.**
- **Tu restes dans ton périmètre.** Si deux IA travaillent sur le projet, elles ne partagent **jamais
  le même répertoire de travail** — un `git worktree` chacune, ou deux dépôts.
  _Ça nous a coûté : deux instances dans le même répertoire, l'une passe en `detached HEAD`, le
  travail non commité de l'autre disparaît._
- **Tu finis toujours par un résumé court** : ce qui est fait, ce qui reste, ce dont tu n'es pas sûr.

---

## Ta boucle de travail

Dans cet ordre. Sans sauter d'étape.

### 1. Analyser avant de coder

Explore le code existant **en parallèle, sous plusieurs angles** (modèle de données, routes, tests,
sécurité, interfaces) si tu peux lancer plusieurs agents. Un seul agent qui lit tout séquentiellement
voit moins et coûte plus.

> Un audit à 49 agents a trouvé ici 18 trous réels — dont « la donnée est indispensable au métier,
> mais **aucun endpoint ne permet de la créer** ». Personne ne l'avait vu en trois mois. Un trou ne
> se voit pas en lisant un fichier à la fois.

### 2. Écrire un plan

Pas une ligne de code avant. Le plan dit : ce que tu changes, dans quel ordre, ce que tu ne fais
**pas**, et surtout **comment on saura que c'est fait** — le critère de preuve.

### 3. Faire démolir ton plan

Lance un agent dont le **seul but est de le réfuter**. Pas « est-ce que c'est bon ? » mais « trouve
ce que ce plan casse, ce qu'il oublie, ce qu'il suppose sans l'avoir vérifié ».

> Une IA à qui l'on demande « c'est bon ? » répond oui neuf fois sur dix. À qui l'on demande « trouve
> pourquoi c'est faux », elle trouve. **Formule toujours une revue comme une réfutation.**

### 4. Avancer par petits incréments

Un incrément = une chose qui marche, testée, vérifiée. Pas dix fichiers d'un coup : 800 lignes d'un
bloc ne seront pas relues, et tu le sais.

### 5. Valider chaque incrément — trois preuves, pas une

1. Les tests passent **et le build passe**.
2. **Un autre agent** relit ce que tu viens de faire, avec pour consigne de trouver le bug. Jamais
   toi-même : celui qui a écrit le code est le plus mal placé pour le juger.
3. **Tu regardes le résultat réel** : l'écran, la ligne en base, la vraie réponse HTTP. Pas le
   terminal.

### 6. Puis seulement, la PR

---

## TDD : le test avant le code, et un test capable d'échouer

**Rouge → vert → refactor.** Tu écris le test, **tu le regardes échouer**, puis tu le fais passer.

Un test que tu n'as jamais vu rouge ne prouve rien.

> **Ce que ça a coûté ici** : un test vérifiait que l'auteur d'une réception venait bien de la
> session. Il était vert. Il mockait `req.user`… **un état que la route ne produit jamais** — elle
> passe par un autre middleware, qui remplit `req.auth.user`. Le test validait un monde imaginaire.
> En vrai, l'identité scellée dans la chaîne d'audit était **choisie par le client** : n'importe quel
> opérateur pouvait faire signer une réception non conforme par son responsable. **Vert sur une
> faille.**

**La règle qui en découle** : ne fabrique jamais dans un test un état que le code de production ne
produit pas. Si tu dois beaucoup mocker pour que ça passe, tu testes ton mock, pas ton code.

---

## Les niveaux de test, et ce que chacun prouve

| Niveau           | Ce qu'il prouve                                                                                        | Ce qu'il ne prouve pas                           |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Unitaire**     | Une fonction fait ce qu'elle dit, y compris aux bords : vide, zéro, négatif, trop long, mauvaise casse | Que les pièces s'assemblent                      |
| **Intégration**  | Le vrai moteur (vraie base, vraies requêtes, vraies validations) accepte et rejette ce qu'il faut      | Qu'un humain peut s'en servir                    |
| **Bout en bout** | Le parcours critique marche du premier clic à la ligne en base                                         | Rien d'autre — c'est lent, garde-le pour le cœur |

**Et un quatrième garde-fou, non négociable : le build.**

> **Ce que ça a coûté ici** : 111 tests verts, typage propre, lint propre… et **l'application ne
> démarrait plus du tout**. Les fichiers de test avaient atterri dans le dossier des routes, où le
> routeur les transformait en écrans. Aucun test ne pouvait le voir : les tests testaient les tests.
> Seul un build l'a attrapé. **Le build fait partie de la validation, pas de la publication.**

### Le juge de tes tests : la mutation

Régulièrement, **casse volontairement tes propres gardes, une par une, et regarde lesquelles tes
tests ne rattrapent pas.**

> Verdict ici : **8 mutants sur 10 survivaient**. On pouvait supprimer 8 des gardes de sécurité du
> code sans qu'un seul test ne rougisse. Les tests étaient beaux. Ils ne tenaient presque rien.

---

## SRP, SOLID, Clean Code — appliqués, pas récités

- **SRP** : une fonction, une raison de changer. Concrètement : si tu dois écrire « et » pour décrire
  ce que fait une fonction, coupe-la.
- **Une seule source de vérité.** Une constante recopiée à 23 endroits n'est pas une constante, c'est
  23 bugs en puissance. **Mais** ne centralise que ce qui est **couplé** : deux valeurs qui se
  ressemblent par coïncidence (deux gris, deux marges) ne doivent surtout pas être factorisées — ça
  rend le code moins lisible pour zéro bénéfice.
- **Nomme en métier, pas en technique** : `isUsableBatch()`, pas `checkStatus()`. Le nom doit survivre
  au refactor.
- **Les commentaires disent POURQUOI, jamais QUOI.** `// incrémente i` est du bruit. `// le serveur
exige 2 décimales : une balance qui affiche 12,345 fait rejeter tout l'envoi` est une information
  qu'aucun lecteur ne peut deviner.
- **YAGNI.** Pas de pattern pour deux cas, pas d'abstraction « au cas où ». Tu as une pente naturelle
  à produire des couches : résiste. La bonne solution est celle qu'on peut supprimer facilement.

---

## Git, PR, livraison

- **Branches** : `main` = production, `develop` = préproduction (base des PR), `feat/…` `fix/…`
  `docs/…` pour le travail. `main` et `develop` sont protégées : pas de push direct, PR obligatoire,
  CI verte.
- **Commits conventionnels** : `feat(scope): …`, `fix(scope): …`. Titre court, factuel, **un seul
  sujet**. Pas d'emoji, pas de majuscules criardes, pas de ton dramatique. Le contexte va dans le
  corps, pas dans le titre.
- **Une PR = un sujet.** Une PR « fix + refactor + feature » n'est pas relue, elle est approuvée.
- **N'ouvre la PR que lorsqu'elle est prête à merger** : tests verts, revue faite, correctifs
  appliqués.

> **Ce que ça a coûté ici** : une PR ouverte trop tôt a été mergée pendant qu'on continuait à pousser
> dessus. Les commits suivants sont devenus orphelins — invisibles, jamais mergés. Deux heures
> perdues, récupérées au `cherry-pick`.

- **`git fetch` avant de pousser.** Quelqu'un a peut-être avancé. Ici, une branche laissée douze
  heures sans PR s'est retrouvée en conflit avec un collègue qui, entre-temps, avait recodé la même
  chose.

---

## Sécurité : par défaut, pas à la fin

- **Le cloisonnement se vérifie sur CHAQUE objet d'une requête**, même le plus anodin.
  _Ici, la transformation vérifiait l'organisation du produit et des lots parents… mais pas celle de
  la cuve. Un produit fini pouvait être rattaché au frigo d'une autre entreprise — et échapper
  définitivement à la mise en quarantaine automatique._
- **L'identité vient de la session, jamais du corps de la requête.** Si le client peut envoyer
  `author_id`, alors c'est le client qui choisit qui signe.
- **Teste avec le rôle le plus faible, pas avec l'admin.**
  _Ici, le jeu de données de démo connecte un `owner`, qui a tous les droits : il **masque tous les
  403**. On croyait le cloisonnement des rôles solide — on ne l'avait jamais exercé._
- **Ce qui compile ne prouve rien sur la sécurité.**

---

## Ce qui ne se prouve pas dans un terminal

« C'est fait, les tests passent » est vrai, et insuffisant. Apporte une preuve du monde réel :

- une **capture de l'application qui tourne** (tu peux piloter un navigateur et te regarder faire) ;
- la **ligne en base** après l'action ;
- la **vraie réponse HTTP**, pas celle du mock.

> **Ce que ça a coûté ici** : une fonctionnalité entière était « terminée et testée » — et
> **inutilisable** : la route renvoyait 401 à tout le monde. Aucun test ne l'avait vu, parce que tous
> mockaient l'authentification. C'est en appelant l'API pour de vrai qu'on l'a découvert.

---

## Ta discipline intellectuelle

- **Tu ne devines pas.** Si tu n'es pas sûr, tu vas lire le code, ou tu le dis. Tu ne combles jamais
  un trou avec du plausible.
- **Tu dis ce que tu n'as PAS vérifié.** C'est presque toujours là qu'est le problème.
- **Tu ne rends pas un rapport lisse.** Un rapport sans incertitude est un rapport qui n'a pas
  cherché.
- **Tu rapportes fidèlement** : si un test échoue, tu le dis, avec la sortie. Si tu as sauté une
  étape, tu le dis.
- **Tu vérifies avant d'accuser** — le code, l'historique git. Une affirmation confiante et fausse
  coûte plus cher qu'un « je ne sais pas ».

---

## La checklist avant de dire « c'est fait »

Rien n'est fait tant que les huit cases ne sont pas cochées.

- [ ] Les tests passent — et **j'ai vu au moins un test échouer** avant de le faire passer.
- [ ] Le **build** passe, pas seulement les tests.
- [ ] Lint et typage passent, sans `any` ni `@ts-ignore` pour faire taire l'outil.
- [ ] **Un autre agent** a relu, avec pour consigne de trouver le bug — et ses trouvailles sont
      traitées, pas balayées.
- [ ] **J'ai vu le résultat réel** : écran, base, ou réponse HTTP.
- [ ] Les cas limites sont testés : vide, zéro, négatif, trop long, mauvaise casse, réseau coupé,
      **double clic**.
- [ ] Le cloisonnement et les rôles sont vérifiés **avec le rôle le plus faible**.
- [ ] La PR fait un seul sujet, son titre est factuel, et elle est prête à merger **maintenant**.

---

## Tiens une liste vivante de ce qui reste à faire

Un fichier versionné dans le dépôt (ici : `RESTE_A_FAIRE.md`). Tu l'augmentes **à chaque
découverte**, tu coches **quand c'est vérifié** — jamais quand le code est simplement écrit.

Chaque ligne dit **la conséquence concrète** du manque, pas seulement son intitulé. « Pagination
absente » ne veut rien dire. « À 500 lots, la page charge tout et se fige » est une décision qu'on
peut prendre.

> Une liste que tu gardes en mémoire disparaît à la fin de la session. Une liste dans le dépôt
> survit à tout le monde — y compris à celui qui l'a écrite, dans trois semaines.
