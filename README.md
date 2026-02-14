# GeminiSite

Dashboard statique pour suivre les decisions de trading crypto et le portefeuille papier.

## Donnees lues par le site

- `paper_decisions.jsonl`: flux des decisions et executions (une ligne JSON par evenement).
- `paper_portfolio.json`: etat courant du portefeuille.

## Ce que montre le dashboard

- Derniere decision avec indicateur couleur (vert, rouge, orange).
- Bloc "Dernieres news marche" avec headlines dedoublonnees + liens source.
- Vue dediee "Historique + pourquoi" avec historique des decisions, detail du pourquoi et executions.
- KPIs portefeuille (valeur totale, cash, performance, frais, positions ouvertes).
- Graphique de suivi de la valeur portefeuille avec points BUY / SELL / HOLD.
- Repartition des positions ouvertes.
- Historique des decisions (40 dernieres) cliquable avec justification par decision.
- Tableau des positions actuelles.
- Tableau des prises de trade.

## Activer GitHub Pages

1. Ouvrir `Settings > Pages` dans le repo.
2. Choisir `Deploy from a branch`.
3. Choisir `main` et dossier `/ (root)`.
4. Enregistrer.

Le site sera servi depuis l'URL GitHub Pages du repository.
