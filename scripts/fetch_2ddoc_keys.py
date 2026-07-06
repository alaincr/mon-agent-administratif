#!/usr/bin/env python3
"""Régénère web/vendor/2ddoc/keys.json : les clés publiques (JWK) des émetteurs 2D-Doc,
indexées par "CA_ID/CERT_ID" (tels que présents dans l'en-tête d'un code 2D-Doc).

Source : la TSL officielle ANTS + les annuaires de certificats feuilles des AC,
via la bibliothèque betagouv/2ddoc-parser (pip install fr-2ddoc-parser, ou clone + PYTHONPATH).
La vérification dans l'app (web/coffre.js) est ensuite 100 % hors-ligne (WebCrypto).

Usage :  python3 scripts/fetch_2ddoc_keys.py
"""
import base64, json, pathlib, sys

try:
    from fr_2ddoc_parser.crypto.key_resolver import local_key_resolver as R
except ImportError:
    sys.exit("Installez d'abord le parseur : pip install fr-2ddoc-parser "
             "(ou clonez betagouv/2ddoc-parser et lancez avec PYTHONPATH=<clone>/src)")
from cryptography.hazmat.primitives.asymmetric import ec

CURVE = {'secp256r1': 'P-256', 'secp384r1': 'P-384', 'secp521r1': 'P-521'}

def jwk(pub):
    if not isinstance(pub, ec.EllipticCurvePublicKey):
        return None                     # (les rares clés RSA ne sont pas gérées côté web)
    n, size = pub.public_numbers(), (pub.curve.key_size + 7) // 8
    b64u = lambda i: base64.urlsafe_b64encode(i.to_bytes(size, 'big')).rstrip(b'=').decode()
    return {'kty': 'EC', 'crv': CURVE[pub.curve.name], 'x': b64u(n.x), 'y': b64u(n.y)}

out = {}
for src in (R._leaf_index, R._index):   # feuilles d'abord (prioritaires), puis TSL
    for (ca, cid), cert in src.items():
        k = jwk(cert.public_key() if hasattr(cert, 'public_key') else cert)
        if k:
            out.setdefault(f'{ca}/{cid}', k)

dst = pathlib.Path(__file__).resolve().parent.parent / 'web/vendor/2ddoc/keys.json'
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, separators=(',', ':')))
print(f'{len(out)} clés → {dst}')
