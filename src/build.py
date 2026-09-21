#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit le widget « Gantt — Tous les champs » à partir du widget Gantt amont
(nic01asFr/Widgets-Grist, licence MIT) sans réécrire une seule de ses fonctions.

Le patch est volontairement minimal et vérifiable :
  1. un bloc CSS  (src/allfields.css) inséré avant la fin de la feuille de style ;
  2. un bloc JS   (src/allfields.js)  inséré juste avant l'appel initGrist() ;
  3. le <title> et un bandeau de crédit.

    python3 src/build.py            # -> widget/index.html
"""
import pathlib
import sys
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "widget" / "index.html"

UPSTREAM = SRC / "upstream-gantt.html"
CSS = SRC / "allfields.css"
JS = SRC / "allfields.js"

BANNER = """<!--
  ============================================================================
  Gantt - Tous les champs . widget Grist
  ----------------------------------------------------------------------------
  Derive du widget Gantt de TaskFlow : https://github.com/nic01asFr/Widgets-Grist
  (licence MIT). Le widget amont est repris tel quel ; cette version ajoute, en
  extension purement additive, l'affichage et l'edition de TOUTES les colonnes
  de la table Tasks, quels que soient leur nombre et leur type.

  Les deux ajouts sont reperables dans ce fichier par les marqueurs de commentaire
  CSS et JS "allfields:css" et "allfields:js" (ouvrants et fermants).

  Construit le {DATE} par src/build.py - ne pas editer a la main :
  editer src/allfields.css / src/allfields.js puis relancer le build.
  ============================================================================
-->
"""


def fail(msg):
    print("ERREUR : " + msg, file=sys.stderr)
    sys.exit(1)


def main():
    for f in (UPSTREAM, CSS, JS):
        if not f.exists():
            fail("fichier manquant : %s" % f)

    html = UPSTREAM.read_text(encoding="utf-8")
    css = CSS.read_text(encoding="utf-8")
    js = JS.read_text(encoding="utf-8")

    # 1. CSS — avant la fin de la première feuille de style du document
    anchor = "</style>"
    if anchor not in html:
        fail("balise </style> introuvable dans le widget amont")
    block = "\n        /* ===== allfields:css (debut) ===== */\n" + css + "        /* ===== allfields:css (fin) ===== */\n    "
    html = html.replace(anchor, block + anchor, 1)

    # 2. JS — juste avant le démarrage du widget
    anchor = "        initGrist();"
    if anchor not in html:
        fail("appel initGrist() introuvable dans le widget amont")
    block = "\n        /* ===== allfields:js (debut) ===== */\n" + js + "        /* ===== allfields:js (fin) ===== */\n\n"
    html = html.replace(anchor, block + anchor, 1)

    # 3. Titre + bandeau
    html = html.replace(
        "<title>Gantt - TaskFlow v15</title>",
        "<title>Gantt — Tous les champs · TaskFlow étendu</title>", 1)
    html = html.replace("<!DOCTYPE html>",
                        "<!DOCTYPE html>\n" + BANNER.replace("{DATE}", datetime.date.today().isoformat()), 1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print("écrit : %s (%d Ko)" % (OUT, len(html.encode("utf-8")) // 1024))


if __name__ == "__main__":
    main()
