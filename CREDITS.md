# Crédits

## Œuvre dont ce dépôt est dérivé

| | |
|---|---|
| Œuvre | **TaskFlow — widget Gantt** pour Grist |
| Auteur | **nic01asFr** — [github.com/nic01asFr](https://github.com/nic01asFr) |
| Source | [github.com/nic01asFr/Widgets-Grist](https://github.com/nic01asFr/Widgets-Grist) — fichier `published/taskflow/gantt/index.html` |
| Licence | **MIT** |
| Modifications | Ajout d'un bloc CSS (`src/allfields.css`) et d'un bloc JavaScript (`src/allfields.js`) insérés par `src/build.py` ; changement du `<title>` ; ajout d'un bandeau de crédit en tête de fichier. Aucune fonction du widget d'origine n'a été réécrite : le module s'installe en enveloppant `renderPanel`, `renderTaskList`, `loadAllData` et `useDemoMode`. |

Le fichier amont est conservé **tel quel** dans `src/upstream-gantt.html`, ce qui
permet de vérifier l'étendue exacte des modifications :

```bash
diff <(python3 - <<'PY'
import re,pathlib
h=pathlib.Path('widget/index.html').read_text(encoding='utf-8')
h=re.sub(r'/\* ===== allfields:(css|js) \(debut\) =====.*?allfields:\1 \(fin\) ===== \*/','',h,flags=re.S)
print(h)
PY
) src/upstream-gantt.html
```

## Dépendances chargées par le widget

| Ressource | Origine | Licence |
|---|---|---|
| `grist-plugin-api.js` | `docs.getgrist.com` (Grist Labs) | Apache-2.0 |
| `Sortable.min.js` 1.15.0 | `cdn.jsdelivr.net` | MIT |

Ces deux dépendances sont celles du widget d'origine ; la modification n'en
ajoute aucune.

## Marques

Grist est une marque de Grist Labs. Ce projet n'est ni affilié à Grist Labs ni
approuvé par eux.
