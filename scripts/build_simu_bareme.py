#!/usr/bin/env python3
"""Génère web/simu-bareme.js : les seuils du simulateur « Mes aides » calculés par
OpenFisca-France (le moteur officiel des règles socio-fiscales) au lieu de valeurs manuscrites.

Deux sources, tout est daté et traçable :
- PARAMÈTRES officiels (plafonds ASPA, CSS, ARS, montant AAH, échelle de foyer CSS…) ;
- SIMULATIONS de cas-types VECTORISÉES (une seule passe pour N foyers répliqués, technique
  QuelImpact) : montants forfaitaires RSA exacts par composition de foyer (majorations
  comprises), et FRONTIÈRES d'annulation de la prime d'activité (revenu où ppa→0) par foyer.

Le simulateur reste 100 % local côté usager : ce script tourne au build, comme le pipeline DILA.

Usage :  <venv-openfisca>/bin/python scripts/build_simu_bareme.py  [AAAA-MM]
"""
import json, pathlib, sys, datetime

import numpy as np
from openfisca_core.simulation_builder import SimulationBuilder
from openfisca_france import FranceTaxBenefitSystem
import importlib.metadata

PERIOD = sys.argv[1] if len(sys.argv) > 1 else '2026-06'
YEAR = int(PERIOD[:4])
tbs = FranceTaxBenefitSystem()
P = tbs.parameters
OF_VERSION = importlib.metadata.version('openfisca-france')

def months(year):
    return [f'{year}-{m:02d}' for m in range(1, 13)]

# ---------------------------------------------------------------------------
# Cas-types vectorisés : configs (couple, nb_enfants, majore_isolement) × grille de salaires.
# Recette LexImpact : renseigner n, n-1, n-2 ; enfants 8-14 ans ; adultes nés en 1985.
CONFIGS = [('s', False, 0), ('s', False, 1), ('s', False, 2), ('s', False, 3),
           ('c', True, 0), ('c', True, 1), ('c', True, 2), ('c', True, 3)]

def build_case(salaries_by_house, isolement=False):
    """salaries_by_house : liste de (config_idx, salaire_mensuel_foyer). → entités OpenFisca.
    isolement=True : pose la condition « isolement récent » (RSA majoré parent isolé)."""
    mm = months(YEAR) + months(YEAR-1) + months(YEAR-2)
    individus, foyers, familles, menages = {}, {}, {}, {}
    for h, (ci, sal) in enumerate(salaries_by_house):
        _, couple, nk = CONFIGS[ci]
        np_par = 2 if couple else 1
        parents = [f'p{p}_{h}' for p in range(np_par)]
        for p in parents:
            individus[p] = {'salaire_de_base': {m: sal/np_par for m in mm},
                            'date_naissance': {'ETERNITY': '1985-01-01'}}
        enfants = [f'e{k}_{h}' for k in range(nk)]
        for k, e in enumerate(enfants):
            individus[e] = {'date_naissance': {'ETERNITY': f'{YEAR-8-k}-01-01'}}
        foyers[f'ff_{h}'] = {'declarants': parents, 'personnes_a_charge': enfants}
        fam = {'parents': parents, 'enfants': enfants}
        if isolement and not couple and nk > 0:
            fam['rsa_isolement_recent'] = {m: True for m in mm}
        familles[f'fa_{h}'] = fam
        men = {'personne_de_reference': [parents[0]], 'enfants': enfants}
        if couple: men['conjoint'] = [parents[1]]
        menages[f'me_{h}'] = men
    return {'individus': individus, 'foyers_fiscaux': foyers, 'familles': familles, 'menages': menages}

def simulate(case, variable, period):
    sim = SimulationBuilder().build_from_entities(tbs, case)
    sim.max_spiral_loops = 2
    return sim.calculate(variable, period)

out = {'genere': datetime.date.today().isoformat(), 'openfisca_france': OF_VERSION,
       'periode': PERIOD, 'source': 'OpenFisca-France (moteur officiel), paramètres + cas-types'}

