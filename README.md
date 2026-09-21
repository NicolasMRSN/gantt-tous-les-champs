# Gantt — Tous les champs (widget Grist)

Le widget **Gantt** de [TaskFlow](https://github.com/nic01asFr/Widgets-Grist), modifié
pour afficher **toutes les colonnes de votre table `Tasks`** — quel que soit leur
nombre, quel que soit leur type — au lieu de la quinzaine de champs prévus par le
panneau d'origine.

**→ [Démonstration en ligne](https://nicolasmrsn.github.io/gantt-tous-les-champs/)**
· **[Mode opératoire détaillé](MODE-OPERATOIRE.md)** (installation pas à pas, préparation de la table, utilisation, dépannage)

| | |
|---|---|
| **URL du widget** (à coller dans Grist) | `https://nicolasmrsn.github.io/gantt-tous-les-champs/widget/` |
| **Accès demandé** | Accès complet au document |
| **Tables lues** | `Tasks`, `Projects`, `Team` (+ toute table référencée par une colonne `Ref`) |
| **Licence** | MIT — dérivé de `nic01asFr/Widgets-Grist` |

---

## Ce que la modification change

Le Gantt d'origine affiche, dans son panneau de détail, une liste de champs
**écrite en dur** : titre, statut, priorité, dates, projet, assignés, estimation,
progression, tags, dépendances. Toute autre colonne de `Tasks` — budget, client,
référence marché, case à cocher, pièce jointe, colonne formule — existait dans le
document mais restait invisible dans le widget.

Cette version lit les **métadonnées du document** (`_grist_Tables_column`) et en
déduit, à l'ouverture, la liste réelle des colonnes : leur libellé, leur type,
leurs choix, leurs formules et leur ordre. Elle ajoute :

1. **Vos colonnes dans le panneau de détail, comme les champs d'origine.** Chaque
   colonne de `Tasks` que le panneau n'édite pas déjà devient une ligne
   supplémentaire de sa liste de propriétés — à la suite de Statut, Priorité,
   Dates, Projet… — avec le **même balisage** (libellé, icône, contrôle) et
   l'éditeur correspondant à son type. Rien ne distingue une colonne ajoutée dans
   Grist d'un champ natif ; les champs déjà présents ne sont pas dupliqués.
2. **Champs épinglés dans la liste de gauche** : l'étoile `★` à droite d'un libellé
   (ou le menu `⚙ Champs` en haut de la liste) affiche sa valeur sur la ligne de
   chaque tâche **et** dans l'info-bulle de la barre du Gantt. Le choix est
   mémorisé dans le navigateur.
3. **Menu `⚙ Champs`** : option « masquer les champs vides » du panneau, bouton
   `↻` pour relire les colonnes après en avoir ajouté une dans Grist, et
   **export CSV** des tâches visibles avec *toutes* leurs colonnes (séparateur
   `;`, BOM UTF-8 : s'ouvre directement dans Excel/LibreOffice).

Tout le reste du widget — Gantt, dépendances, hiérarchie, filtres, drag & drop,
droits, mode démo — est **inchangé** : voir [« Comment c'est fait »](#comment-cest-fait).

### Types pris en charge

| Type Grist | Dans le panneau |
|---|---|
| `Text` | champ texte, ou zone multiligne si le contenu est long ; les URL deviennent cliquables |
| `Numeric`, `Int` | champ numérique |
| `Bool` | case à cocher |
| `Date` | sélecteur de date, même habillage que la ligne « Dates » (secondes UTC, comme Grist) |
| `DateTime` | sélecteur date + heure |
| `Choice` | pastille de couleur + liste déroulante, comme la ligne « Projet » |
| `ChoiceList` | puces (comme les tags) + menu `+ Ajouter` à cocher, avec saisie libre d'une valeur |
| `Ref:<Table>` | liste déroulante des enregistrements, libellé pris sur la colonne « SHOW COLUMN » |
| `RefList:<Table>` | puces + menu `+ Lier`, comme la ligne « Assignés » |
| `Attachments` | liste des pièces jointes avec lien de téléchargement (lecture seule) |
| colonne **formule** | valeur affichée en lecture seule, avec la formule en info-bulle |
| valeur en **erreur** | affichée telle quelle (`⚠ ZeroDivisionError`), jamais masquée |
| **tout autre type** | valeur brute éditable en JSON — aucun type ne bloque l'affichage |

Testé jusqu'à **137 colonnes** sur une tâche : rendu du panneau en ~250 ms.

---

## Mode opératoire

> Version courte. Le **[mode opératoire détaillé](MODE-OPERATOIRE.md)** couvre en plus
> la liaison de sélection, la préparation d'une table `Tasks` existante, la mise à jour
> du widget et un tableau de dépannage.

### 1. Ajouter le widget à votre document Grist

1. Dans votre document, **Ajouter un widget** → **Custom** (widget personnalisé).
2. Choisissez comme source de données la table **`Tasks`**.
3. Dans le panneau de droite, champ **URL** :
   ```
   https://nicolasmrsn.github.io/gantt-tous-les-champs/widget/
   ```
4. **Access level** : choisissez **« Full document access »** (accès complet).
   C'est nécessaire : sans lui, Grist n'autorise ni la lecture des métadonnées de
   colonnes, ni l'écriture dans une colonne que le widget ne connaît pas d'avance.
5. Cliquez sur **Accepter**. Le widget s'ouvre.

> **Variante instance auto-hébergée** — pour voir le widget dans la liste déroulante
> « Custom Widget » de toute votre instance :
> ```bash
> GRIST_WIDGET_LIST_URL=https://nicolasmrsn.github.io/gantt-tous-les-champs/manifest.json
> ```

### 2. Préparer la table `Tasks`

- **Document vide** : au premier lancement, le widget crée les tables `Tasks`,
  `Projects`, `Team` avec le schéma TaskFlow (comportement hérité du widget d'origine).
- **Table `Tasks` existante** : rien à faire. Les colonnes du schéma TaskFlow qui
  manquent sont ajoutées, **vos colonnes à vous sont conservées et détectées
  automatiquement**. Le Gantt lui-même a besoin d'au moins `titre`, `dateDebut` et
  `dateEcheance` pour dessiner les barres ; toutes les autres colonnes sont libres.

### 3. Voir et modifier tous les champs

1. Cliquez sur une tâche (dans la liste de gauche ou sur sa barre).
2. Dans le panneau de détail, vos colonnes suivent les champs d'origine (Statut,
   Priorité, Dates, Projet, Parent, Couleur, Assignés, Temps & charge,
   Progression), dans l'ordre des colonnes du document.
3. Modifiez une valeur : l'écriture part dans Grist à la validation du champ
   (`Entrée`, ou en quittant le champ), l'indicateur « Enregistré » le confirme.

Dans le menu **`⚙ Champs`** (en haut de la liste de gauche) :

| Commande | Effet |
|---|---|
| cases à cocher | épingle une colonne dans la liste et l'info-bulle (voir 4) |
| `Masquer les champs vides` | le panneau ne montre que les colonnes renseignées pour la tâche |
| `↻ Relire les colonnes` | relit le schéma (après avoir ajouté une colonne dans Grist) |
| `⤓ Export CSV` | exporte les tâches visibles × toutes les colonnes |

### 4. Afficher un champ dans la liste et l'info-bulle

- Cliquez sur l'étoile **★** à droite du libellé d'un champ dans le panneau, **ou**
- Cliquez sur **`⚙ Champs`** en haut de la liste de gauche et cochez les colonnes.

Les champs épinglés apparaissent sur la ligne de chaque tâche (à côté des dates,
tronqués si la place manque — le détail complet est en info-bulle) et dans
l'info-bulle au survol des barres du Gantt. Le choix est enregistré dans le
navigateur (`localStorage`), jamais dans le document : chacun a le sien.

### 5. Cas particuliers

- **Droits en lecture seule** : le bandeau du widget d'origine s'affiche et tous
  les éditeurs sont désactivés ; l'affichage de tous les champs reste complet.
- **Colonne formule** : lecture seule (c'est Grist qui calcule), la formule est
  en info-bulle sur le `ƒ`.
- **Pièces jointes** : lecture seule, avec lien de téléchargement signé obtenu via
  `getAccessToken`. Le lien expire avec le jeton : rouvrez le panneau si besoin.
- **Nouvelle tâche** : une ligne « Autres champs » indique le nombre de colonnes
  supplémentaires ; elles deviennent éditables dès que l'enregistrement existe.
- **Métadonnées illisibles** (droits restreints, instance ancienne) : le widget se
  rabat sur les colonnes présentes dans les données et déduit les types des
  valeurs. Vous voyez toujours tous les champs, avec des éditeurs plus génériques.

---

## Comment c'est fait

La modification est **purement additive** : aucune fonction du widget d'origine
n'est réécrite. Le module s'installe en enveloppant quatre fonctions existantes —
`renderPanel`, `renderTaskList`, `loadAllData`, `useDemoMode` — et ajoute son
propre DOM après coup. Si une étape échoue (droits, métadonnées, version de Grist
différente), le widget continue de fonctionner exactement comme avant.

```
src/
├── upstream-gantt.html   le widget Gantt amont, repris tel quel
├── allfields.css         le style ajouté (tout est préfixé .af-)
├── allfields.js          le module « tous les champs »
└── build.py              insère les deux blocs dans l'amont -> widget/index.html
```

```bash
python3 src/build.py     # régénère widget/index.html
```

Dans `widget/index.html`, les ajouts sont délimités par les marqueurs
`allfields:css (debut/fin)` et `allfields:js (debut/fin)` : un `diff` avec
`src/upstream-gantt.html` ne montre que ces deux blocs, le titre et le bandeau
de crédit.

**Mettre à jour depuis l'amont** : remplacez `src/upstream-gantt.html` par la
dernière version de
[`published/taskflow/gantt/index.html`](https://github.com/nic01asFr/Widgets-Grist/blob/main/published/taskflow/gantt/index.html)
et relancez le build. Les deux points d'ancrage utilisés sont `</style>` et
l'appel `initGrist();` ; le build échoue explicitement s'ils ont disparu.

---

## Crédits et licence

Widget d'origine : **TaskFlow / Gantt**, [nic01asFr/Widgets-Grist](https://github.com/nic01asFr/Widgets-Grist),
licence MIT. Voir [CREDITS.md](CREDITS.md).
Cette version : MIT également — voir [LICENSE](LICENSE).
