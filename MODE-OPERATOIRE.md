# Mode opératoire — widget « Gantt — Tous les champs » dans Grist

Ce document décrit, pas à pas, comment installer le widget dans un document Grist,
préparer la table `Tasks`, l'utiliser au quotidien et résoudre les problèmes courants.

| | |
|---|---|
| **URL du widget** | `https://nicolasmrsn.github.io/gantt-tous-les-champs/widget/` |
| **Page de démonstration** | <https://nicolasmrsn.github.io/gantt-tous-les-champs/> |
| **Manifest** (instances auto-hébergées) | `https://nicolasmrsn.github.io/gantt-tous-les-champs/manifest.json` |
| **Niveau d'accès requis** | **Accès complet au document** (*Full document access*) |
| **Tables utilisées** | `Tasks` (obligatoire), `Projects`, `Team` — noms fixes, non configurables |
| **Code source** | <https://github.com/NicolasMRSN/gantt-tous-les-champs> |

---

## 1. Prérequis

- Un document Grist — sur `getgrist.com`, sur une instance d'entreprise ou auto-hébergée —
  dans lequel vous avez le rôle **Éditeur** ou **Propriétaire** (nécessaire pour ajouter
  un widget et pour que le widget puisse écrire).
- Un navigateur récent (Chrome, Edge, Firefox, Safari).
- Le poste doit pouvoir joindre trois domaines : `nicolasmrsn.github.io` (le widget),
  `docs.getgrist.com` (bibliothèque `grist-plugin-api.js`) et `cdn.jsdelivr.net`
  (bibliothèque `Sortable`). Si un proxy d'entreprise bloque l'un d'eux, le widget
  reste vide — voir [§ 7](#7-dépannage).

> Les libellés d'interface ci-dessous sont donnés en français puis, entre parenthèses,
> en anglais, car Grist s'affiche dans l'une ou l'autre langue selon votre profil.

---

## 2. Installer le widget dans un document

### Étape 1 — Ajouter un widget personnalisé à une page

1. Ouvrez le document Grist.
2. En bas à gauche, cliquez sur **Ajouter un nouveau** (*Add New*) →
   **Ajouter un widget à la page** (*Add widget to page*), ou
   **Ajouter une page** (*Add Page*) si vous préférez une page dédiée au Gantt.
3. Dans la fenêtre :
   - **Sélectionner un widget** (*Select Widget*) : **Personnalisé** (*Custom*).
   - **Sélectionner les données** (*Select Data*) : la table **`Tasks`**.
     *Si `Tasks` n'existe pas encore*, choisissez n'importe quelle table (par exemple
     `Table1`) : le widget créera `Tasks` au premier lancement (voir [§ 3](#3-préparer-la-table-tasks)),
     et vous reviendrez ensuite lier le widget à `Tasks` (étape 4).
4. Cliquez sur **Ajouter à la page** (*Add to Page*).

### Étape 2 — Renseigner l'URL du widget

Le panneau de droite (panneau créateur) s'ouvre sur l'onglet **Widget**.

1. Dans la section **Widget personnalisé** (*Custom widget*), laissez le sélecteur sur
   **URL personnalisée** (*Custom URL*).
2. Dans le champ **URL**, collez :

   ```
   https://nicolasmrsn.github.io/gantt-tous-les-champs/widget/
   ```

3. Validez avec `Entrée`.

### Étape 3 — Accorder l'accès complet au document

1. Toujours dans le panneau de droite, champ **Niveau d'accès** (*Access level*) :
   choisissez **Accès complet au document** (*Full document access*).
2. Grist affiche un encart indiquant que le widget demande cet accès : cliquez sur
   **Accepter** (*Accept* / *Approve*).

Pourquoi « complet » ? Le widget lit les **métadonnées de colonnes** du document
(`_grist_Tables_column`) pour connaître le libellé, le type, les choix et les formules
de chacune de vos colonnes, et il écrit dans des colonnes qu'il ne connaît pas à
l'avance. Le niveau « lecture de la table » ne le permet pas : le widget resterait vide
ou n'afficherait que des éditeurs génériques.

### Étape 4 — Vérifier que tout fonctionne

Au chargement, vous devez voir :

- le planning Gantt avec la barre d'outils (`Aujourd'hui`, `Ajuster`, `Sem`/`Mois`/`Trim`…) ;
- éventuellement une notification **« Schéma initialisé (n tables, n colonnes) »** si le
  widget a dû créer des tables ou des colonnes ;
- en cliquant sur une tâche, un panneau de détail à droite : après Statut, Priorité,
  Dates, Projet… **vos propres colonnes de `Tasks`**, une ligne chacune, avec le même
  rendu. Le menu **`⚙ Champs`** (en haut de la liste de gauche) énumère toutes les
  colonnes détectées avec leur type.

Si le widget avait été ajouté sur une autre table que `Tasks` à l'étape 1 : dans le
panneau de droite, onglet **Données** (*Data*), cliquez sur **Modifier la sélection des
données** (*Edit Data Selection*) et choisissez **`Tasks`**. C'est ce lien qui permet au
widget de se rafraîchir automatiquement quand la table change.

### Étape 5 (facultatif) — Lier la sélection à une vue tableau

Si la même page contient une vue tableau de `Tasks`, vous pouvez faire suivre le Gantt :

1. Sélectionnez le widget Gantt, panneau de droite → onglet **Données** (*Data*).
2. **Sélectionner par** (*Select by*) : choisissez la vue tableau `Tasks`.

Cliquer sur une ligne du tableau ouvre alors directement la tâche dans le Gantt
(et déplie ses parents si elle est imbriquée).

---

## 3. Préparer la table `Tasks`

Le widget travaille toujours sur trois tables aux **noms fixes** : `Tasks`, `Projects`,
`Team`. Il n'est pas possible de le pointer sur une table nommée autrement.

### Cas A — Le document n'a pas encore de table `Tasks`

Au premier lancement, le widget **crée** les trois tables avec le schéma TaskFlow et y
insère **un jeu de données d'exemple** (3 membres d'équipe, 2 projets, 10 tâches) pour
que le Gantt ne soit pas vide. Ces enregistrements sont ordinaires : supprimez-les
quand vous n'en avez plus besoin.

### Cas B — La table `Tasks` existe déjà

Le widget la **conserve** et ajoute uniquement les colonnes du schéma TaskFlow qui
manquent. Vos colonnes à vous ne sont ni renommées, ni retypées, ni supprimées.

Colonnes ajoutées si absentes (identifiants et types Grist) :

| Colonne | Type | Rôle dans le Gantt |
|---|---|---|
| `titre` | Text | **requis** — nom de la tâche |
| `dateDebut` | Date | **requis** — début de la barre |
| `dateEcheance` | Date | **requis** — fin de la barre |
| `description` | Text | texte libre |
| `priorite` | Choice | `1` critique … `4` basse |
| `statut` | Choice | `todo`, `inprogress`, `review`, `done` (choix posés seulement si la colonne n'en a aucun) |
| `progression` | Numeric | 0–100 |
| `projet` | Ref:Projects | projet de rattachement |
| `assignees` | RefList:Team | personnes assignées |
| `type` | Choice | `tache` ou `jalon` |
| `dependDe` | RefList:Tasks | dépendances (flèches) |
| `parentTask` | Ref:Tasks | hiérarchie (sous-tâches) |
| `tags` | ChoiceList | étiquettes |
| `estimationH`, `tempsPasse` | Numeric | heures |
| `couleur`, `subtasks` | Text | usage interne du widget d'origine |

Le widget règle aussi, une fois, la **colonne d'affichage** des références (`projet` →
`nom`, `assignees` → `nom`, `dependDe` et `parentTask` → `titre`) pour que les vues
Grist natives montrent un libellé plutôt qu'un numéro de ligne.

> **Si vos colonnes existantes portent déjà l'un de ces identifiants avec un autre
> type** (par exemple un `statut` en Text plutôt qu'en Choice), le Gantt les utilisera
> tels quels. Les colonnes requises (`titre`, `dateDebut`, `dateEcheance`) doivent
> impérativement être du bon type pour que les barres s'affichent.

### Cas C — Ajouter vos propres colonnes

C'est tout l'objet de cette version : ajoutez dans Grist **n'importe quelle colonne**
(budget, client, référence marché, case à cocher, pièce jointe, formule…) de
**n'importe quel type**. Elle apparaît dans le panneau de détail, à la suite des champs
d'origine :

- immédiatement à la prochaine ouverture du panneau si le widget vient d'être chargé,
- sinon après **`⚙ Champs`** → **`↻ Relire les colonnes`** (relecture du schéma).

Aucune configuration à faire dans le widget : le libellé, le type, les choix et
leurs couleurs sont lus directement dans Grist.

---

## 4. Utiliser le widget au quotidien

### 4.1 Ouvrir une tâche

Cliquez sur une tâche dans la **liste de gauche** ou sur sa **barre** dans le Gantt.
Le panneau de détail s'ouvre à droite avec les propriétés du widget d'origine —
Statut, Priorité, Dates, Projet, Parent, Couleur, Assignés, Temps & charge,
Progression — puis, **à leur suite et avec le même rendu**, chacune de vos colonnes.

### 4.2 Vos colonnes dans le panneau

Chaque colonne de `Tasks` que le panneau n'édite pas déjà est une ligne de plus dans
sa liste de propriétés, dans l'ordre des colonnes du document : le **libellé Grist**
en capitales, une icône selon le type, l'éditeur adapté (voir 4.3) et, à droite du
libellé, une étoile `★` d'épinglage (voir 4.4). Une colonne formule porte un `ƒ` ;
survolez-le pour lire la formule.

Les champs déjà édités par le panneau (titre, description, statut, priorité, dates,
projet, assignés, dépendances, tags, estimation, temps passé, progression, couleur,
parent) **ne sont pas affichés une seconde fois**.

Les commandes liées aux colonnes sont dans le menu **`⚙ Champs`**, en haut de la
liste de gauche :

| Commande | Effet |
|---|---|
| cases à cocher | épingle une colonne dans la liste et l'info-bulle (voir 4.4) |
| **Masquer les champs vides** | le panneau ne montre que les colonnes renseignées pour la tâche ouverte |
| **`↻ Relire les colonnes`** | relit la liste des colonnes dans Grist (après en avoir ajouté, renommé ou retypé une) |
| **`⤓ Export CSV`** | exporte les tâches actuellement visibles avec toutes leurs colonnes (voir 4.5) |

### 4.3 Modifier une valeur

Modifiez directement dans l'éditeur. L'écriture part dans Grist **à la validation** :
`Entrée`, ou en quittant le champ (`Tab`, clic ailleurs). L'indicateur **« Enregistré »**
confirme. Selon le type :

| Type Grist | Éditeur | Remarques |
|---|---|---|
| `Text` | champ texte, ou zone multiligne si le contenu est long | les URL `http(s)://` deviennent cliquables |
| `Numeric`, `Int` | champ numérique | |
| `Bool` | case à cocher | écrit immédiatement au clic |
| `Date` | sélecteur de date, même habillage que la ligne « Dates » | stocké comme Grist (jour UTC) |
| `DateTime` | sélecteur date + heure | |
| `Choice` | pastille de couleur + liste déroulante, comme la ligne « Projet » | couleur du choix reprise de Grist |
| `ChoiceList` | puces (comme les tags) + menu **`+ Ajouter`** à cocher | dernière ligne du menu : saisie libre d'une nouvelle valeur, validée par `Entrée` |
| `Ref:<Table>` | liste déroulante des enregistrements de la table cible | libellé = colonne d'affichage (*Show column*) définie dans Grist |
| `RefList:<Table>` | puces + menu **`+ Lier`** à cocher, comme la ligne « Assignés » | `×` sur une puce pour retirer |
| `Attachments` | liste des pièces jointes avec lien de téléchargement | **lecture seule** |
| colonne **formule** | valeur en lecture seule, formule visible en survolant le `ƒ` | c'est Grist qui calcule |
| valeur en **erreur** | affichée telle quelle (`⚠ ZeroDivisionError`) | jamais masquée |
| autre type | valeur brute, éditable en JSON | aucun type ne bloque l'affichage |

**Nouvelle tâche** : sur une tâche pas encore enregistrée, une ligne « Autres champs »
indique le nombre de colonnes supplémentaires ; créez la tâche (bouton du panneau
d'origine), rouvrez-la, et elles sont éditables.

### 4.4 Épingler des champs dans la liste et l'info-bulle

Pour voir une information sans ouvrir le panneau :

- cliquez sur l'étoile **★** à droite du libellé d'un champ dans le panneau, **ou**
- cliquez sur **`⚙ Champs`** en haut de la liste de gauche et cochez les colonnes voulues.

Les champs épinglés apparaissent **sur la ligne de chaque tâche**, à côté des dates
(tronqués si la place manque : survolez pour lire le détail complet) et dans
l'**info-bulle** au survol des barres du Gantt.

Ce choix est enregistré dans **votre navigateur** (`localStorage`), jamais dans le
document : chaque utilisateur a sa propre sélection, et elle ne suit pas d'un poste à
l'autre.

### 4.5 Exporter en CSV

**`⚙ Champs`** → **`⤓ Export CSV`** télécharge `taches-tous-les-champs.csv` contenant :

- les tâches **actuellement visibles** (filtres projet / priorité / assigné et niveau
  de hiérarchie respectés),
- une première colonne `id` (numéro de ligne Grist), puis **toutes** leurs colonnes,
  y compris les formules et vos colonnes personnalisées,
- séparateur `;`, encodage UTF-8 avec BOM : le fichier s'ouvre directement dans
  Excel ou LibreOffice avec les accents corrects. Les références sont exportées avec
  leur libellé, les listes séparées par `, `.

### 4.6 Droits en lecture seule

Si votre rôle sur le document est **Lecteur** (*Viewer*), le widget affiche le bandeau
« lecture seule » du widget d'origine et les éditeurs de vos colonnes sont désactivés
(les listes à puces s'affichent sans `×` ni bouton d'ajout). L'affichage, l'épinglage
et l'export CSV restent disponibles.

---

## 5. Instance Grist auto-hébergée : proposer le widget dans la liste

Sur une instance que vous administrez, vous pouvez faire apparaître le widget dans le
sélecteur **Sélectionner un widget** (*Select Widget*) de tous les documents, sans
avoir à coller l'URL à chaque fois. Démarrez Grist avec la variable d'environnement :

```bash
GRIST_WIDGET_LIST_URL=https://nicolasmrsn.github.io/gantt-tous-les-champs/manifest.json
```

Le widget apparaît alors sous le nom **« Gantt — Tous les champs »**, avec le niveau
d'accès `full` déjà déclaré (Grist demandera quand même votre validation).

Si votre instance utilise déjà un `GRIST_WIDGET_LIST_URL` pointant sur votre propre
manifest, ajoutez-y l'entrée de
[`manifest.json`](https://github.com/NicolasMRSN/gantt-tous-les-champs/blob/main/manifest.json).

---

## 6. Mettre à jour le widget

Le widget est un **fichier statique** servi par GitHub Pages. Toute modification
poussée sur la branche `main` du dépôt est en ligne en une à deux minutes, et tous
les documents qui utilisent l'URL la reçoivent au prochain rechargement — il n'y a
rien à refaire dans Grist.

Pour modifier le widget :

1. Éditez `src/allfields.js` (logique) ou `src/allfields.css` (style), **pas**
   `widget/index.html` qui est généré.
2. Pour récupérer une nouvelle version du Gantt amont, remplacez
   `src/upstream-gantt.html` par la dernière version de
   [`published/taskflow/gantt/index.html`](https://github.com/nic01asFr/Widgets-Grist/blob/main/published/taskflow/gantt/index.html).
3. Régénérez le widget :

   ```bash
   python3 src/build.py
   ```

   Le script échoue explicitement si les deux points d'ancrage qu'il utilise
   (`</style>` et l'appel `initGrist();`) ont disparu de l'amont.
4. Poussez `widget/index.html` (et les sources) sur `main`.

Pour figer une version pour vos utilisateurs (ne pas subir de mise à jour), copiez
`widget/index.html` sur un hébergement que vous contrôlez et utilisez cette URL-là
dans Grist.

---

## 7. Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Le widget reste vide ; un encart dans le panneau de droite parle d'accès | Le niveau d'accès n'est pas « complet » ou n'a pas été accepté | Panneau de droite → **Niveau d'accès** → *Accès complet au document* → **Accepter** |
| Vos colonnes s'affichent avec des éditeurs génériques, sans libellés ni choix | Les métadonnées ne sont pas lisibles (accès insuffisant ou instance ancienne) | Vérifier le niveau d'accès. Le widget fonctionne en mode dégradé : les colonnes sont déduites des données |
| Une colonne ajoutée dans Grist n'apparaît pas | Le schéma a été lu avant l'ajout | **`⚙ Champs`** → **`↻ Relire les colonnes`**, ou fermer/rouvrir la tâche |
| Le panneau ne montre pas une colonne pourtant présente | « Masquer les champs vides » est actif et la colonne est vide pour cette tâche | Décocher l'option dans **`⚙ Champs`** |
| Le Gantt affiche « Aucune tâche à planifier » alors que `Tasks` est remplie | `titre`, `dateDebut` ou `dateEcheance` manquants ou du mauvais type | Vérifier ces trois colonnes (Text, Date, Date). Une tâche sans dates n'est pas dessinée |
| Bandeau « lecture seule », éditeurs grisés | Rôle Lecteur sur le document | Demander le rôle Éditeur au propriétaire du document |
| Le widget n'affiche que des données de démonstration | Le widget est ouvert **hors** de Grist (page de démo, fichier local) | Normal : dans Grist, ce sont vos données qui s'affichent |
| Page blanche, rien ne se charge | Un des trois domaines (§ 1) est bloqué par le réseau | Tester l'URL du widget directement dans le navigateur ; faire ouvrir les domaines par l'administrateur réseau |
| Lien de pièce jointe qui ne fonctionne plus | Le jeton signé a expiré | Fermer et rouvrir le panneau de la tâche : un nouveau jeton est demandé |
| Mes collègues ne voient pas les mêmes champs épinglés que moi | Choix stocké dans le navigateur de chacun | Comportement voulu : chacun épingle ce qui lui est utile |
| Des tâches, projets et membres « d'exemple » sont apparus | Le widget a créé `Tasks` et l'a alimentée pour la démonstration | Supprimer ces enregistrements dans les vues tableau |

---

## 8. Ce que le widget fait — et ne fait pas — avec vos données

- Le widget s'exécute **dans votre navigateur**, dans l'iframe fournie par Grist. Il
  ne dialogue qu'avec le document Grist ouvert, via l'API officielle des widgets.
- Les seuls appels réseau sortants sont le **téléchargement des fichiers statiques**
  (widget, `grist-plugin-api.js`, `Sortable`). Aucune donnée du document n'est
  envoyée à GitHub ni à un autre service ; il n'y a pas de télémétrie.
- Les écritures dans le document sont celles que vous déclenchez (modification d'un
  champ, déplacement d'une barre, création/suppression d'une tâche), plus, au premier
  lancement, la création des tables/colonnes manquantes décrite au § 3.
- Les préférences (champs épinglés, option « masquer les vides ») restent dans le
  `localStorage` du navigateur.

---

*Widget d'origine : TaskFlow / Gantt, [nic01asFr/Widgets-Grist](https://github.com/nic01asFr/Widgets-Grist), licence MIT.
Cette version : [NicolasMRSN/gantt-tous-les-champs](https://github.com/NicolasMRSN/gantt-tous-les-champs), licence MIT.*