# ---------------------------------------------------------------------------
# 1) RSA : montants forfaitaires EXACTS par config — variables dédiées d'OpenFisca :
#    rsa_socle (base × échelle de foyer) et rsa_socle_majore (parent isolé).
try:
    case = build_case([(i, 0.0) for i in range(len(CONFIGS))])
    socle = simulate(case, 'rsa_socle', PERIOD)
    out['rsa_socle'] = {CONFIGS[i][0] + str(CONFIGS[i][2]): round(float(socle[i]), 2) for i in range(len(CONFIGS))}
    # parent isolé (configs « seul avec enfants ») : montant majoré, condition d'isolement posée
    case_iso = build_case([(i, 0.0) for i in range(len(CONFIGS))], isolement=True)
    majore = simulate(case_iso, 'rsa_socle_majore', PERIOD)
    out['rsa_socle_isole'] = {CONFIGS[i][0] + str(CONFIGS[i][2]): round(float(majore[i]), 2)
                              for i in range(len(CONFIGS)) if not CONFIGS[i][1] and CONFIGS[i][2] > 0}
except Exception as e:
    print('RSA ✗', e)

# ---------------------------------------------------------------------------
# 2) Prime d'activité : frontière d'annulation par config (grille 0→4000 €/mois, pas 100).
try:
    grid = list(range(0, 6100, 100))
    houses = [(ci, float(s)) for ci in range(len(CONFIGS)) for s in grid]
    case = build_case(houses)
    ppa = simulate(case, 'ppa', PERIOD)
    seuils = {}
    for ci in range(len(CONFIGS)):
        vals = ppa[ci*len(grid):(ci+1)*len(grid)]
        # dernier salaire où ppa > 5 €/mois (le seuil de versement officiel est ~15 €/trimestre)
        idx = [i for i, v in enumerate(vals) if v > 5]
        seuils[CONFIGS[ci][0] + str(CONFIGS[ci][2])] = grid[max(idx)] if idx else 0
    out['ppa_seuil'] = seuils
except Exception as e:
    print('PPA ✗', e)

# ---------------------------------------------------------------------------
# 3) Plafonds directs (paramètres officiels, valeurs à PERIOD)
def put(key, fn):
    try: out[key] = round(float(fn()), 2)
    except Exception as e: print(key, '✗', str(e)[:80])

si = P.prestations_sociales.solidarite_insertion
put('aspa_seul_mois',   lambda: si.minimum_vieillesse.aspa.plafond_ressources.personnes_seules(PERIOD) / 12)
put('aspa_couple_mois', lambda: si.minimum_vieillesse.aspa.plafond_ressources.couples(PERIOD) / 12)
put('aah_mois',         lambda: P.prestations_sociales.prestations_etat_de_sante.invalidite.aah.montant(PERIOD))
cmu = si.minima_sociaux.cs.cmu
put('css_plafond_an',   lambda: cmu.plafond_base(PERIOD))       # CSS gratuite, personne seule, annuel
put('css_coeff_p2',     lambda: cmu.coeff_p2(PERIOD))           # échelle foyer officielle
put('css_coeff_p3_p4',  lambda: cmu.coeff_p3_p4(PERIOD))
put('css_coeff_p5',     lambda: cmu.coeff_p5_plus(PERIOD))
out['css_facteur_participation'] = 1.35                          # art. L.861-1 CSS : plafond ×1,35
ars = P.prestations_sociales.prestations_familiales.education_presence_parentale.ars
put('ars_plafond_an',   lambda: ars.ars_plaf.plafond_ressources(PERIOD))
put('ars_maj_enfant',   lambda: ars.ars_plaf.majoration_par_enf_supp(PERIOD))

# ---------------------------------------------------------------------------
dst = pathlib.Path(__file__).resolve().parent.parent / 'web/simu-bareme.js'
js = ('// GÉNÉRÉ par scripts/build_simu_bareme.py — seuils calculés par OpenFisca-France '
      f'{OF_VERSION} (période {PERIOD}). Ne pas éditer à la main.\n'
      'const SIMU_BAREME = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n')
dst.write_text(js)
print(f'→ {dst}')
print(json.dumps(out, ensure_ascii=False, indent=1))
