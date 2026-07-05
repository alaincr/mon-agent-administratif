#!/usr/bin/env python3
"""Outil réel : API Annuaire de l'administration et des services publics (DILA).

- resolve_commune(nom) -> (nom_officiel, code_insee)   via geo.api.gouv.fr
- find_service(insee, pivot) -> [ {nom, adresse, tel, courriel, site, horaires, url_sp} ]
  via api-lannuaire.service-public.fr (OpenDataSoft), filtré par commune + type (pivot).

Données : Licence Ouverte v2.0 — Service-Public.gouv.fr / DILA.
"""
import json, urllib.request, urllib.parse

GEO = 'https://geo.api.gouv.fr/communes'
ANN = ('https://api-lannuaire.service-public.fr/api/explore/v2.1/'
       'catalog/datasets/api-lannuaire-administration/records')

def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'service-public-assistant'})
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.load(r)

def resolve_commune(name):
    if not name:
        return None, None
    try:
        u = GEO + '?' + urllib.parse.urlencode(
            {'nom': name, 'fields': 'code,nom', 'limit': 1}, quote_via=urllib.parse.quote)
        d = _get(u)
        if d:
            return d[0]['nom'], d[0]['code']
    except Exception:
        pass
    return None, None

def find_service(insee, pivot='mairie', limit=5):
    if not insee or not pivot:
        return []
    try:
        where = f'code_insee_commune="{insee}" and pivot like "{pivot}"'
        u = ANN + '?' + urllib.parse.urlencode(
            {'where': where, 'limit': limit}, quote_via=urllib.parse.quote)
        results = _get(u).get('results', [])
    except Exception:
        return []
    out = []
    for r in results:
        try:
            out.append(_fmt(r))
        except Exception:
            pass
    return out

def _parse(v):
    """Les champs structurés de l'API arrivent en JSON sérialisé (chaîne)."""
    if isinstance(v, str) and v.strip()[:1] in '[{':
        try:
            return json.loads(v)
        except Exception:
            return v
    return v

def _val(x):
    return x.get('valeur') if isinstance(x, dict) else x

def _join(field):
    field = _parse(field)
    if isinstance(field, list):
        return ', '.join(str(_val(x)) for x in field if _val(x))
    return field or ''

def _fmt(r):
    adl = _parse(r.get('adresse'))
    ad = adl[0] if isinstance(adl, list) and adl else {}
    addr = ' '.join(x for x in [ad.get('numero_voie', ''), ad.get('code_postal', ''),
                                ad.get('nom_commune', '')] if x).strip()
    si = _parse(r.get('site_internet'))
    site = _val(si[0]) if isinstance(si, list) and si else ''
    return {'nom': r.get('nom'), 'adresse': addr, 'tel': _join(r.get('telephone')),
            'courriel': _join(r.get('adresse_courriel')), 'site': site,
            'horaires': _hours(_parse(r.get('plage_ouverture')) or []),
            'url_sp': r.get('url_service_public')}

def _hours(pl):
    out = []
    for p in pl:
        jd, jf = p.get('nom_jour_debut', ''), p.get('nom_jour_fin', '')
        jour = jd if (jd == jf or not jf) else f'{jd}–{jf}'
        slots = []
        for a, b in (('valeur_heure_debut_1', 'valeur_heure_fin_1'),
                     ('valeur_heure_debut_2', 'valeur_heure_fin_2')):
            if p.get(a) and p.get(b):
                slots.append(f'{p[a][:5]}-{p[b][:5]}')
        if jour and slots:
            out.append(f'{jour} {" / ".join(slots)}')
    return out

if __name__ == '__main__':
    import sys
    nom, insee = resolve_commune(sys.argv[1] if len(sys.argv) > 1 else 'Pantin')
    print(nom, insee)
    for s in find_service(insee, sys.argv[2] if len(sys.argv) > 2 else 'mairie'):
        print(s)
